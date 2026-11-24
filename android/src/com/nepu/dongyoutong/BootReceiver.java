package com.nepu.dongyoutong;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 手机重启完了，把闹钟重新排一遍。0.47.8 加。
 *
 * 🔴 为什么必须有这个类：AlarmManager 排的闹钟**不写磁盘**，关机就没了。
 *    没有这一环的话，用户重启一次手机，之后所有提醒（包括三天后的考试）
 *    全部静默消失 —— 而在用户看来，「我明明开过提醒」。
 *    这是提醒功能最容易漏、也最难被自己发现的一环（只有重启过才知道）。
 *
 * 另外两种情况也会走到这里，都靠 {@link Remind#rearm} 兜住：
 *   · 应用被覆盖安装（升级）之后，系统清掉闹钟
 *   · 用户在系统设置里清空过应用的后台限制
 *
 * 🔴 `android:exported="true"`（见 AndroidManifest）：开机广播是系统发的，
 *    应用收不到「只有自己人发的」那条限制。导出的代价是别人也能发这条广播 ——
 *    所以这里**只认 action**，不读任何 extra，最坏结果是白排一遍闹钟（无害）。
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent it) {
        if (it == null) return;
        String a = it.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
            return;
        }
        try {
            Remind.rearm(c);
        } catch (Throwable ignored) {
            // 重排失败不该在开机时弹一个「应用已停止」。用户下次打开应用再说。
        }
        // 后台自动检查的闹钟同样是「关机就没了」的（0.50.0 v5）。
        // 不重排的话，用户重启一次手机，自动检查就静悄悄地永远不跑了。
        try {
            Auto.schedule(c);
        } catch (Throwable ignored) {
        }
    }
}
