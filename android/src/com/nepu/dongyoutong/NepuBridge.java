package com.nepu.dongyoutong;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Android-only login and read-only NEPU WebVPN synchronization bridge. */
public final class NepuBridge {
    private static final String BASE = "https://jwgl.webvpn.nepu.edu.cn";
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    private static final int TIMEOUT_MS = 15000;
    private static final int MAX_PAGES = 100;
    private final Activity activity;
    private final WebView localWeb;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    public NepuBridge(Activity activity, WebView localWeb) {
        this.activity = activity;
        this.localWeb = localWeb;
    }

    @JavascriptInterface
    public void openLogin() {
        main.post(new Runnable() {
            @Override public void run() {
                activity.startActivity(new Intent(activity, NepuActivity.class));
            }
        });
    }

    @JavascriptInterface
    public String state() {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", true);
            out.put("loginAvailable", true);
            out.put("requiresLoginVerification", true);
        } catch (Exception ignored) { }
        return out.toString();
    }

    @JavascriptInterface
    public void sync(final int id, final String term) {
        worker.execute(new Runnable() {
            @Override public void run() {
                JSONObject result;
                try {
                    result = syncSnapshot(term == null ? "" : term.trim());
                } catch (SyncException e) {
                    result = failure(e.kind, e.getMessage());
                } catch (java.net.SocketTimeoutException e) {
                    result = failure("timeout", "教务请求超时，请稍后重试");
                } catch (Exception e) {
                    result = failure("network", "教务网络请求失败，请检查网络后重试");
                }
                final String payload = result.toString();
                main.post(new Runnable() {
                    @Override public void run() {
                        if (localWeb == null || activity.isFinishing() || activity.isDestroyed()) return;
                        android.net.Uri local = android.net.Uri.parse(localWeb.getUrl() == null ? "" : localWeb.getUrl());
                        if (!"https".equals(local.getScheme()) || !"app.local".equals(local.getHost())) return;
                        String script = "window.__nepuDone&&window.__nepuDone(" + id + "," + JSONObject.quote(payload) + ")";
                        try { localWeb.evaluateJavascript(script, null); } catch (Throwable ignored) { }
                    }
                });
            }
        });
    }

    private void deliver(final int id, JSONObject result) {
        final String payload = result.toString();
        main.post(new Runnable() {
            @Override public void run() {
                if (localWeb == null || activity.isFinishing() || activity.isDestroyed()) return;
                android.net.Uri local = android.net.Uri.parse(localWeb.getUrl() == null ? "" : localWeb.getUrl());
                if (!"https".equals(local.getScheme()) || !"app.local".equals(local.getHost())) return;
                try { localWeb.evaluateJavascript("window.__nepuDone&&window.__nepuDone(" + id + "," + JSONObject.quote(payload) + ")", null); }
                catch (Throwable ignored) { }
            }
        });
    }

    @JavascriptInterface
    public void syncNotices(final int id) {
        worker.execute(new Runnable() {
            @Override public void run() {
                JSONObject result;
                try {
                    result = new JSONObject().put("ok", true).put("data",
                            new JSONObject().put("notices", noticeSnapshot()));
                } catch (SyncException e) { result = failure(e.kind, e.getMessage()); }
                catch (Exception e) { result = failure("network", "公告同步失败，请稍后重试"); }
                deliver(id, result);
            }
        });
    }

    @JavascriptInterface
    public void noticeDetail(final int id, final String noticeId) {
        worker.execute(new Runnable() {
            @Override public void run() {
                try {
                    if (noticeId == null || !noticeId.matches("[0-9]{1,32}")) throw new SyncException("parse", "公告编号无效");
                    String html = request("GET", BASE + "/new/desktop/ggtzview.page?ggtzdm=" + noticeId, null).body;
                    deliver(id, new JSONObject().put("ok", true).put("data", new JSONObject().put("html", html)));
                } catch (SyncException e) { deliver(id, failure(e.kind, e.getMessage())); }
                catch (Exception e) { deliver(id, failure("network", "公告正文读取失败，请稍后重试")); }
            }
        });
    }

    @JavascriptInterface
    public void openNotice(final String noticeId) {
        if (noticeId == null || !noticeId.matches("[0-9]{1,32}")) return;
        main.post(new Runnable() {
            @Override public void run() {
                activity.startActivity(new Intent(activity, NepuActivity.class).putExtra("noticeId", noticeId));
            }
        });
    }

    private JSONObject noticeSnapshot() throws Exception {
        String html = request("GET", BASE + "/new/desktop", null).body;
        if (!html.contains("通知公告")) throw new SyncException("parse", "教务公告列表结构已变化");
        JSONArray items = new JSONArray();
        java.util.regex.Matcher li = java.util.regex.Pattern.compile("(?is)<li\\b[^>]*>(.*?)</li>").matcher(html);
        while (li.find()) {
            String block = li.group(1);
            java.util.regex.Matcher a = java.util.regex.Pattern.compile("(?is)<a\\b[^>]*href=['\"](/new/desktop/ggtzview[.]page[?]ggtzdm=([0-9]{1,32}))['\"][^>]*>(.*?)</a>").matcher(block);
            if (!a.find()) continue;
            java.util.regex.Matcher date = java.util.regex.Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}(?: [0-9]{2}:[0-9]{2}:[0-9]{2})?").matcher(block.substring(a.end()));
            if (!date.find()) throw new SyncException("parse", "公告缺少发布时间");
            String title = android.text.Html.fromHtml(a.group(3)).toString().trim();
            if (title.isEmpty()) throw new SyncException("parse", "公告缺少标题");
            items.put(new JSONObject().put("id", a.group(2)).put("title", title).put("date", date.group()));
        }
        if (items.length() == 0 && html.contains("ggtzview.page"))
            throw new SyncException("parse", "教务公告结构已变化，已保留缓存");
        return new JSONObject().put("items", items).put("at", System.currentTimeMillis() / 1000);
    }

    private JSONObject syncSnapshot(String requestedTerm) throws Exception {
        String mainBody = request("GET", BASE + "/new/student/xsgrkb/main.page", null).body;
        String current = findTermInText(mainBody);
        String term = requestedTerm.isEmpty() ? current : requestedTerm;
        if (!term.matches("[0-9]{6}")) throw new SyncException("parse", "教务页面未提供有效当前学期");
        String weekBody = request("GET", BASE + "/new/student/xsgrkb/week.page?xnxqdm=" + enc(term), null).body;
        JSONArray terms = findTermsFromText(weekBody);
        if (terms.length() == 0) terms.put(new JSONObject().put("id", term).put("name", term));

        JSONArray weekDates = postJson("/new/xlxx/getDatesOfWeek", "xnxqdm=" + enc(term) + "&zc=1");
        String monday = firstDate(weekDates);
        if (monday.isEmpty()) throw new SyncException("parse", "未能解析学期第一周日期");

        JSONObject timetable = postJsonObject("/new/student/xsgrkb/getCalendarWeekDatas",
                "xnxqdm=" + enc(term) + "&zc=&d1=" + enc(monday + " 00:00:00") +
                        "&d2=" + enc(addDays(monday, 7) + " 00:00:00"));
        JSONArray courses = rows(timetable);
        JSONArray grades = paginate("/new/student/xskccj/kccjDatas", new JSONObject(),
                "xnxqdm=&source=kccjlist&sort=xnxqdm%2Ckcmc&order=asc&primarySort=cjdm+desc");
        JSONArray exams = paginate("/new/student/xsksrw/paginateXsksrw", new JSONObject(),
                "xnxqdm=" + enc(term) + "&sort=zc%2Cxq%2Cjcdm2&order=asc");

        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("kind", "");
        out.put("error", "");
        out.put("data", new JSONObject().put("term", term).put("terms", terms)
                .put("week1Monday", monday).put("courses", courses)
                .put("exams", exams).put("grades", grades).put("businessHours", businessHours(weekBody)));
        try { out.getJSONObject("data").put("notices", noticeSnapshot()); }
        catch (Exception e) { out.getJSONObject("data").put("noticesError", "公告同步失败，已保留上次内容"); }
        return out;
    }

    private JSONArray paginate(String path, JSONObject page, String baseForm) throws Exception {
        JSONArray all = new JSONArray();
        int total = -1;
        java.util.HashSet<String> pages = new java.util.HashSet<String>();
        for (int n = 1; n <= MAX_PAGES; n++) {
            JSONObject response = postJsonObject(path, baseForm + "&page=" + n + "&rows=20");
            JSONArray batch = rows(response);
            if (!response.has("total")) throw new SyncException("parse", "教务分页响应缺少 total");
            int reportedTotal = response.optInt("total", -1);
            if (reportedTotal < 0 || reportedTotal > MAX_PAGES * 20) throw new SyncException("limit", "教务分页数量超出上限");
            if (total < 0) total = reportedTotal;
            else if (total != reportedTotal) throw new SyncException("parse", "教务记录数量在同步中发生变化，请重试");
            if (batch.length() > 0 && !pages.add(batch.toString())) throw new SyncException("parse", "教务重复返回同一页，请重试");
            for (int i = 0; i < batch.length(); i++) all.put(batch.get(i));
            if (all.length() > total) throw new SyncException("parse", "教务分页数量不一致，请重试");
            if (all.length() == total) return all;
            if (batch.length() == 0) throw new SyncException("parse", "教务分页提前结束，请重新同步");
        }
        throw new SyncException("limit", "教务分页数量超出上限");
    }

    private JSONObject getJson(String path, String query) throws Exception {
        Response r = request("GET", BASE + path + (query == null || query.isEmpty() ? "" : "?" + query), null);
        return jsonObject(r);
    }

    private JSONObject postJsonObject(String path, String form) throws Exception {
        return jsonObject(request("POST", BASE + path, form));
    }

    private JSONArray postJson(String path, String form) throws Exception {
        Response r = request("POST", BASE + path, form);
        Object value = parseJson(r);
        if (value instanceof JSONArray) return (JSONArray) value;
        if (value instanceof JSONObject) {
            JSONObject o = (JSONObject) value;
            JSONArray a = o.optJSONArray("data");
            if (a != null) return a;
        }
        throw new SyncException("parse", "教务日期响应格式异常");
    }

    private Response request(String method, String address, String form) throws Exception {
        URL url = new URL(address);
        if (!isExactEduUrl(url)) throw new SyncException("scope", "拒绝非教务目标地址");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        try {
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(TIMEOUT_MS);
        c.setReadTimeout(TIMEOUT_MS);
        c.setRequestMethod(method);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", "application/json, text/javascript, */*; q=0.01");
        c.setRequestProperty("X-Requested-With", "XMLHttpRequest");
        c.setRequestProperty("Referer", BASE + "/new/welcome.page");
        String cookie = CookieManager.getInstance().getCookie(address);
        if (cookie != null && !cookie.isEmpty()) c.setRequestProperty("Cookie", cookie);
        if (form != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            OutputStream os = c.getOutputStream();
            os.write(form.getBytes(StandardCharsets.UTF_8));
            os.close();
        }
        int code = c.getResponseCode();
        for (java.util.Map.Entry<String, java.util.List<String>> h : c.getHeaderFields().entrySet()) {
            if (h.getKey() != null && h.getKey().equalsIgnoreCase("Set-Cookie")) {
                for (String value : h.getValue()) updateCookie(address, value);
            }
        }
        String location = c.getHeaderField("Location");
        if (code >= 300 && code < 400) {
            if (location != null) {
                URL next = new URL(url, location);
                if (!isExactEduUrl(next)) throw new SyncException("auth", "教务会话已过期，请重新登录 WebVPN 和教务系统");
            }
            throw new SyncException("http", "教务请求重定向，当前登录态可能已失效");
        }
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (in != null) {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) != -1) {
                if (out.size() + n > 4 * 1024 * 1024) throw new SyncException("limit", "教务响应超过大小上限");
                out.write(buf, 0, n);
            }
            in.close();
        }
        String type = c.getContentType();
        String text = new String(out.toByteArray(), StandardCharsets.UTF_8);
        if (code < 200 || code >= 300) throw new SyncException("http", "教务服务器返回 HTTP " + code);
        boolean page = url.getPath().endsWith("/main.page") || url.getPath().endsWith("/week.page")
                || url.getPath().equals("/new/desktop") || url.getPath().equals("/new/desktop/ggtzview.page");
        String lower = text.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("type=\"password\"") || lower.contains("type='password'")
                || lower.contains("/users/sign_in") || lower.contains("lyuapserver/login")
                || (!page && ((type != null && type.toLowerCase().contains("text/html")) || looksHtml(text))))
            throw new SyncException("auth", "教务会话已过期，请返回 WebVPN 登录并进入教务系统");
        return new Response(url.toString(), text);
        } finally {
            c.disconnect();
        }
    }

    private void updateCookie(final String address, final String value) throws Exception {
        final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        main.post(new Runnable() {
            @Override public void run() {
                CookieManager.getInstance().setCookie(address, value, new android.webkit.ValueCallback<Boolean>() {
                    @Override public void onReceiveValue(Boolean accepted) { done.countDown(); }
                });
            }
        });
        if (!done.await(5, java.util.concurrent.TimeUnit.SECONDS))
            throw new SyncException("timeout", "教务会话更新超时，请重新同步");
    }

    private JSONObject jsonObject(Response r) throws Exception {
        Object o = parseJson(r);
        if (!(o instanceof JSONObject)) throw new SyncException("parse", "教务响应不是 JSON 对象");
        JSONObject j = (JSONObject) o;
        if (j.has("code") && j.optInt("code", 0) != 0)
            throw new SyncException("business", j.optString("message", "教务查询失败"));
        return j;
    }

    private Object parseJson(Response r) throws Exception {
        if (!isExactEduUrl(new URL(r.url))) throw new SyncException("auth", "请求最终地址超出教务范围");
        try { return new org.json.JSONTokener(r.body).nextValue(); }
        catch (Exception e) { throw new SyncException("auth", "教务返回非 JSON 内容，请检查登录状态"); }
    }

    private static JSONArray rows(JSONObject o) throws SyncException {
        JSONArray a = o.optJSONArray("rows");
        if (a == null || a.length() == 0) {
            JSONArray dataRows = o.optJSONArray("data");
            if (dataRows != null) a = dataRows;
        }
        if (a == null && o.opt("data") instanceof JSONObject) {
            JSONObject data = o.optJSONObject("data");
            a = data.optJSONArray("rows");
            if (a == null) a = data.optJSONArray("data");
        }
        if (a == null) throw new SyncException("parse", "教务响应缺少有效记录数组");
        return a;
    }

    private static JSONArray findTerms(JSONObject page) {
        JSONArray found = findArray(page, "xnxqList", "terms", "semesterList", "xnxqdmList");
        if (found == null) found = new JSONArray();
        return found;
    }

    private static JSONArray findTermsFromText(String text) throws Exception {
        JSONArray out = new JSONArray();
        java.util.regex.Matcher select = java.util.regex.Pattern.compile("(?is)<select[^>]*(?:id|name)=['\"]xnxqdm['\"][^>]*>(.*?)</select>").matcher(text);
        String termSelect = select.find() ? select.group(1) : "";
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?is)<option[^>]*value=['\"]([0-9]{6})['\"][^>]*>(.*?)</option>").matcher(termSelect);
        java.util.HashSet<String> seen = new java.util.HashSet<String>();
        while (m.find() && out.length() < 100) {
            String id = m.group(1);
            if (seen.add(id)) out.put(new JSONObject().put("id", id).put("name", android.text.Html.fromHtml(m.group(2)).toString().trim()));
        }
        java.util.regex.Matcher objects = java.util.regex.Pattern.compile("(?is)['\"]?(?:id|xnxqdm)['\"]?[ ]*:[ ]*['\"]([0-9]{6})['\"][^{}]{0,300}?['\"]?(?:name|text|xnxqmc)['\"]?[ ]*:[ ]*['\"]([^'\"]+)['\"]").matcher(text);
        while (objects.find() && out.length() < 100) {
            if (seen.add(objects.group(1))) out.put(new JSONObject().put("id", objects.group(1)).put("name", objects.group(2)));
        }
        return out;
    }

    private static String findTermInText(String text) {
        String[] patterns = {
            "(?i)week[.]page[?]xnxqdm=([0-9]{6})",
            "(?i)xnxqdm[ ]*=[ ]*['\"]?([0-9]{6})",
            "(?i)['\"]?(?:xnxqdm|currentTerm|curXnxqdm)['\"]?[ ]*:[ ]*['\"]?([0-9]{6})",
            "(?is)name=['\"]xnxqdm['\"][^>]*value=['\"]([0-9]{6})['\"]",
            "(?is)<option[^>]*value=['\"]([0-9]{6})['\"][^>]*selected"
        };
        for (String pattern : patterns) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile(pattern).matcher(text);
            if (m.find()) return m.group(1);
        }
        return "";
    }

    private static JSONArray findArray(JSONObject o, String... keys) {
        for (String key : keys) if (o.optJSONArray(key) != null) return o.optJSONArray(key);
        java.util.Iterator<String> it = o.keys();
        while (it.hasNext()) {
            Object v = o.opt(it.next());
            if (v instanceof JSONObject) {
                JSONArray a = findArray((JSONObject) v, keys);
                if (a != null) return a;
            }
        }
        return null;
    }

    private static String findCurrentTerm(JSONObject page, JSONArray terms) {
        String direct = findTermValue(page);
        if (!direct.isEmpty()) return direct;
        for (int i = 0; i < terms.length(); i++) {
            JSONObject t = terms.optJSONObject(i);
            if (t != null && (t.optBoolean("current") || t.optBoolean("isCurrent") || "1".equals(t.optString("dq")))) {
                String id = t.optString("id", t.optString("xnxqdm", t.optString("value")));
                if (!id.isEmpty()) return id;
            }
        }
        return "";
    }

    private static String findTermValue(JSONObject o) {
        String[] keys = {"xnxqdm", "currentTerm", "termId", "curXnxqdm"};
        for (String k : keys) { String v = o.optString(k, ""); if (v.matches("[0-9]{6}")) return v; }
        java.util.Iterator<String> it = o.keys();
        while (it.hasNext()) { Object v = o.opt(it.next()); if (v instanceof JSONObject) { String s = findTermValue((JSONObject) v); if (!s.isEmpty()) return s; } }
        return "";
    }

    private static JSONArray businessHours(String page) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?is)businessHours[ ]*=[ ]*[$][.]parseJSON[(]'(.*?)'[)]").matcher(page);
        if (m.find()) {
            try { return new JSONArray(m.group(1)); } catch (Exception ignored) { }
        }
        return new JSONArray();
    }

    private static String firstDate(JSONArray a) {
        for (int i = 0; i < a.length(); i++) {
            JSONObject day = a.optJSONObject(i);
            if (day != null && "1".equals(day.optString("xqmc")) && day.optString("rq").matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
                return day.optString("rq");
        }
        for (int i = 0; i < a.length(); i++) {
            Object v = a.opt(i);
            if (v instanceof String) {
                String s = ((String) v).trim();
                if (s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}.*")) return s.substring(0, 10);
            } else if (v instanceof JSONObject) {
                JSONObject row = (JSONObject) v;
                String[] keys = {"rq", "date", "rqdm", "kssj", "weekStart"};
                for (String key : keys) {
                    String d = row.optString(key, "").trim();
                    if (d.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}.*")) return d.substring(0, 10);
                }
            }
        }
        return "";
    }

    private static String addDays(String ymd, int days) throws Exception {
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
        java.util.Calendar c = java.util.Calendar.getInstance(); c.setTime(f.parse(ymd)); c.add(java.util.Calendar.DAY_OF_MONTH, days);
        return f.format(c.getTime());
    }

    private static boolean isExactEduUrl(URL u) {
        return "https".equalsIgnoreCase(u.getProtocol()) && (u.getPort() == -1 || u.getPort() == 443)
                && "jwgl.webvpn.nepu.edu.cn".equalsIgnoreCase(u.getHost());
    }

    private static boolean looksHtml(String text) {
        String s = text.trim().toLowerCase(java.util.Locale.ROOT);
        return s.startsWith("<!doctype html") || s.startsWith("<html") || s.contains("<form") || s.contains("<title>登录");
    }

    private static String enc(String s) throws Exception { return URLEncoder.encode(s, "UTF-8"); }
    private static JSONObject failure(String kind, String error) {
        JSONObject o = new JSONObject(); try { o.put("ok", false); o.put("kind", kind); o.put("error", error); o.put("data", JSONObject.NULL); } catch (Exception ignored) { }
        return o;
    }
    private static String safeMessage(Exception e) { String m = e.getMessage(); return m == null || m.isEmpty() ? "网络请求失败" : m; }

    private static final class Response {
        final String url, body;
        Response(String url, String body) { this.url = url; this.body = body; }
    }
    private static final class SyncException extends Exception {
        final String kind;
        SyncException(String kind, String message) { super(message); this.kind = kind; }
    }
}
