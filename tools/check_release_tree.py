#!/usr/bin/env python3
"""发版前检查：仓库里该有的东西齐不齐。

为什么需要这个：本地工作区往往是全的，但 GitHub 上那份可能少一大块
（2026-11-24 第一次接 CI 时就撞上过：远端 `main` 里根本没有 `web/` 目录，
而 `android/build_apk.py` 第一步就要读 `web/app.js` 对版本号）。
在那种状态下打 tag，CI 会在 `stage_assets` / `check_version_consistency`
里停住，报的是一句看不出因果的「找不到文件」。

这个脚本只做三件事，都很快：
  1. 构建必需的文件在不在磁盘上（缺了，CI 一定失败）；
  2. `web/index.html` 引用的本地文件是不是都在（少一个，APK 里就是白屏/功能丢失）；
  3. 这些文件有没有被 git 跟踪（有文件、没入库 = 推上去就没了，最隐蔽的那种）。

用法：
    py tools/check_release_tree.py

退出码 0 = 可以发版；1 = 有别的问题，按提示处理。
CI 里也跑一次（见 .github/workflows/release.yml 的第一步）。
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# 少一个就打不出包，或者打出来是坏的。改构建流程时记得同步这里。
REQUIRED = [
    "web/index.html",
    "web/app.js",
    "web/app.css",
    "web/native.js",
    "web/icon-180.png",
    "web/manifest.webmanifest",
    "android/AndroidManifest.xml",
    "android/build_apk.py",
    "android/res/values/strings.xml",
    "android/src/com/nepu/dongyoutong/MainActivity.java",
    "RELEASE-NOTES.md",
    "tools/make_update_json.py",
]

# index.html 里这些前缀不是本地文件，别去磁盘上找。
EXTERNAL = re.compile(r"^(?:[a-z]+:|//|#)")


def tracked_paths() -> set[str] | None:
    """git 跟踪的文件列表；不在 git 仓库里就返回 None（跳过这项检查）。"""
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return {line.strip().replace("\\", "/") for line in out.stdout.splitlines() if line.strip()}


def refs_of_index() -> list[str]:
    html = (ROOT / "web/index.html").read_text(encoding="utf-8")
    found = re.findall(r'(?:src|href)="([^"]+)"', html)
    out = []
    for ref in found:
        if EXTERNAL.match(ref):
            continue
        out.append(ref.split("?")[0].split("#")[0])
    return sorted(set(out))


def main() -> int:
    missing: list[str] = []
    untracked: list[str] = []
    problems = 0

    print("① 构建必需的输入")
    for rel in REQUIRED:
        if not (ROOT / rel).is_file():
            print(f"   [缺失] {rel}")
            missing.append(rel)
            problems += 1
        else:
            print(f"   [ok]   {rel}")

    print("\n② web/index.html 引用的本地文件")
    for ref in refs_of_index():
        if not (ROOT / "web" / ref).is_file():
            print(f"   [缺失] web/{ref}  ← index.html 引用了它")
            missing.append(f"web/{ref}")
            problems += 1
        else:
            print(f"   [ok]   {ref}")

    print("\n③ 这些文件在不在 git 里（不在 = 推上去就没了）")
    tracked = tracked_paths()
    if tracked is None:
        print("   [跳过] 这里不是 git 仓库，或者没装 git")
    else:
        watch = [p for p in REQUIRED + [f"web/{r}" for r in refs_of_index()] if (ROOT / p).is_file()]
        for rel in watch:
            if rel.replace("\\", "/") not in tracked:
                print(f"   [未入库] {rel}")
                untracked.append(rel)
                problems += 1
        if not untracked:
            print(f"   [ok]   {len(watch)} 个文件都已跟踪")

    print()
    if problems == 0:
        print("可以发版。")
        return 0

    print(f"发现 {problems} 个问题，先别打 tag：")
    if missing:
        print("  · 磁盘上就缺文件 —— 补齐后重跑；CI 在这份树上是打不出包的。")
    if untracked:
        print("  · 有文件没进 git —— `git add` 之后再提交、推送，否则远端那份还是没有：")
        for rel in untracked[:12]:
            print(f"      git add {rel}")
        if len(untracked) > 12:
            print(f"      …（还有 {len(untracked) - 12} 个）")
        print("    检查远端到底有没有：git ls-tree -r --name-only origin/main | grep '^web/'")
    return 1


if __name__ == "__main__":
    sys.exit(main())
