package com.nepu.dongyoutong;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.security.MessageDigest;

/**
 * 应用内下载更新 + 拉起系统安装器。
 *
 * 2026-11-24 从旧仓库（com.hobson.hangyuantong）原样搬回来，只改了包名、
 * User-Agent 和临时文件的清理规则 —— 这一段逻辑是当年三次修「下载卡住」修出来的，
 * 不要重写，先读注释。
 *
 * 🔴 为什么**不用**系统的 DownloadManager：
 *
 *    · 制品库常回 `Transfer-Encoding: chunked`，**没有 Content-Length**。
 *      系统下载器拿不到总大小，部分 ROM 上干脆一个字节都不写，进度条永远 0%。
 *    · DownloadManager 的进度只能靠 `COLUMN_BYTES_DOWNLOADED_SO_FAR` 查，
 *      这个值在 chunked + 国产 ROM 上更新得又慢又稀，界面上就是「卡住」。
 *    自己写循环就没有这一层：读到一个字节就知道一个字节，超时、取消、换线路
 *    都是立刻生效的，也不用猜系统在干什么。
 *
 * 🔴 两个关键点，改动前先看：
 *
 * 1. **安装包用自建 ContentProvider 交出去**（见 ApkProvider）。Android 7+ 不许
 *    把 file:// 交给别的应用（FileUriExposedException），标准解法是 androidx 的
 *    FileProvider —— 但本项目手工打包、没有 Gradle、没有 androidx，引不进来。
 *    所以自己写一个最小的 provider，靠 `grantUriPermissions` + Intent 的读权限
 *    flag 把文件借给系统安装器。这条路和 FileProvider 是同一个机制。
 *
 * 2. **不能静默安装**。Android 不允许 App 自己装自己（除非设备管理员/系统应用），
 *    最后一步一定弹系统安装器让用户点「安装」。
 *
 * 安全：只认 http/https 的地址、只认纯 ASCII 的 .apk 文件名；provider 只放行
 * 同一个目录下、同样形状的文件名，挡掉 `../`。
 */
public class UpdateDownloader {

    /**
     * 连不上就别耗着 —— 校园网里连不通是常事。
     * 🔴 必须比前端 UPD_BOOT_MS（8 秒）短：两边都卡在 8 秒时，前端会先判
     *    「这条线路没起来」然后 cancel 掉——刚好在连上的那一秒把下载掐死。
     *    6 秒收工，前端 8 秒判的时候这边已经明确失败了。
     */
    private static final int CONNECT_MS = 6000;
    /** 连上了但一个字节都不给：12 秒判死。这比 DownloadManager 的「永远不动」强。 */
    private static final int READ_MS = 12000;
    private static final int BUF = 16 * 1024;

    private final Context ctx;

    /** 进程内只跑一个任务：更新包只有一个，两个任务抢同一个文件只会互相写坏。 */
    private static volatile Task cur;

    static class Task {
        int id;
        String name;
        String url;
        File dest;
        /** 每个任务**唯一**的临时文件（名字里带 id）。
         *
         *  🔴 不能所有任务共用一个 `xxx.apk.part`：换线路时是先 cancel 旧的、
         *     再 start 新的，两个线程会同时活着几百毫秒。旧线程退出前会
         *     「把自己的 .part 删掉」—— 同名的话，删的其实是新线程正在写的那个，
         *     新文件被 unlink，最后 renameTo 失败，界面报「安装包存不下来」。
         *     带 id 之后，旧线程只删得到它自己那份。 */
        File part;
        volatile long bytes;
        volatile long total;        // <=0 = 这条线路没给文件大小
        volatile int status;        // 1 等待 / 2 下载中 / 8 完成 / 16 失败
        volatile int reason;
        volatile boolean stop;
        volatile String err;
        volatile HttpURLConnection conn;
        Thread th;
    }

    public UpdateDownloader(Context ctx) {
        this.ctx = ctx;
    }

    private static String err(String msg) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", msg == null ? "未知错误" : msg);
            return o.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"unknown\"}";
        }
    }

    /** 只放行 `dongyoutong-0.1.1.apk` 这种形状，挡掉 `../../` 和奇怪字符。 */
    private static String safeName(String name) {
        String n = (name == null) ? "" : name.trim();
        if (!n.matches("[A-Za-z0-9._-]{1,80}")) return null;
        if (!n.endsWith(".apk")) return null;
        if (n.contains("..")) return null;
        return n;
    }

    private static long num(String s) {
        if (s == null) return -1;
        try {
            return Long.parseLong(s.trim());
        } catch (Throwable t) {
            return -1;
        }
    }

    /** 清掉以前没下完的临时文件（App 被杀 / 系统清理后留下的）。
     *  只管 `.part`，不碰任何 `.apk` —— 下好的包可能正等着装。
     *  🔴 不按前缀过滤：安装包名字从前叫 `hangyuantong-*`、现在叫 `dongyoutong-*`，
     *     写死前缀的结果是改名之后的半年里，旧临时文件一个都清不掉。 */
    private static void cleanParts(File dir) {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            String n = f.getName();
            if (n.endsWith(".part")) {
                try { f.delete(); } catch (Throwable e) { }
            }
        }
    }

    /** 总字节数：Content-Length 优先，其次 Content-Range 的 `/总长`，都没有给 -1。 */
    private static long lenOf(HttpURLConnection c) {
        long n = num(c.getHeaderField("Content-Length"));
        if (n > 0) return n;
        String cr = c.getHeaderField("Content-Range");
        if (cr != null) {
            int i = cr.lastIndexOf('/');
            if (i > 0) {
                n = num(cr.substring(i + 1));
                if (n > 0) return n;
            }
        }
        return -1;
    }

    // ---------------------------------------------------------------- 下载

    /**
     * 入队一个下载。返回 {"ok":true,"id":12} 或 {"ok":false,"error":"..."}。
     *
     * 文件落在应用私有目录（`getExternalFilesDir()`，拿不到时退回内部目录）——
     * 那里**不需要存储权限**，卸载 App 时会一起清掉，也不会在用户的相册/下载
     * 目录里留垃圾。
     */
    @JavascriptInterface
    public String start(String url, String name) {
        try {
            String u = (url == null) ? "" : url.trim();
            if (!(u.startsWith("http://") || u.startsWith("https://"))) {
                return err("下载地址不是 http/https");
            }
            String n = safeName(name);
            if (n == null) return err("安装包文件名不合法：" + name);

            cancel(0);                      // 上一个任务的残余，先收干净

            File dir = ApkProvider.dir(ctx.getApplicationContext());
            if (dir == null) return err("手机上找不到能存文件的地方");
            if (!dir.exists() && !dir.mkdirs()) return err("手机上找不到能存文件的地方");

            File dest = new File(dir, n);
            // 同名的旧包先删：留着的话下面写文件会失败，而且下次打开弹层
            // 可能被当成「已经下好了」—— 表现是点了没反应，很难查。
            if (dest.exists() && !dest.delete()) {
                return err("旧的安装包删不掉，可能被别的程序占着");
            }
            cleanParts(dir);

            Task t = new Task();
            t.id = (int) (System.currentTimeMillis() % 1000000) + 1;
            t.name = n;
            t.url = u;
            t.dest = dest;
            t.part = new File(dir, n + "." + t.id + ".part");
            t.bytes = 0;
            t.total = -1;
            t.status = 1;
            t.reason = 0;
            t.err = "";
            cur = t;

            final Task ft = t;
            Thread th = new Thread(new Runnable() {
                @Override
                public void run() {
                    worker(ft);
                }
            }, "dyt-apk-dl");
            th.setDaemon(true);
            t.th = th;
            th.start();

            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("id", t.id);
            return o.toString();
        } catch (Throwable e) {
            return err(String.valueOf(e));
        }
    }

    /** 下载线程：一个 GET，把字节写进临时文件，读完再改名成正式文件。 */
    private void worker(Task t) {
        HttpURLConnection c = null;
        InputStream in = null;
        OutputStream out = null;
        File part = t.part;
        try {
            // 清单里的地址可能是 302 到对象存储。HttpURLConnection 默认跟随同协议
            // 重定向，这里显式打开，免得某些实现默认关闭时我们去读一个 302 的正文。
            HttpURLConnection.setFollowRedirects(true);
            c = (HttpURLConnection) new URL(t.url).openConnection();
            t.conn = c;
            c.setRequestMethod("GET");
            c.setConnectTimeout(CONNECT_MS);
            c.setReadTimeout(READ_MS);
            c.setInstanceFollowRedirects(true);
            // 🔴 不要压缩：要 identity。服务器若 gzip 了，Content-Length 是压缩后
            //    的长度，而我们写盘的是压缩数据 —— 校验必然对不上。
            c.setRequestProperty("Accept-Encoding", "identity");
            c.setRequestProperty("User-Agent", "dongyoutong-updater");
            c.setRequestProperty("Cache-Control", "no-cache");
            c.setUseCaches(false);

            int code = c.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                fail(t, 1004, "下载地址不对（HTTP " + code + "）");
                return;
            }
            t.total = lenOf(c);              // 可能是 -1：chunked 就没有总长
            t.status = 2;

            in = new BufferedInputStream(c.getInputStream(), BUF);
            out = new BufferedOutputStream(new FileOutputStream(part), BUF);
            byte[] buf = new byte[BUF];
            int n;
            while ((n = in.read(buf)) > 0) {
                if (t.stop) {
                    fail(t, 0, "已取消");
                    return;
                }
                out.write(buf, 0, n);
                t.bytes += n;
            }
            out.flush();
            out.close();
            out = null;
            in.close();
            in = null;

            if (t.stop) {
                fail(t, 0, "已取消");
                return;
            }
            // 知道总长就核对一下：短了说明被掐断了，不能拿去装
            if (t.total > 0 && t.bytes != t.total) {
                fail(t, 1007, "下载中断了，重新下一次");
                return;
            }
            if (t.bytes <= 0) {
                fail(t, 1003, "下载中断了（没有收到内容）");
                return;
            }
            if (t.dest.exists()) t.dest.delete();
            if (!part.renameTo(t.dest)) {
                fail(t, 1001, "安装包存不下来");
                return;
            }
            t.status = 8;
        } catch (SocketTimeoutException e) {
            fail(t, 1003, "下载中断了（网太慢或者断开了）");
        } catch (UnknownHostException e) {
            fail(t, 1008, "连不上网");
        } catch (ConnectException e) {
            fail(t, 1008, "连不上网");
        } catch (Throwable e) {
            fail(t, 1003, "下载中断了（" + e + "）");
        } finally {
            try { if (out != null) out.close(); } catch (Throwable e) { }
            try { if (in != null) in.close(); } catch (Throwable e) { }
            try { if (c != null) c.disconnect(); } catch (Throwable e) { }
            // 只删自己那一份（名字带 id）—— 见 Task.part 的注释
            if (part != null && part.exists() && t.status != 8) {
                try { part.delete(); } catch (Throwable e) { }
            }
        }
    }

    private static void fail(Task t, int reason, String why) {
        if (t.status == 8) return;           // 已经好了就别再改成失败
        t.reason = reason;
        t.err = why;
        t.status = 16;
    }

    /**
     * 查进度。status 沿用系统下载器那套编号，前端不用改：
     * 1 等待 / 2 下载中 / 16 失败 / 8 完成。
     * total 为 -1 时表示「这条线路没给文件大小」，不是「大小是零」。
     */
    @JavascriptInterface
    public String state(long id) {
        try {
            Task t = cur;
            if (t == null || (id > 0 && t.id != id)) {
                return err("找不到这个下载任务（App 可能已退出）");
            }
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("status", t.status);
            o.put("bytes", t.bytes);
            o.put("total", t.total);
            o.put("reason", t.reason);
            o.put("error", t.err == null ? "" : t.err);
            return o.toString();
        } catch (Throwable e) {
            return err(String.valueOf(e));
        }
    }

    /**
     * 算下载文件的 SHA-256（小写十六进制）。读不到就返回空串。
     *
     * 🔴 空串和「算出来不一样」是两件事：前者是「没读到」，后者是「包被换了」。
     *    界面要分开说，别把「没读到」说成「校验通过」。
     */
    @JavascriptInterface
    public String sha256(long id) {
        InputStream in = null;
        try {
            File f = fileOf(id);
            if (f == null) return "";
            in = new java.io.FileInputStream(f);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            byte[] h = md.digest();
            StringBuilder sb = new StringBuilder(h.length * 2);
            for (byte b : h) {
                // 必须 & 0xff：byte 是带符号的，直接格式化负数会出 "ffffff80" 这种
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        } finally {
            if (in != null) {
                try { in.close(); } catch (Throwable t) { }
            }
        }
    }

    /** 当前任务（或指定 id）下完的文件；没有 / 没下完返回 null。 */
    private static File fileOf(long id) {
        Task t = cur;
        if (t == null) return null;
        if (id > 0 && t.id != id) return null;
        if (t.dest == null || !t.dest.exists()) return null;
        if (t.status != 8) return null;
        return t.dest;
    }

    /** 取消并删掉已下载的文件。 */
    @JavascriptInterface
    public void cancel(long id) {
        try {
            Task t = cur;
            if (t == null) return;
            if (id > 0 && t.id != id) return;
            t.stop = true;
            HttpURLConnection c = t.conn;
            if (c != null) {
                try { c.disconnect(); } catch (Throwable e) { }
            }
            if (t.part != null) {
                try { t.part.delete(); } catch (Throwable e) { }
            }
            File f = t.dest;
            if (f != null) {
                try { f.delete(); } catch (Throwable e) { }
            }
            if (t.status != 8) t.status = 16;
            t.reason = 0;
            t.err = "已取消";
        } catch (Throwable e) { }
    }

    // ---------------------------------------------------------------- 安装

    /**
     * 有没有「安装未知应用」的权限。
     * Android 8.0 以前没有这个开关，一律当作有（装了就能装）。
     *
     * 查询本身失败时返回 true：查不出来不代表没权限，让安装那一步去撞，
     * 撞出来的错误更准 —— 在这里拦下来只会给一句含糊的「没权限」。
     */
    @JavascriptInterface
    public boolean canInstall() {
        if (Build.VERSION.SDK_INT < 26) return true;
        try {
            return ctx.getPackageManager().canRequestPackageInstalls();
        } catch (Throwable t) {
            return true;
        }
    }

    /** 跳到「安装未知应用」的授权页。 */
    @JavascriptInterface
    public void installSettings() {
        try {
            Intent it;
            if (Build.VERSION.SDK_INT >= 26) {
                it = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + ctx.getPackageName()));
            } else {
                it = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(it);
        } catch (Throwable t) {
            // 有些 ROM 没有这个页面 —— 静默失败，界面已经给了文字说明
        }
    }

    /**
     * 把下载好的包交给系统安装器。
     * 返回 "" = 已拉起；"need-permission" = 缺「安装未知应用」；其余是失败原因。
     */
    @JavascriptInterface
    public String install(long id) {
        try {
            if (!canInstall()) return "need-permission";
            File f = fileOf(id);
            if (f == null) return "fail: 还没下载完，或者文件已被系统清理";
            Uri u = ApkProvider.uriFor(f.getName());
            Intent it = new Intent(Intent.ACTION_VIEW);
            it.setDataAndType(u, "application/vnd.android.package-archive");
            // 文件在本 App 私有目录里，安装器读不到 —— 靠这个 flag 把读权限
            // 借给它（ApkProvider 声明了 grantUriPermissions）。
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(it);
            return "";
        } catch (Throwable t) {
            return "fail: " + t;
        }
    }
}
