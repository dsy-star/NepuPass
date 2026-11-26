# 用 GitHub 发版 / 检查更新

东油通的「检查更新」接的是**这个 GitHub 仓库**，不连任何自建服务。
本文只写怎么用、怎么配、坑在哪；代码在 `web/app.js` 的更新那一段和
`.github/workflows/release.yml`。

## 它是怎么跑起来的

```
我的 → 版本 → [检查更新]
      ↓  web/app.js  checkUpdate(true)
      ↓  UPD_STABLE 里的四条地址（同一份文件，四条线路）
gh-pages 分支 / version.json      ← .github/workflows/release.yml 每次发版重写
      ↓  比 code（整数，比版本号字符串可靠）
比当前大 → 弹层「发现新版本」+ 更新内容
      ↓  [立即更新]
安装包地址（version.json 里的 apk / apk_cn）
```

四条清单地址（`web/app.js` 的 `UPD_STABLE`）:

1. `https://dsy-star.github.io/NepuPass/version.json` —— GitHub Pages，排第一，更新最快
2. `https://fastly.jsdelivr.net/gh/dsy-star/NepuPass@gh-pages/version.json` —— jsDelivr 的 fastly 域名
3. `https://cdn.jsdelivr.net/gh/dsy-star/NepuPass@gh-pages/version.json` —— jsDelivr 默认域名（2026-11-25 实测在移动网会直接 TLS 失败，留着兜底）
4. `https://raw.githubusercontent.com/dsy-star/NepuPass/gh-pages/version.json` —— 备用

主源成功时备源根本不会发出去（见 `fetchManifest`），所以第 2～4 条只在 Pages 连不上时才用。
**四条必须是同一个分支上的同一份文件**，否则备源可能拿到上一次发版的清单，被判成
「已是最新」——那等于把更新吃掉，而且不报错。

## 第 0 步：先自查这棵树能不能出包

```bash
py tools/check_release_tree.py        # 文件在不在、进没进 git
```

它会抓两类问题：

- **文件根本不在** —— CI 在这棵树上一定失败；
- **文件在磁盘上、但没进 git** —— 最常见的一种：`web/nepu.js` 一旦漏掉，
  `web/index.html` 引用的脚本在 APK 里就是 404，页面看着能开、功能却是残的。

本地调试用的目录（`_diag/`、`work/`、`design/`）和构建产物（`android/build/`、
`android/dist/`、`pub/`）都在 `.gitignore` 里，别强行加进去。

仓库的 `main` 只有东油通这一套代码，历史从东油通第一版开始，与上一代软件无关。
发版前推到 `github` 远端即可，普通 `git push github main` 就够，不需要强推，也不需要
先把别的历史搬过来。

## 一次性配置（三道）

### ① 签名密钥进 Secrets

发版包必须是**同一把钥匙**签的，否则 Android 不让覆盖安装（用户只能卸载重装）。
本地开发那把 `android/.local/dongyoutong.keystore` 就能用；也可以新生成一把，
但**第一次发出去之后就不能再换**。

导出成 base64，贴进仓库 Settings → Secrets and variables → Actions：

| Secret | 内容 |
| --- | --- |
| `DONGYOU_KEYSTORE_B64` | keystore 文件的 base64（必需） |
| `DONGYOU_KS_PASS` | keystore 密码（必需） |
| `DONGYOU_KEY_ALIAS` | 别名，不填默认 `dongyoutong` |

```bash
# Git Bash / macOS / Linux
base64 -w 0 android/.local/dongyoutong.keystore
```

```powershell
# PowerShell（注意：输出要一行，别带换行）
[Convert]::ToBase64String([IO.File]::ReadAllBytes("android\.local\dongyoutong.keystore"))
```

### ② 打开 Pages

仓库 Settings → Pages → Build and deployment：

- Source: **Deploy from a branch**
- Branch: **gh-pages** / **/(root)**

`gh-pages` 分支是第一次发版时工作流建的，所以顺序是：先发一次版，再回来把它选上。
没开 Pages 也不会坏 —— 请求会 404，然后落到 jsDelivr 那条。

### ③ 不用配 jsDelivr

它直接读仓库分支，不需要注册、不需要 token。分支刚更新时可能有分钟级缓存，
`fetchOne` 会带 `?t=时间戳` 绕开。

## 发一版

1. 改版本号 —— **三个文件六个值**，漏一个打包脚本直接拒绝（见 `RELEASE-NOTES.md` 开头）：
   - `web/app.js`：`APP_VERSION` / `APP_CODE`（`code` 只增不减）
   - `android/build_apk.py`：`VERSION_NAME` / `VERSION_CODE`
   - `android/src/com/nepu/dongyoutong/MainActivity.java`：`UA_TAG` 后缀
   - 另外在 `RELEASE-NOTES.md` 加一节 `## <版本>`，更新内容写成 `- ` 开头的行
     （这一条不进构建校验，但不写就没东西显示在更新弹层里）
2. 提交，然后打 tag 推上去：

```bash
git add -A && git commit -m "0.1.9"
git tag v0.1.9 && git push github HEAD --tags
```

3. 工作流自动：出包 → 生成 `version.json` → 推 gh-pages → 建 Release。
   Tag 和包里的版本号对不上会**直接失败**（清单里的安装包地址是按版本号拼的，
   对不上就是发一份指向 404 的清单）。

## 本地先验一遍

```bash
py android/build_apk.py --clean          # 会先校验上面那几个版本号是否一致
py tools/make_update_json.py --out pub   # 生成清单，顺便打印版本/哈希
cat pub/version.json
```

`pub/` 是本地产物（已 gitignore），线上那份在 gh-pages 分支上。

想在本机点一遍按钮，把 `web/` 起个带 CORS 的静态服务就行 —— 清单必须带
`Access-Control-Allow-Origin: *`，因为 APK 里页面源是 `https://app.local`、
网页版是 `http://127.0.0.1:8788`，跨域少了这个头会静默失败、表现成「永远是最新」。

## 这一版接的是什么、没接什么

- **手动检查**：我的页版本旁点「检查更新」，有新版就弹更新内容；无新版或请求失败会提示结果。
- **自动检查已启用**：启动 5 秒后运行 `updAutoCheck()`，默认每天检查一次；遵守
  `CFG.updOn/updFreq/updLast`，成功获取清单才记录检查时间。自动失败保持安静，
  点过「以后再说」的版本不再自动弹；手动检查仍可查看。这里只在启动时检查，不是后台常驻任务。
- **仓库里没有 `version.json`**：清单只在 `tools/make_update_json.py` 生成时落到 `pub/`，
  再由工作流推到 gh-pages。别在仓库根目录再放一份「手改版」，两份会各说各话。

## 坑

- **别把安装包直接放 Release 当主下载**：`github.com` 在国内时通时断。
  现在 `apk` 走 Pages、`apk_cn` 走 ghproxy 反代同一份 Release 资产（字节一致、App 侧再核 SHA-256），
  Release 原件对外仍可下，只是不当默认线路。
- **国内线路默认选中**：`UPD_LINES` 里 `cn` 排前面，所以校网里默认走 ghproxy 那条。
  jsDelivr 的 `@gh-pages` 分支地址对大文件会 301 到 `raw.githubusercontent`，那条在国内基本不通，
  所以它只用来兜底清单，不再当安装包线路。
- **应用内下载已恢复**：从旧 worktree 找回 `UpdateDownloader.java` 和 `ApkProvider.java`，
  迁移到 `com.nepu.dongyoutong`，注册 `AndroidUpdate`，并把 `NativeApi.update` 接回
  `UpdApi`（此前此出口仍是返回 false 的占位对象）。APK 内直接下载到应用私有目录，
  显示进度、核对清单 SHA-256，然后通过 content URI 拉起系统安装器。
  Android 8.0+ 首次更新要打开「允许从此来源安装应用」，最终安装由用户在系统界面确认。
  网页版没有原生桥，保留系统浏览器下载的回退路径。
- **CNB 还没接**：以后接上就在清单里多写一个 `apk_cn` 指向 CNB，
  `web/app.js` 的线路表不用动（它读的就是 `apk_cn` 这个字段）。
