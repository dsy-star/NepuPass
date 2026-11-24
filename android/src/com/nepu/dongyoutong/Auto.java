package com.nepu.dongyoutong;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 「后台自动」这一件事的账本 + 排程。0.50.0 v5 加。
 *
 * ================================================================
 * 为什么用 JobScheduler，而不是「闹钟 + 前台服务」
 * ================================================================
 * 第一版写的是「AlarmManager 到点 → startForegroundService → 服务里开页面」。
 * 那个写法在 **Android 12（API 31）起直接不成立**：
 * 系统禁止应用从后台启动前台服务（ForegroundServiceStartNotAllowedException），
 * 例外只有「用户刚点过」「高优先级推送」「精确闹钟」这几种。
 * 后果不是崩溃，是**后台一次都跑不起来**，而界面上开关是开着的 ——
 * 用户只会说「这功能没用」。
 *
 * JobScheduler 正好是为这件事设计的：系统在合适的时候（有网、不在省电冻结里）
 * 把任务叫起来，跑完就结束，不需要前台服务、不需要常驻通知。
 * 代价是「几点」不精确 —— 系统会攒到维护窗口，可能晚一两个小时。
 * 对「每隔一两小时看一眼有没有新作业」来说完全够，而且更省电。
 *
 * 🔴 `setPeriodic` 的下限是 15 分钟（系统会夹住更短的值）。
 *    这里最短给 60 分钟：查一次学习通要发几十个请求，太快会被风控。
 *
 * ================================================================
 * 🔴 2026-11-12：从「固定周期」改成「一次性 + 自己接下一次」
 * ================================================================
 * 用户原话：「学习通可能会检测自动化脚本，咱们的每隔两个小时登录一次风险
 * 就极高，那咱们就能改成每两小时上下 20 分钟检查一次」。
 *
 * 固定周期（`setPeriodic(2 小时)`）的问题不是技术问题，是**行为特征**：
 * 每天十几枪都落在同一个时刻，和脚本一模一样。人的手不会那么准。
 *
 * 做法：排一个 `setMinimumLatency(基准 ± 抖动)` 的**一次性**任务，
 * 干活之前先把下一次排上（{@link AutoJob#onStartJob} 里第一件事），
 * 所以任务本身崩了、被系统收走了，链条也不会断。
 * 真正跑起来的间隔是 100~140 分钟，每天都不同 —— 这个差别肉眼看不出来，
 * 但「每天固定 12:00、14:00、16:00」那种规律没有了。
 *
 * 代价：一次性任务跑完就没了，必须有人接。接的三处：
 *   · 任务开头自己排下一次（主路）；
 *   · 开机 / 装完新版本（{@link BootReceiver}）；
 *   · 用户打开 App（{@link #ensure}，只在发现链条真的断了才补，
 *     不会每次开 App 都把计时器清零 —— 那等于永远不查）。
 */
final class Auto {

    /** 设置存在这里。**和网页那份是两份**：网页那份管界面显示，
     *  这份管任务 —— 应用被系统清掉之后，只有这份还读得到。 */
    static final String PREFS = "hyt_auto";

    /** 抖动的幅度：学习通 ±20 分钟，积分任务 ±10 分钟（它本来就是每小时一次，
     *  抖太多会让人等不到结果）。**不许写死成整点整分** —— 见类注释。 */
    static final long CX_JITTER_MS = 20 * 60_000L;
    static final long WT_JITTER_MS = 10 * 60_000L;

    /** 积分任务的基础间隔（分钟）。它由 {@link #wtDue} 决定跑不跑，
     *  所以这里只是一句「下次什么时候来看一眼」。
     *
     *  🔴 2026-11-14 用户：「后台进行积分任务一天似乎只会尝试一次，改成每天多次」。
     *    60 → 30：醒来只是问一句「今天该不该跑」（本地两个计数，一个请求都不发），
     *    真正动账号的那一步由 {@link #wtDue} 把着，所以醒得勤一点不会多打学校服务。
     *    原来 60 分钟一醒，遇上系统把任务攒到维护窗口（常常一次晚两三小时），
     *    一整天就只剩一两次机会；失败一次还得再等一小时。 */
    static final int WT_BASE_MIN = 30;

    /** 还有剩下的没做完时，下一轮多久之后（分钟）。
     *  比基础间隔短：用户要的是「今天在内把它做完」，不是「每小时碰一次运气」。 */
    static final int WT_RETRY_MIN = 20;

    /** 一轮无事可做（任务列表是空的）时，隔多久再看一眼。
     *  🔴 这条是「一天只尝试一次」的另一半原因：平台的当日任务不是零点就
     *    刷出来的，早上的那一轮经常看见空列表。那时要是直接记成「今天做完了」，
     *    当天就再也不看了 —— 用户看到的就是「只试了一次」。
     *    所以空列表只在**晚上**才算「今天完了」，白天一律晚点再看。 */
    static final int WT_QUIET_MIN = 120;

    /** 两个任务的 id。换 id 会让已经排上的旧任务留在系统里跑 —— 别乱改。 */
    static final int JOB_CX = 7101;
    static final int JOB_WT = 7102;
    /** 「刚打开开关，先查一次」。一次性的，跑完就没了。
     *  为什么不靠「下一次」那个：它最短也要等一整个基准间隔（两小时），
     *  用户点完开关两小时内什么都看不到，只会觉得没生效。 */
    static final int JOB_CX_NOW = 7103;
    /** 「现在试一次积分任务」（2026-11-13）。
     *  用户报「开了开关从来没自动跑过」，而 JobScheduler 什么时候真跑由系统定
     *  （可能攒到几小时后）。没有这个按钮，他永远没法自己验证链路通不通，
     *  只能干等 —— 等不到就以为功能是假的。 */
    static final int JOB_WT_NOW = 7104;

    /** 结果通知的渠道与 id。MIN 重要性：它是「告诉你一声」，不是来打断你的。 */
    static final String CH = "auto";
    static final int ID_NEW = 3002;

    private Auto() {
    }

    // ---------------------------------------------------------------- 读

    static SharedPreferences p(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean cxOn(Context c) {
        return p(c).getBoolean("cxOn", false);
    }

    static int cxMin(Context c) {
        // 只在 60 / 120 / 240 这几档上取，别信外面传进来的任意数字。
        int v = p(c).getInt("cxMin", 120);
        return (v == 60 || v == 240) ? v : 120;
    }

    static boolean wtOn(Context c) {
        return p(c).getBoolean("wtOn", false);
    }

    static long cxLast(Context c) {
        return p(c).getLong("cxLast", 0L);
    }

    static String cxWord(Context c) {
        return p(c).getString("cxWord", "");
    }

    static long wtLast(Context c) {
        return p(c).getLong("wtLast", 0L);
    }

    static String wtWord(Context c) {
        return p(c).getString("wtWord", "");
    }

    /** 下一次大约什么时候跑（秒）。0 = 没排上。只说「大约」——
     *  系统会攒到它方便的维护窗口，实际可能晚几十分钟。 */
    static long cxNext(Context c) {
        return p(c).getLong("cxNext", 0L);
    }

    static long wtNext(Context c) {
        return p(c).getLong("wtNext", 0L);
    }

    /* ------------------------------------------------------- 运行记录 */

    /** 最多留多少条。60 条 ≈ 一天半的积分轮次 + 两天的学习通轮次。 */
    static final int HIST_MAX = 60;

    /** 追加一条「这一轮跑成了什么样」。
     *
     *  用户 2026-11-14：「点开可以看历史的学习通和积分任务的后台进行记录，
     *  包括时间与完成度」。
     *
     *  为什么用 SharedPreferences 里一个 JSON 数组，不开 SQLite：
     *  只追加、上限 60 条、读的时候整份取出画一屏。为这点数据开一张表，
     *  等于多一个要迁移的 schema，而它一条查询都不用。
     *
     *  🔴 字段用短名（t/k/ok/w/n/m/d/b/a/c），因为 SP 在开机时会被整份读。
     *     换成 longName 之后 60 条能到几 KB，而它每开机读一次、每次写一次。
     */
    static synchronized void histAdd(Context c, JSONObject row) {
        if (row == null) return;
        try {
            JSONArray arr;
            try {
                arr = new JSONArray(p(c).getString("hist", "[]"));
            } catch (Throwable t) {
                arr = new JSONArray();          // 坏掉就当没有，别让后台因此崩
            }
            JSONArray out = new JSONArray();
            out.put(row);
            for (int i = 0; i < arr.length() && out.length() < HIST_MAX; i++) {
                out.put(arr.opt(i));
            }
            p(c).edit().putString("hist", out.toString()).apply();
        } catch (Throwable ignored) {
        }
    }

    /** 记录本体，给 {@link #state} 用。拿不到给空数组。 */
    static JSONArray hist(Context c) {
        try {
            return new JSONArray(p(c).getString("hist", "[]"));
        } catch (Throwable t) {
            return new JSONArray();
        }
    }

    /** 现在这一套设置的实情，给界面显示。 */
    static String state(Context c) {
        try {
            JSONObject o = new JSONObject();
            o.put("avail", true);
            o.put("cxOn", cxOn(c));
            o.put("cxMin", cxMin(c));
            o.put("wtOn", wtOn(c));
            o.put("wtDoneToday", wtDoneToday(c));
            o.put("cxLast", cxLast(c));
            // 🔴 2026-11-16：`cxLast` 只在**成功**时写，所以失败过十次的面板上
            //    还写着「未跑过」—— 和下面的运行记录当场打架。cxTry 是「最近一次
            //    尝试」（成功失败都写），面板拿它说「多久前试过」。
            o.put("cxTry", p(c).getLong("cxTry", 0));
            o.put("cxWord", cxWord(c));
            o.put("wtLast", wtLast(c));
            o.put("wtWord", wtWord(c));
            // 下一次大约什么时候 —— 界面写「下次大约 15:40」。
            // 用户报过「积分任务形同虚设」，一句话说不清跑没跑；
            // 给个具体时刻，他能自己对照「到点了有没有动静」。
            o.put("cxNext", cxNext(c));
            o.put("wtNext", wtNext(c));
            // 系统里**实际排着**的那几个任务（空串 = 一个都没有）。
            // 2026-11-13 加的：用户「允许自启、允许后台高耗电，还是从来没跑过」，
            // 而界面只能说「开关开着」。开关开着 / 排上了 / 真跑了 是三件事，
            // 混在一起说他永远不知道该看哪儿。这个字段让界面能说清第一层。
            o.put("jobs", pending(c));
            // 通知被关掉时，后台白白跑，用户什么也收不到 —— 界面必须说这件事
            o.put("notify", Notify.allowed(c));
            // 后台跑过的轮次（最新的在前）。界面「运行记录」那一节画它。
            o.put("hist", hist(c));
            return o.toString();
        } catch (Throwable t) {
            return "{\"avail\":true}";
        }
    }

    /** 系统里排着的任务 id，逗号分隔。取不到给空串（不编）。 */
    static String pending(Context c) {
        try {
            if (Build.VERSION.SDK_INT < 24) return "";
            JobScheduler js = js(c);
            if (js == null) return "";
            java.util.List<JobInfo> got = js.getAllPendingJobs();
            StringBuilder sb = new StringBuilder();
            for (int i = 0; got != null && i < got.size(); i++) {
                int id = got.get(i).getId();
                if (id != JOB_CX && id != JOB_WT && id != JOB_CX_NOW && id != JOB_WT_NOW) continue;
                if (sb.length() > 0) sb.append(',');
                sb.append(id);
            }
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    // ---------------------------------------------------------------- 写

    /**
     * 整体替换设置并重排。网页那边每点一次开关就推一次。
     *
     * 缺字段 = 保持原值（网页只传改动的那几个也不会把别的冲成默认）。
     */
    static String apply(Context c, String json) {
        try {
            JSONObject o = new JSONObject(json == null ? "{}" : json);
            SharedPreferences.Editor e = p(c).edit();
            boolean dirty = false;
            if (o.has("cxOn") && o.optBoolean("cxOn") != cxOn(c)) {
                e.putBoolean("cxOn", o.optBoolean("cxOn"));
                dirty = true;
            }
            if (o.has("cxMin")) {
                int v = o.optInt("cxMin", 120);
                v = (v == 60 || v == 240) ? v : 120;
                if (v != cxMin(c)) { e.putInt("cxMin", v); dirty = true; }
            }
            if (o.has("wtOn") && o.optBoolean("wtOn") != wtOn(c)) {
                e.putBoolean("wtOn", o.optBoolean("wtOn"));
                dirty = true;
            }
            e.apply();
            // 🔴 值没变就**不重排**（2026-11-13）。重排 = cancel + 换一个新的
            //    最小延迟，等于把计时器清零。开机时会调一次 apply 做「两边对齐」
            //    （见 app.js 的 autoBootSync），天天开 App 的人就会永远等不到那一次。
            if (dirty) schedule(c);
            return "";
        } catch (Throwable t) {
            return "没能排上（" + t.getMessage() + "）";
        }
    }

    /**
     * 马上试一次（30 秒后由系统叫起来）。2026-11-13 加。
     *
     * 用来回答「我开了开关，它到底会不会动」—— 不用等系统攒到维护窗口。
     * 走的是同一个 {@link AutoJob}、同一份设置，跑完照样写 wtWord / wtLast。
     */
    static String runNow(Context c, String kind) {
        try {
            JobScheduler js = js(c);
            if (js == null) return "这台手机不支持定时任务";
            boolean wt = "wt".equals(kind);
            if (wt && !wtOn(c)) return "先把「每天自己做积分任务」打开";
            if (!wt && !cxOn(c)) return "先把「自己检查学习通」打开";
            int id = wt ? JOB_WT_NOW : JOB_CX_NOW;
            cancel(c, id);
            js.schedule(new JobInfo.Builder(id, new ComponentName(c, AutoJob.class))
                .setMinimumLatency(30_000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build());
            return "";
        } catch (Throwable t) {
            return "没能排上（" + t.getMessage() + "）";
        }
    }

    /** 按当前设置把两个任务重排一遍。**先全撤再排**，所以可以随便重入。 */
    static void schedule(Context c) {
        JobScheduler js = js(c);
        if (js == null) return;
        cancel(c, JOB_CX);
        cancel(c, JOB_WT);
        // 那个一次性的「先查一次」也要撤：不撤的话，用户关掉开关之后它还会
        // 醒来跑一次 —— 开关已经关了，后台却动了一次，这是最不该出现的事。
        cancel(c, JOB_CX_NOW);
        cancel(c, JOB_WT_NOW);

        if (cxOn(c)) {
            scheduleNextCx(c, cxDelay(c));
            // 另外排一次「一分钟后就查」：下一次最短也要等一整个基准间隔，
            // 用户点完开关两小时内什么都看不到。
            js.schedule(new JobInfo.Builder(JOB_CX_NOW, new ComponentName(c, AutoJob.class))
                .setMinimumLatency(60_000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build());
        }
        if (wtOn(c)) {
            // 每 50~70 分钟醒一次，真正跑不跑由 {@link #wtDue} 判（今天还没做完才跑）。
            // 为什么醒了还要自己判：JobScheduler 只保证「大约」，而且一天要醒十几次，
            // 不判就会一天跑十几遍账号。
            scheduleNextWt(c, wtDelay(c));
        }
    }

    /**
     * 下一次隔多久。**基准 ± 抖动**，下限 15 分钟（系统对定时任务的下限）。
     *
     * 🔴 这条是整个「看起来不像脚本」的落点：固定 120 分钟就是每天同一批时刻
     *    打过去，抖 20 分钟之后每次都不一样。用 `Math.random()` 而不是
     *    「按上次时间递推」—— 递推出来的序列也是确定的，而且会更整齐。
     */
    static long nextDelay(int baseMin, long jitterMs) {
        long base = Math.max(15, baseMin) * 60_000L;
        long off = (long) ((Math.random() * 2.0 - 1.0) * jitterMs);
        return Math.max(15 * 60_000L, base + off);
    }

    static long cxDelay(Context c) {
        return nextDelay(cxMin(c), CX_JITTER_MS);
    }

    static long wtDelay(Context c) {
        return nextDelay(WT_BASE_MIN, WT_JITTER_MS);
    }

    /** 这一轮还有剩下的（任务比一批多时就是这样）：20 分钟上下再来一次。 */
    static long wtRetryDelay() {
        return nextDelay(WT_RETRY_MIN, 8 * 60_000L);
    }

    /** 这一轮无事可做：两小时后再看一眼（平台的当日任务不是零点刷出来的）。 */
    static long wtQuietDelay() {
        return nextDelay(WT_QUIET_MIN, CX_JITTER_MS);
    }

    /**
     * 排下一次学习通检查。**干活的函数开头就调它**（见 AutoJob.onStartJob），
     * 这样即使任务本身崩了、被系统收走了，链条也还在。
     */
    static void scheduleNextCx(Context c, long delayMs) {
        if (!cxOn(c)) return;
        JobScheduler js = js(c);
        if (js == null) return;
        cancel(c, JOB_CX);
        js.schedule(oneShot(c, JOB_CX, delayMs));
        p(c).edit().putLong("cxNext",
            System.currentTimeMillis() / 1000 + Math.max(0, delayMs) / 1000).apply();
    }

    static void scheduleNextWt(Context c, long delayMs) {
        if (!wtOn(c)) return;
        JobScheduler js = js(c);
        if (js == null) return;
        cancel(c, JOB_WT);
        js.schedule(oneShot(c, JOB_WT, delayMs));
        p(c).edit().putLong("wtNext",
            System.currentTimeMillis() / 1000 + Math.max(0, delayMs) / 1000).apply();
    }

    /**
     * 打开 App 时补一次：**只在链条真的断了才排**。
     *
     * 什么时候会断：用户在系统里「强行停止」过（那会清掉这个应用所有排着的任务）、
     * 换机恢复备份、或者系统自己把任务扔了。断了的后果是**永远不再跑**，
     * 而且界面上开关还是开着的 —— 用户只会说「这功能没用」。
     *
     * 🔴 不在这里无条件 `schedule()`：那会把计时器每次开 App 都清零，
     *    天天开着 App 的人就永远等不到那一次检查。
     */
    static void ensure(Context c) {
        try {
            JobScheduler js = js(c);
            if (js == null) return;
            boolean hasCx = false, hasWt = false;
            if (Build.VERSION.SDK_INT >= 24) {
                java.util.List<JobInfo> got = js.getAllPendingJobs();
                for (int i = 0; got != null && i < got.size(); i++) {
                    int id = got.get(i).getId();
                    if (id == JOB_CX || id == JOB_CX_NOW) hasCx = true;
                    if (id == JOB_WT) hasWt = true;
                }
            } else {
                // 6.0/7.0 没有 getAllPendingJobs：只能在每次打开时重排。
                // 那两版系统上「开 App 会推迟下一次」是已知代价，比不跑强。
                hasCx = false;
                hasWt = false;
            }
            if (cxOn(c) && !hasCx) scheduleNextCx(c, 120_000L);
            if (wtOn(c) && !hasWt) scheduleNextWt(c, 120_000L);
        } catch (Throwable ignored) {
        }
    }

    /**
     * 积分任务现在该不该真的跑。
     *
     * 用户 2026-11-09 把节奏改成了这样：
     *   > 积分任务能不能改成，会记忆当天的完成情况，没完成的话后台随时都能做，
     *   > 做完后当天就记为完成，当天不再在后台做。
     *
     * 所以判据只剩两条：**今天还没做完**、**今天试的没超过 3 次**。
     * 🔴 不再有「几点之后才跑」：他要的是「有空就跑」，不是「等到九点」。
     *    这需要一个明确的「今天做完了」标记（`wtDoneDay`），不能拿
     *    `wtLast` 顶替 —— 跑了一半（还有没做完的）也是会写 `wtLast` 的，
     *    那样「没完成」就被记成了「完成」，当天再也不动了。
     * 🔴 失败上限仍然必须有：这个任务每小时醒一次，账号一出问题就是
     *    「每小时动一次账号」——原项目 README 自己写着「异常时请停止任务，
     *    勿反复运行期待自动恢复」。
     */
    static boolean wtDue(Context c) {
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int today = cal.get(java.util.Calendar.YEAR) * 1000
            + cal.get(java.util.Calendar.DAY_OF_YEAR);

        SharedPreferences sp = p(c);
        // 跨天了就清掉「今天试过几次」。不清的话，昨天失败三次，
        // 今天一整天都不会再试 —— 而用户什么都没做错。
        if (sp.getInt("wtDay", 0) != today) {
            sp.edit().putInt("wtDay", today).putInt("wtTries", 0)
              .putInt("wtRuns", 0).putLong("wtCool", 0L).apply();
        }

        if (sp.getInt("wtDoneDay", 0) == today) return false;   // 今天已经做完了
        // 🔴 2026-11-12：原来「连着失败 3 次 = 今天不做了」。这条太狠 ——
        //    三次都可能是同一段没信号的地铁，而窗口是**一整天**。
        //    用户看到的就是「自动积分任务形同虚设，完全不会自动完成」。
        //    现在改成「失败之后歇一会儿再来」，一天最多试 12 次（2026-11-14 从 6 提到 12）。
        //    账号真出问题一样会被这个上限挡住：12 次 × 最短 15 分钟退避，
        //    最早也要三个多小时才能试满，而每一次都失败才会计数。
        if (sp.getInt("wtTries", 0) >= WT_MAX_TRIES) return false;
        if (System.currentTimeMillis() < sp.getLong("wtCool", 0L)) return false;
        // 🔴 「今天跑过几轮」和「失败几次」是**两件事**，必须分开记（2026-11-11）。
        //    后台一轮只做 8 下（见 app.js 的 BG_WT_CAP），任务多的时候一轮做不完，
        //    剩下的留给下一次。如果把「没做完」也算成失败，几次之后当天就废了，
        //    而那时账号、网络一切正常 —— 用户看到的是「积分任务从来不跑」。
        //    🔴 2026-11-14：8 → 16。一轮 8 下、两次之间 30 秒，一天真要做的话
        //    两三批就够了；16 是「平台任务特别多 / 一直有零星剩下」时的余量，
        //    到顶说明今天确实做不完，不是我们放弃得太早。
        return sp.getInt("wtRuns", 0) < WT_MAX_RUNS;
    }

    /** 一天最多试几次（失败才算）。和退避一起兜住「账号坏了还一直打」。
     *  2026-11-14 从 6 提到 12：用户要的是「每天多次尝试，提高稳定性」。 */
    static final int WT_MAX_TRIES = 12;

    /** 一天最多跑几轮（不算失败）。16 轮 × 8 下 = 128 下，远高于任何真实任务量。 */
    static final int WT_MAX_RUNS = 16;

    /** 现在是不是「今天已经晚了」—— 空任务列表到这会儿才算「今天没事了」。
     *
     *  🔴 平台的当日任务不是零点刷出来的，早上的那一轮经常看见空列表。
     *    列表为空就记「今天做完了」的话，当天再也不看 —— 这正是用户说的
     *    「一天似乎只会尝试一次」。19 点之后还空，那就是真没事了。 */
    static boolean wtLateNow() {
        return java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY) >= 19;
    }

    /** 这一轮做完了它分到的那一批（还有剩下的留给下一轮）。不计失败。 */
    static void wtMarkRun(Context c) {
        SharedPreferences sp = p(c);
        sp.edit().putInt("wtRuns", sp.getInt("wtRuns", 0) + 1).apply();
    }

    /** 今天的积分任务做完了。当天不再动，跨天自动失效。 */
    static void wtMarkDone(Context c) {
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int today = cal.get(java.util.Calendar.YEAR) * 1000
            + cal.get(java.util.Calendar.DAY_OF_YEAR);
        p(c).edit()
            .putInt("wtDoneDay", today)
            .putLong("wtLast", System.currentTimeMillis() / 1000)
            .apply();
    }

    /** 今天做完了没（给界面显示用）。 */
    static boolean wtDoneToday(Context c) {
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int today = cal.get(java.util.Calendar.YEAR) * 1000
            + cal.get(java.util.Calendar.DAY_OF_YEAR);
        return p(c).getInt("wtDoneDay", 0) == today;
    }

    /** 记一次「试过了」（失败时用）。成功那一次会写 wtLast，不再需要它。
     *
     *  🔴 顺手排一段退避：连着失败还按原节奏继续打，就变成「一直动一个坏账号」——
     *     原项目 README 自己写着「异常时请停止任务，勿反复运行期待自动恢复」。
     *     但也不许「当天就不管了」：那是另一种不负责任（见 {@link #wtDue}）。 */
    static void wtTried(Context c) {
        SharedPreferences sp = p(c);
        int n = sp.getInt("wtTries", 0) + 1;
        // 2026-11-14：退避从 {30,60,120,180…} 收到 {15,20,30,45,60,90,120…}。
        // 一天 12 次的机会，全耗在「等一小时」上就白给了；而 15 分钟已经
        // 足够避开一次瞬时断网 / 学校服务器抽风。
        long[] cool = {15, 20, 30, 45, 60, 90, 120, 150, 180, 180, 180, 180};
        long min = cool[Math.min(n - 1, cool.length - 1)];
        sp.edit().putInt("wtTries", n)
          .putLong("wtCool", System.currentTimeMillis() + min * 60_000L).apply();
    }

    static void cancel(Context c, int id) {
        try {
            JobScheduler js = js(c);
            if (js != null) js.cancel(id);
        } catch (Throwable ignored) {
        }
    }

    static void cancelAll(Context c) {
        cancel(c, JOB_CX);
        cancel(c, JOB_WT);
        cancel(c, JOB_CX_NOW);
        cancel(c, JOB_WT_NOW);
    }

    /** 明天/今天 的 hour 点。已经过了就是明天。 */
    static long nextDaily(int hour) {
        java.util.Calendar cal = java.util.Calendar.getInstance();
        cal.set(java.util.Calendar.HOUR_OF_DAY, hour);
        cal.set(java.util.Calendar.MINUTE, 0);
        cal.set(java.util.Calendar.SECOND, 0);
        cal.set(java.util.Calendar.MILLISECOND, 0);
        long t = cal.getTimeInMillis();
        if (t <= System.currentTimeMillis() + 60_000L) t += 24L * 3600_000L;
        return t;
    }

    private static JobScheduler js(Context c) {
        try {
            return (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        } catch (Throwable t) {
            return null;
        }
    }

    private static JobInfo oneShot(Context c, int id, long delayMs) {
        // 🔴 有最小延迟保护：setMinimumLatency 太小的值没有意义（系统会攒到维护
        //    窗口），这里夹到 15 分钟，免得「每小时」被人改成 5 分钟把学校服务器打疼。
        //    ⚠️ 不要用 `setPeriodic`：周期任务是**固定间隔**，固定间隔正是
        //       这一次要解决的那个「像脚本」的问题（见类注释）。
        long d = Math.max(15 * 60_000L, delayMs);
        return new JobInfo.Builder(id, new ComponentName(c, AutoJob.class))
            .setMinimumLatency(d)
            // 没网就别醒：醒了也只能发一堆失败请求，还要用户担一次「后台在跑」
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            // 重启手机、应用被覆盖安装之后任务还在（要 RECEIVE_BOOT_COMPLETED，已有）
            .setPersisted(true)
            .build();
    }

    // ---------------------------------------------------------------- 通知

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm =
                (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || nm.getNotificationChannel(CH) != null) return;
            NotificationChannel ch = new NotificationChannel(
                CH, "后台自动检查", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("在后台查学习通、跑积分任务时用");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        } catch (Throwable ignored) {
        }
    }

    /**
     * 有结果了。
     *
     * @param page 点开落在哪一页（app.js 的页面名）
     */
    static void tell(Context c, int id, String title, String body, String page) {
        if (!Notify.allowed(c)) return;      // 没给通知权限：静默，别假装发了
        ensureChannel(c);
        try {
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                b = new Notification.Builder(c, CH);
            } else {
                b = new Notification.Builder(c);
                b.setPriority(Notification.PRIORITY_LOW);
            }
            b.setContentTitle(nz(title))
                .setContentText(nz(body))
                .setSmallIcon(R.drawable.ic_notify)
                .setAutoCancel(true)
                .setShowWhen(true)
                .setContentIntent(open(c, page));
            if (body != null && body.length() > 18) {
                b.setStyle(new Notification.BigTextStyle().bigText(nz(body)));
            }
            NotificationManager nm =
                (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(id, b.build());
        } catch (Throwable ignored) {
        }
    }

    private static PendingIntent open(Context c, String page) {
        Intent it = new Intent(c, MainActivity.class);
        it.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (page != null && !page.isEmpty()) it.putExtra(MainActivity.EXTRA_PAGE, page);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, 100, it, flags);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
