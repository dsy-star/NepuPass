"""Build a local Dongyou Tong APK. No release upload or update manifest is generated."""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
WEB = ROOT / "web"
BUILD = HERE / "build"
DIST = HERE / "dist"
def first_dir(candidates):
    paths = [Path(p) for p in candidates if p]
    return next((p for p in paths if p.is_dir()), paths[-1])


def version_key(path):
    return tuple(int(n) for n in re.findall(r"\d+", path.name))


def newest_dir(parent, marker, fallback):
    choices = [p for p in parent.glob("*") if (p / marker).is_file()
               and not p.name.endswith(".disabled")]
    return max(choices, key=version_key) if choices else fallback


SDK = Path(os.environ["DONGYOU_SDK"]) if os.environ.get("DONGYOU_SDK") else first_dir((
    os.environ.get("ANDROID_SDK_ROOT"), os.environ.get("ANDROID_HOME"),
    ROOT / "_lab" / "out" / "sdk",
    Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "Android" / "Sdk"))
_javac = shutil.which("javac")
JDK = Path(os.environ["DONGYOU_JDK"]) if os.environ.get("DONGYOU_JDK") else first_dir((
    os.environ.get("JAVA_HOME"), Path(_javac).parent.parent if _javac else None,
    SDK / "zulu17.60.17-ca-jdk17.0.16-win_x64"))
BT = Path(os.environ["DONGYOU_BUILD_TOOLS"]) if os.environ.get("DONGYOU_BUILD_TOOLS") else newest_dir(
    SDK / "build-tools", "aapt2.exe", SDK / "android-14")
ANDROID_JAR = Path(os.environ["DONGYOU_ANDROID_JAR"]) if os.environ.get("DONGYOU_ANDROID_JAR") else (
    newest_dir(SDK / "platforms", "android.jar", SDK / "android-13") / "android.jar")
JAVA = JDK / "bin" / "java.exe"
JAVAC = JDK / "bin" / "javac.exe"
KEYTOOL = JDK / "bin" / "keytool.exe"
PKG = "com.nepu.dongyoutong"
VERSION_NAME = "0.1.8"
VERSION_CODE = 199
MIN_SDK = 23
TARGET_SDK = 33
KEY_ALIAS = os.environ.get("DONGYOU_KEY_ALIAS", "dongyoutong")
KEYSTORE = Path(os.environ.get("DONGYOU_KEYSTORE", str(HERE / ".local" / "dongyoutong.keystore")))
# The default key is only for local development; custom keys require a password.
KS_PASS = os.environ.get("DONGYOU_KS_PASS", "" if os.environ.get("DONGYOU_KEYSTORE") else "android")


def run(args):
    # Some Windows Android tools reject non-ASCII absolute paths.
    cmd = [str(x.relative_to(ROOT)) if isinstance(x, Path) and x.is_relative_to(ROOT)
           else str(x) for x in args]
    p = subprocess.run(cmd, cwd=ROOT, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if p.returncode:
        raise SystemExit("命令失败 (%d): %s\n%s" % (p.returncode, " ".join("<redacted>" if i and cmd[i - 1] in
                ("-storepass", "-keypass", "--ks-pass", "--key-pass") else v
                for i, v in enumerate(cmd)), p.stdout))
    return p.stdout


def check_env():
    required = (JAVA, JAVAC, KEYTOOL, BT / "aapt2.exe", BT / "zipalign.exe",
                BT / "lib" / "d8.jar", BT / "lib" / "apksigner.jar", ANDROID_JAR)
    missing = [str(p) for p in required if not p.is_file()]
    if missing:
        raise SystemExit("缺少 Android 构建工具：\n" + "\n".join(missing) +
                         "\n安装 JDK 17 与 Android build-tools/platform，或设置 DONGYOU_SDK。")



def check_version_consistency():
    js = (WEB / "app.js").read_text(encoding="utf-8")
    for pattern, expected, label in (
        (r"^const APP_VERSION = '([^']+)';", VERSION_NAME, "APP_VERSION"),
        (r"^const APP_CODE = (\d+);", str(VERSION_CODE), "APP_CODE"),
    ):
        m = re.search(pattern, js, re.M)
        if not m or m.group(1) != expected:
            raise SystemExit("web/app.js 的 %s 与本地 APK 版本不一致" % label)
    manifest = (HERE / "AndroidManifest.xml").read_text(encoding="utf-8")
    if 'package="%s"' % PKG not in manifest:
        raise SystemExit("AndroidManifest application ID 不一致")
    label = (HERE / "res" / "values" / "strings.xml").read_text(encoding="utf-8")
    if 'name="app_name">东油通<' not in label:
        raise SystemExit("Android 应用名称不是东油通")
    java = (HERE / "src" / "com" / "nepu" / "dongyoutong" / "MainActivity.java").read_text(encoding="utf-8")
    if "DongYouTong/" + VERSION_NAME not in java:
        raise SystemExit("MainActivity User-Agent 版本不一致")


def stage_assets():
    dst = BUILD / "assets" / "web"
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for source in WEB.iterdir():
        if source.is_file():
            shutil.copy2(source, dst / source.name)
    required = ("index.html", "app.js", "app.css", "native.js", "icon-180.png")
    missing = [name for name in required if not (dst / name).is_file()]
    if missing:
        raise SystemExit("Web 资源缺失：" + ", ".join(missing))


def compile_res(debug=False):
    gen = BUILD / "gen"
    if gen.exists():
        shutil.rmtree(gen)
    gen.mkdir(parents=True)
    res_zip = BUILD / "res.zip"
    if res_zip.exists():
        res_zip.unlink()
    run((BT / "aapt2.exe", "compile", "--dir", HERE / "res", "-o", res_zip))
    base = BUILD / "base.apk"
    link = [BT / "aapt2.exe", "link", "-o", base, "-I", ANDROID_JAR,
         "--manifest", HERE / "AndroidManifest.xml", "-A", BUILD / "assets",
         "--java", gen, "--min-sdk-version", str(MIN_SDK),
         "--target-sdk-version", str(TARGET_SDK), "--version-code", str(VERSION_CODE),
         "--version-name", VERSION_NAME, res_zip]
    if debug:
        link.append("--debug-mode")
    run(link)
    return base, gen


def compile_java(gen):
    classes = BUILD / "classes"
    if classes.exists():
        shutil.rmtree(classes)
    classes.mkdir(parents=True)
    srcs = sorted((HERE / "src").rglob("*.java")) + sorted(gen.rglob("*.java"))
    run([JAVAC, "--release", "8", "-nowarn", "-encoding", "utf-8",
         "-classpath", ANDROID_JAR, "-d", classes] + srcs)
    return classes


def add_dex(apk, classes):
    out = BUILD / "dex"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    class_files = sorted(classes.rglob("*.class"))
    if not class_files:
        raise SystemExit("javac 没产出任何 class")
    run([JAVA, "-cp", BT / "lib" / "d8.jar", "com.android.tools.r8.D8",
         "--release", "--min-api", str(MIN_SDK), "--lib", ANDROID_JAR,
         "--output", out] + class_files)
    dex = out / "classes.dex"
    if not dex.is_file():
        raise SystemExit("d8 没产出 classes.dex")
    with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as zf:
        zf.write(dex, "classes.dex")


def check_signing():
    if not KS_PASS:
        raise SystemExit("请设置非空 DONGYOU_KS_PASS；默认本地开发密钥使用 android。")
    if not KEYSTORE.exists() and len(KS_PASS) < 6:
        raise SystemExit("新建本地密钥需要至少 6 位 DONGYOU_KS_PASS。")


def sign(apk, debug=False):
    if not KEYSTORE.exists():
        KEYSTORE.parent.mkdir(parents=True, exist_ok=True)
        run([KEYTOOL, "-genkeypair", "-keystore", KEYSTORE, "-alias", KEY_ALIAS,
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-storepass", KS_PASS, "-keypass", KS_PASS,
             "-dname", "CN=DongYouTong, OU=Android, O=NEPU, C=CN"])
    aligned = BUILD / "aligned.apk"
    run([BT / "zipalign.exe", "-f", "4", apk, aligned])
    DIST.mkdir(parents=True, exist_ok=True)
    output = DIST / ("dongyoutong-%s%s.apk" % (VERSION_NAME, "-debug" if debug else ""))
    run([JAVA, "-jar", BT / "lib" / "apksigner.jar", "sign", "--ks", KEYSTORE,
         "--ks-key-alias", KEY_ALIAS, "--ks-pass", "pass:" + KS_PASS,
         "--key-pass", "pass:" + KS_PASS, "--min-sdk-version", str(MIN_SDK),
         "--out", output, aligned])
    return output


def verify(apk):
    run([JAVA, "-jar", BT / "lib" / "apksigner.jar", "verify", "--verbose", apk])
    badging = run([BT / "aapt2.exe", "dump", "badging", apk])
    if "package: name='%s'" % PKG not in badging:
        raise SystemExit("APK package ID 校验失败")
    if "application-label:'东油通'" not in badging:
        raise SystemExit("APK label 校验失败")
    with zipfile.ZipFile(apk) as zf:
        names = set(zf.namelist())
        for name in ("classes.dex", "assets/web/index.html", "assets/web/app.js", "assets/web/native.js"):
            if name not in names:
                raise SystemExit("APK 内缺少 %s" % name)
    print("APK 校验通过：%s" % apk)


def main():
    parser = argparse.ArgumentParser(description="本地编译并签名东油通 APK")
    parser.add_argument("--clean", action="store_true", help="清理本地 build 目录")
    parser.add_argument("--debug", action="store_true", help="生成可调试 APK")
    args = parser.parse_args()
    check_env()
    check_signing()
    check_version_consistency()
    if args.clean and BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True, exist_ok=True)
    stage_assets()
    base, gen = compile_res(args.debug)
    try:
        classes = compile_java(gen)
        add_dex(base, classes)
    finally:
        shutil.rmtree(BUILD / "classes", ignore_errors=True)
    output = sign(base, args.debug)
    verify(output)


if __name__ == "__main__":
    main()
