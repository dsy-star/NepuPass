package com.nepu.dongyoutong;

import android.annotation.SuppressLint;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.app.Activity;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * 东油通 · 唯一的一个界面。
 *
 * 界面本身是 WebView 里那套 HTML/CSS/JS（和网页版同一份代码），
 * 原生这边只干三件网页干不了的事：
 *   1. 用 https://app.local/ 把 assets 里的页面当「同源网页」发出去；
 *      直接从 file:// 加载的话，localStorage 在部分 WebView 版本上不可靠，
 *      而课表/成绩缓存全靠它。
 *   2. 提供 Android.req()：真正的 HTTP 请求（带 cookie），见 NativeBridge。
 *   3. 提供 Keystore 加密的凭据存取，见 CredStore。
 */
public class MainActivity extends Activity {

    /**
     * UA 尾巴，两个 WebView 共用（这个窗口 + 办事入口那个 WebActivity）。
     *
     * build_apk.py 校验 DongYouTong/ 版本标识与网页版本一致。
     *    改版本号时这里必须同步更新。
     */
    public static final String UA_TAG = " DongYouTong/0.1.6";

    private WebView web;
    private ThemeBridge themeBridge;

    /**
     * 界面现在是不是开着（0.50.0 v5）。
     *
     * 后台检查要用它：用户正盯着屏幕的时候，页面自己会查，后台那一路就该跳过，
     * 否则同一个请求发两遍，还会弹出「有新的」——而他眼前就写着那几条。
     *
     * 用 onResume/onPause 而不是 onCreate/onDestroy：按了 Home 还留在最近任务里，
     * Activity 没销毁但也不在眼前，那时候算「没开」。
     */
    static boolean alive = false;

    /** 网页发来的那次相机请求，正等着系统权限弹窗的结果。同一时间只可能有一条。 */
    private PermissionRequest camReq;
    private static final int REQ_CAMERA = 61;

    /** 碰一碰的读卡 / 写卡（0.52.0 v7）。切后台要收工，所以留一个引用。 */
    private WaterNfc nfc;

    /**
     * 通知点进来要落在哪一页（0.47.8）。
     *
     * 「快上课了」应该直接到课表，「作业快截止」应该到学习页 —— 点开还要自己
     * 找一遍入口，等于这条提醒只做了一半。取值是 app.js 里的页面名
     * （schedule / exams / me …），在这里会被过滤成纯小写字母。
     */
    public static final String EXTRA_PAGE = "hyt_page";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        // 先把能确定是垃圾的清掉（旧安装包、残留的半截文件、cache 目录）。
        // 🔴 必须在下面 `new WebView` **之前** —— 运行中的 WebView 被抽掉缓存
        //    目录可能读到半截文件；启动时它还没起来，随便删。
        Store.sweep(this);

        // Cookie 由 HttpURLConnection 全局共享一份 —— 登录拿到的 JSESSIONID
        // 后续每个请求都要带上，否则教务系统一律当没登录。
        java.net.CookieManager cm = new java.net.CookieManager(null, java.net.CookiePolicy.ACCEPT_ALL);
        java.net.CookieHandler.setDefault(cm);

        themeMode = getPreferences(MODE_PRIVATE).getString("theme", "system");
        web = new WebView(this);
        web.setBackgroundColor(bgColor());
        // 2026-11-01：只有**调试包**才开 WebView 远程调试。
        // 真机上要量「每页到底超一屏多少」只能靠这个（WebView 里跑 JS 读
        // scrollHeight），模拟器视口是 390×844、真机是 360×792，差出来的
        // 30dp 宽度正好是一整个折行 —— 这就是之前「测试全绿、真机要滑」的原因。
        // 正式包 FLAG_DEBUGGABLE 为 0，这一句不执行，别人连不上你的 WebView。
        if ((getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);      // localStorage：课表/成绩/设置都存这儿
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(false);       // 页面自己做了响应式，别再缩放
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + UA_TAG);

        // 页面全在 assets 里，用不着访问手机上的文件。
        // 关掉能减少「万一页面被注入，借 file:// 读本地文件」这条路。
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // 别让 WebView 存表单/密码（凭据自己用 Keystore 管，不走这里）
        s.setSaveFormData(false);

        themeBridge = new ThemeBridge();
        web.addJavascriptInterface(themeBridge, "AndroidTheme");
        web.addJavascriptInterface(new NativeBridge(web), "Android");
        web.addJavascriptInterface(new NepuBridge(this, web), "AndroidNepu");
        // 提醒和小组件又一个对象（0.47.8）：它要拿 Activity 才能向系统要权限，
        // 而 NativeBridge 只持有一个 WebView。分开放也方便单独判它的方法名。
        web.addJavascriptInterface(new Reminder(this), "AndroidRemind");
        // 后台自动检查（0.50.0 v5）：排闹钟、报真实状态的那一面。
        web.addJavascriptInterface(new AutoBridge(this), "AndroidAuto");
        // 碰一碰（0.52.0 v7）：读一张卡、写一张卡。单独一个对象，
        // 因为它要拿 Activity（读卡模式挂在窗口上），而 NativeBridge 只有 WebView。
        nfc = new WaterNfc(this, web);
        web.addJavascriptInterface(nfc, "AndroidNfc");
        // 应用内下载更新（2026-11-24）：自己收流、算 SHA-256、拉起系统安装器。
        // 单独一个对象：它要拿 Activity 才能 startActivity 弹安装器，
        // 而 NativeBridge 只持有一个 WebView。网页版没有这个对象，
        // 前端（web/native.js 的 UpdApi）每个方法调用前都会现查。
        web.addJavascriptInterface(new UpdateDownloader(this), "AndroidUpdate");
        // 渠道先建好：第一次发通知时才建的话，头一条有可能被系统吞掉
        // （渠道创建是异步生效的）。这里建不会打扰用户，也没有权限要求。
        Notify.ensureChannels(this);
        // 后台任务的「下一次」在任务开头就排好了（见 Auto 的类注释）。
        // 但被「强行停止」过、或者换机恢复备份之后，系统把排着的任务清掉了 ——
        // 那时链条就断了，而且界面上开关还亮着。这里只在**发现真的没排上**时补一个，
        // 不会每次开 App 都把计时器清零（那等于永远等不到那一次检查）。
        Auto.ensure(this);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                String host = req.getUrl().getHost();
                if (!"app.local".equals(host)) return null;
                String path = req.getUrl().getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                try {
                    InputStream in = getAssets().open("web" + path);
                    return new WebResourceResponse(mimeOf(path), charsetOf(path), in);
                } catch (IOException e) {
                    // 缺文件就回 404，别让 WebView 去真网络上找 app.local（会挂很久）
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            null, new ByteArrayInputStream(("404 " + path).getBytes()));
                }
            }

            /**
             * 页面只该待在 app.local 里。任何往外跳的链接一律拦下。
             *
             * 不拦的后果：点到一个外链，WebView 会真的去加载那个网站，
             * 页面 origin 就从 app.local 变成别人的站 —— 虽然 localStorage
             * 按 origin 隔离读不到课表，但一个「点一下就跑到陌生网站」的
             * App 会让人怀疑它到底在干什么。这条链路本来就不该有外部导航。
             */
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                String host = req.getUrl().getHost();
                return !"app.local".equals(host);
            }
        });

        applyCameraBridge();
        applySystemBars();
        // 缓存攒到 24 MB 才清一次（不清 cookie / localStorage，不会掉登录）。
        // 放在 loadUrl 之前：清完直接开始加载，用户看不到中间态。
        Store.trimWebViewCache(this, web);
        // 通知点进来的那一页拼在 URL 上，**不能**等加载完再 evaluateJavascript：
        // 页面什么时候加载完不由我们决定，早一步 evaluate 就直接丢了，
        // 表现是「点了通知只打开了 App，还停在首页」。
        String page = pageOf(getIntent());
        // 碰一碰（0.52.0 v7）：贴纸里的设备编号也从 URL 带进去。
        // 走 URL 而不是 load 完再调函数，理由同上 —— 冷启动时页面还没起来。
        String did = didOf(getIntent());
        // 碰一碰（0.52.0 v10）：这个编号是**碰卡**碰来的，还是别人递进来的一条链接。
        // 两者要做的事不一样 —— 见 fromTag 的说明。
        boolean fromTag = fromTag(getIntent());
        StringBuilder url = new StringBuilder("https://app.local/index.html");
        boolean hasQ = false;
        if (!page.isEmpty()) {
            url.append("?p=").append(page);
            hasQ = true;
        }
        if (!did.isEmpty()) {
            url.append(hasQ ? "&" : "?").append("did=").append(Uri.encode(did));
            hasQ = true;
            if (fromTag) url.append("&nfc=1");
        }
        web.loadUrl(url.toString());
    }

    /**
     * 应用已经开着的时候又点了一条通知。
     *
     * `launchMode="singleTop"` 让系统复用现有实例（走这里）而不是再开一个窗口，
     * 所以 URL 不会重新加载 —— 只能直接叫页面跳过去。
     *
     * 🔴 `window.__hytPage` 由 app.js 提供；页面要是还没加载完就调，它还不存在，
     *    这里得判空（`&&`），不能硬调。
     */
    @Override
    protected void onNewIntent(Intent it) {
        super.onNewIntent(it);
        setIntent(it);
        // 碰一碰：应用已经开着的时候又贴了一下那张贴纸。
        // 这时页面不会重新加载，只能直接叫它接水 —— 和通知那条路同一个理由。
        String did = didOf(it);
        if (web != null && !did.isEmpty()) {
            try {
                // 第二个参数 = 这条是不是真的碰卡碰来的。false 的时候页面先问一句
                // 「在这儿接水？」，不直接开阀（理由见 fromTag）。
                web.evaluateJavascript(
                        "window.__hytWater&&window.__hytWater('" + did + "',"
                                + (fromTag(it) ? "true" : "false") + ")", null);
            } catch (Throwable ignored) {
                // 页面正在重建：最坏就是停在首页，不该崩。
            }
            return;
        }
        String page = pageOf(it);
        if (page.isEmpty() || web == null) return;
        try {
            web.evaluateJavascript(
                    "window.__hytPage&&window.__hytPage('" + page + "')", null);
        } catch (Throwable ignored) {
            // 页面正在重建 / WebView 已销毁：最坏就是停在首页，不该崩。
        }
    }

    /**
     * 从启动意图里取出页面名。**只留小写字母** —— 这个值会被拼进 URL 和
     * JavaScript 字符串，来自 Intent 的东西一律不可信（别的应用也能发 Intent）。
     */
    private static String pageOf(Intent it) {
        if (it == null) return "";
        String p = it.getStringExtra(EXTRA_PAGE);
        if (p == null) return "";
        p = p.replaceAll("[^a-z]", "");
        return p.length() > 20 ? p.substring(0, 20) : p;
    }

    /**
     * 从「碰一碰」的地址里取设备编号：hyt://water/&lt;编号&gt;。
     *
     * 🔴 只认我们自己的 scheme + host，别的（http、ilife、支付宝那几种）
     *    一律返回空串 —— 那几张卡不是我们的，接过来只会挡别人的路。
     * 🔴 值会被拼进 JavaScript 字符串，所以在这里就把字符集卡死：
     *    只留 [A-Za-z0-9_.:-]，长度 ≤64。设备编号本来就是数字串，
     *    放宽一个字符，就等于给外部 Intent 开了一个注入点。
     */
    private static String didOf(Intent it) {
        if (it == null) return "";
        Uri u = it.getData();
        if (u == null) return "";
        if (!"hyt".equalsIgnoreCase(u.getScheme())) return "";
        if (!"water".equalsIgnoreCase(u.getHost())) return "";
        String d = u.getQueryParameter("did");
        if (d == null || d.length() == 0) d = u.getLastPathSegment();
        if (d == null) return "";
        d = d.replaceAll("[^A-Za-z0-9_.:-]", "");
        return d.length() > 64 ? d.substring(0, 64) : d;
    }

    /**
     * 这条 hyt://water 是不是**真的碰卡**碰来的。
     *
     * 🔴 为什么必须分清（0.52.0 v10）：
     *    `hyt://water/<设备号>` 这个入口是 exported 的 —— 任何应用都能
     *    `startActivity(new Intent(VIEW, Uri.parse("hyt://water/123")))`，
     *    网页里一句 `location.href = 'hyt://water/123'` 也能把我们叫起来。
     *    如果不管来源就开阀，等于给所有人一个「用你的账号、你的钱接水」的按钮：
     *    发个链接让人点一下就出水，人还不在机器边上。
     *    NFC 那一趟系统会塞 `EXTRA_TAG`（真实标签对象），伪造不出来 ——
     *    别的应用拿不到 `Tag`，只能拼一个 Uri。所以「带 Tag」才自动出水，
     *    不带的一律先问一句。
     */
    private static boolean fromTag(Intent it) {
        if (it == null) return false;
        try {
            return it.hasExtra(android.nfc.NfcAdapter.EXTRA_TAG);
        } catch (Throwable t) {
            // 没有 NFC 硬件 / 老系统：一律当成「不是碰卡」，走确认那一档。
            return false;
        }
    }

    /**
     * 网页要用相机（扫码加饮水机，0.31.0）。
     *
     * 🔴 WebView **不会**自己申请系统权限：网页里的 getUserMedia 先落到
     *    onPermissionRequest，只有 App 已经持有 CAMERA 才能 grant。
     *    不给这个 WebChromeClient 的话 WebView 一律直接拒绝，网页那边只看到
     *    NotAllowedError —— 表现是「点扫码永远是黑的」，而且**不报任何错**。
     * 🔴 只放行视频采集这一种。位置、麦克风、通知都不该因为这段代码被顺带许可。
     */
    private void applyCameraBridge() {
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);   // 预览流是静音的，别等点击
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                // 只在调试包里把网页报错打到 logcat，正式包不留这条通道。
                if (message.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR
                        && (getApplicationInfo().flags
                        & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                    android.util.Log.e("DongYouTong-WebView", message.message() + " @" +
                            message.sourceId() + ":" + message.lineNumber());
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        boolean video = false;
                        for (String r : request.getResources()) {
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) video = true;
                        }
                        if (!video) { request.deny(); return; }
                        if (checkSelfPermission(Manifest.permission.CAMERA)
                                == PackageManager.PERMISSION_GRANTED) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                            return;
                        }
                        // 一条没答完又来一条：旧的那条只能拒（它的浮层已经没了）
                        if (camReq != null) {
                            try { camReq.deny(); } catch (Exception e) { /* 已经失效 */ }
                        }
                        camReq = request;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                    }
                });
            }
        });
    }

    /** 系统权限弹窗的结果：允许就放行网页那条请求，拒绝就 deny。 */
    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code != REQ_CAMERA) return;
        PermissionRequest p = camReq;
        camReq = null;
        if (p == null) return;
        try {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) {
                p.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                p.deny();
            }
        } catch (Exception e) {
            // Activity 已经销毁 / 请求过期：让它去，网页那边会拿到错误自己说清楚
        }
    }

    /** 将网页主题同步到系统栏，跟随系统时使用设备夜间模式。 */
    private static final String SYS_BAR_TOP_LIGHT = "#f7f7f7";
    private static final String SYS_BAR_TOP_DARK = "#101010";
    private static final String SYS_BAR_BOTTOM_LIGHT = "#f7f7f7";
    private static final String SYS_BAR_BOTTOM_DARK = "#101010";
    private String themeMode = "system";

    private boolean isDarkTheme() {
        if ("dark".equals(themeMode)) return true;
        if ("light".equals(themeMode)) return false;
        return (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applySystemBars() {
        Window w = getWindow();
        boolean dark = isDarkTheme();
        if (Build.VERSION.SDK_INT >= 21) {
            w.setStatusBarColor(Color.parseColor(dark ? SYS_BAR_TOP_DARK : SYS_BAR_TOP_LIGHT));
            w.setNavigationBarColor(Color.parseColor(dark ? SYS_BAR_BOTTOM_DARK : SYS_BAR_BOTTOM_LIGHT));
        }
        if (Build.VERSION.SDK_INT >= 23) {
            // 「浅色状态栏」= 深色图标。系统 API 里名字是反的，容易搞混。
            View dv = w.getDecorView();
            int flags = dv.getSystemUiVisibility();
            if (dark) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            else flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            dv.setSystemUiVisibility(flags);
        }
    }

    private int bgColor() {
        boolean dark = isDarkTheme();
        // 冷启动和下拉回弹时露出的那层底：跟 --bg 同色，才不会有一下白闪。
        return Color.parseColor(dark ? SYS_BAR_BOTTOM_DARK : SYS_BAR_BOTTOM_LIGHT);
    }

    public final class ThemeBridge {
        @android.webkit.JavascriptInterface
        public void setTheme(final String mode) {
            if (!"system".equals(mode) && !"light".equals(mode) && !"dark".equals(mode)) return;
            runOnUiThread(() -> {
                themeMode = mode;
                getPreferences(MODE_PRIVATE).edit().putString("theme", mode).apply();
                applySystemBars();
                if (web != null) web.setBackgroundColor(bgColor());
            });
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json") || p.endsWith(".webmanifest")) return "application/json";
        return "application/octet-stream";
    }

    /** 文本类要给 charset，否则中文会变乱码（尤其 js/css）。 */
    private static String charsetOf(String path) {
        String m = mimeOf(path);
        if (m.startsWith("text/") || m.equals("application/javascript") || m.equals("application/json")) {
            return "utf-8";
        }
        return null;
    }

    @Override
    protected void onResume() {
        super.onResume();
        alive = true;
    }

    @Override
    protected void onPause() {
        alive = false;
        // 读卡模式开着时，**所有**标签都会被我们接走。人已经切走了还挂着，
        // 他下一次贴支付宝那一下就会被我们吞掉，而且他不知道为什么没反应。
        if (nfc != null) nfc.pause();
        super.onPause();
    }

    @Override
    public void onConfigurationChanged(Configuration cfg) {
        super.onConfigurationChanged(cfg);
        if ("system".equals(themeMode) && web != null) {
            web.evaluateJavascript("if(window.__onSystemThemeChanged)window.__onSystemThemeChanged()", null);
        }
        applySystemBars();
        web.setBackgroundColor(bgColor());
    }

    /**
     * 返回键先交给网页处理：关浮层 → 回课表 → 才真退出。
     *
     * 网页那边 window.appBack() 返回 true 表示「我处理了」。
     * 用 evaluateJavascript 拿返回值是异步的，所以这里只能同步等一下 ——
     * 但这是个纯 JS 表达式，几毫秒就回来了，不会卡。
     * targetSdk 33 且没开 enableOnBackInvokedCallback，onBackPressed 仍然有效。
     */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack && window.appBack()) ? '1' : '0'",
                new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String v) {
                        if (!"\"1\"".equals(v)) finish();
                    }
                });
    }
}
