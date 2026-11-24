package com.nepu.dongyoutong;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

/**
 * 「后台自动」对网页的那一面。0.50.0 v5 加。
 *
 * 单独一个接口对象，理由和 {@link Reminder} 一样：
 * {@link NativeBridge} 已经够长了，再往里塞排闹钟、要通知权限会变成杂物间。
 *
 * 分工：
 *   · **网页**决定「开不开、隔多久」（它是用户看得见的那一面）；
 *   · **这里**把设置交给 {@link Auto} 排成闹钟，并把真实状态报回去。
 *
 * 🔴 界面不能拿「开关是开的」当「真的会跑」：开关开着但通知权限被收走，
 *    后台照跑，用户一条都收不到。所以 {@link #state()} 里必须带着
 *    `notify` 这个实情，界面要按它说话。
 */
public class AutoBridge {

    private final Activity act;

    public AutoBridge(Activity a) {
        act = a;
    }

    @JavascriptInterface
    public String state() {
        try {
            return Auto.state(act);
        } catch (Throwable t) {
            return "{\"avail\":false}";
        }
    }

    /** 整体替换设置。空串 = 排好了；否则是原因（界面原样说出来）。 */
    @JavascriptInterface
    public String apply(String json) {
        try {
            return Auto.apply(act, json);
        } catch (Throwable t) {
            return "没能排上（" + String.valueOf(t.getMessage()) + "）";
        }
    }

    /**
     * 立刻排一次（30 秒后跑）。空串 = 排上了；否则是原因（界面原样说出来）。
     *
     * @param kind "wt" = 积分任务，其它 = 查学习通
     *
     * 用户 2026-11-13：「开了自启、允许后台高耗电，还是从来没自动跑过」。
     * JobScheduler 什么时候真跑由系统说了算，可能攒到几小时后 ——
     * 没有这个入口，他只能干等，等不到就以为功能是假的（也确实没法自证）。
     */
    @JavascriptInterface
    public String runNow(String kind) {
        try {
            return Auto.runNow(act, kind);
        } catch (Throwable t) {
            return "没能排上（" + String.valueOf(t.getMessage()) + "）";
        }
    }

    /**
     * 跳到「该点开关的那一页」，并回一句**到了那儿该干什么**。
     *
     * 用户 2026-11-09：「现在还是没法成功跳转到最终界面，而是只到了应用界面」。
     * 上一版只会跳应用信息页（那一页只有一个「电池」入口，还要再点两层）。
     * 现在按厂商直接跳它自己的页面 —— 具体哪一页、为什么这么排，
     * 见 {@link PowerJump} 的类注释。
     *
     * @return 空串 = 已经跳过去了但没什么要嘱咐的；否则是给用户看的一句话
     *         （网页那边原样 toast 出来，别自己编）。
     */
    @JavascriptInterface
    public String openBattery() {
        final String[] out = {""};
        // 🔴 必须排队到 UI 线程：startActivity 在 JS 桥的线程里调，
        //    部分 ROM 会直接抛「Calling startActivity() from outside of an
        //    Activity context requires the FLAG_ACTIVITY_NEW_TASK」。
        //    这里加 flag 之外还要等这一轮跑完，所以用 CountDownLatch 等一下 ——
        //    跳一个设置页是毫秒级的，不会卡住界面。
        final java.util.concurrent.CountDownLatch done =
            new java.util.concurrent.CountDownLatch(1);
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    out[0] = PowerJump.open(act);
                } catch (Throwable t) {
                    out[0] = "";
                } finally {
                    done.countDown();
                }
            }
        });
        try {
            done.await(1500, java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (Throwable ignored) {
        }
        return out[0];
    }
}
