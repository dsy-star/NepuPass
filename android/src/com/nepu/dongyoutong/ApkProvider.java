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
 * 把下载好的安装包以 `content://` 借给系统安装器读。
 *
 * 2026-11-24 从旧仓库（com.hobson.hangyuantong）搬回来，只改了包名和 AUTHORITY。
 *
 * 🔴 为什么需要这个类：Android 7.0 起禁止把 `file://` 交给别的应用（会抛
 *    FileUriExposedException）。标准解法是 androidx 的 FileProvider ——
 *    但本项目手工打包、没有 Gradle、没有 androidx，引不进来。
 *    这里就是一个最小号 FileProvider：只认一个目录、只认 `.apk` 形状的文件名、
 *    只读，其余一概不认。
 *
 * 🔴 三处必须一致，少一处都**不报错**，只是「点了安装没反应」：
 *      1. AndroidManifest 里 `<provider android:authorities="...">`
 *      2. 这里的 AUTHORITY
 *      3. 安装 Intent 上的 FLAG_GRANT_READ_URI_PERMISSION
 *
 * 文件放在应用私有目录（`getExternalFilesDir`，拿不到时退回内部目录），
 * 卸载 App 时会一起清掉，不会在用户手机上留垃圾。
 */
public class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.nepu.dongyoutong.apk";
    private static final String MIME = "application/vnd.android.package-archive";

    /** 安装包放哪。下载器和这里必须走同一个方法，否则「下完了读不到」。 */
    public static File dir(Context c) {
        File d = c.getExternalFilesDir(null);
        if (d != null) return d;
        return c.getFilesDir();
    }

    public static Uri uriFor(String name) {
        return Uri.parse("content://" + AUTHORITY + "/" + name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    /** 只放行 `dongyoutong-0.1.1.apk` 这种名字；`../` 一律当作不存在。 */
    private File fileOf(Uri uri) {
        if (uri == null) return null;
        String n = uri.getLastPathSegment();
        if (n == null || !n.matches("[A-Za-z0-9._-]{1,80}")) return null;
        if (!n.endsWith(".apk") || n.contains("..")) return null;
        Context c = getContext();
        if (c == null) return null;
        return new File(dir(c), n);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileOf(uri);
        if (f == null || !f.isFile()) throw new FileNotFoundException(String.valueOf(uri));
        // 安装器只要读。写权限一律不给 —— 没有任何理由让它改我们的包。
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    /** 安装器会问文件名和大小（用于显示进度）。给不出来也不影响安装。 */
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
