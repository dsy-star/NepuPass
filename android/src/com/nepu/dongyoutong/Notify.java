package com.nepu.dongyoutong;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * 发通知这一件事。0.47.8 加。
 *
 * 为什么单独一个类：排程（{@link Remind}）和发通知是两件事。排程关心
 * 「什么时候该响」，这里关心「响的时候长什么样、能不能响」。混在一起的话，
 * 想给「考试提醒」换个图标都得翻半天闹钟代码。
 *
 * 🔴 两个「不报错但不响」的坑，这个类存在的意义就是把它们说清楚：
 *
 * 1. **通知权限**（Android 13 / API 33 起）。用户不点「允许」，
 *    `nm.notify()` 一声不响地什么都不做 —— 没有异常、没有返回值，
 *    代码里看起来一切正常。所以 {@link #allowed} 必须能被界面问到。
 * 2. **通知渠道被关**（Android 8 / API 26 起）。渠道一旦建好，
 *    用户可以在系统设置里单独关掉某一个。被关掉的渠道发通知，同样是静默失败。
 *    所以 {@link #channelOff} 也要能问。
 *
 * 这两条都不能靠「try/catch 一下」发现 —— 它们不抛异常。
 */
final class Notify {

    private Notify() {
    }

    /** 上课提醒的渠道。重要性高一点：错过一次就是迟到一节课。 */
    static final String CH_CLASS = "class";
    /** 作业 / 考试截止。可以晚几分钟看到，但得看得见。 */
    static final String CH_DUE = "due";

    static final int ID_CLASS = 1000;
    static final int ID_DUE = 2000;

    // ---------------------------------------------------------------- 渠道

    /**
     * 建渠道。**重复调用是安全的**（同名渠道建第二次只更新名字，不重置用户的设置）。
     *
     * 🔴 不要在这里改已有渠道的重要性，也不要删了重建：
     *    用户手动关掉某个渠道之后，重建一个同名渠道会**保留**用户的关闭状态
     *    （这是 Android 的设计），但如果改了 id，用户关掉的那个就白关了 ——
     *    新 id 默认是开的，于是「我明明关了它又弹」。
     */
    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = mgr(c);
        if (nm == null) return;
        if (nm.getNotificationChannel(CH_CLASS) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CH_CLASS, "上课提醒", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("快上课了");
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_DUE) == null) {
            NotificationChannel ch = new NotificationChannel(
                    CH_DUE, "作业和考试", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("作业快截止、考试快开始");
            nm.createNotificationChannel(ch);
        }
    }

    static String channelOf(String kind) {
        return "class".equals(kind) ? CH_CLASS : CH_DUE;
    }

    // ---------------------------------------------------------------- 能不能响

    /**
     * 现在能不能发通知。API 33 以下没有这个权限，但用户仍可能在系统设置里
     * 关掉整个应用的通知 —— 所以两条都要看。
     */
    static boolean allowed(Context c) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return notificationsEnabled(c);
    }

    /** 系统层面「这个应用的通知」是不是开着（API 24 起才有这个查询）。 */
    @SuppressWarnings("deprecation")
    static boolean notificationsEnabled(Context c) {
        NotificationManager nm = mgr(c);
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT >= 24) return nm.areNotificationsEnabled();
        return true;
    }

    /**
     * 某个渠道是不是被单独关掉了。
     *
     * 返回 false 只说明「没说被关」，不代表一定开着 —— 27 以下没有渠道。
     * 🔴 别把它和 {@link #allowed} 混起来判：一个是总开关，一个是分开关，
     *    用户可能只关了「上课提醒」而作业提醒还在响。
     */
    static boolean channelOff(Context c, String kind) {
        if (Build.VERSION.SDK_INT < 26) return false;
        NotificationManager nm = mgr(c);
        if (nm == null) return false;
        NotificationChannel ch = nm.getNotificationChannel(channelOf(kind));
        return ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE;
    }

    /** 需不需要向用户要通知权限（只有 API 33+ 且没给过时才要）。 */
    static boolean needAsk(Context c) {
        return Build.VERSION.SDK_INT >= 33
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED;
    }

    // ---------------------------------------------------------------- 发

    /**
     * 弹一条通知。点开直接进 App 的某一页（{@code page} 是 app.js 里的页面名）。
     *
     * @return false 表示没发出去（权限被关），调用方**必须**把这件事说出来，
     *         不能假装发了。用户以为有提醒、结果没响，比一开始就告诉他没有更糟。
     */
    static boolean show(Context c, String kind, int id,
                        String title, String body, String page) {
        ensureChannels(c);
        if (!allowed(c)) return false;
        NotificationManager nm = mgr(c);
        if (nm == null) return false;

        Intent it = new Intent(c, MainActivity.class);
        it.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (page != null && !page.isEmpty()) {
            it.putExtra(MainActivity.EXTRA_PAGE, page);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(c, id, it, flags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(c, channelOf(kind));
        } else {
            b = new Notification.Builder(c);
            b.setPriority("class".equals(kind)
                    ? Notification.PRIORITY_HIGH : Notification.PRIORITY_DEFAULT);
        }
        b.setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(nz(title))
                .setContentText(nz(body))
                .setAutoCancel(true)
                .setShowWhen(true)
                .setContentIntent(pi);
        // 长文案（课名 + 教室）在锁屏上会被截断，展开能看全。
        if (body != null && body.length() > 18) {
            b.setStyle(new Notification.BigTextStyle().bigText(nz(body)));
        }
        try {
            nm.notify(id, b.build());
        } catch (Throwable t) {
            // 极少见：通知数量到上限、厂商 ROM 的额外限制。算出错了就当没发出去。
            return false;
        }
        return true;
    }

    /** 清掉某一类通知（用户关掉提醒时顺手清，否则残留的几条点开还是旧信息）。 */
    static void clear(Context c, String kind) {
        NotificationManager nm = mgr(c);
        if (nm == null) return;
        nm.cancel("class".equals(kind) ? ID_CLASS : ID_DUE);
    }

    static void clearAll(Context c) {
        NotificationManager nm = mgr(c);
        if (nm == null) return;
        nm.cancelAll();
    }

    // ---------------------------------------------------------------- 杂

    private static NotificationManager mgr(Context c) {
        try {
            return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        } catch (Throwable t) {
            return null;
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
