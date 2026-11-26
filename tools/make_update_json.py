#!/usr/bin/env python3
"""把一次发版要用的东西摊到一个目录里：更新清单 + 安装包 + 发布页。

App 的「检查更新」（web/app.js 的 checkUpdate / fetchOne）读的是**一份静态 JSON**，
它必须能从 https 直接取到、且带 `Access-Control-Allow-Origin: *`。
所以这里不碰任何接口，只把一遍算好的结果写成文件，交给 CI 推上 gh-pages。

产物（默认 ./pub）：
    version.json      更新清单，App 读的就是它
    dongyoutong-<ver>.apk   安装包本体（Pages 和 jsDelivr 一起当 CDN 用）
    notes.md          这一版改了什么，给 `gh release create -F` 用
    index.html        打开发布页时看到的东西（否则根路径是个 404）
    .nojekyll         Pages 别拿 Jekyll 过一遍，否则带下划线的文件会被吃掉

用法：
    python tools/make_update_json.py                # 出到 ./pub
    python tools/make_update_json.py --out _pub     # 换目录
    eval "$(python tools/make_update_json.py)"      # 给 shell 用的 KEY=VALUE（CI 里就用这个）

🔴 版本号不在这里写：一律从 web/app.js 的 APP_VERSION / APP_CODE 读。
   发版要改的还是那四个文件六个值（见 RELEASE-NOTES.md 开头）。
🔴 清单里的 apk / apk_cn 必须是**同一个文件的两个入口**，只是线路不同：
   cn 那条走 ghproxy 反代 GitHub Release（实测校网能连、字节一致），
   主站走我们自己的 Pages。两根都断才真没辙。
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

APP_JS = ROOT / "web" / "app.js"
NOTES_MD = ROOT / "RELEASE-NOTES.md"
DIST = ROOT / "android" / "dist"

# 发布地址。仓库换了就改这两行（web/app.js 的 UPD_STABLE 也要跟着改）。
PAGES_BASE = "https://dsy-star.github.io/NepuPass"
REPO_URL = "https://github.com/dsy-star/NepuPass"
# 2026-11-25：jsDelivr 的 @gh-pages 分支地址对大文件会 301 到 raw.githubusercontent，
# 那条域名在校园网/移动网基本连不上；实测 ghproxy 反代 Release 资产是通的，
# 字节也一致（App 侧还会再核 SHA-256），所以「国内线路」改成它。
MIRROR_PREFIX = "https://ghproxy.net/"


def die(msg):
    print("✗ " + msg, file=sys.stderr)
    raise SystemExit(1)


def read_version():
    """从 web/app.js 读版本号和 code（和 build_apk.py 用同一对正则）。"""
    try:
        src = APP_JS.read_text(encoding="utf-8")
    except OSError as e:
        die("读不到 %s：%s" % (APP_JS, e))
    m = re.search(r"^const APP_VERSION = '([^']+)';", src, re.M)
    if not m:
        die("web/app.js 里没找到 APP_VERSION")
    version = m.group(1)
    m = re.search(r"^const APP_CODE = (\d+);", src, re.M)
    if not m:
        die("web/app.js 里没找到 APP_CODE")
    return version, int(m.group(1))


def read_notes(version):
    """RELEASE-NOTES.md 里 `## <version>` 下面以「- 」开头的行。

    没有这一节不算错（可以发一个纯修问题的包），但要有就原样抄进去 ——
    App 的弹窗是当纯文本/li 显示的，这里不做任何 Markdown 加工。
    """
    try:
        lines = NOTES_MD.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    head = "## " + version
    out, inside = [], False
    for raw in lines:
        line = raw.strip()
        if line.startswith("## "):
            if inside:
                break                      # 上一节结束
            inside = (line == head)
            continue
        if inside and line.startswith("- "):
            out.append(line[2:].strip())
    return [n for n in out if n]


def apk_info(path):
    """大小 + sha256。App 在原生下载器里会拿 sha256 复核（见 updVerify），
    这条留着是为了将来接回原生下载时不用改清单格式。"""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return path.stat().st_size, h.hexdigest()


def page_html(version, code):
    """发布页。不是给用户看的落地页（那是 site/index.html），
    只是别让 `/` 变成一个 404 —— 有人手抖点到清单根目录时，
    至少能看到这是什么东西、安装包在哪。"""
    return """<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>东油通 · 更新服务</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.7 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         background: #edf6ff; color: #0e1522; }
  .box { width: min(88vw, 30rem); padding: 28px 26px; background: #fff; border-radius: 18px;
         box-shadow: 0 14px 34px -10px rgba(31, 72, 142, .18); }
  h1 { margin: 0 0 6px; font-size: 19px; }
  p { margin: 8px 0 0; font-size: 14px; color: #5a6b85; }
  code { font-size: 13px; }
  a { color: #2f6bee; text-decoration: none; }
</style></head>
<body><div class="box">
  <h1>东油通 · 更新服务</h1>
  <p>这里只放 App 的更新清单和安装包，不是官网。</p>
  <p>当前版本：<code>%(version)s</code>（code %(code)d）</p>
  <p><a href="version.json">version.json</a> ·
     <a href="dongyoutong-%(version)s.apk">下载安装包</a> ·
     <a href="%(repo)s">源码</a></p>
</div></body></html>
""" % {"version": version, "code": code, "repo": REPO_URL}


def main():
    ap = argparse.ArgumentParser(description="生成东油通的更新清单和发布目录")
    ap.add_argument("--out", default=str(ROOT / "pub"), help="输出目录（默认 ./pub）")
    ap.add_argument("--apk", default=None,
                    help="安装包路径（默认 android/dist/dongyoutong-<版本>.apk）")
    args = ap.parse_args()

    version, code = read_version()
    apk = Path(args.apk) if args.apk else DIST / ("dongyoutong-%s.apk" % version)
    if not apk.is_file():
        die("找不到安装包 %s —— 先跑 `python android/build_apk.py`，或用 --apk 指过去"
            % apk)
    size, sha = apk_info(apk)
    notes = read_notes(version)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    name = "dongyoutong-%s.apk" % version
    # 🔴 先清掉上一次留下的旧包（2026-11-26）。这里不清理的话，反复在同一个
    #    --out 目录跑就会攒一堆历史 APK —— 工作流是 `git add -A` 整个推上去的，
    #    等于把每一版的安装包都留在下载站上（几个版本就是几 MB，而且旧包还能被
    #    直接点到）。只删 `dongyoutong-*.apk`，别碰目录里别的东西。
    for old in out.glob("dongyoutong-*.apk"):
        if old.name != name:
            try:
                old.unlink()
            except OSError:
                pass
    shutil.copyfile(apk, out / name)

    manifest = {
        "name": "东油通",
        "version": version,
        "code": code,
        "size": size,
        "sha256": sha,
        # 🔴 两个入口指向同一个文件。cn 那条排在前面（web/app.js 的 UPD_LINES
        #    默认选 'cn'），因为校网里反代 GitHub 比 Pages 稳。
        "apk_cn": "%s%s/releases/download/v%s/%s" % (MIRROR_PREFIX, REPO_URL, version, name),
        "apk": "%s/%s" % (PAGES_BASE, name),
        "page": PAGES_BASE + "/",
        "notes": notes,
    }
    # 缩进 2 是为了让人 git diff 得下去；ensure_ascii=False 让中文原样存，
    # 别变成 \u4e1c 那种谁也看不懂的东西。
    (out / "version.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out / "index.html").write_text(page_html(version, code), encoding="utf-8")
    (out / ".nojekyll").write_bytes(b"")
    (out / "notes.md").write_text(
        "## 东油通 %s\n\n" % version
        + ("\n".join("- " + n for n in notes) if notes else "- 这一版没有写更新内容")
        + "\n\n安装包：%s/%s\n" % (PAGES_BASE, name),
        encoding="utf-8")

    # Human-readable diagnostics go to stderr so callers may safely eval stdout.
    print("版本 %s（code %d），%d 条更新内容，安装包 %.1f KB"
          % (version, code, len(notes), size / 1024.0), file=sys.stderr)
    print("清单：%s" % (out / "version.json"), file=sys.stderr)
    # 给 CI 的 eval 用：值都是版本号/路径，不会有空格。
    print("VERSION=%s" % version)
    print("CODE=%d" % code)
    print("TAG=v%s" % version)
    print("APK=%s" % name)
    print("NOTES=%s" % (out / "notes.md"))


if __name__ == "__main__":
    main()
