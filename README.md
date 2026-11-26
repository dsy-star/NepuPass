# 东油通

面向东北石油大学学生的本地校园助手：课表、成绩、考试、教务公告、饮水，全部在手机本地处理，没有中间服务器。

- 免费、无广告，学生自己维护，和学校没有隶属关系
- 学号密码经 Android Keystore 加密后只存在这台手机上，不上传
- 教务数据只读，不代提交任何东西
- 网页界面 + 原生 WebView 外壳，没有 Gradle、没有前端构建步骤

## 能做什么

| 板块 | 内容 |
|---|---|
| 课表 | 周/日视图、校历、空教室、隐藏或自建课程、桌面小组件、上课提醒 |
| 学习 | 学习通作业与截止时间、考试安排、成绩、学分与绩点趋势 |
| 校园 | 教务公告（近三个月）、学校服务入口 |
| 功能 | 直饮水余额/消费记录/扫码加水机、积分与每日任务 |
| 我的 | 账号管理、作息与提醒、权限引导、配色、检查更新、使用说明 |

教务数据通过学校 WebVPN 登录后，在 App 内的 WebView 会话里读取，再用 `web/nepu.js` 归一成界面结构。

## 安装

从[发布页](https://dsy-star.github.io/NepuPass/)或 [Releases](https://github.com/dsy-star/NepuPass/releases) 下载最新的 `dongyoutong-<版本>.apk`，用系统安装器装即可。要求 Android 6.0 及以上。

已经装过旧版本的机器可以直接覆盖安装（签名一致），数据都保留。**不要**卸载重装，卸载会清掉本机缓存的课表和已加密的账号。

App 内「我的 → 检查更新」也能查到新版并下载安装包，下载完成后会核对 SHA-256 再交给系统安装器。

## 从源码构建

需要 Python 3、JDK 17，以及 Android SDK 的 platform 与 build-tools。构建脚本会自己找 `%LOCALAPPDATA%\Android\Sdk`；也可以用环境变量指定：

| 变量 | 作用 |
|---|---|
| `DONGYOU_SDK` | Android SDK 根目录 |
| `DONGYOU_JDK` | JDK 目录 |
| `DONGYOU_ANDROID_JAR` | platform 的 `android.jar` |
| `DONGYOU_BUILD_TOOLS` | build-tools 版本目录 |
| `DONGYOU_KEYSTORE` / `DONGYOU_KEY_ALIAS` / `DONGYOU_KS_PASS` | 发布签名 |

在仓库根目录执行：

```bash
py android/build_apk.py --clean        # Windows
python3 android/build_apk.py --clean   # 其他平台
```

产物在 `android/dist/dongyoutong-<版本>.apk`，中间文件在 `android/build/`，两个目录都不进仓库。

脚本会编译资源、编译 `android/src` 下全部 Java、打 dex、签名并验证，同时校验 `web/app.js` 里的版本号与 `build_apk.py`、`MainActivity.java` 是否一致 —— 对不上就直接拒绝出包。

发版前的整体体检：

```bash
py tools/check_release_tree.py
```

它检查构建必需文件是否齐全、`web/index.html` 引用的本地资源是否都在、以及这些文件有没有被 git 跟踪。

## 改版本号

一次发版要同时改三个文件、六个值，缺一个构建脚本就会拒绝执行（这是有意的门槛）：

1. `android/build_apk.py`：`VERSION_NAME` / `VERSION_CODE`
2. `web/app.js`：`APP_VERSION` / `APP_CODE`
3. `android/src/com/nepu/dongyoutong/MainActivity.java`：`UA_TAG` 的版本后缀

涨号规则：有新功能才动第二位，末位归零（0.1.x → 0.2.0）；只修问题就动末位（0.1.6 → 0.1.7）。`APP_CODE` 只增不减，更新检查比的是它，不是版本号字符串。

更新清单里的 `version` / `code` 由脚本从 `web/app.js` 读，不用手改。本版改了什么写在 `RELEASE-NOTES.md` 对应版本下，以「- 」开头的行会被抄进清单，显示在更新弹层里。

## 发版与自动更新

打一个 `v<版本>` 的 tag 推上去，`.github/workflows/release.yml` 会：

1. 在 Windows runner 上构建并签名（`build_apk.py` 里的工具链是 `.exe`）
2. 生成更新清单，推 `gh-pages` 分支（Pages 与 jsDelivr 都读这一份）
3. 把 APK 发到 GitHub Release
4. 核对 tag 与包里的版本号，对不上就停

仓库需要 `DONGYOU_KEYSTORE_B64`、`DONGYOU_KS_PASS` 两个 Secrets，可选 `DONGYOU_KEY_ALIAS`。**签名证书必须和已发布的一致**，换了签名用户就没法覆盖升级。

完整流程、线路选择、注意事项见 [`docs/GITHUB-UPDATE.md`](docs/GITHUB-UPDATE.md)。

## 目录

```
android/                原生外壳、桥接、构建脚本
  build_apk.py          资源/Java 编译、打包、签名、校验
  src/com/nepu/dongyoutong/
  res/                  图标、字符串、主题、桌面小组件
web/                    界面资源（打进 APK 的 assets/web）
  index.html  app.js  app.css  native.js  nepu.js
tools/                  发版辅助脚本
tests/                  nepu 数据归一的断言测试
docs/                   发版与更新说明
.github/workflows/      发版流水线
```

## 许可

MIT，见 [LICENSE](LICENSE)。界面规范见 [DESIGN.md](DESIGN.md)，更新历史见 [RELEASE-NOTES.md](RELEASE-NOTES.md)。