package com.nepu.dongyoutong;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Locale;

/** Isolated official WebVPN login window. The remote page receives no app bridge. */
public final class NepuActivity extends Activity {
    private static final String LOGIN_URL = "https://webvpn.nepu.edu.cn/users/sign_in";
    private static final String EDU_URL = "https://jwgl.webvpn.nepu.edu.cn/";
    private WebView web;
    private TextView status;
    private final java.util.ArrayList<WebView> popups = new java.util.ArrayList<WebView>();

    private static android.webkit.WebResourceResponse blockExternal(Uri uri) {
        if (allowed(uri)) return null;
        return new android.webkit.WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null,
                new java.io.ByteArrayInputStream(new byte[0]));
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(dp(12), dp(8), dp(12), dp(8));
        Button back = new Button(this);
        back.setText("返回");
        back.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { backOrFinish(); }
        });
        status = new TextView(this);
        status.setText("请完成 WebVPN 与教务系统登录");
        status.setGravity(android.view.Gravity.CENTER_VERTICAL);
        status.setPadding(dp(8), 0, dp(8), 0);
        bar.addView(back, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        bar.addView(status, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button edu = new Button(this);
        edu.setText("进入教务");
        edu.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { web.loadUrl(EDU_URL); }
        });
        bar.addView(edu, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(bar);
        Button done = new Button(this);
        done.setText("完成登录，返回东油通同步");
        done.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { CookieManager.getInstance().flush(); finish(); }
        });
        root.addView(done);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return blockExternal(r.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowed(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !allowed(Uri.parse(url));
            }
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                status.setText(url.contains("jwgl.webvpn.nepu.edu.cn")
                        ? "已进入教务系统；返回东油通后同步"
                        : "请完成 WebVPN / 统一身份认证登录");
            }
            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler,
                                                     android.net.http.SslError error) {
                handler.cancel();
                Toast.makeText(NepuActivity.this, "学校站点 HTTPS 证书校验失败", Toast.LENGTH_LONG).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                                                    android.os.Message resultMsg) {
                WebView popup = new WebView(NepuActivity.this);
                popups.add(popup);
                popup.getSettings().setAllowFileAccess(false);
                popup.getSettings().setAllowContentAccess(false);
                popup.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                        return blockExternal(r.getUrl());
                    }
                    @Override public void onReceivedSslError(WebView v, android.webkit.SslErrorHandler h, android.net.http.SslError e) { h.cancel(); }
                    @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                        if (allowed(r.getUrl())) { web.loadUrl(r.getUrl().toString()); return true; }
                        return true;
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                        if (allowed(Uri.parse(url))) web.loadUrl(url);
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        CookieManager.getInstance().setAcceptCookie(true);
        String noticeId = getIntent().getStringExtra("noticeId");
        web.loadUrl(noticeId != null && noticeId.matches("[0-9]{1,32}")
                ? EDU_URL + "new/desktop/ggtzview.page?ggtzdm=" + noticeId : LOGIN_URL);
    }

    private static boolean allowed(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost();
        return host != null && (host.equalsIgnoreCase("nepu.edu.cn") || host.toLowerCase(Locale.ROOT).endsWith(".nepu.edu.cn"))
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private int dp(int n) { return (int) (n * getResources().getDisplayMetrics().density + 0.5f); }

    private void backOrFinish() {
        if (web != null && web.canGoBack()) web.goBack(); else finish();
    }

    @Override public void onBackPressed() { backOrFinish(); }

    @Override protected void onDestroy() {
        for (WebView popup : popups) { popup.stopLoading(); popup.destroy(); }
        popups.clear();
        if (web != null) {
            web.stopLoading();
            web.loadUrl("about:blank");
            web.removeAllViews();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
