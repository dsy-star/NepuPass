package com.nepu.dongyoutong;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 把「什么时候该提醒」交给系统的闹钟。0.47.8 加。
 *
 * ## 为什么是闹钟，不是后台任务
 *
 * 这是整个提醒功能唯一重要的设计决定，改动前先读完：
 *
 * 手机上「到点提醒」有两条路：
 *
 *   · **应用自己一直活着**，定时去看一眼 —— 国产 ROM 的省电策略一晚上就把它
 *     清掉了。用户第二天早上看到的是「昨晚到现在一条提醒都没有」，
 *     而且**没有任何报错**：应用没崩、没报错，它就是没被叫起来。
 *   · **把时间点交给系统**（AlarmManager）—— 到点由系统广播唤醒我们，
 *     应用平时可以完全不在内存里。这条路在「应用被杀」的情况下照样成立，
 *     因为闹钟记在系统服务里，不在我们的进程里。
 *
 * 所以这里做的不是「后台常驻」，而是**一次性排程**：网页在打开 App 时把
 * 未来十几天的提醒点一次算完推进来，这里把它们全排进系统闹钟。
 * 只要用户**偶尔打开一次 App**，后面的提醒就自动续上。
 *
 * ## 两个会「静默不响」的坑
 *
 * 1. **精确闹钟被关**（Android 12 / API 31 起）。`SCHEDULE_EXACT_ALARM` 是
 *    普通权限，装了默认就有，但用户可以随时在系统设置里收回去。
 *    被收走之后 `setExact*` 会**抛 SecurityException**（不处理就是崩溃），
 *    所以这里先问 {@link #canExact}，不行就退到「大概的时间」。
 *    ⚠️ 退化的代价是可能晚十几分钟 —— 上课提醒晚十几分钟等于没用，
 *       所以这件事**必须让用户看见**，由 {@link #state} 报给界面。
 * 2. **强制停止会清空闹钟**。用户在系统设置里点「强行停止」，系统会把
 *    这个应用的闹钟全删掉，且不再发开机广播。这不是 bug，也不可绕。
 *    用户下次打开 App 时 apply 一次就恢复了。
 */
final class Remind {

    private Remind() {
    }

    static final String SP = "hyt_remind";
    /** 整个提醒清单（JSON 数组的字符串）。开机重排、点开通知时都靠它。 */
    static final String K_LIST = "list";

    static final String ACTION = "com.nepu.dongyoutong.REMIND";
    static final String EXTRA_ID = "rid";

    /**
     * 最多排这么多条。
     *
     * 为什么要有上限：网页算错了（比如把每天的课按分钟排）会一次推进来几千条，
     * 每条一个 PendingIntent，系统那边会明显变卡。64 条够盖两周的课 + 一堆作业。
     */
    static final int MAX_ITEMS = 64;

    /** 「提前多少分钟」的合法范围。1 天到 1 分钟 —— 0 等于上课了才响，没意义。 */
    static final int MAX_LEAD = 1440;

    // ---------------------------------------------------------------- 排

    /**
     * 网页推进来的清单，整体替换掉旧的。
     *
     * @param json 形如 `[{"i":1,"at":1699…,"k":"class","t":"高数","b":"10:00 05-201","p":"schedule"}]`
     *             `at` 是毫秒时间戳；`k` 是 class / due；`p` 是点开后落在哪一页。
     * @return 空串 = 全部排好了；否则是给用户看的原因（界面必须原样说出来）
     */
    static String apply(Context c, String json) {
        JSONArray arr;
        try {
            arr = new JSONArray(json == null ? "[]" : json);
        } catch (Throwable t) {
            return "提醒清单格式不对";
        }

        long now = System.currentTimeMillis();
        JSONArray keep = new JSONArray();
        int n = 0;
        for (int i = 0; i < arr.length() && n < MAX_ITEMS; i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            long at = o.optLong("at", 0);
            // 已经过去的直接扔：排了也不会响，留着还会在开机重排时反复被跳过。
            // ⚠️ 不要为此报错 —— 「过去的提醒」是正常情况（网页可能算了 14 天，
            //    其中有些已经过去了），报错会让用户以为提醒坏了。
            if (at <= now) continue;
            if (at > now + 400L * 86400000L) continue;   // 一年多以后的，当作算错
            JSONObject k = new JSONObject();
            try {
                k.put("i", o.optInt("i", n + 1));
                k.put("at", at);
                k.put("k", "class".equals(o.optString("k")) ? "class" : "due");
                k.put("t", clip(o.optString("t"), 40));
                k.put("b", clip(o.optString("b"), 80));
                k.put("p", page(o.optString("p")));
            } catch (Throwable t) {
                continue;
            }
            keep.put(k);
            n++;
        }

        cancelAll(c);
        prefs(c).edit().putString(K_LIST, keep.toString()).apply();
        armAll(c, keep);

        if (n == 0) return "没有要排的提醒（可能都已经过去了）";
        return "";
    }

    /** 开机 / 应用更新之后重排。系统把这些闹钟清掉了，清单还在本机。 */
    static void rearm(Context c) {
        JSONArray arr;
        try {
            arr = new JSONArray(prefs(c).getString(K_LIST, "[]"));
        } catch (Throwable t) {
            return;
        }
        // 只排还没到的：清单里一半是过去的，重新排过去的会立刻炸一串通知。
        long now = System.currentTimeMillis();
        JSONArray live = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && o.optLong("at", 0) > now) live.put(o);
        }
        armAll(c, live);
    }

    private static void armAll(Context c, JSONArray arr) {
        AlarmManager am = alarms(c);
        if (am == null) return;
        boolean exact = canExact(c);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            int id = o.optInt("i", i + 1);
            long at = o.optLong("at", 0);
            PendingIntent pi = intentFor(c, id);
            try {
                if (exact) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } else {
                    // 退化的那一档：不精确，系统可能攒到下一个维护窗口才叫醒。
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                }
            } catch (SecurityException se) {
                // 权限在 canExact 之后、setExact 之前被收走（很罕见），
                // 或者厂商 ROM 另有限制。退到不精确的那一档，别让整批都排不上。
                try {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                } catch (Throwable ignored) {
                    // 这条排不上就跳过，剩下的继续 —— 一条排不上不该毁掉全部。
                }
            } catch (Throwable ignored) {
                // 同上。
            }
        }
    }

    private static PendingIntent intentFor(Context c, int id) {
        Intent it = new Intent(c, RemindReceiver.class);
        it.setAction(ACTION);
        it.putExtra(EXTRA_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(c, id, it, flags);
    }

    /** 到点了：找出这条是什么，发通知。 */
    static void fire(Context c, int id) {
        JSONObject hit = find(c, id);
        if (hit == null) return;      // 清单被换过（网页重排了），这条已经不存在
        String kind = hit.optString("k", "due");
        // 通知 id 用 kind 区分：同一类只留最新一条。
        // 为什么不是每条一个 id：一周十节课排下去，通知栏会挂十条「快上课了」，
        // 用户得滑半天才能清掉。
        int nid = "class".equals(kind) ? Notify.ID_CLASS : Notify.ID_DUE;
        Notify.show(c, kind, nid,
                hit.optString("t"), hit.optString("b"), hit.optString("p"));
    }

    private static JSONObject find(Context c, int id) {
        try {
            JSONArray arr = new JSONArray(prefs(c).getString(K_LIST, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && o.optInt("i", -1) == id) return o;
            }
        } catch (Throwable ignored) {
            // 读不出来 = 没有这条，不发就好。
        }
        return null;
    }

    static void cancelAll(Context c) {
        AlarmManager am = alarms(c);
        if (am == null) return;
        JSONArray arr;
        try {
            arr = new JSONArray(prefs(c).getString(K_LIST, "[]"));
        } catch (Throwable t) {
            return;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            PendingIntent pi = intentFor(c, o.optInt("i", i + 1));
            try {
                am.cancel(pi);
                pi.cancel();
            } catch (Throwable ignored) {
                // 取消失败最坏是多响一次，不该拦住后面的取消。
            }
        }
    }

    /** 关掉提醒：闹钟和清单一起清，别留下「清单还在、闹钟没了」的半截状态。 */
    static void clear(Context c) {
        cancelAll(c);
        prefs(c).edit().remove(K_LIST).apply();
        Notify.clearAll(c);
    }

    // ---------------------------------------------------------------- 状态

    /**
     * 给界面看的实情。**这不是装饰**：三条里任何一条不满足，提醒就不会按时响，
     * 而用户自己看不出来（应用不崩、不报错）。
     *
     * 返回 `{on, allow, ask, exact, off, n}`：
     *   on    现在能不能发通知（权限 + 总开关都在）
     *   ask   需不需要向系统要权限（只有 Android 13 起、且没给过时为 true）
     *   exact 是不是精确闹钟（false = 会晚十几分钟，界面要说清楚）
     *   off   被单独关掉的渠道：'class' / 'due' / ''（两个都关就是 'both'）
     *   n     已经排上的条数
     */
    static String state(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("on", Notify.allowed(c));
            o.put("ask", Notify.needAsk(c));
            o.put("exact", canExact(c));
            boolean a = Notify.channelOff(c, "class");
            boolean b = Notify.channelOff(c, "due");
            o.put("off", a && b ? "both" : (a ? "class" : (b ? "due" : "")));
            o.put("n", liveCount(c));
        } catch (Throwable t) {
            return "{}";
        }
        return o.toString();
    }

    static int liveCount(Context c) {
        try {
            JSONArray arr = new JSONArray(prefs(c).getString(K_LIST, "[]"));
            long now = System.currentTimeMillis();
            int n = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && o.optLong("at", 0) > now) n++;
            }
            return n;
        } catch (Throwable t) {
            return 0;
        }
    }

    // ---------------------------------------------------------------- 杂

    /**
     * 能不能排精确闹钟。
     *
     * API 31 起用户可以收回这个权限，收回后 `setExact*` 直接抛 SecurityException。
     * 31 以下没有这回事（声明了就是有），恒 true。
     */
    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        try {
            AlarmManager am = alarms(c);
            return am != null && am.canScheduleExactAlarms();
        } catch (Throwable t) {
            return false;
        }
    }

    private static AlarmManager alarms(Context c) {
        try {
            return (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        } catch (Throwable t) {
            return null;
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(SP, Context.MODE_PRIVATE);
    }

    private static String clip(String s, int n) {
        String v = s == null ? "" : s.replace('\n', ' ').trim();
        return v.length() > n ? v.substring(0, n) : v;
    }

    /** 页面名只留小写字母 —— 它会拼进跳转参数，不能带别的字符。 */
    private static String page(String s) {
        String v = s == null ? "" : s.replaceAll("[^a-z]", "");
        return v.length() > 20 ? v.substring(0, 20) : v;
    }
}
