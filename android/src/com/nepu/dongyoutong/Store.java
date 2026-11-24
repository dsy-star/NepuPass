package com.nepu.dongyoutong;

import android.content.Context;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.File;

/**
 * 存储占用：算清楚、回收得掉。
 *
 * 🔴 为什么要有这个类：安装包只有 600 KB，装完却占五十多 MB。用户第一反应
 *    「是不是没优化」，实际上代码和数据加起来不到 2 MB —— 剩下全是
 *    **WebView 自己建的磁盘缓存**（`app_webview/` 里的 HTTP Cache、Code Cache、
 *    GPUCache，加上 `cache/`）。办事入口打开的是学校的教务/门户页面，
 *    一个页面几百 KB 图片字体，几十个页面滚下来就是几十 MB。
 *
 *    这些缓存**可以再生成**，删掉只会让下一次加载慢一点，不影响登录态
 *    （cookie 在 `app_webview/Cookies` 和 CredStore 里，不在缓存目录）。
 *
 * 分工，别混：
 *   · {@link #sweep} —— 启动时调，WebView **还没创建**，清理应用缓存目录。
 *     app_webview 中仅清理明确属于缓存的目录层级。
 *   · {@link #trimWebViewCache} —— WebView 已创建后调，走官方 API。
 *     运行中直接删缓存目录有几率让它读到半截文件，官方 API 才稳。
 *
 * 文件逻辑全在 {@link StoreFiles} 里（不依赖 android，电脑上能跑真测试）。
 *
 * ⚠️ 绝不碰 `app_webview/Local Storage` 和 `Cookies`：那是课表缓存和登录态，
 *    用户清个缓存不该把账号也弄丢。
 */
public final class Store {

    private Store() {
    }

    /** WebView 缓存攒到这么多，启动时清一次。 */
    static final long TRIM_AT = 24L * 1024 * 1024;

    // ---------------------------------------------------------------- 路径

    /** `app_webview` 的实际位置。API 23 没有 `getDataDir()`，只能从 dataDir 拼。 */
    private static File webviewDir(Context c) {
        String d = c.getApplicationInfo().dataDir;
        if (d == null || d.isEmpty()) return null;
        return new File(d, "app_webview");
    }

    // ---------------------------------------------------------------- 统计

    static long apkBytes(Context c) {
        return 0;
    }

    static long cacheBytes(Context c) {
        return StoreFiles.sizeOf(c.getCacheDir());
    }

    static long webviewBytes(Context c) {
        return StoreFiles.sizeOf(webviewDir(c));
    }

    /** 应用数据目录整体（含 databases / shared_prefs / files / cache）。 */
    static long dataBytes(Context c) {
        String d = c.getApplicationInfo().dataDir;
        if (d == null || d.isEmpty()) return 0;
        return StoreFiles.sizeOf(new File(d));
    }

    static long freeBytes(Context c) {
        try {
            return c.getFilesDir().getUsableSpace();
        } catch (Throwable t) {
            return 0;
        }
    }

    /**
     * 给网页看的占用明细。
     *
     * 字段都是字节数，格式化留给前端 —— 原生这边只报数，不猜单位，
     * 免得以后想改成「按 MB 显示一位小数」还得重新发版。
     */
    static String info(Context c) {
        try {
            JSONObject o = new JSONObject();
            long apk = apkBytes(c);
            long data = dataBytes(c);
            o.put("apk", apk);
            o.put("cache", cacheBytes(c));
            o.put("webview", webviewBytes(c));
            o.put("data", data);
            // 安装包在外部私有目录（/sdcard/Android/data/…），不在 dataDir 里。
            // 系统设置里那行「应用数据」通常是两者之和，我们报的数要对得上。
            o.put("total", data + apk);
            o.put("free", freeBytes(c));
            return o.toString();
        } catch (Throwable t) {
            return "{}";
        }
    }

    // ---------------------------------------------------------------- 回收

    /**
     * 启动时的清扫。只在 WebView 创建前调用。
     *
     * @return 清掉的字节数（只在调试时看，界面上不显示 ——
     *         用户不关心「这次清了几 KB」，他只关心还占多少）
     */
    static long sweep(Context c) {
        long before = 0;
        try {
            before += StoreFiles.clearDir(c.getCacheDir());
            // 大头在这儿：学校页面的图片/脚本全落在 app_webview/Default/Cache。
            before += StoreFiles.trimWebViewDir(webviewDir(c), TRIM_AT);
        } catch (Throwable t) {
            // 清缓存失败不是错误：手机存储被别的程序占满、文件被系统锁住都可能。
            // 绝不能因为「清不掉」就让 App 打不开。
        }
        return before;
    }

    /**
     * WebView 缓存超标才清。已在 UI 线程（由 MainActivity 调）。
     *
     * `clearCache(true)` 清的是本应用的 WebView 资源缓存（含磁盘），
     * **不清 cookie、不清 localStorage** —— 所以不会让人重新登录。
     *
     * 为什么不无条件清：清完第一次打开要重新编译脚本，会慢几百毫秒。
     * 只在攒到 24 MB 时清，日常根本感觉不到。
     *
     * @return 清理前的缓存字节数（0 表示没到阈值，没清）
     */
    static long trimWebViewCache(Context c, WebView w) {
        // 用「缓存那几层」判断，不用整个 app_webview —— 后者含 Local Storage，
        // 万一课表缓存很大，会每次启动都白清一遍。
        long n = StoreFiles.webCacheBytes(webviewDir(c));
        if (n < TRIM_AT || w == null) return 0;
        try {
            w.clearCache(true);
            return n;
        } catch (Throwable t) {
            return 0;
        }
    }
}
