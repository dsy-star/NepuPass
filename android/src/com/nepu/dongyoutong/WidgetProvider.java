package com.nepu.dongyoutong;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 桌面小组件：今天几节课 + 积分任务进度。0.47.8 加，0.49.0 重做外观。
 *
 * ## 为什么只能用系统控件拼
 *
 * 小组件是 {@link RemoteViews}，不是网页：**不能放 WebView，不能跑 JS**，
 * 只能用系统认的那几个控件（TextView / ImageView / LinearLayout /
 * ProgressBar…）拼。所以课表页那套 HTML 一个像素都搬不过来，这里得照着重画。
 *
 * 也只有这个原因 —— 不是懒得做好看，是远程视图只认系统控件。
 * 0.49.0 的「晶莹剔透」是靠 drawable 里那三层渐变叠出来的（见 hw_bg.xml），
 * 不是靠模糊：RemoteViews 做不了高斯模糊。
 *
 * ## 数据从哪来
 *
 * 它读不到网页的 localStorage。做法跟「慧生活」那套一样：**网页算好了推过来**
 * （{@link #save}），这里只负责存和画。网页有课表、知道今天第几周、
 * 也知道今天做完几个任务，这边什么都不知道，也不该去猜。
 *
 * ## 刷新时机
 *
 * 由系统决定，最勤也就半小时一次（{@code updatePeriodMillis}），而且**不保证**。
 * 所以这个小组件只适合「今天有几节课」这种不要求准点的信息。
 * 到点提醒是通知那边的事（{@link Remind}），不要指望小组件。
 *
 * 每次打开 App 会推一份新的，那时候会立刻刷新一次 —— 用户看到的始终是
 * 「上次打开时的情况」，最多旧半天。这是 RemoteViews 的固有代价。
 */
public class WidgetProvider extends AppWidgetProvider {

    static final String SP = "hyt_widget";
    static final String K_DATA = "data";

    /**
     * 布局里画得下几行课，**实际用几行按格子高度算**（见 {@link #fitRows}）。
     *
     * 0.49.0 v2 写死过 MAX_ROWS = 2：因为 4×2 的 110dp 只放得下两行。
     * 但用户会把小组件拉高（截图里那张就比 110dp 高不少），拉高之后
     * 下面空一大块，看起来就是「内容很少」—— 那正是用户 2026-11-07 的原话。
     * 现在高度由系统给（OPTION_APPWIDGET_MIN_HEIGHT），能放几行就画几行。
     *
     * 0.52.0 v12 从 4 行加到 6 行：多了 4×4 那个尺寸。
     * 🔴 加到 6 行**不影响 4×2**：行数由高度算，110dp 照样只画 2 行，
     *    多出来的 hwRow5 / hwRow6 一直是 GONE。布局里多做两行不占高度。
     */
    static final int MAX_ROWS = 6;

    /**
     * 最多存几段课。**比 MAX_ROWS 大**是有意的：
     * 画几行由格子高度决定（4×2 只画 2~3 行，4×4 能画 6 行），
     * 但数据得先存够 —— 存的时候按行数截，等于把「拉高以后能看见」这条路堵死。
     * 一天最多 12 节，连堂合并后一般 6~8 段，10 足够且不会把 SharedPreferences 撑大。
     */
    static final int MAX_KEEP = 10;

    /**
     * 三种画法。四个尺寸不是四套代码，是「同一份数据、三种排版」：
     *
     *   KIND_FULL  4×2 和 4×4 —— 多行三列（时间段 / 课名 / 教室）+ 任务进度
     *   KIND_SMALL 2×2 —— 几节 + 下一节，没有三列（2 格宽放不下，见布局注释）
     *   KIND_STRIP 4×1 —— 一行说完
     *
     * 🔴 没有第四种：「4×4」不是新画法，是 KIND_FULL 把行数放开到 6。
     */
    static final int KIND_FULL = 0;
    static final int KIND_SMALL = 1;
    static final int KIND_STRIP = 2;

    /**
     * 哪个类画哪种。**只看类，不看实例** —— 这是全类唯一的映射表。
     *
     * 🔴 不写成每个子类自己 override 的虚方法：{@link #refresh} 手里只有
     *    Class 对象（它是从 AppWidgetManager 查出来的），拿不到实例。
     *    两套映射迟早会走样，所以宁可只留这一处。
     */
    static int kindOf(Class<?> cls) {
        if (cls == WidgetSmall.class) return KIND_SMALL;
        if (cls == WidgetStrip.class) return KIND_STRIP;
        return KIND_FULL;
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            try {
                mgr.updateAppWidget(id, build(c, id, getClass()));
            } catch (Throwable t) {
                // 单个小组件画不出来不该让其余的都空着。
            }
        }
    }

    /**
     * 用户在桌面上拖动边角改尺寸。
     *
     * 🔴 没有这个回调，拉高之后**不会重画** —— 卡片变高了，里面还是按旧高度
     *    算出来的行数，底下那片空白要等到下次打开 App 才填上。
     */
    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager mgr,
                                          int id, Bundle opts) {
        try {
            mgr.updateAppWidget(id, build(c, id, getClass()));
        } catch (Throwable ignored) {
            // 同上：画不出来就算了，别崩。
        }
    }

    /**
     * 这个格子能放几行课。
     *
     * 算式的来历（dp，全部从 hyt_widget.xml 量出来的）：
     *   固定开销 = 上下留白 20 + 标题 17 + 课/任务之间的分隔 12 + 任务行 13 = 62
     *   第 1 行   = 上边距 5 + 内容 14 = 19
     *   之后每行  = 行距 4 + 内容 14 = 18
     *   所以 n 行需要  62 + 19 + 18(n-1) = 63 + 18n
     *   反解         n = (h - 63) / 18
     *   不画任务行时固定开销少 25（分隔 12 + 任务 13）⇒ n = (h - 38) / 18
     *
     * 结果：110dp 两行（99）、160dp 五行（153）、180dp 六行（171）。
     *
     * ⚠️ 110dp 只能放两行是**量出来的**，不是估的。0.49.0 v4 那版间距松了 6dp
     *    （标题下 7、行间 7+1+6），两行要 113 —— 超出 110 之后 LinearLayout
     *    不会压缩，weight=1 的 hwGap 缩到 0，多出来的部分连同**最底下那行
     *    积分任务**一起被裁掉。用户看到的就是「内容很少」。
     *
     * 🔴 0.52.0 v17（2026-11-11）：每行从 26dp 收到 18dp，去掉的是**行间那几条
     *    1dp 分隔线**（连上下边距一共 8dp）。用户那张截图上标题写着「5 节」、
     *    卡片里只有 4 行 —— 差的就是这几条线的高度。
     *    同时把「任务行」变成可让的：课画不下时先让任务行，而不是让课程。
     *
     * 🔴 0.52.3（2026-11-14）：`withDue2` = 还要画「第二条提醒」那一行（15dp）。
     *    和任务行同理，这一行的 15dp 是从课程里扣的 —— 所以必须**先算**画不画
     *    得起第二条（build 里 rows>=4 才画），再拿 withDue2 重算行数。
     *    少算这 15 的后果就是以前那个老毛病：以为放得下，真机上最下面那行
     *    连同任务行一起被裁掉。
     */
    private static int fitRows(Context c, int id, boolean withTask, boolean withDue2) {
        int h = 110;
        try {
            Bundle o = AppWidgetManager.getInstance(c).getAppWidgetOptions(id);
            if (o != null) {
                int lo = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
                int hi = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                // 🔴 取**两者较大**的（2026-11-11）。
                //    用户把 4×2 拉成 4×3/4×4 之后，不少桌面（尤其国产 ROM）
                //    只把新高度写进 MAX，MIN 一直停在 xml 里声明的 110dp。
                //    只读 MIN 的话，拉多高都只画 2 行 —— 这正是用户说的
                //    「小组件经常无法显示当天完整课程」，而且拉大也没用。
                //    取大打满了会多画一行（底下被裁），取小则永远少画；
                //    多画配下面那句「另 N 节」，两种都不会误导。
                int v = Math.max(lo, hi);
                if (v > 0) h = v;
            }
        } catch (Throwable ignored) {
            // 老系统没有这个 API，就用 110。
        }
        // 63 = 留白 20 + 标题 17 + 分隔 12 + 任务行 13 + 第 1 行 19 - 第 1 行之后的 18；
        // 18 = 每多一行的高度（见布局文件头那张表）。
        // 15 = 第二条提醒那一行（0.52.3）。
        int extra = withDue2 ? 15 : 0;
        int n = withTask ? (h - 63 - extra) / 18 : (h - 38 - extra) / 18;
        return Math.max(1, Math.min(MAX_ROWS, n));
    }

    /**
     * 网页推进来的今日摘要。
     *
     * @param json `{"d":"周六","n":1,"it":[{"t":"16:30~18:10","c":"形势与政策",
     *              "r":"01B102"}],"td":3,"tn":8}`
     *             `it` 里的一行 = **一门课**（连上的几小节网页那边已经合并成一条），
     *             `t` 是这一整段的时间段；`n` 是今天的门数。
     *             `td` = 今天做完几个积分任务、`tn` = 一共几个（0 = 还没读到）。
     * @return 空串 = 存好了；否则是原因
     */
    static String save(Context c, String json) {
        JSONObject o;
        try {
            o = new JSONObject(json == null ? "{}" : json);
        } catch (Throwable t) {
            return "小组件数据格式不对";
        }
        JSONArray it = o.optJSONArray("it");
        JSONArray keep = new JSONArray();
        // 🔴 存的条数**不等于**画的行数：存够了才能在任何尺寸下都画得出来。
        //    原来按 MAX_ROWS（6）存，4×4 拉满刚好；可网页那边一天可能有 8 段课，
        //    多出来的两段连数据都没留下 —— 再高的格子也画不出不存在的行。
        for (int i = 0; it != null && i < it.length() && keep.length() < MAX_KEEP; i++) {
            JSONObject r = it.optJSONObject(i);
            if (r == null) continue;
            try {
                JSONObject k = new JSONObject();
                // 12 字：够放「16:30~18:10」这种连堂课的时间段（11 字）。
                // 🔴 原来是 6 —— 时间段会被截成「16:30~」这种半截话。
                k.put("t", clip(r.optString("t"), 12));
                k.put("c", clip(r.optString("c"), 12));
                k.put("r", clip(r.optString("r"), 10));
                keep.put(k);
            } catch (Throwable ignored) {
                // 这一行坏了就少显示一行，别整块空着。
            }
        }
        JSONObject out = new JSONObject();
        try {
            out.put("d", clip(o.optString("d"), 4));
            out.put("n", o.optInt("n", keep.length()));
            out.put("it", keep);
            // 🔴 0.49.0：任务进度。
            //    td 不许大于 tn —— 网页那边如果算错（比如把昨天的记成今天的），
            //    进度条会走出 100%，而 RemoteViews 对超范围的进度是**静默截断**，
            //    界面上看不出任何异常，数字却写着「7/5」。
            int tn = Math.max(0, o.optInt("tn", 0));
            int td = Math.max(0, o.optInt("td", 0));
            if (tn > 0 && td > tn) td = tn;
            out.put("tn", tn);
            out.put("td", tn > 0 ? td : 0);
            // 🔴 0.52.1 v20（2026-11-13）：最近一条要交的作业。
            //    只存**一条** —— 卡片标题行右侧就那点宽度，列三条会变成一片字。
            //    挑哪条是网页那边算的（截止最近的那条，且没被标成「交过了」），
            //    这里不重新排：两套排序必然在某个边界上对不上。
            JSONObject du = o.optJSONObject("du");
            if (du != null && du.optString("h").length() > 0) {
                JSONObject d2 = new JSONObject();
                // 8 字：够放「形势与政策」这种六字课名 + 一个空格。
                d2.put("c", clip(du.optString("c"), 8));
                // 剩余时间只写最粗的一档（「4 天」「2 小时」），见 app.js 的 cxLeftShort。
                d2.put("h", clip(du.optString("h"), 8));
                out.put("du", d2);
            }
            // 🔴 0.52.3（2026-11-14）：作业截止 + 考试提醒，最多两条。
            //    用户要的是「考试也上桌面」，而标题行那一格只有 60dp ——
            //    一条放标题行（4×2 也看得见），第二条只在高卡片上画出来
            //    （见 build 里 due2 的判据）。
            //    每条都带 `k`（work / exam）：界面上靠颜色分开，
            //    光看「2 小时」分不出这是作业还是考试。
            JSONArray ds = o.optJSONArray("ds");
            JSONArray dsKeep = new JSONArray();
            for (int i = 0; ds != null && i < ds.length() && dsKeep.length() < 2; i++) {
                JSONObject r = ds.optJSONObject(i);
                if (r == null) continue;
                String h = clip(r.optString("h"), 8);
                if (h.length() == 0) continue;
                JSONObject k = new JSONObject();
                k.put("k", "exam".equals(r.optString("k")) ? "exam" : "work");
                k.put("c", clip(r.optString("c"), 8));
                k.put("h", h);
                dsKeep.put(k);
            }
            out.put("ds", dsKeep);
        } catch (Throwable t) {
            return "小组件数据存不下";
        }
        prefs(c).edit().putString(K_DATA, out.toString()).apply();
        refresh(c);
        return "";
    }

    /** 解除绑定 / 清空课表时调：小组件上不该还挂着别人的课。 */
    static void wipe(Context c) {
        prefs(c).edit().remove(K_DATA).apply();
        refresh(c);
    }

    /** 今天有几节课（0 = 没有数据，小组件显示空状态）。 */
    static int count(Context c) {
        try {
            JSONObject o = new JSONObject(prefs(c).getString(K_DATA, "{}"));
            return o.optInt("n", 0);
        } catch (Throwable t) {
            return 0;
        }
    }

    /** 把桌面上所有尺寸的这个小部件都重画一遍。
     *
     * 🔴 四个尺寸是**四个 AppWidgetProvider**（系统按 receiver 认，一个类只能
     *    挂一个 receiver）。只重画 WidgetProvider 的话，用户放在桌面上的
     *    2×2 / 4×1 / 4×4 会一直停在旧数据上 —— 而且没有任何报错，
     *    看起来只是「这个小尺寸好像不刷新」。
     *    所以下面这张表就是「所有尺寸」的清单，加尺寸要同时加到这里。
     */
    private static final Class<?>[] ALL = {
            WidgetProvider.class, WidgetSmall.class,
            WidgetStrip.class, WidgetLarge.class };

    static void refresh(Context c) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(c);
            for (Class<?> cls : ALL) {
                int[] ids = mgr.getAppWidgetIds(new ComponentName(c, cls));
                for (int id : ids) mgr.updateAppWidget(id, build(c, id, cls));
            }
        } catch (Throwable ignored) {
            // 桌面上没有这个小组件，或者系统不给查 —— 都不是错误。
        }
    }

    // ---------------------------------------------------------------- 画

    /** 提醒那几个颜色。作业蓝、考试橙 —— 标题行放不下「作业 / 考试」三个字，
     *  颜色是唯一不占地方的区分。字色取的是应用里那两条同色。 */
    private static final int C_WORK = 0xFF2F6BEE;
    private static final int C_EXAM = 0xFFC2410C;
    private static final int C_SUB = 0xFF5A6B85;

    /** 一条提醒怎么写：「课程 2 小时」；没有课程名就写「作业 2 小时」。
     *
     *  🔴 不写「截止」两个字：那一格只有 60dp，多两个字就把课程名挤没了，
     *     而「2 小时」本身已经说明是还剩多久。
     */
    private static String dueWordOf(JSONObject d) {
        if (d == null) return "";
        String h = d.optString("h");
        if (h.length() == 0) return "";
        String c = d.optString("c");
        String label = "exam".equals(d.optString("k")) ? "考试" : "作业";
        return (c.length() > 0 ? c : label) + " " + h;
    }

    /** 小尺寸 / 横条只有一句话，取最近那一条。 */
    private static String firstDueWord(JSONObject o) {
        JSONArray ds = o.optJSONArray("ds");
        if (ds != null && ds.length() > 0) return dueWordOf(ds.optJSONObject(0));
        return dueWordOf(o.optJSONObject("du"));
    }

    private static RemoteViews build(Context c, int id, Class<?> cls) {
        int kind = kindOf(cls);
        // 三种画法三种布局。4×2 和 4×4 共用 hyt_widget（行数按高度算），
        // 2×2 和 4×1 各有自己的布局（原因见那两份文件的注释）。
        int layout = kind == KIND_SMALL ? R.layout.hyt_widget_small
                : kind == KIND_STRIP ? R.layout.hyt_widget_strip
                : R.layout.hyt_widget;
        RemoteViews rv = new RemoteViews(c.getPackageName(), layout);

        // 点整个卡片就进 App 的课表页。**这一步不能省**：
        // 小组件只能显示，真正的操作都在应用里，不给个入口等于把人堵在门口。
        rv.setOnClickPendingIntent(R.id.hwRoot, open(c));

        JSONObject o = null;
        try {
            o = new JSONObject(prefs(c).getString(K_DATA, "{}"));
        } catch (Throwable ignored) {
            // 没数据就走下面的空状态。
        }
        if (o == null) o = new JSONObject();

        // 小尺寸那两份布局里没有课程行、没有任务行、也没有进度条 ——
        // 走到这里就先分出去，别让下面的代码去碰不存在的控件。
        if (kind == KIND_SMALL) return buildSmall(rv, o);
        if (kind == KIND_STRIP) return buildStrip(rv, o);

        String day = o.optString("d", "");
        boolean hasDay = day.length() > 0;
        int n = o.optInt("n", 0);
        int tn = Math.max(0, o.optInt("tn", 0));
        int td = Math.max(0, Math.min(o.optInt("td", 0), tn));
        int rows = fitRows(c, id, tn > 0, false);
        // 最近要交的东西（2026-11-13 起有；2026-11-14 起作业和考试各一条）。
        // 第一条画在标题行右侧，**不占新的一行**；第二条只在高卡片上另起一行。
        JSONArray ds = o.optJSONArray("ds");
        if (ds == null || ds.length() == 0) {
            // 老数据（只有一条 du）也得画得出来：桌面上的卡片可能还是上一版推的。
            JSONObject du = o.optJSONObject("du");
            if (du != null && du.optString("h").length() > 0) {
                ds = new JSONArray();
                JSONObject one = new JSONObject();
                try {
                    one.put("k", "work");
                    one.put("c", du.optString("c"));
                    one.put("h", du.optString("h"));
                    ds.put(one);
                } catch (Throwable ignored) {
                }
            }
        }
        JSONObject due0 = (ds != null && ds.length() > 0) ? ds.optJSONObject(0) : null;
        JSONObject due1 = (ds != null && ds.length() > 1) ? ds.optJSONObject(1) : null;
        String dueWord = dueWordOf(due0);
        boolean isExam0 = due0 != null && "exam".equals(due0.optString("k"));
        // 第二条只有在**高卡片**上才画（4×2 的 110dp 放不下，硬塞就是把课裁掉）。
        // 4 行及以上 ≈ 135dp，扣掉这 15dp 还剩 3~4 行课，是能接受的让位。
        boolean due2 = due1 != null && rows >= 4;
        if (due2) rows = fitRows(c, id, tn > 0, true);

        // 课表、任务、作业**三样都没有**才叫空。
        // 🔴 0.47.8 那种写法是「没有 d 就当空」—— 只登了慧生活、没登教务的人
        //    有任务数据也会被当成空卡片，任务进度永远显示不出来。
        //    2026-11-13 再加一条：只登了学习通（没绑教务）但有作业的人，
        //    也不该看到一块白板。
        if (!hasDay && tn <= 0 && dueWord.length() == 0) {
            rv.setTextViewText(R.id.hwTitle, "今天");
            rv.setTextViewText(R.id.hwEmpty, "打开东油通同步课表");
            rv.setViewVisibility(R.id.hwEmpty, View.VISIBLE);
            // hwEmpty 和 hwGap 都是「吃空隙」的，只能露一个（见布局文件头）。
            rv.setViewVisibility(R.id.hwGap, View.GONE);
            for (int i = 0; i < MAX_ROWS; i++) {
                rv.setViewVisibility(rowId(i), View.GONE);
            }
            rv.setViewVisibility(R.id.hwDiv, View.GONE);
            rv.setViewVisibility(R.id.hwTaskRow, View.GONE);
            // 空状态必须显式藏掉作业 —— 不藏的话，这一轮数据里没有作业，
            // 卡片上还挂着上一轮那条，用户会以为它一直没交。
            rv.setViewVisibility(R.id.hwDue, View.GONE);
            rv.setViewVisibility(R.id.hwDue2, View.GONE);
            return rv;
        }
        // 标题行右侧那一条：作业和考试都会出现在这里，靠颜色分开
        // （作业蓝、考试橙）—— 11sp 的地方写不下「作业 / 考试」四个字。
        if (dueWord.length() > 0) {
            rv.setTextViewText(R.id.hwDue, dueWord);
            rv.setTextColor(R.id.hwDue, isExam0 ? C_EXAM : C_WORK);
            rv.setViewVisibility(R.id.hwDue, View.VISIBLE);
        } else {
            rv.setViewVisibility(R.id.hwDue, View.GONE);
        }
        // 第二条（另一类）。只有高卡片才画，见上面 due2 的判据。
        if (due2) {
            rv.setTextViewText(R.id.hwDue2, dueWordOf(due1));
            rv.setTextColor(R.id.hwDue2,
                "exam".equals(due1.optString("k")) ? C_EXAM : C_SUB);
            rv.setViewVisibility(R.id.hwDue2, View.VISIBLE);
        } else {
            rv.setViewVisibility(R.id.hwDue2, View.GONE);
        }

        JSONArray it = o.optJSONArray("it");
        int have = it == null ? 0 : it.length();
        // 🔴 课画不下 ⇒ **先让任务行**，不是先砍课（0.52.0 v17）。
        //    那一行加分隔一共 25dp，正好换得一行课。「积分任务做到哪了」
        //    明天还能看，「今天第 5 节在哪间教室」过了今天就没了。
        //    v16 只在「任务已经做完」时让位，于是任务没做完的卡片照样少一节 ——
        //    用户 2026-11-11 的截图就是这种：标题写 5 节，画面上 4 行。
        boolean squeeze = have > rows && tn > 0;
        if (squeeze) rows = fitRows(c, id, false, due2);
        // 🔴 放不下的时候**必须说一句**，不许静默截断。
        //    以前超出的行直接不画、标题只写「5 节」，下面只有三行，
        //    用户以为课丢了 —— 他的原话是「小组件经常无法显示当天完整课程」。
        //    ⚠️ 但**不能拿一行课去换这句提示**：先试过「最后一行写还有 N 节」，
        //    卡片只画得下三行时变成「两节课 + 一句还有 3 节」，用户看到的课
        //    反而更少 —— 那不是他要的。所以提示放在**标题行**，课程行照样画满。
        //    ⚠️ 用「另 N 节」不用「还有 N 节」：后者在同一张卡上会被读成
        //    「下面还有一节课要上」，而这里说的是「卡片画不下了」。
        boolean more = have > rows;
        String title = hasDay
                ? (day + " · " + (n > 0 ? n + " 节" : "没课"))
                : "今天";
        if (more) title += " · 另 " + (have - rows) + " 节";
        rv.setTextViewText(R.id.hwTitle, title);

        boolean any = false;
        for (int i = 0; i < MAX_ROWS; i++) {
            // 超出行数上限的格子一律当没有：拉高了多画几行，拉矮了少画几行。
            JSONObject r = (i < rows && it != null) ? it.optJSONObject(i) : null;
            if (r == null) {
                rv.setViewVisibility(rowId(i), View.GONE);
                continue;
            }
            any = true;
            rv.setViewVisibility(rowId(i), View.VISIBLE);
            rv.setTextViewText(timeId(i), r.optString("t"));
            rv.setTextViewText(nameId(i), r.optString("c"));
            rv.setTextViewText(roomId(i), r.optString("r"));
        }
        // 有日期但一节课都没有 —— 这是**好消息**，不是出错。
        boolean showEmpty = hasDay && !any;
        rv.setViewVisibility(R.id.hwEmpty, showEmpty ? View.VISIBLE : View.GONE);
        if (showEmpty) rv.setTextViewText(R.id.hwEmpty, "今天没课");
        // 有课时由 hwGap 把任务行顶到底部（卡片比内容高的时候不留一块空白）。
        rv.setViewVisibility(R.id.hwGap, showEmpty ? View.GONE : View.VISIBLE);

        // ---- 积分任务（0.49.0）----
        // 🔴 进度条用 0~100 而不是 0~tn：max 传 0 会抛异常，而 tn 完全可能是 0
        //    （读失败 / 还没读过），那一抛整个小组件就变空白，还不报错。
        // 让位给课程时（squeeze）任务行整个藏起来 —— 那一行的高度已经拿去画课了，
        // 留着它就是两处抢同一块地方，最后一起被裁。
        boolean showTask = tn > 0 && !squeeze;
        rv.setViewVisibility(R.id.hwTaskRow, showTask ? View.VISIBLE : View.GONE);
        if (showTask) {
            int pct = (int) Math.round(td * 100.0 / tn);
            // 🔴 参数顺序是 (viewId, max, progress, indeterminate)，**max 在前**。
            //    写成 (id, progress, max) 编译不过 —— 三个参数的版本根本不存在。
            rv.setProgressBar(R.id.hwProg, 100, pct, false);
            // 全做完就写「已完成」，别写「5/5」—— 那是把一句结论说成一次统计。
            rv.setTextViewText(R.id.hwTaskN, td >= tn ? "已完成" : (td + "/" + tn));
        }
        // 分隔线：它分的是「课」和「任务」两块。任务行没画的时候，
        // 它还画着就成了一条**凭空吊在卡片底部**的野线 —— 用户那张截图上
        // 正是这么一条（4 行课下面一道线，线下什么都没有）。
        rv.setViewVisibility(R.id.hwDiv, showTask ? View.VISIBLE : View.GONE);
        return rv;
    }

    /**
     * 2×2 那份：今天几节 + 下一节是什么。
     *
     * 只有三处文字（标题 / 几节 / 下一节），没有课表行也没有进度条 ——
     * 2 格宽 110dp 减掉留白只剩 86dp，塞三列课表的话课名就剩三个字。
     * 所以这个尺寸回答的是「今天要不要带书」，不是「第几节在哪间教室」。
     *
     * 🔴 「下一节」取的是**今天第一条**。网页推过来的 it 已经按时间排好、
     *    连堂课也合并过（见 save），这里不再排一次 —— 再排一次就有了两套顺序。
     */
    private static RemoteViews buildSmall(RemoteViews rv, JSONObject o) {
        String day = o.optString("d", "");
        int n = o.optInt("n", 0);
        JSONArray it = o.optJSONArray("it");
        JSONObject first = it != null ? it.optJSONObject(0) : null;
        boolean hasDay = day.length() > 0;

        rv.setTextViewText(R.id.hwTitle, hasDay ? day : "今天");
        // 课表和任务两样都没有 = 还没同步过。这时候写「0 节」是错的：
        // 0 节是「查过了、今天没课」，没同步是「不知道」。
        // 🔴 2026-11-14：有作业/考试提醒时**不算空卡片** —— 只连了学习通、
        //    没绑教务的人，桌面上就该看见「作业 2 小时」，而不是一句「同步课表」。
        String due0 = firstDueWord(o);
        if (!hasDay && n <= 0 && due0.length() == 0) {
            rv.setTextViewText(R.id.hwBig, "—");
            rv.setTextViewText(R.id.hwNext, "打开东油通同步课表");
            return rv;
        }
        boolean known = hasDay || n > 0;
        rv.setTextViewText(R.id.hwBig, known ? (n > 0 ? (n + " 节") : "没课") : "—");
        // 第二条提醒（作业 / 考试的最近一条）。2×2 的高度捉襟见肘，
        // 所以它**和「下一节」挤同一格**（hwNext 本来就是两行）：
        // 有下一节时写「16:30 形势与政策 / 作业 2 小时」，没课就只写提醒。
        String line = "";
        if (first == null) {
            line = known ? (n > 0 ? "" : "今天没课") : "";
        } else {
            String t = startOf(first.optString("t"));
            line = (t + " " + first.optString("c")).trim();
        }
        if (due0.length() > 0) line = line.length() > 0 ? (line + "\n" + due0) : due0;
        rv.setTextViewText(R.id.hwNext, line);
        return rv;
    }

    /**
     * 4×1 那一行：今天几号星期几、几节、下一节是什么，一句话说完。
     *
     * 高度只有 40dp，除去上下留白只剩一行字 —— 所以这里**不加**任务进度：
     * 一行里塞两件事，第二件必然被裁掉，而裁掉的是数字，看起来像没做这功能。
     */
    private static RemoteViews buildStrip(RemoteViews rv, JSONObject o) {
        String day = o.optString("d", "");
        int n = o.optInt("n", 0);
        JSONArray it = o.optJSONArray("it");
        JSONObject first = it != null ? it.optJSONObject(0) : null;
        boolean hasDay = day.length() > 0;

        StringBuilder s = new StringBuilder();
        if (!hasDay && n <= 0) {
            s.append("打开东油通同步课表");
        } else {
            // 一周里只有这一行，所以信息可以密一点，但**不用全角空格分段**了：
            // 「周三　5 节　08:00 线性代数」看着像三个不相干的字段，
            // 用 · 串起来才是一句话（0.52.0 v17 改的文案）。
            s.append(hasDay ? day : "今天");
            s.append(" ").append(n > 0 ? (n + " 节") : "没课");
            if (first != null) {
                s.append(" · ").append(startOf(first.optString("t")))
                        .append(" ").append(first.optString("c"));
            }
            // 4×1 也想说一句「今晚有东西要交」——直接接在最后，
            // 不再换行（这一份只有一行，换行等于看不见）。
            String due = firstDueWord(o);
            if (due.length() > 0) s.append(" · ").append(due);
        }
        rv.setTextViewText(R.id.hwTitle, s.toString());
        return rv;
    }

    /** `16:30~18:10` → `16:30`。小尺寸只放得下一个开始时间。 */
    private static String startOf(String t) {
        String v = t == null ? "" : t.trim();
        int i = v.indexOf('~');
        if (i > 0) v = v.substring(0, i);
        return v.trim();
    }

    private static PendingIntent open(Context c) {
        Intent it = new Intent(c, MainActivity.class);
        it.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        it.putExtra(MainActivity.EXTRA_PAGE, "schedule");
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(c, 91, it, flags);
    }

    // 六行的控件 id 写成常量表 —— RemoteViews 只能按 id 找控件，
    // 没有「第 i 行」这种概念，所以宁可写死也不能到时候用反射拼 id。
    // 加行数要两处一起改：布局里的 hwRowN 系列、这里四张表、还有 MAX_ROWS。
    // 🔴 四张表长度必须一样（都是 6）。少一张、短一格，取到的是别的行，
    //    界面上表现为「第 5 行显示第 4 行的课」—— 不报错，只是对不上。
    // ⚠️ 0.52.0 v17 去掉了 hwMd1..6 那张表：行间不再画分隔线，
    //    那四条 id 连同 midId() 一起下线（见布局文件头的原因）。
    private static final int[] ID_ROW = {
            R.id.hwRow1, R.id.hwRow2, R.id.hwRow3,
            R.id.hwRow4, R.id.hwRow5, R.id.hwRow6 };

    private static final int[] ID_TIME = {
            R.id.hwT1, R.id.hwT2, R.id.hwT3,
            R.id.hwT4, R.id.hwT5, R.id.hwT6 };

    private static final int[] ID_NAME = {
            R.id.hwC1, R.id.hwC2, R.id.hwC3,
            R.id.hwC4, R.id.hwC5, R.id.hwC6 };

    private static final int[] ID_ROOM = {
            R.id.hwR1, R.id.hwR2, R.id.hwR3,
            R.id.hwR4, R.id.hwR5, R.id.hwR6 };

    private static int rowId(int i) {
        return ID_ROW[Math.min(i, ID_ROW.length - 1)];
    }

    private static int timeId(int i) {
        return ID_TIME[Math.min(i, ID_TIME.length - 1)];
    }

    private static int nameId(int i) {
        return ID_NAME[Math.min(i, ID_NAME.length - 1)];
    }

    private static int roomId(int i) {
        return ID_ROOM[Math.min(i, ID_ROOM.length - 1)];
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(SP, Context.MODE_PRIVATE);
    }

    private static String clip(String s, int n) {
        String v = s == null ? "" : s.replace('\n', ' ').trim();
        return v.length() > n ? v.substring(0, n) : v;
    }
}
