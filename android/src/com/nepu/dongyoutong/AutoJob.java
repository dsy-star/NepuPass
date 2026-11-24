package com.nepu.dongyoutong;

import android.annotation.SuppressLint;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * 后台真正干活的那一段：起一个看不见的网页，跑完就收工。0.50.0 v5 加。
 *
 * ================================================================
 * 为什么是「起一个看不见的网页」而不是用 Java 重写一遍
 * ================================================================
 * 「查学习通」和「做积分任务」的代码全在 `native.js` / `app.js` 里：
 * 认 cookie、算签名、判断哪条任务还能做几次、连续两次失败就停……
 * 随便抄错一条，表现都是「后台跑出来的结果和界面上不一样」，而且不报错。
 * 所以后台点的是**同一份页面**（`index.html?bg=1`），只是不进正常启动流程
 * （见 app.js 末尾那段）。
 *
 * 代价是这几分钟要多占一份内存，跑完 WebView 销毁，平时一点都不占。
 *
 * ================================================================
 * 🔴 这个 WebView 不挂在任何窗口上
 * ================================================================
 * 不需要画，只需要 JS 和网络。不 attach 就不渲染，省电省内存；
 * 也因此不能做依赖布局的事（量元素宽高），后台这几个任务本来也不需要。
 *
 * ================================================================
 * 🔴 超时必须自己管
 * ================================================================
 * 网页卡住（网络半死不活）时没人会来叫停，这个任务就会一直占着 ——
 * 超过十分钟系统会直接杀掉进程，表现成「后台有时候跑一半就没了」。
 * 所以每个任务都配硬超时，到点无论如何都收工，并把「这次没跑完」记下来。
 */
public class AutoJob extends JobService {

    /** 查学习通要逐个班级扫，课多的账号 2~3 分钟很正常。
     *  🔴 2026-11-09 从 150 秒放到 300 秒：原来卡在这里，用户看到的是
     *     「上次没查成：这次没查完（等了太久）」，而学习通那边其实查得好好的。
     *  🔴 2026-11-16 又从 300 秒放到 480 秒：等待改为原生定时器之后
     *     （见 NativeBridge.wake）一轮全扫约 2 分钟，但课多的账号（40 门）
     *     加上被平台限速的那几分钟，300 秒仍然贴线。8 分钟在系统 10 分钟
     *     上限之内，留出了余量。
     *  JobScheduler 单次任务的上限是 10 分钟，8 分钟留足了余量。 */
    private static final long TIMEOUT_CX = 480_000L;
    /** 积分任务封顶 9 分钟：系统的任务时限大约就是这么久。
     *  跑不完不要紧 —— 每成功一次就落一笔，明天接着来。 */
    private static final long TIMEOUT_WT = 9 * 60_000L;

    private WebView web;
    private JobParameters params;
    private boolean cx = true;
    private boolean finished = false;
    /** 网页报回来的扫描进度（第几门 / 共几门）。超时那一句要拿它说话。 */
    private int progI = 0;
    private int progN = 0;
    private final Handler ui = new Handler(Looper.getMainLooper());

    /**
     * 每 1.2 秒**推一步**，再问一句「跑到哪一步了」。
     *
     * 🔴 为什么要 Java 来问，而不是让网页自己循环（2026-11-09）：
     *    这个 WebView 不挂在任何窗口上，Chromium 把它当「隐藏页面」，
     *    `setTimeout` 先被节流到 1 秒/次，隐藏久了变 1 分钟/次。
     *    原来网页里是「睡 1.5 秒 → 查一次」，结果 140 秒里只查了几次，
     *    扫描明明还活着却被判超时 —— 用户说的「后台经常没法成功检查」。
     *    `evaluateJavascript` 不走定时器，页面藏起来照样立刻执行。
     */
    /**
     * 每 1.2 秒**推一步**，再问一句「跑到哪一步了」。
     *
     * 🔴 这两件事必须一起做（2026-11-11 补）。
     *    原来这里只调 `bgState()`（纯查询），推进全靠网页自己那个
     *    `setInterval` —— 那个定时器在隐藏页面里被节流到 1 分钟一次，
     *    一轮扫描几十步就是几十分钟，必然撞 5 分钟上限。
     *    用户说的「后台学习通自动检查经常失败」就是这个。
     *    `evaluateJavascript` 不走定时器，页面藏起来照样立刻执行。
     *
     * 🔴 间隔从 2.5 秒收到 1.2 秒：一步一个请求，一百步原本要 250 秒，
     *    贴着 300 秒的超时线。收到 1.2 秒之后是 120 秒，留足余量。
     *    `bgStep()` 自己有 busy 锁，调密了也不会并发。
     */
    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (finished || web == null) return;
            try {
                web.evaluateJavascript(
                    "(function(){try{if(window.bgStep)window.bgStep();}catch(e){}" +
                    "return (window.bgState&&window.bgState())||'';})()",
                        new android.webkit.ValueCallback<String>() {
                            @Override
                            public void onReceiveValue(String value) {
                                if (finished) return;
                                String s = unquote(value);
                                if (s == null || s.isEmpty()) return;
                                try {
                                    JSONObject o = new JSONObject(s);
                                    // 进度：网页那边把「扫到第几门」一起交回来了
                                    // （见 app.js 的 bgState）。超时那一句要用它。
                                    progI = o.optInt("i", progI);
                                    progN = o.optInt("n", progN);
                                    // ok 是 null ⇒ 还在跑；有值（true/false）才算这一轮有结论。
                                    if (!o.isNull("ok")) finish("", s);
                                } catch (Throwable ignored) {
                                }
                            }
                        });
            } catch (Throwable ignored) {
            }
            ui.postDelayed(this, 1200L);
        }
    };

    /** evaluateJavascript 把字符串又套了一层 JSON 引号，这里拆回来。 */
    private static String unquote(String v) {
        if (v == null) return null;
        if (v.equals("null")) return null;
        try {
            return new org.json.JSONArray("[" + v + "]").optString(0, "");
        } catch (Throwable t) {
            return null;
        }
    }

    private final Runnable timeout = new Runnable() {
        @Override
        public void run() {
            if (finished) return;
            // 「这次没查完（等了太久），下一轮再试」—— 2026-11-13 用户嫌面板上
            // 一整行说半天。这句话会拼在「学习通上次查是 3 分钟前，」后面，
            // 前缀里已经有「上次」了，这里再说一遍「这次」就是两个时间点打架。
            // 🔴 2026-11-16：把**扫到第几门**带上。用户报了十几遍「后台检查还是
            //    不行」，而我们每次只有一句「等太久」—— 是压根没动、还是差最后
            //    两门，这两种要改的地方完全相反。39/40 就是超时太短，
            //    0/40 才是卡住（那时它自己会说卡在哪一步）。
            String why;
            if (cx) {
                why = progN > 0
                    ? ("没查完 " + progI + "/" + progN)
                    : "没查完（等太久）";
            } else {
                why = "没跑完（等太久）";
            }
            finish(why, null);
        }
    };

    @Override
    public boolean onStartJob(JobParameters ps) {
        params = ps;
        // 「先查一次」那个一次性任务也算查学习通
        cx = (ps.getJobId() == Auto.JOB_CX || ps.getJobId() == Auto.JOB_CX_NOW);
        // 「现在试一次」（2026-11-13）：它是**附加**的一次，不是链条本身。
        // 每次醒来都重排一次「下一次」的话，用户每点一次试跑就把真正的
        // 那次往后推一小时 —— 试得越多、越等不到。
        boolean now = (ps.getJobId() == Auto.JOB_CX_NOW || ps.getJobId() == Auto.JOB_WT_NOW);
        finished = false;

        // 🔴 **第一件事是把下一次排上**（2026-11-12）。
        //    Job 现在是一次性的（见 Auto 的类注释）：跑完就没了，没人接就永远不跑。
        //    放在最前面，是因为下面每一步都可能出意外 —— 页面起不来、JS 卡住、
        //    系统在跑了一半时把任务收走。放最后的话，一次意外就是永久停摆，
        //    而界面上开关还亮着。
        if (now) {
            // 附加的那一次：只在链条真的断了的时候补，别动正在跑的那条。
            Auto.ensure(this);
        } else if (cx) {
            Auto.scheduleNextCx(this, Auto.cxDelay(this));
        } else {
            // 积分任务今天已经做完了：下一次不用一小时后又醒（醒来也只是一句
            // 「今天做完了」）。六小时后再看一眼 —— 跨天了正好接着做，没跨天
            // 就再推六小时。一天从十几次空醒降到三四次。
            Auto.scheduleNextWt(this,
                Auto.wtDoneToday(this) ? 6 * 3600_000L : Auto.wtDelay(this));
        }

        // 积分任务：系统每次醒来都问一句「今天该不该跑」——
        // 不判的话就是「每小时跑一遍任务」，那不是用户要的，而且会被平台风控。
        if (!cx && !Auto.wtDue(this)) {
            jobFinished(ps, false);
            return false;
        }
        if (cx && !Auto.cxOn(this)) {
            jobFinished(ps, false);
            return false;
        }
        // 界面正开着：页面自己会查，后台这一路跳过。
        if (MainActivity.alive) {
            jobFinished(ps, false);
            return false;
        }
        start();
        return true;             // 还有活没干完
    }

    /** 系统要收走这个任务（没电了、被别的任务挤掉）。收干净。
     *
     *  🔴 返回 false（不要系统重排）：下一次在 {@link #onStartJob} 开头就排好了。
     *     返回 true 会让系统立刻再排一次同一个 id，和我们已经排的那次抢位置 ——
     *     表现是「有时候五分钟内跑两遍」。
     */
    @Override
    public boolean onStopJob(JobParameters ps) {
        finished = true;
        try {
            ui.removeCallbacksAndMessages(null);
        } catch (Throwable ignored) {
        }
        destroy();
        return false;
    }

    // ---------------------------------------------------------------- 起页面

    @SuppressLint("SetJavaScriptEnabled")
    private void start() {
        try {
            web = new WebView(this);
            web.setBackgroundColor(Color.TRANSPARENT);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            // 🔴 必须开：账号、缓存、上次扫到的结果全在 localStorage 里，
            //    和前台那个 WebView 是同一份。不开的话后台看到一片空白，
            //    表现是「后台说没登录，可明明登录着」。
            s.setDomStorageEnabled(true);
            s.setCacheMode(WebSettings.LOAD_DEFAULT);
            s.setUserAgentString(s.getUserAgentString() + MainActivity.UA_TAG);
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(false);

            web.addJavascriptInterface(new NativeBridge(web), "Android");
            web.addJavascriptInterface(new BgBridge(this), "AndroidBg");

            web.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                    if (!"app.local".equals(req.getUrl().getHost())) return null;
                    String path = req.getUrl().getPath();
                    if (path == null || path.equals("/")) path = "/index.html";
                    try {
                        InputStream in = getAssets().open("web" + path);
                        return new WebResourceResponse(mimeOf(path), charsetOf(path), in);
                    } catch (IOException e) {
                        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            null, new ByteArrayInputStream(("404 " + path).getBytes()));
                    }
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                    return !"app.local".equals(req.getUrl().getHost());
                }
            });

            ui.postDelayed(timeout, cx ? TIMEOUT_CX : TIMEOUT_WT);
            // 🔴 进度由**这里**推，不靠网页自己的 setTimeout（见下面 poll 的注释）。
            ui.postDelayed(poll, 1200L);
            // bg=1 让 app.js 跳过正常启动（不画界面、不查更新、不排提醒），
            // 只把这一件事做完就回调。
            web.loadUrl("https://app.local/index.html?bg=1&job=" + (cx ? "cx" : "wt"));
        } catch (Throwable t) {
            finish("后台页面起不来（" + t.getMessage() + "）", null);
        }
    }

    // ---------------------------------------------------------------- 收尾

    /** 网页那边跑完了（或超时）。**只会生效一次**。 */
    void done(String json) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (finished) return;
                finish("", json);
            }
        });
    }

    private void finish(String note, String json) {
        if (finished) return;
        finished = true;
        try {
            ui.removeCallbacks(timeout);
            ui.removeCallbacks(poll);      // 收工了就别再问进度
        } catch (Throwable ignored) {
        }

        JSONObject o = null;
        try {
            if (json != null && !json.isEmpty()) o = new JSONObject(json);
        } catch (Throwable ignored) {
        }

        try {
            if (cx) finishCx(o, note);
            else finishWt(o, note);
        } catch (Throwable ignored) {
            // 记账失败不该让任务卡住
        }

        destroy();
        try {
            jobFinished(params, false);
        } catch (Throwable ignored) {
        }
    }

    /** 积分那一轮的记录字段。
     *  d=提交次数 / b,a=前后积分 / c=开跑前今日剩余可得分 / r=还剩几项没做。 */
    private static JSONObject wtExtra(int done, int before, int after, int cap, int rest) {
        JSONObject ex = new JSONObject();
        try {
            ex.put("d", done);
            if (before >= 0) ex.put("b", before);
            if (after >= 0) ex.put("a", after);
            ex.put("c", cap);
            if (rest > 0) ex.put("r", rest);
        } catch (Throwable ignored) {
        }
        return ex;
    }

    /** 截短一句话，给记录列表用。按**字符**算，中文一个字一人宽。 */
    private static String brief(String s, int n) {
        if (s == null) return "";
        String t = s.trim();
        return t.length() <= n ? t : t.substring(0, n) + "…";
    }

    /** 记一轮运行（2026-11-14）。
     *
     *  用户：「点开可以看历史的学习通和积分任务的后台进行记录，包括时间与完成度」。
     *
     *  🔴 每一轮**只有一个出口**会走到这里 —— 记在 finishCx / finishWt 的
     *     每个 return 之前。漏一处，界面上就会出现「跑过但记录里没有」，
     *     而那种缺口看起来就像「后台根本没跑」。
     *
     *  `extra` 里的字段是给界面算完成度用的（n/m/d/b/a/cap），
     *  摘要 `w` 只写短语，界面别直接拿它当句子。
     */
    private void hist(String kind, boolean ok, String word, JSONObject extra) {
        try {
            JSONObject o = new JSONObject();
            o.put("t", System.currentTimeMillis() / 1000);
            o.put("k", kind);
            o.put("ok", ok);
            o.put("w", word == null ? "" : word);
            if (extra != null) {
                java.util.Iterator<String> it = extra.keys();
                while (it.hasNext()) {
                    String key = it.next();
                    o.put(key, extra.opt(key));
                }
            }
            Auto.histAdd(this, o);
        } catch (Throwable ignored) {
        }
    }

    /** 学习通这一轮的结果。 */
    private void finishCx(JSONObject o, String note) {
        long now = System.currentTimeMillis() / 1000;
        boolean ok = o != null && o.optBoolean("ok");
        if (!ok) {
            String why = (o == null) ? note : o.optString("error", note);
            if (why == null || why.isEmpty()) why = "这次没查成";
            String kind = (o == null) ? "" : o.optString("kind", "");
            // 🔴 登录过期**和网络故障不是一回事**，不能都攒到第三次才说。
            //    网络抖动会自己好，登录过期不会 —— 用户不点「重新连接」，
            //    之后每一轮都必然失败，表现就是「后台一直在检查失败」。
            //    所以这一档当天说一次，说清楚「点开连一下」。
            //    一天一次：否则每两小时弹一条，用户三天就把通知关了。
            if ("auth".equals(kind)) {
                String day = new java.text.SimpleDateFormat("yyyyMMdd",
                        java.util.Locale.CHINA).format(new java.util.Date());
                if (!day.equals(Auto.p(this).getString("cxAuthDay", ""))) {
                    Auto.p(this).edit().putString("cxAuthDay", day).apply();
                    Auto.tell(this, Auto.ID_NEW, "学习通登录过期",
                            "点开重新连一次，之后照常自动检查", "exams");
                }
                Auto.p(this).edit().putInt("cxFails", 0).putLong("cxTry", now)
                        .putString("cxWord", "登录过期").apply();
                hist("cx", false, "登录过期", null);
                return;
            }
            // 连续失败攒到三次才说一次。一次网络抖动就弹通知，用户三天就关了它。
            int fails = Auto.p(this).getInt("cxFails", 0) + 1;
            // 🔴 2026-11-16：这里原来写的是「未连上」。超时的真名是**没查完**
            //    （扫到一半被时间上限截住），不是连不上 —— 用户看到「未连上」
            //    会去查网络、查账号，方向全是错的。现在原样说原因，
            //    超时那句还带「扫到第几门」（见 timeout）。
            String word = brief(why, 12);
            Auto.p(this).edit().putInt("cxFails", fails)
                .putLong("cxTry", now)
                // 不要写「上次没查成」：界面上拼出来是
                // 「学习通上次查是 3 分钟前，上次没查成：…」，两个「上次」。
                .putString("cxWord", word).apply();
            // 记录里留一句原因（截短）：用户点开「运行记录」是想知道
            // 「为什么没查到」，只写「未连上」等于什么都没说。
            hist("cx", false, word, null);
            if (fails >= 3) {
                Auto.p(this).edit().putInt("cxFails", 0).apply();
                Auto.tell(this, Auto.ID_NEW, "学习通未连上",
                    "连续几次失败，多半是登录过期。点开重新连一次。",
                    "exams");
            }
            return;
        }

        int fresh = o.optInt("fresh", 0);
        int total = o.optInt("total", 0);
        int seeded = o.optInt("seeded", 0);
        String first = o.optString("first", "");
        String course = o.optString("course", "");
        int missed = o.optInt("missed", 0);

        String word;
        if (seeded > 0) {
            // 第一次跑：把现在这些当「已知」，别一口气弹一堆「新的」
            word = "首次记录 " + seeded + " 项";
        } else if (fresh > 0) {
            word = "新增 " + fresh + " 项";
        } else if (missed > 0) {
            word = missed + " 门未查全";
        } else {
            word = total > 0 ? "无新增" : "无待办";
        }
        Auto.p(this).edit().putInt("cxFails", 0)
            .putLong("cxLast", now).putLong("cxTry", now)
            .putString("cxWord", word).apply();
        try {
            JSONObject ex = new JSONObject();
            ex.put("n", fresh);
            ex.put("m", missed);
            ex.put("tot", total);
            hist("cx", true, word, ex);
        } catch (Throwable ignored) {
            hist("cx", true, word, null);
        }

        if (fresh > 0) {
            String body = course.isEmpty() ? first : (course + " · " + first);
            Auto.tell(this, Auto.ID_NEW,
                fresh == 1 ? "学习通新增 1 项" : ("学习通新增 " + fresh + " 项"),
                body, "exams");
        }
    }

    /** 积分任务这一轮的结果。 */
    private void finishWt(JSONObject o, String note) {
        long now = System.currentTimeMillis() / 1000;
        boolean ok = o != null && o.optBoolean("ok");
        String skip = (o == null) ? "" : o.optString("skip", "");
        if (o != null && "terms".equals(skip)) {
            // 用户还没看过那段风险说明 ⇒ 一次都不许动账号。
            Auto.p(this).edit().putString("wtWord", "还没同意风险说明，没跑").apply();
            return;
        }
        if (!ok) {
            String why = (o == null) ? note : o.optString("error", note);
            if (why == null || why.isEmpty()) why = "没跑成";
            String kind = (o == null) ? "" : o.optString("kind", "");
            // 🔴 2026-11-12：积分账号的登录也会过期，而且**不会自己好**。
            //    以前只在界面上写一行字，后台一路跑一路失败，用户完全不知道。
            //    和查学习通那档一样：当天说一次，说清去哪儿连。
            if ("auth".equals(kind)) {
                String day = new java.text.SimpleDateFormat("yyyyMMdd",
                        java.util.Locale.CHINA).format(new java.util.Date());
                if (!day.equals(Auto.p(this).getString("wtAuthDay", ""))) {
                    Auto.p(this).edit().putString("wtAuthDay", day).apply();
                    Auto.tell(this, Auto.ID_NEW, "积分账号登录过期",
                            "打开「接水」页重新连一次，之后照常自动做", "campus");
                }
            }
            // 记一次「试过了」：失败之后退避 30/60/120/180 分钟再来（见 Auto.wtDue）。
            // 不记的话，账号一坏就是「每小时动一次账号」。
            Auto.wtTried(this);
            Auto.p(this).edit().putString("wtWord", "未跑成").apply();
            hist("wt", false, ("auth".equals(kind) ? "登录过期"
                    : "未跑成：" + brief(why, 14)), null);
            return;
        }
        if (o.optBoolean("none", false)) {
            // 🔴 2026-11-14：**空列表不等于今天没事**。平台的当日任务不是零点
            //    刷出来的，早上那一轮经常是空的。原来这里直接 wtMarkDone，
            //    当天就再也不看了 —— 用户看到的就是「一天只尝试一次」。
            //    改成：白天只记「跑过一轮」并隔两小时再看，晚上还空才算今天完了。
            if (Auto.wtLateNow()) {
                Auto.wtMarkDone(this);
                Auto.p(this).edit().putString("wtWord", "无可做任务").apply();
                hist("wt", true, "无可做任务", null);
                Auto.scheduleNextWt(this, 6 * 3600_000L);
            } else {
                Auto.wtMarkRun(this);
                Auto.p(this).edit().putLong("wtLast", now)
                    .putString("wtWord", "暂时没任务").apply();
                hist("wt", true, "暂时没任务", null);
                Auto.scheduleNextWt(this, Auto.wtQuietDelay());
            }
            return;
        }

        int done = o.optInt("done", 0);
        int before = o.optInt("before", -1);
        int after = o.optInt("after", -1);
        // 开跑那一刻「今天还能拿多少分」—— 用来算这一轮得分占多少。
        // 🔴 平台没有「当日可获上限」这个字段（见 app.js 的 bgWtInit），
        //    所以分母是我们自己数的「剩余可得分」，界面上要写「今日剩余」。
        int cap = o.optInt("cap", 0);
        // 还剩几项没做成（网页那边跑完数出来的）。
        // 🔴 「跑过一次」不等于「做完了」：中途有一项失败，剩下的还在，
        //    当天就该继续试，而不是记成完成、当天再也不动。
        int rest = o.optInt("rest", 0);
        // 还剩多少**下**提交。后台一轮只做 5 下，任务多的时候必然是
        // 「跑完了这一批、还有下一批」—— 那是正常节奏，不是失败。
        int left = o.optInt("left", 0);
        String word = done + " 次";
        if (before >= 0 && after >= 0) {
            int diff = after - before;
            word += " · " + (diff >= 0 ? "+" : "") + diff + " 分";
        }

        if (rest > 0) {
            // 🔴 这里要分清两件事（2026-11-11）：
            //    · 这一批**做完了**，只是任务比一批多 → 记一轮，下一个小时继续；
            //    · 这一批**没做完就出了错**（error 有值）→ 记一次失败，连着三次就停。
            //    原来两种情况都记失败，于是任务一多，三次配额当天就烧光，
            //    而账号一点问题都没有 —— 用户看到的正是「积分任务从来不后台做」。
            boolean broke = o.has("error") && !o.optString("error", "").isEmpty();
            if (broke) {
                Auto.wtTried(this);
                Auto.p(this).edit().putLong("wtLast", now)
                    .putString("wtWord", "中途出错：" + brief(o.optString("error", ""), 14))
                    .apply();
                hist("wt", false, "中途出错：" + brief(o.optString("error", ""), 14),
                        wtExtra(done, before, after, cap, rest));
            } else {
                Auto.wtMarkRun(this);
                Auto.p(this).edit().putLong("wtLast", now)
                    .putString("wtWord", word + " · 还剩 " + rest + " 项").apply();
                hist("wt", true, "还剩 " + rest + " 项",
                        wtExtra(done, before, after, cap, rest));
                // 🔴 还有剩下的就别等一整个基础间隔（2026-11-14）。用户要的是
                //    「今天做完」，不是「每小时碰一次运气」；20 分钟上下再来一批，
                //    任务多的时候一天能跑好几轮，任务少的时候一轮就完了。
                Auto.scheduleNextWt(this, Auto.wtRetryDelay());
            }
            return;
        }

        Auto.wtMarkDone(this);
        Auto.p(this).edit().putString("wtWord", word).apply();
        hist("wt", true, "已完成", wtExtra(done, before, after, cap, 0));
        // 今天做完了：直接排到六小时后（跨天正好接着做）。
        // 不排的话，onStartJob 开头那次排的是「基础间隔」，明天零点前后还要空醒一次。
        Auto.scheduleNextWt(this, 6 * 3600_000L);

        if (done > 0) {
            String body = word;
            if (before >= 0 && after >= 0 && after - before > 0) {
                body = "提交 " + done + " 次 · +" + (after - before) + " 分 · 当前 " + after;
            }
            Auto.tell(this, Auto.ID_NEW, "积分任务已完成", body, "campus");
        }
    }

    private void destroy() {
        try {
            if (web != null) {
                web.stopLoading();
                web.loadUrl("about:blank");
                web.destroy();
            }
        } catch (Throwable ignored) {
        }
        web = null;
    }

    // ---------------------------------------------------------------- 杂

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

    private static String charsetOf(String path) {
        String m = mimeOf(path);
        if (m.startsWith("text/") || m.equals("application/javascript")
                || m.equals("application/json")) {
            return "utf-8";
        }
        return null;
    }

    /** 网页跑完之后回调这里。单独一个类是为了让服务里那堆生命周期代码好读。 */
    public static class BgBridge {
        private final AutoJob svc;

        BgBridge(AutoJob s) {
            svc = s;
        }

        @android.webkit.JavascriptInterface
        public void done(String json) {
            svc.done(json);
        }
    }
}
