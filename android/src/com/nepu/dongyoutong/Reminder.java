package com.nepu.dongyoutong;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/**
 * 提醒功能对网页的那一面。0.47.8 加。
 *
 * 单独一个接口对象，集中处理提醒权限与排程：
 * NativeBridge 已经八百多行了，再往里塞「排闹钟、要权限、刷小组件」
 * 就真成杂物间了。
 *
 * 分工，别混：
 *   · **网页**算「什么时候该提醒」（它有课表、作业、考试，还会跟着
 *     开学日期和作息设置变），算完推一份清单进来；
 *   · **这里**只负责把清单交给系统闹钟，以及在用户点开关时去要权限。
 *
 * 🔴 不在这边算时间：作息表用户能改、开学日期能改、周次会一天天变 ——
 *    这些逻辑在 app.js 里已经有一份了，这儿再抄一份必然会算得不一样，
 *    而两边不一致时**没有任何报错**，只是提醒的时间和课表上写的不一样。
 */
public class Reminder {

    private final Activity act;

    public Reminder(Activity a) {
        this.act = a;
    }

    /**
     * 当前实情（能不能响、准不准、被关了什么、排了几条）。
     *
     * 界面**必须**按这个说人话，不能拿「开关是开的」当「提醒响得了」：
     * 开关开着但系统权限被收走，是用户最常掉进去的坑 ——
     * 他记得自己开过，可它就是没响，而应用一声不响。
     */
    @JavascriptInterface
    public String state() {
        try {
            JSONObject o = new JSONObject(Remind.state(act));
            o.put("widget", WidgetProvider.count(act));
            return o.toString();
        } catch (Throwable t) {
            return "{}";
        }
    }

    /**
     * 整体替换提醒清单。空串 = 排好了；否则是原因（界面原样说出来）。
     *
     * 网页每次**打开、同步完、改完作息、切学期**都会调一次。重复调用没有副作用
     * （内部先全清再全排），所以不用去重。
     */
    @JavascriptInterface
    public String apply(String json) {
        try {
            return Remind.apply(act, json);
        } catch (Throwable t) {
            return "排提醒失败：" + String.valueOf(t.getMessage());
        }
    }

    /** 关掉全部提醒：闹钟、清单、已经挂出来的通知一起清。 */
    @JavascriptInterface
    public void clear() {
        try {
            Remind.clear(act);
        } catch (Throwable ignored) {
        }
    }

    /**
     * 向系统要通知权限（Android 13 起必须由用户点一下）。
     *
     * 只能由**用户的操作**触发（点开关），不能开机就问 ——
     * 一打开应用就弹权限框，大部分人第一反应是「拒绝」，
     * 而且拒绝两次之后系统就不再弹了，等于永久失去机会。
     */
    @JavascriptInterface
    public void ask() {
        if (Build.VERSION.SDK_INT < 33) return;   // 33 以下没有这个权限
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    act.requestPermissions(
                            new String[]{Manifest.permission.POST_NOTIFICATIONS}, 71);
                } catch (Throwable ignored) {
                    // 有的 ROM 在后台时会拒掉这次请求。用户再点一次就好。
                }
            }
        });
    }

    /** 跳到系统里本应用的通知设置。用户把通知关掉之后，唯一能说清楚的办法。 */
    @JavascriptInterface
    public void openNotifySettings() {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent it = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    it.putExtra(Settings.EXTRA_APP_PACKAGE, act.getPackageName());
                    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(it);
                } catch (Throwable t) {
                    // 老系统没有这个页面，退到应用详情页。
                    openAppDetail();
                }
            }
        });
    }

    /** 「精确提醒」被收走之后，跳到能打开它的那个系统页面（Android 12 起才有）。 */
    @JavascriptInterface
    public void openAlarmSettings() {
        if (Build.VERSION.SDK_INT < 31) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent it = new Intent(
                            Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                            Uri.parse("package:" + act.getPackageName()));
                    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(it);
                } catch (Throwable t) {
                    openAppDetail();
                }
            }
        });
    }

    // ---------------------------------------------------------------- 小组件

    /**
     * 把桌面小组件要显示的那点东西推进来。
     *
     * 为什么不在这里现算：小组件是 RemoteViews，跑不了 JS、也没有 WebView，
     * 它只能读本机存下来的一份摘要。网页那边有课表和周次，算好了推过来最省事。
     */
    @JavascriptInterface
    public String pushWidget(String json) {
        try {
            return WidgetProvider.save(act, json);
        } catch (Throwable t) {
            return "小组件没更新：" + String.valueOf(t.getMessage());
        }
    }

    /** 用户清空了课表或者解除绑定：小组件上不该还挂着别人的课。 */
    @JavascriptInterface
    public void clearWidget() {
        try {
            WidgetProvider.wipe(act);
        } catch (Throwable ignored) {
        }
    }

    // ---------------------------------------------------------------- 杂

    private void openAppDetail() {
        try {
            Intent it = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + act.getPackageName()));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(it);
        } catch (Throwable ignored) {
            // 真打不开就算了，界面那句话里已经写清楚了路径。
        }
    }
}
