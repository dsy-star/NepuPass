package com.nepu.dongyoutong;

import java.io.File;

/**
 * 磁盘上的清理动作。**故意不 import android**，只认 {@link File} ——
 * 这样 `_lab/portal/StoreTest.java` 能在电脑的普通 JVM 上真跑一遍，
 * 而不是靠「看代码觉得对」。
 *
 * 另一半（`Store`）只负责「这些目录在手机哪儿」，逻辑全在这里。
 */
public final class StoreFiles {

    private StoreFiles() {
    }

    /**
     * 可以放心删的 WebView 缓存目录（相对 `app_webview/Default/`）。
     *
     * 🔴 这是**白名单**，不是黑名单。`Local Storage`（课表/设置）、`Cookies`
     *    （登录态）、`IndexedDB`、`Databases` 一个都不能进 —— 删了用户就要
     *    重新绑账号、重新同步，而这两件事恰恰是「清缓存」最不该造成的后果。
     *    以后 WebView 换目录结构，最多是漏清，不会误删。
     */
    public static final String[] CACHE_DIRS = {
            "Cache",
            "Code Cache",
            "GPUCache",
            "HTTP Cache",
            "blob_storage",
    };

    /** 目录总大小。读不到的条目跳过 —— 统计不该抛异常。 */
    public static long sizeOf(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        File[] kids = f.listFiles();
        if (kids == null) return 0;
        long n = 0;
        for (File k : kids) n += sizeOf(k);
        return n;
    }

    /** 只算「缓存」那几层，用来判断该不该清（Local Storage 不算）。 */
    public static long webCacheBytes(File webDir) {
        if (webDir == null) return 0;
        File d = new File(webDir, "Default");
        long n = 0;
        for (String k : CACHE_DIRS) n += sizeOf(new File(d, k));
        return n;
    }

    /**
     * 缓存攒到 {@code limit} 字节才清，否则一个字节都不动。
     *
     * 为什么不是每次都清：清完第一次打开要重新编译脚本、重下学校页面资源，
     * 会慢几百毫秒。攒到阈值再清，日常感觉不到。
     *
     * @return 释放的字节数（0 = 没到阈值）
     */
    public static long trimWebViewDir(File webDir, long limit) {
        if (webDir == null) return 0;
        if (webCacheBytes(webDir) < limit) return 0;
        File d = new File(webDir, "Default");
        long freed = 0;
        for (String k : CACHE_DIRS) freed += clearDir(new File(d, k));
        return freed;
    }

    /** 清空一个目录里的内容，但保留目录本身。返回释放的字节数。 */
    public static long clearDir(File dir) {
        if (dir == null) return 0;
        File[] kids = dir.listFiles();
        if (kids == null) return 0;
        long freed = 0;
        for (File k : kids) {
            long n = sizeOf(k);
            if (delTree(k)) freed += n;
        }
        return freed;
    }

    public static boolean delTree(File f) {
        if (f == null) return false;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) delTree(k);
        }
        try {
            return f.delete();
        } catch (Throwable t) {
            return false;
        }
    }
}
