# 东油通 Android

东油通 Android 客户端，应用 ID 为 `com.nepu.dongyoutong`。原生层使用 Java 和 Android WebView；界面资源由项目根目录下的 `web/` 提供，教务同步及通知公告请求使用应用内的 WebView 登录会话。

## 功能

- 东北石油大学教务登录及课表、成绩、考试同步
- 教务系统近三个月通知公告列表与原文查看
- 饮水服务、桌面小组件、课程提醒和 NFC 设备入口
- 本地保存页面数据；教务凭据使用 Android Keystore 加密

## 构建

需要 Python 3、JDK 17，以及 Android SDK platform 和 build-tools。Windows 默认从 `LOCALAPPDATA\\Android\\Sdk` 探测 SDK；也可通过环境变量指定工具路径：

- `DONGYOU_SDK`：Android SDK 根目录
- `DONGYOU_JDK`：JDK 目录
- `DONGYOU_ANDROID_JAR`：Android platform `android.jar`
- `DONGYOU_BUILD_TOOLS`：build-tools 版本目录

从项目根目录构建：

```bash
python android/build_apk.py --clean
```

APK 输出到 `android/dist/`，临时文件位于 `android/build/`。这两个目录不纳入版本控制。构建脚本会校验 `web/app.js` 中的应用版本，并要求配套的根目录 `web/` 源码，因此单独检出 `android/` 子目录无法直接构建。

默认开发签名使用本机 `android/.local/dongyoutong.keystore`，不会提交到仓库。发布签名可设置 `DONGYOU_KEYSTORE`、`DONGYOU_KEY_ALIAS` 和 `DONGYOU_KS_PASS`；请妥善备份密钥，后续升级包须继续使用同一签名证书。

应用版本由 `web/app.js` 中的 `APP_VERSION`、`APP_CODE` 定义；更新版本时同步调整 `android/build_apk.py` 的 `VERSION_NAME`、`VERSION_CODE` 和 `android/src/com/nepu/dongyoutong/MainActivity.java` 的 `UA_TAG`。

## 目录

- `AndroidManifest.xml`：应用组件、权限和 intent 声明
- `src/com/nepu/dongyoutong/`：WebView 容器、原生桥接、教务适配及 Android 功能
- `res/`：图标、字符串、主题、桌面组件和快捷方式资源
- `build_apk.py`：资源编译、Java 编译、APK 打包与签名
