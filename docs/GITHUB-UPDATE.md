# 用 GitHub 发版 / 检查更新

2026-11-24 起，东油通的「检查更新」接的是**这个 GitHub 仓库**，不再连 hobson.cc 那套。
本文只写怎么用、怎么配、坑在哪；代码在 `web/app.js` 的更新那一段和
`.github/workflows/release.yml`。

## 它是怎么跑起来的

```
我的 → 版本 → [检查更新]
      ↓  web/app.js  checkUpdate(true)
      ↓  UPD_STABLE 里的三条地址（同一份文件，三条线路）
gh-pages 分支 / version.json      ← .github/workflows/release.yml 每次发版重写
      ↓  比 code（整数，比版本号字符串可靠）
比当前大 → 弹层「发现新版本」+ 更新内容
      ↓  [立即更新]
安装包地址（version.json 里的 apk / apk_cn）
```

三条清单地址（`web/app.js` 的 `UPD_STABLE`）:

1. `https://dsy-star.github.io/NepuPass/version.json` —— GitHub Pages，排第一，更新最快
2. `https://cdn.jsdelivr.net/gh/dsy-star/NepuPass@gh-pages/version.json` —— jsDelivr，国内稳
3. `https://raw.githubusercontent.com/dsy-star/NepuPass/gh-pages/version.json` —— 备用

主源成功时备源根本不会发出去（见 `fetchManifest`），所以第 2、3 条只在 Pages 连不上时才用。
**三条必须是同一个分支上的同一份文件**，否则备源可能拿到上一次发版的清单，被判成
「已是最新」——那等于把更新吃掉，而且不报错。

## 第 0 步：先把代码推到 GitHub（这一步最容易漏）

2026-11-24 实测 `dsy-star/NepuPass`：`main` 上只有 59 个文件 —— `README.md`、`LICENSE`、
`android/`，**没有 `web/`**。而且它是一条**独立的历史**（`95fc587 Initial commit` 只加了
LICENSE，`76de96c` 加了 README + android），跟本地这条一百多个提交的历史没有共同祖先。

后果很直接：`android/build_apk.py` 第一步就读 `web/app.js` 对版本号，CI 拿不到这个文件，
**打不出包**；就算绕过去，打出来的 APK 里也没有界面。

所以顺序是：把本地这条历史推上去 → 再打第一个 tag。

```bash
py tools/check_release_tree.py        # 先自查：文件在不在、进没进 git

git fetch github                      # 远端那条历史抓到本地（之后就算强推也不会丢）
git tag gh-origin-backup github/main  # 留个记号，想回看随时 git show
git push --force github HEAD:main     # 历史不相交，普通 push 会被拒，只能强推
```

强推覆盖的是远端那 2 个提交（只有 LICENSE + 56 行 README + android/，
本地都有且更新），覆盖不会丢掉工作区里的东西；不放心就先 `git tag` 留底。

推之前那个自查脚本要跑一遍，它会抓两类问题：

- **文件根本不在** —— CI 在这棵树上一定失败；
- **文件在磁盘上、但没进 git** —— 最常见的一种：`web/nepu.js` 一旦漏掉，
  `web/index.html` 引用的脚本在 APK 里就是 404，页面看着能开、功能却是残的。

`_diag/` 里是本地调试脚本和截图，别一起提交。

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

1. 改版本号 —— **四个文件六个值**，漏一个打包脚本直接拒绝（见 `RELEASE-NOTES.md` 开头）：
   - `web/app.js`：`APP_VERSION` / `APP_CODE`（`code` 只增不减）
   - `android/build_apk.py`：`VERSION_NAME` / `VERSION_CODE`
   - `android/src/com/nepu/dongyoutong/MainActivity.java`：`UA_TAG` 后缀
   - `RELEASE-NOTES.md`：加一节 `## <版本>`，更新内容写成 `- ` 开头的行
2. 提交，然后打 tag 推上去：

```bash
git add -A && git commit -m "0.1.1"
git tag v0.1.1 && git push origin HEAD --tags
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
- **仓库根目录的 `version.json`** 只是本地副本（每次 `tools/make_update_json.py`
  出来的同一份），真正被 App 读的是 gh-pages 分支上那份。改发版流程时别只改根目录这个。

## 坑

- **别把安装包放 Release 当主下载**：`github.com` 在国内时通时断。
  现在 `apk` 走 Pages、`apk_cn` 走 jsDelivr，Release 里那份只是留档。
- **国内线路默认选中**：`UPD_LINES` 里 `cn` 排前面，所以校网里默认走 jsDelivr。
- **应用内下载已恢复**：从旧 worktree 找回 `UpdateDownloader.java` 和 `ApkProvider.java`，
  迁移到 `com.nepu.dongyoutong`，注册 `AndroidUpdate`，并把 `NativeApi.update` 接回
  `UpdApi`（此前此出口仍是返回 false 的占位对象）。APK 内直接下载到应用私有目录，
  显示进度、核对清单 SHA-256，然后通过 content URI 拉起系统安装器。
  Android 8.0+ 首次更新要打开「允许从此来源安装应用」，最终安装由用户在系统界面确认。
  网页版没有原生桥，保留系统浏览器下载的回退路径。
- **CNB 还没接**：以后接上就在清单里多写一个 `apk_cn` 指向 CNB，
  `web/app.js` 的线路表不用动（它读的就是 `apk_cn` 这个字段）。
