package com.nepu.dongyoutong;

import android.app.Activity;
import android.content.Context;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.NfcManager;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.nio.charset.Charset;

/**
 * NFC：读一张卡 / 写一张卡。
 *
 * ## 它解决的是哪件事
 *
 * 站在饮水机前面，最烦的不是「点几颗按钮」，而是「先找到这台机器」：
 * 扫码要开相机、对焦，手输要记编号。慧生活798 那边用的是「碰一下」。
 *
 * 我们做的是**同一种体感，但不是同一张卡**：
 *
 *   · 机器上那张印着蓝环的贴纸，里面带着只有支付宝 / 慧生活能接的标记。
 *     我们注册同一个 scheme，会变成每次碰都弹一个「用哪个应用打开」——
 *     等于把他们的点击抢走一半，两家都变难用。**不抢。**
 *   · 宿舍水机的读卡区只认校园卡（M1）。Android 的模拟卡只能模拟
 *     APDU 那种卡，模拟不了 M1 的卡号，而且需要学校的卡片密钥。
 *     **这条永远做不到**，别在这上面浪费时间。
 *   · 所以：**贴一张我们自己写的贴纸**，内容是 hyt://water/设备编号。
 *     碰一下 → 系统直接把我们的 App 拉起来 → 设备编号自己到了接水页。
 *     这张贴纸是通用的：谁装了这个 App，碰一下都能用自己的账号出水。
 *
 * ## 两种用法，各管一段
 *
 *  1. **贴纸**（主路径）：写一张 hyt:// 的标签贴在机器上。之后碰一下由
 *     系统按 intent-filter 直接拉起 App，**不需要**这里开读卡模式。
 *  2. **读卡模式**（这段代码）：只在用户点「碰一碰」那一下开 30 秒。
 *     为什么要手动开、而不是一直开着：
 *     🔴 开着读卡模式时，**所有**标签都会被我们接走 —— 用户站在机器前
 *        想用支付宝碰一下付款，结果跳进了我们的「这不是饮水机的卡」，
 *        这是拿我们的功能去挡别人的路。所以只在明确要读卡时开。
 *
 * ## 读不到设备号怎么办
 *
 * 把读到的东西**原样**交给网页（`__hytNfc`），由 app.js 用 wtNormDevice
 * 去认。认不出来就把原文显示出来 —— 那是用户能反馈、我们能定位的唯一线索。
 * 这里**不猜、不编**：读不到就说读不到。
 */
public class WaterNfc {

    /** 读卡模式最多开多久。30 秒够走到机器前面贴一下，又不至于一直挂着。 */
    private static final int LISTEN_SECONDS = 30;

    private final Activity act;
    private final WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());

    /** 待写入的内容；null = 这次是「读」。 */
    private volatile String pendingUri = null;
    /** 读卡模式是不是开着（JS 那边也有一份状态，这里这份用来防重复开）。 */
    private volatile boolean listening = false;

    private final Runnable timeout = new Runnable() {
        @Override
        public void run() {
            stop("timeout");
        }
    };

    WaterNfc(Activity a, WebView w) {
        act = a;
        web = w;
    }

    /**
     * 这台手机能不能用 NFC。返回 "ok" / "off" / "nofc"。
     *
     * 🔴 三种状态必须分开：没有硬件（换手机也没用）、有硬件但没开（去设置里
     *    拨一下就好）、能用。合成一个 false 的话，界面只能说「用不了」，
     *    而用户该做的事完全不同。
     */
    @JavascriptInterface
    public String state() {
        NfcAdapter ad = adapter();
        if (ad == null) return "nofc";
        try {
            return ad.isEnabled() ? "ok" : "off";
        } catch (Throwable t) {
            return "nofc";
        }
    }

    /** 开读卡模式。返回 state() 的结果（"ok" 表示已经开着等了）。 */
    @JavascriptInterface
    public String listen(final int seconds) {
        pendingUri = null;          // 只读，不写
        return startReader(seconds);
    }

    /** 真正开读卡模式。**不碰 pendingUri** —— 写卡这条路要先挂内容再开。 */
    private String startReader(final int seconds) {
        NfcAdapter ad = adapter();
        if (ad == null) return "nofc";
        if (!ad.isEnabled()) return "off";
        if (listening) return "ok";
        listening = true;
        final int sec = seconds > 0 ? Math.min(seconds, LISTEN_SECONDS) : LISTEN_SECONDS;
        ui.post(new Runnable() {
            @Override
            public void run() {
                try {
                    // 四种卡都收：宿舍水机、校园卡、门禁卡用的芯片不完全一样，
                    // 只开 NFC_A 会把一部分机器上的贴纸读成「没反应」。
                    int flags = NfcAdapter.FLAG_READER_NFC_A
                            | NfcAdapter.FLAG_READER_NFC_B
                            | NfcAdapter.FLAG_READER_NFC_F
                            | NfcAdapter.FLAG_READER_NFC_V;
                    NfcAdapter a2 = adapter();
                    if (a2 == null) return;
                    a2.enableReaderMode(act, cb, flags, (Bundle) null);
                    ui.removeCallbacks(timeout);
                    ui.postDelayed(timeout, sec * 1000L);
                } catch (Throwable t) {
                    listening = false;
                    emit("__hytNfcEnd", "fail");
                }
            }
        });
        return "ok";
    }

    /**
     * 写一张卡。返回 state() 的结果；真正写没写成，等 `__hytNfcWrite` 回调。
     *
     * 为什么是异步：卡要等用户贴上来才存在，没法「调用完就返回成功」。
     * 这里只负责把内容挂上去、把读卡模式开起来。
     */
    @JavascriptInterface
    public String write(final String uri) {
        String u = uri == null ? "" : uri.trim();
        // 🔴 只允许写我们自己的 scheme。放开的话，一段被改过的页面就能让
        //    App 往别人的贴纸上写任意地址 —— 而贴纸是贴在公共机器上的。
        if (!u.startsWith("hyt://water/")) return "deny";
        if (u.length() > 200) return "deny";
        NfcAdapter ad = adapter();
        if (ad == null) return "nofc";
        if (!ad.isEnabled()) return "off";
        pendingUri = u;
        return startReader(LISTEN_SECONDS);
    }

    /** 关掉读卡模式。`why` 非空时告诉网页一句为什么（timeout）。 */
    @JavascriptInterface
    public String stop(final String why) {
        stopInternal(why);
        return "ok";
    }

    /** 切后台就收工：读卡模式开着的时候，别人的标签也会被我们接走。 */
    void pause() {
        stopInternal(null);
    }

    private void stopInternal(final String why) {
        listening = false;
        pendingUri = null;
        ui.removeCallbacks(timeout);
        ui.post(new Runnable() {
            @Override
            public void run() {
                try {
                    NfcAdapter a = adapter();
                    if (a != null) a.disableReaderMode(act);
                } catch (Throwable ignored) {
                    // 没开着就关：NfcAdapter 会抛 IllegalStateException。
                    // 这不算错，别让它冒到网页上。
                }
                if (why != null && why.length() > 0) emit("__hytNfcEnd", why);
            }
        });
    }

    /** 系统发现标签时回调。**在 binder 线程上**，碰 WebView 一律转主线程。 */
    private final NfcAdapter.ReaderCallback cb = new NfcAdapter.ReaderCallback() {
        @Override
        public void onTagDiscovered(Tag tag) {
            String want = pendingUri;
            if (want != null) {
                pendingUri = null;
                String r = writeTag(tag, want);
                stopInternal(null);
                emit("__hytNfcWrite", r);
                return;
            }
            String text = readTag(tag);
            stopInternal(null);
            emit("__hytNfc", text);
        }
    };

    private NfcAdapter adapter() {
        try {
            NfcManager m = (NfcManager) act.getSystemService(Context.NFC_SERVICE);
            return m == null ? null : m.getDefaultAdapter();
        } catch (Throwable t) {
            return null;
        }
    }

    /** 调网页里的一个函数。参数一律 JSON 转义 —— 它来自一张陌生的卡。 */
    private void emit(final String fn, final String arg) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (web == null) return;
                try {
                    web.evaluateJavascript(
                            "window." + fn + "&&window." + fn + "(" + JSONObject.quote(arg) + ")",
                            null);
                } catch (Throwable ignored) {
                    // 页面正在重建：这一次就算了，别崩。
                }
            }
        });
    }

    // ---------------------------------------------------------------- 读

    /** 把一张卡读成一段字符串。读不出内容时退到「卡号」，再不行返回空串。 */
    private static String readTag(Tag tag) {
        Ndef ndef = Ndef.get(tag);
        if (ndef != null) {
            try {
                ndef.connect();
                NdefMessage m = ndef.getNdefMessage();
                String s = textOf(m);
                if (s.length() > 0) return s;
            } catch (Throwable ignored) {
                // 读失败继续往下走：至少还能把卡号带回去
            } finally {
                try { ndef.close(); } catch (Throwable ignored) { }
            }
        }
        try {
            byte[] id = tag.getId();
            if (id != null && id.length > 0) {
                StringBuilder b = new StringBuilder("id:");
                for (byte x : id) b.append(String.format("%02X", x & 0xFF));
                return b.toString();
            }
        } catch (Throwable ignored) {
            // 连卡号都没有：返回空串，让网页说「没读到」
        }
        return "";
    }

    /** 一条 NDEF 消息 → 一段字符串。取第一条认得出的记录。 */
    private static String textOf(NdefMessage m) {
        if (m == null) return "";
        for (NdefRecord r : m.getRecords()) {
            // 文本记录：payload 头一个字节是「编码 + 语言码长度」，
            // 直接当 UTF-8 解会多出一个乱码字符（0x02 'e' 'n' 开头）。
            try {
                if (r.getTnf() == NdefRecord.TNF_WELL_KNOWN
                        && java.util.Arrays.equals(r.getType(), NdefRecord.RTD_TEXT)) {
                    byte[] p = r.getPayload();
                    if (p != null && p.length > 1) {
                        int lang = p[0] & 0x3F;
                        Charset cs = ((p[0] & 0x80) == 0)
                                ? Charset.forName("UTF-8") : Charset.forName("UTF-16");
                        int st = 1 + lang;
                        if (st < p.length) {
                            String s = new String(p, st, p.length - st, cs).trim();
                            if (s.length() > 0) return s;
                        }
                    }
                }
            } catch (Throwable ignored) { }
            // 地址记录（我们自己的贴纸就是这种）：hyt://water/123
            try {
                android.net.Uri u = r.toUri();
                if (u != null && u.toString().length() > 0) return u.toString();
            } catch (Throwable ignored) { }
            try {
                byte[] p = r.getPayload();
                if (p != null && p.length > 0) {
                    String s = new String(p, Charset.forName("UTF-8")).trim();
                    if (s.length() > 0) return s;
                }
            } catch (Throwable ignored) { }
        }
        return "";
    }

    // ---------------------------------------------------------------- 写

    /**
     * 往一张卡上写地址。返回 "ok" / "readonly" / "small" / "unsupported" / "fail"。
     *
     * 这几种失败必须分开，因为用户下一步做的事不同：
     *   readonly    这张是出厂锁死的标签（很多门禁贴纸就是），换一张
     *   small       容量不够，换 NTAG213 以上
     *   unsupported 不是 NDEF 卡，多半是校园卡/银行卡，别往上写
     */
    private static String writeTag(Tag tag, String uri) {
        NdefMessage msg;
        try {
            msg = new NdefMessage(new NdefRecord[]{ NdefRecord.createUri(uri) });
        } catch (Throwable t) {
            return "fail";
        }
        Ndef ndef = Ndef.get(tag);
        if (ndef != null) {
            try {
                ndef.connect();
                if (!ndef.isWritable()) return "readonly";
                if (msg.toByteArray().length > ndef.getMaxSize()) return "small";
                ndef.writeNdefMessage(msg);
                return "ok";
            } catch (Throwable t) {
                return "fail";
            } finally {
                try { ndef.close(); } catch (Throwable ignored) { }
            }
        }
        NdefFormatable f = NdefFormatable.get(tag);
        if (f != null) {
            // 全新的空白贴纸是「可格式化」而不是「已格式化」——
            // 少了这一步，用户买回来一张新卡贴上去只会得到「不支持」。
            try {
                f.connect();
                f.format(msg);
                return "ok";
            } catch (Throwable t) {
                return "fail";
            } finally {
                try { f.close(); } catch (Throwable ignored) { }
            }
        }
        return "unsupported";
    }
}
