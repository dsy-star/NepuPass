package com.nepu.dongyoutong;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import java.util.List;

/**
 * 「把用户送到真正该点的那一页」。0.52.0 加。
 *
 * ================================================================
 * 为什么需要这个类
 * ================================================================
 * 用户 2026-11-09：「后台跳转这一块，现在还是没法成功跳转到最终界面，
 * 而是只到了应用界面」。
 *
 * 上一版跳的是 `ACTION_APPLICATION_DETAILS_SETTINGS`（应用信息页）——
 * 那一页只有一个「电池」入口，点进去还要再找「不受限制 / 允许后台活动」，
 * 国产 ROM 又把这一层改得各不相同。用户走到一半就放弃了，
 * 结果就是这个开关看着开了、后台照样被杀。
 *
 * 做法照抄社区里那几个成熟方案（dontkillmyapp、AutoStart 一类的库）：
 * **按厂商直接跳它自己的那一页**。这条路没有官方 API，component 名字
 * 各版本还会改，所以每一条都必须：
 *   ① 先用 queryIntentActivities 问一句「这个页面在不在」，
 *   ② 再 startActivity，并且把 ActivityNotFoundException / SecurityException
 *      一起接住；
 *   ③ 全部失败才退回「应用信息页 → 电池优化列表 → 设置首页」这条老路。
 * 只写 try/catch 不查询也能跑，但会在部分机型上先闪一下再退出，很难看。
 *
 * ⚠️ 这一页**只能由用户自己点开关**。没有任何公开 API 能替用户打开
 *    「自启动」或「忽略电池优化」，能绕过去的都是非官方手段，不能用在
 *    要上架的 App 里。
 */
final class PowerJump {

    private PowerJump() {
    }

    /** 跳转结果，给界面提示用。空串 = 跳到了某一页（不用多说什么）。 */
    static String open(Context c) {
        String man = String.valueOf(Build.MANUFACTURER).toLowerCase();
        String brand = String.valueOf(Build.BRAND).toLowerCase();
        String who = man + " " + brand;

        // 1) 厂商自己的那一页。顺序 = 先「本应用的省电策略」，再「自启动列表」。
        if (who.contains("xiaomi") || who.contains("redmi") || who.contains("poco")) {
            // 🔴 2026-11-13 用户实机反馈（HyperOS）：「点了站那不动」。
            //    他要的就是「后台耗电管理」那一页 —— 上面三选一：智能控制 /
            //    允许后台耗电 / 限制后台耗电。那正是 HiddenAppsConfigActivity，
            //    而且它认 package_name，能直接落在东油通那一行。
            //    多给几个候选：HyperOS 各版本改过组件名，问一句再说，
            //    比「跳不动就当没有」强。
            if (goPkg(c, "com.miui.powerkeeper",
                    "com.miui.powerkeeper.ui.HiddenAppsConfigActivity")) {
                return "选「允许后台耗电」";
            }
            if (goPkg(c, "com.miui.powerkeeper",
                    "com.miui.powerkeeper.ui.HiddenAppsContainerManagementActivity")) {
                return "找到东油通，选「允许后台耗电」";
            }
            if (goPkg(c, "com.miui.powerkeeper",
                    "com.miui.powerkeeper.ui.PowerUsageModelActivity")) {
                return "找到东油通，选「允许后台耗电」";
            }
            // 自启动列表**没法**定位到某一行（那个页面不认参数），
            // 所以提示必须说出「往下划找东油通」—— 不然用户到了那儿只会看到
            // 一屏陌生应用，然后退回来以为点了没用。
            if (goPkgExt(c, "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity",
                    "extra_package_name")) {
                return "在列表里往下划，找到东油通打开开关";
            }
        }
        if (who.contains("huawei") || who.contains("honor")) {
            if (go(c, comp("com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"))) {
                return "把东油通改成「手动管理」，三个开关都打开";
            }
            if (go(c, comp("com.huawei.systemmanager",
                    "com.huawei.systemmanager.optimize.process.ProtectActivity"))) {
                return "在「受保护的应用」里给东油通打勾";
            }
        }
        if (who.contains("oppo") || who.contains("oneplus") || who.contains("realme")) {
            if (go(c, comp("com.coloros.safecenter",
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity"))) {
                return "打开「自启动」，找到东油通打开开关";
            }
            if (go(c, comp("com.oplus.safecenter",
                    "com.oplus.safecenter.permission.startup.StartupAppListActivity"))) {
                return "打开「自启动」，找到东油通打开开关";
            }
            if (go(c, comp("com.coloros.oppoguardelf",
                    "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity"))) {
                return "允许东油通「后台运行」";
            }
        }
        if (who.contains("vivo") || who.contains("iqoo")) {
            if (go(c, comp("com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"))) {
                return "打开「自启动」，找到东油通打开开关";
            }
            if (go(c, comp("com.iqoo.secure",
                    "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"))) {
                return "把东油通加进白名单";
            }
        }
        if (who.contains("samsung")) {
            if (go(c, comp("com.samsung.android.lool",
                    "com.samsung.android.sm.battery.ui.BatteryActivity"))) {
                return "把东油通从「休眠应用」里拿出来";
            }
        }
        if (who.contains("meizu")) {
            if (go(c, comp("com.meizu.safe", "com.meizu.safe.security.SHOW_APPSEC"))) {
                return "允许东油通「后台运行」";
            }
        }
        if (who.contains("letv") || who.contains("leeco")) {
            if (go(c, comp("com.letv.android.letvsafe",
                    "com.letv.android.letvsafe.AutobootManageActivity"))) {
                return "打开东油通的自启动开关";
            }
        }
        if (who.contains("asus")) {
            if (go(c, comp("com.asus.mobilemanager",
                    "com.asus.mobilemanager.powersaver.PowerSaverSettings"))) {
                return "把东油通设为「允许后台活动」";
            }
        }
        if (who.contains("nokia")) {
            if (go(c, comp("com.evenwell.powersaving.g3",
                    "com.evenwell.powersaving.g3.exception.PowerSaverExceptionActivity"))) {
                return "把东油通加进省电白名单";
            }
        }

        // 2) 原生那一套：**先弹那一个「允许」对话框**，再退到列表。
        //    列表页有几十个应用，用户得自己找东油通；而这个对话框只有一个按钮，
        //    点完就完事。这是「一步到位」和「自己去列表里翻」的差别。
        //    需要 manifest 里的 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS；
        //    没声明的话部分 ROM 直接抛 SecurityException ⇒ go() 接住，走下一档。
        try {
            Intent it = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + c.getPackageName()));
            if (go(c, it)) return "点「允许」即可";
        } catch (Throwable ignored) {
        }

        try {
            Intent it = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(it);
            return "找到东油通，选「不优化」";
        } catch (Throwable ignored) {
        }

        // 3) 最后一档：本应用的信息页。到这一页说明厂商那一页没接住，
        //    用户还得自己点「电池」—— 所以提示要说清楚往哪点。
        try {
            Intent it = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + c.getPackageName()));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(it);
            return "点「电池」→「不受限制」";
        } catch (Throwable ignored) {
        }

        try {
            c.startActivity(new Intent(Settings.ACTION_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Throwable ignored) {
        }
        return "";
    }

    private static Intent comp(String pkg, String cls) {
        Intent it = new Intent();
        it.setComponent(new ComponentName(pkg, cls));
        return it;
    }

    /** 带「要定位到哪个应用」的那两个 extra。
     *
     *  小米 / vivo 这些「按应用」的页面认 `package_name` —— 带上它，页面一开
     *  就停在东油通那一行；不带就只能从列表第一个开始翻。
     *  extra 名各 ROM 不完全一样，所以两个都塞：认不出的那个会被忽略，无害。
     */
    private static Intent pkgIntent(Context c, String pkg, String cls) {
        Intent it = comp(pkg, cls);
        it.putExtra("package_name", c.getPackageName());
        it.putExtra("package_label", appName(c));
        return it;
    }

    private static boolean goPkg(Context c, String pkg, String cls) {
        return go(c, pkgIntent(c, pkg, cls));
    }

    /** 有些页面认的 extra 名不同（`extra_package_name`），多塞一个。 */
    private static boolean goPkgExt(Context c, String pkg, String cls, String key) {
        Intent it = pkgIntent(c, pkg, cls);
        it.putExtra(key, c.getPackageName());
        return go(c, it);
    }

    /** 只有「这个页面真的存在」才跳 —— 否则部分 ROM 会先闪一下白屏再退回。 */
    private static boolean go(Context c, Intent it) {
        try {
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            List<ResolveInfo> list = c.getPackageManager()
                    .queryIntentActivities(it, PackageManager.MATCH_DEFAULT_ONLY);
            if (list == null || list.isEmpty()) return false;
            c.startActivity(it);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private static String appName(Context c) {
        try {
            PackageManager pm = c.getPackageManager();
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(
                    c.getPackageName(), 0)));
        } catch (Throwable t) {
            return "东油通";
        }
    }
}
