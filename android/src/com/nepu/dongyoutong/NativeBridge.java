package com.nepu.dongyoutong;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.job.JobScheduler;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.CalendarContract;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * JS 与原生之间唯一的通道。
 *
 * 分工：这里**只负责发 HTTP 和带 cookie**，登录/解析全在 native.js 里。
 * 之所以不把解析也搬过来：WebView 有 DOMParser，按表头名字取列比在 Java 里
 * 手写 HTML 解析稳得多，而且解析逻辑只有一份（对照测试见 _lab/out/check_native_js.py）。
 *
 * 🔴 请求必须异步回：Android.req 是阻塞调用，如果让 JS 同步等，登录加同步
 *    要十几秒，整页会僵住 —— 转圈动画都不动，用户会以为死机了。
 *    所以这里丢线程池，完成后用 evaluateJavascript 回调 window.__nativeDone。
 */
public class NativeBridge {

    private static final String NOT_CONFIGURED = "{\"status\":0,\"body\":\"\",\"url\":\"\",\"kind\":\"school_not_configured\",\"error\":\"东油适配中\"}";

    private static boolean allowedRequestUrl(String value) {
        try {
            URL url = new URL(value);
            String host = url.getHost().toLowerCase(java.util.Locale.ROOT);
            if (!"https".equalsIgnoreCase(url.getProtocol())) return false;
            if (url.getPort() != -1 && url.getPort() != 443) return false;
            return host.equals("chaoxing.com") || host.endsWith(".chaoxing.com")
                    || host.equals("ilife798.com") || host.endsWith(".ilife798.com");
        } catch (Exception ignored) {
            return false;
        }
    }
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    /** 导出的日历文件类型。日历 App 靠它认出「这是能导入的日程」。 */
    private static final String MIME_ICS = "text/calendar";

    private final WebView web;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    public NativeBridge(WebView web) {
        this.web = web;
    }

    /** 发一个请求，结果异步回给 JS。参数与 native.js 里的 http() 一一对应。 */
    @JavascriptInterface
    public void req(final int id, final String method, final String path,
                    final String body, final String referer) {
        req2(id, method, path, body, referer, null);
    }

    /**
     * 带自定义请求头的版本。`headersJson` 形如 `{"authorization":"eyJ..."}`。
     *
     * 为什么需要单独一个方法而不是给 req 加参数：req 是既有接口，
     * native.js 里几十处调用都按 5 个参数写，改签名要全动一遍，风险不值得。
     *
     * 🔴 智慧门户的网关**只认请求头里的 `authorization`**（JWT 同时也在同名
     *    cookie 里，但只带 cookie 会 401「您正在尝试访问未授权的功能!」）。
     *    没有这个重载，门户的取数接口一个都调不通。
     */
    @JavascriptInterface
    public void req2(final int id, final String method, final String path,
                     final String body, final String referer, final String headersJson) {
        pool.execute(new Runnable() {
            @Override
            public void run() {
                // 不用「空白 final 在 try/catch 里各赋一次」的写法：javac 对
                // 这种 definite-assignment 的处理容易报莫名其妙的重复定义。
                String text;
                try {
                    text = doReq(method, path, body, referer, headersJson);
                } catch (Throwable t) {
                    text = fail(String.valueOf(t));
                }
                final String json = text;
                // evaluateJavascript 必须在 UI 线程
                web.post(new Runnable() {
                    @Override
                    public void run() {
                        web.evaluateJavascript(
                                "window.__nativeDone(" + id + "," + JSONObject.quote(json) + ")",
                                null);
                    }
                });
            }
        });
    }

    /**
     * 原生定时器：到点回调网页里的 `window.__bgWake(id)`。
     *
     * 🔴 为什么非要有这一个（2026-11-16，用户第八次报「学习通还是没法后台检查」）：
     *    后台那个 WebView 不挂在任何窗口上，Chromium 把它当隐藏页面，
     *    **setTimeout 会被节流**（1 秒/次，隐藏久了 1 分钟/次）。而学习通扫描
     *    的节奏全在网页里：每门课之间等 1.8 秒、每个请求之间等 0.45 秒 ——
     *    三十多门课一轮，光等待就被拉成几十分钟，必然撞上 AutoJob 的硬超时，
     *    面板上写的就是「没查完（等太久），下一轮再试」。
     *    这个 Handler 在原生侧，网页藏起来也照样到点，不受节流影响。
     */
    @JavascriptInterface
    public void wake(final int id, final long ms) {
        web.postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    web.evaluateJavascript("window.__bgWake(" + id + ")", null);
                } catch (Throwable ignored) {
                }
            }
        }, Math.max(0L, ms));
    }

    private String doReq(String method, String path, String body, String referer,
                         String headersJson) throws Exception {
        if (path == null || !allowedRequestUrl(path)) return NOT_CONFIGURED;
        String fullUrl = path;

        HttpURLConnection c = (HttpURLConnection) new URL(fullUrl).openConnection();
        try {
            c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
            c.setRequestProperty("Accept",
                    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
            if (referer != null && !referer.isEmpty() && allowedRequestUrl(referer)) {
                c.setRequestProperty("Referer", referer);
            }
            // 🔴 自定义头必须在写 body **之前**设置：getOutputStream() 会触发
            //    connect，之后再 setRequestProperty 直接抛 IllegalStateException。
            boolean hasCt = applyHeaders(c, headersJson);
            if (body != null && !body.isEmpty()) {
                c.setDoOutput(true);
                if (!hasCt) {
                    c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                }
                byte[] raw = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(raw.length);
                OutputStream os = c.getOutputStream();
                os.write(raw);
                os.close();
            }

            int code = c.getResponseCode();
            InputStream in = (code >= 400) ? c.getErrorStream() : c.getInputStream();
            String text = readAll(in);
            String finalUrl = String.valueOf(c.getURL());

            // 兜底：HttpURLConnection 只自动跟 301/302/303（会把 POST 改成 GET），
            // 307/308 是不跟的。教务系统登录成功是 302，正常走不到这里；
            // 万一哪天换成 307，不兜这一层就会把「登录成功」误判成「登录失败」。
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                if (loc != null && !loc.isEmpty()) {
                    String next = new URL(new URL(finalUrl), loc).toString();
                    if (!allowedRequestUrl(next)) return NOT_CONFIGURED;
                    HttpURLConnection c2 = (HttpURLConnection) new URL(next).openConnection();
                    try {
                        c2.setConnectTimeout(15000);
                        c2.setReadTimeout(30000);
                        c2.setRequestProperty("User-Agent", UA);
                        c2.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
                        code = c2.getResponseCode();
                        text = readAll(code >= 400 ? c2.getErrorStream() : c2.getInputStream());
                        finalUrl = String.valueOf(c2.getURL());
                    } finally {
                        c2.disconnect();
                    }
                }
            }

            JSONObject o = new JSONObject();
            o.put("status", code);
            o.put("body", text);
            o.put("url", finalUrl);
            // 响应头里的 Date（秒，没有就是 -1 或 0）。慧生活的积分签名有个
            // 30 秒的时间桶，手机时间偏十几秒就可能差一格 ⇒「验签失败」。
            // 官方客户端拿这个头校准，JS 侧用 `r.date` 记时差（见 wSignScore）。
            o.put("date", c.getDate());
            return o.toString();
        } finally {
            c.disconnect();
        }
    }

    /** 把 JS 传来的 `{"k":"v"}` 逐个设成请求头。返回是否设过 Content-Type。
     *
     *  解析失败就当没传 —— 宁可少一个头让请求正常失败（能看到 401），
     *  也不要整个请求炸掉。
     *
     *  Content-Type 允许覆盖：门户的一卡通接口要 `application/json`，
     *  而这里默认给的是表单类型，不覆盖就永远 415/400。
     */
    private static boolean applyHeaders(HttpURLConnection c, String headersJson) {
        boolean hasCt = false;
        if (headersJson == null || headersJson.isEmpty()) return hasCt;
        try {
            JSONObject o = new JSONObject(headersJson);
            java.util.Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                String v = o.optString(k, "");
                if (k == null || k.isEmpty() || "content-length".equalsIgnoreCase(k)) continue;
                if ("content-type".equalsIgnoreCase(k)) hasCt = true;
                c.setRequestProperty(k, v);
            }
        } catch (Throwable ignored) {
            // 见上：静默跳过，但请求本身照发
        }
        return hasCt;
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        // 教务系统是 UTF-8；用 Python 版对照过，别改成平台默认编码
        return new String(bos.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String fail(String msg) {
        try {
            JSONObject o = new JSONObject();
            o.put("status", 0);
            o.put("body", "");
            o.put("url", "");
            o.put("error", msg);
            return o.toString();
        } catch (Exception e) {
            return "{\"status\":0,\"body\":\"\",\"url\":\"\",\"error\":\"unknown\"}";
        }
    }

    // ---------------------------------------------------------------- 凭据
    // 不走网络，直接同步返回，省得 JS 里再包一层 Promise。

    // ---- 存储占用 ----
    // 🔴 装完占五十多 MB 的账要算得清：前端「清除本机缓存」以前只删 localStorage
    //    里那几个键（几十 KB），磁盘上的 WebView 缓存（几十 MB）一动不动，
    //    按钮名不副实。这两个接口把真账交出去。

    /** 各目录字节数：{"apk":…,"cache":…,"webview":…,"data":…,"free":…}。 */
    @JavascriptInterface
    public String storageInfo() {
        try {
            return Store.info(web.getContext());
        } catch (Throwable t) {
            return "{}";
        }
    }

    /**
     * 清 WebView 在磁盘上的资源缓存（HTTP Cache / Code Cache）。
     *
     * 不清 cookie、不清 localStorage —— 课表和登录态都在那儿，
     * 清缓存不该逼人重新绑定。删完只是下次打开学校页面要重新下资源。
     *
     * 走 `web.post`：`clearCache` 必须在 UI 线程，而 JS 接口跑在
     * WebView 的 JavaBridge 线程上，直接调在部分机型上会抛
     * 「A WebView method was called on thread 'JavaBridge'」。
     */
    @JavascriptInterface
    public void clearWebCache() {
        final WebView v = web;
        if (v == null) return;
        v.post(new Runnable() {
            @Override
            public void run() {
                try {
                    v.clearCache(true);
                } catch (Throwable t) {
                    // 清不掉就算了：这不是功能，失败不该弹任何东西
                }
            }
        });
    }

    // ---- 慧生活798（宿舍接水）----
    // 🔴 这一段是 0.24.0 发布后补的。0.23.0 里 `CredStore` 早就写好了
    //    saveWater / loadWater / clearWater / waterState，但**这里漏了转发** ——
    //    于是 JS 调 `Android.saveWater(...)` 拿到 undefined，登录成功后报
    //    「token 存不进本机（none）」，关掉 App 就得重登。
    //    界面判据没抓到，因为假桥是**按 JS 的期望写的**：JS 调什么它实现什么。
    //    ⇒ 现在有 check_bridge_methods.py 拿两边的方法名对账（红线 50b）。
    //
    //    存的是整段 JSON（token / 手机号 / 设备列表 / 上次同步时间），
    //    加密方式复用 CredStore 的 savePlain —— 和 cookie 同一套，不另抄一份。

    /** 空串 = 存好了，其余是原因（界面应原样显示具体原因）。 */
    @JavascriptInterface
    public String saveWater(String json) {
        return CredStore.saveWater(json);
    }

    /** 取回 JSON。解不开返回空串（当作没登录），不把异常抛给 JS。 */
    @JavascriptInterface
    public String loadWater() {
        return CredStore.loadWater();
    }

    /** "none" / "ok" / "broken"，用来区分「没登录」和「存着但解不开」。 */
    @JavascriptInterface
    public String waterState() {
        return CredStore.waterState();
    }

    @JavascriptInterface
    public void clearWater() {
        CredStore.clearWater();
    }

    // ---- 学习通（作业待办）----
    // 只有三件事在 Java 层：AES 加密、cookie 导出/还原、cookie 加密存盘。
    // 登录流程、课程/作业解析全在 native.js 里（有 DOMParser，比手写解析稳）。

    /**
     * 学习通登录用的 AES。失败返回空串。
     *
     * 🔴 返回空串必须由调用方当成「登录失败」处理，**不许**拿明文密码顶上去 ——
     *    学习通只认密文，发明文等于拿错的密码去撞，撞多了会触发风控。
     */
    @JavascriptInterface
    public String cxAes(String pwd) {
        try {
            return CxNet.aesB64(pwd == null ? "" : pwd);
        } catch (Throwable t) {
            return "";
        }
    }

    /** 罐子里所有 cookie 导成 JSON（App 退出前存下来，下次不用重登）。 */
    @JavascriptInterface
    public String cxDumpCookies() {
        return CxNet.dumpCookies();
    }

    /** 把 JSON 还原进罐子，返回还原条数。 */
    @JavascriptInterface
    public int cxLoadCookies(String json) {
        return CxNet.loadCookies(json);
    }

    /** 罐子里有没有登录态（看 `.chaoxing.com` 域的 UID）。 */
    @JavascriptInterface
    public boolean cxHasLogin() {
        return CxNet.hasLogin();
    }

    /** 加密存 cookie。空串 = 存好了，"soft" = 走备用方式，其余是失败原因。 */
    @JavascriptInterface
    public String cxSave(String cookiesJson) {
        return CredStore.saveCx(cookiesJson);
    }

    @JavascriptInterface
    public String cxLoad() {
        return CredStore.loadCx();
    }

    @JavascriptInterface
    public void cxClear() {
        CredStore.clearCx();
    }

    /** "none" / "ok" / "broken"。 */
    @JavascriptInterface
    public String cxState() {
        return CredStore.cxState();
    }

    /** 学习通账号密码（加密存本机）。返回值同 savePortalCred：'' / 'soft' / 'fail: 原因'。 */
    @JavascriptInterface
    public String saveCxPwd(String user, String pass) {
        return CredStore.saveCxPwd(user, pass);
    }

    /** 取回学习通账号密码，形如 {"u":"...","p":"..."}；没有或解不开返回空串。 */
    @JavascriptInterface
    public String loadCxPwd() {
        return CredStore.loadCxPwd();
    }

    @JavascriptInterface
    public String cxPwdState() {
        return CredStore.cxPwdState();
    }

    @JavascriptInterface
    public void clearCxPwd() {
        CredStore.clearCxPwd();
    }

    /**
     * 只清学习通那几个域在 **java.net 罐子**里的 cookie。返回清掉的条数。
     *
     * 🔴 不能用 clearCookiesFor：那个一旦清到东西，会把 **WebView 的罐子整个清掉**
     *    （它注释里写明了，是为「断开门户」服务的）。而学习通的请求全走 req2，
     *    用的是 java.net 那个罐子，压根不在 WebView 里。
     *    用它的话，「断开学习通」会顺手把门户的 CASTGC 也清掉 ——
     *    用户只是不想用学习通了，结果办事入口又要重新登录一次。
     */
    @JavascriptInterface
    public int cxClearCookies() {
        try {
            java.net.CookieHandler h = java.net.CookieHandler.getDefault();
            if (!(h instanceof java.net.CookieManager)) return 0;
            java.net.CookieStore store = ((java.net.CookieManager) h).getCookieStore();
            int n = 0;
            // 先复制一份：边遍历边 remove 会抛 ConcurrentModificationException
            for (java.net.URI u
                    : new java.util.ArrayList<java.net.URI>(store.getURIs())) {
                for (java.net.HttpCookie ck
                        : new java.util.ArrayList<java.net.HttpCookie>(store.get(u))) {
                    String dom = ck.getDomain();
                    // endsWith 就够了：`.chaoxing.com` / `passport2.chaoxing.com`
                    // / `mooc1.chaoxing.com` 全都命中
                    if (dom != null && dom.endsWith("chaoxing.com")) {
                        store.remove(u, ck);
                        n++;
                    }
                }
            }
            return n;
        } catch (Throwable t) {
            return 0;
        }
    }

    /**
     * 清掉教务系统的会话 cookie（不动本机存的账号密码）。
     *
     * 为什么需要它：会话还有效的时候去访问登录页，学校服务器会 302 到首页，
     * 返回的 HTML 里**没有加盐值** —— 于是「已经登录过的用户再点刷新」会撞上
     * 「没拿到加盐值」。要重新登录必须先把这个会话丢掉，否则拿不到真正的登录页。
     *
     * 直接操作全局 CookieManager（MainActivity 里 setDefault 的那个），
     * 不用 android.webkit.CookieManager —— 那一个是 WebView 的，跟
     * HttpURLConnection 用的不是同一个罐子。
     */
    @JavascriptInterface
    public boolean clearCookies() {
        try {
            java.net.CookieHandler h = java.net.CookieHandler.getDefault();
            if (h instanceof java.net.CookieManager) {
                ((java.net.CookieManager) h).getCookieStore().removeAll();
                return true;
            }
            return false;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * 读某个域下某个 cookie 的值。读不到返回空串。
     *
     * 为什么需要：智慧门户的 JWT（`Authorization`）是服务器用 **Set-Cookie**
     * 下发的，不是放在跳转 URL 的 query 里 —— 所以 JS 那边拿不到，只能由
     * 原生这边从全局 CookieStore 里取。取到之后当**请求头**发给网关
     * （只带 cookie 会 401）。
     *
     * 直接操作全局 CookieManager（MainActivity 里 setDefault 的那个），
     * 理由同 clearCookies()：WebView 的 CookieManager 是另一个罐子。
     */
    @JavascriptInterface
    public String cookie(String url, String name) {
        if (url == null || name == null) return "";
        try {
            java.net.CookieHandler h = java.net.CookieHandler.getDefault();
            if (!(h instanceof java.net.CookieManager)) return "";
            java.util.List<java.net.HttpCookie> list =
                    ((java.net.CookieManager) h).getCookieStore()
                            .get(new java.net.URI(url));
            for (java.net.HttpCookie ck : list) {
                if (name.equals(ck.getName())) {
                    String v = ck.getValue();
                    return v == null ? "" : v;
                }
            }
        } catch (Throwable ignored) {
            // 读不到就当没有：调用方会把它当成「没登录」处理
        }
        return "";
    }

    /**
     * 读 **WebView 罐子**里某个域下某个 cookie 的值。读不到返回空串。
     *
     * ================================================================
     * 为什么必须单独有这么一个方法（2026-10-28 用户报「点校园页功能还要重登」）
     * ================================================================
     * 上面那个 `cookie()` 读的是 `java.net.CookieHandler` —— 那是
     * **HttpURLConnection 的罐子**。WebView 用的是另一个罐子
     * （`android.webkit.CookieManager`），两边**互不相通**。
     *
     * 于是出现一个很隐蔽的死结：
     *   用户在 App 内打开的网页里登录智慧门户（还勾了「7 天免登录」），
     *   CASTGC 落进的是 **WebView 罐**；而 `pfTgt()` 去 Java 罐里找，
     *   永远读到空 ⇒ 判定「本机没有门户凭据」⇒ 不换票 ⇒ 裸开 ⇒ 又落回
     *   CAS 登录页。用户看到的就是「明明登录过了，点功能还要再登一次」。
     *
     * 更坏的一种：WebView 罐里其实有 CASTGC，裸开时 CAS 认出来、发了票，
     * 但 service 串对不上 ⇒ 系统校验失败 ⇒ 再跳 CAS ⇒ 再发票……
     * 这个重定向环会**疯狂跑流量**，而页面一直白着 —— 用户报的第二个问题。
     *
     * 拿到这张 CASTGC 就能走 `POST /v1/tickets/{TGT}` 换票，那条路不经过
     * 任何罐子，两个罐子的分裂就不再是问题。
     */
    @JavascriptInterface
    public String webCookie(String url, String name) {
        if (url == null || url.isEmpty() || name == null || name.isEmpty()) return "";
        // getCookie 返回的是 "a=1; b=2; c=3" 这一整串，不是单条，要自己拆。
        // ⚠️ 值里可能出现 '='（base64 常见），所以只按**第一个** '=' 切。
        String all = webCookiesOnMain(url);
        if (all == null || all.isEmpty()) return "";
        for (String part : all.split(";")) {
            String s = part.trim();
            int eq = s.indexOf('=');
            if (eq <= 0) continue;
            if (name.equals(s.substring(0, eq).trim())) {
                return s.substring(eq + 1).trim();
            }
        }
        return "";
    }

    /**
     * 取 WebView 罐里**所有名字以 `prefix` 开头**的 cookie 值，一行一个。
     *
     * 🔴 为什么不继续用上面那个精确匹配的：CAS 的票 cookie 名字是**服务端实现
     *    细节**。Apereo 原版叫 `CASTGC`，但学校这套 `lyuapServer` 完全可能叫
     *    `CASTGC_xxx`、`CASTGC2`，或者带个环境后缀。精确匹配一旦对不上就返回
     *    空串 —— 而空串的表现和「确实没登录」一模一样，看不出区别。
     *
     * 用换行分隔而不是逗号：cookie 值里可能有逗号（base64 常见）。
     */
    @JavascriptInterface
    public String webCookieLike(String url, String prefix) {
        if (url == null || url.isEmpty()) return "";
        if (prefix == null) prefix = "";
        String all = webCookiesOnMain(url);
        if (all == null || all.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (String part : all.split(";")) {
            String s = part.trim();
            int eq = s.indexOf('=');
            if (eq <= 0) continue;
            String k = s.substring(0, eq).trim();
            if (!k.startsWith(prefix)) continue;
            if (sb.length() > 0) sb.append('\n');
            sb.append(s.substring(eq + 1).trim());
        }
        return sb.toString();
    }

    /**
     * 取 WebView 罐里某个地址的**整串** cookie（`a=1; b=2` 原样返回）。
     *
     * 给中国大学 MOOC 用：它的 rpc 接口要一串 cookie 一起带，而且必须原样
     * 拼进 `Cookie` 请求头。按名字一条条取需要事先知道名字 —— 而 cookie 名
     * 是服务端实现细节（2026-11-04 实测：登录后写的是 `STUDY_SESS`，
     * 老文档说的 `NTES_SESS` 根本不存在）。名字猜错就静默拿到空串，
     * 表现成「明明登着却说没登录」。
     *
     * 直接拿整串就没有「猜名字」这一步，服务端加一条新 cookie 也不用改代码。
     */
    @JavascriptInterface
    public String webCookieAll(String url) {
        if (url == null || url.isEmpty()) return "";
        String all = webCookiesOnMain(url);
        return all == null ? "" : all;
    }

    /**
     * 在主线程上取 WebView 罐里某个地址的全部 cookie。
     *
     * 🔴 为什么不能在上面那个方法里直接调 `CookieManager.getCookie()`：
     *    CookieManager 的方法**只能在主线程调**，从别的线程调会抛
     *    IllegalStateException。而 `@JavascriptInterface` 跑在 WebView 的
     *    JavaBridge 线程上 —— **一定不是主线程**。
     *
     *    如果这里不调度、只靠外面 `catch (Throwable ignored)` 兜住，结果就是
     *    **永远读到空串**：页面照样落回登录页，日志里一个字都没有，看着跟
     *    「本机确实没凭据」一模一样。这种「静默失效」比直接崩还难查 ——
     *    2026-10-28 修这个问题时差点就这么埋进去。
     */
    private String webCookiesOnMain(final String url) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try {
                return CookieManager.getInstance().getCookie(url);
            } catch (Throwable t) {
                return "";
            }
        }
        final String[] box = new String[1];
        final CountDownLatch latch = new CountDownLatch(1);
        try {
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    try {
                        box[0] = CookieManager.getInstance().getCookie(url);
                    } catch (Throwable t) {
                        box[0] = "";
                    } finally {
                        latch.countDown();
                    }
                }
            });
            // 超时就当没读到：调用方会退回「没有凭据」那条路，并如实说明。
            // 不无限等 —— 主线程真卡住时等下去只会让界面更僵。
            latch.await(800, TimeUnit.MILLISECONDS);
        } catch (Throwable ignored) {
        }
        return box[0] == null ? "" : box[0];
    }

    /**
     * 只清掉某个域名下的 cookie（断开门户时用）。
     *
     * 不能用 clearCookies() 代替：那个会把教务系统的会话一起清掉，
     * 用户只是「不想看一卡通了」，结果课表也要重新登录一次，太粗暴。
     */
    @JavascriptInterface
    public boolean clearCookiesFor(String host) {
        if (host == null || host.isEmpty()) return false;
        try {
            java.net.CookieHandler h = java.net.CookieHandler.getDefault();
            if (!(h instanceof java.net.CookieManager)) return false;
            java.net.CookieStore store = ((java.net.CookieManager) h).getCookieStore();
            boolean any = false;
            // 先复制一份 URI 列表：边遍历边 remove 会抛 ConcurrentModificationException
            for (java.net.URI u : new java.util.ArrayList<java.net.URI>(store.getURIs())) {
                for (java.net.HttpCookie ck
                        : new java.util.ArrayList<java.net.HttpCookie>(store.get(u))) {
                    String dom = ck.getDomain();
                    if (dom != null && dom.endsWith(host)) {
                        store.remove(u, ck);
                        any = true;
                    }
                }
            }
            // 🔴 还要清 WebView 那个罐子，否则「断开门户」是假的：
            //    界面上显示「没连门户」，点办事入口却还是登录态 —— 因为
            //    WebActivity 用的 `android.webkit.CookieManager` 会落盘，
            //    跟我们清的这个不是同一个罐子。
            //    WebKit 没有「按域名删」的接口，只能整个清。这里可以接受：
            //    WebView 的罐子里只有学校站点的 cookie（主界面跑在 app.local，
            //    不用 cookie），不会误伤别的。
            if (any) {
                try {
                    android.webkit.CookieManager wc =
                            android.webkit.CookieManager.getInstance();
                    wc.removeAllCookies(null);
                    wc.flush();
                } catch (Throwable ignored) { }
            }
            return any;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * 在 App 内打开一个办事系统（带门户 cookie 的 WebView），见 WebActivity。
     *
     * 返回："" = 已经打开了；"fail: xxx" = 起不来。
     * JS 那边收到非空就退回系统浏览器 —— 办事入口是主功能之一，
     * 宁可多一次「要重新登录」，也不能点了没反应。
     *
     * 🔴 为什么不用 openUrl：那个交给**系统浏览器**，浏览器有它自己的
     *    cookie 罐子，门户的 CASTGC（身份证）不在里面，所以每次都要重登。
     *    要在 App 内开，才能把身份证倒进 WebView 的罐子里。
     */
    @JavascriptInterface
    public String openWeb(String url, String title) {
        // 老签名（0.6.0 起）：默认按「这个地址要登录」处理 —— 那时候只有办事入口走它。
        return openWebEx(url, title, true);
    }

    /**
     * 同 openWeb，多一个「要不要提示登录已过期」（0.17.3 起）。
     *
     * `warn = false` 用于**公开页**：公告正文（www / jwc / tuanwei 这些新闻站）、
     * 郑航百科（wiki.zua.fan）。这些页面没有 CASTGC 也照样能看，拿
     * 「门户登录已过期」去提示它们就是**假消息** —— 用户会以为看个公告还得
     * 重连门户，白跑一趟。
     *
     * 🔴 为什么新开一个方法而不是给 openWeb 加第三个参数：老版本 APK 里
     *    `openWeb` 只有两个参数，JS 传三个会匹配不上而抛异常 —— 而
     *    `NativeApi.openWeb` 的调用方会把异常当成「窗口起不来」，
     *    于是静默退回浏览器，**在旧机上表现为「怎么又跳浏览器了」**。
     */
    @JavascriptInterface
    public String openWebEx(String url, String title, boolean warn) {
        if (url == null) return "fail: 没有地址";
        String u = url.trim();
        if (!allowedRequestUrl(u)) return "fail: 东油适配中";
        try {
            Intent it = new Intent(web.getContext(), WebActivity.class);
            it.putExtra(WebActivity.EXTRA_URL, u);
            it.putExtra(WebActivity.EXTRA_TITLE, title == null ? "" : title);
            it.putExtra(WebActivity.EXTRA_WARN, warn);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            web.getContext().startActivity(it);
            return "";
        } catch (Throwable t) {
            return "fail: " + t;
        }
    }

    // ---------------------------------------------------------------- 外部链接

    /**
     * 把一场考试放进系统日历：拉起日历 App 的「新建事件」界面，内容都填好。
     *
     * 🔴 为什么不自己往日历数据库里写（CalendarContract.Events.insert）：
     *    那要 WRITE_CALENDAR 运行时权限，还得让用户先选「写到哪个日历账户」，
     *    而且写进去就绕过了用户确认 —— 万一我们算错了时间，用户根本不知道
     *    日程是哪来的。用 ACTION_INSERT 是**把内容递给日历 App**，
     *    用户看一眼、点保存才真的写进去。少一个权限，也多一道人工确认。
     *
     * 参数 beginMs/endMs 是 JS 算好的毫秒时间戳（本地时区），
     * allDay 为 true 时按全天事件处理（日历只认日期）。
     *
     * 返回："" = 成功拉起；"fail: xxx" = 打不开（比如没装日历）。
     */
    @JavascriptInterface
    public String addCalendar(String title, String desc, String loc,
                              long beginMs, long endMs, boolean allDay) {
        if (beginMs <= 0) return "fail: 没有开始时间";
        if (endMs <= beginMs) endMs = beginMs + 2 * 60 * 60 * 1000L;
        try {
            Intent it = new Intent(Intent.ACTION_INSERT);
            it.setData(CalendarContract.Events.CONTENT_URI);
            it.putExtra(CalendarContract.Events.TITLE, title == null ? "" : title);
            if (desc != null && !desc.isEmpty()) {
                it.putExtra(CalendarContract.Events.DESCRIPTION, desc);
            }
            if (loc != null && !loc.isEmpty()) {
                it.putExtra(CalendarContract.Events.EVENT_LOCATION, loc);
            }
            it.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMs);
            it.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs);
            if (allDay) it.putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            web.getContext().startActivity(it);
            return "";
        } catch (Throwable t) {
            // 没装日历 App（国产 ROM 也可能把它藏起来）⇒ 让界面说清楚，别静默失败
            return "fail: " + t;
        }
    }

    /**
     * 把一段文本存成 `.ics`，然后拉起系统的「分享到」，让用户挑日历 App 导入。
     *
     * 为什么不是「一条条加进日历」（见 {@link #addCalendar}）：那是给**单场考试**
     * 用的，一次弹一个确认框才合理。整学期课表是几百个事件，一条条弹等于让
     * 用户把课表手抄一遍。这里一次成文、一次导入。
     *
     * 🔴 为什么不能像网页那样 `<a download>`：APK 的 WebView 没有
     *    DownloadListener，`blob:` 链接点了**什么都不发生** —— 按钮看着像坏了。
     *
     * 🔴 分享走 `ACTION_SEND` 而不是写进日历数据库：写数据库要 WRITE_CALENDAR
     *    运行时权限，还得让用户选日历账户；递文件给日历 App，导入哪本、要不要
     *    导入都由用户自己决定。
     *
     * 返回："" = 已拉起分享；"fail: xxx" = 失败（界面上如实说）。
     */
    @JavascriptInterface
    public String shareFile(String name, String text, String mime) {
        if (text == null || text.isEmpty()) return "fail: 没有内容";
        // 一份课表几百个事件约 200KB，留到 4MB 已经很宽松。
        // 卡这个上限是防「界面算错了、把几兆字符串递进来」，不是防正常使用。
        if (text.length() > 4 * 1024 * 1024) return "fail: 内容太大";
        String n = (name == null ? "" : name.trim());
        if (!n.endsWith(".ics")) n = n + ".ics";
        // 和 ShareProvider 的白名单保持一致：那边放不行的名字，这里就别写了，
        // 否则文件落地了却分享不出去（用户看到的是「分享失败」）。
        if (!n.matches("[\\w.\\-\\u4e00-\\u9fa5]{1,80}")) return "fail: 文件名不合适";
        try {
            Context ctx = web.getContext();
            File f = new File(ShareProvider.dir(ctx), n);
            OutputStream os = new FileOutputStream(f);
            try {
                os.write(text.getBytes(StandardCharsets.UTF_8));
            } finally {
                os.close();
            }
            Uri u = ShareProvider.uriFor(n);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(MIME_ICS);
            send.putExtra(Intent.EXTRA_SUBJECT, n);
            send.putExtra(Intent.EXTRA_STREAM, u);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // 用 chooser 而不是直接 startActivity：有的 ROM 没给 .ics 设默认应用，
            // 直接发会抛 ActivityNotFoundException；给个选择框，用户自己挑。
            Intent it = Intent.createChooser(send, "导入课表");
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // 🔴 读权限必须加在 **chooser** 上，只加在里面那个 send 上时，
            //    部分系统版本不会把授权传给被选中的 App —— 对方打开就是空文件。
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ctx.startActivity(it);
            return "";
        } catch (Throwable t) {
            return "fail: " + t;
        }
    }

    /**
     * 允许拉起的其它 App。**必须是白名单**。
     *
     * 🔴 不能「传什么包名就开什么」：那样一段被改过的网页就能让 App 去拉起
     *    任意应用（系统设置、安装器、带 intent: 的深链），等于在桥里焊了个后门。
     *    这份名单和 AndroidManifest 的 &lt;queries&gt; 是同一份，加包名**两边一起改** ——
     *    只改一边的表现是「明明装了却说没装」或「点了没反应」，都不报错。
     */
    private static final String[] ALLOWED_APPS = {
            "com.cloudora.android",
            "com.water.widget"
    };

    private static boolean allowedApp(String pkg) {
        if (pkg == null) return false;
        for (String p : ALLOWED_APPS) {
            if (p.equals(pkg)) return true;
        }
        return false;
    }

    /**
     * 这个 App 装了没有。返回 "1" / "0"。
     *
     * 🔴 返回字符串、不返回 boolean：JS 那边要能分清「没装」和「这个壳根本没有
     *    这个接口」（老 APK / 网页版）。返回 boolean 的话两种都是 undefined，
     *    调用方只能猜，而猜错的代价是「装了却让人去下载」。
     */
    @JavascriptInterface
    public String hasApp(final String pkg) {
        if (!allowedApp(pkg)) return "0";
        try {
            Intent it = web.getContext().getPackageManager()
                    .getLaunchIntentForPackage(pkg);
            return it == null ? "0" : "1";
        } catch (Throwable t) {
            return "0";
        }
    }

    /**
     * 拉起另一个 App。返回 "ok" / "deny" / "notinstalled" / "fail: …"。
     *
     * 为什么不开一个新的 Activity 中转：切过去之后我们这边就退到后台了，
     * 用 FLAG_ACTIVITY_NEW_TASK 直接起对方的启动页，返回键自然回到我们这里。
     */
    @JavascriptInterface
    public String openApp(final String pkg) {
        if (!allowedApp(pkg)) return "deny";
        try {
            Intent it = web.getContext().getPackageManager()
                    .getLaunchIntentForPackage(pkg);
            if (it == null) return "notinstalled";
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            web.getContext().startActivity(it);
            return "ok";
        } catch (Throwable t) {
            return "fail: " + t;
        }
    }

    /** Open the verified NEPU portal in the system browser without sharing WebView cookies. */
    @JavascriptInterface
    public String openPortal() {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://portal.nepu.edu.cn/#/index4"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            web.getContext().startActivity(intent);
            return "ok";
        } catch (Throwable t) {
            return "fail";
        }
    }

    // ------------------------------------------------------------ 权限自检

    /**
     * 「这台手机上，东油通要的几样东西开了没有」。2026-11-15 加。
     *
     * 用户 2026-11-15：「在我的界面加一个能看东油通需要的权限是否都打开的界面，
     * 方便查看」。他要的不是一个申请权限的向导 —— 权限早就申请过了，
     * 问题在于**有的机型装完就被省电策略关掉**，而 App 里没有任何地方能看出来。
     *
     * 返回 JSON（值一律是布尔，查不出来就是 false，不编造「大概开了」）：
     *   notify   通知权限（24 起可以问）
     *   alarm    精确闹钟（31 起才有这个开关；更老的系统恒 true）
     *   battery  已加入「不受省电限制」白名单（我们在里面 = true）
     *   job      后台任务真的排上了（JobScheduler 里还有我们的一单）
     *
     * 🔴 `job` 单独一项是因为它和上面三条**不是一回事**：权限全开、开关没开，
     *    后台照样一次不跑。这一项直接问系统，比看我们的配置文件可信。
     * 🔴 自启动查不到（没有公开 API，厂商各写各的），这一项由 JS 侧
     *    按机型给一句提示 + 一个按钮，不在这里编一个真假。
     */
    @JavascriptInterface
    public String permState() {
        JSONObject o = new JSONObject();
        Context c = web.getContext();
        try {
            boolean notify = true;
            try {
                NotificationManager nm = (NotificationManager)
                        c.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null && Build.VERSION.SDK_INT >= 24) {
                    notify = nm.areNotificationsEnabled();
                }
            } catch (Throwable ignored) { }
            o.put("notify", notify);

            boolean alarm = true;
            boolean alarmKnown = false;
            if (Build.VERSION.SDK_INT >= 31) {
                alarmKnown = true;
                try {
                    AlarmManager am = (AlarmManager)
                            c.getSystemService(Context.ALARM_SERVICE);
                    alarm = am == null || am.canScheduleExactAlarms();
                } catch (Throwable t) {
                    alarm = false;
                }
            }
            o.put("alarm", alarm);
            o.put("alarmKnown", alarmKnown);

            boolean battery = false;
            try {
                PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
                battery = pm != null
                        && pm.isIgnoringBatteryOptimizations(c.getPackageName());
            } catch (Throwable ignored) { }
            o.put("battery", battery);

            boolean jobCx = false, jobWt = false;
            try {
                // 🔴 常量叫 JOB_SCHEDULER_SERVICE，不是 JOB_SERVICE —— 后者不存在，
                //    写错是**编译期**报错（这一版第一遍打包就卡在这儿）。
                //    getPendingJob 是 API 24 才有的，minSdk 是 23：低版本上
                //    走到这里会 NoSuchMethodError，它是 Error 不是 Exception，
                //    所以外面那层 catch 收的是 Throwable，而这里再加一道版本闸。
                JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
                if (js != null && Build.VERSION.SDK_INT >= 24) {
                    jobCx = js.getPendingJob(Auto.JOB_CX) != null
                            || js.getPendingJob(Auto.JOB_CX_NOW) != null;
                    jobWt = js.getPendingJob(Auto.JOB_WT) != null
                            || js.getPendingJob(Auto.JOB_WT_NOW) != null;
                }
            } catch (Throwable ignored) { }
            o.put("jobCx", jobCx);
            o.put("jobWt", jobWt);
            o.put("job", jobCx || jobWt);
        } catch (Throwable t) {
            // 一项都查不出来也不能让这一页炸掉：界面会显示「读不到」。
        }
        return o.toString();
    }

    /**
     * 把用户送到能改这一项的那一页。`what` = notify / alarm / battery / auto。
     *
     * 返回：'' = 跳过去了；其余 = 一句话（跳到系统设置首页也算成功，
     * 但要说清「到了之后点什么」—— 见 PowerJump 的注释）。
     *
     * 🔴 只跳转，**不替用户改**。没有任何公开 API 能关掉省电限制或打开自启动，
     *    偷偷绕过去的做法不能用在要上架的 App 里。
     */
    @JavascriptInterface
    public String permOpen(final String what) {
        Context c = web.getContext();
        String w = what == null ? "" : what.trim();
        try {
            if ("battery".equals(w) || "auto".equals(w)) {
                // 厂商那一页（按品牌挑），失败才退回应用信息页 —— 逻辑都在 PowerJump。
                return PowerJump.open(c);
            }
            if ("notify".equals(w)) {
                if (Build.VERSION.SDK_INT >= 26) {
                    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    c.startActivity(i);
                    return "";
                }
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + c.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(i);
                return "找到「通知」打开它";
            }
            if ("alarm".equals(w)) {
                if (Build.VERSION.SDK_INT >= 31) {
                    Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                            .setData(Uri.parse("package:" + c.getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    c.startActivity(i);
                    return "";
                }
                return "这个系统不需要单独开";
            }
        } catch (Throwable t) {
            return "打不开系统设置，可以在手机设置里找「应用 → 东油通」";
        }
        return "没有这一项";
    }
}
