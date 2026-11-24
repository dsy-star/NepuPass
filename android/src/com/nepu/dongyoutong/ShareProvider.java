package com.nepu.dongyoutong;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 把导出的 `.ics` 以 `content://` 借给日历 App / 文件管理器 / 微信读。
 *
 * 仅开放缓存目录中的 `.ics` 文件，供课表导出使用。
 *
 * 🔴 为什么需要 provider 而不是直接 `file://`：Android 7.0 起跨应用传
 *    `file://` 会抛 FileUriExposedException。项目手工打包、没有 androidx，
 *    所以自己写这个最小号 FileProvider。
 *
 * 文件放在**缓存目录**（不是外部存储）：导出的日历是一次性的，卸载或被系统
 * 清缓存都没关系，用户手机里不会多出我们留下的文件。
 */
public class ShareProvider extends ContentProvider {

    public static final String AUTHORITY = "com.nepu.dongyoutong.share";
    private static final String MIME = "text/calendar";

    /** 导出文件放哪。写入方（NativeBridge）和读取方必须走同一个方法。 */
    public static File dir(Context c) {
        File d = new File(c.getCacheDir(), "share");
        //noinspection ResultOfMethodCallIgnored
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static Uri uriFor(String name) {
        return Uri.parse("content://" + AUTHORITY + "/" + name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    /**
     * 只放行 `东油通-课表-2026-09-07.ics` 这种名字。
     *
     * 🔴 必须**同时**卡住三件事，少一件都能被拼出越界路径：
     *    ① 不含 `/` 和 `..`（片段本身已经是最后一段，但 `..` 仍可能出现在名字里）
     *    ② 以 `.ics` 结尾（别的后缀一律不借）
     *    ③ 正则里没有空格/引号/控制字符 —— 名字是从 JS 传进来的字符串
     */
    private File fileOf(Uri uri) {
        if (uri == null) return null;
        String n = uri.getLastPathSegment();
        if (n == null || !n.matches("[\\w.\\-\\u4e00-\\u9fa5]{1,80}")) return null;
        if (!n.endsWith(".ics") || n.contains("..")) return null;
        Context c = getContext();
        if (c == null) return null;
        return new File(dir(c), n);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileOf(uri);
        if (f == null || !f.isFile()) throw new FileNotFoundException(String.valueOf(uri));
        // 只要读。没有理由让别的应用改我们导出的内容。
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File f = fileOf(uri);
        if (f == null || !f.isFile()) return null;
        if (projection == null) {
            projection = new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        }
        MatrixCursor mc = new MatrixCursor(projection, 1);
        Object[] row = new Object[projection.length];
        for (int i = 0; i < projection.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(projection[i])) {
                row[i] = f.getName();
            } else if (OpenableColumns.SIZE.equals(projection[i])) {
                row[i] = f.length();
            } else {
                row[i] = null;
            }
        }
        mc.addRow(row);
        return mc;
    }

    @Override
    public String getType(Uri uri) {
        return MIME;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
