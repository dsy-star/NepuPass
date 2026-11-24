package com.nepu.dongyoutong;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 闹钟到点了。0.47.8 加。
 *
 * 这个类只在 {@link Remind#ACTION} 上被系统唤起 —— 应用这时候可能**根本不在
 * 内存里**（被用户划掉了、被系统清掉了）。所以这里不能假设任何东西已经初始化，
 * 全靠 {@link Remind} 从本机存的清单里现查。
 *
 * 🔴 `android:exported="false"`（见 AndroidManifest）：只有系统能把这条广播
 *    递进来（PendingIntent 的发送方是系统闹钟服务），别的应用发不进来。
 *    别为了省事改成 true —— 那等于让任何应用都能替你弹一条「快上课了」。
 */
public class RemindReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent it) {
        if (it == null || !Remind.ACTION.equals(it.getAction())) return;
        // 🔴 这里抛异常 = 应用崩溃弹窗（而且是在用户没打开应用的时候弹）。
        //    提醒这种「锦上添花」的功能绝对不能因为一条坏数据把应用搞崩。
        try {
            Remind.fire(c, it.getIntExtra(Remind.EXTRA_ID, 0));
        } catch (Throwable ignored) {
            // 发不出来就不发。下一次打开应用时 state() 会把真实情况报给界面。
        }
    }
}
