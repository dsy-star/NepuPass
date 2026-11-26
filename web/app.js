/* 东油通 · 手机端逻辑
   纯原生 JS，无框架、无构建步骤。

   数据来源有两条，都在本机：
   - Android：`window.AndroidNepu`（NepuBridge.java）拿教务的课表/成绩/考试/公告，
     再交给 `web/nepu.js` 归一成界面用的结构；
   - 网页版：同源的本地服务，由它去登录教务系统。

   🔴 这个文件里不要再加任何「运营后台」相关的代码（老的 stats/数据台已整个删除）。 */

'use strict';

// ------------------------------------------------------------------ 常量

/* 本地缓存键。
   zt.data / zt.settings 是课表那一套（早就有）；后面三个是「不需要强即时性」的数据，
   存本机是为了**打开软件就有东西看**，而不是每次都去问学校服务器。
   🔴 只有一卡通**余额**必须联网 —— 它随时会变，缓存下来的数字会骗人。
      消费记录、办事入口、公告都属于「几小时前的也一样有用」。 */
const KEY = {
  token: 'zt.token', data: 'zt.data', settings: 'zt.settings',
  card: 'zt.card', apps: 'zt.apps', notice: 'zt.notice',
  /* 作业/考试的截止时间**精简后**存一份（0.47.8）。
     🔴 为什么必须落盘：TODO 原来只在内存里，用户不点「学习通」就永远是空的 ——
        而作业提醒是按「未来几天的截止点」排的，没有这份数据就一条都排不出来。
        存的是算完提醒要用的四个字段，不是整份扫描结果（那有几百 KB）。
        可能过期：隔一天再打开，里面的截止时间还是上次那份。这是**故意**的，
        过期数据比「什么都没有」有用，而且下次查到会整体覆盖。 */
  due: 'zt.due',
  /* 今天已经做完的积分任务（0.49.0）。
     🔴 为什么必须落盘：`WT.run` 只在内存里，关掉 App 就没了。用户做完八个任务，
        下次打开看到的还是「待做 8 个」—— 他会以为白做了，然后再点一遍。
        平台那边的「已做次数」有时不跟着变（缓存 / 平台自己没刷），
        只信服务端就等于每次都要重做一遍。
     格式 `{d:"2026-11-07", done:{refId:1,...}, total:8}`，日期不是今天就整体作废。
     `total` 是上次读到的任务条数，给桌面小组件算进度用。 */
  wtDone: 'zt.wtdone',
  /* 「今天有几台设备」用的临时标识（0.49.0 v8）。
     🔴 它不是设备码，也不是安装 ID：每天重新生成一个随机串，跨天换、卸载重装换，
        跟手机硬件、账号、学号都没有任何关系。所以它能回答「今天有几台」，
        **回答不了**「上周来的人这周还来不来」。
     存两天：当天的码（devDay）+ 今天打过没有（devSent）。
     只存这两个键，不碰其他任何数据。 */
  devDay: 'zt.devday', devSent: 'zt.devsent',
  /* 上次登录慧生活用的手机号（0.49.0 v10）。
     🔴 它**跟着账号走，但不跟着退出走**：退出登录只清 token，手机号留着 ——
        用户 2026-11-08：「退出登录后应该能默认记忆手机号」。
        存明文手机号没有额外风险：它本来就在账号卡上以「138****5678」露着，
        而且这台手机的主人知道自己号码；省下的是一次翻通讯录。
        只存一个号（两个账号是同一个号），不存验证码、不存 token。 */
  wtPhone: 'zt.wtphone',
  /* 手动标了「我交过了」的作业（2026-11-13）。
     格式 `{"课程|标题": 标记那一刻的截止秒}`，只存没交的那几条，做完就删。

     🔴 为什么需要它：我们判「交没交」只能看学习通自己翻没翻状态。实测有
        「在小程序里交了、网页状态还是未交」的作业 —— 那条会一直挂在列表上、
        一直按点提醒、课表上一直挂一颗刻度。用户唯一的办法是卸载重装，
        而这明明是**他知道自己交了**这一件再简单不过的事。
     🔴 存的是「截止秒」而不是 `true`：老师把截止时间改晚时，那条作业
        应该复活（他并没有交这份新期限的作业）。差 1 小时以内算同一次，
        因为学习通列表只给「剩余 90 小时」，每次反推都会差几秒。 */
  cxDone: 'zt.cxdone',
  /* 「这条作业/考试是什么时候第一次被我们看见的」（2026-11-15）。
     收到收件箱里当「新发布」用 —— 学习通不给发布时间，我们只能记「第一次
     见到它」的时刻。格式 `{"课程|标题": 首次见到的秒}`，超过一周的自动清掉。

     🔴 只存「第一次」，每次扫到不刷新：否则一条挂了半年的作业永远显示「新发布」。
     🔴 不存到账号里、退出不清：它只影响一条消息的措辞，不是凭据。 */
  cxSeen: 'zt.cxseen',
  /* 从**收件箱**里捡出来的作业 / 考试（2026-11-15）。
     用户：「如果发现收件箱里出现作业列表没有出现的，那就把它存进学习界面的
     作业或者考试里面，不要仅仅停留在收件箱」。

     它不是扫描结果，是「消息里提到、但作业列表里没有」的那几条的**存根**：
     `[{"k":"work","t":"第7章作业","c":"高等数学","u":"https://…","at":秒}]`。
     格式保持精简（不带正文、不带 status），因为它要活很久 ——
     一条作业的消息可能比那次扫描的数据还长寿。

     🔴 为什么不并进扫描缓存：那份缓存的写入方是 native.js / bridge.py 两份实现，
        并进去等于同一个规则写两遍（这个坑吃过很多次）。这里只动界面这一份，
        两端的表现天然一致。
     🔴 必须落盘：不落盘的话，收件箱 5 分钟缓存一过期、或者重启一次，
        那条刚被捡回来的作业就消失了 —— 用户看到的还是「消息里有、作业里没有」。 */
  cxMailTodo: 'zt.cxmtodo',
};
const DAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

/* 🔴 版本号只在这里写一次。
   以前「我的 → 版本」那行是 HTML 里写死的 0.1.0，安卓的 versionName 又写在
   build_apk.py 里，两处各写一遍，迟早会出现「软件里显示 0.1.0、装上去是 0.1.1」
   这种没法解释的事。现在 build_apk.py 从这里读，更新清单里的
   version/code 也由 tools/make_update_json.py 从这里读。
   code 是整数，只增不减：比版本号字符串靠谱（"0.10.0" < "0.9.0" 是字符串比较的经典坑）。 */
const APP_VERSION = '0.1.9';
const APP_CODE = 200;

/* 功能说明书的地址（2026-11-15）。
 *
 * 为什么不在包里放一份：这份说明要配界面图，五张图三百多 KB，而说明书是
 * **经常要改**的东西 —— 改一句就得发一版，没人受得了。放站点上之后，
 * 改完 md 重跑 `_lab/out/_make_help_page.py` 再 deploy，手机上打开就是新的。
 *
 * 🔴 别再指回腾讯文档（2026-11-15 实测）：无登录态打开只回一句
 *    「此文档已设置权限，请登录后使用」，正文 0 字。App 的 WebView 里没有
 *    腾讯的登录态，用户看到的就是一页白 —— 而这正是「说明打不开」的形状。
 *    自家 /help/ 不需要任何登录，也不依赖第三方。
 * 🔴 末尾这个斜杠别省：站点 html_handling 是 auto-trailing-slash，
 *    写成 /help 会 307 多跳一次。
 */


/* 这一版是**测试版**还是正式版。2026-11-06 加。
 *
 * 为什么要有：那几天一天发两三个版，每发一次用户就得装一次，还得盯着有没有
 * 新问题 —— 换谁都会烦。现在的做法是：改完先打成测试版，只在手上装着，
 * **不进更新清单**（version.json 不动，所以别人「检查更新」永远看不到它）；
 * 攒够几处改动了再一起正式发一版。
 *
 * 🔴 这个值由 mobile/beta.py 改：打测试版时写 'beta'，正式发版写 'stable'。
 *    两边对不上的后果很隐蔽 —— build_apk.py --beta 会核这一项，
 *    正式打包时也会核（'beta' 的包不许进 version.json）。 */
const APP_CHANNEL = 'local';

/* 测试版序号（2026-11-07 起）：同一版号下的 v1 / v2 / v3…，正式版永远是 0。
 *
 * 用户原话：「以 0.49.2 的测试版 v1，v2 之类的来称呼非正式版本」。
 * 为什么单独一个数：攒量策略改了 —— 测试版不再每次 +1 版号，
 * 一整个开发周期都挂在同一个号上（0.49.2）。光看版号分不出手上装的是第几版，
 * 而这个数在「我的 → 版本」里是唯一能对上的线索。
 *
 * 🔴 由 mobile/beta.py 的 set_ver() 写，别手改。 */
const APP_BETA_SEQ = 14;

/* 「手上这一版」在界面上的写法：正式版 `0.48.0`，测试版 `0.49.0 v2`。
   同一个版号下会打好几个测试版，不带序号的话，手上这个包、录屏里说的那个包、
   用户报问题时报的那个包，三边对不上。 */
const MYVER = APP_VERSION +
  (APP_CHANNEL === 'beta' && APP_BETA_SEQ > 0 ? ' v' + APP_BETA_SEQ : '');


/* 两套运行环境共用这一份界面：
     NATIVE=false  手机浏览器 + 电脑上的 bridge.py（凭据用 Windows DPAPI 存在电脑）
     NATIVE=true   APK 里（凭据用 Android Keystore 存在手机）
   凡是「存在哪台机器上」的说法都得跟着变 —— 在 APK 里写「存在这台电脑上」
   就是错的，会让人以为手机在偷偷连电脑。 */
const NATIVE = !!window.NativeApi;
const envText = (web, app) => (NATIVE ? app : web);

/* 默认作息：东油教务一节 45 分钟。
   教务页面里的节次配置只给了可靠的开始时间，下午几节的结束时间对不上
   （13:30 配 14:45、14:20 配 15:35，会和下一节叠在一起），所以这里按
   开学时间 + 45 分钟排，和排课记录里的真实起止一致（7-8 节 15:25-17:00）。
   同步到教务数据后会用 Nepu.periodTimes 算出的作息覆盖它；想自己调就在
   「我的 → 设置 → 上课时间和提醒」里改，改完存本地。 */
const DEFAULT_TIMES = [
  ['08:00', '08:45'], ['08:50', '09:35'],
  ['09:55', '10:40'], ['10:45', '11:30'],
  ['13:30', '14:15'], ['14:20', '15:05'],
  ['15:25', '16:10'], ['16:15', '17:00'],
  ['18:00', '18:45'], ['18:50', '19:35'],
  ['19:55', '20:40'], ['20:45', '21:30'],
];

// 旧的默认作息。用户如果只是点过「保存」但没真改，localStorage 里存的是这一套，
// 光改 DEFAULT_TIMES 不会生效 —— 得认出来并替换掉。
const LEGACY_TIMES = [
  ['08:00', '08:45'], ['08:50', '09:35'],
  ['09:55', '10:40'], ['10:45', '11:30'],
  ['14:30', '15:15'], ['15:20', '16:05'],
  ['16:15', '17:00'], ['17:05', '17:50'],
  ['19:30', '20:15'], ['20:20', '21:05'],
];

// ------------------------------------------------------------------ 存储

const store = {
  get(k, dflt) {
    try { const v = localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  },
  /** 写不进去时返回 false。
   *
   *  🔴 以前这里把异常整个吞掉（`catch (e) {}`），存储满了也不吭声 ——
   *     结果是「这次同步的数据没存下」，用户下次打开又要重新同步一遍，
   *     而且永远查不到原因。现在至少先牺牲最不要紧的那份（公告能重新拉），
   *     给课表/成绩腾个位置；还是不行就如实返回失败。 */
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) {
      try {
        // 只扔公告缓存：它能重新拉，课表/成绩/设置不能。
        if (k !== 'zt.notice') localStorage.removeItem('zt.notice');
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch (e2) {
        return false;
      }
    }
  },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

let TOKEN = (() => {
  const q = new URLSearchParams(location.search).get('k');
  if (q) { store.set(KEY.token, q); return q; }
  return store.get(KEY.token, '') || '';
})();

let DATA = store.get(KEY.data, null);
/* 本机有没有存住凭据。null = 还没问过（别急着提示用户）。
   和「有没有课表数据」是两回事：数据在、密码没存是真实存在的情况。 */
let BOUND = null;
/* 凭据的更细状态：'none' 从没存上 / 'ok' 存着且解得开 / 'broken' 存着但解不开。
   🔴 这三种要说三套话。「存着但解不开」说成「没保存」，用户会以为软件每次
      都在骗他 —— 明明输过、明明提示保存成功，下次又要重输。 */
let CRED_STATE = null;
/* 上一次保存失败的原因（'fail: xxx'），只为在界面上说清楚，不落盘。 */
let CRED_ERR = '';
/* 正在看的**历史学期**课表。null = 就渲染 DATA 里那份（教务系统的当前学期）。
 *
 * 2026-10-31 加。用户原话：「你这怎么切换不了学期」「给我自己绑定的大二学年」——
 * 之前课表只能看学校**此刻**认定的那个学期，想回头翻上学期的课只能等教务系统
 * 自己切。教务系统的课表表单本来就有 `semester.id`，传上学期的 id 就能取回来。
 *
 * 有值时形如 { id, semester, courses, unitCount, totalWeeks, weekStart }，
 * 字段和 DATA 里那几个**同名**，所以下面所有渲染只要读 `tt()` 就行。
 * ⚠️ 不落盘：翻历史学期是临时看一眼，下次打开 App 应该回到当前学期 ——
 *    否则用户过几天打开，看到的是一张旧课表，会以为这学期没课。
 * 🔴 也**不改 DATA**：DATA 是同步下来的整份数据（成绩、考试、培养计划都在里面），
 *    拿历史学期的课表覆盖它，会连带把「这学期在读学分」之类的统计算错。 */
let TT = null;
/* 正在取某个学期的课表。取数期间禁止再点 —— 学校服务器有「别点太快」的守卫。 */
let ttLoading = false;
/* 现在渲染用的那份课表。历史学期用 TT，否则用同步下来的 DATA。
 *
 * 🔴 名字不能叫 `tt` —— 这个文件里有十几处 `const tt = times()`
 *    （作息表），全局访问器跟它们撞名时，指向的是**那个局部变量**：
 *    同一个函数里先 `curTT().unitCount` 再 `const tt = times()` 更是直接
 *    TDZ 抛错，整张课表画不出来，控制台只有一句
 *    "Cannot access 'tt' before initialization"。 */
const curTT = () => TT || DATA || {};
/* 看的是不是当前学期。历史学期不能说「今天」「本周」——
   那学期早结束了，日期和今天对不上，说「今天第 3 周」是错的。 */
const ttIsNow = () => !TT;
/* 考试页选中的学期 id。'' = 教务系统默认的那个（当前学期）。 */
let examTerm = '';
/* 正在取某一学期的考试。取数期间界面显示「正在取…」，别让人以为没数据。 */
let examLoading = false;
/* 正在取的是哪个学期。用户可能在取数期间又点了别的 chip —— 只有
   「正在取的」和「选中的」是同一个学期时才算 loading，否则那一格会
   一直转圈（其实根本没在取它）。 */
let examLoadingSid = '';
/* 取数期间又被点了的学期，等这一次结束再补取。 */
let examPending = '';
/* 某一学期取失败的原因（sid → 原文）。只在内存里：下次进来重新试，
   不把一次网络抽风钉死成「这学期没有考试」。 */
const EXAM_ERR = {};
/* 上一次 renderExams 画出来的那批（按显示顺序）。点「加进日历」时按 data-i
   回查是哪一场 —— 不能按课程名找，同一门课可能既有结课考又有期末考。 */
let examItems = [];
/** 考试页「已考完」那段是不是展开着。
 *  不落盘：这是个临时看法，下次进来重新按「只看接下来考什么」开始。 */
let examPastOpen = false;
/* 整份同步是否正在进行。四个入口共用一个开关，防止连点变成两次登录。 */
let syncing = false;
let nepuSession = false;
let nepuTerms = [];
const NEPU_TIMEOUT = 150000;
const nepuPending = new Map();
let nepuRequestId = 0;
function nepuBridgeCall(method, ...args) {
  const bridge = window.AndroidNepu;
  if (!bridge || typeof bridge[method] !== 'function') {
    return Promise.reject(new Error('请在东油通 App 内打开教务登录'));
  }
  const id = ++nepuRequestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nepuPending.delete(String(id));
      reject(new Error('教务操作超时，请检查网络后重试'));
    }, NEPU_TIMEOUT);
    nepuPending.set(String(id), { resolve, reject, timer });
    try { bridge[method](id, ...args); }
    catch (e) {
      clearTimeout(timer); nepuPending.delete(String(id)); reject(e);
    }
  });
}
window.__nepuDone = function (id, json) {
  const pending = nepuPending.get(String(id));
  if (!pending) return;
  clearTimeout(pending.timer);
  nepuPending.delete(String(id));
  try {
    const result = typeof json === 'string' ? JSON.parse(json) : json;
    if (result && result.ok) pending.resolve(result);
    else {
      const error = new Error((result && result.error) || '教务操作失败');
      error.kind = (result && result.kind) || '';
      pending.reject(error);
    }
  } catch (e) { pending.reject(e); }
};
/* 后台「把其他学期的考试也提前拉一遍」的进度。
   prefetchTok 是轮次号：换账号、重新同步都会 ++，正在跑的那一轮自己退出。 */
let prefetching = false;
let prefetchTotal = 0;
let prefetchDone = 0;
let prefetchTok = 0;
let CFG = Object.assign(
  { startDate: '', week: 0, view: 'week', cursor: '', times: null, timesSource: '', hidden: [],
    // 自己给课程定的颜色：{ 课名: 色相 0~359 }。没记就是按课名散列（见 colorHue）。
    // 🔴 键是**课名**不是 code：教务数据里同一门课常被拆成好几条（不同周次、
    //    不同教室），按 code 存会出现「只改了其中一格」。
    cColors: {},
    // 上一次「打开/画课表」是哪一天（YYYY-MM-DD）。
    // 🔴 week / cursor 都存本机，而它们只在**当天**有意义 —— 见 syncToday()。
    seenDay: '',
    // 余额提醒：默认开着、阈值 20 元。一卡通刷完才发现没钱是最常见的懊恼，
    // 而这条提示是**常驻行内提示**，不弹窗 —— 弹窗会被点掉，行内的一直在。
    alertOn: true, alertLow: 20,
    theme: 'system',
    // 检查更新：默认开着，默认**每天查一次**（一次请求，几百字节）。
    // 为什么不是「每次打开」：一天开十次 App 就查十次，而一天之内
    // 根本不会有新版本 —— 纯属白耗流量。想更勤可以在设置里改成「每次打开」。
    updOn: true, updFreq: 'daily', updLast: 0, updSkip: '',
    // 绑定完课表后「要不要开提醒」问过没有（0.48.1）。
    // 🔴 只问一次：每次绑定都弹一遍就成了骚扰，用户会直接点「先不用」
    //    然后永远不再看它。问过、答过，这个标记就置 true，跟开关无关。
    remindAsked: false,
    // 「求一次 Star」问过没有（2026-11-25）。和 remindAsked 一个道理：
    // 只问一次，答过（点了或跳过）就永不再提 —— 反复问是最快让人卸载的做法。
    // 🔴 记的是「问过」，不是「点过」：跳过也是回答。
    starAsked: false,
    // 这个 App 被打开过几次（只数真正画界面的那种，后台那个隐藏页面不算）。
    // 求 Star 的时机靠它：第一次打开就伸手是要糖，不是道谢。
    launchN: 0,
    // 后台自动（0.50.0 v5）：默认**两个都关**。
    // 后台联网、替用户动账号这种事，不能自己替他打开。
    //   cxOn   学习通每隔 cxMin 分钟自己查一次
    //   wtOn   今天没做完就自己跑一遍积分任务（做完当天不再动）
    auto: { cxOn: false, cxMin: 120, wtOn: false },
  },
  store.get(KEY.settings, {})
);

const THEME_MODES = ['system', 'light', 'dark'];
// 选择器上的三个字（2026-11-25）：设置页的按钮、「我的」那行灰字都读这一份。
// 写在头顶而不是设置页旁边 —— renderMe 也可能先跑到，别让它撞上暂时性死区。
const THEME_LABELS = { system: '跟随系统', light: '浅色', dark: '深色' };
// Keep all existing component-level dark styles aligned with the user's choice,
// not only the global palette. Local stylesheets are loaded before this script.
const themeMediaRules = [];
for (const sheet of document.styleSheets) {
  try {
    for (const rule of sheet.cssRules) {
      if (rule.media && rule.media.mediaText === '(prefers-color-scheme: dark)') {
        themeMediaRules.push(rule);
      }
    }
  } catch (_) { /* Cross-origin stylesheets are not part of the local theme. */ }
}
function applyTheme(mode) {
  const selected = THEME_MODES.includes(mode) ? mode : 'system';
  const firstUse = !THEME_MODES.includes(CFG.theme);
  CFG.theme = selected;
  if (firstUse) {
    try { store.set(KEY.settings, CFG); } catch (_) {}
  }
  document.documentElement.dataset.theme = selected;
  for (const rule of themeMediaRules) {
    rule.media.mediaText = selected === 'system'
      ? '(prefers-color-scheme: dark)'
      : (selected === 'dark' ? 'all' : 'not all');
  }
  const dark = selected === 'dark' ||
    (selected === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.content = dark ? '#101010' : '#f7f7f7';
  });
  if (window.AndroidTheme && typeof window.AndroidTheme.setTheme === 'function') {
    window.AndroidTheme.setTheme(selected);
  }
}
applyTheme(CFG.theme);
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const onSystemThemeChange = () => {
  if (CFG.theme === 'system') applyTheme('system');
};
window.__onSystemThemeChanged = onSystemThemeChange;
if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener('change', onSystemThemeChange);
else if (systemThemeQuery.addListener) systemThemeQuery.addListener(onSystemThemeChange);

// 认旧的默认作息：等于 LEGACY_TIMES 就说明用户没真改过，直接换成新的。
// （只要有一条不一样就尊重用户的选择，不覆盖）
if (CFG.times && CFG.times.length === LEGACY_TIMES.length &&
    CFG.times.every((r, i) => r && r[0] === LEGACY_TIMES[i][0] && r[1] === LEGACY_TIMES[i][1])) {
  CFG.times = null; CFG.timesSource = '';
}

// 本机还存着 0.1.4 及更早同步下来的坏作息：教务页面的下午节次结束时间对不上，
// 第 5 节起每节 75 分钟且压到下一节头上。这种表画出来的时间轴是错的，
// 留着还不如回到默认 —— 下次同步会用排课记录重新算一份。
if (CFG.times) {
  const broken = CFG.times.some((r, i) => {
    if (!r) return false;
    const start = hhmmToMin(r[0]), end = hhmmToMin(r[1]);
    if (start == null || end == null || !(end > start)) return true;
    const next = CFG.times[i + 1];
    return !!(next && next[0] && hhmmToMin(next[0]) != null && hhmmToMin(next[0]) < end);   // 结束晚于下一节开始 = 重叠
  });
  if (broken) { CFG.times = null; CFG.timesSource = ''; }
}

/* 出问题的时候，悄悄把「哪一类问题、哪个版本、它说的话」发回去。
 *
 * 2026-11-06 加。起因很具体：连着几天都在猜。用户说「绑不上」，手上只有一张
 * 截图；改完发出去，还得等他再来反馈一次才知道有没有好，而中间可能还有
 * 二十个同样的人一句话没说就放弃了。有了这份上报，至少能回答三个问题：
 * 多少人遇到、从哪个版本开始、卡在哪一档。
 *
 * 🔴 三条线，改这段之前先读：
 *   1) **不带任何能指到人的东西**。账号、学号、姓名、手机号、设备号，一个都不发。
 *      发出去的只有：版本、渠道（正式/测试）、平台、问题类型、错误档位、
 *      **脱敏后**的原话、哪一页、同一次打开里第几次。
 *   2) **客户端和服务端各脱敏一次**。这不是重复：客户端哪天漏了一条，
 *      服务端还能兜住（见 worker/index.js 的 shape）。
 *   3) **失败不许打扰用户**。发不出去就攒着下次再发，攒满丢最旧的；
 *      全程不弹提示、不 await、不许拖慢任何主流程。
 *
 * 用户可以在「我的 → 匿名问题上报」里关掉（CFG.reportOn）。关掉之后
 * 一条都不发，也**不攒** —— 关的意思就是关，不是「先攒着，等打开再发」。
 */
const LOG_MAX = 200;
const LOG_LINE_MAX = 300;
const FEEDBACK_URL = '';
let LOG_BUF = null;

/** 把可能指到人的东西抹掉。`max` 是这条最多留多少字。
 *
 *  ⚠️ 顺序不能换，理由见 reportScrub：打过码的学号 → 邮箱 → IP →
 *     查询串里那几个键 → 连续 5 位以上数字。反过来会互相切开。
 */
function logClean(s) {
  return String(s == null ? '' : s)
    .replace(/\d{3,4}\*{2,}\d{2,4}/g, '#')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '#')
    .replace(/\b(password|passwd|pwd|token|sign|auth|session|cookie|uid|userId)=([^&\s]+)/gi, '$1=#')
    .replace(/\b(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, '$1.*.*')
    .replace(/\d{5,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LOG_LINE_MAX);
}

function logStamp() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
         p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/** 记一行日志。**永远不抛错**：日志写不进去不能连累正事。 */
function appLog(msg) {
  try {
    if (!LOG_BUF) LOG_BUF = store.get('zt.log', []) || [];
    LOG_BUF.push(logStamp() + ' ' + logClean(msg));
    while (LOG_BUF.length > LOG_MAX) LOG_BUF.shift();
    store.set('zt.log', LOG_BUF);
  } catch (e) { /* 日志自己坏了，绝不能连累正事 */ }
}

/** 整段日志（一行一条）。 */
/* 界面自己抛的错（改坏一处、某个字段 undefined 之类）。
 *
 * 🔴 只报**一句话**，不报堆栈：堆栈里全是文件路径和行号，对我们排查没用
 *    （代码就是我们自己写的），却可能把用户的目录名带出去。
 *    真的要看堆栈，让他截图发过来就行。 */

// ------------------------------------------------------------------ 工具

const $ = (id) => document.getElementById(id);
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms || 2000);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function api(path, body) {
  if (path === '/api/state') {
    return { ok: true, data: DATA, config: CFG, version: APP_VERSION, native: NATIVE };
  }
  if (/^\/api\/(water|cx)\//.test(path)) {
    if (NATIVE) return window.NativeApi.handle(path, body || {});
    return { ok: false, kind: 'native_unavailable', error: '此功能需在东油通 Android 版使用' };
  }
  if (/^\/api\//.test(path)) {
    return { ok: false, kind: 'school_not_configured', error: '东油适配中' };
  }

  if (/^\/api\/(cw|water|cx)\//.test(path)) {
    return { ok: false, kind: 'native_unavailable', error: '此功能需在东油通 Android 版使用' };
  }
  const opt = { method: body ? 'POST' : 'GET', headers: { 'X-Token': TOKEN } };
  if (body) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  if (r.status === 403) throw new Error('访问凭证错误，请重新扫描电脑启动窗口的二维码');
  return r.json();
}

const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
/* 两种日期写法，别混用：
   `mdDot`   → 10.12   周条副标题里用（比「10月12日」短，一行放得下）
   `mdSlash` → 10/12   日头里用（和大部分课表 App 一致，一眼认得出是日期） */
const mdDot = (d) => (d.getMonth() + 1) + '.' + pad2(d.getDate());
const mdSlash = (d) => (d.getMonth() + 1) + '/' + pad2(d.getDate());
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
const today0 = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
}

// 往「后」找最近的周一。
function mondayAfter(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (x.getDay() + 6) % 7;
  return addDays(x, back === 0 ? 0 : 7 - back);
}

// 学期的「最早可能开学日」：秋季从 9/1 起，春季从 2/20 起。
// 学期号兼容「第 1 学期」和「第一学期」两种写法——教务系统的措辞会变，
// 认不出来就会掉进「拿今天当第 1 周」的兜底，整张表悄悄错位。
function semesterBase(semester) {
  // ⚠️ `第` 必须可选。教务系统两种写法都出现过：
  //     课表页学期名  `2026-2027 学年第 1 学期`
  //     考试页学期下拉 `2026-2027学年1学期`
  //    只认带「第」的那种，用下拉里那串名字算开学日就会解析失败、退化成
  //    「今天所在的周一」—— 而 2026-10-31 的学期切换正好把下拉的名字
  //    写进了课表学期名，历史学期整张表会因此错位好几个月。
  //    termParts() 早就把「第」当可选了，这两处必须同时放宽。
  const m = /(\d{4})-(\d{4})\s*学年\s*第?\s*([12一二])\s*学期/.exec(semester || '');
  if (!m) return null;
  const term = m[3] === '一' ? 1 : m[3] === '二' ? 2 : Number(m[3]);
  const y1 = Number(m[1]);
  return term === 1 ? new Date(y1, 8, 1) : new Date(y1 + 1, 1, 20);
}

function defaultStart(semester) {
  const base = semesterBase(semester);
  if (!base) return mondayOf(today0());
  // 🔴 这里必须往「后」找周一，不能往「前」。
  //    2026-09-01 是周二，往前找会得到 8/31，于是整学期周次多算一周
  //    （用户 2026-10-18 的 WakeUp 截图是第 6 周，按 8/31 会算成第 7 周）。
  //    学期不可能在 9/1 之前开学，所以「9/1 之后最近的周一」= 9/7 才对。
  return mondayAfter(base);
}

// 旧版本用 mondayOf(base) 当默认值，会算出比真实开学早一周的日期。
// 已存进 localStorage 的旧默认值要迁移掉，否则老用户永远差一周。
// 判据：存的正好等于「旧算法对当前学期算出的值」才改——用户自己挑的日期不碰。
function migrateStartDate(semester) {
  const base = semesterBase(semester);
  if (!base || !CFG.startDate) return false;
  const oldDefault = ymd(mondayOf(base));
  const newDefault = ymd(mondayAfter(base));
  if (oldDefault !== newDefault && CFG.startDate === oldDefault) {
    CFG.startDate = newDefault;
    return true;
  }
  return false;
}

/** 这一学期第 1 周的周一。
 *
 *  🔴 历史学期**不能**用 CFG.startDate：那是当前学期（用户可能自己调过）的
 *     开学日，套到去年那个学期上，整张表的日期会偏出好几个月。
 *     历史学期没有存过校历，只能按学期名推算 —— 比真实开学日可能差一两天，
 *     但周次条、日期范围、课程格子之间的关系是自洽的。
 */
const startDate = () => {
  if (TT) return defaultStart(TT.semester);
  return CFG.startDate ? parseYmd(CFG.startDate) : defaultStart(DATA && DATA.semester);
};

/** 学期总周数。
 *
 *  默认取教务系统给的（`marshalTable` 的 endWeek，实测 24），但允许用户
 *  在「学期设置」里改：学校临时调校历、或者哪天接口取不到这个数，
 *  得有个地方能自己填 —— 否则整学期的周次条就只有一半。
 *  `CFG.weeks` 为空 / 0 / 越界都当「没设置」，退回数据里的值。
 *
 *  ⚠️ 历史学期**只认教务给的那个数**，不看 CFG.weeks —— 那个值是给当前学期
 *     调的（比如「我们这学期只有 16 周」），套到别的学期上会把周次条截断。
 */
const totalWeeks = () => {
  if (TT) return Math.max(1, Math.floor(Number(TT.totalWeeks)) || 20);
  const n = Math.floor(Number(CFG.weeks));
  if (n >= 1 && n <= 60) return n;
  return (DATA && DATA.totalWeeks) || 20;
};

/** 学期名。历史学期用它自己的名字，当前学期用教务原文（用户改过就用用户改的）。 */
const semesterName = () => {
  if (TT) return TT.semester || '';
  return CFG.semester || (DATA && DATA.semester) || '';
};

// ------------------------------------------------------------------ 大几上/下

/** 入学年份（四位）。全部来自教务处给的学籍信息，不靠猜。
 *
 *  优先级：年级（原文「2025」）→ 入校时间 → 班级名（「25计科1班」）→ 学号前两位。
 *  四个来源任意一个能对上就够用；都对不上返回 0，界面退回显示学期原文。
 */
function enrolledYear() {
  const p = (DATA && DATA.profile) || {};
  const ok = (y) => (y >= 1900 && y <= 2100 && y <= new Date().getFullYear() + 1);
  let y = parseInt(p.grade, 10);
  if (ok(y)) return y;
  let m = /^(\d{4})/.exec(String(p.enrolledAt || ''));
  if (m) { y = parseInt(m[1], 10); if (ok(y)) return y; }
  // 班级名 / 学号里的两位年份：「25计科1班」「2512345678」⇒ 2025
  m = /^(\d{2})/.exec(String(p.className || '')) || /^(\d{2})/.exec(String(p.studentId || ''));
  if (m) { y = 2000 + parseInt(m[1], 10); if (ok(y)) return y; }
  return 0;
}

/** 学期名里的「学年起始年 + 第几学期」。认不出来返回 null。
 *
 *  教务系统两处写法不一样，都得认：
 *    考试页下拉   `2026-2027学年1学期`
 *    课表页学期名 `2026-2027 学年第 1 学期`
 */
function termParts(name) {
  const m = /(\d{4})\s*-\s*(\d{4})\s*学年\s*第?\s*([12一二])\s*学期/.exec(String(name || ''));
  if (!m) return null;
  return { y: Number(m[1]), s: (m[3] === '一' || m[3] === '1') ? 1 : 2 };
}

/** 学期名里的「学年起始年 + 第几学期」。学期名认不出来就按今天推。 */
function academicTerm(semester) {
  const a = termParts(semester);
  if (a) return a;
  // 退路：9 月开学算第一学期；1 月还属于上一学年的第一学期
  const t = today0();
  const mo = t.getMonth() + 1;
  if (mo >= 9) return { y: t.getFullYear(), s: 1 };
  if (mo >= 2) return { y: t.getFullYear() - 1, s: 2 };
  return { y: t.getFullYear() - 1, s: 1 };
}

/** 「大二上」这种说法。
 *
 *  为什么不直接显示「2026-2027 学年第 1 学期」：
 *  那是学校内部的编号，学生说自己从来不说这个 —— 他只说「我大二上」。
 *
 *  算法（三个数就能定，全部来自教务处，不猜）：
 *    入学年   年级 2025（或 入校时间 / 班级名 / 学号）
 *    学年     2026-2027 学年第 1 学期 ⇒ 起始年 2026、第 1 学期
 *    学期序号 = (起始年 − 入学年) × 2 + (第几学期 − 1)
 *    大几     = 序号 ÷ 2 + 1，序号奇偶决定上/下
 *  实测：2026 − 2025 = 1 ⇒ 序号 2 ⇒ 大二上，和他自己的说法一致。
 *
 *  🔴 算不出来、或者算出来的年级比学制还高（延期毕业 / 数据对不上）
 *     就返回空串，界面退回显示学期原文。宁可拗口，也不能瞎编一个「大七上」。
 */
function gradeLabel() {
  const a = academicTerm(semesterName());
  return gradeName(a.y, a.s);
}

/** 学期短名，只给界面用：「大二上」，算不出来才退回教务原文。
 *
 *  课表副标题和选学期的 chip 都用它 —— 学生认「大二上」，
 *  不认「2024-2025 学年第 1 学期」（那是学校内部编号）。
 *  和 gradeLabel 的区别：那个说的是**当前学期**，这个可以传任意学期名。
 */
function termShort(name) {
  const a = termParts(name);
  const g = a ? gradeName(a.y, a.s) : '';
  return g || String(name || '').replace(/\s+/g, ' ');
}

/** 给定「学年起始年 + 第几学期」，算「大二上」。
 *
 *  抽出来是因为**成绩页的学期筛选**也要用同一套说法：
 *  那里的学期来自成绩表（2025-2026 / 1），和当前学期不是一回事。
 */
function gradeName(startYear, term) {
  const y0 = enrolledYear();
  if (!y0 || !startYear || !term) return '';
  const idx = (startYear - y0) * 2 + (term - 1);
  if (idx < 0) return '';
  const n = Math.floor(idx / 2) + 1;
  const dur = parseInt((DATA && DATA.profile && DATA.profile.duration) || '4', 10) || 4;
  if (n > dur + 1) return '';                 // 多留一年给延期毕业，再多就是数据不对
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八'];
  if (n > CN.length) return '';
  return '大' + CN[n - 1] + (idx % 2 ? '下' : '上');
}

/** "2025-09-01" → "2025.09"。学籍里的日期都带日，学生只关心年月。
 *  认不出来就返回空串 —— 让调用方把整行收起来，而不是摆一个 "2025-09-01" 占着。 */
function ymDot(s) {
  const m = /^(\d{4})-(\d{1,2})/.exec(String(s == null ? '' : s).trim());
  return m ? m[1] + '.' + ('0' + m[2]).slice(-2) : '';
}

function weekOf(date) {
  const diff = Math.round((today0() && new Date(date.getFullYear(), date.getMonth(), date.getDate()) - startDate()) / 86400000);
  return Math.floor(diff / 7) + 1;
}
function currentWeek() {
  // 历史学期没有「本周」：那学期早就结束了，按今天算会得到第 60 多周。
  // 界面上默认落在第 1 周，用户自己翻。
  if (TT) return 1;
  const w = weekOf(new Date());
  return Math.min(Math.max(w, 1), Math.max(totalWeeks(), 1));
}

function times() {
  const n = (DATA && curTT().unitCount) || 10;
  const t = (CFG.times && CFG.times.length) ? CFG.times : DEFAULT_TIMES;
  const out = [];
  for (let i = 0; i < n; i++) out.push(t[i] || ['', '']);
  return out;
}

/** 「我的 / 设置」里那一行右侧的灰字：这份作息是哪来的。
 *  nepu = 同步时按教务节次 + 排课记录算出来的；manual = 用户手改过。 */
function timesLabel() {
  if (!CFG.times) return '默认作息，可修改';
  return CFG.timesSource === 'nepu' ? '教务作息 · 可修改' : '已自定义';
}

/** `08:45` → 525（当天第几分钟）。认不出返回 **null**，不是 0。
 *
 *  ⚠️ 别往「0 点」兜底：那样 `nowMin >= 0` 恒成立，
 *     一节没配时间的课会永远显示成「正在上」。宁可不算。
 *  周视图高亮、日视图高亮、「下一节」提示三处共用这一个。 */
function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 此刻是第几分钟。单独抽出来，测试里好固定时钟。 */
function nowMinute() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

/** 第 p 节到第 q-1 节这一整段（跨两节的大课算一块），此刻是不是正在上。
 *  头一节的开始 ~ 最后一节的结束。中间那个 10 分钟课间也算「在上」——
 *  学生这会儿还在那间教室，灯不该灭。 */
function liveAt(tt, p, q, nowMin) {
  const s = hhmmToMin(tt[p] && tt[p][0]);
  const e = hhmmToMin(tt[q - 1] && tt[q - 1][1]);
  if (s === null || e === null) return false;
  return nowMin >= s && nowMin <= e;
}

function weeksText(weeks) {
  if (!weeks || !weeks.length) return '—';
  const a = weeks.slice().sort((x, y) => x - y);
  const parts = [];
  let s = a[0], p = a[0];
  for (let i = 1; i < a.length; i++) {
    if (a[i] === p + 1) { p = a[i]; continue; }
    parts.push(s === p ? '' + s : s + '-' + p);
    s = p = a[i];
  }
  parts.push(s === p ? '' + s : s + '-' + p);
  return parts.join('、') + ' 周';
}

function periodsText(periods) {
  if (!periods.length) return '—';
  const a = periods.slice().sort((x, y) => x - y);
  const parts = [];
  let s = a[0], p = a[0];
  for (let i = 1; i < a.length; i++) {
    if (a[i] === p + 1) { p = a[i]; continue; }
    parts.push(s === p ? '第' + (s + 1) + '节' : '第' + (s + 1) + '-' + (p + 1) + '节');
    s = p = a[i];
  }
  parts.push(s === p ? '第' + (s + 1) + '节' : '第' + (s + 1) + '-' + (p + 1) + '节');
  return parts.join('、');
}

/** 课程颜色 = 一个色相（0~359）。
 *
 *  用户 2026-11-09：「课表改色的功能，能不能改成那种光谱，给用户更多选择」。
 *  原来是八档色槽（`.c0`~`.c7`），八种颜色对二十几门课必然撞色 ——
 *  撞了就是两门不同的课看起来一样，而这个功能的全部意义就是「分得开」。
 *  现在给一条 0~359 的色相滑条，想要多细有多细。
 *
 *  🔴 默认值仍然是**按课名散列到八个互相分得开的色相**，不是随机：
 *     同一门课永远同一个颜色，换台手机也一样，两个同学截同一周的课表能对上。
 *     直接用 `hash % 360` 的话，相邻两门课很容易拿到只差 10 度的两个色相，
 *     看起来就是同一种颜色 —— 那正是这次要解决的问题。
 *  🔴 键是**课名**不是 code：教务数据里同一门课常被拆成好几条记录
 *     （不同周次、不同教室各一条，code 也不同），按 code 存会「只改了一格」。
 */
/* 🔴 2026-11-09 第二次改（用户：「现在的颜色极其难看，灰中泛白，给人一种尸体感」）。
   上一版只把色相放开，明度饱和度写死成 72% / 87% —— 那是拿蓝色的标准去套黄色：
   HSL 里同一个 L 在黄、绿、蓝上完全不是一个亮度，72% 的饱和度压在 87% 的明度上，
   黄色被冲成米白、绿色成了灰绿，整张表像一叠褪色的旧纸。

   现在：**八档默认色逐档记下真实 HSL**，就是 0.50.0 那套
   （rose / orange / amber / emerald / teal / sky / violet / indigo），
   自定义色相在相邻两档之间按角度插值。
   这样默认观感和以前一模一样，拖到任意角度拿到的也是同一「厚度」的颜色。 */
const HUE_SLOT = [
  //  底色色相 底色S  底色L   字色色相 字色S  字色L
  [352.7, 96.1, 90.0, 343.4, 79.7, 34.7],   // 玫红 #fecdd3 / #9f1239
  [32.1, 97.7, 83.1, 15.0, 79.1, 33.7],     // 橙   #fed7aa / #9a3412
  [48.0, 96.6, 76.7, 22.7, 82.5, 31.4],     // 琥珀 #fde68a / #92400e
  [152.4, 76.0, 80.4, 163.1, 88.1, 19.8],   // 翠绿 #a7f3d0 / #065f46
  [168.4, 83.8, 78.2, 176.1, 69.4, 21.8],   // 青绿 #99f6e4 / #115e59
  [200.6, 94.4, 86.1, 201.0, 90.0, 27.5],   // 天蓝 #bae6fd / #075985
  [250.5, 95.2, 91.8, 263.4, 69.3, 42.2],   // 紫   #ddd6fe / #5b21b6
  [228.0, 96.5, 88.8, 243.7, 54.5, 41.4],   // 靛   #c7d2fe / #3730a3
  // 下面两档**只做插值锚点，不参与默认配色**（默认还是上面八档，见 SLOT_HUE）：
  // 250.5 到 352.7 之间原来是一整段 102 度的直线，中间只靠插值 ——
  // 落在 258~300 这个「真紫」区间时，明度被两头拉到 91%，
  // 出来是一片发灰的淡紫，用户 2026-11-09 说的「没法调成紫色」就是这个。
  [258.0, 90.0, 85.0, 263.0, 69.0, 40.0],   // 正紫 #c4b5fd / #6d28d9
  [300.0, 82.0, 88.0, 316.0, 60.0, 40.0],   // 品红 #f0d9f7 / #a21caf
];

/* 调色那一排色卡（0.52.0）。滑条一个像素跨 1.8 度，紫色那一段根本停不住，
   所以给一排能直接点中的色相。名字是给读屏和长按提示用的。 */
const HUE_PRESET = [
  { h: 352, n: '玫红' }, { h: 20, n: '红' }, { h: 32, n: '橙' }, { h: 48, n: '琥珀' },
  { h: 95, n: '黄绿' }, { h: 152, n: '绿' }, { h: 175, n: '青' }, { h: 200, n: '天蓝' },
  { h: 228, n: '靛' }, { h: 258, n: '紫' }, { h: 285, n: '紫红' }, { h: 315, n: '品红' },
];
// 🔴 字色和底色**不是同一个色相**：橙色块的底色在 32°，字色在 15°。
//    只存一个色相再去算字色，橙色块的字会变成橘红（蓝通道差 70）。
//    所以每档记两个字色相，任意角度上按「字色色相 - 底色色相」的差插值。
// 🔴 S/L 保留一位小数，别四舍五入成整数：饱和色取整后会明显偏色
//    （玫红那档的字色 #9f1239 取整成 80%/35% 后会变成 #a11223，蓝通道差了 22）。
const SLOT_HUE = HUE_SLOT.map((x) => Math.round(x[0]));
// 按色相排好，插值时找「包住这个角度的两个锚点」。
const HUE_RING = HUE_SLOT.slice().sort((a, b) => a[0] - b[0]);

function colorHue(name) {
  const key = String(name || '');
  const ov = (CFG.cColors || {})[key];
  if (typeof ov === 'number' && ov >= 0 && ov < 360) return Math.round(ov);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SLOT_HUE[h % 8];
}

/** HSL → RGB（0~255）。只给对比度兜底用。 */
function hslRgb(h, s, l) {
  const hh = ((((h % 360) + 360) % 360) / 60);
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; }
  else if (hh < 2) { r = x; g = c; }
  else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; }
  else if (hh < 5) { r = x; b = c; }
  else { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function wcagLum(c) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

function contrastOf(a, b) {
  const la = wcagLum(a);
  const lb = wcagLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 色相 → 一对底色/字色。跨 0 度那段也插（352.7° 与 32.1° 是相邻两档）。 */
function hueTone(hue) {
  const h = Math.max(0, Math.min(359, Number(hue) || 0));
  const r = HUE_RING;
  const n = r.length;
  let j = n - 1;                       // 落在第一档左边 = 当成「最后一档 → 第一档」
  for (let k = 0; k < n; k++) if (r[k][0] <= h) j = k;
  const a = r[j];
  const b = r[(j + 1) % n];
  const span = ((b[0] - a[0]) + 360) % 360 || 1;
  const t = (((h - a[0]) + 360) % 360) / span;
  const mix = (u, v) => u + (v - u) * t;
  const r1 = (x) => Math.round(x * 10) / 10;      // 一位小数，取整会偏色
  // 字色的色相按「和底色差了多少度」来插：橙色块是 -17°，绿色块是 +11°。
  const dA = a[3] - a[0];
  const dB = b[3] - b[0];
  const dFg = ((dB - dA + 540) % 360) - 180;      // 取近的那一头，别绕圈
  const fgH = (((h + dA + dFg * t) % 360) + 360) % 360;
  const bs = r1(mix(a[1], b[1]));
  const bl = r1(mix(a[2], b[2]));
  const fs = r1(mix(a[4], b[4]));
  let fl = r1(mix(a[5], b[5]));
  // 🔴 两档之间是插值出来的，插到黄绿那一段会「亮底配中亮字」：
  //    h=90 时原始插值只有 3.9，字糊在底上。所以加一道兜底 ——
  //    只把字压深，压到达标为止。八档锚点本来就 ≥5.4，一格都不会动，
  //    默认配色因此仍然是「原样」。
  const bg = hslRgb(h, bs, bl);
  for (let i = 0; i < 30 && contrastOf(bg, hslRgb(fgH, fs, fl)) < 4.6; i++) {
    fl = r1(Math.max(10, fl - 1.2));
  }
  return { h: Math.round(h), fgH: r1(fgH), bs: bs, bl: bl, fs: fs, fl: fl };
}

/** 五个 CSS 变量：色相 + 浅色一对 + 深色一对。写进 style 里给 CSS 用。 */
function colorVars(hue) {
  const t = hueTone(hue);
  return '--h:' + t.h +
    ';--cb:hsl(' + t.h + ',' + t.bs + '%,' + t.bl + '%)' +
    ';--cf:hsl(' + t.fgH + ',' + t.fs + '%,' + t.fl + '%)' +
    // 深色那套是同一色相压到暗底上：底色 30%/24%、字色 55%/74%，
    // 对比度实测 6.2~6.9，和原来那八档深色值说的是同一件事。
    ';--cdb:hsl(' + t.h + ',30%,24%)' +
    ';--cdf:hsl(' + t.h + ',55%,74%)';
}

/** 把一个元素的颜色变量整体换掉（色块、日卡片、调色色样都走这里）。 */
function paintHue(el, hue) {
  if (!el) return;
  const t = hueTone(hue);
  el.style.setProperty('--h', String(t.h));
  el.style.setProperty('--cb', 'hsl(' + t.h + ',' + t.bs + '%,' + t.bl + '%)');
  el.style.setProperty('--cf', 'hsl(' + t.fgH + ',' + t.fs + '%,' + t.fl + '%)');
  el.style.setProperty('--cdb', 'hsl(' + t.h + ',30%,24%)');
  el.style.setProperty('--cdf', 'hsl(' + t.h + ',55%,74%)');
}

/** 改一门课的颜色。hue 传 null = 恢复自动。 */
function setCourseColor(name, hue) {
  const key = String(name || '');
  if (!key) return;
  const m = Object.assign({}, CFG.cColors || {});
  if (hue == null) delete m[key];
  else {
    const v = Math.round(Number(hue));
    m[key] = Math.max(0, Math.min(359, isFinite(v) ? v : 0));
  }
  CFG.cColors = m;
  store.set(KEY.settings, CFG);
  renderSchedule();
}

/** 把 room 拆成「楼栋 / 房间号」两段，**所有教室都返回**。
 *
 *  教务系统给的是 `01B104`、`02A201` 这种连写。列宽只有 44~50px，
 *  一整串挤一行必然被截断 —— 而房间号恰恰是学生最需要看到的信息。
 *  拆成两段（`@01B 104`）后，两段各自都能完整显示，和 WakeUp 的排法一致。
 *
 *  🔴 **一门课可能给两个教室**：`02B506(D机房),02B505(C机房)`。
 *     两个都是上课地点（比如分机房上课），以前只取第一个 ——
 *     用户 2026-10-19 直接指出来了：「显示了两个教室，只显示了一个」。
 *     现在按逗号拆开、每间一行，全画出来。
 *
 *  括号里是场地类型（`(电工技术实验室)`），找教室用不上，而且一行放不下；
 *  格子里去掉，**完整原文仍在课程详情面板里**。
 *  拆不出来就原样返回（比如「东区操场8」这种没有楼栋编码的）。
 */
function roomList(room) {
  return String(room || '')
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // 括号可能是全角也可能是半角，偶尔还多一个右括号（`…实验室）)`）
      let clean = s.replace(/[（(][^）)]*[）)]+/g, '').trim();
      clean = clean.replace(/[）)]+$/, '').trim() || s;
      const m = /^(\d{2}[A-Za-z]?)(.+)$/.exec(clean);
      return m ? m[1] + ' ' + m[2].trim() : clean;
    });
}

/** 日视图 / 详情里用的完整教室串：多个教室用 `·` 隔开，括号里的场地类型保留。
 *  日视图一行有 300px 宽，放得下；周视图格子里放不下（见 roomList）。 */
function roomFull(room) {
  return String(room || '')
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' · ');
}

/** 单/双周判定。
 *
 *  教务系统给的是「逐周精确列表」，所以 [1,3,5,7] 就是隔周上课。
 *  判据：至少 2 周、相邻差全是 2。差不是 2 就是连续周或者有跳跃，
 *  那种情况宁可**不标**也不猜（标错了比不标更坑）。
 *  返回 'odd' / 'even' / ''。
 */
function parityOf(weeks) {
  if (!weeks || weeks.length < 2) return '';
  // 🔴 判据是「所有周次奇偶性一致」，不是「相邻差恒为 2」。
  //    大学英语I（三）周三实测周次 [2,4,6,8,10,12,16,18]——第 14 周停课，
  //    12→16 差 4，用「相邻差 == 2」就判不出双周，角标直接丢掉。
  //    （2026-10-18 跟用户 WakeUp 截图逐格对比时发现。）
  const odd = weeks.filter((w) => w % 2 === 1).length;
  if (odd === 0) return 'even';
  if (odd === weeks.length) return 'odd';
  return '';
}

/** 某周某天的课：day -> period -> [course] */
function occupancy(week) {
  const map = {};
  const hid = hiddenSet();
  const hidSlot = slotHiddenSet();
  allCourses().forEach((c) => {
    if (hid.has(c.code)) return;               // 用户隐藏掉的课不画
    if (!c.weeks || c.weeks.indexOf(week) < 0) return;
    (c.slots || []).forEach((s) => {
      if (hidSlot.has(slotKey(c.code, s.day, s.period))) return;  // 只藏这一节
      const k = s.day + ':' + s.period;
      (map[k] = map[k] || []).push(c);
    });
  });
  return map;
}

/* ---------------- 自己加的课 ----------------
 *
 * 用户 2026-11-06：「再加上能自己添加课程的功能」。
 * 为什么需要：教务系统里只有**排进系统**的课 —— 补课、临时加的、实验课、
 * 校外报的班，还有干脆是教务那边漏排的，真实的课表常常比系统里多。
 *
 * 🔴 存在本机（`CFG.myCourses`），重同步**不会**覆盖：它们本来就不在教务数据里，
 *    要是混进 DATA 里，下一次同步就被整份替换掉了。
 * 🔴 只在看「本学期」时出现。翻到上学期还画着今年自己加的课，那是假话。
 * 🔴 code 用 `my:` 开头 —— 教务系统的课程代码不可能长这样，隐藏、详情、
 *    去重都靠它区分「这条是我自己加的」。
 */
function myCourses() {
  const a = Array.isArray(CFG.myCourses) ? CFG.myCourses : [];
  return a.filter((c) => c && c.name);
}

/** 课表上该画哪些课：教务给的 + 自己加的（只看本学期时）。 */
function allCourses() {
  const base = (curTT().courses || []);
  return TT ? base.slice() : base.concat(myCourses());
}

function saveMyCourses(list) {
  CFG.myCourses = list;
  store.set(KEY.settings, CFG);
  renderSchedule(); renderMe();
}

/** 这条是不是用户自己加的（不是教务系统给的）。 */
function isMyCourse(c) {
  return String((c && c.code) || '').indexOf('my:') === 0;
}

/** 周次输入 → 周次数组。**认不出返回 null**，让调用方明说，别猜。
 *
 *  能认：`1-16`（连着上）、`1,3,5`、`2-16双`、`1-15单`、`1~16`、`1到16`，
 *        中文逗号顿号空格都当分隔符。
 *  🔴 上限夹到 totalWeeks()：填 `1-30` 而学期只有 18 周时，多的那几周
 *     永远不会被画出来（也不会报错），人会以为课加失败了。
 */
function parseWeeksText(s, maxW) {
  const t = String(s == null ? '' : s).replace(/[，、;；\s]+/g, ',');
  if (!t.replace(/,/g, '')) return null;
  const lim = Math.max(1, Number(maxW) || 30);
  const out = new Set();
  const parts = t.split(',').filter(Boolean);
  if (!parts.length) return null;
  for (const raw of parts) {
    const m2 = /^(\d{1,2})[-~到](\d{1,2})([单双])?$/.exec(raw);
    const m1 = /^(\d{1,2})([单双])?$/.exec(raw);
    const m = m2 || m1;
    if (!m) return null;
    const a = Number(m[1]);
    const b = m2 ? Number(m[2]) : a;
    const par = (m2 ? m[3] : m[2]) || '';
    if (!(a >= 1) || b < a) return null;
    for (let w = a; w <= b && w <= lim; w++) {
      if (par === '单' && w % 2 === 0) continue;
      if (par === '双' && w % 2 === 1) continue;
      out.add(w);
    }
  }
  const arr = Array.from(out).sort((x, y) => x - y);
  return arr.length ? arr : null;
}

/** 学期一共几周（至少 1）。 */
function allWeeks() {
  const n = Math.max(1, totalWeeks() | 0);
  const out = [];
  for (let w = 1; w <= n; w++) out.push(w);
  return out;
}

/** 课表页此刻显示的是第几周。 */
function shownWeek() {
  return CFG.view === 'day'
    ? (CFG.cursor ? weekOf(parseYmd(CFG.cursor)) : currentWeek())
    : (CFG.week || currentWeek());
}

/** 跳到某一周（只动视图，不动数据）。加完课用它把结果亮给用户看。 */
function gotoWeek(w) {
  const n = Number(w);
  if (!(n >= 1)) return;
  if (CFG.view === 'day') CFG.cursor = ymd(addDays(startDate(), (n - 1) * 7));
  else CFG.week = n;
  store.set(KEY.settings, CFG);
  renderSchedule();
}

/** 连续节次 → 表单里的「时间段」行（一门课一天可能有好几段）。 */
function slotsToRows(slots) {
  const out = [];
  (slots || []).slice().sort((x, y) => (x.day - y.day) || (x.period - y.period))
    .forEach((s) => {
      const last = out[out.length - 1];
      if (last && last.day === s.day && s.period === last.p1 + 1) { last.p1 = s.period; return; }
      out.push({ day: s.day, p0: s.period, p1: s.period });
    });
  return out;
}

/** 表单里的「时间段」行 → slots。夹到节次范围内、去重、丢掉填错的。 */
function rowsToSlots(rows, units) {
  const seen = {};
  const out = [];
  (rows || []).forEach((r) => {
    let d = Number(r.day);
    if (!(d >= 0 && d <= 6)) d = 0;
    let a = Math.round(Number(r.p0));
    let b = Math.round(Number(r.p1));
    if (!(a >= 0)) a = 0;
    if (!(b >= a)) b = a;
    if (a > units - 1) a = units - 1;
    if (b > units - 1) b = units - 1;
    for (let p = a; p <= b; p++) {
      const k = d + ':' + p;
      if (seen[k]) continue;
      seen[k] = 1;
      out.push({ day: d, period: p });
    }
  });
  return out;
}

/** 加 / 改一门自己加的课。不传 code 就是新加。
 *
 *  用户 2026-11-07 提的两件事，都在这张表单里：
 *    ① 周次不要「第几周到第几周」，要**自己点哪一周就哪一周**；
 *    ② 有时候是补一节，有时候是加一整门课（一周上两次），
 *       所以「上课时间」可以有多段。
 *
 *  `preset` 是从课表空白格长按进来的位置：{day, p0, p1, weeks}（都是 0 基）。
 */
function openMyCourseForm(code, preset) {
  const editing = !!code;
  const cur = editing ? (myCourses().find((c) => c.code === code) || null) : null;
  const units = Math.max(2, (curTT().unitCount) || 10);
  const all = allWeeks();
  const maxW = all.length;

  let rows = cur ? slotsToRows(cur.slots) : [];
  // 🔴 只有「从某一格长按进来的」才预选那一格。凭空点「加一门课」时
  //    **一格都不该亮** —— 0.52.0 之前这里默认塞了「周一第 1 节」，
  //    用户什么都没点，保存出来的课就已经占了一格，而且他自己不知道。
  if (!rows.length && preset && typeof preset.day === 'number') {
    rows = [{
      day: preset.day,
      p0: preset.p0 || 0,
      p1: (typeof preset.p1 === 'number') ? preset.p1 : (preset.p0 || 0),
    }];
  }
  const wkSel = new Set(
    cur ? (cur.weeks || []).filter((w) => w >= 1 && w <= maxW)
        : ((preset && preset.weeks) || all).filter((w) => w >= 1 && w <= maxW)
  );

  // 待安排的课（0.51.0）：只藏了某一节、还没找到新时间的那些。
  // 加课时能直接挑一个，名字 / 老师 / 教室 / 周次全部带过来 ——
  // 用户原话是「添加课程的时候可以把这节课添加到这个时间」，
  // 所以入口在这里，而不是让他先去别处翻。
  const pend = editing ? [] : pendingSlots();
  const pendHtml = pend.length
    ? '<div class="fldlabel">从待安排里挑一节</div>' +
      '<div class="pendchips">' + pend.map((it, i) =>
        '<button type="button" class="pendchip" data-pi="' + i + '">' +
        esc(it.known ? it.name : '（已不在数据里）') + '</button>').join('') +
      '</div>'
    : '';

  $('sheetBody').innerHTML =
    '<div class="sh-title">' + (editing ? '改这门课' : '加一门课') + '</div>' +
    '<div class="sh-sub">教务系统里没有的课可以自己加。只存在' +
      envText('这台电脑', '这台手机') + '上，同步不会冲掉。</div>' +
    pendHtml +
    '<label class="field"><span>课程名</span>' +
      '<input id="myName" type="text" maxlength="24" autocomplete="off" placeholder="像 大学物理实验">' +
    '</label>' +
    // 用户 2026-11-09：「添加课程的时候能不能加个，选时间时可以直接在原课表上
    // 点击，点击那个时间就添加到哪个时间」。
    // 所以那两个「从第几节 / 到第几节」的数字输入没了，换成一张小课表：
    // 点一格开始、再点一格结束。填数字要先在心里数一遍「第 5 节是上午还是下午」，
    // 点格子不用 —— 选的就是他刚在课表上看见的那个位置。
    '<div class="fldlabel">上课时间 · 点下面的格子选</div>' +
    '<div class="pickgrid" id="myPick"></div>' +
    '<div class="picksum" id="myPickSum"></div>' +
    '<div class="pickchips" id="mySlotList"></div>' +
    '<div class="fldlabel">上哪些周</div>' +
    '<div class="wkquick">' +
      '<button type="button" class="wkq" id="myWkAll">全选</button>' +
      '<button type="button" class="wkq" id="myWkOdd">单周</button>' +
      '<button type="button" class="wkq" id="myWkEven">双周</button>' +
      '<button type="button" class="wkq" id="myWkNone">清空</button>' +
    '</div>' +
    '<div class="mywks" id="myWeeks"></div>' +
    '<div class="wksum" id="myWkSum"></div>' +
    '<div class="mrow2">' +
      '<label class="field"><span>教室</span>' +
        '<input id="myRoom" type="text" maxlength="20" autocomplete="off" placeholder="不填也行"></label>' +
      '<label class="field"><span>老师</span>' +
        '<input id="myTeacher" type="text" maxlength="16" autocomplete="off" placeholder="不填也行"></label>' +
    '</div>' +
    '<div class="sheetbtns">' +
      '<button class="btn" id="myNo">取消</button>' +
      '<button class="btn primary" id="myYes">保存</button>' +
    '</div>';

  // 预填。课程名放最后一个 focus 之外的地方先写，避免软键盘一上来就盖住表单。
  if (cur) {
    $('myName').value = cur.name || '';
    $('myRoom').value = cur.room || '';
    $('myTeacher').value = cur.teacher || '';
  } else if (preset && (preset.name || preset.teacher || preset.room)) {
    // 从「待安排 → 排时间」进来的：名字、老师带过来了，**时间不带** ——
    // 原来那节之所以被藏，多半就是那个时间上不了。
    // 🔴 教室也不带（用户 2026-11-09：「教室位置不自动同步过去，让用户自己填」）：
    //    挪了时间的课最常见的两种情况是换了教室、或者教室还没定。自动填上旧教室，
    //    用户很可能直接保存，然后整学期在错的教室门口等 —— 空着让他自己决定更安全。
    $('myName').value = preset.name || '';
    $('myTeacher').value = preset.teacher || '';
  }

  /* ---- 时间段：在一张小课表上点 ----
   * 用户 2026-11-09：「应该点哪个量哪个，再点一下取消，不要设置只能添加两节课的限制」。
   *
   * 所以每一格都是**独立开关**：点一下点亮，再点一下灭掉。没有起点/终点，
   * 也没有段数上限 —— 周一 1-2 节、周三第 5 节、周五晚上那两节，各点各的。
   * 保存时把点亮的所有格子按天排序、连着的合成一段（见 rowsFromSel）。
   *
   * 🔴 为什么不再用「点两下 = 一段」：那个交互要求用户记住「我刚才点的是起点」，
   *    点歪一格整段就错位，而且第二下之前的状态 indistinguishable ——
   *    两节课的限制也是从那儿来的（一段只能是一天里的连续节次）。
   */
  const sel = {};                       // "day:period" → 1
  const selKey = (d, p) => d + ':' + p;
  rows.forEach((r) => {
    for (let p = r.p0; p <= r.p1; p++) sel[selKey(r.day, p)] = 1;
  });

  /** 点亮的格子 → 按天、按节次排好的 slots。 */
  const slotsNow = () => Object.keys(sel)
    .map((k) => ({ day: Number(k.split(':')[0]), period: Number(k.split(':')[1]) }))
    .sort((a, b) => (a.day - b.day) || (a.period - b.period));

  const segTextOf = (runs) => runs.map((r) => '周' + DAY_CN[r.day] + ' 第 ' + (r.p0 + 1) +
    (r.p1 > r.p0 ? '–' + (r.p1 + 1) : '') + ' 节').join('、');

  const paintPick = () => {
    const days = [0, 1, 2, 3, 4, 5, 6];
    const usedDays = {};
    slotsNow().forEach((s) => { usedDays[s.day] = true; });
    // 用户 2026-11-09：「用户添加课程显示课程表时，把所有现有课程也都简要显示在表上，
    // 方便用户辨别」。原来这张小课表只有空格子，选时间等于闭着眼睛点 ——
    // 他得记住「周三第 5 节是空的那节吗」，而那张大课表已经被浮层挡住了。
    // 现在把这一周已排的课浓缩成「色块 + 课名头三个字」铺在格子里，一眼对得上。
    // 🔴 正在改的这门课不算「已有课」—— 它自己占的格子画成选中就够了。
    const occNow = occupancy(currentWeek());
    const myCode = cur ? (cur.code || '') : '';
    const exAt = (d, p) => {
      const list = occNow[d + ':' + p] || [];
      for (let i = 0; i < list.length; i++) {
        if (list[i].code !== myCode) return list[i];
      }
      return null;
    };
    let anyEx = false;
    let h = '<div class="pick-hd"><i></i>' + days.map((d) =>
      '<b' + (usedDays[d] ? ' class="on"' : '') + '>' + DAY_CN[d] + '</b>').join('') + '</div>' +
      '<div class="pick-g">';
    for (let p = 0; p < units; p++) {
      h += '<i class="pick-n">' + (p + 1) + '</i>';
      for (let k = 0; k < days.length; k++) {
        const d = days[k];
        const on = !!sel[selKey(d, p)];
        const ex = exAt(d, p);
        if (ex) anyEx = true;
        h += '<button type="button" class="pick-c' + (on ? ' on cur' : '') + (ex ? ' has' : '') +
          '" data-d="' + d + '" data-p="' + p + '" aria-pressed="' + (on ? 'true' : 'false') + '"' +
          (ex ? ' style="' + colorVars(colorHue(ex.name)) + '"' : '') +
          ' aria-label="周' + DAY_CN[d] + '第' + (p + 1) + '节' +
          (ex ? '，已有' + esc(ex.name) : '') + '">' +
          (ex ? '<s>' + esc(String(ex.name || '').slice(0, 3)) + '</s>' : '') +
          '</button>';
      }
    }
    $('myPick').innerHTML = h + '</div>' +
      (anyEx ? '<div class="pick-leg">浅色格子里是已排的课，点上去也能加（会撞课）</div>' : '');

    const list = slotsNow();
    $('myPickSum').textContent = list.length
      ? ('已选 ' + list.length + ' 节：' + segTextOf(slotsToRows(list)))
      : '还没选时间 —— 在上面点亮上课的那几格';
    $('myPickSum').className = 'picksum' + (list.length ? '' : ' bad');
  };

  /** 底下那颗「清空」只在选过东西时出现。 */
  const paintChips = () => {
    const n = Object.keys(sel).length;
    $('mySlotList').innerHTML = n
      ? '<button type="button" class="pick-chip del" id="myClearSlots">清空重选</button>'
      : '';
  };

  const paintSlots = () => { paintPick(); paintChips(); };

  paintSlots();

  // 点格子：点亮 / 灭掉
  $('myPick').addEventListener('click', (e) => {
    const c = e.target.closest ? e.target.closest('.pick-c') : null;
    if (!c) return;
    const d = Number(c.dataset.d);
    const p = Number(c.dataset.p);
    const k = selKey(d, p);
    if (sel[k]) delete sel[k]; else sel[k] = 1;
    paintSlots();
  });

  $('mySlotList').addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('button') : null;
    if (!t || t.id !== 'myClearSlots') return;
    Object.keys(sel).forEach((k) => { delete sel[k]; });
    paintSlots();
  });

  /* ---- 周次 ---- */
  const paintWeeks = () => {
    $('myWeeks').innerHTML = all.map((w) =>
      '<button type="button" class="mywk' + (wkSel.has(w) ? ' on' : '') +
      '" data-w="' + w + '">' + w + '</button>').join('');
    const arr = Array.from(wkSel).sort((x, y) => x - y);
    const sum = $('myWkSum');
    if (!arr.length) {
      sum.textContent = '一周都没选 —— 不选就不会显示';
      sum.className = 'wksum bad';
    } else {
      sum.textContent = '已选 ' + arr.length + ' 周：' + compactWeeks(arr);
      sum.className = 'wksum';
    }
  };

  $('myWeeks').addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('.mywk') : null;
    if (!b) return;
    const w = Number(b.dataset.w);
    if (wkSel.has(w)) wkSel.delete(w); else wkSel.add(w);
    b.classList.toggle('on', wkSel.has(w));
    paintWeeks();
  });

  const setWeeks = (fn) => {
    wkSel.clear();
    all.forEach((w) => { if (fn(w)) wkSel.add(w); });
    paintWeeks();
  };
  $('myWkAll').addEventListener('click', () => setWeeks(() => true));
  $('myWkNone').addEventListener('click', () => setWeeks(() => false));
  $('myWkOdd').addEventListener('click', () => setWeeks((w) => w % 2 === 1));
  $('myWkEven').addEventListener('click', () => setWeeks((w) => w % 2 === 0));

  paintWeeks();

  // 「从待安排里挑一节」：点一下把课名 / 老师 / 教室 / 周次带进表单。
  // 🔴 只填空，**不算已经排好了** —— 用户还得自己选时间再按保存。
  //    这里要是顺手把课存下来，他会得到一节自己没看过时间的课。
  if (pend.length) {
    $('sheetBody').querySelectorAll('.pendchip').forEach((b) => {
      b.addEventListener('click', () => {
        const it = pend[Number(b.dataset.pi)];
        if (!it) return;
        $('myName').value = it.name || '';
        // 教室留空，让用户自己填（见上面 preset 那段的原因）
        $('myTeacher').value = it.teacher || '';
        if (it.weeks && it.weeks.length) {
          wkSel.clear();
          it.weeks.forEach((w) => { if (w >= 1 && w <= maxW) wkSel.add(w); });
          paintWeeks();
        }
        $('sheetBody').querySelectorAll('.pendchip')
          .forEach((x) => x.classList.toggle('on', x === b));
      });
    });
  }

  $('sheetMask').hidden = false;

  $('myNo').addEventListener('click', () => { closeSheet(); });
  $('myYes').addEventListener('click', () => {
    const name = ($('myName').value || '').trim();
    if (!name) { toast('课程名要填'); $('myName').focus(); return; }
    const weeks = Array.from(wkSel).sort((x, y) => x - y);
    if (!weeks.length) { toast('至少要选一周'); return; }
    const slots = rowsToSlots(slotsToRows(slotsNow()), units);
    if (!slots.length) { toast('先点亮上课的那几格'); return; }

    const item = {
      code: editing ? code : ('my:' + Date.now().toString(36)),
      name: name,
      room: ($('myRoom').value || '').trim(),
      teacher: ($('myTeacher').value || '').trim(),
      weeks: weeks,
      slots: slots,
    };
    const list = myCourses().slice();
    const i = list.findIndex((c) => c.code === item.code);
    if (i >= 0) list[i] = item; else list.push(item);
    saveMyCourses(list);
    $('sheetMask').hidden = true;

    // 🔴 加完必须让人**看见**。他可能正看着第 5 周，而课加在第 12 周 ——
    //    不跳过去的话，界面上什么都没变，人会以为没加上，然后加第二遍。
    const here = shownWeek();
    if (weeks.indexOf(here) < 0) {
      gotoWeek(weeks[0]);
      toast('加好了 · 跳到第 ' + weeks[0] + ' 周');
    } else {
      toast(editing ? '改好了' : '加好了');
    }
    // 提醒清单跟着变（新加的课也要「快上课了」）
    remindPush(true);
  });
}

/** 周次数组 → 「1-16」。用来预填表单，别让用户对着一串数字改。 */
function compactWeeks(weeks) {
  const a = (weeks || []).slice().sort((x, y) => x - y);
  if (!a.length) return '';
  const out = [];
  let s = a[0]; let p = a[0];
  for (let i = 1; i < a.length; i++) {
    if (a[i] === p + 1) { p = a[i]; continue; }
    out.push(s === p ? '' + s : s + '-' + p);
    s = p = a[i];
  }
  out.push(s === p ? '' + s : s + '-' + p);
  return out.join(',');
}

/** 删掉一节自己加的课。**只有自己加的能删** —— 教务给的删不掉（同步会回来）。 */
function confirmDelMyCourse(code) {
  const c = myCourses().find((x) => x.code === code);
  if (!c) return;
  askConfirm('删掉这节自己加的课？', c.name, '删掉').then((ok) => {
    if (!ok) return;
    saveMyCourses(myCourses().filter((x) => x.code !== code));
    clearSlotHides(code);                 // 连它身上的「单节隐藏」记录一起清
    store.set(KEY.settings, CFG);
    toast('删掉了');
  });
}

/* ---------------- 隐藏课程 ----------------
 * 为什么需要：教务系统的数据里会有「你实际上不上的课」——实测旧版 2026 秋季
 * 就有一门「高等数学Ⅰ(二)」，四个时段**全部**和别的课撞车，而学生实际课表里没有它。
 * 这种脏数据没法靠规则自动判（撞课也可能是真的调课），只能让用户自己点一下藏起来。
 * 键用 course.code：同一门课的多个时段/多个教室共用一个 code，一次隐藏全干净。
 */
function hiddenSet() {
  return new Set(CFG.hidden || []);
}

/* ---------------- 隐藏**单节**课（0.46.0） ----------------
 *
 * 用户 2026-11-06：「加上能隐藏单节课程的功能」。以前只能整门课一起藏 ——
 * 可脏数据常常只脏一格：一门课周一三五，只有周三那节是系统多排的/你实际不去的。
 * 整门藏掉，另外两节也跟着没了。
 *
 * 🔴 粒度是**这一格**（课程 + 星期 + 节次），不是这门课。
 * 🔴 一次性把这一块覆盖的每一节都记下来：跨两节的连堂课有两条 slot，
 *    只记第一条的话，第二格还留着半截。调用方传 period 数组。
 */
function slotKey(code, day, period) {
  return String(code || '') + '@' + day + ':' + period;
}

function slotHiddenSet() {
  return new Set(CFG.hideSlots || []);
}

/** 藏 / 放回「某门课的某几节」。periods 是节次数组。 */
function setSlotsHidden(code, day, periods, hide) {
  if (!code || !Array.isArray(periods) || !periods.length) return;
  const s = slotHiddenSet();
  periods.forEach((p) => {
    const k = slotKey(code, day, p);
    if (hide) s.add(k); else s.delete(k);
  });
  CFG.hideSlots = Array.from(s);
  store.set(KEY.settings, CFG);
  renderSchedule(); renderMe();
}

/** 这一格里被单独藏掉的节次（用来在「已隐藏」里说清是哪几节）。 */
function hiddenPeriodsOf(code, day) {
  const s = slotHiddenSet();
  const out = [];
  s.forEach((k) => {
    const m = /^(.*)@(\d+):(\d+)$/.exec(k);
    if (!m) return;
    if (m[1] === String(code || '') && Number(m[2]) === Number(day)) out.push(Number(m[3]));
  });
  return out.sort((a, b) => a - b);
}

/** 去掉所有关于这个 code 的隐藏记录（整门课被删掉时用）。 */
function clearSlotHides(code) {
  const pre = String(code || '') + '@';
  const kept = (CFG.hideSlots || []).filter((k) => String(k).indexOf(pre) !== 0);
  CFG.hideSlots = kept;
}

/** ---------------- 待安排 ----------------
 *
 *  用户 2026-11-08：「如果用户隐藏了一节课，就把这节课存入待安排，默认不显示出来，
 *  然后再添加课程的时候可以把这节课添加到这个时间」。
 *
 *  所以「只隐藏这一节」不再等于「这节没了」，而是**挪进一个候车室**：
 *  课表上照旧不画（默认不显示），但课名、老师、教室都还留着，
 *  等用户想给它找个新时间时，不用重新一个字一个字打。
 *
 *  🔴 记录本体还是 `CFG.hideSlots`（`code@day:period`），**没有另存一份**。
 *     另存一份就是两个真相：用户恢复了一节，待安排里还留着一条幽灵。
 *     这里只是把那份记录**读**成一个能给人看的列表。
 *  🔴 按「课程 + 星期几」合并：一门课在同一个下午藏了第 3、4 两节，
 *     分成两行会让人以为有两个待安排。
 */
function pendingSlots() {
  const byCell = new Map();
  (CFG.hideSlots || []).forEach((k) => {
    const m = /^(.*)@(\d+):(\d+)$/.exec(String(k));
    if (!m) return;
    const key = m[1] + '@' + m[2];
    if (!byCell.has(key)) byCell.set(key, { code: m[1], day: Number(m[2]), ps: [] });
    byCell.get(key).ps.push(Number(m[3]));
  });
  const out = [];
  byCell.forEach((it) => {
    const c = courseByCode(it.code);
    out.push({
      code: it.code,
      day: it.day,
      ps: it.ps.slice().sort((a, b) => a - b),
      // 课不在最新数据里了（教务那边删了/改名了）时，名字取空 ——
      // 调用方必须自己说清楚，不能编一个「这门课」糊过去。
      name: c ? String(c.name || '') : '',
      teacher: c ? String(c.teacher || '') : '',
      room: c ? String(c.room || '') : '',
      weeks: c ? (c.weeks || []) : [],
      known: !!c,
    });
  });
  out.sort((a, b) => (a.day - b.day) || (a.ps[0] - b.ps[0]));
  return out;
}

function setHidden(code, hide) {
  const s = hiddenSet();
  if (hide) s.add(code); else s.delete(code);
  CFG.hidden = Array.from(s);
  store.set(KEY.settings, CFG);
  renderSchedule(); renderMe();
}

/** code -> 课程（同 code 可能有多条记录，取第一条够用）。
 *  ⚠️ 0.46.0 起走 allCourses()：自己加的课也要能查到 ——「已隐藏」列表里
 *     它们同样可能被整门藏掉，查不到就显示成「这门课已不在最新数据里」。 */
function courseByCode(code) {
  return allCourses().find((c) => c.code === code) || null;
}

/** 这周一共几门课（按课程代码去重，不是按格子数）。
 *  放副标题里是为了让人一眼判断「这一周是不是我要找的那周」——
 *  光看「第 6 周」记不住，但「21 门课」能对上感觉。 */
function weekCourseCount(occ) {
  const s = new Set();
  Object.keys(occ).forEach((k) => occ[k].forEach((c) => s.add(c.code || c.name)));
  return s.size;
}

/** 这一屏显示哪几天（0 = 周一）。
 *
 *  🔴 **固定 7 列：周一到周日全显示**（2026-10-19 改回来的）。
 *
 *  上一版为了给工作日多挤点宽度，周末「整学期有课才显示那一列」。
 *  用户当天就反馈：「为什么没有周日了？很多人周日也有课」。
 *  这个规则有两个毛病：
 *    1. 没课的那天整列消失，用户分不清是「真的没课」还是「软件不支持周日」——
 *       看不见的东西没法被信任。
 *    2. 列数跟着数据变，两个人截同一周的图对不上，翻周时还容易看错列。
 *  宽度是紧了点（7 列比 6 列每列窄约 1/7），但「看得见」比「宽 7 像素」重要。
 *  挤的问题用别的办法补：留白压到 7px、节次栏 30px、字号按三档走（见 CSS）。
 *
 *  ⚠️ 返回值仍是「真实星期几」的数组，不是列号 —— 以后要是再想隐藏某天，
 *     记得 `cols[ci]` 才是星期几，`ci` 只是第几列。
 */
function visibleDays() {
  return [0, 1, 2, 3, 4, 5, 6];
}

// ------------------------------------------------------------------ 切换页

/* 🔴 底部**固定 5 个**，别再往上加。
   2026-10-21 用户提的：主流 App 底部最多 5 个，我们一度挤到 6 个。

   `calendar` / `rooms` 不是 tab，是**从课表页进去的子页**：
   底部继续亮着「课表」—— 校历和空教室本来就是「同一时间维度的另一面」，
   放在课表底下比单独占一个位置更顺。 */
/* 底部 5 格（0.27.0 起）：课表 / 学习 / WIKI / 功能 / 我的。
   中间那格原来是「公告」，用户 2026-10-30 要求换成 WIKI —— 公告是低频内容，
   并进了「功能」页；攻略是新生天天翻的。 */
const TABS = ['schedule', 'exams', 'wiki', 'campus', 'me'];
const SUBPAGES = ['calendar', 'rooms', 'accounts', 'notice', 'services', 'perm', 'settings'];
/* 子页是从哪个 tab 进去的 —— 返回时回那里，底部也要高亮那一个。
   原来只有校历/空教室两个、都挂在课表下，所以写死成 'schedule'；
   0.14.0 的「账号管理」是从「我的」进去的，再写死就会高亮错 tab。
   0.50.0 的「校园服务」同理：它挂在「功能」下，是那一页的低频区块。 */
const SUB_PARENT = { calendar: 'schedule', rooms: 'schedule',
                      accounts: 'me', notice: 'wiki',
                      services: 'wiki',
                      // 2026-11-15：权限自检挂在「我的」。它是一次「看看哪儿没配对」
                      // 的检查，一学期点不了两次，不该占底部一个位置。
                      perm: 'me',
                      // 2026-11-25：「设置」也挂在「我的」，同样是一次性的低频入口。
                      // 🔴 少了这一条，pgDirection 算不出方向 → 不进动效、返回键也
                      //    会回错地方（它的兜底是 'schedule'）。两处必须一起加。
                      settings: 'me' };

/* 当前真正在显示哪一页。
   🔴 不能拿 `.tab.active` 反推：子页亮的是「课表」，在空教室页按返回
      会以为自己在课表、直接退出 App（这就是为什么要有这个变量）。 */
let CUR_PAGE = 'schedule';

/* ---------------- 换页的动静 ----------------
   用户 2026-11-08 先说「点开和退出页面都是瞬间变化屏幕的，能不能做一下过渡动画」，
   第一版做完回来说：「完全没有流畅性可言，切换界面就上下闪一下」。

   🔴 第一版为什么闪：只让新页动、旧页立刻收走。`.page` 是铺满 100dvh 的块，
      新页从 translateY(6px) 起步，**顶部就露出 6px 的 App 底色**
      （实测 getBoundingClientRect().top = 6，而 #app 顶是 0），再压一层
      opacity .7 —— 150ms 里人眼读到的就是「内容跳一下 + 底色露一下」。
      横向更明显：translateX(22px) 会露 22px 的竖边。

   现在改成 iOS 那种**两页叠着走**：旧页不消失，跟着往旁边让 26%，
   新页从右侧整幅滑上来盖住它。任何时刻两页都首尾相接（底色一秒都没露）：
     进：新页左缘 W−W·t，旧页右缘 W−0.26W·t，恒有 W−W·t ≤ W−0.26W·t；
     退：反过来，等号只在 t=1 成立。
   闪的根就没了 —— 不是把位移调小，是**让它不再有缝**。

   🔴 底部五个 tab 之间**整幅左右切**（0.50.0 v5 起，用户两次点名）。
      这三版都试过，用户一句话一版：
        瞬切        —— 第一次提「完全没有过渡动画」；
        淡入 + 6px  —— 第二次提「切换底部栏还是不像在换页」；
        左右滑      —— 这一版。
      为什么这次的方向是**有意义的**：`TABS` 是个固定顺序的数组，
      点第 4 格和第 2 格点第 3 格，谁在左谁在右是确定的 —— 方向由下标算，
      不用猜。所以「平级 tab 没有进退」这个理由不成立（那是对没有顺序的
      tabbar 说的，比如 iOS 里可以自定义排序的那种）。
      ⚠️ 时长仍比子页短（240 vs 360）：同一个屏幕位置换内容，
         人对慢的容忍度更低，这是唯一一处两档不同的原因。

   🔴 只用 transform，不做透明度渐变：两页叠着改透明度会「重影」
      （半透明的上层透出下层正在动的内容），整页改透明度在低端机上也很贵。
   🔴 不用 View Transitions API（外面最流行的做法）：要 WebView 111 以上，
      我们最低支持 Android 6，还有一批不跟系统更新的 WebView。
      Web Animations 是 Chrome 36 就有的，全都能跑，不用维护两套代码。 */
/* 0.51.0 起 360ms（240 的 1.5 倍，也就是用户说的「0.75 倍速」）。
   走过的三档：
     240ms —— 用户「太快了，0.5 倍速才是正常速度」；
     480ms —— 按 0.5 倍速给的，用户「速度有点慢了，改成 0.75 倍速」；
     360ms —— 480 × 0.75 = 360，正好落在他两次说的区间里。
   ============================================================
   为什么**只加时长、不动曲线**：
   换成 emil-kowalski 那种强 ease-out（cubic-bezier(.23,1,.32,1)）或抽屉曲线
   （.32,.72,0,1），半程就走完 87%~96%，剩下的一半时间只在挪最后几个像素。
   240ms 时这叫「利落」，360ms 就开始像「卡住了」—— 尾巴太长比短动作更伤。
   这条 (.4,.5,.25,1) 半程 86%、四分之三处 98%，摊到 360ms 上每一段都还在动。
   ⚠️ 再往上（600ms 以上）就会明显「黏手」，那要同时换曲线，不能只调数字。 */
const PG_MS = 360;
/* 底部五个 tab 之间：**整幅左右切**，比进出一层更快。
   同一个屏幕位置换内容，人眼对「慢」的容忍度远低于隔一层进出 ——
   iOS 的 tabbar 换页、微信的切换都在 200~260ms 之间。
   🔴 240 是量出来的下限：再短（≤180）整幅平移就成了「闪一下」，
      眼睛还没跟上就结束了；子页的 360 放到 tab 上会显得拖沓。
   🔴 只在「左右平级的 tab」上用，子页仍然走下面那套 26% 让位。 */
const PG_TAB_MS = 240;
/* 起步不拖、尾巴不黏。
   量过几组：内置 ease-out 走完一半时间才到 60%；(.32,.72,0,1) 那种强曲线
   一半时间已经到 96%，最后四分之一的时间只挪几个像素，看着像「蹭着停下」。
   这条是半程 86%、四分之三处 98% —— 前半段把位移走完，剩下一小截平滑落位。

   🔴 **试过换成弹簧（linear() 采样 + 0.7% 过冲），退回来了。**
      2026-11-10 想照 OriginOS 6 的原子动效做「末段轻顿一下」。实测不行：
      整幅页面是**正好一屏宽**的两层首尾相接，落位时过冲 2.5px 就等于
      右缘往里缩 2.5px —— 边上露出一条底色。`check_page_motion` 逐帧量到
      359.02 / 360（差 0.98px），三条「每一帧都盖严」当场红。
      过冲只适合**不铺满屏幕**的东西（按钮、图标、弹层里的内容）；
      铺满整屏的位移一旦过冲，物理上就是「把幕布拉开一条缝」。
      ⚠️ 别用「把过冲调小一点」绕过：0.14% 也是 0.5px，一样贴到判据的容差边上；
         窗口宽度一变（有的手机 393/411dp）就又露。
      想再试的话，先让 `check_page_motion` 的 [E]/[G2] 两段绿了再说——
      那两段量的正是「任何一帧都不许露底」。 */
const PG_EASE = 'cubic-bezier(.4, .5, .25, 1)';
const PG_UNDER = .26;              // 下面那页让开多少（iOS 大约 0.3）

let pgRun = null;                  // 正在跑的那一次：{ a1, a2, top, bot }

/** 系统里开了「减少动效」（无障碍设置）就一点都不动。
 *  这个 App 别处已经有几条 prefers-reduced-motion 规则，口径保持一致。 */
function pgQuiet() {
  try {
    return !!(window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { return false; }
}

/** 只留下这一页。换页和动画收尾都走这一份，别各写一遍。 */
function pgOnly(name) {
  TABS.concat(SUBPAGES).forEach((t) => {
    const el = $('page-' + t);
    if (el) el.hidden = (t !== name);
  });
}

/** 把一页临时变成「盖满整屏、自带底色」的一层。
 *  🔴 必须自己铺底色：`.page` 本身是透明的（底色在 body 上），不铺的话
 *     上层卡片之间那些缝会把**下层正在移动的内容**透出来，看着像重影。
 *  `shadow` 是投影落在哪一侧：`'left'` = 左边缘有影子（新页从右边压过来），
 *  `'right'` = 右边缘有影子（新页从左边压过来）。tab 左右切两个方向都有，
 *  写死 -10px 的话反方向滑会看到影子长在**后面**，像背光。 */
function pgLayer(el, z, shadow) {
  el.hidden = false;
  el.style.position = 'absolute';
  // 🔴 一条条写 top/right/bottom/left，**不用 `inset` 简写**：
  //    inset 是 Chrome 87 才有的，而 `el.animate` 从 Chrome 36 就有 ——
  //    在老 WebView 上会走进动画这条路，却因为 inset 不认而把页面撑成一团。
  el.style.top = '0';
  el.style.left = '0';
  el.style.right = '0';
  el.style.bottom = '0';
  el.style.zIndex = String(z);
  el.style.willChange = 'transform';
  el.style.backgroundImage = 'var(--bg-grad)';
  el.style.backgroundRepeat = 'no-repeat';
  el.style.backgroundSize = 'cover';
  if (shadow === 'right') {
    el.style.boxShadow = '10px 0 24px rgba(16, 30, 55, .18)';
  } else if (shadow) {
    el.style.boxShadow = '-10px 0 24px rgba(16, 30, 55, .18)';
  }
}

/** 把 pgLayer 动过的样式全部还回去 —— 少还一条，那一页下次进来就是错位的。 */
function pgRestore(el) {
  if (!el) return;
  el.style.position = '';
  el.style.top = '';
  el.style.left = '';
  el.style.right = '';
  el.style.bottom = '';
  el.style.zIndex = '';
  el.style.willChange = '';
  el.style.backgroundImage = '';
  el.style.backgroundRepeat = '';
  el.style.backgroundSize = '';
  el.style.boxShadow = '';
}

/** 立刻收尾正在跑的那一次（连点两下、或换页被别的东西打断时）。
 *  🔴 先清 pgRun 再 finish()：finish 会同步触发 finished 回调，
 *     不清的话两边都去 restore，第二次 restore 打在已经还原过的元素上。 */
function pgSettle() {
  const r = pgRun;
  if (!r) return;
  pgRun = null;
  clearTimeout(r.timer);
  // 两条路（整幅左右切 / 子页进出）现在都摆两页、挂两段动画，所以 a1/a2/top/bot
  // 都在；仍按「可能为空」写 —— 万一哪天再加一种只用单页的动画，这里不该崩。
  try { if (r.a1) r.a1.finish(); } catch (e) { /* 已被 cancel */ }
  try { if (r.a2) r.a2.finish(); } catch (e) { /* 已被 cancel */ }
  pgRestore(r.top);
  pgRestore(r.bot);
  document.getElementById('app').classList.remove('pg-run');
  pgOnly(CUR_PAGE);
}

/** 这一次换页该往哪个方向动。返回 '' = 不动（同一页被重复点、首屏）。
 *
 *  'push' 往下一层、'pop' 退回上一层 —— 这两档是「隔着层级」的，用 26% 让位；
 *  'left' / 'right' 是平级 tab 之间的**整幅左右切**，方向由 TABS 的下标算：
 *  'left'  = 新页从右侧进来（往右走，下标变大）；
 *  'right' = 新页从左侧进来（往左走，下标变小）。
 *  🔴 下标算不出来（理论上不会：所有页不是 TABS 就是 SUBPAGES）就**不动**，
 *     宁可瞬切也不要瞎滑一个方向 —— 滑错方向比不滑更让人分不清自己在哪。 */
function pgDirection(prev, name) {
  if (!prev || prev === name) return '';
  if (SUB_PARENT[name]) return 'push';      // 往下钻一层
  if (SUB_PARENT[prev]) return 'pop';       // 退回上一层
  const a = TABS.indexOf(prev), b = TABS.indexOf(name);
  if (a < 0 || b < 0) return '';
  return b > a ? 'left' : 'right';
}

/** 底部 tab 之间的换页（0.50.0 v5）。
 *
 *  用户 2026-11-08 两次提这件事：第一遍「切换底部栏完全没有过渡动画」，
 *  我给了淡入；第二遍「改成左右切换的」。这一版按他说的做整幅左右切。
 *
 *  🔴 和淡入那版最大的不同：**两页都得动**，而且是首尾相接的。
 *     旧页 0 → ∓100%，新页 ±100% → 0，任何一帧左页右缘都正好贴着右页左缘
 *     （两个动画同一条曲线、同一个起点终点，位移之和恒等于 W）。
 *     只让新页滑进来、旧页原地不动，新页滑到一半时右半边会露出旧页 ——
 *     那正是 0.50.0 第一版「露底」的形状，判据 E 段逐帧量过。
 *  🔴 方向相关的只有两件事：新页从哪边进、投影在哪一侧。
 *     两者都用同一个 `sign`，写成两处独立判断迟早会出现「从右进、影子在右」。
 *  🔴 连点：switchTab 每次都先 pgSettle 把上一段收干净，所以永远是
 *     「从干净的一屏出发」，不会两段动画叠加成横飞。
 */
function pgTabSlide(prevEl, nextEl, dir, name) {
  const sign = (dir === 'left') ? 1 : -1;   // +1 = 新页从右边来
  const top = nextEl, bot = prevEl;
  pgLayer(top, 6, sign > 0 ? 'left' : 'right');
  pgLayer(bot, 5, false);
  // 底栏别跟背景做实时模糊（见 #app.pg-run 那条注释）
  document.getElementById('app').classList.add('pg-run');

  const kTop = ['translateX(' + (sign * 100) + '%)', 'none'];
  const kBot = ['none', 'translateX(' + (sign * -100) + '%)'];
  pgRunPair(top, bot, kTop, kBot, PG_TAB_MS, name);
}

/** 两页叠着跑一段，播完把样式还回去、只留落脚那页。
 *
 *  子页的进/退和 tab 的左右切共用这一段 —— 收尾那七八行（还原两页、摘掉
 *  pg-run、pgOnly）写两遍的话，改一处漏一处就是「某一方向上换完页样式没还」，
 *  下次进那一页错位，而且只在那个方向复现。
 *
 *  🔴 `animation.finished` 是 Chrome 84 才有的。老 WebView 上它是 undefined，
 *     `Promise.all([undefined, undefined])` 会**立刻** resolve ⇒ 收尾马上执行 ⇒
 *     样式一撤，页面瞬间跳到终点 —— 看着就是「闪一下」。所以老机器走 onfinish
 *     （Chrome 36 就有），再挂一个超时兜底：两条路哪条先到都收得干净。
 */
function pgRunPair(top, bot, kTop, kBot, ms, name) {
  const opt = { duration: ms, easing: PG_EASE };
  let a1, a2;
  try {
    a1 = top.animate([{ transform: kTop[0] }, { transform: kTop[1] }], opt);
    a2 = bot.animate([{ transform: kBot[0] }, { transform: kBot[1] }], opt);
  } catch (e) {
    // 动画起不来不能连累换页：样式还原，页面照常切
    pgRestore(top); pgRestore(bot);
    document.getElementById('app').classList.remove('pg-run');
    pgOnly(name);
    return;
  }

  const run = { a1: a1, a2: a2, top: top, bot: bot, timer: 0 };
  pgRun = run;
  const done = () => {
    if (pgRun !== run) return;       // 中途被新的换页接走了，收尾归它
    pgRun = null;
    clearTimeout(run.timer);
    pgRestore(top);
    pgRestore(bot);
    document.getElementById('app').classList.remove('pg-run');
    pgOnly(name);
  };
  if (a1.finished && a2.finished) {
    Promise.all([a1.finished, a2.finished]).then(done, () => {});
  } else {
    a1.onfinish = done;
  }
  run.timer = setTimeout(done, ms + 150);
}

function pgMotion(prev, name) {
  // 底部主 Tab 页面内容密度高，整页双层横移会同时栅格化卡片、阴影和背景，
  // 中低端 WebView 会掉帧并短暂露出底色。switchTab 已先用 pgOnly 显示目标页；
  // 主 Tab 直接落位，子页 push/pop 继续保留层级动效。
  if (TABS.indexOf(prev) >= 0 && TABS.indexOf(name) >= 0) return;
  const dir = pgDirection(prev, name);
  if (!dir) return;
  const prevEl = $('page-' + prev);
  const nextEl = $('page-' + name);
  if (!prevEl || !nextEl) return;
  if (pgQuiet()) return;
  if (typeof nextEl.animate !== 'function') return;  // 老 WebView：不动，页面照常切
  if (dir === 'left' || dir === 'right') {
    pgTabSlide(prevEl, nextEl, dir, name);
    return;
  }

  // 谁在上面：进是「新的」压旧的；退是「要走的那页」还压在上面往外滑。
  const top = (dir === 'push') ? nextEl : prevEl;
  const bot = (dir === 'push') ? prevEl : nextEl;

  const under = 'translateX(' + (-PG_UNDER * 100) + '%)';
  const kTop = (dir === 'push')
    ? ['translateX(100%)', 'none']
    : ['none', 'translateX(100%)'];
  const kBot = (dir === 'push') ? ['none', under] : [under, 'none'];

  pgLayer(top, 6, 'left');
  pgLayer(bot, 5, false);
  // 这 360ms 底栏别跟背景做实时模糊：它下面正好是页面留白区，糊不出东西，
  // 却要每帧重算一次 22px 模糊 —— 低端机最容易在这一条上掉帧。
  document.getElementById('app').classList.add('pg-run');
  pgRunPair(top, bot, kTop, kBot, PG_MS, name);
}

function switchTab(name) {
  appLog('切到 ' + name);
  // 换页时关掉气泡：它是 fixed 定位的，页都换了它还悬在那儿，
  // 指着的却是上一个页面的行。
  if (typeof wtPopClose === 'function') wtPopClose();
  const pgPrev = CUR_PAGE;
  // 上一次叠层还没滑完就点了别的：先把它收干净，否则两层都还挂在上面。
  pgSettle();
  pgOnly(name);
  CUR_PAGE = name;
  // 用户自己点进来了 —— 这时才允许重新取数（清缓存后那条限制解除）。
  if (name === 'campus' || name === 'services') CAMPUS.noAuto = false;
  // 接水轮询只在「功能」页看得见的时候跑。换到别的 tab 就停 ——
  // 不停的话它会在后台每 10 秒打一次服务器，最长打 10 分钟。
  if (name !== 'campus') wtLiveStopPoll();
  const hl = SUB_PARENT[name] || name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === hl));
  if (name === 'exams') {
    renderExamView();
    if (!CFG.examView || CFG.examView === 'cx') cxEnter();
    cxLiveRun();
  }
  if (name === 'me') renderMe();
  if (name === 'accounts') {
    renderAccounts(); wtStateRefresh();
  }
  // 功能页只保留慧生活798饮水功能。
  if (name === 'campus') renderWater();
  if (name === 'notice' || name === 'wiki') renderNepuNotices();
  // 校历纯本地计算，没有网络，每次进来重画一遍就行（跨零点后周次会变）
  if (name === 'calendar') renderCalendar();
  // 课表页重新可见时补量一次：隐藏状态下量不出宽度，两间教室的字号没法缩
  if (name === 'schedule') {
    fitRoomLines($('wkTrack')); fitRoomLines($('dayView'));
    // 轨道（上一周 / 本周 / 下一周）也要重摆：数据可能是在别的 tab 上更新完的，
    // 那会儿量不到宽度，摆在错的位置上 —— 切回来会看到上一周漏在时间栏右边。
    swipeSettle();
  }

  // 换页的动静：放在最后一行 —— 等这一页该画的都画完，动画第一帧就是完整内容。
  pgMotion(pgPrev, name);
}
document.querySelectorAll('.tab').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

/* 切到后台就停接水轮询，切回来接着盯。
 * 🔴 不这么做的话，手机锁屏后那条 10 分钟里还在每 10 秒发一次请求 ——
 *    安卓会把这种「后台偷偷联网」当耗电，而且它查的账单本来也没人看。
 * ⚠️ 回到前台要**重新起**：定时器在隐藏时已经清掉了，不重起就永远不查了
 *    （「切回来还是显示正在出水」就是这个坑的形状）。 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { wtLiveStopPoll(); return; }
  if (CUR_PAGE === 'campus' && WT.live) wtLiveStartPoll();
  // 0.39.0：从后台切回「学习」页也顺手查一次（同样受 CX_AUTO_SEC 挡着）。
  // 用户最常做的动作就是「课间切回来看一眼新作业」，这正是最该是最新的时刻。
  if (CUR_PAGE === 'exams') {
    cxAutoScan();
  }
});

// ------------------------------------------------------------------ 公告

/* 数据来自学校 6 个部门的**公开网页**（校级 / 教务处×2 / 团委 / 后勤 / 信息中心），
 * 不需要登录 —— 所以这一页是整个 App 里唯一「没绑教务账号也能用」的栏目。
 *
 * 🔴 列表和详情分成两个接口，这是有意的：
 *    /api/notice         一次抓 6 个列表页 → 标题 / 日期 / 来源 / 分类
 *    /api/notice/detail  才去抓某一篇的正文 → 从里面抠「时间 / 地点」
 *    合成一个接口的话，一进页面就得抓 60 篇正文，慢，而且把学校服务器打疼。
 *
 * 但只有标题的话，这页跟直接看学校官网没区别 —— 用户要的是
 * 「什么时候、在哪儿、有没有餐券」，那三样只在正文里。
 * 所以列表画完之后**异步**给最上面几条补详情，补到一条就更新一张卡：
 * 用户不用等，也不会盯着一屏「正在加载」。
 */

const NT_TIERS = [
  ['all', '全部'],
  ['impact', '影响出行'],
  ['action', '要办事'],
  ['activity', '活动'],
  ['other', '其他'],
];

const NT = {
  tried: false,     // 抓过一次没有（不管成没成）
  loading: false,
  err: '',
  at: 0,            // 服务端取数的 unix 秒
  total: 0,         // 过滤前的总条数（用来算「76 条里显示最近 60 条」）
  sources: 0,       // 这次成功取到几个源
  failed: [],       // [{source, status, count}] —— 必须往界面上报，不能安静地少一块
  all: [],          // 全部条目，服务端已按日期倒序
  tier: 'all',      // 当前筛选
  fromCache: false, // 这批是不是从本机读出来的（决定要不要顺手刷一次）
  showN: 4,         // 首屏铺几条。真机 360×712 上每条 93px，
                    // 五十九条全铺是 5487px —— 这一页天生是「翻」的，
                    // 但第一屏得先装得下（用户 2026-11-01：每个界面一屏）。
};

/* url → {ok, when, where, summary} 或 {ok:false, error}。
   undefined = 还没取过；有对象 = 取过了（成功失败都算，失败的不再重试）。 */
const NT_DETAIL = {};
/* 正在取的（防止同一条被两个 worker 同时抓）。 */
const NT_BUSY = {};
/* 详情弹层当前是哪一篇。数据晚到时要靠它判断「要不要重画」。 */
let ntSheetUrl = '';

/** 属性值转义。`esc()` 不转引号，直接塞进 data-url="" 会把属性截断。 */
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 今年的省掉年份（「10-20」），往年的带上（「2025-12」）。
 *  学校通知绝大多数是近两个月的，每条都写「2026-」纯属占地方。 */
function ntDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return String(s || '');
  return m[1] === String(new Date().getFullYear()) ? m[2] + '-' + m[3] : m[1] + '-' + m[2];
}

function ntStamp(sec) {
  const d = new Date(sec * 1000);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
         pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 「3 小时前」这种说法。
 *  缓存数据的界面必须用它 —— 「10-21 12:03」要人自己算差多久，
 *  而「1 天前」一眼就知道该不该刷新。 */
function agoText(sec) {
  if (!sec) return '';
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
  return ntStamp(sec);
}

function ntTierClass(tier) {
  return tier === 'impact' ? 't-impact'
       : tier === 'action' ? 't-action'
       : tier === 'activity' ? 't-activity' : 't-other';
}

function ntFiltered() {
  return NT.tier === 'all' ? NT.all : NT.all.filter((x) => x.tier === NT.tier);
}

/** 一张卡。**详情没到就只画标题** —— 不写「时间：无」，
 *  「没读到」和「没有」是两件事，写成一样等于把错误说成事实。 */
function ntCardHtml(it) {
  const d = NT_DETAIL[it.url];
  const tag = (it.tags && it.tags[0])
    ? '<span class="nt-tag ' + ntTierClass(it.tier) + '">' + esc(it.tags[0]) + '</span>'
    : '';
  let extra = '';
  if (d && d.ok && (d.when || d.where)) {
    extra = '<div class="nt-extra">' +
      (d.when ? '<div class="nt-kv"><span class="k">时间</span><span class="v">' +
                esc(d.when) + '</span></div>' : '') +
      (d.where ? '<div class="nt-kv"><span class="k">地点</span><span class="v">' +
                 esc(d.where) + '</span></div>' : '') +
      '</div>';
  }
  return '<div class="ntitem" data-url="' + escAttr(it.url) + '">' +
    '<div class="nt-title">' + esc(it.title) + '</div>' +
    '<div class="nt-meta">' + tag +
      '<span class="nt-dept">' + esc(it.dept || it.source || '') + '</span>' +
      '<span class="nt-date">' + esc(ntDate(it.date)) + '</span>' +
    '</div>' + extra +
  '</div>';
}

function ntPaintState() {
  const has = NT.all.length > 0;
  const f = NT.failed || [];
  $('ntLoading').hidden = !NT.loading;
  $('ntChips').hidden = !has;
  $('ntSum').hidden = !has;
  $('ntList').hidden = !has;

  // 「一条都没有」和「取失败」要分开说：前者可能真的没通知，
  // 后者是我们没拿到。混成一句「暂无数据」等于把故障说成事实。
  const dead = !NT.loading && NT.tried && !has;
  $('ntEmpty').hidden = !dead;
  if (dead) {
    $('ntEmptyTitle').textContent = NT.err ? '没取到公告' : '这次一条都没取到';
    $('ntEmptyText').textContent = NT.err ||
      '可能是学校网站临时故障，请稍后再试。';
  }

  // 有内容但有源失败 / 刷新失败：黄色提示条。两种情形说两句不同的话。
  let warn = '';
  if (has && NT.err) warn = '刷新没成功（' + NT.err + '），下面是上一次取到的内容。';
  else if (has && f.length) {
    warn = '有 ' + f.length + ' 个来源没取到（' +
      f.map((x) => x.source).join('、') + '），下面的内容可能不全。';
  }
  $('ntWarn').hidden = !warn;
  if (warn) $('ntWarn').textContent = warn;
}

function renderNotice() {
  const all = NT.all;
  const cnt = { all: all.length };
  NT_TIERS.forEach((t) => { if (t[0] !== 'all') cnt[t[0]] = all.filter((x) => x.tier === t[0]).length; });

  // 分类 chip 上带条数：一眼能看出「影响出行」只有两三条、
  // 「要办事」二十几条 —— 这就是回答「公告太杂」最直接的办法，
  // 不用写一段说明文字去解释。
  $('ntChips').innerHTML = NT_TIERS.map((t) =>
    '<button class="chip' + (NT.tier === t[0] ? ' on' : '') + '" data-tier="' + t[0] + '">' +
    esc(t[1]) + (cnt[t[0]] ? '<i class="ntc">' + cnt[t[0]] + '</i>' : '') + '</button>'
  ).join('');

  $('ntSum').textContent = NT.sources + ' 个来源 · ' + NT.total + ' 条' +
    (all.length < NT.total ? '（显示最近 ' + all.length + ' 条）' : '') +
    (NT.at ? ' · ' + ntStamp(NT.at) + ' 更新' : '');

  const list = ntFiltered();
  const shown = list.slice(0, NT.showN);
  $('ntList').innerHTML = shown.map((it) => ntCardHtml(it)).join('') +
    (list.length > shown.length
      ? '<button class="cx-more" id="ntMore">还有 ' + (list.length - shown.length) + ' 条</button>'
      : '');
  // 0.40.0：列表底部那块「内容摘自学校各部门网站，以原文为准。」撤了。
  // 话没少说 —— 详情弹层里本来就有一句「时间地点可能有出入，以原文为准」，
  // 而这里要说的「哪些来源」上面那行 `6 个来源` 已经写了。
  // 一块 39px 的页脚重复一句已有的话，压的正是这一页最紧的那 40 像素。
  ntPaintState();
  // 公告 tab 的红点（0.24.1）：用户说「公告也是[低频的]」——
  // 低频的东西不该靠一个常驻 tab 提醒人去点，而是**有新东西才亮**。
  // 只有正看着公告页的时候才算「看过了」；后台刷到新公告照样亮着。
  ntMarkSeen();
  // 只在**公告页正显示着**的时候才去补正文。
  // 以前是无条件补：开机后台刷新一次就会顺手敲 8 个详情页 ——
  // 用户可能正在看课表，这 8 个请求纯属白打。
  if (CUR_PAGE === 'notice') ntPrefetchFor(list);
}

/* ---------------- 公告的本地缓存 ----------------
 *
 * 为什么要缓存：公告是 6 个学校部门站点串起来抓的，冷启动要两三秒。
 * 用户的原话是「点打开软件自动更新公告」—— 所以顺序必须是
 * **先拿本机这份画出来（立刻有内容），再去后台刷**，
 * 而不是让他对着空白页等 6 个站点。
 *
 * 只存列表，不存正文：正文（NT_DETAIL）是几十 KB 的解析结果，
 * 而且列表里最上面几条一进来就会重新补，存了也是白存。
 */
const NT_CACHE_MAX = 80;

function ntCacheSave() {
  try {
    store.set(KEY.notice, {
      at: NT.at, total: NT.total, sources: NT.sources,
      // 裁一下：公告一直累积，不裁的话 localStorage 会被慢慢撑爆
      all: NT.all.slice(0, NT_CACHE_MAX),
    });
  } catch (e) { /* 存不下就算了，不能因为缓存失败把界面搞坏 */ }
}

/* ---- 公告「有新东西」的红点（0.24.1 → 0.44.0 撤掉）--------------------
   🔴 0.44.0 去掉。用户 2026-11-03：「功能页面底部为什么会有红点？你给红点去掉」。
      红点本来是为了「有新公告」，但它挂在**底部标签栏**上：那是一个导航
      元素，上面出现一个没有任何文字说明的点，用户第一反应是「这里有 bug」，
      而不是「公告有新的」。而且公告那一页自己就会写「新增 N 条」，
      不缺点这个提示。
   ⚠️ 「看过了」的记录仍然留着（NT_SEEN_KEY / ntMarkSeen）：公告页里
      「新」这个标记还要用它。只是不再往标签栏上画点。
   🔴 只读本机缓存来判断，**不动 NT** —— 在这里调 ntCacheLoad() 会把
      NT.tried 置 true，于是 enterNotice 里「先画本机那份」那一支被跳过，
      用户点进公告页会对着空白等 6 个站点（正是以前修过的那个毛病）。
   「看过了」记的是**最新那条的身份**（url），不是时间：学校各站点的日期
   格式不统一，拿时间比大小迟早比错，比身份则只要「是不是同一条」就够。 */
const NT_SEEN_KEY = 'nt.seen';

function ntNewestId(all) {
  const it = Array.isArray(all) && all[0];
  if (!it) return '';
  return String(it.url || it.title || '');
}

/** 「这一屏的公告我看过了」。只在这一页正显示时才算。
 *  🔴 必须同时被 renderNotice **和** enterNotice 调到：
 *     NT.tried 一旦为 true，再进这一页 renderNotice 就不会跑了
 *     （`if (!NT.tried && ntCacheLoad())`），只在 renderNotice 里记的话
 *     「第二次进来」永远不记，红点就再也不灭。 */
function ntMarkSeen() {
  if (CUR_PAGE !== 'notice' || !NT.all.length) return;
  // 0.44.0：只记「看到哪一条」—— 标签栏上的红点已经撤了（见上面那段），
  // 这里仍然要记，因为公告页里每条前面的「新」标记靠它算。
  store.set(NT_SEEN_KEY, ntNewestId(NT.all));
}

/** 从本机读回来。有内容返回 true。
 *  🔴 读回来要标记 fromCache —— 界面得说清楚这是「上次看到的」，
 *     不能把旧数据伪装成刚刷新的。 */
function ntCacheLoad() {
  const c = store.get(KEY.notice, null);
  if (!c || !Array.isArray(c.all) || !c.all.length) return false;
  NT.all = c.all;
  NT.total = c.total == null ? c.all.length : c.total;
  NT.sources = c.sources == null ? 0 : c.sources;
  NT.at = c.at || 0;
  NT.tried = true;
  NT.fromCache = true;
  return true;
}

/** 进公告页 / 开机预热共用的一条路。
 *
 *  顺序很重要：**先画本机那份**（立刻有内容），再决定要不要刷。
 *  反过来就是用户对着空白页等 6 个站点 —— 那正是要改掉的体验。
 *
 *  `stale` 用 10 分钟：服务端自己还有 30 分钟 TTL，所以这里大多数时候
 *  连学校站点都不会碰，只是把本机缓存对齐一下时间戳。 */
/* ---------------- 钉钉通知（0.52.1 v12） ----------------
 *
 *  数据全在原生那边：用户在系统设置里给了「通知使用权」，DingListener 把钉钉
 *  推出来的那条抄一份存在本机（见 Ding.java）。这边只负责画。
 *
 *  🔴 不缓存、不写 localStorage：原生是本机几十条，每次进页面现读一次就够。
 *     再存一份到网页存储，等于把「谁给你发过消息」多留一份在别处。
 *  🔴 网页版拿不到能力（`NativeApi.ding.state()` 是 null）时整块 hidden ——
 *     不是显示一句「仅 App 可用」，是连占位都不要有。
 *  🔴 一屏只画前 {@link DING_SHOW} 条：再往下就是上周的事，去钉钉翻更合适。
 */
const NEPU_NOTICE_KEY = 'zt.nepu-notices';
let nepuNoticeCache = store.get(NEPU_NOTICE_KEY, null);
let nepuNoticeError = '';
let nepuNoticeSheetToken = 0;

function renderNepuNotices() {
  const list = window.Nepu ? Nepu.normalizeNotices(nepuNoticeCache && nepuNoticeCache.items) : [];
  const host = $('nepuNoticeList');
  if (!host) return;
  host.innerHTML = list.map(it => '<button class="ntitem nepu-notice-item" data-notice-id="' + it.id + '">' +
    '<span class="nt-title">' + esc(it.title) + '</span><span class="nt-meta">教务通知<span class="nt-date">' +
    esc(it.date.slice(0, 10)) + '</span></span></button>').join('');
  $('nepuNoticeState').textContent = nepuNoticeError || (nepuNoticeCache
    ? (list.length ? '近三个月 · ' + list.length + ' 条 · ' + ntStamp(nepuNoticeCache.at) + ' 更新' : '教务列表中暂无近三个月公告')
    : '登录教务并同步后查看近三个月公告');
  $('ntBrief').textContent = nepuNoticeCache ? (list.length + ' 条公告') : '待同步';
}

function saveNepuNotices(raw) {
  nepuNoticeError = raw.noticesError || '';
  if (raw.notices && Array.isArray(raw.notices.items)) {
    nepuNoticeCache = {items: Nepu.normalizeNotices(raw.notices.items), at: raw.notices.at || Math.floor(Date.now() / 1000)};
    if (!store.set(NEPU_NOTICE_KEY, nepuNoticeCache)) nepuNoticeError = '公告已更新，本地缓存保存失败';
  }
  renderNepuNotices();
}

async function openNepuNotice(it) {
  const token = ++nepuNoticeSheetToken;
  const body = $('sheetBody');
  body.innerHTML = '<div class="sh-title">' + esc(it.title) + '</div><div class="sh-sub">' + esc(it.date) + '</div>' +
    '<div class="ntd-body" id="nepuNoticeBody">正在读取教务原文…</div>';
  const target = $('nepuNoticeBody');
  $('sheetMask').hidden = false;
  try {
    const result = await nepuBridgeCall('noticeDetail', it.id);
    const doc = new DOMParser().parseFromString(String(result.data && result.data.html || ''), 'text/html');
    const content = doc.querySelector('#content');
    if (!content) throw new Error('公告正文结构已变化，请稍后重试');
    content.querySelectorAll('script,style,iframe,object,embed').forEach(n => n.remove());
    content.querySelectorAll('br').forEach(n => n.replaceWith(doc.createTextNode('\n')));
    content.querySelectorAll('p,div,tr,li').forEach(n => n.appendChild(doc.createTextNode('\n')));
    if (token !== nepuNoticeSheetToken || !target.isConnected || $('sheetMask').hidden) return;
    target.textContent = content.textContent.replace(/\u00a0/g, ' ').replace(/\n[ \t]*\n[ \t]*\n/g, '\n\n').trim() || '公告正文为空';
    const links = Array.from(content.querySelectorAll('a[href]')).map(a => ({title: a.textContent.trim(), href: a.getAttribute('href')}));
    if (content.querySelector('img') || links.length) {
      const note = document.createElement('p'); note.className = 'ntd-note';
      note.textContent = '图片及附件请在教务系统原文中查看。'; body.appendChild(note);
    }
    const original = document.createElement('button'); original.className = 'btn'; original.textContent = '查看教务原文';
    original.onclick = () => {
      if (window.AndroidNepu && typeof window.AndroidNepu.openNotice === 'function') window.AndroidNepu.openNotice(it.id);
      else toast('请使用新版东油通查看原文');
    };
    body.appendChild(original);
  } catch (e) {
    if (token === nepuNoticeSheetToken && target.isConnected && !$('sheetMask').hidden) {
      target.textContent = e.message || '公告读取失败，请重试';
      if (/auth|login|session/i.test(e.kind || '')) {
        nepuSession = false;
        const login = document.createElement('button'); login.className = 'btn'; login.textContent = '登录教务';
        login.onclick = () => { $('sheetMask').hidden = true; switchTab('accounts'); doNepuLogin(); };
        body.appendChild(login);
      }
    }
  }
}

function enterNotice() { renderNepuNotices(); }

async function syncNepuNotices() {
  const button = $('nepuNoticeSync');
  const generation = CACHE_GEN;
  nepuNoticeError = '';
  if (button) button.disabled = true;
  $('nepuNoticeState').textContent = '正在同步教务公告…';
  try {
    const result = await nepuBridgeCall('syncNotices');
    if (generation !== CACHE_GEN) return;
    saveNepuNotices(result.data || {});
    if (nepuNoticeError) toast(nepuNoticeError);
  } catch (e) {
    if (generation !== CACHE_GEN) return;
    nepuNoticeError = e.message || '公告同步失败，已保留上次内容';
    renderNepuNotices();
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadNotice(force) {
  if (NT.loading) return;
  NT.loading = true;
  const gen = CACHE_GEN;          // 同上：清过缓存就把这份结果扔掉
  NT.err = '';
  ntPaintState();
  try {
    const r = await api('/api/notice?limit=60' + (force ? '&force=1' : ''));
    if (gen !== CACHE_GEN) return;  // 清过缓存了：不写 NT、不落盘、不重画
    if (!r || !r.ok) throw new Error((r && r.error) || '没取到数据');
    NT.all = r.items || [];
    NT.total = r.total == null ? NT.all.length : r.total;
    NT.sources = r.sources == null ? 0 : r.sources;
    NT.failed = r.failed || [];
    NT.at = r.at || 0;
    NT.tried = true;
    NT.fromCache = false;
    ntCacheSave();          // 刷成功才落盘：失败时保留上一次那份，别用空列表盖掉
    renderNotice();
  } catch (e) {
    // 🔴 刷新失败不能把已经拿到的列表清空 —— 那是把「这次没刷上」
    //    变成「什么都没有」，比不刷新更糟。
    NT.err = (e && e.message) || String(e);
    NT.tried = true;
  } finally {
    NT.loading = false;
    ntPaintState();
  }
}

/** 取一条的正文（时间 / 地点 / 摘要）。失败也记下来，不再重试。 */
async function ntLoadDetail(it) {
  if (!it || NT_BUSY[it.url] || NT_DETAIL[it.url]) return;
  NT_BUSY[it.url] = true;
  let d;
  try {
    d = await api('/api/notice/detail?u=' + encodeURIComponent(it.url));
    if (!d || !d.ok) d = { ok: false, error: (d && d.error) || '没读到正文' };
  } catch (e) {
    d = { ok: false, error: (e && e.message) || String(e) };
  }
  delete NT_BUSY[it.url];
  NT_DETAIL[it.url] = d;
  ntPatchCard(it.url);
  // 弹层可能已经关了（或者换成了别的弹层）—— 只在它还开着、
  // 且显示的就是这一篇时才重画。不判断的话会把别的弹层内容冲掉。
  if (ntSheetUrl === it.url && !$('sheetMask').hidden) ntPaintSheet(it, d);
}

/** 给列表最上面几条补详情。两个并发：
 *  一个太慢（八条要等八轮），六个就是同时敲学校服务器。 */
function ntPrefetchFor(list) {
  const queue = list.slice(0, 8).filter((x) => !NT_DETAIL[x.url] && !NT_BUSY[x.url]);
  if (!queue.length) return;
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const it = queue[i++];
      if (NT_DETAIL[it.url] || NT_BUSY[it.url]) continue;
      await ntLoadDetail(it);
    }
  };
  worker(); worker();
}

/** 只换这一张卡。整列重画的话，用户正在滑的时候滚动位置和点击态都会丢。 */
function ntPatchCard(url) {
  const nodes = $('ntList').children;
  for (let k = 0; k < nodes.length; k++) {
    if (nodes[k].dataset.url !== url) continue;
    const it = NT.all.find((x) => x.url === url);
    if (!it) return;
    const box = document.createElement('div');
    box.innerHTML = ntCardHtml(it);
    if (box.firstChild) nodes[k].parentNode.replaceChild(box.firstChild, nodes[k]);
    return;
  }
}

function ntPaintSheet(it, d) {
  const meta = [it.dept || it.source || '', it.date || ''].filter(Boolean).join(' · ');
  let kv = '';
  if (d && d.ok) {
    if (d.when) kv += '<div class="sh-row"><span class="k">时间</span><span class="v">' +
                      esc(d.when) + '</span></div>';
    if (d.where) kv += '<div class="sh-row"><span class="k">地点</span><span class="v">' +
                       esc(d.where) + '</span></div>';
    if (d.publish && d.publish !== it.date) {
      kv += '<div class="sh-row"><span class="k">发布</span><span class="v">' +
            esc(d.publish) + '</span></div>';
    }
  }
  let mid;
  if (!d) {
    mid = '<div class="ntd-loading">正在读原文…</div>';
  } else if (!d.ok) {
    mid = '<div class="ntd-loading">没读到正文（' + esc(d.error || '原因不明') +
          '）。下面可以直接打开原文。</div>';
  } else if (d.summary) {
    mid = '<div class="ntd-body">' + esc(d.summary) + '</div>';
  } else {
    mid = '';
  }

  $('sheetBody').innerHTML =
    '<div class="sh-title">' + esc(it.title) + '</div>' +
    '<div class="sh-sub">' + esc(meta) + '</div>' +
    (kv ? '<div class="sh-rows">' + kv + '</div>' : '') +
    mid +
    '<div class="ntd-note">时间地点可能有出入，以原文为准。</div>' +
    '<div class="sheetbtns">' +
      '<button class="btn" id="ntClose">关闭</button>' +
      '<button class="btn primary" id="ntOpen">看原文</button>' +
    '</div>';
  $('ntClose').addEventListener('click', () => {
    ntSheetUrl = '';
    $('sheetMask').hidden = true;
  });
  $('ntOpen').addEventListener('click', () => {
    // 0.17.3 起在 App 内打开：公告正文在门户域名下，带着 CASTGC 进去就不用重登。
    // 以前交给系统浏览器 —— 那是第三个 cookie 罐子，每次都要在浏览器里再登一次，
    // 登完回来还得再切回 App。
    // warn=false：公告源是 www / jwc / tuanwei 这些**公开**新闻站，
    // 没连门户也照样能看，别弹「登录已过期」。
    if (!openApp(it.url, '公告原文', false)) toast('打不开，可以复制链接手动打开');
  });
}

function openNotice(it) {
  ntSheetUrl = it.url;
  ntPaintSheet(it, NT_DETAIL[it.url]);
  $('sheetMask').hidden = false;
  // 预取只覆盖最上面八条，点第 20 条时现取一次。
  if (!NT_DETAIL[it.url]) ntLoadDetail(it);
}

if ($('ntBack')) $('ntBack').addEventListener('click', () => switchTab('wiki'));

// ------------------------------------------------------------------ 课表

/** 换了日历日，就把「看到第几周 / 哪一天」拉回今天。
 *
 *  🔴 `CFG.week` 和 `CFG.cursor` 都存在本机（`zt.settings`），可它们只在
 *     **当天**有意义。2026-10-23 用户报的「周切日显示的不是当天」就是这条：
 *     他昨天看过日视图，cursor 停在 10-22，今天切过去还画 10-22。
 *     更危险的是周视图那一半 —— 上周日看的是第 7 周，周一已经第 8 周，
 *     开 App 还停在第 7 周，照着上周的课表走**会跑错教室**。
 *
 *  规则：同一天内照旧记住（「我刚翻到第 12 周」不能被冲掉），
 *        跨了一天就归位。判断依据是 `seenDay` 而不是「有没有 cursor」。
 */
function syncToday() {
  const t = ymd(today0());
  if (CFG.seenDay === t) return;
  CFG.seenDay = t;
  CFG.week = 0;          // 0 = 「没选过」，renderWeek 会补成 currentWeek()
  CFG.cursor = '';
  store.set(KEY.settings, CFG);
}

/** 日视图该画哪一天。
 *
 *  日视图的日期必须落在「周视图正在看的那一周」里，否则两个视图各说各的
 *  （顶栏写着「第 12 周」，切过去却是第 3 周的某一天）。
 *    · cursor 已经在那周里 —— 同一天内自己翻过天，保留，别抢用户的选择
 *    · 不在 —— 取那一周里**今天这个星期几**；看的就是当周时，正好是今天
 */
function dayAnchor() {
  const w = Math.min(Math.max(CFG.week || currentWeek(), 1), totalWeeks());
  const wd = (today0().getDay() + 6) % 7;
  if (CFG.cursor) {
    const cur = parseYmd(CFG.cursor);
    if (weekOf(cur) === w) return cur;
  }
  return addDays(startDate(), (w - 1) * 7 + wd);
}

/** 空课表统一引导用户登录东油教务，再返回同步课表。 */
function renderSchEmpty() {
  const box = $('schEmpty');
  if (!box) return;
  box.querySelector('h2').textContent = '课表尚未同步';
  box.querySelector('p').textContent = '登录东油教务后，返回这里同步课表。';
  const login = $('goBind');
  if (login) {
    login.hidden = false;
    login.textContent = '登录教务';
  }
  if ($('goQuick')) $('goQuick').hidden = true;
}

/** 顶上那条「这次没读到，下面是上次同步的」。
 *
 *  🔴 只在**真留了旧数据**时才出现：`timetableError` 有、而且屏幕上确实
 *     还摆着课（`DATA.courses` 非空）。没有旧数据的空课表走 `renderSchEmpty`
 *     那条，那里会把「没读到」和「学校没排课」分开说 —— 两条不许同时出现。
 */
function paintStaleBar() {
  const el = $('schStale');
  if (!el) return;
  const d = DATA;
  const kept = !!(d && d.timetableError && d.courses && d.courses.length);
  el.hidden = !kept;
  if (!kept) { el.textContent = ''; return; }
  const when = d.keptFrom ? timeAgo(d.keptFrom) : '';
  el.innerHTML = '<b>课表这次没读到</b>（' + esc(d.timetableError) + '）。' +
    '下面是上次同步的那份' + (when ? '（' + esc(when) + '）' : '') +
    '，点右上角刷新再试。';
}

function renderSchedule() {
  syncToday();
  paintStaleBar();
  // 每次重画都把这两个索引丢掉重算：用户可能刚在「学习」页扫完作业、
  // 或者在考试页拉完一场新的，数据换了但索引还是上一次那份。
  _dueIdx = null;
  _exIdx = null;
  const hasData = allCourses().length > 0;
  $('schEmpty').hidden = hasData;
  if (!hasData) renderSchEmpty();
  $('wkGutter').hidden = !hasData;
  $('gridWrap').hidden = !(hasData && CFG.view === 'week');
  $('dayWrap').hidden = !(hasData && CFG.view === 'day');
  // 视图切换按钮上写的是**当前**视图（周 / 日），点一下换成另一个。
  // 以前是两个 SVG 互切，网格图标表示不了「点一下会换一种」。
  $('wkViewLab').textContent = CFG.view === 'week' ? '周' : '日';
  $('viewToggle').classList.toggle('is-day', CFG.view === 'day');
  // 没数据的时候顶上那排「翻周 / 今天 / 切视图」全是无效控件 ——
  // 点了没反应，还让人以为界面坏了，直接收起来。
  document.querySelector('.weekbar').hidden = !hasData;
  if (!hasData) return;
  if (CFG.view === 'day') renderDay(); else renderWeek();
}

/* ---------------- 周视图 ----------------
 *
 * 🔴 **一屏画三页**（上一周 / 本周 / 下一周）并排塞进一条 `.track`。
 *    之前只画当前这一页，手指一拖就把唯一那页推走了，底下什么都没有 ——
 *    用户看到的就是「先整屏空白，再蹦出下一页」。
 *    三页同时在场，拖到一半时左右两边都是真课表，这才叫翻页。
 *    松手后把轨道平移一页、重画三页、再把轨道摆回中间，全在同一帧里完成。
 */
function renderWeek() {
  const total = totalWeeks();
  if (!CFG.week) CFG.week = currentWeek();
  const week = Math.min(Math.max(CFG.week, 1), total);
  // 把夹紧后的值写回去。不然用户在「学期设置」里把总周数从 24 改成 10 时，
  // CFG.week 还停在 18，界面显示第 10 周，但下次 `‹ ›` 是从 18 开始加减的。
  CFG.week = week;

  const ws = addDays(startDate(), (week - 1) * 7);
  const we = addDays(ws, 6);

  // 副标题改成「10.12 – 10.18 · 21 门课」。
  // 原来写「10月12日 - 10月18日」，中文月份把一行占满，没地方再放门数。
  $('wkNum').textContent = '第 ' + week + ' 周';
  // 门数单独包一层：顶栏加了刷新按钮之后，320dp 的老机型只剩 107px，
  // 日期范围 + 门数放不下，会变成「10.19 – 10.25 · 14 …」。
  // 让门数先让位（它是锦上添花），日期范围必须完整 —— CSS 里按宽度藏。
  //
  // 🔴 看历史学期时，副标题换成「大一上 · 9.01–9.07」：
  //    这一屏最要紧的信息不再是「几门课」，而是「我看的是哪一学期」——
  //    否则往上翻两页，用户根本分不清这张表是今年还是去年的。
  //    同时「现在」按钮比「今天」宽，顶栏只剩 100 来像素，
  //    再挤下去副标题会变成「大一上 · 9.01 – …」，日期被省略号吃掉。
  //    所以：按钮只写「现在」两字（CSS `.is-back` 再收窄内边距），
  //    副标题的日期连接符也从 ` – ` 收成 `–`（省两个字符宽度）。
  $('wkRange').innerHTML = TT
    ? '<b class="wk-term">' + esc(termShort(TT.semester)) + '</b> · ' +
      mdDot(ws) + '–' + mdDot(we)
    : mdDot(ws) + ' – ' + mdDot(we) +
      '<i class="wk-cnt"> · ' + weekCourseCount(occupancy(week)) + ' 门课</i>';
  // 已经在「本周」时把「今天」按钮标成浅蓝：按下去没变化，
  // 不标的话用户会以为按钮坏了。
  // 历史学期下这个按钮变成「回到现在」—— 否则它点了会跳到「历史学期的今天」，
  // 而那个日期根本不存在（week 被夹到 1，看着像没反应）。
  $('wkToday').classList.toggle('is-here', ttIsNow() && week === currentWeek());
  $('wkToday').classList.toggle('is-back', !ttIsNow());
  $('wkToday').textContent = ttIsNow() ? '今天' : '现在';

  renderGutter();
  const track = $('wkTrack');
  track.innerHTML = '';
  // 越界那一页画成空表：拖到头时橡皮筋只露一点点边，
  // 露出一张别的周的课表会让人以为翻页翻错了。
  [[week - 1, week > 1], [week, true], [week + 1, week < total]].forEach((p, i) => {
    const g = buildWeekGrid(p[1] ? p[0] : 0);
    if (i === 1) g.id = 'grid';   // 中间那页才是「当前页」，测试和老代码都认这个 id
    track.appendChild(g);
  });
  fitRoomLines(track);
  centerTrack(track);
}

/** 放不下的单行文本：量一下宽度，放不下就把字号往下压（最低 8px）。
 *
 *  管两类元素，都是「裁一半等于没写」的东西：
 *    · `.br2` —— 双教室号 `02B506`。9.5px 在电脑上量得下，在用户手机上
 *      末尾那个 6 被裁掉一半（2026-10-19 截图）。
 *    · `.bt`  —— 老师名字。带单双周角标的块还要让出右下角 12px，
 *      于是「李怡琦」显示成「李…」（2026-10-30 截图）。
 *
 *  🔴 为什么不靠 CSS 定死字号：Android WebView 的 Roboto 比桌面 Chromium 宽。
 *     只有**量出来**才知道放不放得下。判据用 scrollWidth > clientWidth ——
 *     元素是 nowrap + overflow:hidden，放不下时 scrollWidth 会大于可视宽度。
 *     `clientWidth` 不含 padding，所以 `.bt` 让给角标的那 12px 自动算在内。
 */
function fitRoomLines(root) {
  const els = root.querySelectorAll('.br2, .bt');
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    el.style.fontSize = '';
    el.classList.remove('wrap');       // 每次重画都从「不折行」重新量
    // 页面被切走时（display:none）量出来全是 0，硬缩会把字号一路压到 8px。
    // 量不了就先不动，等切回课表页时 switchTab 会再调一次。
    if (!el.clientWidth) continue;
    // 🔴 起始字号必须**读 CSS**，不能写死一个数。写死 9.5 而 CSS 是 10 的话，
    //    第一次比较用的是 10px（还没赋值），循环第一轮直接跳到 9.0 ——
    //    9.5 这一档永远试不到，最后可能多缩半档还差 1px 被裁。
    let size = parseFloat(getComputedStyle(el).fontSize) || 10;
    while (size > 8 && el.scrollWidth > el.clientWidth + 0.5) {
      size -= 0.5;
      el.style.fontSize = size.toFixed(1) + 'px';
    }
    // 8px 还是放不下：老师名折到第二行（CSS 的 `.bt.wrap`），完整比截断重要。
    // ⚠️ 只对 `.bt` 这么做。`.br2` 的注释写明「锁死 nowrap，再折行就真的
    //    塞不下（360dp 实测溢出 10px）」—— 教室号折行会把格子撑破。
    if (el.classList.contains('bt') && el.scrollWidth > el.clientWidth + 0.5) {
      el.classList.add('wrap');
    }
  }
}

/** 「上午 / 下午 / 晚上」之间的那几道缝（0.50.0 v9）。
 *
 *  用户 2026-11-09：「课表界面，能不能把上午和下午，下午和晚上，的中间略微留点间隙」。
 *  为什么是「少量留白」而不是三张小卡片：一天十节的表本来就满，
 *  拆成三块会把「连着上」这件事画断 —— 而连堂（第 3、4 节一门课）是常态。
 *
 *  🔴 界**不写死**成第 4 节、第 8 节。界是作息本身给出来的：
 *     相邻两节之间空出半小时以上（午饭、晚饭），那里就是上午/下午/晚上的分界。
 *     写死的话，改了作息（12 节、或者上午 5 节）缝就落在错的地方，
 *     而且看起来像是课表画错了。
 *  🔴 时间读不到（'' 或格式不认识）就**不放缝**：宁可没有，
 *     也不能凭空在课表中间插一道白条。
 */
const DAY_BREAK_MIN = 45;      // 两节之间空出这么多分钟，算分段

function dayBreaks(tt, units) {
  const out = [];
  for (let p = 1; p < units; p++) {
    const end = hhmmToMin(tt[p - 1] && tt[p - 1][1]);
    const start = hhmmToMin(tt[p] && tt[p][0]);
    if (end === null || start === null) continue;
    if (start - end >= DAY_BREAK_MIN) out.push(p);   // 第 p 节（0 基）之前断开
  }
  return out;
}

/** 节次（0 基）→ 网格行号。缝自己也占一行，所以行号不再是 p + 2。 */
function rowOf(p, breaks) {
  let extra = 0;
  for (let i = 0; i < breaks.length; i++) if (breaks[i] <= p) extra++;
  return p + 2 + extra;
}

/** 整张表的行模板：表头 + 每节一行 + 分段的缝。 */
function gridRowsCss(units, breaks, breakH) {
  const out = ['40px'];
  for (let p = 0; p < units; p++) {
    out.push('var(--cell-h, 56px)');
    if (breaks.indexOf(p + 1) >= 0) out.push(breakH + 'px');
  }
  return out.join(' ');
}

const DAY_BREAK_H = 6;         // 缝的高度（px）

/** 左边固定的「节次 / 起止时间」栏。它不跟着翻页走，所以只画一次。 */
function renderGutter() {
  const units = (curTT().unitCount || 10);
  const tt = times();
  const g = $('wkGutter');
  const breaks = dayBreaks(tt, units);
  g.style.setProperty('--units', units);
  // 行模板要和右边的表格**一模一样**，否则节次和时间会错位半格。
  g.style.gridTemplateRows = gridRowsCss(units, breaks, DAY_BREAK_H);
  let html = '<div class="g-corner"></div>';
  for (let p = 0; p < units; p++) {
    // 三行：开始 / 节次 / 结束。
    // 用户 2026-11-09：「现在是 1 换行 8:00 换行 8:45，你改成 8:00 换行 1 8:45
    // 这种，时间的字体稍微大一些」。所以开始时间提到最上面 —— 找「几点上课」
    // 是竖着扫这一列时最先要的答案，节次只是它的编号。
    // 🔴 行号必须显式给：分段的缝也占一行，靠自动排会有一节掉进缝里。
    //    `data-p` 是给判据用的：DOM 里 row 已经不是 p+2 了（中间夹着缝行），
    //    判据要靠它把「第几行」翻回「第几节」，否则一整排断言都会算错位。
    //
    // 2026-11-10：用户「左边的时间可读性不太好，每两个课时中间画上不太显眼的
    // 虚线，每两节课中间加上实线」。
    //   「课时」= 一节课（1、2、3…），「两节课」= 一个大节（1-2、3-4…）。
    //   所以分组只按**两节一组**，不看作息里真实的间隔 —— 作息改过之后
    //   课间长短会变，但「上午两大节」这件事是课表本来的结构。
    //   （`dayBreaks` 那个 6px 的缝仍在，它跟的是真实课间，两件事不冲突。）
    const bigEnd = ((p + 1) % 2 === 0);
    html += '<div class="g-slot' + (bigEnd ? ' gb' : '') + '" data-p="' + p +
      '" style="grid-row:' + rowOf(p, breaks) + '">' +
      (tt[p][0] ? '<i>' + tt[p][0] + '</i>' : '') +
      '<b>' + (p + 1) + '</b>' +
      (tt[p][1] ? '<i>' + tt[p][1] + '</i>' : '') + '</div>';
  }
  g.innerHTML = html;
}

/** 长按课表里的**空白格子**加课。
 *
 *  为什么是长按而不是点一下：一天有十来个空格，点一下就弹表单，
 *  翻周、滑屏、点到空白处歇一下都会误触。长按等于「我确定要在这里加」。
 *
 *  🔴 手指一动就取消。翻周是横滑、上下滚是竖滑，两种都会先来 touchmove；
 *     不取消的话滑一下课表就弹出表单 —— 那是比误触更烦的事。
 *
 *  🔴 只认 `.g-cell`（空白格）。课程块 `.g-block` 有自己的点击（看详情），
 *     长按它不该冒出一个「加课」。
 */
function bindCellPress(grid, week) {
  let timer = 0;
  let cell = null;
  let sx = 0;
  let sy = 0;

  const clear = () => {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (cell) { cell.classList.remove('press'); cell = null; }
  };

  const start = (x, y, el) => {
    if (!el || !el.classList || !el.classList.contains('g-cell')) return;
    clear();
    cell = el;
    sx = x; sy = y;
    cell.classList.add('press');
    timer = setTimeout(() => {
      timer = 0;
      const d = Number(cell.dataset.day);
      const p = Number(cell.dataset.p);
      clear();
      // 从哪一周按出来的就先只勾那一周 —— 他站在第 5 周，多半是在补第 5 周的课；
      // 想改成整学期，按一下「全选」就行。
      const w = Number(week);
      const weeks = (w >= 1 && w <= totalWeeks()) ? [w] : allWeeks();
      openMyCourseForm('', { day: d, p0: p, p1: p, weeks: weeks });
    }, 520);
  };

  const moved = (x, y) => !!cell && (Math.abs(x - sx) > 8 || Math.abs(y - sy) > 8);

  grid.addEventListener('touchstart', (e) => {
    const t = e.touches && e.touches[0];
    if (t) start(t.clientX, t.clientY, e.target);
  }, { passive: true });
  grid.addEventListener('touchmove', (e) => {
    const t = e.touches && e.touches[0];
    if (t && moved(t.clientX, t.clientY)) clear();
  }, { passive: true });
  grid.addEventListener('touchend', clear);
  grid.addEventListener('touchcancel', clear);

  // 桌面和网页版：鼠标按住也算（判据就是在浏览器里这样点的）。
  grid.addEventListener('mousedown', (e) => start(e.clientX, e.clientY, e.target));
  grid.addEventListener('mousemove', (e) => { if (moved(e.clientX, e.clientY)) clear(); });
  grid.addEventListener('mouseup', clear);
  grid.addEventListener('mouseleave', clear);

  // 安卓 WebView 长按会试着弹系统菜单（选中/分享），把菜单顶掉。
  grid.addEventListener('contextmenu', (e) => { e.preventDefault(); });
}

/** 画某一周的一整张表，返回还没插进文档的 `.grid` 元素。 */
/** 截止缓存按天索引一次（`'2026-11-15' → [条目…]`，当天按时间排好）。
 *
 *  🔴 为什么要缓存：课表一次重画要问 21 次（三页 × 七天 + 日视图三页），
 *     每次都 `JSON.parse` 那 60 条纯属浪费 —— 手指划一下就是 21 次。
 *     一次重画只解析一次，重画入口（renderSchedule）和写入处（dueCacheSave）
 *     各自把它清掉。判据那边量的是行为（点上有、日期对），不受这点影响。
 */
let _dueIdx = null;

/** 截止缓存里的一条（`{t,c,e,k,s}`）是不是被手动标成了「我交过了」。
 *
 *  和作业列表共用同一份标记：key 都是 `课程|标题`，值都是标记那一刻的截止秒。
 *  🔴 三处都要用它（课表刻度 / 提醒 / 加日历）—— 少一处，用户就会看见
 *     「列表里没了、课表上还挂着」这种自相矛盾的画面。
 */
function dueMarked(it) {
  const marks = cxDoneMarks();
  const key = String((it && it.c) || '') + '|' + String((it && it.t) || '');
  if (!Object.prototype.hasOwnProperty.call(marks, key)) return false;
  const at = Number(marks[key]) || 0;
  const e = Number(it && it.e) || 0;
  if (!at || !e) return true;
  return Math.abs(e - at) <= 3600;
}

function dueIndex() {
  if (_dueIdx) return _dueIdx;
  const c = store.get(KEY.due, null);
  const list = (c && Array.isArray(c.list)) ? c.list : [];
  const m = Object.create(null);
  list.forEach((it) => {
    const sec = Number(it && it.e);
    if (!(sec > 0)) return;
    if (dueMarked(it)) return;          // 交过了就不在课表上挂刻度
    const k = ymd(new Date(sec * 1000));
    (m[k] = m[k] || []).push(it);
  });
  Object.keys(m).forEach((k) => {
    m[k].sort((a, b) => Number(a.e) - Number(b.e));
  });
  _dueIdx = m;
  return m;
}

/** 这一天有几条作业/考试到期（读本机那份截止缓存，见 KEY.due）。
 *
 *  用户 2026-11-11：「或者直接在课程表上显示出来哪个作业在何时截止」。
 *  🔴 只读缓存、不打服务器：课表页要能在没网的时候照常画出来。
 *  🔴 缓存里只有「还没过期 + 最多 60 条」（dueCacheSave），所以这里给出的
 *     永远是**下界**，不是「这一天一共要交几样」。文案上不能写成「共 N 条」。
 */
function dueOn(date) {
  return dueIndex()[ymd(date)] || [];
}

/** 当天第几分钟 → `09:05`。 */
function hm2(min) {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(min) || 0)));
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

/** 截止时刻 → `19:07`。 */
function dueHm(it) {
  const d = new Date(Number(it && it.e) * 1000);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* ---- 学校的考试也落到课表上（2026-11-12） ---------------------------
 *
 *  用户 2026-11-12：「考试时间也加进去，包括学习通和学校的」。
 *
 *  两种来源的**性质**不一样，画法就不该一样：
 *    学习通 → 只有「交卷截止」这一刻（dueCacheSave 里 `k:'exam'`），是个**时刻**；
 *    教务处 → 日期 + 考试安排（`09:00-11:00`），是一段**时间**。
 *  时刻画一颗菱形刻度，时间段画一条横跨的带子 —— 带子表达的正是「这段时间被
 *  考试占住了」，这本来就是课表要干的事。
 *
 *  🔴 只收**日期抠得出来**的场次。学校对没排考的写「时间未安排」，那种在考试
 *     页里显示「待定」，但落不到具体某一天上；硬塞进去就是「每天课表上都挂着
 *     一场考试」。
 *  🔴 当前学期在 `DATA.exams` 和 `DATA.examsBySem[当前学期]` 里**各有一份**，
 *     不去重会画两条带子叠在一起，看着像渲染坏了。
 */
let _exIdx = null;

function examIndex() {
  if (_exIdx) return _exIdx;
  const out = Object.create(null);
  const seen = Object.create(null);
  const push = (bucket) => {
    ((bucket && bucket.exams) || []).forEach((e) => {
      const d = examDate(e && e.date);
      if (!d) return;
      const k = ymd(d);
      const r = parseArrange(e && e.arrange);
      // 同一天同名的两场（上午场 / 下午场）靠起始分钟区分，不算重复。
      const id = k + '|' + String(e.name || '') + '|' + (r ? r.b : '-');
      if (seen[id]) return;
      seen[id] = 1;
      (out[k] = out[k] || []).push({
        name: String(e.name || '').trim() || '一场考试',
        b: r ? r.b : null,
        e: r ? r.e : null,
        room: blankField(e.room) ? '' : String(e.room).trim(),
        seat: blankField(e.seat) ? '' : String(e.seat).trim(),
        form: blankField(e.form) ? '' : String(e.form).trim(),
        noTime: !r,
      });
    });
  };
  push(DATA && DATA.exams);
  const by = (DATA && DATA.examsBySem) || {};
  Object.keys(by).forEach((k) => push(by[k]));
  Object.keys(out).forEach((k) => {
    // 定了时间的排前面、按开始时间；「时间未安排」的垫底。
    out[k].sort((a, b) => (a.b === null ? 1e9 : a.b) - (b.b === null ? 1e9 : b.b));
  });
  _exIdx = out;
  return out;
}

function examsOn(date) {
  return examIndex()[ymd(date)] || [];
}

/** 一个时刻（当天的第几分钟）→ 第几节 + 行内比例。
 *
 *  🔴 作息之外不许丢：早于第一节挂到第一节的顶，晚于最后一节挂到最后一节的底。
 *     丢掉就是「今天明明有东西要交，课表上什么都没有」。
 *  🔴 **两节之间的空档**（午休 11:40–14:30、21:10 之后）也要有个去处：
 *     12:30 截止的那条既不在第 4 节里也不在第 5 节里，旧写法会一路掉到最后
 *     一节的底 —— 屏幕上看着像晚上九点多截止。
 *     `prefer='before'` 贴着上一节的底（一个「截止」发生在它之后），
 *     不传就贴下一节的顶（一场「考试」从那儿开始）。
 */
function slotOf(tt, units, m, prefer) {
  let after = -1;
  let before = -1;
  for (let i = 0; i < units; i++) {
    const a = hhmmToMin(tt[i] && tt[i][0]);
    const b = hhmmToMin(tt[i] && tt[i][1]);
    if (a === null || b === null) continue;
    if (m >= a && m < b) return { p: i, f: (m - a) / Math.max(1, b - a) };
    if (b <= m) before = i;
    if (a > m && after < 0) after = i;
  }
  if (prefer === 'before' && before >= 0) return { p: before, f: 1 };
  if (after >= 0) return { p: after, f: 0 };
  if (before >= 0) return { p: before, f: 1 };
  return { p: 0, f: 0 };
}

/** 课表上那些「一点」的标记：作业截止、学习通的考试截止。
 *
 *  用户 2026-11-12：「把未完成作业截止线也标在课表的对应位置……默认缩略
 *  形式，比如以点或者线形式显示在课表上，点击后查看具体作业」。
 *
 *  返回 `[{p, f, n, at, kind}]`：`p` 第几节、`f` 节内比例、`n` 这一节里有几样、
 *  `at` 最早那一分钟、`kind` = `'work'` / `'exam'`。
 *
 *  🔴 **不画横线**，画一颗贴在左缘的竖条 / 菱形。第一版是横穿整列的一条线，
 *     截图一看「代数」被拦腰划了一道 —— 44px 宽的格子里，任何横着走过去的东西
 *     都会变成删除线。竖着的一小颗才是「时间轴上的刻度」，而且不碰字。
 *  🔴 同一节里**同类**的合并成一颗（两条 19:00 / 19:05 相差不到 3px，会糊成
 *     一个粗块），合并后停在**最早**那条 —— 最紧的那件事才有意义；条数靠
 *     `--k` 让刻度长一点，不写数字（44px 放不下，写上去就是压在课名上）。
 *     类别不同的**不合并**：作业和考试得一眼分得开。
 */
function tickMarksOf(date, tt, units) {
  const byKey = new Map();
  const add = (m, kind) => {
    // 截止时刻优先贴上一节的底：一个「截止」发生在那一节之后。
    const s = slotOf(tt, units, m, 'before');
    const k = s.p + ':' + kind;
    const cur = byKey.get(k);
    if (!cur) byKey.set(k, { p: s.p, f: s.f, n: 1, at: m, kind });
    else {
      cur.n += 1;
      if (m < cur.at) { cur.at = m; cur.f = s.f; }
    }
  };
  dueOn(date).forEach((it) => {
    const sec = Number(it && it.e);
    if (!(sec > 0)) return;
    const d = new Date(sec * 1000);
    add(d.getHours() * 60 + d.getMinutes(), it.k === 'exam' ? 'exam' : 'work');
  });
  // 学校那边「时间未安排」的考试也是有这一场的 —— 挂到当天第一节课的顶上，
  // 让「这天有考试」这件事至少看得见，具体时间在明细里写「时间未安排」。
  examsOn(date).forEach((x) => { if (x.noTime) add(-1, 'exam'); });
  return Array.from(byKey.values());
}

/** 这一天的考试时间段 → 课表上横跨的那条带子（只有定了时间的才有）。 */
function examBandsOf(date, tt, units) {
  return examsOn(date).filter((x) => !x.noTime).map((x) => {
    const a = slotOf(tt, units, x.b);
    // 结束时刻可能正好踩在下一节的开头（11:00 下课的考试）：那一刻属于
    // 下一节的开头，带子会多伸出一整节。所以结束按「减一分钟」算。
    const b = slotOf(tt, units, Math.max(x.b + 1, x.e - 1));
    const q = Math.max(a.p, b.p);
    return {
      p: a.p,
      q,
      f1: a.f,
      f2: q === a.p ? Math.max(a.f + 0.06, b.f) : b.f,
      x,
    };
  });
}

/** 一天要画在课表上的东西：刻度 + 考试带子。
 *
 *  `busy` 是这一列「有课」的节次集合。带子只在**整段都空着**的时候才画 ——
 *  考试和上课撞上时（教务排考迟到、调课），一块半透明的卡片压在课上会把课名
 *  透出来，看着像重影；压成实底又把课藏了，用户会以为那天没课。
 *  所以撞课的时候退回一颗菱形刻度（贴在时间轴上、不占地方），信息一样不丢。
 */
function dayMarks(date, tt, units, busy) {
  const ticks = tickMarksOf(date, tt, units);
  const bands = [];
  examBandsOf(date, tt, units).forEach((b) => {
    let clash = false;
    if (busy) {
      for (let p = b.p; p <= b.q; p++) if (busy.has(p)) { clash = true; break; }
    }
    if (!clash) { bands.push(b); return; }
    const s = slotOf(tt, units, b.x.b);
    // 已经在同一节有考试刻度了就别再放一颗（两颗会叠成一坨）。
    const dup = ticks.some((t) => t.kind === 'exam' && t.p === s.p &&
      Math.abs(t.f - s.f) < 0.08);
    if (!dup) ticks.push({ p: s.p, f: s.f, n: 1, at: b.x.b, kind: 'exam', done: true });
  });
  return { ticks, bands };
}

/** 这一天「有事」的清单：考试 + 要交的东西，按时间升序。
 *
 *  日视图和「点开的那张明细」共用这一份 —— 两边各算一次，迟早有一天对不上。
 *  `min` 是当天第几分钟（`null` = 没定时间），排序时垫底。
 */
function dayAgenda(date) {
  const out = [];
  const hmOf = hm2;
  examsOn(date).forEach((x) => {
    out.push({
      min: x.b,
      kind: 'exam',
      title: x.name,
      start: x.noTime ? '—' : hmOf(x.b),
      endLab: x.noTime ? '时间未定' : hmOf(x.e),
      when: x.noTime ? '时间未安排' : (hmOf(x.b) + '–' + hmOf(x.e)),
      sub: [x.room ? '地点 ' + x.room : '', x.seat ? '座位 ' + x.seat : '',
            x.form ? x.form : ''].filter(Boolean).join(' · ') || '还没排考场',
      // 2026-11-14：这两项给「点开看详情」用。教务排的考试没有单场页面，
      // 所以 url 空着；src 写 school，界面上因此不出现「打开学习通」。
      src: 'school', url: '', at: null, course: '',
    });
  });
  dueOn(date).forEach((it) => {
    const sec = Number(it && it.e);
    if (!(sec > 0)) return;
    const d = new Date(sec * 1000);
    out.push({
      min: d.getHours() * 60 + d.getMinutes(),
      kind: it.k === 'exam' ? 'exam' : 'work',
      title: String(it.t || '').trim() || (it.k === 'exam' ? '一场考试' : '一条作业'),
      start: dueHm(it),
      endLab: '截止',
      when: dueHm(it) + ' 截止',
      sub: [String(it.c || '').trim(), it.k === 'exam' ? '考试' : '作业']
        .filter(Boolean).join(' · ') || '没写是哪门课',
      // 学习通那条：条目自己的地址（dueCacheSave 存的 u）和来源。
      // 有地址才能「点一下就落到那条作业上」，没有就只能去列表里找。
      src: it.s || 'cx', url: String(it.u || ''), at: sec,
      course: String(it.c || ''),
    });
  });
  out.sort((a, b) => (a.min === null ? 1e9 : a.min) - (b.min === null ? 1e9 : b.min));
  return out;
}

function buildWeekGrid(week) {
  const ws = addDays(startDate(), (week - 1) * 7);
  const occ = week >= 1 ? occupancy(week) : {};
  // 显示哪几天。拿到的是**真实星期几**，不是列序号 ——
  // 跳过空的周末列之后，最后一列的 d 可能是 4（周五）也可能是 6（周日），
  // 拿列号当星期用会把课画到错误的列上。
  const cols = visibleDays();
  const days = cols.length;

  const units = (curTT().unitCount || 10);
  const tt = times();
  const nowMin = nowMinute();

  const t0 = today0();
  const todayIdx = (week === weekOf(t0))
    ? Math.round((t0 - mondayOf(t0)) / 86400000) : -1;

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.style.setProperty('--days', days);
  grid.style.setProperty('--units', units);
  // 上午 / 下午 / 晚上之间留一道缝（见 dayBreaks）。模板写在这里而不是 CSS：
  // 缝在**第几节之后**取决于作息，CSS 里写死就只能在默认作息上对。
  const breaks = dayBreaks(tt, units);
  grid.style.gridTemplateRows = gridRowsCss(units, breaks, DAY_BREAK_H);
  const frag = document.createDocumentFragment();

  // 「今天」那一列铺一条很淡的底色（整列，从表头到最后一节）。
  // 只在表头上做个胶囊，翻到别的周再翻回来时很容易看丢；
  // 整列一条淡淡的「泳道」，扫一眼就知道哪列是今天。
  // 🔴 必须先于 g-day / g-cell / g-block 入 DOM —— 网格项按 DOM 顺序叠，
  //    放后面就会盖住课程块。
  // ⚠️ 列号是 ci + 1：节次栏已经挪到轨道外面了，第 1 列就是周一。
  if (todayIdx >= 0) {
    const ci = cols.indexOf(todayIdx);
    if (ci >= 0) {
      const lane = document.createElement('div');
      lane.className = 'g-today-lane';
      lane.style.gridColumn = (ci + 1);
      // 最后一节所在的行号就是这一列要铺到的高度（缝也算在里面）
      lane.style.gridRow = '1 / span ' + rowOf(units - 1, breaks);
      frag.appendChild(lane);
    }
  }

  for (let ci = 0; ci < days; ci++) {
    const d = cols[ci];
    const el = document.createElement('div');
    // 这天有作业到期 → 日期后面点一个点（周视图只有这么点地方）。
    // 明细在日视图里（见 buildDayPage 的 .dv-due）：哪门课、几点截止。
    // 🔴 不做成「点上能点开」：表头格子本来不可点，加一个只有表头能点的
    //    交互，比不响应更让人困惑。
    const hasDue = dueOn(addDays(ws, d)).length > 0;
    el.className = 'g-day' + (d === todayIdx ? ' is-today' : '') + (hasDue ? ' has-due' : '');
    el.style.gridColumn = (ci + 1);
    // 两行：星期在上（小、灰），月/日在下（大、深）。
    // 以前是「一 12」挤在一行、日期还是 <i> 斜体 —— 又小又斜，
    // 基本看不出那是日期，用户直接说「怎么不写日期」。
    // 写「周一」不写「一」：单个「一」渲染出来就是一根横线，
    // 摆在日期上面像条分隔符，不像星期。
    el.innerHTML = '<b>周' + DAY_CN[d] + '</b>' +
      '<span class="dnum">' + mdSlash(addDays(ws, d)) + '</span>';
    frag.appendChild(el);
  }

  for (let ci = 0; ci < days; ci++) {
    for (let p = 0; p < units; p++) {
      const el = document.createElement('div');
      el.className = 'g-cell';
      el.style.gridRow = rowOf(p, breaks);
      el.style.gridColumn = (ci + 1);
      // 长按空白格加课要用（见 bindCellPress）。带上 0 基的星期和节次。
      el.dataset.day = String(cols[ci]);
      el.dataset.p = String(p);
      frag.appendChild(el);
    }
  }

  for (let ci = 0; ci < days; ci++) {
    const d = cols[ci];
    let p = 0;
    while (p < units) {
      const here = occ[d + ':' + p];
      if (!here || !here.length) { p++; continue; }
      const sig = here.map((c) => c.name + '@' + c.room).sort().join('|');
      let q = p + 1;
      while (q < units) {
        const nxt = occ[d + ':' + q];
        if (!nxt || !nxt.length) break;
        if (nxt.map((c) => c.name + '@' + c.room).sort().join('|') !== sig) break;
        q++;
      }
      const span = q - p;
      const startP = p;                       // p 会被改写，闭包里另存
      const main = here[0];
      const blk = document.createElement('div');
      // tall = 跨 2~3 节，xtall = 跨 4 节以上，one = 只有一节。
      // 三种高度能放下的文字行数不同，靠 class 决定课名最多占几行。
      // 「正在上」高亮：只在这一列**就是今天**、且此刻落在这块的起止之间时亮。
      // 翻到别的周 todayIdx 已经是 -1，天然不亮 —— 别让用户以为第 5 周
      // 也有节课正在上。
      const isNow = todayIdx >= 0 && cols[ci] === todayIdx && liveAt(tt, p, q, nowMin);
      // 0.51.0：自己加的课带一层斜纹底（CSS `.is-mine`）。
      // 用户 2026-11-08：「用户自己添加的课程应该跟原本有的课程有明显区别，便于分辨」。
      // 11-09 又嫌上一版不够显眼，换成了满块斜纹：格子只有 44px 宽，
      // 放不下「自加」两个字，纹路是唯一不占地方又一眼看得出的标记。
      // 🔴 用 some 不用 main：撞课时格子只画了第一门，而自己加的那门可能排在后面。
      const mine = here.some(isMyCourse);
      blk.className = 'g-block' +
        (mine ? ' is-mine' : '') +
        (here.length > 1 ? ' multi' : '') +
        (span >= 4 ? ' tall xtall' : (span >= 2 ? ' tall' : ' one')) +
        (isNow ? ' live' : '');
      // 颜色靠几个 CSS 变量传下去（底色 / 字色 / 深色那一对）。
      // 不再用 `.c0`~`.c7` 那八档：见 colorHue 上面那段说明。
      paintHue(blk, colorHue(main.name));
      // 跨节的一块从起点那行铺到终点那行；中间的缝会被这一块盖住 ——
      // 连堂（第 4、5 节同一门课）本来就该看着是连着的。
      blk.style.gridRow = rowOf(p, breaks) + ' / span ' +
        (rowOf(q - 1, breaks) - rowOf(p, breaks) + 1);
      blk.style.gridColumn = (ci + 1);
      const names = here.map((c) => '<div class="bn">' + esc(c.name) + '</div>').join('');
      // 撞课（一格两门）时不放教室和教师 —— 分不清哪个属于哪门课，
      // 写了反而误导。单节的格子也照常写：字小一点塞得下，
      // 「这节课在哪个教室」比「课名多显示两个字」重要。
      let foot = '';
      if (here.length === 1) {
        if (main.room) {
          // 一间一行。两个教室就两行 —— 不能只写第一个（用户 2026-10-19 提的）。
          // 两间时把「楼栋 房间」中间那个空格去掉，**并且不要 @ 前缀**：
          // 格子只有 44px 宽，`@02B506` 在手机 WebView 里正好差几个像素，
          // 末尾的 6 被裁掉一半（用户 2026-10-19 第二次截图）。
          const rl = roomList(main.room);
          rl.forEach((r) => {
            const two = rl.length > 1;
            foot += '<div class="br' + (two ? ' br2' : '') + '">' +
              (two ? '' : '@') + esc(two ? r.replace(/\s+/g, '') : r) + '</div>';
          });
        }
        // 多个老师只写第一个。`张强,苏博` 在 27px 宽的角落只能显示成
        // 「张强,...」，还不如干净显示一个；完整名单在详情面板里。
        const tname = String(main.teacher || '').split(/[,，、]/)[0].trim();
        if (tname) foot += '<div class="bt">' + esc(tname) + '</div>';
      }
      blk.innerHTML = names + foot;
      const par = parityOf(main.weeks);
      if (par) blk.dataset.par = par;         // 右下角单/双周角标，纯 CSS 画
      blk.addEventListener('click', () => openCourseSheet(here, d, startP, span, week));
      frag.appendChild(blk);
      p = q;
    }
  }
  // ---- 考试 / 截止标记（2026-11-12，用户要求）----
  //
  //  两种形状，对应两件不同性质的事：
  //    考试（带时间）→ 横跨这段时间的**带子**，「这段被考掉了」；
  //    其余（作业截止、学习通考试截止、时间未安排的考试）→ 左缘一颗**刻度**。
  //
  //  🔴 刻度是**竖着**的一小颗，不是横线。第一版画的是横穿整列的线，
  //     截图一看「代数」被拦腰划了一道：44px 宽的格子里，横着走过去的东西
  //     一律会被读成删除线。竖着的一颗读起来才是「时间轴上的一个点」，
  //     而且一个像素都不碰课名。
  //  🔴 必须画在课程块**之后**：同一行同一列里 DOM 靠后的盖在上面。截止时刻
  //     落在一节课中间是常态，那时候最该看见的就是这颗刻度。
  //  🔴 位置靠 `--f`（节内比例）+ `transform: translateY(cell-h * f)`，不去算
  //     整张表的绝对坐标：分段的 6px 缝、表头 40px 都会让绝对坐标算错。
  //  🔴 点它不许冒泡到格子：`bindCellPress` 的长按加课挂在 `.g-cell` 上，
  //     不拦的话点刻度会顺带弹「在这里加课」。
  for (let ci = 0; ci < days; ci++) {
    const date = addDays(ws, cols[ci]);
    // 这一列哪几节有课（见 dayMarks 里那条「撞课就退回刻度」的规矩）。
    const busy = new Set();
    for (let p = 0; p < units; p++) if (occ[cols[ci] + ':' + p]) busy.add(p);
    const mk = dayMarks(date, tt, units, busy);

    mk.bands.forEach((b) => {
      // 课名能放几行看带子有多高：一格 51px，扣掉「考」徽标 12px + 内边距 4px，
      // 三行（31px）要 47px ⇒ 满一格才放三行。44px 宽两行只够 8 个字，
      // 「马克思主义基本原理」会被截成「马克思 主义…」，所以这场要三行。
      // 🔴 门槛原来是 1.8（那时带子底上还钉着一行考场，占了 10px）。
      const hf = (b.q - b.p) + b.f2 - b.f1;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'g-exam' + (hf >= 1.0 ? ' tall' : '');
      el.style.gridRow = rowOf(b.p, breaks) +
        ((b.q > b.p) ? ' / span ' + (rowOf(b.q, breaks) - rowOf(b.p, breaks) + 1) : '');
      el.style.gridColumn = (ci + 1);
      el.dataset.date = ymd(date);
      // 带子的上下沿都是「节内比例」，所以高度用 (跨几节 + 尾 - 头) 表示。
      el.innerHTML =
        '<i class="bd" style="top:calc(var(--cell-h, 51px) * ' + b.f1.toFixed(4) + ');' +
          'height:calc(var(--cell-h, 51px) * ' + Math.max(0.12, hf).toFixed(4) + ')">' +
          // 🔴 头顶只放「考」这一个字，不排开始时刻：360dp 七列时带子内宽只有
          //    36px，`考 09:00` 要 39px —— 试过，最后一个 0 被裁掉（「09:0(」）。
          //    时刻本来就由带子的**上下沿**表达，精确到分钟的去明细里看。
          '<span class="tag">考</span>' +
          '<span class="nm">' + esc(b.x.name) + '</span>' +
          // 🔴 带子上**不写考场**（2026-11-12，第三版）：360dp 七列时带子内宽
          //    36px，`05C201` 要么被折成两行、要么被尾部省略号吃掉一半，矮带子
          //    里还会把课名挤到只剩一行。考场属于「要点开才知道」的信息，
          //    交给 openDaySheet —— 那里一行写全，还能看清。少一行字换来的是
          //    课名多一行、矮带子不打架。
        '</i>' +
        '<span class="hit"></span>';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openDaySheet(date);
      });
      frag.appendChild(el);
    });

    mk.ticks.forEach((m) => {
      const el = document.createElement('button');
      el.type = 'button';
      // 🔴 最后一列（周日）单独一个类：它贴着翻页边界，刻度要往里让 4px
      //    （见 app.css 的 `.g-due.is-last`）。用户 2026-11-16：「考试的菱形
      //    在周日的话会把图形的大部分显示到下一页，点它也没反应」。
      el.className = 'g-due' + (m.kind === 'exam' ? ' is-exam' : '') +
        (ci === days - 1 ? ' is-last' : '');
      el.style.gridRow = rowOf(m.p, breaks);
      el.style.gridColumn = (ci + 1);
      el.style.setProperty('--f', m.f.toFixed(4));
      el.style.setProperty('--k', String(Math.min(m.n, 4)));
      el.dataset.p = String(m.p);
      el.dataset.kind = m.kind;
      // 🔴 用 `data-date` 不用 `data-day`：`.g-cell` 上的 `data-day` 是**星期序号**
      //    （0~6，长按加课要用），两个同名字段一个放日期一个放序号，
      //    以后谁写选择器都会踩坑。
      el.dataset.date = ymd(date);
      el.innerHTML = '<i class="tk"></i><span class="hit"></span>';
      // 🔴 触摸阶段就要拦下来：`.g-due` 只有 0 高，外面套着翻周手势的宿主
      //    （`#schScroll` 的 touchstart/touchend 会重摆轨道）和格子的长按加课。
      //    只在 click 上 stopPropagation 是不够的 —— 手指按下的那一刻，
      //    轨道已经被别人接走了，用户看到的是「点了没反应」。
      el.addEventListener('touchstart', (ev) => { ev.stopPropagation(); }, { passive: true });
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openDaySheet(date);
      });
      frag.appendChild(el);
    });
  }

  grid.appendChild(frag);
  bindCellPress(grid, week);
  return grid;
}

/* ---------------- 日视图 ----------------
 * 和周视图同一套做法：前后各画一天并排塞进轨道，翻天才不会先白一下。
 */
function renderDay() {
  const date = CFG.cursor ? parseYmd(CFG.cursor) : today0();
  const week = weekOf(date);
  const dayIdx = (date.getDay() + 6) % 7;
  const total = totalWeeks();

  $('wkNum').textContent = '周' + DAY_CN[dayIdx] + ' ' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
  $('wkRange').textContent = (week < 1 || week > total)
    ? (week < 1 ? '还没开学' : '学期已结束')
    : '第 ' + week + ' 周';
  $('wkToday').classList.toggle('is-here', ymd(date) === ymd(today0()));

  const track = $('dayView');
  track.innerHTML = '';
  [addDays(date, -1), date, addDays(date, 1)].forEach((d, i) => {
    const p = buildDayPage(d);
    if (i === 1) p.id = 'dayCur';
    track.appendChild(p);
  });
  centerTrack(track);
  renderDayNext(date);
}

/** 「现在这节 / 下一节」那条提示。
 *
 *  纯本地推算：课表、上课时间、当前时间都是现成的，不打服务器。
 *
 *  🔴 只在**看今天**的时候出现。翻到明天还写「下一节 14:00」，
 *     用户会以为那是在说现在 —— 这比不显示更糟。
 *
 *  两个刻意的克制：
 *    · 下一节在 3 小时以外就不显示（早上八点弹一条「还有 9 小时」没意义）
 *    · 今天课上完了就说「上完了」，别显示成「下一节」后面跟个负数
 */
function renderDayNext(date) {
  const el = $('dayNext');
  const isToday = ymd(date) === ymd(today0());
  const isDayView = CFG.view !== 'week';
  if (!isToday || !isDayView || !allCourses().length) { el.hidden = true; return; }

  const week = weekOf(date);
  if (week < 1) { el.hidden = true; return; }

  const occ = occupancy(week);
  const dayIdx = (date.getDay() + 6) % 7;
  const tt = times();
  const units = curTT().unitCount || 10;
  const nowMin = nowMinute();
  const toMin = hhmmToMin;

  let cur = null, next = null;
  for (let p = 0; p < units; p++) {
    const here = occ[dayIdx + ':' + p];
    if (!here || !here.length) continue;
    const s = toMin(tt[p] && tt[p][0]);
    const e = toMin(tt[p] && tt[p][1]);
    if (s === null || e === null) continue;        // 时间没配就别瞎算
    if (nowMin >= s && nowMin <= e) { cur = { p: p, courses: here, s: s, e: e }; break; }
    if (s > nowMin && !next) { next = { p: p, courses: here, s: s, e: e }; break; }
  }

  const hhmm = (m) => pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  const main = (c) => c.courses[0];
  const where = (c) => roomFull(main(c).room) || '教室没写';

  if (cur) {
    const left = cur.e - nowMin;
    el.className = 'daynext live';
    el.innerHTML = '<span class="dn-tag">正在上</span>' +
      '<span class="dn-main"><b>' + esc(main(cur).name) + '</b>' +
      '<em>' + esc(where(cur)) + ' · ' + hhmm(cur.s) + '–' + hhmm(cur.e) + '</em></span>' +
      '<span class="dn-side">还有 ' + left + ' 分钟</span>';
    el.hidden = false;
    return;
  }
  if (next && next.s - nowMin <= 180) {
    const left = next.s - nowMin;
    el.className = 'daynext';
    el.innerHTML = '<span class="dn-tag">下一节</span>' +
      '<span class="dn-main"><b>' + esc(main(next).name) + '</b>' +
      '<em>' + esc(where(next)) + ' · ' + hhmm(next.s) + '–' + hhmm(next.e) + '</em></span>' +
      '<span class="dn-side">' + (left <= 0 ? '马上' : '还有 ' + left + ' 分钟') + '</span>';
    el.hidden = false;
    return;
  }
  // 今天有课但都上完了 —— 说清楚，别让人盯着空白猜
  const hasAny = Object.keys(occ).some((k) => k.indexOf(dayIdx + ':') === 0);
  if (hasAny && !next) {
    el.className = 'daynext done';
    el.innerHTML = '<span class="dn-tag">今天</span>' +
      '<span class="dn-main"><b>课上完了</b><em>明天见</em></span>';
    el.hidden = false;
    return;
  }
  el.hidden = true;
}

// 每分钟刷一次「还有几分钟」。只在页面可见时算 ——
// 后台还每秒算一遍纯属耗电，而手机最在意这个。
setInterval(() => {
  if (document.hidden) return;
  if (CFG.view === 'week') return;
  if (!allCourses().length) return;
  const date = CFG.cursor ? parseYmd(CFG.cursor) : today0();
  if (ymd(date) !== ymd(today0())) return;
  renderDayNext(date);
}, 60000);

/** 画某一天的整列卡片，返回还没插进文档的 `.dayview` 元素。 */
function buildDayPage(date) {
  const week = weekOf(date);
  const total = totalWeeks();
  const dayIdx = (date.getDay() + 6) % 7;
  const occ = week >= 1 ? occupancy(week) : {};
  const units = (curTT().unitCount || 10);
  const tt = times();

  const list = [];
  for (let p = 0; p < units; p++) {
    const here = occ[dayIdx + ':' + p];
    if (here && here.length) list.push({ p, courses: here });
  }

  const box = document.createElement('div');
  box.className = 'dayview';

  // 这一天「有事」的清单（作业截止 + 考试）。周视图只有一颗刻度、一条带子，
  // 明细放在这里 —— 日视图是唯一有地方写「几点、哪一条」的地方，而且它本来
  // 就是「今天怎么过」。🔴 和周视图点开的那张明细用**同一份** dayAgenda：
  // 两处各算一次，迟早有一天对不上。
  const agenda = dayAgenda(date);
  const dueHtml = agenda.length
    ? '<div class="dv-due">' + agenda.slice(0, 3).map((r) =>
        '<div class="dv-due-i' + (r.kind === 'exam' ? ' is-exam' : '') + '">' +
        '<b>' + esc(r.start) + '</b>' +
        '<span>' + (r.kind === 'exam' ? '<i class="dv-k">考</i>' : '') +
          esc(r.title) + '</span></div>'
      ).join('') +
      // 「另 N 条」不能挂在 `.dv-due-i` 里：那一行左边是 44px 的时刻列，
      // 写进去会被读成「另一个时间」。单独一行、右对齐、带一个 ›。
      (agenda.length > 3
        ? '<div class="dv-due-more">还有 ' + (agenda.length - 3) + ' 条 ›</div>' : '') +
      '</div>'
    : '';

  if (!list.length) {
    box.innerHTML = '<div class="empty" style="padding-top:48px">' +
      '<div class="empty-ico"><svg viewBox="0 0 24 24"><path d="M20 12.5A8 8 0 1 1 11.5 4"/><path d="M12 8v4.5l3 1.8"/></svg></div>' +
      '<h2>' + (week < 1 ? '还没开学' : (week > total ? '学期已结束' : '这天没课')) + '</h2>' +
      '<p>' + (week < 1 ? '开学日期设成 ' + ymd(startDate()) + '，可以在「我的」里改' : '') + '</p></div>' +
      dueHtml;
    bindAgenda(box, date);
    return box;
  }

  // 连续同课合并
  const merged = [];
  list.forEach((it) => {
    const last = merged[merged.length - 1];
    const sig = it.courses.map((c) => c.name + '@' + c.room).sort().join('|');
    if (last && last.p + last.len === it.p && last.sig === sig) { last.len++; return; }
    merged.push({ p: it.p, len: 1, sig, courses: it.courses });
  });

  const nowMin = nowMinute();
  const isToday = ymd(date) === ymd(today0());

  box.innerHTML = merged.map((m) => {
    const startT = tt[m.p][0] || '';
    const endT = tt[m.p + m.len - 1][1] || '';
    const periods = [];
    for (let i = 0; i < m.len; i++) periods.push(m.p + i);
    // 跟周视图同一套判据（`liveAt`），两处别各写一份 ——
    // 一份用 split(':')、一份用正则，遇到空串就会一边亮一边不亮。
    const live = isToday && liveAt(tt, m.p, m.p + m.len, nowMin);
    const main = m.courses[0];
    const extra = m.courses.slice(1);
    // 日视图有地方写字，所以除了虚线还挂一个「自加」小标签 ——
    // 周视图只能靠虚线（格子太窄），这里不用将就。
    const mine = m.courses.some(isMyCourse);
    return '<div class="dv-item">' +
      '<div class="dv-time"><b>' + (startT || '—') + '</b><i>' + (endT || '') + '</i></div>' +
      '<div class="dv-card' + (mine ? ' is-mine' : '') +
        (live ? ' live' : '') + '" style="' + colorVars(colorHue(main.name)) + '">' +
        '<div class="dv-head"><span class="dv-name">' + esc(main.name) + '</span>' +
          '<span class="dv-period">' + periodsText(periods) + '</span>' +
          (mine ? '<span class="dv-tag">自加</span>' : '') + '</div>' +
        '<div class="dv-meta">' + esc(roomFull(main.room)) +
          (main.teacher ? ' · ' + esc(main.teacher) : '') + '</div>' +
        (extra.length ? '<div class="dv-meta">另：' + extra.map((c) => esc(c.name)).join('、') + '</div>' : '') +
      '</div></div>';
  }).join('') + dueHtml;

  box.querySelectorAll('.dv-card').forEach((el, i) => {
    el.addEventListener('click', () => {
      const m = merged[i];
      openCourseSheet(m.courses, dayIdx, m.p, m.len, week);
    });
  });
  bindAgenda(box, date);
  return box;
}

/** 日视图底下那串「几点 · 什么」点一下也和课表上的刻度一样弹明细。 */
function bindAgenda(box, date) {
  const el = box.querySelector('.dv-due');
  if (el) el.addEventListener('click', () => openDaySheet(date));
}

/* ---------------- 课程详情 ---------------- */
function openCourseSheet(courses, day, period, span, week) {
  const tt = times();
  const periods = [];
  for (let i = 0; i < span; i++) periods.push(period + i);
  const t1 = tt[period] && tt[period][0];
  const t2 = tt[period + span - 1] && tt[period + span - 1][1];

  $('sheetBody').innerHTML = courses.map((c) => {
    const w = c.weeks || [];
    const odd = w.length > 1 && w.every((x) => x % 2 === 1);
    const even = w.length > 1 && w.every((x) => x % 2 === 0);
    const mine = isMyCourse(c);
    // ---- 调色（0.51.0：光谱；0.52.0：加一排色卡）----
    // 用户 2026-11-09：「光谱好像不太全，比如我没法调成紫色」。
    // 原因不是色相不够，是**滑条太窄**：360 度铺在两百来个像素上，
    // 一个像素跨 1.8 度，手指落点差半毫米就跳过去二十度 —— 紫色那一段
    // 只有四十来度宽，实际根本停不住。所以上面加一排色卡：想选哪个直接点，
    // 滑条留着微调。两条路都落同一个 `CFG.cColors`。
    const cname = String(c.name || '');
    const curHue = colorHue(cname);
    const hasOv = typeof (CFG.cColors || {})[cname] === 'number';
    const colorRow = '<div class="sh-color"><span class="k">颜色</span>' +
      '<div class="ccwrap">' +
        '<div class="ccchips">' + HUE_PRESET.map((p) =>
          '<button type="button" class="ccchip' + (curHue === p.h ? ' on' : '') +
          '" data-h="' + p.h + '" data-cname="' + esc(cname) +
          '" style="' + colorVars(p.h) + '" aria-label="' + p.n + '"></button>').join('') +
        '</div>' +
        '<div class="ccrow">' +
          '<span class="ccprev" id="ccPrev" style="' + colorVars(curHue) + '"></span>' +
          '<input class="ccrange" id="ccHue" type="range" min="0" max="359" step="1"' +
            ' value="' + curHue + '" data-cname="' + esc(cname) +
            '" aria-label="拖动微调颜色">' +
          '<button class="ccauto' + (hasOv ? '' : ' on') + '" data-cname="' + esc(cname) +
            '" data-cslot="">自动</button>' +
        '</div>' +
      '</div></div>';
    // 🔴 0.46.0：自己加的课没有「隐藏」这回事 —— 不想要了直接删。
    //    给它一颗「隐藏」，用户还得再去「我的」里找回一门自己刚加的课，
    //    绕一圈。教务给的课才用隐藏：删不掉（下次同步还会回来），只能藏。
    const acts = mine
      ? '<div class="sh-hides">' +
          '<button class="sh-hide" data-edit="' + esc(c.code || '') + '">修改</button>' +
          '<button class="sh-hide" data-del="' + esc(c.code || '') + '">删掉</button>' +
        '</div>'
      : '<div class="sh-hides">' +
          '<button class="sh-hide" data-code="' + esc(c.code || '') + '">隐藏这门课</button>' +
          '<button class="sh-hide" data-slot="1" data-code="' + esc(c.code || '') +
            '" data-day="' + day + '" data-p0="' + period + '" data-span="' + span + '">只隐藏这一节</button>' +
        '</div>';
    return '<div class="sh-block">' +
      '<div class="sh-title">' + esc(c.name) +
        (mine ? '<span class="sh-own">自己加的</span>' : '') + '</div>' +
      '<div class="sh-sub">' + esc(mine ? '只在这台' + envText('电脑', '手机') + '上' : (c.code || '')) + '</div>' +
      '<div class="sh-rows">' +
        '<div class="sh-row"><span class="k">教师</span><span class="v">' + esc(c.teacher || '—') + '</span></div>' +
        '<div class="sh-row"><span class="k">教室</span><span class="v">' + esc(c.room || '—') + '</span></div>' +
        '<div class="sh-row"><span class="k">时间</span><span class="v">星期' + DAY_CN[day] + ' ' +
          periodsText(periods) + (t1 ? '（' + t1 + ' - ' + (t2 || '') + '）' : '') + '</span></div>' +
        '<div class="sh-row"><span class="k">周次</span><span class="v">' + weeksText(w) +
          (odd ? '（单周）' : (even ? '（双周）' : '')) + '</span></div>' +
      '</div>' + colorRow + acts +
      '</div>';
  }).join('');
  $('sheetMask').hidden = false;

  // 调色：拖的时候只动本地色样（浮层挡着课表，重画课表纯属浪费），
  // 松手才落盘 + 就地重画浮层。点「自动」立刻恢复。
  $('sheetBody').querySelectorAll('.ccrange').forEach((inp) => {
    const box = inp.closest('.sh-color');
    const prev = box && box.querySelector('.ccprev');
    inp.addEventListener('input', () => {
      paintHue(prev, inp.value);
    });
    inp.addEventListener('change', () => {
      setCourseColor(inp.dataset.cname || '', Number(inp.value));
      openCourseSheet(courses, day, period, span, week);
    });
    inp.addEventListener('click', (ev) => ev.stopPropagation());
  });
  $('sheetBody').querySelectorAll('.ccauto').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setCourseColor(btn.dataset.cname || '', null);
      openCourseSheet(courses, day, period, span, week);
    });
  });
  // 色卡：点一下就定这个色相（不是「再确认」）。落盘后整张浮层重画，
  // 选中那圈圈才会跟着走 —— 只改本地的话，用户看不出自己点中了没有。
  $('sheetBody').querySelectorAll('.ccchip').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setCourseColor(btn.dataset.cname || '', Number(btn.dataset.h));
      openCourseSheet(courses, day, period, span, week);
    });
  });

  $('sheetBody').querySelectorAll('.sh-hide').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code || '';
      // ⚠️ 「修改 / 删掉」这两颗按钮上挂的是 data-edit / data-del，
      //    **没有 data-code** —— 拿 code 去调会拿到空串，
      //    于是 find 找不到、函数直接 return，表现是「点了没反应」而且不报错。
      if (btn.dataset.del) { confirmDelMyCourse(btn.dataset.del); return; }
      if (btn.dataset.edit) { openMyCourseForm(btn.dataset.edit); return; }
      if (!code) return;
      // 「只隐藏这一节」：这一格覆盖的每一节都记下来。跨两节的连堂课有两条
      // slot，只记第一条的话第二格还留着半截（见 setSlotsHidden 的注释）。
      if (btn.dataset.slot) {
        const day = Number(btn.dataset.day);
        const p0 = Number(btn.dataset.p0);
        const span = Math.max(1, Number(btn.dataset.span) || 1);
        const ps = [];
        for (let i = 0; i < span; i++) ps.push(p0 + i);
        setSlotsHidden(code, day, ps, true);
        $('sheetMask').hidden = true;
        // 0.51.0：藏掉的这一节不是「消失了」，是**挪进待安排**了 ——
        // 文案必须这么说，否则用户以为课被删了，下次还得重新加一遍。
        toast('已放入待安排，可在「我的 · 课程调整」排时间');
        return;
      }
      setHidden(code, true);
      $('sheetMask').hidden = true;
      toast('已隐藏，可在「我的」里恢复');
    });
  });
}

/* ---------------- 这一天的明细（课表上点刻度 / 考试带子进来） ----------------
 *
 *  用户 2026-11-12：「把未完成作业截止线也标在课表的对应位置……
 *  点击后查看具体作业之类的」，以及「考试时间也加进去，包括学习通和学校的」。
 *
 *  课表上只有一个刻度、一条带子（一寸地方都没有），明细全在这里。
 *  作业那部分来自本机那份截止缓存 —— **不联网**，没网也点得开；
 *  学校考试那部分来自已经落盘的考试安排，同样不联网。
 *
 *  🔴 标题不许写死「今天」：这条明细是**点哪一天看哪一天**的，翻到下周点开
 *     还写「今天要交」，那句就是假话。今天以外一律用「这天」。
 *  🔴 标题也不许写「今天的作业」：截缓存里只有「未交 / 未开始 / 待互评」
 *     （见 dueCacheSave），写「作业」等于替平台承诺了一个它没承诺的范围。
 *  🔴 条数不写「共 N 条」：缓存上限 60 条、且只留还没过期的，给出的永远是
 *     下界。写「共」等于替平台承诺了一个它没承诺的数。
 */
function openDaySheet(date) {
  const rows = dayAgenda(date);
  // 有一颗刻度却一条数据都取不出来 —— 说明截止缓存和考试数据对不上了。
  // 静默 return 会变成「点了没反应」（用户 2026-11-16 报的正是这个）；说一句更好。
  if (!rows.length) { toast('这天没有要交的，也没有考试'); return; }
  const today = ymd(date) === ymd(today0());
  const word = today ? '今天' : '这天';
  const hasExam = rows.some((r) => r.kind === 'exam');
  const hasWork = rows.some((r) => r.kind !== 'exam');
  // 两样都有时不挑一边说（写了「要交」就把考试藏了），只留「今天」两个字，
  // 具体是什么在每一行上写着。
  const title = (hasExam && hasWork) ? word
    : (hasExam ? word + '有考试' : word + '要交');

  $('sheetBody').innerHTML =
    '<div class="sh-block due-block">' +
      '<div class="sh-title">' + esc(title) + '</div>' +
      '<div class="sh-sub">' + mdSlash(date) + ' · 星期' + DAY_CN[(date.getDay() + 6) % 7] +
        (hasWork ? '，作业到点前都可以交' : '，以教务系统为准') + '</div>' +
      rows.map((r, i) => (
        // 🔴 每一行自己可以点（2026-11-14「点开后可以看详情」）。
        //    data-i 指回 rows，不在 DOM 里塞整条数据 —— 标题里可能有引号。
        '<div class="due-row is-tap' + (r.kind === 'exam' ? ' is-exam' : '') +
          '" data-i="' + i + '">' +
          '<span class="due-t"><b>' + esc(r.start) + '</b>' +
            '<i>' + esc(r.endLab) + '</i></span>' +
          '<span class="due-b">' +
            '<span class="due-n">' + esc(r.title) + '</span>' +
            '<span class="due-s">' + esc(r.sub) + '</span>' +
          '</span>' +
          '<span class="due-more">›</span>' +
        '</div>'
      )).join('') +
      '<button class="due-go" id="dueGo">去「学习」里看</button>' +
    '</div>';
  $('sheetMask').hidden = false;
  // 点某一条 → 这一条的详情（学习通的还给跳转）。
  $('sheetBody').querySelectorAll('.due-row.is-tap').forEach((el) => {
    el.addEventListener('click', () => {
      const r = rows[Number(el.dataset.i)];
      if (r) openDueItem(r, date);
    });
  });
  const go = $('dueGo');
  if (go) {
    go.addEventListener('click', () => {
      closeSheet();
      // 落到学习通那一格：作业本来就长在那儿。不这么设的话，用户上次停在
      // 「成绩」，点「去学习里看」看到的是成绩单 —— 那句话就变成了谎话。
      CFG.examView = 'cx';
      switchTab('exams');
    });
  }
}

/* ---------------- 单条作业 / 考试的详情（0.52.3 加） ----------------
 *
 *  用户 2026-11-14：「显示在课表上的作业和考试，点开后可以看详情」。
 *
 *  课表上点刻度/带子进的是**那一天**的清单（openDaySheet），里面每一条再点
 *  就是这里。
 *
 *  🔴 0.52.3 v6（用户 2026-11-14 第二次提）：「不要再显示二级界面，那个界面
 *     显示的全是重复的信息，直接打开学习通对应作业链接就行」。
 *     对 —— 那一屏的「时间 / 剩余 / 课程 / 来源」四行，用户刚刚在清单里
 *     逐条看过，再确认一次等于让他多点一下才能开始做作业。所以：
 *       有地址（学习通的作业/考试）→ **直接开**，一层都不多。
 *       没地址（教务排的考试）→ 才落到这屏，因为它唯一要说的「考场 / 座位」
 *       在清单那一寸地方写不下。
 *  🔴 地址用的是**条目自己的**（dueCacheSave 的 `u`，带 courseId/classId/
 *     activeId）。不许拿课程首页或作业列表页顶替 —— 那种链接点进去还要
 *     自己找是哪一条，和「方便快速找到」正好相反。
 */
function dueFullWhen(sec) {
  const d = new Date(sec * 1000);
  const mon = d.getMonth() + 1;
  return mon + '/' + d.getDate() + ' 周' + DAY_CN[(d.getDay() + 6) % 7] +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function openDueItem(r, date) {
  if (!r) return;
  // 有地址 = 这一条在学习通里真有落点 ⇒ 一步到位，不再插一层详情。
  // 关掉清单再开网页：不关的话回来时那张清单还盖在上面，用户会以为没跳成功。
  if (r.url) {
    const nm = r.kind === 'exam' ? '学习通 · 考试' : '学习通 · 作业';
    if (openApp(r.url, nm)) { closeSheet(); return; }
    toast('打不开这个链接，换「打开学习通」再找一次');
    return;
  }
  const isExam = r.kind === 'exam';
  const srcWord = r.src === 'school' ? '教务系统' : '学习通';
  const when = (r.at && r.at > 0)
    ? dueFullWhen(r.at)
    : ((date ? mdSlash(date) : '') + (r.when ? ' ' + r.when : '')).trim();
  const left = (r.at && r.at > 0)
    ? cxLeftShort(r.at * 1000 - Date.now()) + '后截止' : '';

  const rows = [];
  if (when) rows.push(['时间', when + (isExam && r.at ? ' 截止' : '')]);
  if (left) rows.push(['剩余', left]);
  if (r.course) rows.push(['课程', r.course]);
  // 🔴 作业那条的 `sub` 就是「课程 · 作业」，和上面两行完全重复 ——
  //    删掉重复，不是删信息（极简那条规矩）。考试那条的 sub 是考场/座位/形式，
  //    必须留着，那是这一屏里唯一写着「去哪儿考」的地方。
  const subDup = !isExam && r.sub === (r.course ? (r.course + ' · 作业') : '作业');
  if (r.sub && !subDup) rows.push([isExam ? '安排' : '科目', r.sub]);
  rows.push(['来源', srcWord + (isExam ? ' · 考试' : ' · 作业')]);

  $('sheetBody').innerHTML =
    '<div class="sh-title">' + esc(r.title || (isExam ? '一场考试' : '一条作业')) + '</div>' +
    '<div class="sh-sub">' + esc(isExam ? '考试安排' : '作业截止') + '</div>' +
    '<div class="dd-list">' + rows.map((x) =>
      '<div class="dd-r"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'
    ).join('') + '</div>' +
    '<button class="due-go" id="dueGo2">去「学习」里看</button>';
  $('sheetMask').hidden = false;

  const g2 = $('dueGo2');
  if (g2) {
    g2.addEventListener('click', () => {
      closeSheet();
      CFG.examView = 'cx';
      switchTab('exams');
    });
  }
}

/* ---------------- 确认框（自绘，不用 window.confirm） ----------------
 *
 * 🔴 为什么不用 confirm()：
 *    WebView 里的 confirm() 要靠 WebChromeClient.onJsConfirm() 才会弹框。
 *    MainActivity 只 setWebViewClient，没设 WebChromeClient ⇒ confirm()
 *    **连框都不弹，直接返回 false** ⇒ 按钮点了毫无反应。
 *    2026-10-19 用户报「清除本机缓存和解除绑定之类的按钮形同虚设」就是这个。
 *
 * ⚠️ 也别「网页版用 confirm、APK 用自绘」—— 两套行为不一致的话，
 *    在浏览器里测着好好的，装到手机上才发现是死的。统一走这里。
 */
let askResolve = null;   // 正在等回答的那个 Promise 的 resolve

/** 弹一个两按钮的确认框，返回 Promise<boolean>。
 *
 *  `danger` 默认 true —— 原来四个调用点（断开门户 / 断开学习通 / 解除绑定 /
 *  清除缓存）全是「删掉点什么」，红色是对的。直饮水的「开始接水」不是删除，
 *  红色会让人以为要删东西，所以那里传 false 走主按钮色。
 *  ⚠️ 默认值必须是 true：漏传的那个调用点会从红变蓝，而且**不报错**。
 */
function askConfirm(title, sub, okText, danger) {
  const cls = (danger === false) ? 'primary' : 'danger';
  return new Promise((resolve) => {
    // 上一张还没答就又来一张：先把旧的按「取消」结掉。
    // 不结的话那个 Promise 永远悬着，对应的 await 之后再也走不下去。
    if (askResolve) { const old = askResolve; askResolve = null; old(false); }
    askResolve = resolve;
    $('sheetBody').innerHTML =
      '<div class="sh-title">' + esc(title) + '</div>' +
      '<div class="sh-sub">' + esc(sub) + '</div>' +
      '<div class="sheetbtns">' +
        '<button class="btn" id="askNo">取消</button>' +
        '<button class="btn ' + cls + '" id="askYes">' + esc(okText) + '</button>' +
      '</div>';
    $('sheetMask').hidden = false;
    $('askNo').addEventListener('click', () => askDone(false));
    $('askYes').addEventListener('click', () => askDone(true));
  });
}

/** 收尾：关框 + 回答。只能答一次，重复调用是空操作。 */
function askDone(v) {
  if (!askResolve) return false;
  const r = askResolve;
  askResolve = null;
  $('sheetMask').hidden = true;
  r(v);
  return true;
}

/** 关掉底部弹层。**唯一的正确关法** —— 遮罩点击、返回键、右上角 ✕ 全走这里。
 *
 *  🔴 只把 `#sheetMask` 藏掉是不行的：openPick / openInput / askConfirm
 *     各挂着一个 Promise，不 resolve 就永远悬着，下次点同一个按钮
 *     「没反应」而且**不报错**（0.37.0 踩过一次，0.38.0 把它收成一个函数）。
 *  🔴 0.38.0：原来只有「点遮罩」和「按返回键」两条路能出去。用户 2026-11-01：
 *     「很多界面进入后没有返回按钮，会导致用户不知所措」——
 *     ⇒ 弹层外壳上固定一颗 ✕，**不用每个调用方各自记得加取消按钮**。
 */
function closeSheet() {
  if (askDone(false)) return true;
  if (pickDone(null)) return true;
  if (inputDone(null)) return true;
  // 碰一碰（0.52.0 v7）：弹层被关掉（✕ / 点遮罩 / 返回键 / 自己收）时，
  // 读卡模式也得跟着关。不关的话它会一直挂到 30 秒超时 —— 这段时间里
  // 用户贴支付宝那一下会被我们接走，而他不知道为什么没反应。
  if (wtNfcOpenFlag) {
    wtNfcOpenFlag = false;
    const api = (typeof nfcApi === 'function') ? nfcApi() : null;
    if (api) api.stop('');
  }
  $('sheetMask').hidden = true;
  return true;
}

$('sheetMask').addEventListener('click', (e) => {
  if (e.target !== $('sheetMask')) return;
  // 点外面 = 取消。必须走 closeSheet，别在这里再写一遍三条 done()。
  closeSheet();
});
$('sheetX').addEventListener('click', closeSheet);

/* ---------------- 单选弹层（替代原生 <select>） ----------------
 *
 * 为什么不用 <select>：安卓 WebView 里点开是**系统那个「一列单选框」的对话框**
 * （白底、系统字体、圆点靠右），跟应用里其他所有弹层都不是一个世界 ——
 * 用户 2026-10-19 截了图说「跟老安卓页面似的」。
 *
 * 这里用应用自己的底部弹层：同一个 .sheet 容器、同一套配色和深色主题、
 * 返回键和点遮罩的行为也跟别处一致。
 *
 * 返回 Promise：
 *   resolve(选项 id)  选中了（**空串是合法的「不限」**）
 *   resolve(null)     取消了（点遮罩 / 按返回键）
 * 🔴 取消必须 resolve，不能只是把框藏掉 —— 否则 await 永远不回来。
 */
let pickResolve = null;

function openPick(title, sub, groups, cur) {
  return new Promise((resolve) => {
    // 上一个还没选就又来一个：先按「取消」结掉，别留下悬着的 Promise
    if (pickResolve) { const old = pickResolve; pickResolve = null; old(null); }
    pickResolve = resolve;
    let html = '<div class="sh-title">' + esc(title) + '</div>' +
      (sub ? '<div class="sh-sub">' + esc(sub) + '</div>' : '<div class="pickgap"></div>') +
      '<div class="picklist">';
    groups.forEach((g) => {
      if (!g || !g.items || !g.items.length) return;
      if (g.title) html += '<div class="pickhead">' + esc(g.title) + '</div>';
      g.items.forEach((it) => {
        const id = it.id == null ? '' : String(it.id);
        html += '<button class="pickopt' + (id === String(cur || '') ? ' on' : '') +
          (it.danger ? ' danger' : '') +
          '" data-id="' + esc(id) + '">' +
          '<span class="t">' + esc(it.name) + '</span>' +
          '<svg class="ck" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>' +
          '</button>';
      });
    });
    html += '</div>' +
      // 🔴 0.38.0：原来这个弹层**只有点遮罩才能关**，没有取消按钮。
      //    用户 2026-11-01：「很多界面进入后没有返回按钮，会导致用户不知所措」——
      //    「点外面关掉」是知道的人才知道的规矩，不知道的人只能按返回键试。
      //    凡是能进来的地方，都得给一颗写得出来的出口。
      '<div class="sheetbtns"><button class="btn" id="pickNo">取消</button></div>';
    $('sheetBody').innerHTML = html;
    $('sheetMask').hidden = false;
    $('sheetBody').querySelectorAll('.pickopt').forEach((b) => {
      b.addEventListener('click', () => pickDone(b.dataset.id));
    });
    const no = $('pickNo');
    if (no) no.addEventListener('click', () => pickDone(null));
  });
}

/** 收尾：关框 + 交回结果。只能交一次，重复调用是空操作。 */
function pickDone(id) {
  if (!pickResolve) return false;
  const r = pickResolve;
  pickResolve = null;
  $('sheetMask').hidden = true;
  r(id);
  return true;
}

/* ---------------- 文本输入弹层（0.28.1） ----------------
 *
 * 只有「添加饮水机」一处用得上：把二维码里的内容粘进来。
 *
 * 🔴 为什么不用 window.prompt()：跟 confirm() 同一个原因 ——
 *    WebView 里要靠 WebChromeClient.onJsPrompt() 才会弹，而 MainActivity
 *    只 setWebViewClient ⇒ prompt() **连框都不弹，直接返回 null**，
 *    按钮点了毫无反应。同一个坑别踩第二遍（见上面 askConfirm 的注释）。
 *
 * 返回 Promise：
 *   resolve(字符串)  点了确定（**空串是合法的**，交给调用方判）
 *   resolve(null)    取消了（点遮罩 / 按返回键 / 点取消）
 * ⚠️ 取消必须 resolve，不能只把框藏掉 —— 否则 await 永远不回来。
 */
let inputResolve = null;

function openInput(title, sub, placeholder, okText, value) {
  return new Promise((resolve) => {
    if (inputResolve) { const old = inputResolve; inputResolve = null; old(null); }
    inputResolve = resolve;
    $('sheetBody').innerHTML =
      '<div class="sh-title">' + esc(title) + '</div>' +
      (sub ? '<div class="sh-sub">' + esc(sub) + '</div>' : '') +
      '<input class="sheetinput" id="inputVal" type="text" inputmode="text"' +
      ' autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"' +
      ' placeholder="' + escAttr(placeholder || '') + '">' +
      '<div class="sheetbtns">' +
        '<button class="btn" id="inputNo">取消</button>' +
        '<button class="btn primary" id="inputYes">' + esc(okText || '确定') + '</button>' +
      '</div>';
    $('sheetMask').hidden = false;
    const el = $('inputVal');
    // 0.37.0：可选预填。改名时要把现在的名字放进去 —— 让用户在一个空框里
    // 重敲一遍自己的名字，是纯粹的刁难。
    if (value != null && value !== '') el.value = String(value);
    // 弹层刚显示时立刻 focus，部分安卓机不弹软键盘（元素还在 hidden 的祖先里）。
    // 等一帧再 focus，键盘才稳。
    setTimeout(() => { try { el.focus(); } catch (e) { /* 没有键盘的设备（模拟器）*/ } }, 60);
    $('inputNo').addEventListener('click', () => inputDone(null));
    $('inputYes').addEventListener('click', () => inputDone(el.value));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') inputDone(el.value); });
  });
}

/** 收尾：关框 + 交回内容。只能交一次，重复调用是空操作。 */
function inputDone(v) {
  if (!inputResolve) return false;
  const r = inputResolve;
  inputResolve = null;
  $('sheetMask').hidden = true;
  r(v);
  return true;
}

/* ---------------- 学期切换（课表） ----------------
 *
 * 用户 2026-10-31 的原话：「你这怎么切换不了学期」「给我自己绑定的大二学年」
 *   「又更新了一下 变到大二下了」。
 * 之前课表只认教务系统**此刻**认定的那个学期 —— 学校一换，整张表跟着变，
 * 想回头看上学期的课只能等学校自己切回来。
 * 教务的课表表单里本来就有 `semester.id`（以前恒传空串 = 当前学期），
 * 传上学期的 id 就能把那学期的课表取回来，**同一个接口，不用另找页面**。
 *
 * 入口放在「跳到第几周」那个弹层的顶上：这两件事都是「我要看别处的课表」。
 * 顶栏已经挤了 6 个控件（翻周 / 标题 / 今天 / 空教室 / 周·日），
 * 再挂一个按钮，会把「第 8 周 10.19–10.25」那串字直接挤没。
 */

/** 当前学期的 id（同步时教务给的那个，考试页也在用同一个）。取不到返回空串。 */
const nowTermId = () => String((DATA && DATA.exams && DATA.exams.semesterId) || '');

/** 切到某一学期的课表。`sid` 为空 = 回到当前学期（不用联网，DATA 里就有）。
 *
 *  三种「不用真的去取」的情况分开处理，别让用户白等一次网络：
 *    · 点的就是正在看的那学期
 *    · 已经是当前学期、又点了当前学期
 *    · 上一次还在取
 */
async function switchTerm(sid) {
  sid = String(sid || '');
  if (ttLoading) return;
  if (sid && TT && sid === TT.id) { $('sheetMask').hidden = true; return; }
  if (!sid && ttIsNow()) { $('sheetMask').hidden = true; return; }

  if (!sid) {
    // 回到当前学期：TT 一置空，tt() 就退回 DATA 那份，不用再打学校服务器。
    TT = null;
    CFG.week = currentWeek();
    CFG.cursor = CFG.view === 'day' ? ymd(dayAnchor()) : '';
    store.set(KEY.settings, CFG);
    $('sheetMask').hidden = true;
    renderSchedule();
    toast('已回到当前学期');
    return;
  }

  const t = studyTerms().find((x) => x.id === sid);
  ttLoading = true;
  toast('正在取' + (t ? t.label : '这一学期') + '的课表…', 8000);
  let r;
  try {
    r = await api('/api/timetable', {
      semesterId: sid, semesterName: (t && t.name) || '',
    });
  } catch (e) {
    r = { ok: false, error: '连不上服务，稍后再试' };
  }
  ttLoading = false;
  if (!r || !r.ok) { toast((r && r.error) || '这一学期的课表没取到'); return; }

  // 🔴 空课表要**明说**「教务系统里没有」，不能说成「取失败」，
  //    更不能安静地切过去显示一张空表 —— 那会让人以为软件坏了。
  if (!r.courses || !r.courses.length) {
    toast('教务系统里' + (t ? t.label : '这一学期') + '没有课表');
    return;
  }

  TT = {
    id: sid,
    semester: r.semester || (t && t.name) || '',
    courses: r.courses,
    unitCount: r.unitCount || 10,
    totalWeeks: r.totalWeeks || 20,
  };
  // 换了一张表，周次必须从第 1 周重新开始 —— 上一张表停在第 15 周，
  // 新表如果只有 18 周，会直接落在一半的位置，看着像丢了前半学期。
  CFG.week = 1;
  CFG.cursor = '';
  store.set(KEY.settings, CFG);
  $('sheetMask').hidden = true;
  renderSchedule();
  $('schScroll').scrollTop = 0;
  toast('已切到' + (termShort(TT.semester) || '该学期'));
}

/* ---------------- 周次选择器 ---------------- */
$('wkTitle').addEventListener('click', () => {
  if (!DATA) return;
  const total = totalWeeks();
  const cur = CFG.view === 'day'
    ? (CFG.cursor ? weekOf(parseYmd(CFG.cursor)) : currentWeek())
    : (CFG.week || currentWeek());
  // 副标题写「大二上 · 共 24 周」。算不出年级才退回教务系统的学期原文。
  const sl = gradeLabel() || semesterName();
  let html = '';

  // 学期 chip（见上面 switchTerm 的说明）。只有**两个以上**学期时才摆出来：
  // 只有一个学期的账号，摆一排点了没变化的按钮，比不摆更让人困惑。
  const terms = studyTerms();
  if (terms.length > 1) {
    const nowId = nowTermId();
    html += '<div class="sh-title">学期</div><div class="sh-terms">';
    // 看历史学期时，最前面给一个「当前学期」—— 不用在列表里找自己那格。
    if (!ttIsNow()) html += '<button class="chip" data-sid="">当前学期</button>';
    html += terms.map((t) => {
      const on = TT ? t.id === TT.id : t.id === nowId;
      return '<button class="chip' + (on ? ' on' : '') + '" data-sid="' + esc(t.id) + '">' +
        esc(t.label) +
        (t.id === nowId ? '<i class="sh-now">在读</i>' : '') + '</button>';
    }).join('');
    html += '</div>';
  }

  html += '<div class="sh-title">跳到第几周</div>' +
    '<div class="sh-sub">' + (sl ? esc(sl) + ' · ' : '') +
    '共 ' + total + ' 周，点击直接跳转</div><div class="wkgrid">';
  for (let i = 1; i <= total; i++) {
    html += '<button class="wkcell' + (i === cur ? ' on' : '') + '" data-w="' + i + '">' + i + '</button>';
  }
  // 周数不对 / 开学日期不对，就在这儿给个入口 —— 用户翻周翻到一半发现
  // 「怎么只有 20 周」时，第一反应是找地方改，不会跑去「我的」翻设置。
  // 「看校历」也放这儿：顶栏已经 6 个控件，再加一个，「第 8 周 10.19-10.25」
  // 那串字就没地方写了。而点周次本来就是「我要看时间安排」，语义正好。
  //
  // ⚠️ 这两个入口都只对**当前学期**有意义（校历是当前学期的，学期设置改的
  //    也是它）。翻历史学期时藏起来 —— 否则点进去看到的是另一个学期的校历，
  //    改完还会把当前学期弄乱。
  html += '</div>';
  if (ttIsNow()) {
    // 「导出日历」和上面两颗是**同一层**的动作（都是「关于这张表的事」），
    // 所以并排放在一起，不另外开一个更深的入口。
    html += '<div class="sheetbtns wrap3">' +
      '<button class="btn" id="wkToCalendar">看校历</button>' +
      '<button class="btn" id="wkToSemester">学期设置</button>' +
      '<button class="btn" id="wkToIcs">导出日历</button></div>';
  }
  $('sheetBody').innerHTML = html;
  $('sheetMask').hidden = false;
  if (ttIsNow()) {
    $('wkToCalendar').addEventListener('click', () => {
      $('sheetMask').hidden = true;
      switchTab('calendar');
    });
    $('wkToSemester').addEventListener('click', openSemesterSheet);
    $('wkToIcs').addEventListener('click', () => {
      $('sheetMask').hidden = true;
      exportScheduleIcs();
    });
  }
  $('sheetBody').querySelectorAll('.sh-terms .chip').forEach((b) => {
    b.addEventListener('click', () => switchTerm(b.dataset.sid));
  });
  $('sheetBody').querySelectorAll('.wkcell').forEach((b) => {
    b.addEventListener('click', () => {
      const w = Number(b.dataset.w);
      $('sheetMask').hidden = true;
      if (CFG.view === 'day') {
        CFG.cursor = ymd(addDays(startDate(), (w - 1) * 7 + ((CFG.cursor ? (parseYmd(CFG.cursor).getDay() + 6) % 7 : 0))));
      } else {
        CFG.week = w;
      }
      store.set(KEY.settings, CFG);
      renderSchedule();
    });
  });
});

/* ---------------- 导航按钮 ---------------- */
$('wkPrev').addEventListener('click', () => step(-1));
$('wkNext').addEventListener('click', () => step(1));

/* ---------------- 左右滑动翻周 / 翻天 ----------------
 *
 * 参考了几个开源课表 App 的做法（晴课表 CourseSchedule、时光课程表、
 * 下节啥课），共同点是**跟手**：手指往左推，课表跟着往左走，松手才决定
 * 翻不翻。只判「滑了多远」不跟手，手感像在戳按钮，不像在翻页。
 *
 * 三个必须踩住的点：
 *  1. **不能抢纵向滚动** —— 课表纵向要滚 10 节课，横向才是翻周。
 *     所以先看前 8px 的位移方向，横向要明显压过纵向（1.4 倍）才接管。
 *  2. **到头要停** —— 第 1 周再往右拉只给 28% 位移（橡皮筋），松手弹回。
 *  3. **滑动后要吞掉那个 click** —— 否则松手时会顺带把手指底下的
 *     课程块点开，弹出详情面板，看着像误触。
 */
let swipeAt = 0;
/* 动画期间不接受新的滑动。不然连着甩两下，第二下会在第一下的
   中途重新起算位移，画面会「抖一下再跳」。 */
let sliding = false;

/** 这个方向还能不能翻。到头了就不让滑（只留橡皮筋）。 */
function canStep(dir) {
  if (!DATA) return false;
  if (CFG.view === 'day') return true;        // 日视图不设边界，方便看空白天
  const w = CFG.week || currentWeek();
  return dir < 0 ? w > 1 : w < totalWeeks();
}

function swipeInner() {
  return CFG.view === 'day' ? $('dayView') : $('wkTrack');
}

/* 一页到底多宽。
   🔴 别用 `track.clientWidth`：容器有纵向滚动条时会比「一页」窄十几像素，
      平移量就会差那十几像素 —— 上一页会从左边漏出一条边（实测漏 20px）。
   🔴 量不到就返回 0，**别退回一个「大概」的宽度**（以前是 || 320）：
      页面藏在别的 tab 底下时整条轨道宽度就是 0，退回 320 会把三页摆到错的
      位置；等切回课表，上一周就从时间栏右边漏出一条彩边 —— 用户 2026-11-09
      截图里那条绿边就是它。现在量不到就什么也不做，切回来时统一重摆。 */
function pageW(el) {
  const p = el && el.firstElementChild;
  const w = p ? p.getBoundingClientRect().width : 0;
  return Math.round(w || (el && el.clientWidth) || 0);
}

/* 三页并排，位移基准是「一页宽」。
   轨道里三页等宽，所以把中间那页摆到可视区就是 translateX(-W)，
   翻页时再 ± 一个 W。 */
function centerTrack(track) {
  if (!track) return;
  const w = pageW(track);
  track.style.transition = 'none';
  // 藏着的时候（w = 0）不摆 —— 摆错了没人看得见，切回来却会露馅。
  if (!w) return;
  track.style.transform = 'translate3d(' + (-w) + 'px,0,0)';
}

/** 换回课表页时把两条轨道摆正、手势状态清掉。
 *  数据常常是在别的 tab 上更新完的（后台同步、从「我的」改设置），
 *  那会儿量不到宽度，轨道可能停在一个错的位置上。 */
function swipeSettle() {
  sliding = false;
  const el = swipeInner();
  if (el) { el.style.transition = ''; }
  centerTrack($('wkTrack'));
  centerTrack($('dayView'));
}

/** 滑完一页的收尾：把轨道整页平移过去，再重画三页并把轨道摆回中间。 */
function slideStep(dir) {
  if (sliding) return;
  sliding = true;
  const el = swipeInner();
  if (!el) { sliding = false; return; }
  const w = pageW(el);
  if (!w) { sliding = false; return; }   // 页面藏着：别拿 0 去摆轨道
  const ease = 'transform .24s cubic-bezier(.32,.72,0,1)';
  el.style.transition = ease;
  el.style.transform = 'translate3d(' + (-w - dir * w) + 'px,0,0)';
  setTimeout(() => {
    step(dir);          // 重画三页；renderWeek / renderDay 里会把轨道摆回中间
    sliding = false;
  }, 245);
}

/** 拖到一半松手、又不翻页时，把轨道弹回原位。 */
function snapBack() {
  const el = swipeInner();
  if (!el) return;
  const w = pageW(el);
  if (!w) return;
  el.style.transition = 'transform .18s ease-out';
  el.style.transform = 'translate3d(' + (-w) + 'px,0,0)';
  setTimeout(() => { if (el) el.style.transition = ''; }, 200);
}

(function attachSwipe() {
  const host = $('schScroll');
  if (!host) return;

  let sx = 0; let sy = 0; let dx = 0; let t0 = 0;
  let axis = '';            // '' = 还没定方向，'x' = 翻周，'y' = 纵向滚动（我们不插手）
  let active = false;

  const reset = () => {
    active = false; axis = ''; dx = 0;
    const el = swipeInner();
    if (el) { el.style.transition = ''; centerTrack(el); }
  };

  host.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !DATA || sliding) return;
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; dx = 0; t0 = Date.now();
    axis = ''; active = true;
    const el = swipeInner();
    if (el) el.style.transition = 'none';
  }, { passive: true });

  host.addEventListener('touchmove', (e) => {
    if (!active || e.touches.length !== 1) return;
    const t = e.touches[0];
    dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (!axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
      if (axis === 'y') { active = false; const el = swipeInner(); if (el) el.style.transition = ''; return; }
    }
    if (axis !== 'x') return;
    const el = swipeInner();
    if (!el) return;
    const w = pageW(el);
    if (!w) return;
    const dir = dx > 0 ? -1 : 1;
    // 到头了只给三成位移：手指有反馈，但明确告诉你「没得翻了」
    const d = canStep(dir) ? dx : dx * 0.28;
    el.style.transform = 'translate3d(' + (-w + d) + 'px,0,0)';
  }, { passive: true });

  const finish = () => {
    if (!active || axis !== 'x') { reset(); return; }
    const el = swipeInner();
    const w = pageW(el);
    const dt = Math.max(1, Date.now() - t0);
    const v = Math.abs(dx) / dt;                 // px/ms
    // 两种都算翻页：划得够远（屏幕 22%，上限 70px），或者快速一甩（>0.45 px/ms）
    const far = Math.abs(dx) > Math.min(70, w * 0.22);
    const flick = v > 0.45 && Math.abs(dx) > 24;
    const dir = dx > 0 ? -1 : 1;                 // 手指往右 = 看上一周
    const go = (far || flick) && canStep(dir);
    const moved = dx;
    // 🔴 这里不能调 reset() —— 它会把 transform 摆回中间，
    //    等于把已经拖出去的距离瞬间抹掉，看起来就是「抖一下再跳」。
    //    只清手势状态，位移交给 slideStep / snapBack。
    active = false; axis = ''; dx = 0;
    if (go) { swipeAt = Date.now(); slideStep(dir); }
    else if (Math.abs(moved) > 2) snapBack();
    else if (el) el.style.transition = '';
  };

  host.addEventListener('touchend', finish, { passive: true });
  host.addEventListener('touchcancel', finish, { passive: true });

  // 滑动后浏览器会补一个 click，落在课程块上就弹出详情 —— 吞掉它。
  // 用捕获阶段，比在每个课程块里各判一次靠谱。
  host.addEventListener('click', (e) => {
    if (Date.now() - swipeAt < 350) { e.stopPropagation(); e.preventDefault(); }
  }, true);
})();

function step(n) {
  if (!DATA) return;
  if (CFG.view === 'day') {
    const d = CFG.cursor ? parseYmd(CFG.cursor) : today0();
    CFG.cursor = ymd(addDays(d, n));
  } else {
    CFG.week = Math.min(Math.max(1, (CFG.week || currentWeek()) + n), totalWeeks());
  }
  store.set(KEY.settings, CFG);
  renderSchedule();
}

$('wkToday').addEventListener('click', () => {
  if (!DATA) return;
  // 历史学期下这个按钮叫「回到现在」：先切回当前学期，再落到本周/今天。
  if (!ttIsNow()) {
    switchTerm('');
    return;
  }
  if (CFG.view === 'day') CFG.cursor = ymd(today0());
  else CFG.week = currentWeek();
  store.set(KEY.settings, CFG);
  renderSchedule();
  $('schScroll').scrollTop = 0;
});

$('viewToggle').addEventListener('click', () => {
  CFG.view = CFG.view === 'week' ? 'day' : 'week';
  // 🔴 不能写成「cursor 为空才设今天」—— cursor 是存本机的，昨天看过就非空。
  if (CFG.view === 'day') CFG.cursor = ymd(dayAnchor());
  store.set(KEY.settings, CFG);
  renderSchedule();
  $('schScroll').scrollTop = 0;
});

/* App 被切到后台过夜，回来时课表还停在昨天 —— 同一类问题。
   只在「日期真的变了」时重画：同一天切来切去不该闪一下。 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !allCourses().length) return;
  if (CFG.seenDay === ymd(today0())) return;
  syncToday();
  renderSchedule();
  // 空教室那个「默认查哪天」也是按今天算的（课上完了默认明天），
  // 跨日之后同样得重算 —— 否则第二天进去还在查昨天。
  ROOM.date = '';
  renderRooms();
});

/* 空教室和校历是课表页的「子页」（底部固定 5 个 tab 之后收进来的）。
   进出都走 switchTab —— 不要自己改 hidden，否则 CUR_PAGE、底部高亮、
   系统返回键三处会互相打架。 */
$('wkRooms').addEventListener('click', () => switchTab('rooms'));
$('calBack').addEventListener('click', () => switchTab('schedule'));
// 后台自动（0.50.0 v9）：入口从学习页搬来「我的」标题行右边。
// 它管着学习通和积分任务两件事，本来就该是「这台手机的设置」，不是某个页面的按钮。
$('meAuto').addEventListener('click', () => openAutoSheet());
/* 设置（2026-11-25）：「我的」那张卡里的第一整行，进的是独立二级页。
   用户要求「做成一个新的页面，不要在上面用这个单独按钮的形式存在」——
   所以这里只有一句「先重画、再切页」，弹层那套不再用。
   🔴 必须先 renderSettingsPage() 再 switchTab()：反过来的话切过去会先看到
     「正在读…」。两个都是同步的，顺序在这里是可见的差别。 */
$('rowSettings').addEventListener('click', () => { renderSettingsPage(); switchTab('settings'); });
$('settingsBack').addEventListener('click', () => { switchTab('me'); });

/* 「说明」（2026-11-25）：本地版使用说明。
 *
 * 用户：「以前是网页版，现在我们改成本地版，介绍一下这五个板块怎么使用」。
 * 老版本这里是 HELP_URL —— 先 docs.qq.com、后 hobson.cc/help/ 的那份远端网页，
 * 那套随更新器那轮重构整个删掉了，点了只剩一句 toast（「暂未提供在线说明」）。
 *
 * 🔴 现在说明书就写在这个文件里，随包走：不联网、不打远端、离线也读得到。
 *    顺序固定跟底部 tab 从左到右一致：课表 → 学习 → 校园 → 功能 → 我的。
 *    以后改文案只改这里，别再挂一个地址回来。
 */
function openHelpSheet() {
  const where = NATIVE ? '这台手机' : '这台电脑';
  $('sheetBody').innerHTML =
    '<div class="sh-title">使用说明</div>' +
    '<div class="sh-sub">从最左边第一个板块开始。</div>' +

    '<div class="hlp-sec">' +
      '<div class="hlp-h"><b>课表</b><span>第一个</span></div>' +
      '<ul class="hlp-list">' +
        '<li>打开就是<b>本周</b>。左右滑动翻周，也可以点上面的 ‹ ›。</li>' +
        '<li>点中间「第 N 周」能直接跳到任意一周；那个弹层最底下还有<b>看校历</b>和<b>学期设置</b>。</li>' +
        '<li>右上「空教室」查这会儿哪间教室没课，按日期和节次查。</li>' +
        '<li>最右「周 / 日」切换视图。日视图会多一条「现在这节 / 下一节」。</li>' +
        '<li>点任何一节课看详情：能改颜色，也能把不想看的课<b>隐藏</b>掉；自己加的课还能改和删。</li>' +
        '<li>课表得从教务同步。没绑过的话，先去「我的 → 账号管理」绑一次。</li>' +
      '</ul>' +
    '</div>' +

    '<div class="hlp-sec">' +
      '<div class="hlp-h"><b>学习</b><span>第二个</span></div>' +
      '<ul class="hlp-list">' +
        '<li>顶上四段：<b>学习通</b>、<b>考试</b>、<b>成绩</b>、<b>学分</b>。</li>' +
        '<li>学习通只读作业和截止时间，<b>不替你交作业</b>。自己交完点一下「我交过了」就记下，不再催。</li>' +
        '<li>考试按学期列安排，临近的会在截止前提醒。</li>' +
        '<li>成绩出分后自动同步。这次没读到会单独说一句，那不等于「没有成绩」。</li>' +
        '<li>学分按培养计划算已修学分和绩点。</li>' +
      '</ul>' +
    '</div>' +

    '<div class="hlp-sec">' +
      '<div class="hlp-h"><b>校园</b><span>第三个</span></div>' +
      '<ul class="hlp-list">' +
        '<li><b>校园公告</b>：同步教务处近三个月的公告，点开看原文。</li>' +
        '<li><b>校园服务</b>：学校服务门户的入口。</li>' +
        '<li>这一页还在补，现在能用的就是上面这两行。</li>' +
      '</ul>' +
    '</div>' +

    '<div class="hlp-sec">' +
      '<div class="hlp-h"><b>功能</b><span>第四个</span></div>' +
      '<ul class="hlp-list">' +
        '<li>现在这里是<b>直饮水</b>（慧生活798）。</li>' +
        '<li>饮水要<b>单独登录</b>一次，跟学校那套账号不是一回事。</li>' +
        '<li>第一张卡是余额和「刚才那次」；点「消费记录」能翻历史。</li>' +
        '<li>第二张卡管自己的饮水机：手输编号、扫码、碰一碰都能加。</li>' +
        '<li>积分和每日任务也在这一页下面。</li>' +
      '</ul>' +
      '<div class="ab-tip">接水是真的出水扣钱：点了就开始，<b>不弹确认</b>；「停止」同样立刻生效。费用按设备上显示的为准。</div>' +
    '</div>' +

    '<div class="hlp-sec">' +
      '<div class="hlp-h"><b>我的</b><span>第五个</span></div>' +
      '<ul class="hlp-list">' +
        '<li><b>账号管理</b>：教务、学习通、慧生活都在这儿，右边写着连了几个。</li>' +
        '<li>「同步教务处数据」「学期设置」「校历」也在这一屏。</li>' +
        '<li><b>上课时间和提醒</b>：改作息，提醒照这个时间走。</li>' +
        '<li><b>桌面小组件</b>：教你怎么把它加到桌面，本身不是开关。</li>' +
        '<li><b>课程调整</b>：自己加课，或者把不想看的课藏起来。</li>' +
        '<li>最下面依次是<b>设置</b>（配色、上课时间）、版本、检查更新、关于本项目。</li>' +
      '</ul>' +
    '</div>' +

    '<div class="ab-note">学号密码只加密存在' + where + '上，不上传，也不会跟着账号跑到别处。' +
      '教务那边只读，不代提交。这个 App 是学生自己做的，免费、无广告，和学校没有关系。</div>' +
    '<div class="sheetbtns"><button class="btn primary" id="helpOk">知道了</button></div>';
  $('sheetMask').hidden = false;
  // `.sheet` 自己是滚动容器，上一张弹层可能把位置留在半截。
  $('sheet').scrollTop = 0;
  $('helpOk').addEventListener('click', closeSheet);
}

$('meHelp').addEventListener('click', openHelpSheet);
$('rmBack').addEventListener('click', () => switchTab('schedule'));

// ------------------------------------------------------------------ 成绩

let gradeTerm = 'all';
let gradeFind = '';        // 搜索词（课程名 / 课程号）
let gradeSort = 0;         // 0 默认 / 1 分数优先 / 2 学分优先
// 0.33.0：列表**首屏**显示几门。一学期十几门 × 65px 就是 900+，
// 这一页可用只有 678（上面还有汇总卡、绩点趋势、学期筛选、搜索框）。
// 5 门 + 一颗「还有 N 门」正好一屏；要看全套点一下，或者用上面的搜索。
let gradeShowN = 5;
const GRADE_SORTS = ['默认排序', '分数优先', '学分优先'];

/** 课程号 → 它在培养计划里的身份。
 *
 *  返回 Map<code, {pc, sub}>：pc 是计划里那条课程，sub 表示「这门是替代课」。
 *  计划没同步下来时返回**空 Map** —— 调用方看到 size===0 就一个标签都不打，
 *  否则所有课都会被标成「计划外」，那是把「没读到」说成了事实。
 */
function planIndex() {
  const m = new Map();
  const plan = (DATA && DATA.plan) || null;
  if (!plan || !plan.courses || !plan.courses.length) return m;
  const byCode = {};
  plan.courses.forEach((pc) => {
    const k = String(pc.code || '').trim();
    if (!k) return;
    byCode[k] = pc;
    m.set(k, { pc: pc, sub: false });
  });
  (plan.subs || []).forEach((s) => {
    const from = byCode[String((s.from && s.from.code) || '').trim()];
    const to = String((s.to && s.to.code) || '').trim();
    if (to && from) m.set(to, { pc: from, sub: true });
  });
  return m;
}

/** 每学期一根柱子画绩点。
 *
 *  只有总绩点的话，「大一上 3.11 → 大一下 2.06」会被平均成 2.51，
 *  看上去风平浪静 —— 但那是掉了一整个档。数据一直在 grades.summary 里，
 *  以前只是没画出来。
 *
 *  少于两学期就不画：一根柱子不叫趋势，还白占一块地方。
 */
function renderGpaTrend(g) {
  const box = $('grTrend');
  if (!box) return;
  const rows = (g.summary || []).map((s) => {
    const y = /^(\d{4})/.exec(String(s.year || ''));
    const gl = y ? gradeName(Number(y[1]), Number(s.term)) : '';
    return {
      label: gl || (String(s.year || '') + ' ' + String(s.term || '')).trim(),
      gpa: parseFloat(s.gpa),
    };
  }).filter((r) => !isNaN(r.gpa) && r.gpa > 0);

  if (rows.length < 2) { box.hidden = true; return; }
  box.hidden = false;

  // 分母取 max(4, 实际最高)：教务是 4 分制，按 4 折算柱子高矮可比；
  // 万一遇到 5 分制的学校也不会把柱子顶出框。
  const top = Math.max(4, Math.max.apply(null, rows.map((r) => r.gpa)));
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const d = last.gpa - prev.gpa;
  // 涨了是绿的、掉了是红的 —— 这里不是股票，别套「红涨绿跌」那套。
  const dHtml = '<i class="gpt-d ' + (d >= 0 ? 'up' : 'down') + '">' +
    (d >= 0 ? '↑ ' : '↓ ') + Math.abs(d).toFixed(2) + '</i>';

  // 2026-11-01：默认**收起**，只留标题行（右侧带涨跌）。
  // 真机 360×712 上成绩页超出 105px，这张图一个人占 72 —— 它是「看趋势」，
  // 不是「查分数」，收起来不影响任何一件事；点一下标题就展开。
  // 收起状态记在 data-closed 上（不用 CSS 类，免得和 .on 那套混）。
  const open = box.getAttribute('data-open') === '1';
  box.innerHTML = '<button class="gpt-hd" type="button" id="gptTog" aria-expanded="' +
      (open ? 'true' : 'false') + '"><span>绩点趋势</span>' +
      '<span class="gpt-right">' + dHtml +
      '<svg class="gpt-caret" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M6 9l6 6 6-6"/></svg></span></button>' +
    '<div class="gpt-bars"' + (open ? '' : ' hidden') + '>' + rows.map((r) =>
      '<div class="gpt-col"><b>' + r.gpa.toFixed(2) + '</b>' +
      '<div class="gpt-track"><i style="height:' +
        Math.max(4, Math.round(r.gpa / top * 100)) + '%"></i></div>' +
      '<span>' + esc(r.label) + '</span></div>').join('') + '</div>';
  $('gptTog').addEventListener('click', () => {
    const now = box.getAttribute('data-open') === '1';
    box.setAttribute('data-open', now ? '0' : '1');
    box.querySelector('.gpt-bars').hidden = now;
    $('gptTog').setAttribute('aria-expanded', now ? 'false' : 'true');
    box.classList.toggle('open', !now);
  });
  box.classList.toggle('open', open);
}

/** 分数读成数字；等级制（优秀/良好）读不出来，返回 NaN 排到最后。 */
function scoreNum(c) {
  const n = parseFloat(c.final || c.score);
  return isNaN(n) ? NaN : n;
}

/** 汇总口径（加权绩点/已修学分/门数）。
 *  同步时就已算好存在 DATA.grades.overall；旧缓存里没有这一项（早于本功能同步的），
 *  就在渲染时按同一套 gradeStats 现算一遍，避免缓存用户看到一排「—」。 */
function gradeOverall(g) {
  if (!g || !g.courses || !g.courses.length) return {};
  if (g.overall && (g.overall.gpa || g.overall.credits)) return g.overall;
  if (window.Nepu && typeof Nepu.gradeStats === 'function') {
    try { return Nepu.gradeStats(g.courses) || {}; } catch (e) { return {}; }
  }
  return {};
}

function renderGrades() {
  const hasData = !!(DATA && DATA.source === 'nepu' && DATA.grades && DATA.grades.courses && DATA.grades.courses.length);
  $('grEmpty').hidden = hasData;
  $('grBody').hidden = !hasData;
  if (!hasData) {
    // 🔴 空态有三种，别混成一句「还没有成绩数据」（原来那句子还催人去绑定，
    //    已经绑定的人看了只会以为自己没绑上）：
    //    ① 没绑账号 ② 绑了、但确实还没出分 ③ 读失败，原因照实写。
    //    新生第一学期走的永远是 ②，而 2026-11-01 之前后端把它当成了
    //    「登录态过期」，人连绑定都过不去 —— 所以这里必须说清楚是「没有分」。
    const g = (DATA && DATA.grades) || null;
    const bound = !!(DATA && DATA.source === 'nepu');
    const h = $('grEmpty').querySelector('h2');
    const p = $('grEmpty').querySelector('p');
    const btn = $('goBind2');
    if (!bound) {
      h.textContent = '还没有成绩数据';
      p.textContent = '在账号管理中登录学校 WebVPN，再同步教务数据。';
      if (btn) btn.hidden = false;
    } else if (g && g.error) {
      h.textContent = '这次没读到成绩';
      p.textContent = '课表、考试这些都正常，只有成绩这一块没取到：' + g.error;
      if (btn) btn.hidden = true;
    } else {
      h.textContent = '还没有成绩';
      p.textContent = '可能还没出分，出分后自动同步';
      if (btn) btn.hidden = true;
    }
    return;
  }

  const g = DATA.grades;
  const o = gradeOverall(g);
  $('grGpa').textContent = o.gpa || '—';
  $('grCredits').textContent = o.credits || '—';
  $('grCount').textContent = o.count || '—';

  renderGpaTrend(g);

  // 学期筛选条。教务系统给的是「2025-2026 1」，学生认的是「大一上」——
  // 用户 2026-10-19 明确提过：别再摆学年编号。
  // key 保留原样（成绩记录的 term 字段就是它），只换显示的文字。
  const terms = (g.summary || []).map((s) => {
    const key = s.year + ' ' + s.term;
    const y = /^(\d{4})/.exec(String(s.year || ''));
    const gl = y ? gradeName(Number(y[1]), Number(s.term)) : '';
    return { key: key, label: gl || key };
  });
  const chips = [{ key: 'all', label: '全部' }].concat(terms);
  $('grChips').innerHTML = chips.map((t) =>
    '<button class="chip' + (gradeTerm === t.key ? ' on' : '') + '" data-term="' + esc(t.key) + '">' +
    esc(t.label) + '</button>').join('');
  $('grChips').querySelectorAll('.chip').forEach((b) => {
    b.addEventListener('click', () => {
      gradeTerm = b.dataset.term;
      gradeShowN = 5;      // 换了学期，首屏重新从 5 门开始
      renderGrades();
    });
  });

  // 排序按钮的文字就是当前状态 —— 不用再猜「现在按什么排的」
  const sb = $('grSort');
  if (sb) {
    sb.textContent = GRADE_SORTS[gradeSort] || GRADE_SORTS[0];
    sb.classList.toggle('on', gradeSort !== 0);
  }

  let list = g.courses.filter((c) => gradeTerm === 'all' || c.term === gradeTerm);

  const q = gradeFind.trim().toLowerCase();
  if (q) {
    list = list.filter((c) =>
      (String(c.name || '') + ' ' + String(c.code || '')).toLowerCase().indexOf(q) >= 0);
  }

  if (gradeSort === 1) {
    // 等级制读不出分数的排最后（不是当 0 分排最前）
    list = list.slice().sort((a, b) => {
      const x = scoreNum(a), y = scoreNum(b);
      if (isNaN(x) && isNaN(y)) return 0;
      if (isNaN(x)) return 1;
      if (isNaN(y)) return -1;
      return y - x;
    });
  } else if (gradeSort === 2) {
    list = list.slice().sort((a, b) =>
      (parseFloat(b.credit) || 0) - (parseFloat(a.credit) || 0));
  }

  // 计划里有没有这门课。有 ⇒ 不打标签（必修/选修副行里本来就写着）；
  // 没有 ⇒ 打「计划外」，因为那正是「总学分和进度对不上」的原因。
  const pidx = planIndex();
  const hasPlan = pidx.size > 0;

  // 0.33.0：首屏只铺前 `gradeShowN` 门（默认 5），多的收在「还有 N 门」后面。
  // 🔴 只截**渲染**：会话统计（`list.length`）和下面的空态判断仍按全量算。
  const shown = list.slice(0, gradeShowN);

  $('grList').innerHTML = (shown.map((c) => {
    const score = c.final || c.score || '';
    const num = parseFloat(score);
    let cls = '';
    if (!isNaN(num)) cls = num >= 85 ? ' s-good' : (num >= 60 ? ' s-mid' : ' s-bad');
    const hit = hasPlan ? pidx.get(String(c.code || '').trim()) : undefined;
    // nature 缺了就退回计划里的「是否必修」，再退就什么都没有 ——
    // 宁可少写一行，也不猜一个「必修」出来。
    const nature = c.nature || c.category ||
      (hit && hit.pc ? (hit.pc.required ? '必修课' : '选修课') : '');
    let tag = '';
    if (hasPlan) {
      if (!hit) tag = '<i class="gitag out">计划外</i>';
      else if (hit.sub) tag = '<i class="gitag sub">替代</i>';
    }
    const meta = [esc(c.credit) + ' 学分', nature ? esc(nature) : '']
      .filter(Boolean).join(' · ') + tag;
    return '<div class="gradeitem">' +
      '<div class="gi-main"><div class="gi-name">' + esc(c.name) + '</div>' +
      '<div class="gi-meta">' + meta + '</div></div>' +
      '<div class="gi-score' + cls + '"><b>' + esc(score) + '</b><span>' + (c.gpaEstimated ? '估算绩点 ' : '绩点 ') + esc(c.gpa) + '</span></div>' +
      '</div>';
  }).join('') || ('<div class="gradeitem"><div class="gi-main"><div class="gi-meta">' +
    (q ? '没搜到「' + esc(gradeFind.trim()) + '」' : '这个学期没有成绩记录') +
    '</div></div></div>')) +
    (list.length > shown.length
      ? '<button class="cx-more" id="grMore">还有 ' + (list.length - shown.length) +
        ' 门没显示</button>'
      : '');
  if ($('grMore')) {
    $('grMore').addEventListener('click', () => { gradeShowN = 9999; renderGrades(); });
  }
}

// ------------------------------------------------------------------ 学分进度

/** 一门课算不算「过了」。
 *
 *  返回 true / false / null（null = 成绩还没出来，不知道）。
 *  🔴 别把「没有成绩」当成「没过」：那会让「这学期正在上的课」全部
 *     跳进「挂科」名单里，一开学就看见红字。
 */
function passedOf(g) {
  if (!g) return null;
  const raw = String(g.final || g.score || '').trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!isNaN(n)) return n >= 60;
  // 等级制成绩：优秀/良好/中等/及格 算过，不及格/缺考/缓考 不算
  if (/不及格|未通过|缺考|旷考|作弊/.test(raw)) return false;
  if (/优秀|良好|中等|及格|合格|通过|优|良|中/.test(raw)) return true;
  return null;   // 认不出的写法：不猜，当「不知道」处理
}

/** 把培养计划和成绩对起来，算出毕业学分进度。
 *
 *  为什么要这么小心（三个口径必须分开，混一起就会算出跟学校不一样的数）：
 *    应修 = 培养计划的「全程总计」，学校自己写的那个数（比如 164）
 *    已修 = 计划内的课里，**成绩及格**的那些的「计划学分」
 *    在读 = 课表里有、成绩里还没有的（这学期正在上，不能算已修）
 *
 *  挂科的**不进已修** —— 挂了的学分不算修到，这是常识，也是重修制度的依据。
 *  但它也不能凭空消失，所以单独列出来。
 *
 *  还有两类容易被漏掉的：
 *    - 替代课程：培养计划第二张表列了「线性代数 ↔ 高等代数」这种关系。
 *      学生修的是高等代数，如果不认这条，就会误报「你缺线性代数」。
 *    - 计划外的课：选修课、转专业多修的。这些成绩里有、计划里没有。
 *      算进已修会让主数字虚高（还可能超过某一类的应修），
 *      所以**不算进进度**，单独说一句「另外还修了 X 学分」。
 */
function creditProgress() {
  const plan = (DATA && DATA.plan) || null;
  const g = (DATA && DATA.grades) || null;
  const out = {
    ok: false, why: '',
    total: 0, done: 0, doing: 0, failedCredit: 0,
    cats: [], failed: [], missing: [], doingCourses: [], extra: [],
    extraCredit: 0, subUsed: [], catSum: 0,
  };

  if (!plan || !plan.courses || !plan.courses.length) {
    out.why = (plan && plan.error) || '还没同步到培养计划';
    return out;
  }
  if (!g || !g.courses || !g.courses.length) {
    out.why = '还没同步到成绩，没法算已修学分';
    return out;
  }

  // 同一门课可能有多条成绩（重修）。取分数高的那条 ——
  // 学校判断「过没过」也是这个口径。
  const byCode = {};
  g.courses.forEach((c) => {
    const k = String(c.code || '').trim();
    if (!k) return;
    const prev = byCode[k];
    if (!prev) { byCode[k] = c; return; }
    const a = parseFloat(prev.final || prev.score);
    const b = parseFloat(c.final || c.score);
    if (isNaN(a) || (!isNaN(b) && b > a)) byCode[k] = c;
  });

  // 替代关系：原课 → 替代课
  const subTo = {};
  (plan.subs || []).forEach((s) => { subTo[s.from.code] = s.to.code; });

  // 课表里这学期正在上的课
  //
  // 🔴 这里必须读 **DATA.courses**，不能读 `curTT().courses`：
  //    「正在上」按定义就是教务系统当前那一学期。用户翻到「大一上」看历史课表时，
  //    那学期的课早就考完了，拿它算「在读学分」会把学分进度整个算错
  //    （已修的课被算成在读，已修学分凭空少一大块）。
  const doing = {};
  (DATA.courses || []).forEach((c) => {
    if (c.code) doing[String(c.code).trim()] = c;
  });

  const catMap = {};
  const catOf = (name) => {
    if (!catMap[name]) {
      catMap[name] = { name: name, need: 0, done: 0, doing: 0, failed: 0, cnt: 0, cntDone: 0 };
    }
    return catMap[name];
  };
  (plan.cats || []).forEach((c) => { catOf(c.name).need = c.credit; });

  const planCodes = {};

  plan.courses.forEach((pc) => {
    planCodes[pc.code] = 1;
    // 分类取第一层（「个性化课程 / 专业选修课」归到「个性化课程」）
    const st = catOf(String(pc.cat || '').split(' / ')[0].trim() || '其他');
    st.cnt++;

    const hit = byCode[pc.code];
    const subCode = subTo[pc.code];
    const subHit = subCode ? byCode[subCode] : null;

    const pass = hit ? passedOf(hit) : (subHit ? passedOf(subHit) : null);
    const rec = hit || subHit;

    if (pass === true) {
      st.done += pc.credit; st.cntDone++; out.done += pc.credit;
      if (!hit && subHit) {
        out.subUsed.push({ plan: pc, by: subHit });
      }
      return;
    }
    if (pass === false) {
      st.failed++; out.failedCredit += pc.credit;
      out.failed.push({ plan: pc, grade: rec });
      return;
    }
    // pass === null：要么没修过，要么成绩还没出
    if (doing[pc.code]) {
      st.doing += pc.credit; out.doing += pc.credit;
      out.doingCourses.push(pc);
      return;
    }
    if (rec) {
      // 有成绩记录但分数读不出来（等级制写法没见过）⇒ 不算已修，
      // 但也不能说成「没修」，单独归到「待确认」
      out.missing.push({ plan: pc, grade: rec, unsure: true });
      return;
    }
    out.missing.push({ plan: pc, grade: null, unsure: false });
  });

  // 计划外的课（成绩里有、计划里没有）
  g.courses.forEach((c) => {
    const k = String(c.code || '').trim();
    if (k && planCodes[k]) return;
    const p = passedOf(c);
    if (p !== true) return;
    out.extra.push(c);
    out.extraCredit += parseFloat(c.credit) || 0;
  });

  out.total = plan.total || 0;
  out.cats = Object.keys(catMap).map((k) => catMap[k]);
  // 各类小计之和 vs 全程总计：教务系统有时不给「通识选修课」小计
  // （2026 级就遇到过：各类加起来 160，总计写 164，差的那 4 学分
  //   是「通用选修课 4 学分」，只写在备注里）。差多少要说出来，不能装作没有。
  out.catSum = out.cats.reduce((s, c) => s + (c.need || 0), 0);
  out.ok = out.total > 0;
  if (!out.ok) out.why = '培养计划里没读到「全程总计」，可能页面结构变了';
  return out;
}

let creditOpen = {};   // 哪些分类是展开的

// 学分页「分类」首屏铺几类。真机 360×712 上每类 82px，六类 495px，
// 而整页可用只有 544 —— 铺三类（246）才装得下下面的「没过的课」。
const CR_FIRST = 3;

function renderCredit() {
  const hasPlan = !!(DATA && DATA.plan && DATA.plan.courses && DATA.plan.courses.length);
  const hasGrade = !!(DATA && DATA.grades && DATA.grades.courses && DATA.grades.courses.length);
  const p = creditProgress();
  const bound = !!(DATA && DATA.profile && DATA.profile.studentId);

  $('crEmpty').hidden = p.ok;
  $('crBody').hidden = !p.ok;
  if (!p.ok) {
    const t = $('crEmptyTitle'), d = $('crEmptyText');
    if (!hasPlan && DATA && DATA.source === 'nepu') {
      t.textContent = '培养计划暂不可用';
      const overall = gradeOverall(DATA.grades);
      d.textContent = hasGrade
        ? '已修学分 ' + (overall.credits || '—') + ' · ' + (overall.estimated ? '估算绩点 ' : '加权绩点 ') + (overall.gpa || '—')
        : '成绩同步后显示已修学分。';
    } else if (!bound) {
      t.textContent = '培养计划暂不可用';
      d.textContent = '当前教务数据未包含培养计划。';
    } else if (!hasPlan) {
      t.textContent = '培养计划没取到';
      d.textContent = p.why;
    } else if (!hasGrade) {
      t.textContent = '还没有成绩';
      d.textContent = '没有成绩无法计算已修学分，请点右上角刷新。';
    } else {
      t.textContent = '算不出进度';
      d.textContent = p.why;
    }
    return;
  }

  const pct = p.total > 0 ? Math.min(100, (p.done / p.total) * 100) : 0;
  const n = (x) => (Math.round(x * 100) / 100).toString();

  let html = '<div class="crhero">' +
    '<div class="crhero-top"><b>' + n(p.done) + '</b><span>/ ' + n(p.total) + ' 学分</span>' +
    '<i>' + (Math.round(pct * 10) / 10) + '%</i></div>' +
    '<div class="crbar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
    // 2026-11-01：原来这里有两行小字 ——「这学期在读 X 学分，考完才算数」
    // 和「教务系统那边统计的是 46.5 学分……」。第一句在下面「这学期在上」那张卡
    // 里已经有了，删掉；第二句必须留（否则用户去教务系统一看 46.5、这里是 45.5，
    // 一定以为算错了），但压成一行。
    (p.extraCredit > 0
      ? '<div class="crhero-sub">教务系统是 ' + n(p.done + p.extraCredit) +
        '，多的 ' + n(p.extraCredit) + ' 学分是计划外的（见下）</div>'
      : '') +
    '</div>';

  // 分类。2026-11-01：真机 360×712 上学分页超出 489px，这一块一个人占 495。
  // 每类 82px，六类就是 495 —— 首屏只铺前三类，其余收在「展开全部」后面。
  // 收不是删：点一下六类全出来，和「学习通还有 N 条」「成绩还有 N 门」同一套。
  const catOpen = !!creditOpen.cats;
  const cats = catOpen ? p.cats : p.cats.slice(0, CR_FIRST);
  html += '<div class="crcats">';
  cats.forEach((c) => {
    const cp = c.need > 0 ? Math.min(100, (c.done / c.need) * 100) : 0;
    const full = c.need > 0 && c.done >= c.need;
    html += '<div class="crcat' + (full ? ' full' : '') + '">' +
      '<div class="crcat-top"><span class="crcat-n">' + esc(c.name) + '</span>' +
      '<span class="crcat-v">' + n(c.done) + '<em>/' + n(c.need) + '</em></span></div>' +
      '<div class="crcat-bar"><i style="width:' + cp.toFixed(1) + '%"></i></div>' +
      '<div class="crcat-meta">' + c.cntDone + ' / ' + c.cnt + ' 门' +
      (c.doing > 0 ? ' · 在读 ' + n(c.doing) + ' 学分' : '') +
      (c.failed > 0 ? ' · <span class="crcat-bad">' + c.failed + ' 门没过</span>' : '') +
      '</div></div>';
  });
  if (p.cats.length > CR_FIRST) {
    html += '<button class="cx-more crcats-more" id="crCatMore">' +
      (catOpen ? '收起' : '还有 ' + (p.cats.length - CR_FIRST) + ' 类没显示') +
      '</button>';
  }
  html += '</div>';

  // 各类小计对不上总计，要说出来
  if (p.catSum > 0 && Math.abs(p.catSum - p.total) >= 0.01) {
    html += '<div class="crnote">上面各类加起来是 ' + n(p.catSum) + ' 学分，' +
      '总计写的是 ' + n(p.total) + '。差的那 ' + n(p.total - p.catSum) +
      ' 学分教务未单列（通识选修额度），不是算漏</div>';
  }

  // 挂科
  if (p.failed.length) {
    html += '<div class="crcard crcard-bad"><div class="crcard-h">' +
      '<span class="crcard-t">没过的课</span>' +
      '<span class="crcard-n">' + p.failed.length + ' 门 · ' + n(p.failedCredit) +
      ' 学分 · 没算进上面</span></div>' +
      p.failed.map((x) => {
        const sc = String((x.grade && (x.grade.final || x.grade.score)) || '').trim();
        return '<div class="crline"><span class="crline-n">' + esc(x.plan.name) + '</span>' +
          '<span class="crline-v">' + esc(sc || '—') + ' 分</span></div>';
      }).join('') +
      '</div>';
  }

  // 在读
  if (p.doingCourses.length) {
    html += '<div class="crcard"><div class="crcard-h">' +
      '<span class="crcard-t">这学期在上</span>' +
      '<span class="crcard-n">' + p.doingCourses.length + ' 门 · ' + n(p.doing) +
      ' 学分 · 没出成绩</span></div>' +
      p.doingCourses.map((c) => '<div class="crline"><span class="crline-n">' + esc(c.name) + '</span>' +
        '<span class="crline-v muted">' + n(c.credit) + ' 学分</span></div>').join('') +
      '</div>';
  }

  // 未修
  if (p.missing.length) {
    const open = !!creditOpen.missing;
    html += '<div class="crcard"><div class="crcard-h crtoggle" id="crMissToggle">' +
      '<span class="crcard-t">还没修的</span>' +
      '<span class="crcard-n">' + p.missing.length + ' 门 <i class="crarrow' + (open ? ' on' : '') + '">›</i></span></div>';
    if (open) {
      // 按建议学期分组：学生看的是「我这学期/下学期该修什么」
      const byTerm = {};
      p.missing.forEach((m) => {
        const ts = (m.plan.terms && m.plan.terms.length) ? m.plan.terms : [0];
        ts.forEach((t) => {
          const k = t || 0;
          (byTerm[k] = byTerm[k] || []).push(m);
        });
      });
      Object.keys(byTerm).sort((a, b) => Number(a) - Number(b)).forEach((k) => {
        const label = Number(k) > 0 ? '第 ' + k + ' 学期' : '未标学期';
        html += '<div class="crgroup">' + label + '</div>';
        byTerm[k].forEach((m) => {
          html += '<div class="crline"><span class="crline-n">' + esc(m.plan.name) +
            (m.unsure ? ' <em class="crline-q">成绩读不出来</em>' : '') + '</span>' +
            '<span class="crline-v muted">' + n(m.plan.credit) + ' 学分</span></div>';
        });
      });
    }
    html += '</div>';
  }

  // 替代课程
  if (p.subUsed.length) {
    html += '<div class="crcard"><div class="crcard-h">' +
      '<span class="crcard-t">按替代课程算的</span></div>' +
      p.subUsed.map((x) => '<div class="crline"><span class="crline-n">' + esc(x.plan.name) + '</span>' +
        '<span class="crline-v muted">修的是 ' + esc(x.by.name || '') + '</span></div>').join('') +
      '<div class="crcard-f">培养计划里给了替代关系，这两门互相顶。</div></div>';
  }

  // 计划外的
  if (p.extra.length) {
    html += '<div class="crcard"><div class="crcard-h">' +
      '<span class="crcard-t">计划外修的</span>' +
      '<span class="crcard-n">' + p.extra.length + ' 门 · ' + n(p.extraCredit) +
      ' 学分 · 不在计划内</span></div></div>';
  }

  $('crBody').innerHTML = html;

  const t = $('crMissToggle');
  if (t) {
    t.addEventListener('click', () => {
      creditOpen.missing = !creditOpen.missing;
      renderCredit();
    });
  }
  const cm = $('crCatMore');
  if (cm) {
    cm.addEventListener('click', () => {
      creditOpen.cats = !creditOpen.cats;
      renderCredit();
    });
  }
}


// ------------------------------------------------------------------ 考试

/** 从「2026-10-25」「2026/10/25」「2026年10月25日」里抠出 Date。
 *
 *  抠不出来返回 null。学校换个日期写法是常事，这里宁可显示原文，
 *  也别在界面上出现 "Invalid Date" 或者悄悄算成 1970 年。
 */
function examDate(s) {
  const m = /(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** 学校用「未安排」占位：`时间未安排`、`地点未安排`、`座位未安排`。
 *
 *  这些值一律当空处理 —— 否则详情里会出现「地点 地点未安排」
 *  「座位 地点未安排」这种把占位符原样念一遍的行（2026-10-19 实测）。
 */
function blankField(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return true;
  return /^(时间|地点|考场|座位|周次|考试)?\s*未安排$/.test(s);
}

/* ---------------- 考试加进手机日历 ----------------
 *
 * 用户 2026-10-20 提的：逐场倒计时有了，但还得自己抄到日历里设提醒。
 *
 * 同一份「事件」数据，两条落地的路：
 *   APK  → NativeApi.addCalendar(...) → 拉起系统日历的「新建事件」界面，
 *          时间/地点/备注都填好，用户确认一下保存。
 *   网页 → 生成 .ics 下载，双击或导入都能进日历。
 *
 * 🔴 只有**能算出真实开始时间**的场次才给按钮。
 *    学校对没排时间的场次写「时间未安排」，那种加进日历只会多一个
 *    不知道该放哪天的事件 —— 与其给个坏按钮，不如不给。
 *    有日期、没时间的（学校只给了日期）算**全天事件**，至少提醒那天有考试。
 */

/** 从 "09:00-11:00" / "14:30~16:10" / "09:00" 里取起止分钟数。
 *
 *  只认 `时:分` 这种带冒号的写法：日期里的 "2026-10-21" 不会被误当成时间。
 *  取不到返回 null；只给了一个时间时，结束按 +120 分钟算。
 */
function parseArrange(s) {
  const hits = String(s || '').match(/\d{1,2}\s*[:：]\s*\d{2}/g) || [];
  if (!hits.length) return null;
  const at = (t) => {
    const a = t.split(/[:：]/);
    const h = Number(a[0]);
    const mi = Number(a[1]);
    if (!(h >= 0 && h < 24) || !(mi >= 0 && mi < 60)) return null;
    return h * 60 + mi;
  };
  const b = at(hits[0]);
  if (b === null) return null;
  let e = hits.length > 1 ? at(hits[1]) : null;
  // 结束早于或等于开始 = 学校把时间写反了（或者只给了开始）⇒ 兜底两小时。
  // 别让日历里出现「16:30 到 14:30」这种负长度的场次。
  if (e === null || e <= b) e = Math.min(b + 120, 23 * 60 + 59);
  return { b, e };
}

/** 一场考试 → 日历事件。翻译不出来返回 null（界面上就不出现按钮）。 */
function examEvent(e) {
  const d = examDate(e.date);
  if (!d) return null;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const t = parseArrange(e.arrange);
  const lines = [];
  if (!blankField(e.seat)) lines.push('座位 ' + String(e.seat).trim());
  if (!blankField(e.form)) lines.push('形式 ' + String(e.form).trim());
  if (!blankField(e.category)) lines.push('类型 ' + String(e.category).trim());
  if (!blankField(e.code)) lines.push('课程号 ' + String(e.code).trim());
  if (!blankField(e.note)) lines.push('说明 ' + String(e.note).trim());
  lines.push('来自「东油通」，以教务系统为准');
  return {
    title: '考试：' + String(e.name || '未命名课程').trim(),
    desc: lines.join('\n'),
    loc: blankField(e.room) ? '' : String(e.room).trim(),
    begin: t ? day + t.b * 60000 : day,
    end: t ? day + t.e * 60000 : day + 86400000,
    allDay: !t,
  };
}

/** 毫秒 → iCalendar 的 UTC 时间戳（20261021T013000Z）。 */
function icsStamp(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
    'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

/** 毫秒 → 本地日期（20261021）。全天事件用日期而不是时刻。 */
function icsDay(ms) {
  const d = new Date(ms);
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

/** 文本值里的特殊字符必须转义，否则日历软件解析会断在半截。 */
function icsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 生成一份只含一场考试的 .ics。
 *
 *  🔴 行尾必须是 CRLF（RFC 5545 硬性要求），用 \n 拼出来有些日历会整份不认。
 */
function icsText(ev) {
  const uid = 'exam-' + icsDay(ev.begin) + '-' +
    String(ev.title).replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '').slice(0, 24) +
    '@dongyoutong';
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DongYouTong//Exam//CN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + icsStamp(Date.now()),
  ];
  if (ev.allDay) {
    // 全天事件的 DTEND 是**不含**的，所以结束要往后推一天
    L.push('DTSTART;VALUE=DATE:' + icsDay(ev.begin));
    L.push('DTEND;VALUE=DATE:' + icsDay(ev.begin + 86400000));
  } else {
    L.push('DTSTART:' + icsStamp(ev.begin));
    L.push('DTEND:' + icsStamp(ev.end));
  }
  L.push('SUMMARY:' + icsEsc(ev.title));
  if (ev.loc) L.push('LOCATION:' + icsEsc(ev.loc));
  L.push('DESCRIPTION:' + icsEsc(ev.desc));
  L.push('BEGIN:VALARM');
  L.push('TRIGGER:-PT12H');          // 前一天晚上提醒一次，考试当天早上能看见
  L.push('ACTION:DISPLAY');
  L.push('DESCRIPTION:' + icsEsc(ev.title));
  L.push('END:VALARM');
  L.push('END:VEVENT');
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

/* ---------------- 整学期课表 → 日历文件 ----------------
 *
 * 用户 2026-11-11：「其他模块也可以去找找开源的成熟方案，取其精华」。
 * 开源课表项目（WakeUp / 晴课表 / 各类学习通助手）里最值得抄的一条就是
 * **导出一份 .ics**：手机自带日历、电脑上的 Outlook、iOS 都能读，
 * 不用我们自己做提醒，也不占用通知权限。
 *
 * 🔴 为什么不是「一条条加进系统日历」（考试那条走的路）：
 *    一学期几十次课，每次都弹一次「新建事件」界面让用户点保存，
 *    等于让他自己抄一遍。几百个事件必须一次成文、一次导入。
 *
 * 🔴 日期一律复用 `startDate()` + 第几周 × 7 天的**同一个公式**
 *    （就是课表本身用的那条），不自己重新算开学日。两处各算一遍，
 *    迟早出现「日历里是周二、课表里是周三」。
 */

/** UTF-8 下这个字符占几个字节。折行按字节算，不按字符算。 */
function utf8Len(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

/** 按 RFC 5545 折行：一行不超过 75 个**字节**，续行以空格开头。
 *
 *  🔴 这是个不会报错但会静默失败的坑：中文一个字 3 字节，25 个汉字就到 75 了。
 *     不折行的整份文件，部分日历软件会直接拒收（Android 自带的能读，
 *     Outlook 和 Google 日历不行），用户看到的是「导入失败」而不知道原因。
 *  🔴 不能按字符数折：`DESCRIPTION` 里混着中英文和 emoji，按字符算必然超字节数。
 *  🔴 不能把多字节字符切开（半个汉字就是乱码）：所以按**码点**遍历，
 *     一个码点整体判断放不放得下。
 */
function icsFold(line) {
  const s = String(line);
  const out = [];
  let buf = '';
  let bytes = 0;
  for (const ch of s) {
    const n = utf8Len(ch);
    // 首行 75 字节；续行前面那个空格也算 1 字节，所以续行内容最多 74。
    if (bytes + n > 75) {
      out.push(buf);
      buf = ' ';
      bytes = 1;
    }
    buf += ch;
    bytes += n;
  }
  out.push(buf);
  return out.join('\r\n');
}

/** 一批事件 → 一整份 .ics。
 *
 *  `events` 每项：{ title, desc, loc, begin, end }（毫秒，本地时区）。
 *  只写普通定时事件 —— 全天事件留给考试那条路，课表用不上。
 */
function icsTextMulti(events, prodid, calName) {
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + prodid,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // 这两个 X- 字段不是标准，但各家日历都认：导入后日历名字就是它，
    // 用户在一堆日历里能把「课表」认出来（不写的话会变成「未命名」）。
    'X-WR-CALNAME:' + icsEsc(calName),
    'X-WR-TIMEZONE:Asia/Shanghai',
  ];
  const stamp = icsStamp(Date.now());
  (events || []).forEach((ev, i) => {
    L.push('BEGIN:VEVENT');
    // 🔴 UID 必须唯一且稳定。重导一次如果 UID 变了，日历里就会出现两份。
    //    这里用「时间 + 序号」：同一份课表每次导出的 UID 一致。
    L.push('UID:' + icsStamp(ev.begin).replace(/Z$/, '') + '-' + i + '-sched@dongyoutong');
    L.push('DTSTAMP:' + stamp);
    L.push('DTSTART:' + icsStamp(ev.begin));
    L.push('DTEND:' + icsStamp(ev.end));
    L.push('SUMMARY:' + icsEsc(ev.title));
    if (ev.loc) L.push('LOCATION:' + icsEsc(ev.loc));
    if (ev.desc) L.push('DESCRIPTION:' + icsEsc(ev.desc));
    L.push('BEGIN:VALARM');
    // 提前量按事件给：课表 15 分钟（走到教室就够），作业 2 小时（还来得及写）。
    L.push('TRIGGER:-PT' + (Number(ev.alarm) > 0 ? Number(ev.alarm) : 15) + 'M');
    L.push('ACTION:DISPLAY');
    L.push('DESCRIPTION:' + icsEsc(ev.title));
    L.push('END:VALARM');
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');
  // 每一行都要折，折完再拼 CRLF（RFC 5545 硬性要求 \r\n）。
  return L.map(icsFold).join('\r\n') + '\r\n';
}

/** 把「星期几的第几节」这些格子，按天合并成连续的段。
 *
 *  第 3、4 节连堂在数据里是两条 slot，直接一条一个事件会变成两个
 *  「各 45 分钟」的日程，中间还夹着课间 —— 学生看到的是一天里两节课，
 *  而不是一门课连上两节。合并后按**第一段的开始到最后一段的结束**算。
 */
function courseBlocks(c) {
  const byDay = {};
  (c.slots || []).forEach((s) => {
    const d = Number(s && s.day);
    const p = Number(s && s.period);
    if (!(d >= 0 && d < 7) || !(p >= 0)) return;
    (byDay[d] = byDay[d] || []).push(p);
  });
  const out = [];
  Object.keys(byDay).forEach((d) => {
    const ps = byDay[d].sort((a, b) => a - b);
    const blocks = [];
    ps.forEach((p) => {
      const last = blocks[blocks.length - 1];
      // 同一节重复出现（调课记录合并过）不算新的段
      if (last && p === last[1]) return;
      if (last && p === last[1] + 1) last[1] = p;
      else blocks.push([p, p]);
    });
    blocks.forEach((b) => out.push({ day: Number(d), from: b[0], to: b[1] }));
  });
  return out;
}

/** 这学期的每一次课 → 日历事件。
 *
 *  🔴 取不到上下课时间的格子**整段跳过**，不猜。
 *     猜出来的时间会实打实地在用户日历里提前半小时响铃，比没有更坏。
 *     （作息可以在「我的 → 上课时间」里改，改完再导一次就是对的。）
 */
function scheduleEvents() {
  const tt = times();
  const total = totalWeeks();
  const out = [];
  const skipped = [];
  allCourses().forEach((c) => {
    const weeks = (c.weeks || []).map(Number)
      .filter((w) => w >= 1 && w <= total);
    if (!weeks.length) {
      // 一门课一周都没有（数据不对）—— 记下来，导出完如实告诉用户
      if (c.slots && c.slots.length) skipped.push(String(c.name || ''));
      return;
    }
    courseBlocks(c).forEach((b) => {
      const hasRecordedTimes = c.source === 'nepu' && c.startTime && c.endTime;
      const st = hasRecordedTimes ? hhmmToMin(c.startTime) : hhmmToMin(tt[b.from] && tt[b.from][0]);
      const en = hasRecordedTimes ? hhmmToMin(c.endTime) : hhmmToMin(tt[b.to] && tt[b.to][1]);
      if (st == null || en == null || en <= st) {
        skipped.push(String(c.name || ''));
        return;
      }
      weeks.forEach((w) => {
        const day = addDays(startDate(), (w - 1) * 7 + b.day);
        const base = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
        const lines = [];
        if (c.teacher) lines.push('教师 ' + c.teacher);
        lines.push('来自「东油通」，以教务系统为准');
        out.push({
          title: String(c.name || '课程'),
          desc: lines.join('\n'),
          loc: c.room ? String(c.room) : '',
          begin: base + st * 60000,
          end: base + en * 60000,
        });
      });
    });
  });
  out.sort((a, b) => a.begin - b.begin);
  return { events: out, skipped: Array.from(new Set(skipped)) };
}

/** 把生成好的文本交给「该收的人」：APK 走系统分享，网页走下载。
 *
 *  🔴 这里不能复用 `downloadIcs`：APK 的 WebView 里点 `<a download>` 是**没反应**的
 *     （没有 DownloadListener 接 blob:），用户会以为按钮坏了。原生那边写文件 +
 *     ACTION_SEND，交给系统日历 / 文件管理器 / 微信都行。
 */
function shareCalendar(name, text, okMsg) {
  const nat = (NATIVE && window.NativeApi &&
    typeof window.NativeApi.shareFile === 'function') ? window.NativeApi : null;
  if (nat) {
    let r = '';
    try {
      r = String(nat.shareFile(name, text, 'text/calendar') || '');
    } catch (e) {
      r = 'fail: ' + e;
    }
    if (r === '') { toast(okMsg); return true; }
    // 'none' = 老版本壳没有这个方法，退回去走下载那条路
    if (r !== 'none') { toast('打不开分享：' + r.replace(/^fail[:：]\s*/, ''), 3500); return true; }
  }
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('已下载 ' + name);
  return true;
}

/** 导出整学期课表。 */
function exportScheduleIcs() {
  const r = scheduleEvents();
  if (!r.events.length) {
    toast('课表还空着，没有可以导出的课');
    return;
  }
  const name = ('东油通-课表-' + ymd(startDate())).replace(/[\\/:*?"<>|]/g, '_') + '.ics';
  const text = icsTextMulti(r.events, '-//DongYouTong//Schedule//CN', '课表');
  shareCalendar(name, text, '已生成 ' + r.events.length + ' 次课，可导出到日历');
  if (r.skipped.length) {
    // 「有几门课没导出来」必须说出来 —— 否则用户以为导全了，
    // 到了教室发现日历里没有这门课，会以为是我们算错了日期。
    toast(r.skipped.length + ' 门课没排上课时间，没导出：' + r.skipped.join('、'), 4000);
  }
}

/** 还没交的作业 / 待考的试 → 日历事件。
 *
 *  用户 2026-11-11：「再加个作业结束时间日历」。导出成 .ics 交给系统日历，
 *  比自己再造一个日历页划算 —— 截止时间该和课、和别的日程摆在一起看。
 *
 *  数据来自本机那份截止时间缓存（`KEY.due`，扫描时顺手存的，作业提醒也用它）。
 *  🔴 只认 `e`（截止时刻）**明确存在**的那些。实测真有「未交但没写截止时间」
 *     的作业，给它编一个时间是假的 —— 那会在用户日历里多出一个不存在的日子。
 *  🔴 事件占「截止前 15 分钟」这一段，不是整整一小时：它在日历上是个块，
 *     而不是一条横跨一小时的安排。提醒提前 2 小时，和 App 里那条一致。
 */
function dueEvents() {
  const c = store.get(KEY.due, null);
  const list = (c && Array.isArray(c.list)) ? c.list : [];
  const now = Date.now();
  const out = [];
  list.forEach((it) => {
    const end = Number(it && it.e) * 1000;
    if (!(end > now)) return;                 // 过点的、没写时间的都不导
    if (dueMarked(it)) return;                // 「我交过了」的不进日历
    const kind = it.k === 'exam' ? '考试' : '作业';
    const name = String(it.t || '').trim() || kind;
    out.push({
      title: kind + ' · ' + name,
      desc: (it.c ? String(it.c) + '\n' : '') + '来自「东油通」，以学习通为准',
      loc: '',
      begin: end - 15 * 60000,
      end: end,
      alarm: 120,
    });
  });
  out.sort((a, b) => a.begin - b.begin);
  return out;
}

/** 把待交的作业整批导进系统日历。 */
function exportDueIcs() {
  const evs = dueEvents();
  if (!evs.length) {
    toast('没有写截止时间的作业');
    return;
  }
  const name = ('东油通-作业-' + ymd(today0())).replace(/[\\/:*?"<>|]/g, '_') + '.ics';
  const text = icsTextMulti(evs, '-//DongYouTong//Due//CN', '作业');
  shareCalendar(name, text, '已生成 ' + evs.length + ' 条，可导出到日历');
}

/** 网页版：把 .ics 下载下来。 */function downloadIcs(ev) {
  const base = String(ev.title).replace(/^考试[:：]\s*/, '');
  const name = ('东油通-' + base + '-' + icsDay(ev.begin))
    .replace(/[\\/:*?"<>|]/g, '_') + '.ics';
  const blob = new Blob([icsText(ev)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('已下载 ' + name + '，用日历打开即可');
}

/** 点「加进日历」的落地动作：APK 走原生，网页走下载。 */
function addExamToCalendar(ev) {
  const nat = (NATIVE && window.NativeApi &&
    typeof window.NativeApi.addCalendar === 'function') ? window.NativeApi : null;
  if (nat) {
    const r = String(nat.addCalendar(ev.title, ev.desc, ev.loc,
      ev.begin, ev.end, !!ev.allDay) || '');
    if (r === '') {
      toast('已打开日历，确认时间后保存');
      return;
    }
    // 'none' = 这个版本的壳没有日历能力（老 APK），退回去下载 .ics
    if (r !== 'none') {
      toast('打不开日历：' + r.replace(/^fail[:：]\s*/, ''), 3500);
      return;
    }
  }
  downloadIcs(ev);
}

/** 列表里的按钮是每次重画出来的，所以用事件委托，只绑一次。 */
$('exList').addEventListener('click', (e) => {
  if (!e.target.closest) return;
  // 0.35.0：已考完那一段默认是收着的，点一下展开（再点收起）
  if (e.target.closest('#exFold')) {
    examPastOpen = !examPastOpen;
    renderExams();
    return;
  }
  const btn = e.target.closest('.excal');
  if (!btn) return;
  const it = examItems[Number(btn.dataset.i)];
  if (!it) return;
  const ev = examEvent(it.e);
  if (ev) addExamToCalendar(ev);
});

/** 考试列表。
 *
 *  🔴 空态必须分三种，不能一律说「没有考试」：
 *     ① 没绑账号 —— 让他去绑；
 *     ② 学校还没排考（published=false）—— 是**学校没发**，不是我们漏了；
 *     ③ 取数出错 —— 把错误原话摆出来，别装成「没有」。
 *     把「没读到」说成「没有」，就是在把错误说成事实。
 *
 *  选学期之后还要多分一种：**这一学期**没排考 ≠ 所有学期都没排考，
 *  文案里必须点出是哪一学期，否则用户会以为整个软件都没有考试数据。
 */

/** 选学期用的 chip 列表。
 *
 *  教务系统给 53 个学期，全摆出来没法看。只留「他读过 / 正在读」的：
 *  入学年之后、且不晚于当前学期。未来的学期一定没有考试，摆出来是空按钮。
 *
 *  🔴 一个都筛不出来时返回空数组，界面退回「只看当前学期」，
 *     绝不硬编几个假学期糊上去 —— 点进去是空的，比没有按钮更让人困惑。
 */
function studyTerms() {
  const ex = (DATA && DATA.exams) || null;
  const raw = (ex && ex.semesters) || [];
  // ⚠️ 边界必须是**教务系统的当前学期**，不能图省事用 semesterName()：
  //    那个在看历史学期时会返回历史学期名，列表就被截到那一年之前 ——
  //    用户正在看的那一学期自己反倒不在列表里，选完回不去。
  const cur = academicTerm(DATA && DATA.semester);
  const y0 = enrolledYear();
  const out = [];
  const seen = {};
  raw.forEach((s) => {
    const a = termParts(s && s.name);
    if (!a || !s.id || seen[s.id]) return;
    if (a.y > cur.y || (a.y === cur.y && a.s > cur.s)) return;   // 还没开学
    if (y0 && a.y < y0) return;                                  // 入学之前
    seen[s.id] = 1;
    out.push({ id: s.id, name: s.name, y: a.y, s: a.s,
      label: gradeName(a.y, a.s) || s.name });
  });
  out.sort((a, b) => (a.y - b.y) || (a.s - b.s));
  return out;
}

/** 考试页的学期 chip 列表 = 在读的那几个学期（和课表页共用一份筛选）。 */
function examTerms() {
  if (DATA && DATA.source === 'nepu') {
    const ex = DATA.exams || {};
    return [{id: ex.semesterId || '', label: DATA.semester || '已同步学期'}];
  }
  return studyTerms();
}

/** 某一学期的考试数据：当前学期用同步下来的那份，其余查缓存。 */
function examBucket(sid) {
  const ex = (DATA && DATA.source === 'nepu' && DATA.exams) || null;
  const curId = (ex && ex.semesterId) || '';
  if (!sid || sid === curId) return ex;
  return ((DATA && DATA.examsBySem) || {})[sid] || null;
}

function renderExamChips(terms) {
  const box = $('exChips');
  if (!box) return;
  if (terms.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = terms.map((t) =>
    '<button class="chip' + (t.id === examTerm ? ' on' : '') +
    '" data-sid="' + esc(t.id) + '">' + esc(t.label) + '</button>').join('');
  box.querySelectorAll('.chip').forEach((b) => {
    b.addEventListener('click', () => selectExamTerm(b.dataset.sid));
  });
}

/* ---------------- 学习：外部平台 / 学校平台 ----------------
 *
 * 成绩原来单独占一个底部 tab。用户 2026-10-19 的原话：
 *   「查询成绩使用的频率比较低，不需要单独列出」
 * 一学期也就期末看几次，占着一个常驻入口不值当 —— 并进考试页，
 * 上面一个分段切换，底部 tab 从五个回到四个。
 *
 * 2026-10-22 用户又说：
 *   「学习通功能可以跟考试合并，就叫学习，进入这个界面后先展示学习通，
 *    其他的考试学分什么的放到什么的选项里」
 * ⇒ 底部 tab 改叫「学习」，分段多出第一项「学习通」，且是默认视图。
 *
 * 🔴 2026-11-04 再改：用户要按**来源**分两类 ——
 *   「学习通和其他平台是同一类的，属于外部平台；
 *     考试成绩学分这些是学校平台，属于一类」
 *
 *   做法是**一行里分两组**，不是上下两行。为什么不做成两级导航：
 *   多一行就是 46px，而学习通页在 360×712 上只剩 9px 余量
 *   （check_one_screen 量的 534 / 544），加一行要超 37px。
 *   分类靠分组标签表达，一行里也能一眼看出哪几颗是一组。
 *
 *   以后再接平台：往 EX_VIEWS 里加一项、在 EX_GROUP 里标它是外部就完了，
 *   学校那组一个字都不用动 —— 这正是用户说的「以后可能会适配更多平台」。
 *
 * 🔴 选中的视图记进 CFG（`examView`）：连着看成绩的那几天，
 *    不该每次进来都先点一下「成绩」。默认是「学习通」。
 */
const EX_VIEWS = ['cx', 'exam', 'grade', 'credit'];
const EX_GROUP = {
  cx: '外部平台',
  exam: '学校平台', grade: '学校平台', credit: '学校平台',
};
const EX_NAME = { cx: '学习通', exam: '考试', grade: '成绩', credit: '学分' };
const EX_HEAD = { cx: '学习', exam: '考试', grade: '成绩', credit: '学分' };

/** 导航条：同一组里的连着画，组与组之间画一道竖线。
 *
 *  🔴 2026-11-12：两个分组名（外部平台 / 学校平台）从这一行里撤走了。
 *     它们各占 45px / 55px，五颗 chip 加上它们一共 479px —— 412 屏只有 384，
 *     「考试 / 成绩 / 学分」整排滚到屏幕外，用户看到的只有外部平台那一组
 *     （他原话：「外部平台太过显眼，把学校界面完全挤出屏幕外了」）。
 *     现在名字挂到页面标题旁边（`#exGroup`），这一行只留五颗 chip：
 *     分组靠一道竖线 + `data-group` 表达，选中的那颗才有颜色，其余是灰字。
 *     接新平台：往 `EX_VIEWS` 加一项、在 `EX_GROUP` 里标来源，别处都不用动。
 */
function renderExNav(cur) {
  const box = $('exNav');
  if (!box) return;
  let html = '';
  let last = '';
  EX_VIEWS.forEach((k) => {
    const g = EX_GROUP[k];
    if (last && g !== last) html += '<span class="exnav-sep" aria-hidden="true"></span>';
    last = g;
    html += '<button class="exnav-b' + (k === cur ? ' on' : '') +
            '" data-view="' + esc(k) + '" data-group="' + esc(g) + '"' +
            ' aria-pressed="' + (k === cur ? 'true' : 'false') + '">' +
            esc(EX_NAME[k]) + '</button>';
  });
  box.innerHTML = html;
  // 标题旁边那个眉标：这一格属于哪一类。空值不画（防以后加视图忘了填）。
  const eb = $('exGroup');
  if (eb) {
    const g = EX_GROUP[cur] || '';
    eb.textContent = g;
    eb.hidden = !g;
  }
  box.querySelectorAll('.exnav-b').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.view === CFG.examView) return;
      setExamView(b.dataset.view);
    });
  });
  // 选中的那颗永远要看得见：窄屏上五颗可能还是放不下（320dp），
  // 一路滚到右边才发现自己被选中，等于「点了看不见」。
  const on = box.querySelector('.exnav-b.on');
  if (on && on.scrollIntoView) {
    try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  }
}

function renderExamView() {
  const v = EX_VIEWS.indexOf(CFG.examView) >= 0 ? CFG.examView : 'cx';
  EX_VIEWS.forEach((k) => {
    const el = $('exView' + k.charAt(0).toUpperCase() + k.slice(1));
    if (el) el.hidden = (k !== v);
  });
  $('exHead').textContent = EX_HEAD[v] || '学习';
  renderExNav(v);
  if (v === 'cx') cxPaint();
  if (v === 'grade') renderGrades();
  if (v === 'credit') renderCredit();
}

function setExamView(v) {
  CFG.examView = EX_VIEWS.indexOf(v) >= 0 ? v : 'cx';
  store.set(KEY.settings, CFG);
  renderExamView();
}

function renderExams() {
  const ex = (DATA && DATA.source === 'nepu' && DATA.exams) || null;
  const curId = (ex && ex.semesterId) || '';
  const terms = examTerms();
  if (!examTerm) examTerm = curId;
  // 选中的学期不在列表里（换了账号、学期列表变了）⇒ 回到当前学期
  if (terms.length && !terms.some((t) => t.id === examTerm)) examTerm = curId;
  renderExamChips(terms);
  renderPrefetchHint();

  const bucket = examBucket(examTerm);
  const list = (bucket && bucket.exams) || [];
  const has = list.length > 0;
  const err = (bucket && bucket.error) || EXAM_ERR[examTerm] || '';
  // 只有「正在取的就是选中这个学期」才算 loading
  const loading = examLoading && examLoadingSid === examTerm && !bucket;
  const cur = !examTerm || examTerm === curId;
  const pick = terms.find((t) => t.id === examTerm);
  const which = pick ? pick.label : '';

  $('exLoading').hidden = !loading;
  $('exEmpty').hidden = has || loading;
  $('exBody').hidden = !has;

  if (!has) {
    if (loading) return;
    const bound = !!(DATA && DATA.profile && DATA.profile.studentId) || !!(DATA && DATA.source === 'nepu');
    const title = $('exEmptyTitle');
    const text = $('exEmptyText');
    $('goBind3').hidden = bound;
    $('exRetry').hidden = !(bound && err);
    if (!bound) {
      title.textContent = '还没绑定账号';
      text.textContent = '前往账号管理登录学校 WebVPN，再同步考试安排。';
    } else if (err) {
      title.textContent = which ? (which + '的考试没取到') : '考试安排没取到';
      text.textContent = '教务系统那边出了点问题：' + err;
    } else if (!cur) {
      title.textContent = which ? (which + '没有考试安排') : '这一学期没有考试安排';
      text.textContent = '教务系统本学年无排考数据，请切换学期查看。';
    } else {
      title.textContent = DATA && DATA.source === 'nepu' ? '该学期暂无考试安排' : '学校还没发布考试安排';
      // 0.39.1：原来这句后半截是「这不是漏同步 —— 等学校排好考，点右上角刷新
      // 就有了」。前半截是在解释**我们的同步没坏**，用户没怀疑过这件事；
      // 后半截才是他要做的。留后半截（「点右上角刷新」给了动作）。
      text.textContent = DATA && DATA.source === 'nepu' ? '学校发布后，点右上角刷新同步。' : '等学校排好考，点右上角刷新。';
    }
    return;
  }

  // 有日期的按日期排，没日期的排最后（保持原顺序，别打乱）
  const items = list.map((e, i) => ({ e, d: examDate(e.date), i }));
  items.sort((a, b) => {
    if (a.d && b.d) return (a.d - b.d) || (a.i - b.i);
    if (a.d) return -1;
    if (b.d) return 1;
    return a.i - b.i;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = items.find((x) => x.d && x.d >= today);

  // 选中的是不是**已经过完**的学期。
  // 🔴 这一条决定了「待定」还是「已结束」：大一下整体都过去了，
  //    里面那门「认识实习」学校写的是「时间未安排」—— 整学期不能因此
  //    显示成「还有考试没定日期」（用户 2026-10-19 直接指出来了）。
  // ⚠️ 边界用 DATA.semester（教务的当前学期），不能用 semesterName()：
  //    课表页翻到历史学期时它会返回历史学期名，于是所有考试都会被算成「未来学期」。
  const curT = academicTerm((DATA && DATA.semester) || '');
  const isPastTerm = !!(pick && (pick.y < curT.y || (pick.y === curT.y && pick.s < curT.s)));

  let sum = '<div class="exsum-main"><span>共</span><b>' + items.length + '</b><span>场考试</span></div>';
  if (next) {
    // 用「日期相减 / 一天毫秒数」而不是小时数：跨夏令时也不至于差 1 天
    const days = Math.round((next.d - today) / 86400000);
    // 「3 天」+「后最近一场」分两行读起来是断的（后 / 最近一场）。
    // 改成「3 天后」+「最近一场」，两行各自成句。
    sum += '<div class="exsum-side"><b>' + (days === 0 ? '今天' : days + ' 天后') + '</b>' +
      '<span>最近一场</span></div>';
  } else if (!isPastTerm && items.some((x) => !x.d)) {
    // 当前/未来学期里有没定日期的场次，才叫「待定」
    sum += '<div class="exsum-side"><b>待定</b><span>还有考试没定日期</span></div>';
  } else {
    sum += '<div class="exsum-side"><b>已结束</b><span>都是过去的考试</span></div>';
  }
  $('exSummary').innerHTML = sum;

  const row = (k, v) => (blankField(v) ? '' :
    '<div class="exrow"><i>' + k + '</i><span>' + esc(v) + '</span></div>');

  const built = items.map(({ e, d }, idx) => {
    // 过去的学期里每一场都算过去（包括学校没给日期的那场）
    const past = isPastTerm || (d && d < today);
    // 学校对没排时间的场次会直接写「时间未安排」，照它的说法显示，
    // 别一律写「待定」—— 那会让人以为还没定、还有机会安排。
    const md = d ? (d.getMonth() + 1) + '/' + d.getDate()
      : (/未安排|未定/.test(String(e.date || '')) ? '未安排' : '待定');
    const wd = d ? '周' + DAY_CN[(d.getDay() + 6) % 7] : '';
    // 逐场倒计时。顶上那条汇总只说「最近一场还有几天」，
    // 但一个学期常有四五场，谁近谁远得一场一场看 —— 否则得自己拿日期减。
    // 已考完的不写「-5 天」：那既不是倒计时也不好看，整张卡本来就压暗了。
    const leftDays = d ? Math.round((d - today) / 86400000) : null;
    const leftTxt = leftDays === null || leftDays < 0 ? ''
      : (leftDays === 0 ? '今天' : leftDays === 1 ? '明天' : leftDays + '天后');
    // 三天以内用强调色：再远的天天标红，整列都在喊，反而看不出哪个最急。
    const leftHtml = leftTxt
      ? '<i class="excd' + (leftDays <= 3 ? ' soon' : '') + '">' + leftTxt + '</i>' : '';
    const meta = [e.category, e.form, e.code].filter(Boolean).join(' · ');
    let rows = row('时间', e.arrange);
    rows += row('地点', e.room);
    rows += row('座位', e.seat);
    // 没日期时才把「考试周次与星期」拿出来当参考，有日期就不重复占地方
    if (!d) rows += row('周次', e.weekText);
    rows += row('情况', e.status);
    rows += row('说明', e.note);

    // 能算出真实时间的场次才给「加进日历」；没日期的（学校写「时间未安排」）
    // 加进去只会多一个不知道该放哪天的事件。已经考完的也不给 —— 加进去干嘛。
    const canCal = !past && !!examEvent(e);
    if (canCal) {
      rows += '<button class="excal" data-i="' + idx + '" type="button">加进日历</button>';
    }

    return { past: past, html: '<div class="exitem' + (past ? ' past' : '') + '">' +
      '<div class="exdate' + (d ? '' : ' txt') + '"><b>' + esc(md) + '</b>' +
      (wd ? '<span>' + wd + '</span>' : '') + leftHtml + '</div>' +
      '<div class="exmain">' +
      '<div class="exname">' + esc(e.name) + '</div>' +
      (meta ? '<div class="exmeta">' + esc(meta) + '</div>' : '') +
      rows +
      '</div></div>' };
  });

  // ---- 0.35.0：考完的收起来 ----
  // 一个学期常见的形状是「接下来 3 场、已经考过 9 场」。那 9 场一直铺在
  // 下面，把「下一场什么时候」压到需要滑屏才看得到 —— 而来看这一页的人
  // 关心的就是接下来考什么。收成一行按钮，点开照旧逐条看，一个字都不删。
  // 🔴 两种情况不收：
  //    ① 这个学期整段都在过去（用户主动切回来翻旧账，收起来等于什么都没有）
  //    ② 一场都没剩（全考完了，那这些就是他来看的东西）
  const ahead = built.filter((x) => !x.past);
  const gone = built.filter((x) => x.past);
  if (!ahead.length) {
    $('exList').innerHTML = gone.map((x) => x.html).join('');
  } else {
    $('exList').innerHTML = ahead.map((x) => x.html).join('') +
      (gone.length
        ? '<button class="exfold" id="exFold" aria-expanded="' +
            (examPastOpen ? 'true' : 'false') + '">' +
            '<span>已考完 ' + gone.length + ' 场</span>' +
            '<i>' + (examPastOpen ? '收起' : '展开') + '</i></button>' +
          (examPastOpen ? gone.map((x) => x.html).join('') : '')
        : '');
  }
  examItems = items;
}

/** 点了某一学期的 chip。缓存里有就直接画，没有就去教务系统取。 */
function selectExamTerm(sid) {
  if (!sid) return;
  examTerm = sid;
  // 换学期 ⇒ 「已考完」回到收着的状态。不然上个学期展开着，
  // 切过来直接铺开一屏旧考试，看着像切换没生效。
  examPastOpen = false;
  renderExams();                       // 先把选中态画出来，别等请求回来才高亮
  if (!examBucket(sid) && !EXAM_ERR[sid]) loadExamTerm(sid);
}

/** 取某一学期的考试安排。
 *
 *  🔴 取失败**不能**安静地画成「没有考试」：把原因记进 EXAM_ERR，
 *     界面显示「这一学期的考试没取到 + 原因」，还留一个「再试一次」。
 *     缓存只存成功的（DATA.examsBySem 落盘），失败只在内存里，
 *     下次进考试页会重新试一遍。
 */
async function loadExamTerm(sid) {
  if (!sid || (DATA && DATA.source === 'nepu')) return;
  // 单飞：一次只发一个请求，别把学校服务器打成并发的。
  // 取数期间又点了别的学期就记下来，这一次结束再补。
  if (examLoading) { examPending = sid; return; }
  examLoading = true;
  examLoadingSid = sid;
  renderExams();
  try {
    const res = await api('/api/exams', { semesterId: sid });
    if (res && res.ok) {
      delete EXAM_ERR[sid];
      const rec = {
        exams: res.exams || [],
        published: !!res.published,
        semesterId: res.semesterId || sid,
        at: Math.floor(Date.now() / 1000),
      };
      if (DATA) {
        DATA.examsBySem = DATA.examsBySem || {};
        DATA.examsBySem[sid] = rec;
        store.set(KEY.data, DATA);
        // 课表上那几条考试带子要跟着变（索引是懒建的，见 examIndex）。
        _exIdx = null;
        // 🔴 和作业那条同理（见 dueCacheSave 末尾）：考试是开机后**补取**的，
        //    首屏画的时候带子还没有。不重画的话，用户要切一次页才看得见 ——
        //    表现出来就是「课表上什么都没有」。
        if (CUR_PAGE === 'schedule') renderSchedule();
      }
    } else {
      EXAM_ERR[sid] = (res && res.error) || '教务系统没给数据';
    }
  } catch (e) {
    EXAM_ERR[sid] = e.message || String(e);
  } finally {
    examLoading = false;
    examLoadingSid = '';
    renderExams();
    // 取的过程中用户又点了别的学期 ⇒ 接着取那个
    const next = examPending;
    examPending = '';
    if (next && next !== sid && !examBucket(next) && !EXAM_ERR[next]) loadExamTerm(next);
  }
}

// ------------------------------------------------------------------ 后台补取考试

/** 补取进度提示。
 *
 *  为什么要有：绑定后会把「他在读的每一学期」的考试都提前拉一遍，这个过程
 *  几秒到十几秒。不说一声的话，用户切学期时看到的那一下等待就是没来由的。
 */
function renderPrefetchHint() {
  const el = $('exPrefetch');
  if (!el) return;
  if (!prefetching || !prefetchTotal) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = '正在提前取其他学期的考试 · ' + prefetchDone + '/' + prefetchTotal;
}

/** 停掉正在跑的补取（解绑、清缓存时用）。不调的话那一轮会继续往
 *  已经清空的 DATA 里写，而且进度条会挂在「还没绑定账号」的页面上。 */
function cancelPrefetch() {
  prefetchTok++;
  prefetching = false;
  prefetchTotal = 0;
  prefetchDone = 0;
  renderPrefetchHint();
}

/** 把「他在读的每一学期」的考试都提前取一遍，存进 examsBySem。
 *
 *  用户 2026-10-19：「首次绑定账号后直接把咱们软件能同步的东西全给同步了吧，
 *  比如考试信息，不然看考试信息还得在对应页面上等半天。」
 *
 *  整份同步本来就带**当前学期**的考试，缺的是其他学期：以前要等用户点 chip
 *  才现取，一次三四秒。这里在同步结束后按顺序补上，之后切学期就是瞬间的。
 *
 *  🔴 必须串行、且只补没缓存的：并发会把学校服务器打疼（登录那边有 3 秒防抖），
 *     而且 examsBySem 是落盘的，第二次启动一个都不用取。
 *  🔴 失败不重试、也不吞：loadExamTerm 会把原因记进 EXAM_ERR，用户切过去
 *     看到的是「没取到 + 原话 + 再试一次」，而不是「这学期没有考试」。
 */
async function prefetchExams() {
  // 先作废上一轮：换账号 / 重新同步时，旧那一轮还在跑的话必须自己退出，
  // 否则它会把上一个账号的考试写进这个账号的缓存里。
  const tok = ++prefetchTok;
  prefetching = false;
  prefetchTotal = 0;
  prefetchDone = 0;

  if (!DATA || !DATA.profile || !DATA.profile.studentId) { renderPrefetchHint(); return; }
  const terms = examTerms();
  const curId = (DATA.exams && DATA.exams.semesterId) || '';
  const todo = terms.filter((t) => t.id !== curId && !examBucket(t.id) && !EXAM_ERR[t.id]);
  if (!todo.length) { renderPrefetchHint(); return; }

  prefetching = true;
  prefetchTotal = todo.length;
  renderPrefetchHint();
  try {
    for (let i = 0; i < todo.length; i++) {
      if (tok !== prefetchTok) return;
      const sid = todo[i].id;
      // 前面可能有人在取（用户自己点了 chip）⇒ 等它落地再发下一个，绝不并发
      while (examLoading) {
        await new Promise((r) => setTimeout(r, 120));
        if (tok !== prefetchTok) return;
      }
      if (examBucket(sid) || EXAM_ERR[sid]) {
        prefetchDone++; renderPrefetchHint(); continue;
      }
      await loadExamTerm(sid);
      if (tok !== prefetchTok) return;         // 取的过程中换了账号，别动计数器
      prefetchDone++;
      renderPrefetchHint();
    }
  } finally {
    if (tok === prefetchTok) { prefetching = false; renderPrefetchHint(); }
  }
}

// ------------------------------------------------------------------ 空闲教室
//
// 数据全部来自学校教务系统的「空闲教室查询」（/eams/classroom/apply/free.action）。
// 我们只是把它的表单换成点两下就能用的样子，**不猜、不补、不缓存结果**：
// 空教室是「现在这一刻」的状态，昨天查到的今天没意义，落盘反而会骗人。
//
// 🔴 两个已知的服务端脾气（都是实测出来的，不是猜的）：
//   1. 不先摸一次 stdDetail，服务端会说 project not selected（500）；
//   2. 不传 pageSize，只回 20 行 —— 而且那 20 行是按容量升序的前 20 个，
//      全是常年空着的小实验室，换个节次换个日期看起来「一模一样」。
//   这两条在 eams.py / native.js 里已经处理掉了，界面只需要如实显示 truncated。

/** 节次块：两块一组，跟作息表对得上。学校接口收的是「第几节」。 */
/** 节次块：两节一组，跟作息表对得上。学校接口收的是「第几节」。
 *
 *  🔴 块数**不能写死**。这里以前硬编码了 6 块（1-2 … 11-12），是照「常见高校
 *     12 节」抄的 —— 实际只有 10 节，于是界面上凭空多出一个「11-12」，
 *     用户会以为学校真有第 11、12 节课（2026-10-20 用户就是照这个问的）。
 *
 *  真值从 `curTT().unitCount` 来：它是教务系统课表 HTML 里 `unitCount = 10`
 *  直接读出来的，学校自己声明的节次数，比任何猜测都可靠（见 native.js
 *  parseTimetable）。没同步过课表时按 10 兜底。
 *
 *  节数是奇数时最后一块会退化成「9-9」（`Math.min` 夹住），学校作息都是偶数，
 *  这里只为不越界，不为好看。 */
function roomBlocks() {
  const n = Math.max(2, (DATA && curTT().unitCount) || 10);
  const out = [];
  for (let p = 1; p <= n; p += 2) out.push([p, Math.min(p + 1, n)]);
  return out;
}

const ROOM = {
  date: '',          // YYYY-MM-DD
  p1: 1, p2: 2,      // 节次区间
  typeId: '', campusId: '', buildingId: '', seats: '', name: '',
  opts: null,        // {types, campuses, buildings}
  optsErr: '',
  optsLoading: false,
  filterOpen: false,
  res: null,         // 最近一次成功的结果
  err: '',           // 最近一次失败的原话
  loading: false,
  again: false,      // 查询期间又改了条件 ⇒ 这次回来再查一遍
  tok: 0,            // 轮次号：条件变了，旧响应直接丢
  autoTried: false,  // 本次打开 App 只自动查一次
  _sig: '',          // 筛选项的结构签名，没变就不重建 DOM
};

/** 默认查「接下来那一大节」。
 *  下午四点打开 App 却默认查上午 1-2 节，等于每次都要多按一下。 */
function defaultRoomBlock() {
  const tt = times();
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < tt.length; i++) {
    const end = tt[i] && tt[i][1];
    if (!end) continue;
    const hm = end.split(':').map(Number);
    if (hm[0] * 60 + hm[1] > mins) {
      // 第 i 节（0 起）落在哪一大节：0,1 → 1-2；2,3 → 3-4 ……
      // 上限是作息表自己的长度，不是写死的 12（实际只有 10 节）。
      const start = i - (i % 2) + 1;
      return [start, Math.min(start + 1, tt.length)];
    }
  }
  // 晚自习都下课了：给最后一大节（同样按节数算，不写死 9-10）。
  const bs = roomBlocks();
  return bs[bs.length - 1];
}

/** 默认查哪天：今天；今天的课都上完了就查明天。 */
function defaultRoomDate() {
  const tt = times();
  const last = tt.length ? tt[tt.length - 1][1] : '';
  let d = today0();
  if (last) {
    const hm = last.split(':').map(Number);
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() >= hm[0] * 60 + hm[1]) d = addDays(d, 1);
  }
  return ymd(d);
}

function roomInit() {
  if (ROOM.date) return;
  const b = defaultRoomBlock();
  ROOM.date = defaultRoomDate();
  ROOM.p1 = b[0];
  ROOM.p2 = b[1];
}

/** 换账号 / 清缓存：把上一次的查询结果和筛选项一起扔掉。
 *  留着别人的查询结果比留着别人的课表更糟 —— 那张表看起来完全是「现在的」。 */
function resetRooms() {
  ROOM.tok++;
  ROOM.res = null;
  ROOM.err = '';
  ROOM.loading = false;
  ROOM.again = false;
  ROOM.opts = null;
  ROOM.optsErr = '';
  ROOM._sig = '';
  ROOM.date = '';
  ROOM.autoTried = false;
  ROOM.typeId = '';
  ROOM.campusId = '';
  ROOM.buildingId = '';
  ROOM.seats = '';
  ROOM.name = '';
  renderRooms();
}

function roomDayLabel(key) {
  const d = parseYmd(key);
  return mdDot(d) + ' 周' + DAY_CN[(d.getDay() + 6) % 7];
}

function renderRoomDays() {
  const box = $('rmDays');
  if (!box) return;
  const t = today0();
  const short = [0, 1, 2].map((off) => ({ key: ymd(addDays(t, off)), label: ['今天', '明天', '后天'][off] }));
  const isShort = short.some((x) => x.key === ROOM.date);
  let html = short.map((x) =>
    '<button class="chip' + (x.key === ROOM.date ? ' on' : '') +
    '" data-day="' + x.key + '">' + x.label + '</button>').join('');
  // 「选日期」那个 chip 选中后要变成真实日期 —— 否则用户看不出自己选了哪天。
  html += '<button class="chip' + (isShort ? '' : ' on') + '" data-day="pick">' +
    (isShort ? '选日期' : esc(roomDayLabel(ROOM.date))) + '</button>';
  box.innerHTML = html;
  box.querySelectorAll('.chip').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.day === 'pick') { openRoomPicker(); return; }
      if (b.dataset.day === ROOM.date) return;      // 点的就是当前项：别白发一次请求
      ROOM.date = b.dataset.day;
      roomChanged();
    });
  });
}

function renderRoomPeriods() {
  const box = $('rmPeriods');
  if (!box) return;
  const blocks = roomBlocks();
  // 当前选中的块如果不在列表里（节数变少了，或者残留了旧的 11-12），
  // 夹回最后一个合法块 —— 否则整排按钮一个都不高亮，用户看不出自己在查哪节。
  if (!blocks.some((b) => b[0] === ROOM.p1 && b[1] === ROOM.p2)) {
    const last = blocks[blocks.length - 1];
    ROOM.p1 = last[0];
    ROOM.p2 = last[1];
  }
  box.innerHTML = blocks.map((b) =>
    '<button class="chip' + (b[0] === ROOM.p1 && b[1] === ROOM.p2 ? ' on' : '') +
    '" data-p1="' + b[0] + '" data-p2="' + b[1] + '">' + b[0] + '-' + b[1] + '</button>').join('');
  box.querySelectorAll('.chip').forEach((b) => {
    b.addEventListener('click', () => {
      const p1 = Number(b.dataset.p1), p2 = Number(b.dataset.p2);
      if (p1 === ROOM.p1 && p2 === ROOM.p2) return;
      ROOM.p1 = p1;
      ROOM.p2 = p2;
      roomChanged();
    });
  });
}

function roomFilterSummary() {
  const o = ROOM.opts || {};
  const pick = (list, id) => {
    const x = (list || []).find((i) => i.id === id);
    return x ? x.name : '';
  };
  const parts = [];
  const campus = pick(o.campuses, ROOM.campusId);
  const bld = pick(o.buildings, ROOM.buildingId);
  const typ = pick(o.types, ROOM.typeId);
  if (campus) parts.push(campus);
  if (bld) parts.push(bld);
  if (typ) parts.push(typ);
  if (ROOM.seats) parts.push('≥' + ROOM.seats + ' 座');
  if (ROOM.name) parts.push('「' + ROOM.name + '」');
  return parts.length ? parts.join(' · ') : '不限';
}

function renderRoomFilter() {
  const box = $('rmFilterBox');
  if (!box) return;
  box.hidden = !ROOM.filterOpen;
  $('rmFilterIco').style.transform = ROOM.filterOpen ? 'rotate(90deg)' : '';
  $('rmFilterSum').textContent = roomFilterSummary();

  // 结构没变就只同步值。整块重建会打断正在操作的输入框，
  // 也会让「刚选好的教学楼」在重画后跳回第一项。
  const sig = JSON.stringify([ROOM.opts, ROOM.optsErr, ROOM.optsLoading]);
  if (sig === ROOM._sig) {
    syncRoomFilterValues();
    return;
  }
  ROOM._sig = sig;

  if (!ROOM.opts) {
    if (ROOM.optsLoading) {
      box.innerHTML = '<div class="rmfilter-err">正在读取筛选项…</div>';
      return;
    }
    // 🔴 筛选项取不到**不影响查询**，别把整页弄成不可用；
    //    但也别装作「本来就没有筛选项」—— 把原因原话摆出来。
    box.innerHTML = '<div class="rmfilter-err">筛选项没取到：' +
      esc(ROOM.optsErr || '未知原因') + '。直接查也能用，只是不能按楼筛。</div>' +
      '<button class="btn block" id="rmOptsRetry">重试</button>';
    $('rmOptsRetry').addEventListener('click', () => loadRoomOptions(true));
    return;
  }

  // 三个筛选项都是「点一行 → 弹层里挑一个」，不再是原生 <select>
  const row = (id, label) =>
    '<button class="rmpick" id="' + id + '">' +
    '<span class="k">' + label + '</span>' +
    '<span class="v muted" id="' + id + 'V">不限</span>' +
    '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' +
    '</button>';

  box.innerHTML =
    row('rmCampus', '校区') +
    row('rmBuilding', '教学楼') +
    row('rmType', '教室类型') +
    '<label class="rmfield"><span>至少能坐（人）</span>' +
    '<input id="rmSeats" type="number" inputmode="numeric" ' +
    'placeholder="不限" value="' + esc(ROOM.seats) + '"></label>' +
    // 一次能查出七百多间，靠滚动找某间教室不现实 —— 给个按名字找的口子。
    '<label class="rmfield rm-wide"><span>教室名（可只写一部分，如 01B）</span>' +
    '<input id="rmName" type="text" placeholder="不限" value="' + esc(ROOM.name) + '"></label>';

  const o = ROOM.opts;
  const anyGroup = (list) => [{ items: [{ id: '', name: '不限' }].concat(list || []) }];

  $('rmCampus').addEventListener('click', async () => {
    const v = await openPick('校区', '先选校区，教学楼是全校的', anyGroup(o.campuses), ROOM.campusId);
    if (v === null || v === ROOM.campusId) return;
    ROOM.campusId = v;
    roomChanged();
  });

  $('rmBuilding').addEventListener('click', async () => {
    const v = await openPick('教学楼', '按楼号排；南区和各区字母楼放在「其他」',
      roomBuildingGroups(o.buildings), ROOM.buildingId);
    if (v === null || v === ROOM.buildingId) return;
    ROOM.buildingId = v;
    roomChanged();
  });

  $('rmType').addEventListener('click', async () => {
    const v = await openPick('教室类型', '', anyGroup(o.types), ROOM.typeId);
    if (v === null || v === ROOM.typeId) return;
    ROOM.typeId = v;
    roomChanged();
  });

  $('rmSeats').addEventListener('change', () => {
    // 只留数字：服务端认的是纯数字，输个「50人」过去它会当没填。
    ROOM.seats = String($('rmSeats').value || '').replace(/\D/g, '');
    roomChanged();
  });
  $('rmName').addEventListener('change', () => {
    ROOM.name = String($('rmName').value || '').trim();
    roomChanged();
  });

  syncRoomFilterValues();
}

/** 把当前选中的名字刷到那三行上（没选就写「不限」并变灰）。 */
function syncRoomFilterValues() {
  const o = ROOM.opts || {};
  const name = (list, id) => {
    const x = (list || []).find((i) => i.id === id);
    return x ? x.name : '';
  };
  const put = (id, text) => {
    const el = $(id + 'V');
    if (!el) return;
    el.textContent = text || '不限';
    el.classList.toggle('muted', !text);
  };
  put('rmCampus', name(o.campuses, ROOM.campusId));
  put('rmBuilding', name(o.buildings, ROOM.buildingId));
  put('rmType', name(o.types, ROOM.typeId));
  const s = $('rmSeats');
  if (s && s.value !== ROOM.seats) s.value = ROOM.seats;
  const n = $('rmName');
  if (n && n.value !== ROOM.name) n.value = ROOM.name;
}

/* 教学楼分两组：
 *   「按楼号」—— 名字形如「08楼」「3号楼」，**按数字从小到大**排。
 *               学校返回的顺序是乱的（06/09/08/07/05/02/01…），不排的话
 *               找一个楼得把整列读一遍。
 *   「其他」  —— 南区A座 / 南区实验楼 / 工程实训中心 / A / B / C 这些不是楼号的。
 *               ⚠️ A/B/C 在教务系统里是**独立的楼栋 ID**，删掉它们大学路校区
 *               那些教室就再也筛不出来了，所以收在「其他」里而不是丢掉。
 */
function roomBuildingGroups(list) {
  const num = [];
  const other = [];
  (list || []).forEach((x) => {
    const m = /^0*(\d+)\s*(?:号)?楼$/.exec(String(x.name || '').trim());
    if (m) num.push({ id: x.id, name: x.name, n: parseInt(m[1], 10) });
    else other.push(x);
  });
  num.sort((a, b) => a.n - b.n);
  // 「其他」里也要有个固定次序：字母楼（A/B/C）→ 南区/东区这类带方位的 → 其余。
  // 纯按名字排的话 ICU 的中文排序会把「南区实验楼」排到 A 前面，看着像乱序。
  const rank = (n) => {
    const s = String(n || '');
    if (/^[A-Za-z]+$/.test(s)) return '0' + s;
    if (/^[东南西北]/.test(s)) return '1' + s;
    return '2' + s;
  };
  other.sort((a, b) => rank(a.name).localeCompare(rank(b.name), 'zh-Hans-CN', { numeric: true }));
  return [
    { items: [{ id: '', name: '不限' }] },
    { title: '按楼号', items: num },
    { title: '其他', items: other },
  ];
}

function renderRoomResult() {
  $('rmLoading').hidden = !ROOM.loading;
  $('rmErrCard').hidden = !ROOM.err;
  if (ROOM.err) $('rmErrText').textContent = ROOM.err;

  const r = (!ROOM.err && ROOM.res) || null;
  $('rmResult').hidden = !r;
  // 没查过、没出错、也没在查 ⇒ 显示「选好点查询」的引导
  $('rmFirst').hidden = !!(r || ROOM.err || ROOM.loading);
  if (!r) return;

  // 学校是按容量**升序**返回的：一屏下来全是 6 座的小实验室/储藏室，
  // 而人问「哪儿能自习」要的是大教室。所以按容量从大到小排。
  // 相同容量保持学校原来的顺序（sort 是稳定的）。
  // ⚠️ 两条必须挡住的坑（2026-10-19 用真数据看到的）：
  //   1. 「公用资源」那一类根本不是教室（办公室、国际教学办、
  //      「请联系任课老师」「无卷开放考试」这类占位条目），
  //      容量写 900~9999。按容量排会把它们全顶到第一屏。→ 一律排最后。
  //   2. 9999 是「不限额」的占位值，当容量参与排序没有意义 → 按 0 算。
  const isPublic = (x) => (x.type || '') === '公用资源';
  const capOf = (x) => (x.capacity && x.capacity < 2000 ? x.capacity : 0);
  const rooms = (r.rooms || []).slice().sort((a, b) =>
    (isPublic(a) - isPublic(b)) || (capOf(b) - capOf(a)));
  const notice = r.notice || [];
  const d = parseYmd(r.dateBegin || ROOM.date);
  const w = '周' + DAY_CN[(d.getDay() + 6) % 7];
  const pTxt = r.periodBegin === r.periodEnd
    ? '第 ' + r.periodBegin + ' 节'
    : '第 ' + r.periodBegin + '-' + r.periodEnd + ' 节';
  const head = mdDot(d) + ' ' + w + ' · ' + pTxt;

  $('rmSum').innerHTML = rooms.length
    ? esc(head) + ' · 空闲 <b>' + rooms.length + '</b> 间'
    : esc(head) + ' · <b>没有</b>空闲教室';

  // 「停课」这种行：学校塞在结果表里的状态，不是教室。
  // 单独说一句，别让它变成一间叫「停课」的教室，也别悄悄吞掉。
  // 「这一节可能不排课」只在真的一间都没有时才说 —— 明明有 199 间还这么讲就是瞎猜。
  const nb = $('rmNotice');
  nb.hidden = !notice.length;
  if (notice.length) {
    nb.textContent = '学校在结果里标了「' + notice.join('、') +
      '」，那不是教室，已经跳过。' + (rooms.length ? '' : '这一节可能本来就不排课。');
  }

  $('rmList').innerHTML = rooms.map((x) => {
    const meta = [x.building, x.type, x.campus].filter(Boolean).join(' · ');
    // 三种容量要分开说：有数、学校没给（0）、学校写的是「不限」（9999）。
    // 把 9999 原样画出来，屏幕上就是一排「9999 座」，看着像算错了。
    const cap = x.capacity >= 2000
      ? '<span>容量不限</span>'
      : (x.capacity ? '<b>' + x.capacity + '</b><span>座</span>' : '<span>容量未知</span>');
    return '<div class="rmitem"><div class="rm-main">' +
      '<div class="rm-name">' + esc(x.name) + '</div>' +
      (meta ? '<div class="rm-meta">' + esc(meta) + '</div>' : '') +
      '</div><div class="rm-cap">' + cap + '</div></div>';
  }).join('');

  // 截断要说清楚：不然「全校就这 200 间」会被当成事实。
  const tr = $('rmTrunc');
  tr.hidden = !r.truncated;
  if (r.truncated) {
    tr.textContent = '还有教室没列出来，加个筛选能缩小范围。';
  }
}

function renderRooms() {
  toast('东油适配中');
  return;
  const bound = !!(DATA && DATA.profile && DATA.profile.studentId);
  $('rmEmpty').hidden = bound;
  $('rmMain').hidden = !bound;
  if (!bound) return;
  roomInit();
  renderRoomDays();
  renderRoomPeriods();
  renderRoomFilter();
  renderRoomResult();
}

/** 条件变了：先重画选中态，停手 320ms 再真去查。
 *  连着点「今天→明天→后天」时，中间的日期不该各打一次学校服务器。 */
let roomTimer = 0;
function roomChanged() {
  renderRooms();
  clearTimeout(roomTimer);
  roomTimer = setTimeout(() => { if (DATA) queryRooms(); }, 320);
}

function openRoomPicker() {
  const inp = $('rmDate');
  inp.value = ROOM.date;
  // 老 WebView 没有 showPicker()，退回 click()；两个都不行的话
  // 至少把日期框留在那儿（用户还能手动改）。
  try {
    if (typeof inp.showPicker === 'function') { inp.showPicker(); return; }
  } catch (e) { /* 落到下面 */ }
  try { inp.click(); } catch (e) { /* 什么都不做 */ }
}

async function loadRoomOptions(force) {
  if (!DATA || ROOM.optsLoading) return;
  if (ROOM.opts && !force) return;
  ROOM.optsLoading = true;
  ROOM.optsErr = '';
  renderRooms();
  try {
    const r = await api('/api/room-options');
    if (r && r.ok) {
      const o = { types: r.types || [], campuses: r.campuses || [], buildings: r.buildings || [] };
      // 三个下拉全空 = 学校没给，等于没有筛选项；说成「不限」是在骗人。
      if (!o.types.length && !o.campuses.length && !o.buildings.length) {
        ROOM.opts = null;
        ROOM.optsErr = '学校没返回筛选项';
      } else {
        ROOM.opts = o;
      }
    } else {
      ROOM.opts = null;
      ROOM.optsErr = (r && r.error) || '没取到筛选项';
    }
  } catch (e) {
    ROOM.opts = null;
    ROOM.optsErr = e.message || envText('连不上电脑上的服务', '连不上教务系统，检查网络后重试');
  } finally {
    ROOM.optsLoading = false;
    renderRooms();
  }
}

async function queryRooms() {
  if (!DATA) { toast('先绑定账号'); return; }
  // 单飞：查询期间又改了条件，只记一个「等会儿再查」，绝不并发打学校服务器。
  if (ROOM.loading) { ROOM.again = true; return; }
  const tok = ++ROOM.tok;
  ROOM.loading = true;
  ROOM.err = '';
  renderRooms();
  try {
    const res = await api('/api/free-rooms', {
      date: ROOM.date,
      periodBegin: ROOM.p1,
      periodEnd: ROOM.p2,
      campusId: ROOM.campusId,
      buildingId: ROOM.buildingId,
      typeId: ROOM.typeId,
      seats: ROOM.seats,
      name: ROOM.name,
    });
    if (tok !== ROOM.tok) return;            // 条件已经换了，这份结果作废
    if (!res || !res.ok) {
      ROOM.res = null;
      ROOM.err = (res && res.error) || '查询失败';
      return;
    }
    ROOM.res = res;
    ROOM.err = '';
  } catch (e) {
    if (tok !== ROOM.tok) return;
    ROOM.res = null;
    ROOM.err = e.message || envText('连不上电脑上的服务', '连不上教务系统，请检查网络后重试');
  } finally {
    if (tok === ROOM.tok) {
      ROOM.loading = false;
      renderRooms();
      if (ROOM.again) { ROOM.again = false; queryRooms(); }
    }
  }
}

// ------------------------------------------------------------------ 我的

/** 设置页（2026-11-25）：独立二级页，内容就是颜色三选一。
 *  以前是弹层（openSettingsSheet），用户要求「做成一个新的页面」之后搬到这里。
 *  🔴 点一下**立刻**生效并写本机：这里是设置页，不该再有「保存」按钮 ——
 *     多一步确认，用户只会以为自己没点上。
 *  🔴 `meTheme` 那行灰字也在这里一起改：它和本页说的是同一件事，只在
 *     renderMe 里改的话，用户返回「我的」之前那一行还是旧值。 */
function renderSettingsPage() {
  const modes = [
    ['light', '浅色'], ['dark', '深色'], ['system', '跟随系统'],
  ];
  const theme = THEME_MODES.includes(CFG.theme) ? CFG.theme : 'system';
  const body = $('settingsBody');
  if (body) {
    body.innerHTML =
      '<h2>颜色</h2>' +
      '<p class="sub">浅色、深色，或者跟着系统的夜间模式走。选了立刻生效。</p>' +
      '<div class="settings-segment" role="group" aria-label="颜色模式">' +
      modes.map(([value, label]) => '<button type="button" class="settings-option' +
        (theme === value ? ' active' : '') + '" data-theme-choice="' + value + '"' +
        (theme === value ? ' aria-pressed="true"' : ' aria-pressed="false"') +
        '>' + label + '</button>').join('') +
      '</div>' +
      // 课表：没绑定教务的时候「我的」里那一整块是 hidden 的，缓存下来的课表
      // 就成了改不了时间的死数据 —— 作息放在这里，登录与否都能调。
      '<h2 class="set-gap">课表</h2>' +
      '<p class="sub">左侧节次栏的起止时间，上课提醒也按它算。</p>' +
      '<button type="button" class="row tap" id="setTimes">' +
        '<span class="k">上课时间和提醒</span>' +
        '<span class="rowend">' +
          '<span class="v muted" id="setTimesV">' + timesLabel() + '</span>' +
          '<svg class="rowico" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' +
        '</span>' +
      '</button>';
    body.querySelectorAll('[data-theme-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        applyTheme(button.dataset.themeChoice);
        store.set(KEY.settings, CFG);
        // 整页重画，不只改 active 类：选中态、aria、右边那行灰字要一起变，
        // 分两处改一定会漏（弹层那版只改 active，`meTheme` 就漏了）。
        renderSettingsPage();
      });
    });
    const setTimes = body.querySelector('#setTimes');
    if (setTimes) setTimes.addEventListener('click', openTimesSheet);
  }
  const hint = $('meTheme');
  if (hint) hint.textContent = THEME_LABELS[theme] || '跟随系统';
}

function renderMe() {
  renderUpdSettingsState();
  const oldLogin = document.querySelector('#meUnbound .bindcard');
  if (oldLogin) oldLogin.hidden = true;
  // 版本号在 HTML 里只留一个占位（「—」），真值从 APP_VERSION 来。
  // 写死在 HTML 里的话，改版本号就会漏掉这一处。
  // 测试版单独标出来：装的是手上这版、还是商店/群里那个正式版，
  // 出了问题时这句是第一件要确认的事。
  // 序号也带上（0.49.2 测试版 v2）：同一个版号下打好几版，没有序号就分不清。
  $('meVersion').textContent = 'v' + APP_VERSION +
    (APP_CHANNEL === 'beta'
      ? ' · 测试版' + (APP_BETA_SEQ > 0 ? ' v' + APP_BETA_SEQ : '')
      : '');
  // 标题行那颗「后台自动」：文案跟着开关走（开着写「自动开着」）——
  // 不写清楚的话，用户只能点进弹层才知道自己到底开没开。
  autoRepaint();
  // 「权限」那颗半按钮：只在读得到状态的壳里出现（网页版没有系统权限这回事）。
  renderPermEntry();
  // 「设置」那行右边的灰字（2026-11-25）：写着当前选的颜色，
  // 这样不用点进去也知道现在是什么模式。真值只在 THEME_LABELS 里有一份。
  $('meTheme').textContent = THEME_LABELS[CFG.theme] || '跟随系统';
  const bound = !!(DATA && DATA.profile && DATA.profile.studentId);
  $('meBound').hidden = !bound;
  $('meUnbound').hidden = bound;
  // 2026-11-15：头像块挪出了 `#meBound`（和「账号管理」并成一张卡），
  // 所以它现在得自己管显隐。少这一句，没绑教务的人会看到一个空头像
  // 「?」和两行「—」，而账号管理那行被压在下面 —— 比原来的两张卡更糟。
  if ($('rowProfile')) $('rowProfile').hidden = !bound;
  // 有数据但本机没存住凭据 ⇒ 提示重新输入密码。
  // 只认 BOUND === false（问过、且确实没有）；null（还没问到 / 服务没开）不提示，
  // 否则开 App 的瞬间会闪一下这条警告。
  $('reauthCard').hidden = !(bound && BOUND === false);
  if (bound && BOUND === false) {
    // 🔴 「从来没存上」和「存着但解不开」是两件事，得说两套话。
    //    混成一句「密码没保存」，在第二种情况下就是在说假话 ——
    //    密文明明在文件里，只是密钥被系统重置了。
    const broken = CRED_STATE === 'broken';
    $('reauthHead').textContent = broken ? '密码还在，但解不开了' : '需要重新输入密码';
    $('reauthSub').textContent = broken
      ? '密码已失效（换手机或清数据），重输一次'
      : '课表成绩还在，密码未存，每次需重输';
    $('reauthTip').textContent = CRED_ERR ? ('上次没存住的原因：' + CRED_ERR) : '';
  }

  // 账号管理那一行的摘要：账号页里连上了几个。
  // 这里给一个数，而不是「查看」—— 一行里右边那个位置要么说事、要么空着。
  //
  // 🔴 这一段**必须在 `if (!bound) return` 之前**。
  //    账号管理里除了三个学校系统还有慧生活（接水/积分），
  //    没绑教务的人照样能进去、照样可能连了学习通和门户。
  //    原来写在 return 之后 ⇒ 没绑教务的人这一行永远是 HTML 里那个「—」，
  //    而页面看上去一切正常（没人报错，只是那句话一直不出现）。
  //
  // 🔴 口径**只能**是 `accRows()`（2026-11-16）。上一版这儿自己写死
  //    `['jw','cx','portal']`，加财务处之后还写「已连 3 个」，用户当场问
  //    「为什么还是已连三个」。数字和账号页必须是同一份数据，否则加一行
  //    账号就必然漏一次，且不报错、没人发现。
  paintAccCount();
  if (!bound) return;

  const p = DATA.profile;
  $('meAvatar').textContent = (p.name || '?').slice(0, 1);
  $('meName').textContent = p.name || '—';
  $('meMeta').textContent = (p.className || '') + (p.major ? ' · ' + p.major : '');

  // 个人信息收成了一行（见 index.html 里那段注释）。
  // 右边小字只写学号 —— 名字和班级上面那张头像卡已经有了，
  // 再写一遍只会被挤成省略号。
  $('meProfileHint').textContent = p.studentId || '—';
  // 弹层正开着就顺手刷一遍，别让数据变了弹层还显示旧的
  paintProfileSheet();
  $('meSyncTime').textContent = DATA.syncedAt ? timeAgo(DATA.syncedAt) : '还没同步';
  // 「学期设置」这一行右边写「大二上 · 9.07 开学 · 24 周」。
  // 以前只写开学日期和周数，学期名（2026-2027 学年第 1 学期）只在弹层里 ——
  // 但那串编号学生自己根本不用，他认的是「大二上」。
  //
  // 🔴 这一行点进去改的是**当前学期**，所以四个值都必须取当前学期的：
  //    startDate()/totalWeeks()/gradeLabel() 在看历史学期时会返回那一学期的，
  //    而这里显示错的值 = 用户以为自己改的是历史学期。
  const curSemName = CFG.semester || (DATA && DATA.semester) || '';
  const ca = academicTerm(curSemName);
  const gl = gradeName(ca.y, ca.s);
  const curStart = CFG.startDate ? parseYmd(CFG.startDate) : defaultStart(DATA && DATA.semester);
  // 🔴 0.52.1：这里原来写「大二上 · 9.07 开学 · 24 周」，下面又追加
  //    「· 第 10/24 周」—— 两处都说「24 周」，整串 229px、可用只有 209px
  //    （320 宽的机器上只有 169px），被省略号截成「… · 第 10/...」。
  //    总周数只留一处：它在这里的用途是「判断结课没结课」，那个结论由下面
  //    那句「已结课」直接说出来，不需要再摆一个数让人自己算。
  $('meSemester').textContent = (gl ? gl + ' · ' : '') +
    mdDot(curStart) + ' 开学';

  const tt = times();
  const first = tt.find((x) => x[0]);
  $('meTimes').textContent = timesLabel() +
    (CFG.times && first ? '（第1节 ' + first[0] + '）' : '');

  // 🔴 0.46.0：「课程调整」这一行**常显** —— 它是「自己加课」唯一的常驻入口。
  //    以前只有藏过课才出现，现在跟着隐藏条数一起藏着的话，
  //    想加课的人根本没有地方可点。
  //    副标题只报「有变化」的那一半；什么都没改过就说「加课 / 隐藏」。
  const hid = CFG.hidden || [];
  const hidSlots = CFG.hideSlots || [];
  const mineN = myCourses().length;
  const parts = [];
  if (mineN) parts.push('加了 ' + mineN + ' 节');
  if (hid.length) parts.push('藏了 ' + hid.length + ' 门');
  if (hidSlots.length) parts.push('藏了 ' + hidSlots.length + ' 节');
  $('meHidden').textContent = parts.length ? parts.join(' · ') : '加课 / 隐藏';

  // 把「按这个开学日期算，现在是第几周」直接写出来。
  // 周次是靠开学日期推的，学校实际开学日期差一周，整张课表就整体错一周 ——
  // 与其让用户自己去猜，不如把推算结果摆在眼前让他核对。
  const wk = currentWeek();
  const total = totalWeeks();
  // 2026-11-01：这段原来写进「我的」页单独一条提示（#startHint），占 50px。
  // 它说的就是「学期设置」那一行的事，于是并进那行的副标题 ——
  // 真机 360×712 上「我的」页正好差这 50px 才装得下。
  const seam = $('meSemester');
  if (wk < 1) {
    seam.textContent += ' · 还没开学';
  } else if (wk > total) {
    seam.textContent += ' · 已结课';
  } else {
    seam.textContent += ' · 第 ' + wk + ' 周';
  }
  // 「该办的事」卡片 0.48.1 下线，这里原来有一句 renderTodo()。
}

/* ---------------- 个人信息弹层 ----------------
 *
 * 「我的」页原来把 11 个学籍字段一行行铺开，滑好几屏才到底，
 * 而每天真正要看的就是最上面那张头像卡。
 * 用户 2026-10-22 的原话：「我的 界面不要拉这么长，你在前面展示的一大堆
 * 个人信息其实只需要一个 个人信息 栏就够了，点进个人信息栏查看自己的详细信息」。
 *
 * 为什么是「按需生成 HTML」而不是把那块 DOM 搬进弹层再搬回来：
 *   sheetMask 有十几处关闭入口（点遮罩、返回键、各个按钮），
 *   搬 DOM 就得在每一处都记得搬回去，漏一个那张卡就永远消失了。
 *   生成一份 HTML 没有这个隐患 —— 关掉就是关掉。
 *
 * ⚠️ 字段是「有才显示」：很多专业压根没有「方向」这一项，
 *    摆一行「—」等于专门跟用户说「这项是空的」。
 * ⚠️ 学籍状态那一项最要紧：写着「大类分流」就等于说专业还没最终定，
 *    这直接影响按哪个培养计划算学分。
 */
const PROFILE_FIELDS = [
  ['学号', (p) => p.studentId],
  ['学院', (p) => p.dept],
  ['专业', (p) => p.major],
  ['方向', (p) => p.direction],
  ['班级', (p) => p.className],
  ['校区', (p) => p.campus],
  ['性别', (p) => p.gender],
  ['年级', (p) => (p.grade ? p.grade + ' 级' : '')],
  ['学历', (p) => [p.level, p.duration ? p.duration + ' 年制' : ''].filter(Boolean).join(' · ')],
  ['学籍状态', (p) => p.status],
  ['在校时间', (p) => {
    const a = ymDot(p.enrolledAt); const b = ymDot(p.graduateAt);
    return (a && b) ? (a + ' – ' + b) : '';
  }],
];

function profileRowsHtml(p) {
  return PROFILE_FIELDS.map((f) => {
    let v = '';
    try { v = String(f[1](p) == null ? '' : f[1](p)).trim(); } catch (e) { v = ''; }
    if (!v) return '';
    return '<div class="row"><span class="k">' + esc(f[0]) + '</span>' +
           '<span class="v">' + esc(v) + '</span></div>';
  }).join('');
}

function openProfileSheet() {
  const p = (DATA && DATA.profile) || {};
  const rows = profileRowsHtml(p);
  $('sheetBody').innerHTML =
    // data-sheet 是给 paintProfileSheet 认人的：数据一变就重画，
    // 但不能把别人开着的弹层冲掉。
    '<div data-sheet="profile">' +
    '<div class="sh-title">个人信息</div>' +
    '<div class="sh-sub">' + esc(p.name || '—') +
      (p.className ? ' · ' + esc(p.className) : '') + '</div>' +
    '<div class="card">' +
      (rows || '<p class="tip">还没同步到学籍信息，去「同步教务处数据」试一次。</p>') +
    '</div>' +
    '<p class="note">来自学校教务系统的学籍页，只做读取。</p>' +
    // 2026-11-13：这次学籍没读到时，上面那些行是**上次同步的那份**。
    // 不说的话，用户会以为这就是现在的状态（也可能以为我们又把他数据弄丢了）。
    ((DATA && DATA.profileError)
      ? '<p class="stalebar">个人信息这次没读到（' + esc(DATA.profileError) +
        '）。上面是上次同步的那份' +
        (DATA.keptFrom ? '（' + esc(timeAgo(DATA.keptFrom)) + '）' : '') + '。' +
        (DATA.profileError.indexOf('没读到') >= 0 ? '请稍后重试同步。' : '') +
        '</p>'
      : '') +
    '</div>';
  $('sheetMask').hidden = false;
}

/** 弹层开着的时候由 renderMe 调一次，保证看到的是最新数据。 */
function paintProfileSheet() {
  const m = $('sheetMask');
  if (!m || m.hidden) return;
  // 只认「当前弹层就是个人信息」——别把课程详情之类的内容冲掉
  if (!$('sheetBody').querySelector('[data-sheet="profile"]')) return;
  openProfileSheet();
}

// ------------------------------------------------------------------ 该办的事
//
// 选课 / 评教 / 免听 / 免修：一年就开那么几次，错过要等半年，
// 而且评教不做完查不了成绩。所以专门查一遍，摆在「我的」靠上的位置。
//
// 🔴 只查状态、给入口，**绝不代替提交** —— 跟「充值和办套餐不代办」
//    是同一条规矩：写操作出错了不是重试能救的。
//
// 为什么不放进 /api/sync：这四页要打四次教务系统，学校有「别点太快」
// 的守卫，串起来十几秒。为了一个一学期才变几次的状态，让每次同步都
// 白等十几秒不值当。所以同步后**在后台**查一次，用户也可以手动刷新。

const TODO_TTL = 12 * 3600;      // 12 小时内不自动重查
// 手点「重新检查」的最小间隔。跟 TODO_TTL 是两回事：
// 缓存挡的是「正常进页面」，这个挡的是「反复戳」—— 后者会被学校 WAF 判成异常。
const CX_COOL_SEC = 90;
// ---- 自动查（0.39.0）--------------------------------------------------
//
// 用户 2026-11-01：「学习通的内容只能让用户主动发起扫描，很麻烦，
// 还很容易错过作业和考试，还有随堂练习」。
//
// 以前真的没有自动查的入口 —— 只有「登录成功后扫一次」和用户手点。
// 现在接上：进「学习」页 / 从后台切回来，只要上次扫完超过 CX_AUTO_SEC 就自己扫。
//
// 30 分钟 = 一节课。上完一节课回来看一眼，看到的必然是这节课期间发的。
// ⚠️ 别调得太短：一次全量扫描几十个请求，超星那边会限流（403）。
const CX_AUTO_SEC = 30 * 60;
// 自动查失败之后隔多久再试。
// 没有它的话，一次网络抖动会让用户**每次**进页面都撞一次失败 ——
// 而自动查是静默的，他只会觉得「怎么一进这一页就转圈」。
// 🔴 0.49.0：10 分钟 → 30 分钟。10 分钟太短了：用户一节课里切进切出三四次，
//    每次都撞同一堵墙（课程列表读不出来），界面上就是「每次打开都闪一下失败」。
//    失败之后让这一轮彻底过去，和 CX_AUTO_SEC 对齐；真急着要新的，
//    右上角那颗「重新查」就是给这种时候用的。
const CX_AUTO_RETRY = 30 * 60;
// ---- 轮询的两种「卡住」（2026-10-24）----------------------------------
//
// 🔴 为什么要有这两个数：原来 cxPoll 的 catch 里只有一句 cxStopPoll() ——
//    一次请求失败（切 WiFi / 息屏 / 后端正好在忙）就把定时器**永久**掐掉，
//    而 CX.scan 还停在 {state:'scanning'}。之后没有任何代码会把它改回来，
//    因为改它的只有 cxPoll，而 cxPoll 已经不跑了。
//    界面上：有旧数据 ⇒ 一条永远不动的进度条；没旧数据 ⇒ 整页「正在检查…」，
//    连一个按钮都没有，唯一出路是杀掉 App 重开。
//
//    所以失败要能容忍（抖动不是故障），卡住要能判（没失败、但也没进展）。
const CX_POLL_FAIL_MAX = 3;        // 连续 3 次拿不到 /api/cx/todo 才算失联
// 单门课最坏多久：课程页 25 + 作业 25 + 考试 20 + 活动 25，加三个 1 秒间隔
// ≈ 98 秒（四个请求全超时）。刚启动时还有一段 i=0/n=0 的登录窗口（≤35 秒）。
// 取 180 秒 = 最坏情况的 1.8 倍：真的卡住三分钟内一定判得出来，
// 又不至于把「这门课特别慢」误判成卡住。
const CX_STUCK_MS = 180 * 1000;
let TODO = null;                 // { at, items, error }
let todoLoading = false;

/**
 * 拉 `/api/todo` —— 2026-11-07 起它**只为了提醒**，不再画界面。
 *
 * 用户的「该办的事」卡片在 0.48.1 下线了（原话：大部分都没什么用），
 * 但这次请求不能跟着删：它顺手把作业截止时间精简存一份（dueCacheSave），
 * 作业提醒完全靠这份数据。删掉的表现是「卡片没了，提醒也跟着不响了」——
 * 而且不报错，等用户发现的时候已经错过一整周的作业。
 */
async function loadTodo(force) {
  if (todoLoading) return;
  if (!force && TODO && TODO.at && (Date.now() / 1000 - TODO.at) < TODO_TTL) return;
  todoLoading = true;
  try {
    const res = await api('/api/todo');
    if (!res.ok) {
      // 「没查到」和「查了但没开」必须分开。前者可能是网络或登录态，
      // 后者才是「没事」—— 混在一起会让人以为真没事。
      TODO = { at: 0, items: [], error: res.error || '没查到' };
    } else {
      TODO = {
        at: res.at || Math.floor(Date.now() / 1000),
        items: res.items || [],
        error: '',
      };
      // 🔴 这里**不写**截止缓存。这个接口给的是教务的「选课 / 评教 / 免听 /
      //    免修」四项开放状态（`{key,name,state,text,detail}`），一条 endAt
      //    都没有。0.47.8 起误把它当作业源喂给 dueCacheSave，过滤后恒为空，
      //    而且每次都把这个空表**写回去**——学习通刚存好的作业被它抹掉。
      //    作业来自 ``/api/cx/todo`，在那两处存。
      remindPush();
    }
  } catch (e) {
    TODO = { at: 0, items: [], error: e.message || String(e) };
  } finally {
    todoLoading = false;
  }
}

// renderTodo() 与「重新检查」按钮一起随卡片下线了（0.48.1）。
// 卡片、列表、页脚、状态标签的 DOM 都已经不在 index.html 里，
// 这里再去找 #todoCard 会拿到 null —— 别想着「先留着不调用」，留着就是下次误用的坑。

// 成绩页的搜索框和排序按钮只绑一次。
// 🔴 不能写在 renderGrades 里面 —— 那个函数每点一次学期 chip 就重跑一遍，
//    绑在里面会越积越多（点 5 次就有 5 个监听器）。输入框本身不会被重建，
//    所以绑一次就够，重画列表也不会丢焦点。
$('grFind').addEventListener('input', () => {
  gradeFind = $('grFind').value;
  gradeShowN = 5;        // 换了搜索词，首屏重新从 5 门开始
  renderGrades();
});
$('grSort').addEventListener('click', () => {
  gradeSort = (gradeSort + 1) % GRADE_SORTS.length;
  gradeShowN = 5;        // 换了排序，首屏重新从 5 门开始
  renderGrades();
});

function timeAgo(ts) {  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return '刚刚同步';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前同步';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前同步';
  return Math.floor(d / 86400) + ' 天前同步';
}

/* ---------------- 学期设置 ----------------
 *
 * 为什么单独做一个面板，而不是在「我的」里塞一个日期框：
 * 周次是靠**开学第一周的周一**推出来的，这个日期错一天，整张课表就整体错一周。
 * 所以它得让人能核对、能改、还能看见改完的结果 —— 一个孤零零的日期框做不到。
 *
 * 顺带把「总周数」也放开：教务系统给的是 `marshalTable` 的 endWeek（实测 24），
 * 但换学期、或者接口哪次没取到这个值，用户得有地方自己填，
 * 否则周次条只有一半，后半学期翻不过去。
 */
function openSemesterSheet() {
  // 🔴 这里改的永远是**当前学期**的校历，所以取默认值必须直接用 DATA / CFG，
  //    不能用 semesterName() / startDate() —— 那两个在看历史学期时会返回
  //    历史学期的名字和推算日期，一旦保存就把当前学期的设置污染了。
  //    症状很隐蔽：看完「大一上」的课表回到现在，周次整体差好几周。
  const curSem = CFG.semester || (DATA && DATA.semester) || '';
  const curStart = CFG.startDate ? parseYmd(CFG.startDate) : defaultStart(DATA && DATA.semester);
  const curWeeks = (() => {
    const n = Math.floor(Number(CFG.weeks));
    return (n >= 1 && n <= 60) ? n : ((DATA && DATA.totalWeeks) || 20);
  })();
  const cur = {
    label: curSem,
    start: ymd(curStart),
    weeks: curWeeks,
  };

  // 面板顶部先说人话：「现在是 大二上（入学年 2025）」。
  // 下面那个输入框里躺着的仍然是教务系统原文 —— 它是算开学日期的依据，不能改格式。
  const ct = academicTerm(curSem);
  const gl = gradeName(ct.y, ct.s);
  const y0 = enrolledYear();
  const head = gl
    ? '现在是 <b>' + esc(gl) + '</b>（按入学年 ' + y0 + ' 和「' +
      esc(curSem || '学期名未知') + '」算出来的）'
    : '「第几周」按开学第一周的周一算。';

  $('sheetBody').innerHTML =
    '<div class="sh-title">学期设置</div>' +
    '<div class="sh-sub">' + head + '</div>' +
    '<div class="setrows">' +
      '<label class="setrow"><span class="sk">学期（教务系统原文）</span>' +
        '<input class="setinput" id="setName" type="text" autocomplete="off" ' +
        'value="' + esc(cur.label) + '" placeholder="例如 2026-2027 学年 第一学期"></label>' +
      '<label class="setrow"><span class="sk">开学第一周的周一</span>' +
        '<input class="setinput" id="meStartDate" type="date" value="' + cur.start + '"></label>' +
      '<label class="setrow"><span class="sk">学期总周数</span>' +
        '<input class="setinput" id="setWeeks" type="number" min="1" max="60" ' +
        'inputmode="numeric" value="' + cur.weeks + '"></label>' +
    '</div>' +
    '<div class="setpreview" id="setPreview"></div>' +
    '<div class="sheetbtns">' +
      '<button class="btn" id="setReset">恢复默认</button>' +
      '<button class="btn primary" id="setSave">保存</button>' +
    '</div>';
  $('sheetMask').hidden = false;

  /** 边填边算，让人当场看到「按这个日期今天是第几周」。 */
  const preview = () => {
    const box = $('setPreview');
    if (!box) return;
    const s = $('meStartDate').value;
    const n = Math.floor(Number($('setWeeks').value));
    if (!s) { box.textContent = '先选一个开学日期。'; return; }
    const d = parseYmd(s);
    if (isNaN(d.getTime())) { box.textContent = '日期填得不对。'; return; }
    const diff = Math.round((today0() - d) / 86400000);
    const w = Math.floor(diff / 7) + 1;
    const total = (n >= 1 && n <= 60) ? n : 0;
    let msg;
    if (w < 1) {
      msg = '按这个日期，今天还没开学（还有 ' + (-diff) + ' 天）。';
    } else if (total && w > total) {
      msg = '按这个日期，今天是第 ' + w + ' 周，已经超过你填的 ' + total + ' 周，检查日期或周数。';
    } else if (total) {
      msg = '按这个日期，今天是第 ' + w + ' 周（共 ' + total + ' 周，还剩 ' + (total - w) + ' 周）。';
    } else {
      msg = '按这个日期，今天是第 ' + w + ' 周（总周数填 1~60 之间）。';
    }
    box.textContent = msg;
    // 日期没落在周一，就提醒一句：不算错，但八成是选歪了
    if (d.getDay() !== 1) box.textContent += ' ⚠️ 这天不是周一。';
  };
  ['setName', 'meStartDate', 'setWeeks'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', preview);
    if (el) el.addEventListener('change', preview);
  });
  preview();

  $('setSave').addEventListener('click', () => {
    const name = $('setName').value.trim();
    const start = $('meStartDate').value;
    const n = Math.floor(Number($('setWeeks').value));
    if (!start) { toast('开学日期不能空'); return; }
    if (!(n >= 1 && n <= 60)) { toast('总周数请填 1~60'); return; }
    CFG.semester = name;
    CFG.startDate = start;
    CFG.weeks = n;
    // 改的是当前学期的校历 ⇒ 顺手切回当前学期，否则用户还停在历史课表上，
    // 看不到刚改的结果（还会以为没保存成功）。
    TT = null;
    CFG.week = currentWeek();          // 日期变了，当前周要跟着重算
    store.set(KEY.settings, CFG);
    $('sheetMask').hidden = true;
    renderSchedule(); renderMe();
    toast('学期设置已保存，今天是第 ' + currentWeek() + ' 周');
  });

  $('setReset').addEventListener('click', () => {
    // 恢复默认 = 把三个覆盖值全清掉，退回教务系统给的学期/日期/周数。
    // 注意 totalWeeks() 会因此重新去读 DATA.totalWeeks。
    CFG.semester = '';
    CFG.startDate = '';
    CFG.weeks = 0;
    TT = null;                          // 同上：回到当前学期看结果
    CFG.week = currentWeek();
    store.set(KEY.settings, CFG);
    $('sheetMask').hidden = true;
    renderSchedule(); renderMe();
    toast('已恢复默认（按教务系统的学期和日期）');
  });
}

$('rowSemester').addEventListener('click', openSemesterSheet);
$('rowProfile').addEventListener('click', openProfileSheet);

/* 「我的」里的校历。
   这条是给「不习惯点图标」的人准备的文字路径 —— 课表页顶部已经有入口，
   但校历那条以前是**点标题**，看不出能点。
   🔴 0.35.0：同源的「找空教室」删掉了。空教室在课表页顶部已经有一个带字
      的按钮，两处都能进只会让人猜「这是不是同一个地方」。 */
$('rowCalendar').addEventListener('click', () => switchTab('calendar'));
// 「作业进日历」（0.52.3 v6）：从「学习」页搬过来，见 index.html 那段说明。
// 🔴 一个 id 一处监听。以前这条挂在「我的」那一行（#rowIcs）上，
//    那一行撤掉之后这里必须跟着换 —— 忘了换就是「按钮在、点了没反应」。
$('calIcs').addEventListener('click', exportDueIcs);

/* ---------------- 课程调整（加课 / 隐藏） ----------------
 *
 * 0.46.0 起这两件事合成一个弹层。以前只有「已隐藏的课程」，
 * 现在上面多一块「自己加的课」，共用同一个入口和同一套行样式。
 *
 * 🔴 弹层每次都从 CFG 重算、重画整块 —— 不要在行上就地改字。
 *    藏起来 / 恢复之后状态变了，就地改字只改了被点的那一行，
 *    上面那句「共 N 条」和入口那一行的副标题就都对不上了。
 */
function renderCourseAdjust() {
  const hid = CFG.hidden || [];
  const pend = pendingSlots();     // 只藏了某一节的课（待安排）
  const mine = myCourses();

  let html = '<div class="sh-title">课程调整</div>' +
    '<div class="sh-sub">两件事都只改这台' + envText('电脑', '手机') +
      '上的显示，教务系统那边没有任何变化。</div>';

  // ---- 自己加的课 ----
  html += '<div class="pickhead">自己加的</div>';
  if (mine.length) {
    html += '<div class="hidlist">';
    mine.forEach((c) => {
      const ps = c.slots.map((s) => s.period).sort((a, b) => a - b);
      const days = Array.from(new Set(c.slots.map((s) => s.day))).sort((a, b) => a - b);
      const sub = days.map((d) => '星期' + DAY_CN[d]).join('、') + ' ' +
        periodsText(ps) + ' · ' + compactWeeks(c.weeks) + ' 周' +
        (c.room ? ' · ' + c.room : '');
      html += '<div class="hidrow">' +
        '<div class="hidtxt"><div class="hidname">' + esc(c.name) + '</div>' +
        '<div class="hidsub">' + esc(sub) + '</div></div>' +
        '<button class="hidback" data-edit="' + esc(c.code) + '">修改</button>' +
        '</div>';
    });
    html += '</div>';
  } else {
    html += '<p class="cx-note">还没有。补课、实验、临时加的课都能加进来。</p>';
  }

  // ---- 藏起来的（整门课） ----
  // 空的也照样给个标题：用户点进来就是想知道「我到底藏没藏过东西」，
  // 整块消失的话他会以为这功能坏了。
  html += '<div class="pickhead">藏起来的</div>';
  if (!hid.length) {
    html += '<p class="cx-note">没有整门藏起来的课。</p>';
  } else {
    html += '<div class="hidlist">';
    hid.forEach((code) => {
      const c = courseByCode(code);
      const name = c ? c.name : '（这门课已不在最新数据里）';
      const sub = c ? [c.teacher, c.room].filter(Boolean).join(' · ') : '';
      html += '<div class="hidrow">' +
        '<div class="hidtxt"><div class="hidname">' + esc(name) + '</div>' +
        (sub ? '<div class="hidsub">' + esc(sub) + '</div>'
             : '<div class="hidsub">整门都没显示</div>') + '</div>' +
        '<button class="hidback" data-code="' + esc(code) + '">恢复</button>' +
        '</div>';
    });
    html += '</div>';
  }

  // ---- 待安排（只藏了某一节的课） ----
  // 0.51.0：这块原来混在「藏起来的」里，文案是「恢复」—— 读起来像「这节被我扔了」。
  // 用户要的是「先收着，之后挪到别的时间」，所以单独一块、单独一句话说清楚：
  // **现在不显示，但课还在**。每行两颗按钮，主按钮直接开一张填好的加课表单。
  html += '<div class="pickhead">待安排</div>';
  if (!pend.length) {
    html += '<p class="cx-note">没有待安排的课。藏掉某一节时会先放到这里。</p>';
  } else {
    html += '<div class="hidlist">';
    pend.forEach((it) => {
      const nm = it.known ? it.name : '（这门课已不在最新数据里）';
      const where = '原在 星期' + DAY_CN[it.day] + ' ' + periodsText(it.ps);
      html += '<div class="hidrow">' +
        '<div class="hidtxt"><div class="hidname">' + esc(nm) + '</div>' +
        '<div class="hidsub">' + esc(where) + ' · 现在不显示</div></div>' +
        '<div class="hidacts">' +
          '<button class="hidback" data-place="1" data-scode="' + esc(it.code) +
            '" data-day="' + it.day + '">排时间</button>' +
          '<button class="hidmini" data-scode="' + esc(it.code) + '" data-day="' + it.day +
            '" data-ps="' + it.ps.join(',') + '">放回原处</button>' +
        '</div></div>';
    });
    html += '</div>';
    html += '<p class="cx-note">「排时间」会用课名、老师、教室开新表单，' +
      '你只要选时间。排好之后它就是一门自己加的课。</p>';
  }

  html += '<div class="sheetbtns">' +
    '<button class="btn primary block" id="myAdd">添加课程</button></div>' +
    // 长按那条路没有任何视觉提示，不写出来没人会去试。
    '<p class="tip note">或长按课表空白格，星期和节次自动带入</p>';

  $('sheetBody').innerHTML = html;
  $('sheetMask').hidden = false;

  $('myAdd').addEventListener('click', () => openMyCourseForm(''));
  $('sheetBody').querySelectorAll('.hidback, .hidmini').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.edit) { openMyCourseForm(btn.dataset.edit); return; }
      // 「排时间」：不猜时间，只把课名、老师、教室、周次带过去 ——
      // 原来那节之所以被藏，多半就是因为那个时间上不了。
      if (btn.dataset.place) {
        const it = pend.find((x) => x.code === btn.dataset.scode &&
                                   x.day === Number(btn.dataset.day));
        openMyCourseForm('', {
          fromPending: true,
          name: it ? it.name : '',
          teacher: it ? it.teacher : '',
          room: it ? it.room : '',
          weeks: it ? it.weeks : [],
        });
        return;
      }
      if (btn.dataset.scode) {
        const ps = String(btn.dataset.ps || '').split(',')
          .map(Number).filter((n) => !isNaN(n));
        setSlotsHidden(btn.dataset.scode, Number(btn.dataset.day), ps, false);
        renderCourseAdjust();
        toast('放回原处了');
        return;
      }
      setHidden(btn.dataset.code, false);
      renderCourseAdjust();
      toast('已恢复显示');
    });
  });
}

$('btnHidden').addEventListener('click', renderCourseAdjust);

/* ---------------- 提醒（通知） ----------------
 *
 * 用户 2026-11-07：「咱们APP可以做通知和小组件功能吗」。
 *
 * ## 分工：这边算时间，原生只管到点响
 *
 * 什么时候该提醒，只有这边知道 —— 课表、作息、开学日期、周次、作业截止、
 * 考试安排全在这儿。原生存不了这些，也不该存（存一份就是两个真相）。
 *
 * 所以每次打开 App / 同步完 / 改完设置，这边把未来两周的提醒点**一次算完**
 * 推给原生，原生把它们全排进系统闹钟（见 Remind.java）。
 * 应用之后可以完全不在内存里，到点由系统叫醒。
 *
 * 🔴 **不做后台轮询**。国产 ROM 的省电策略会清掉后台，而清掉之后
 *    「没有任何报错」—— 应用没崩、也没异常，它就是没被叫起来。
 *    用户看到的是「昨晚到现在一条提醒都没有」，还以为是自己没设置。
 *
 * ## 默认是关的
 *
 * 通知要先向系统要权限（Android 13 起），而要权限必须由用户点一下 ——
 * 开机就弹框，大部分人第一反应是拒绝，拒绝两次之后系统就不再弹了，
 * 等于永久失去机会。所以默认关着，用户自己打开时才顺便要权限。
 */

/** 一次最多排多少条。原生那边也有同名的 64 上限，这里取小一点留余量。 */
const REMIND_MAX = 60;
/** 往后算几天。14 天盖得住两个周末，用户一周开一次也断不了。 */
const REMIND_DAYS = 14;
/** 提前量可选值（分钟）。不给自由输入：5 分钟的输入框很容易被填成 500。 */
const REMIND_LEAD_OPTS = [10, 15, 20, 30, 45, 60];
/** 没选过的时候用哪一档。
 *  用户 2026-11-09：「上课通知默认改成提前 30 分钟吧」。10 分钟只够从宿舍走到楼下，
 *  发现忘带书、找不到教室就来不及了；30 分钟才真能改变他的行动。 */
const REMIND_LEAD_DEF = 30;
/** 作业截止提前多久。**两道**：一天前、两小时前。
 *
 *  🔴 2026-11-13（学 `study_assistant` 的做法）：只有「提前 2 小时」这一道
 *     是不够的。23:59 截止的作业，21:59 才响 —— 人可能在自习室、在上课、
 *     在车上，收到也来不及了。前一天那道才是「还能改计划」的那一道：
 *     今晚要不要把它排进去，取决于现在知不知道。
 *
 *  🔴 为什么不给用户自己加规则：`study_assistant` 支持「几小时几分钟」的
 *     任意条数。我们这个 App 里作业只是四件事之一（还有课表、签到、饮水），
 *     再加一个规则编辑器就是**第五个设置页**。两道覆盖了绝大多数情况，
 *     真需要第三条的人在读 README 之前就已经把作业交了。
 */
const REMIND_DUE_LEADS = [
  { ms: 24 * 3600 * 1000, word: '明天这个点截止', near: false },
  { ms: 2 * 3600 * 1000, word: '还有 2 小时', near: true },
];
/** 考试提前多久。12 小时，和「加进手机日历」里那条 .ics 的提醒一致。 */
const REMIND_EXAM_LEAD = 12 * 3600 * 1000;

/** 上课提醒开着吗。`=== true` 而不是 `!== false`：默认必须是关。 */
function remindOn() { return CFG.remindOn === true; }
/** 作业和考试提醒开着吗。 */
function remindDueOn() { return CFG.remindDue === true; }
function remindLead() {
  const n = Number(CFG.remindLead);
  return REMIND_LEAD_OPTS.indexOf(n) >= 0 ? n : REMIND_LEAD_DEF;
}

let remindWrap = null;

/**
 * 原生那个接口对象的**薄封装**。
 *
 * 🔴 为什么不让调用点直接写 `const api = remindApi(); api.apply(...)`：
 *    `check_bridge_methods.py` 靠正则抓 `AndroidRemind.方法名` 后面跟括号的写法，
 *    来跟 Reminder.java 的 @JavascriptInterface 对账。写成 `api.xxx` 它就抓不到 ——
 *    于是「Java 那边把 apply 删了」这种错会**静默漏过去**，
 *    表现是开关能点、界面正常、就是永远不提醒。
 *    所以下面每个方法都要写成 window.AndroidRemind 的完整调用，
 *    别为了少打几个字把它抽成变量。
 *
 * 顺带的好处：调用点不用每处都判 `window.AndroidRemind` 在不在。
 */
function remindApi() {
  if (!NATIVE || !window.AndroidRemind) return null;
  if (remindWrap) return remindWrap;
  remindWrap = {
    state() { return window.AndroidRemind.state(); },
    apply(j) { return window.AndroidRemind.apply(j); },
    clear() { return window.AndroidRemind.clear(); },
    ask() { return window.AndroidRemind.ask(); },
    openNotifySettings() { return window.AndroidRemind.openNotifySettings(); },
    openAlarmSettings() { return window.AndroidRemind.openAlarmSettings(); },
    pushWidget(j) { return window.AndroidRemind.pushWidget(j); },
    clearWidget() { return window.AndroidRemind.clearWidget(); },
  };
  return remindWrap;
}

/** 首页「上课时间」那一行的名字 —— 提醒就在这个弹层里，行名要点出来。 */
const REMIND_ROW_NAME = '上课时间和提醒';

/* ---------------------------------------------------------------- 后台自动 */

let autoWrap = null;

/** 后台自动检查那个接口对象的薄封装（0.50.0 v5）。
 *  🔴 和 remindApi 同一个道理：方法都写成 `window.AndroidAuto.xxx(...)` 的完整形式，
 *     别抽成变量 —— 那边有判据靠正则抓这些调用点跟 Java 对账。 */
function autoApi() {
  if (!NATIVE || !window.AndroidAuto) return null;
  if (autoWrap) return autoWrap;
  autoWrap = {
    state() { return window.AndroidAuto.state(); },
    apply(j) { return window.AndroidAuto.apply(j); },
    // 「现在试一次」：只排这一次，不动正在跑的那条（见 Auto.runNow）。
    runNow(k) { return window.AndroidAuto.runNow(String(k || 'wt')); },
    openBattery() { return window.AndroidAuto.openBattery(); },
  };
  return autoWrap;
}

/** 把设置推给 Android 排闹钟。**开关一改就调**，别攒到关弹层时再推 ——
 *  用户点完开关直接按返回键是很常见的，攒着就丢了。 */
function autoPush() {
  store.set(KEY.settings, CFG);
  const a = autoApi();
  if (!a) return '';
  try {
    return String(a.apply(JSON.stringify(CFG.auto || {})) || '');
  } catch (e) {
    return String((e && e.message) || e);
  }
}

/**
 * 开机把**两份设置**对齐一次。0.52.1 v22 加。
 *
 * 🔴 为什么会有两份：网页这份（`CFG.auto`，localStorage，管界面显示）和
 *    原生那份（`hyt_auto`，SharedPreferences，管真正排不排任务）是**两个地方**。
 *    这一页的注释自己写着「应用被系统清掉之后，只有原生那份还读得到」。
 *    但以前**只有点开关的那一下**才把网页这份推过去（`autoPush`）。
 *    于是只要两边岔开一次，界面就一直亮着「自动开着」，原生那边一直是关的，
 *    而后台一次都不会跑 —— 用户看到的就是「开了自启、也放开后台了，
 *    从来没自动做过」，面板上却一切正常，连一句错都没有。
 *
 *    会岔开的几种真实情形：清过应用数据（原生 SP 没了、localStorage 也被清，
 *    这时两边都是默认，没问题）、换过壳/从网页版搬过来（网页这份有、原生没有）、
 *    用旧版本开过开关而那时桥还不存在（`autoPush` 静默 return ''）。
 *
 * 方向怎么定 —— **以「真的在执行」的那份为准**，因为它是事实：
 *   · 原生开着、网页这份关着  ⇒ 说明网页那份丢了，用原生的回填（别把正在跑的任务关掉）；
 *   · 原生关着、网页这份开着  ⇒ 说明原生那份丢了，推一次让它按网页的排上。
 */
function autoBootSync() {
  const api0 = autoApi();
  if (!api0) return;
  let st = {};
  try { st = JSON.parse(api0.state() || '{}'); } catch (e) { return; }
  if (st.avail === false) return;
  const c = autoCfg();
  const javaOn = !!(st.cxOn || st.wtOn);
  const cfgOn = !!(c.cxOn || c.wtOn);
  if (javaOn && !cfgOn) {
    c.cxOn = !!st.cxOn;
    c.wtOn = !!st.wtOn;
    if (st.cxMin === 60 || st.cxMin === 120 || st.cxMin === 240) c.cxMin = st.cxMin;
    store.set(KEY.settings, CFG);
    autoRepaint();
  } else if (cfgOn && !javaOn) {
    autoPush();
  }
}

/** 「上次自动检查」说人话。**没跑过就说没跑过**，不拿「0 分钟前」糊过去。 */
function autoAgo(sec) {  if (!sec) return '';
  const d = Math.floor(Date.now() / 1000) - Number(sec);
  if (!(d >= 0)) return '';
  if (d < 90) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
  return Math.floor(d / 86400) + ' 天前';
}

/**
 * 未来两周的**上课**提醒点。
 *
 * 一个格子可能挤着两门课（同一节上两门不常见但确实有），
 * 合并成一条通知 —— 时间一样的两条会互相覆盖（同类共用一个通知 id），
 * 分开推等于后一条把前一条顶掉，用户只能看到其中一门。
 */
function remindClasses() {
  const out = [];
  const leadMin = remindLead();
  const tt = times();
  const units = curTT().unitCount || 10;
  const now = Date.now();
  const total = totalWeeks();
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const byAt = {};

  for (let d = 0; d < REMIND_DAYS; d++) {
    const day = new Date(base.getTime() + d * 86400000);
    const week = weekOf(day);
    // 学期外的那几天不该排：寒假里排一堆「快上课了」是最典型的假提醒。
    if (!(week >= 1) || week > total) continue;
    const occ = occupancy(week);
    const di = (day.getDay() + 6) % 7;      // 周一 = 0，和 occupancy 的键一致
    for (let p = 0; p < units; p++) {
      const here = occ[di + ':' + p];
      if (!here || !here.length) continue;
      // 一次课通常是连着的两节（甚至三节）。用户 2026-11-09：
      // 「不要重复通知，只需要在每次课第一个课时开始前通知」。
      // 所以上一节要是**同一门课**，这一节就是连堂的后半截，直接跳过。
      // 🔴 认的是 code 不是课名：同一门课在教务数据里可能有好几条记录
      //    （不同教室、不同周次），课名一样但 code 不同 —— 那本来就是两门，
      //    该各提醒各的。
      const prev = p > 0 ? occ[di + ':' + (p - 1)] : null;
      if (prev && prev.some((x) => x && x.code
            && here.some((y) => y && y.code === x.code))) continue;
      const s = hhmmToMin(tt[p] && tt[p][0]);
      if (s === null) continue;              // 没配时间就别瞎算（沿用全项目的老规矩）
      const at = day.getTime() + s * 60000 - leadMin * 60000;
      if (at <= now + 30000) continue;       // 已经过去的、或者马上就要响的
      const key = String(at);
      if (!byAt[key]) {
        byAt[key] = {
          at: at, k: 'class', t: '快上课了', p: 'schedule',
          hm: pad2(Math.floor(s / 60)) + ':' + pad2(s % 60), names: [],
        };
      }
      here.forEach((c) => {
        const room = String(c.room || '').trim();
        byAt[key].names.push(c.name + (room ? ' ' + room : ''));
      });
    }
  }
  Object.keys(byAt).forEach((k) => {
    const it = byAt[k];
    it.b = it.hm + ' ' + it.names.join(' / ');
    delete it.names;
    delete it.hm;
    out.push(it);
  });
  return out;
}

/**
 * 作业截止提醒。数据来自本机那份精简缓存（见 KEY.due）。
 *
 * 🔴 `endAt` 缺失的**不排**。实测真有「未交但没写截止时间」的作业，
 *    给它编一个时间是假的；按「没写就是没截止」处理，宁可不提醒。
 */
function remindDues() {
  const c = store.get(KEY.due, null);
  const list = (c && Array.isArray(c.list)) ? c.list : [];
  const now = Date.now();
  const out = [];
  // 手动标了「我交过了」的作业不提醒。和列表里隐藏它是同一件事 ——
  // 只在列表里藏起来、通知照响，用户会以为没生效（2026-11-13）。
  list.forEach((it) => {
    const end = Number(it && it.e) * 1000;      // 那边存的是 unix 秒
    if (!(end > 0) || end <= now) return;
    if (dueMarked(it)) return;
    const who = it.c ? String(it.c) + ' · ' : '';
    const title = it.t || '有一项作业';
    REMIND_DUE_LEADS.forEach((lead) => {
      const at = end - lead.ms;
      // 已经过点的提醒排了也不响；「还剩不到两小时」那条过去之后，
      // 只剩「还有 2 小时」这一道 —— 那不是我们漏了，是它真的来不及提前说了。
      if (at <= now + 30000) return;
      out.push({
        at: at, k: 'due', p: 'exams',
        // near = 「两小时」那道。让位时它排在最前面（见 remindTrim）。
        near: !!lead.near,
        t: lead.near ? '作业快截止' : '明天要交',
        b: who + title + '，' + lead.word,
      });
    });
  });
  return out;
}

/**
 * 考试提醒。走的是考试页现成的 `examEvent()` —— 它已经把「时 间 未安排」
 * 这类占位、只给日期没给时间的场次都处理过了，这边不重复判一遍。
 */
function remindExams() {
  const ex = (DATA && DATA.exams) || null;
  const list = (ex && ex.list) || [];
  const now = Date.now();
  const out = [];
  list.forEach((e) => {
    const ev = examEvent(e);
    if (!ev) return;                            // 算不出日期的不排（跟「加日历」同一个门槛）
    const at = ev.begin - REMIND_EXAM_LEAD;
    if (at <= now + 30000) return;
    const when = [String(e.date || '').trim(), String(e.arrange || '').trim()]
      .filter(Boolean).join(' ');
    const room = blankField(e.room) ? '' : String(e.room).trim();
    out.push({
      at: at, k: 'due', p: 'exams',
      // exam 只给让位用（见 remindTrim）：考试排在作业「明天要交」前面 ——
      // 考试错过了就没有下一次。
      exam: true,
      t: '考试提醒',
      b: (when || '明天') + (room ? ' · ' + room : ''),
    });
  });
  return out;
}

/** 一份清单按「先保什么」截断。
 *
 *  🔴 2026-11-13：作业有了第二道提醒（前一天），条数几乎翻倍。原生那边
 *     上限 64 条（每条一个系统闹钟），而 14 天的课表就要占掉四十来条 ——
 *     不设让位规则的话，作业会把上课提醒挤掉，可上课提醒是每天都在用的那个。
 *
 *  顺序：上课全保 → 作业「还有 2 小时」→ 考试 → 作业「明天要交」。
 *  前三档都是「不提醒就真的会误事」，最后那档是「晚一点知道也还来得及」。
 *  🔴 只在超限时才让位。没超的时候一条都不该丢 —— 用户看不见这套规则，
 *     他只能看见「少了一条提醒」。
 */
function remindTrim(list) {
  if (list.length <= REMIND_MAX) return list.slice().sort((a, b) => a.at - b.at);
  const cls = [], near = [], exam = [], far = [];
  list.forEach((x) => {
    if (x.k === 'class') cls.push(x);
    else if (x.exam) exam.push(x);
    else if (x.near) near.push(x);
    else far.push(x);
  });
  const byTime = (a, b) => a.at - b.at;
  [cls, near, exam, far].forEach((a) => a.sort(byTime));
  const out = [];
  for (const bucket of [cls, near, exam, far]) {
    for (const x of bucket) {
      if (out.length >= REMIND_MAX) break;
      out.push(x);
    }
    if (out.length >= REMIND_MAX) break;
  }
  return out.sort(byTime);
}

/** 三路合成一份，按时间排好，截断。 */
function remindBuild() {
  const list = [];
  const add = (fn) => {
    // 单路算炸了不该让其他两路一起没了 —— 课表崩了，作业提醒照样该响。
    try { list.push.apply(list, fn()); } catch (e) { /* 这一路跳过 */ }
  };
  if (remindOn()) add(remindClasses);
  if (remindDueOn()) { add(remindDues); add(remindExams); }
  return remindTrim(list);
}

let remindTimer = 0;

/**
 * 把清单推给原生。
 *
 * `now` 为真时立刻推（用户点了开关，要马上看到结果）；
 * 否则合并 500ms 内的多次调用 —— 同步完、画完界面、切回前台会连着触发好几次，
 * 每次都整批重排太浪费（而且会不停 cancel/create 系统闹钟）。
 */
function remindPush(now) {
  const api = remindApi();
  if (!api) return;
  const go = () => {
    try {
      if (!remindOn() && !remindDueOn()) { api.clear(); return; }
      const list = remindBuild();
      api.apply(JSON.stringify(list.map((x, i) => ({
        i: i + 1, at: x.at, k: x.k, t: x.t, b: x.b, p: x.p,
      }))));
    } catch (e) {
      // 排不上不该影响别的功能。用户点开设置时 state() 会把实情报出来。
    }
  };
  if (now) { go(); return; }
  clearTimeout(remindTimer);
  remindTimer = setTimeout(go, 500);
}

/**
 * 桌面小组件要显示的东西：今天几节课 + 积分任务做到哪了。
 *
 * 只推「今天」而不是一整周：小组件那一格装不下，而且它的刷新是系统控制的
 * （半小时一跳，还不保证），推一周出去到了第二天就全是错的。
 *
 * 🔴 0.49.0 v4：**同一门课连上几小节要合并成一行**。
 *    用户 2026-11-07：「这两个课程明明是同一节课，你却把它分为两节课了」
 *    —— 课表数据里每小节是一个 slot，直接一行一节画出来就是两行一样的课名，
 *    还各占一个开始时间，看着像排重了。合并之后一行就是「一节课」，
 *    左侧写成 16:30~18:10 这种**整段**的时间。
 *    合并的判据是课程 code（教务给的课程代码 / 自己加的课用 my: 开头），
 *    不是课名 —— 两门同名不同班的课不能被并成一条。
 *    ⚠️ 中间隔了空档（午休、没排课的那一节）就不算连着上，必须断开。
 */
function widgetPush() {
  const api = remindApi();
  if (!api || !api.pushWidget) return;
  try {
    const day = new Date();
    const week = weekOf(day);
    const di = (day.getDay() + 6) % 7;
    const tt = times();
    const units = curTT().unitCount || 10;
    const occ = (week >= 1 && week <= totalWeeks()) ? occupancy(week) : {};

    const merged = [];
    let cur = null;
    for (let p = 0; p < units; p++) {
      const here = occ[di + ':' + p];
      const one = (here && here.length) ? here[0] : null;
      if (!one) { cur = null; continue; }        // 空档打断「连上」
      const key = one.code || one.name || '';
      if (cur && cur.key === key) {
        // 同一门课的下一小节：只把结束时间往后推，不新增一行
        const e = (tt[p] && tt[p][1]) || '';
        if (e) cur.end = e;
        continue;
      }
      cur = {
        key: key,
        start: (tt[p] && tt[p][0]) || '',
        end: (tt[p] && tt[p][1]) || '',
        c: one.name || '',
        r: String(one.room || '').trim(),
      };
      merged.push(cur);
    }

    // 🔴 这里**不再砍到 4 条**（2026-11-11）。原来 slice(0, 4) 是按「4×2 的
    //    110dp 只放得下四行」拍的；可用户会把小组件拉成 4×4（六行），
    //    拉高之后第 5、6 节永远不出现 —— 他看到的正是「显示不了当天完整课程」。
    //    现在全推，画几行交给 Java 按实际高度定（见 WidgetProvider.build）。
    //    上限 10 段：一天最多也就这么多（12 节连堂合并后不到 8 段）。
    const it = merged.slice(0, 10).map((x) => ({
      t: (x.start && x.end) ? (x.start + '~' + x.end) : (x.start || x.end || ''),
      c: x.c,
      r: x.r,
    }));

    // 🔴 0.49.0：积分任务进度。
    //    数字来自本机那份「今天做完了哪些」（见 wtDoneLoad），不是从服务端现算 ——
    //    小组件在 App 没打开的时候要显示东西，而那时一个请求都发不出去。
    //    ⚠️ 只在上次真读到过任务列表（total > 0）时才推 tn，否则 Java 那边
    //       会把任务行整个藏起来（那比显示一个假的 0/0 诚实）。
    const rec = wtDoneLoad();
    const tn = Number(rec.total) || 0;
    const td = tn > 0 ? Math.min(wtDoneCount(), tn) : 0;
    // 最近要交的作业 + 最近的考试（2026-11-14，最多两条：一条作业一条考试）。
    // 挑哪几条见 dueSoonList()；`du` 保留给老版小组件（它只认一条）。
    const du = dueSoon();
    const ds = dueSoonList().map((x) => ({ k: x.k, c: x.c, t: x.t, h: x.h }));
    api.pushWidget(JSON.stringify({
      d: '周' + DAY_CN[di], n: merged.length, it: it, td: td, tn: tn, du: du,
      ds: ds,
    }));
  } catch (e) {
    // 小组件画不出来不影响 App 本身。
  }
}

/**
 * 把一处来源的作业截止时间精简一份并进缓存（提醒和课表刻度都用它）。
 *
 * 🔴 只留**还没过期**的，每个来源最多 60 条。整份扫描结果有几百 KB，
 *    塞进 localStorage 会跟课表抢空间（存储满了要牺牲公告缓存）。
 *
 * 🔴 截止时间缓存只保存学习通的数据；旧缓存中其他来源的条目会随本次写入清除。
 *
 * 🔴 数据源只能是**带 endAt 的作业项**（`/api/cx/todo` 的 `data.items`）。`/api/todo` 那个接口给的是教务的
 *    「选课 / 评教 / 免听 / 免修」四项开放状态，里面根本没有 endAt ——
 *    0.47.8 起误接到这里，过滤后恒为空串，于是作业提醒一次都没响过、
 *    课表上一颗刻度也没有，而且全程不抛异常（2026-11-13 用户报「刷新了
 *    学习通还是没有」才翻出来）。别看着「todo」两个字就往回接。
 */
function dueCacheSave(items) {
  try {
    const now = Date.now() / 1000;
    const who = 'cx';
    const keep = (items || []).filter((it) =>
      it && it.kind !== 'sign' && it.endAt && Number(it.endAt) > now
      // Keep submitted items hidden; retain older rows without a state.
      && it.state !== 'done'
    ).slice(0, 60).map((it) => ({
      t: String(it.title || '').slice(0, 40),
      c: String(it.course || '').slice(0, 30),
      e: Number(it.endAt),
      // 0.52.0 v17：给「加到日历」用 —— 导出去要能分清是作业还是考试
      // （日历上写「作业 · 第 4 章…」比只写章节名有用）。
      // 老缓存没有这一项，读的时候按作业处理。
      k: it.kind === 'exam' ? 'exam' : 'work',
      s: who,
      // 2026-11-14：条目自己的页面地址（学习通给的，带 courseId/activeId）。
      // 课表上点开「这条作业」时拿它跳过去 —— 不带路径的话只能落到课程列表，
      // 用户还得自己翻到第几章，那等于没帮上忙。
      // Only Learning通 provides a destination URL.
      u: String(it.url || '').slice(0, 300),
    }));
    store.set(KEY.due, { at: Math.floor(now), list: keep.sort((a, b) => Number(a.e) - Number(b.e)).slice(0, 90) });
    // 课表那边的「哪天有截止」索引跟着作废（见 dueIndex）。
    try { _dueIdx = null; } catch (e) {}
    // 🔴 数据是**晚到**的：课表在开机那一瞬就画完了，`/api/todo` 要十几秒才回来。
    //    这里不重画的话，用户盯着的那一屏永远不会有刻度 —— 他会以为功能没开，
    //    然后翻遍设置找一个并不存在的开关（2026-11-13 用户就是这么报的）。
    //    只在这一页看得见的时候画：在别的页上重画纯属白费，还会把正在翻的
    //    那一页的滚动位置摇一下。
    if (CUR_PAGE === 'schedule') {
      // 后台那个隐藏页面（?bg=1）不画界面，只存数据 —— 在那儿重画纯属白费，
      // 而且那些元素本来就没初始化。判据放在 try 里：BG_MODE 是 const，
      // 在这儿写 typeof 会在 TDZ 里抛。
      let bg = false;
      try { bg = BG_MODE; } catch (e) { bg = false; }
      if (!bg) renderSchedule();
    }
    // 桌面小组件也有一份「最近要交」（2026-11-13）。不推的话卡片上永远停在
    // 开机那一刻 —— 而那次扫描通常还没回来，等于一直显示「没有作业」。
    setTimeout(widgetPush, 400);
  } catch (e) { /* 存不下就算了，下次查到再存 */ }
}

/**
 * 通知点进来 / 小组件点进来之后要落在哪一页。
 *
 * 由 MainActivity 调（URL 上的 `?p=` 和 `onNewIntent` 两处）。
 * 🔴 名字必须挂到 window 上：`evaluateJavascript` 只认全局作用域，
 *    局部函数它看不见，表现是「点了通知只打开 App，还停在首页」。
 */
window.__hytPage = function (name) {
  try {
    const n = String(name || '');
    if (n === 'exams' || n === 'me' || n === 'campus' || n === 'wiki') {
      switchTab(n);
      return;
    }
    // 接水页不是独立的一屏，它是「校园」那一页的主体（0.52.0 v7 加的）
    if (n === 'water') {
      switchTab('campus');
      return;
    }
    switchTab('schedule');
  } catch (e) {
    // 页面还没画好就叫它跳：最坏停在首页，不该因为这个报错。
  }
};


/** 提醒区块里那几个开关和提前量。单独抽出来是为了**只重画这一块** ——
 *  用户拨开关时整个弹层重画的话，上面十行作息输入框里正在改的值会全没了。 */
function remindInnerHtml() {
  const api = remindApi();
  if (!api) {
    // 网页版：说清楚为什么没有，而不是藏起来装作这个功能不存在。
    // 🔴 压句子的时候别把标点一起压掉：「提醒仅在 App 内，网页关闭收不到课表、
    //    作业这些在这里照常能看」就是这么来的 —— 两句话粘成一句，读着像错的。
    return '<div class="ab-hd">提醒</div>'
      + '<div class="ab-note">提醒仅在 App 内，网页收不到；'
      + '课表、作业照常能看。</div>';
  }
  const on = remindOn();
  const due = remindDueOn();
  const sw = (id, v, label) => '<button class="switch' + (v ? ' on' : '') +
    '" id="' + id + '" role="switch" aria-checked="' + (v ? 'true' : 'false') +
    '" aria-label="' + label + '"></button>';
  return '<div class="ab-hd">提醒</div>'
    + '<div class="ab-sw">'
    + '<div class="ab-sw-t"><b>上课前提醒</b><span>下一节在哪个教室</span></div>'
    + sw('rmClass', on, '上课前提醒')
    + '</div>'
    + '<div class="rm-lead"' + (on ? '' : ' hidden') + ' id="rmLeadBox">提前'
    + '<select id="rmLead">' + REMIND_LEAD_OPTS.map((n) =>
        '<option value="' + n + '"' + (n === remindLead() ? ' selected' : '') +
        '>' + n + '</option>').join('') + '</select>分钟'
    + '</div>'
    + '<div class="ab-sw">'
    + '<div class="ab-sw-t"><b>作业和考试</b><span>作业前一天和两小时、考试前一天</span></div>'
    + sw('rmDue', due, '作业和考试提醒')
    + '</div>'
    + '<div class="rm-tip" id="rmTip"></div>';
}

/**
 * 把「提醒到底能不能响」如实摆出来。
 *
 * 🔴 这一段不是装饰。开关开着、系统权限被收走，是用户最常掉进去的坑：
 *    他记得自己开过，可它就是不响，而应用一声不响 —— 于是以为是软件坏了。
 *    四种情况必须分四句话说，压成一句「提醒已开」等于骗人。
 */
function remindTipPaint() {
  const tip = $('rmTip');
  if (!tip) return;
  const api = remindApi();
  if (!api || !api.state) { tip.innerHTML = ''; return; }

  let st = {};
  try { st = JSON.parse(api.state()); } catch (e) { tip.innerHTML = ''; return; }

  const want = remindOn() || remindDueOn();
  const allowed = st.on === true;
  const exact = st.exact !== false;
  const off = String(st.off || '');
  const n = Number(st.n) || 0;

  let html = '';
  if (!want) {
    html = '<span class="rm-mute">关闭后不再提醒</span>';
  } else if (!allowed) {
    html = '<span class="rm-bad">系统的通知权限没开，提醒发不出来。</span>'
      + '<button class="rm-go" id="rmGoNotify">去打开</button>';
  } else if (off) {
    html = '<span class="rm-bad">系统里这类通知已关闭，所以不会响。</span>'
      + '<button class="rm-go" id="rmGoNotify">去打开</button>';
  } else if (!exact) {
    // 「晚了十几分钟」对上课提醒等于没用，必须让人看见，不能只写「已开启」。
    html = '<span class="rm-warn">系统的「准时提醒」已关闭，可能晚十几分钟。</span>'
      + '<button class="rm-go" id="rmGoAlarm">去打开</button>';
  } else {
    html = '<span class="rm-ok">已排好 ' + n + ' 条提醒'
      + (n === 0 ? '（目前没有要提醒的事）' : '') + '。</span>';
  }
  tip.innerHTML = html;

  const go = $('rmGoNotify');
  if (go) go.addEventListener('click', () => {
    try { api.openNotifySettings(); } catch (e) { /* 打不开就算了，上面那句话已经说清楚了 */ }
  });
  const ga = $('rmGoAlarm');
  if (ga) ga.addEventListener('click', () => {
    try { api.openAlarmSettings(); } catch (e) { /* 同上 */ }
  });
}

function refreshRemindBox() {
  const box = $('rmBox');
  if (!box) return;
  box.innerHTML = remindInnerHtml();
  bindRemindBox();
}

function bindRemindBox() {
  const api = remindApi();
  if (!api) return;

  const cls = $('rmClass');
  if (cls) cls.addEventListener('click', () => {
    CFG.remindOn = !remindOn();
    store.set(KEY.settings, CFG);
    // 开的时候顺便要权限 —— 只能由用户的操作触发，不能开机就问。
    if (CFG.remindOn && api.ask) { try { api.ask(); } catch (e) {} }
    remindPush(true);
    refreshRemindBox();
    renderMe();
  });

  const due = $('rmDue');
  if (due) due.addEventListener('click', () => {
    CFG.remindDue = !remindDueOn();
    store.set(KEY.settings, CFG);
    if (CFG.remindDue && api.ask) { try { api.ask(); } catch (e) {} }
    remindPush(true);
    refreshRemindBox();
    renderMe();
  });

  const lead = $('rmLead');
  if (lead) lead.addEventListener('change', () => {
    const n = Number(lead.value);
    CFG.remindLead = REMIND_LEAD_OPTS.indexOf(n) >= 0 ? n : 10;
    store.set(KEY.settings, CFG);
    remindPush(true);
  });

  remindTipPaint();
  // 权限是**弹框之后**才变的：点完「允许」再查一次，不然界面还停在「没开」。
  if (remindOn() || remindDueOn()) setTimeout(remindTipPaint, 900);
}

/* 绑定完之后问一次要不要开提醒（2026-11-07 用户要求）。
 *
 * 为什么非要问：提醒默认是**关**的（宁可不说，也不能半夜弹一堆），
 * 而大多数人绑定完就直接去看课表了，不会自己翻到「我的」里找开关 ——
 * 结果就是这个功能做完了没人用。
 *
 * 只问一次（CFG.remindAsked）。已经开着的、或者当时点了「先不用」的，
 * 下次绑定不再弹 —— 反复问比不问更让人烦。
 */
function askRemindAfterBind() {
  if (!remindApi()) return;            // 网页版没有通知，问了也做不到
  if (CFG.remindAsked) return;
  if (remindOn() || remindDueOn()) return;
  // 🔴 先记下来再弹：弹层被遮罩点掉、被返回键关掉，也算问过了。
  //    不记的话，用户每同步一次就被问一次。
  CFG.remindAsked = true;
  store.set(KEY.settings, CFG);
  // 让「绑定成功」那句 toast 先说完：两个东西同时冒出来会互相盖住。
  setTimeout(showRemindAsk, 900);
}

function showRemindAsk() {
  const api = remindApi();
  if (!api) return;
  $('sheetBody').innerHTML =
    '<div class="sh-title">开启上课提醒？</div>' +
    '<div class="sh-sub">上课前提醒教室，作业和考试也会提醒。</div>' +
    '<div class="sheetbtns">' +
    '<button class="btn" id="rmAskNo">暂不</button>' +
    '<button class="btn primary" id="rmAskYes">开启提醒</button></div>';
  $('sheetMask').hidden = false;

  $('rmAskNo').addEventListener('click', () => {
    $('sheetMask').hidden = true;
    renderMe();
  });

  $('rmAskYes').addEventListener('click', () => {
    CFG.remindOn = true;
    store.set(KEY.settings, CFG);
    // 🔴 先关弹层再要权限：系统的权限框会盖在弹层上面，用户在权限框上
    //    点完「允许」，底下的弹层还开着 —— 看着像没生效，会再点一次。
    $('sheetMask').hidden = true;
    // 要权限只能由用户的操作触发，这里正好是一次点击。
    if (api.ask) { try { api.ask(); } catch (e) {} }
    remindPush(true);
    refreshRemindBox();
    renderMe();
    toast('已开启');
  });
}

/* ---------------- 桌面小组件（怎么加） ----------------
 * 2026-11-07 用户：「小组件功能在哪，我没找到」。
 * 找不到是必然的：Android 的小组件**不在 App 里加**，得回桌面长按空白处。
 * App 里原来一句说明都没有 —— 做完了没人知道，等于没做。
 * 这一行不是开关，只讲步骤；真正的小组件在桌面上。
 */
$('btnWidget').addEventListener('click', () => {
  const has = !!(window.AndroidRemind && window.AndroidRemind.pushWidget);
  $('sheetBody').innerHTML =
    '<div class="sh-title">桌面小组件</div>' +
    '<div class="sh-sub">在桌面上放一张小卡片，一眼看到今天有几节课、' +
    '下一节在哪，还有积分任务做到哪一步了。</div>' +
    (has ? '' : '<p class="tip note bad">小组件要装 App 才有，网页版加不了。</p>') +
    '<ol class="howto">' +
    '<li>回到手机桌面，长按空白处（不要长按图标）</li>' +
    '<li>点「小组件」（部分手机叫「小部件」）</li>' +
    '<li>在列表里找「东油通」，按住拖到桌面上</li>' +
    '</ol>' +
    '<p class="tip note">列表里找不到的话，先打开一次本应用再回来找 —— ' +
    '系统要等应用跑过一次，才会把它列进去。</p>' +
    '<div class="sheetbtns"><button class="btn primary" id="wgOk">知道了</button></div>';
  $('sheetMask').hidden = false;
  $('wgOk').addEventListener('click', () => { $('sheetMask').hidden = true; });
});

/* ---------------- 上课时间和提醒 ---------------- */
/* 2026-11-07（0.48.1）用户：「上课时间与提醒界面底部的每节课时间给去了吧，
 * 用户能直接在课程表页面看」。
 *
 * 那十行 input 是**编辑**控件，不是展示 —— 直接删掉的话，学校哪天调了作息
 * （寒暑假前后各一次很常见）就再也没地方改了，课表和提醒会一起错。
 * 所以改成：默认不展开，只留一行小字入口，点开才是原来那十行 + 保存。
 * 弹层一进来就是提醒，跟用户要的样子一致；功能也没丢。 */
$('btnTimes').addEventListener('click', openTimesSheet);

/** 提醒 + 改作息的弹层。原来只挂在「我的 → 上课时间和提醒」那颗按钮上，
 *  而那颗按钮在没绑定教务时整块是 hidden 的；设置页也要能进来，所以抽成函数。 */
function openTimesSheet() {
  // 提醒放在作息**上面**：提醒只有三行，压在十行作息后面等于没人看到。
  const html = '<div class="sh-title">' + REMIND_ROW_NAME + '</div>' +
    '<div class="rm-box" id="rmBox">' + remindInnerHtml() + '</div>' +
    '<button type="button" class="pwdlost" id="timeEdit">' +
    '课表上的上课时间不对？点这里改</button>';
  $('sheetBody').innerHTML = html;
  $('sheetMask').hidden = false;
  bindRemindBox();
  $('timeEdit').addEventListener('click', openTimeEdit);
}

/** 展开作息编辑（原「上课时间和提醒」弹层的主体）。 */
function openTimeEdit() {
  const tt = times();
  let html = '<div class="sh-title">上课时间</div>' +
    '<div class="sh-sub">按实际作息修改，课表会显示起止时间，' +
    '上课提醒也按这个算</div>' +
    '<div class="timerows">';
  tt.forEach((t, i) => {
    html += '<div class="timerow"><span class="tn">第' + (i + 1) + '节</span>' +
      '<input type="time" data-i="' + i + '" data-k="0" value="' + (t[0] || '') + '">' +
      '<span class="tdash">—</span>' +
      '<input type="time" data-i="' + i + '" data-k="1" value="' + (t[1] || '') + '"></div>';
  });
  html += '</div><div class="sheetbtns">' +
    '<button class="btn" id="timeReset">恢复默认</button>' +
    '<button class="btn primary" id="timeSave">保存</button></div>';
  // 「返回」不是必须的：改错了直接点遮罩关掉，一个字符都不会存。
  $('sheetBody').innerHTML = html;

  $('timeReset').addEventListener('click', () => {
    CFG.times = null;
    CFG.timesSource = '';
    store.set(KEY.settings, CFG);
    $('sheetMask').hidden = true;
    renderSchedule(); renderMe(); renderSettingsPage();
    // 作息变了，提醒时间也要跟着变 —— 不重推的话，明天的提醒还是按旧作息算的。
    remindPush(true);
    toast('已恢复默认时间');
  });
  $('timeSave').addEventListener('click', () => {
    const out = [];
    $('sheetBody').querySelectorAll('input[type=time]').forEach((inp) => {
      const i = Number(inp.dataset.i), k = Number(inp.dataset.k);
      out[i] = out[i] || ['', ''];
      out[i][k] = inp.value;
    });
    CFG.times = out;
    CFG.timesSource = 'manual';
    store.set(KEY.settings, CFG);
    $('sheetMask').hidden = true;
    renderSchedule(); renderMe(); renderSettingsPage();
    remindPush(true);
    toast('已保存');
  });
}



/* ---------------------------------------------------------------- 账号管理
 *
 * 用户 2026-10-22：「把 教务系统，学习通，智慧门户 这些账号统一放在 我的 页面，
 * 做成 账号管理 界面」。
 *
 * 三套账号互不通用，以前散在三个地方 —— 教务在「我的」的绑定表单里、
 * 门户在「校园」的连接卡里、学习通在「学习」页里。想改某一套，
 * 得先知道它在哪儿。集中到这一屏，只回答两件事：连没连上、怎么连/怎么断。
 *
 * 🔴 这里**不重复业务入口**：作业在「学习」，余额在「校园」。
 *    上一版「我的 → 学习通」就是因为只是个快捷方式，被用户点名删掉 ——
 *    别再往这一屏塞「查看作业」之类的按钮。
 */

/** 三套系统的状态，只在这里归一，别在渲染里各判一遍。 */
function accState() {
  return {
    school: nepuSession ? 'on' : 'off',
    cx: CX.state === 'ok' ? 'on' : (CX.state === 'none' ? 'off' : 'unknown'),
  };
}

const ACC_SYS = [
  { id: 'school', k: '东油教务', host: '' },
  { id: 'cx', k: '学习通', host: 'chaoxing.com' },
];

/* 慧生活那两个账号的状态是 `/api/water/state` 给的，以前只有进「功能」页
   才会去取。账号管理现在把它们的行和别的账号摆在一起，直接点进来时
   手里没有状态 —— 不上这一刀的话，登过的人会看到「还没登录」（假话）。
   60 秒内不重复问，和别处一样。 */
let wtStateAt = 0;
async function wtStateRefresh(force) {
  if (!force && wtStateAt && (Date.now() - wtStateAt) < 60000) return;
  let st;
  try {
    st = await api('/api/water/state');
  } catch (e) {
    // 读不到就按手里已知的画（未知不许兜底成「没登录」，见 renderAccounts）
    return;
  }
  const acc = (st && st.accounts) || {};
  WT.accounts = { device: acc.device || null, score: acc.score || null };
  wtStateAt = Date.now();
  if (CUR_PAGE === 'accounts') renderAccounts();
  else paintAccCount();     // 慧生活两个账号也算「连着」，数字要跟着变
}

/** 账号这一屏的**唯一**数据源：一行一个账号。
 *
 *  🔴 2026-11-16 用户：「账号管理为什么还是已连三个？」——他连了四个（教务、
 *     学习通、门户、财务处），「我的」那一行却写「已连 3 个」。
 *     原因是那个数字自己写死了 `['jw','cx','portal']`，和这一屏的 `rows`
 *     是**两份口径**。加财务处、加完美校园的时候，数字不会跟着动，而且不报错。
 *     ⇒ 现在两边都从这里拿。这个函数里加一行，数字自动跟着变。
 */
function accRows() {
  const st = accState();
  const say = {
    school: st.school === 'on' ? '本次同步已验证会话' : (DATA && DATA.source === 'nepu' ? '有本地数据 · 未验证会话' : '尚未登录'),
    cx: st.cx === 'on'
      ? '已登录' + (CX.user ? ' · ' + CX.user : '')
      : (st.cx === 'unknown' ? '还没查过' : '还没登录'),
  };
  const act = { school: st.school === 'on' ? '同步' : '登录', cx: st.cx === 'on' ? '断开' : '连接' };
  const rows = ACC_SYS.map((s) => ({
    id: s.id, k: s.k,
    on: st[s.id] === 'on', warn: st[s.id] === 'expired',
    text: say[s.id], act: act[s.id] || '',
  }));

  // 慧生活：两个账号，各自独立
  if (typeof CX === 'undefined' || typeof WT === 'undefined') return;
  const wtDev = (WT.accounts && WT.accounts.device) || null;
  const wtSco = (WT.accounts && WT.accounts.score) || null;
  const wtKnown = wtStateAt > 0 || !!wtDev || !!wtSco;
  rows.push({
    id: 'wt-device', k: '慧生活 · 设备',
    on: !!wtDev,
    text: wtDev ? wtMaskPhone(wtDev.phone || '') + ' · 已登录'
                : (wtKnown ? '还没登录 · 接水、余额要用它' : '还没查过'),
    act: wtDev ? '退出' : '登录',
  });
  rows.push({
    id: 'wt-score', k: '慧生活 · 积分',
    on: !!wtSco,
    text: wtSco ? wtMaskPhone(wtSco.phone || '') + ' · 已登录'
                : (wtKnown ? '还没登录 · 积分、签到要用它' : '还没查过'),
    act: wtSco ? '退出' : '登录',
  });

  return rows;
}

/** 把「已连 N 个」写上去。和账号页用**同一份** `accRows()`。
 *
 *  🔴 `warn` 也算「连过」：门户过期时账号页写的就是「已连接 · 登录过期了」，
 *     财务处读不出来那行也写着「记得你登过」。数字跟着这一屏的写法走，
 *     否则同一屏会出现「七行里四行说连着、摘要说三个」。
 *  🔴 0.38.0：原来写「已连 N / 3」，用户 2026-11-01 指出那看着像账号上限
 *     ⇒ 去掉分母。0 个时别写「已连 0 个」，那是句废话。
 */
function paintAccCount() {
  const el = $('meAccounts');
  if (!el) return;
  const nAcc = accRows().filter((r) => r.on || r.warn).length;
  el.textContent = nAcc ? ('已连 ' + nAcc + ' 个') : '还没连';
}

function renderAccounts() {
  const rows = accRows();
  $('accList').innerHTML = rows.map((r) => {
    // 一条一个状态记号：小圆点 + 墨色文字。不用彩色胶囊 ——
    // 六行里有一半是「连着的」，彩色会把这一屏染成花布。
    const quiet = r.act === '解绑' || r.act === '断开' || r.act === '退出';
    return '<div class="acc-row" data-row="' + r.id + '">' +
      '<div class="acc-main">' +
      '<span class="acc-k">' + esc(r.k) + '</span>' +
      '<span class="acc-s"><i class="acc-dot' + (r.on ? ' on' : (r.warn ? ' warn' : '')) +
      '"></i>' + esc(r.text) + '</span>' +
      '</div>' +
      (r.act ? '<button class="acc-act' + (quiet ? ' quiet' : '') +
        '" data-acc="' + r.id + '">' + r.act + '</button>' : '') +
      '</div>';
  }).join('');
  // 在这一屏登 / 断之后，「我的」那个数字也要跟着变（它就在上一页上，
  // 不刷的话退回去看到的是改动前的数）。
  paintAccCount();
}

$('accList').addEventListener('click', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('[data-acc]') : null;
  if (!b) return;
  const who = b.dataset.acc;
  if (who === 'wt-device' || who === 'wt-score') {
    // 已登录 → 退出；没登录 → 就地展开登录表（和以前那两个按钮同一个动作）
    wtAccTap(who === 'wt-score' ? 'score' : 'device');
    return;
  }
  if (who === 'school') {
    (nepuSession ? doSync() : doNepuLogin());
    return;
  }
  if (who === 'cx') {
    if (CX.state === 'ok') { cxDisconnect().then(renderAccounts); return; }
    // 连接 = 去「学习」页的学习通段填账号。不在这儿再放一个登录表单 ——
    // 两个表单就是两套校验，改一处必漏一处（cxPaintLogin 已经踩过）。
    switchTab('exams');
    // 学习通落在导航条的第一格
    CFG.examView = 'cx';
    store.set(KEY.settings, CFG);
    renderExamView();
    return;
  }
});

$('rowAccounts').addEventListener('click', () => switchTab('accounts'));

/* 饮水钱包摘要；点击后进入慧生活798的账单页面。 */
function paintMiniWallets() {
  const wv = $('mcWaterV');
  if (!wv) return;
  const ws = $('mcWaterS');
  if (typeof WT.bal === 'number' && isFinite(WT.bal)) {
    wv.textContent = '¥' + WT.bal.toFixed(2);
    wv.className = 'mc-v';
    ws.textContent = WT.loadedAt
      ? '接水 · ' + agoText(WT.loadedAt / 1000) + '更新'
      : '接水 · 消费记录';
  } else {
    const dev = !!(WT.accounts && WT.accounts.device);
    wv.textContent = dev ? '没读到' : '未登录';
    wv.className = 'mc-v unknown';
    ws.textContent = dev ? '点开重试' : '登录后看余额';
  }
}

if ($('mcWater')) {
  $('mcWater').addEventListener('click', () => {
    const target = ($('waterOn') && !$('waterOn').hidden)
      ? ($('wtBillOpen') || $('waterOn')) : $('wtNeedLogin');
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}


$('accBack').addEventListener('click', () => switchTab('me'));

/* ---------------------------------------------------------------- 学习通
 *
 * 只读：不签到、不刷课、不自动答题、不代交。
 * 那些是学术诚信红线；而且超星是分级风控 —— 首次警告 → 冻结 24 小时 →
 * 灰名单要人工申诉。脚本化操作真会被封，所以这条路只走「读」。
 *
 * 为什么是「检查一次」而不是实时：
 *   学习通没有「一次拿全部作业」的接口，作业挂在每门课下面，一门一门来。
 *   32 门课 = 64 个请求 = 40~60 秒。手机上每次进页面都跑这个不现实，
 *   所以是「点了才查 → 结果缓存 → 写明更新于什么时候」。
 *
 * 🔴 三件事不能省：
 *   1. 某门课读不到要如实说「N 门没查到」，不能让它悄悄变成「没有作业」；
 *   2. 没有倒计时的作业**不等于**已过期（实测真有「未交但没倒计时」的）；
 *   3. 断开连接要连缓存一起清，否则换个人拿这手机还能看到你的作业。
 */
/* 学习通列表首屏铺几条。
   🔴 真机 360×712 上这一页的可用高度是 544（四个分段各扣掉分段条之后）。
      这一整套 = 头部 + 签到卡 + 分类药丸 + 列表 + 「还有 N 条」+ 两颗按钮。
      原来排序是单独一行「按紧急度 | 按课程」（40px + 上下缝），4 条时整页
      656、要滑 112，才降到 3 条。后来把排序缩成分类药丸行右边的一颗按钮
      （省 48px）。但实测 4 条仍是 620 / 544 —— 多出来的不只是排序那一行，
      还有签到卡和「还有 N 条」。所以 3 条不变。
      ⇒ 排序并进分类行省下的 48px，用来把 3 条**完整显示**（不再挤），
        以及让签到卡不必再压。 */
const CX_FIRST = 3;

const CX = {
  state: null,      // null 没问过 / 'none' 没登录 / 'ok'
  user: '',
  saved: false,     // 本机存着密码
  canRelink: false, // 账号+密码都在 ⇒ 登录态过期时能一键重连，不用再输
  scan: null,       // {state:'idle'|'scanning'|'done'|'error', i, n, course, err, kind}
  data: null,       // 上次扫描结果
  // 扫描前那一份 + 「这次新查到的」key 集合。用来在列表上打「新」标。
  // 🔴 必须存在 CX 上而不是 DOM 上：cxPaint 每次重画都换掉 #cxBody 的 innerHTML，
  //    存 DOM 里的话一重画就丢（和 signOpen 同一个理由）。
  prevData: null,
  newKeys: null,
  age: -1,          // 距今多少秒。-1 = 没查过
  busy: false,
  timer: 0,
  // 上次**自动**查失败的时刻（unix 秒）。0 = 没失败过。
  // 自动查是静默的：不记这笔账的话，一次抖动会让用户每次进页面都撞一次，
  // 而他只会看到「一进这一页就转圈」，还以为是自己网络的问题。
  autoFailAt: 0,
  // 轮询的两笔账（见 CX_POLL_FAIL_MAX / CX_STUCK_MS 的注释）：
  //   pollFails —— 连续几次没拿到 /api/cx/todo，拿到一次就清零
  //   sig/sigAt —— 进度指纹，以及这个指纹第一次出现的时刻
  pollFails: 0,
  sig: '',
  sigAt: 0,
  // 签到卡的「看全部」是否展开。放在这里而不是 DOM 上：cxPaint 每次重画
  // 都会换掉 #cxBody 的 innerHTML，展开状态存在 DOM 上就丢了。
  signOpen: false,
  // 0.33.0：列表**首屏**显示几条。用户要「内容都在一页内，不用上下滑」，
  // 而这一页天生是「N 门课里的一堆待办」—— 一条 79px，十条就是 790。
  // 给前 4 条 + 一颗「还有 N 条」最诚实：默认这一屏就是最紧急的那几条。
  // 🔴 换分类 / 换分组时要重置回 CX_FIRST（见 cxBind），否则「看完了全部」
  //    的状态会漏到另一个分类里，表现是「换了筛选还是老长一页」。
  // 条数只由 CX_FIRST 决定（实测 3 条；为什么不还回 4，见它上面那段实测记录）。
  // 这里写常量不写数字：改条数只改一处，别让两个地方各说各的
  // —— 2026-11-05 发现这里原来写着「还是 4」，而常量早就是 3 了。
  showN: CX_FIRST,
  // 「已完成的」那一段是否展开。和 showN / signOpen 一样必须存在 CX 上：
  // cxPaint 每次都换掉 #cxBody 的 innerHTML，存 DOM 上会一重画就丢。
  showDone: false,
  // 学习通收件箱（网页端那个「通知中心」）。
  //   state: '' 没拉过 / 'loading' / 'ok' / 'error'
  //   at:    上次**拿到数据**的时刻（毫秒）。用来决定要不要再拉一次 ——
  //          后端也有 5 分钟缓存，这里再挡一道，免得离开这页又回来时
  //          在同一个 5 分钟里连问好几次。
  //   open:  展开的是哪一条（下标）。-1 = 都没展开。
  mail: { state: '', list: [], unread: 0, age: -1, err: '', kind: '', at: 0, open: -1 },
  /* 随堂练习快查（0.52.3 v6）—— 只查「今天有课的那 1~3 门」的活动列表。
   * 用户 2026-11-14：「很多随堂练习只有几分钟持续时间，当场刷新完全来不及」。
   * `items` / `signs` 只放此刻**还能做**的，渲染时置顶；它**不覆盖** d.items，
   * 全量扫描那份照旧是唯一的「全量」。 */
  live: { at: 0, items: [], signs: [], checked: 0 },
};

function cxStopPoll() {
  if (CX.timer) { clearInterval(CX.timer); CX.timer = 0; }
}

/** 轮询自己判定「这一场已经废了」，就地落 error 态。
 *
 *  为什么要前端自己造一个 error、而不是等后端回一个：后端那个线程可能还在跑，
 *  只是**我们这边收不到**（切了网、后端重启了）。等下去就是无限等。
 *  落 error 之后界面才有出口 —— error 态本来就有「重新检查」按钮。
 */
function cxPollGiveUp(msg) {
  cxStopPoll();
  CX.scan = Object.assign({}, CX.scan || {}, { state: 'error', err: msg, kind: '' });
  // 账要清掉：不清的话下一次扫描还带着「已失联 3 次」/「上个钟头的指纹」，
  // 一开跑就立刻再判一次 —— 修 bug 引入一个更快的 bug。
  CX.pollFails = 0;
  CX.sig = '';
  CX.sigAt = 0;
  toast('检查失败：' + msg);
  renderMe();
  cxPaint();
}

/** 分钟数说人话：「3 天 5 小时」「2 小时 10 分钟」。null 返回空串。 */
/** 这一条还剩多少分钟 —— **现在**算，不用扫描时冻住的那个数。
 *
 *  为什么要有这个函数：列表页只给「还剩 2 小时 10 分钟」，所以扫描那一刻
 *  把它换算成绝对时间存进 endAt（后端 parse_work / parse_exam 做的）。
 *  之后一律从 endAt 现算 —— 否则缓存放两小时，界面上还写着「还剩 2 小时」，
 *  而下面那行「截止 15:40」已经过去了，两个数自己打架。
 *  没有 endAt（老缓存 / 页面没给倒计时）就退回 leftMin。
 *
 *  🔴 返回**可以是负数**（已经过点了）。以前这里夹到 0，于是过期作业显示成
 *     「还剩 不到 1 分钟」还标红 —— 明明已经交不了了，界面还在催。
 *     学习通把「已过截止」的作业在列表里多留一阵（state 还是 todo），
 *     再加上缓存放几天，这条很容易真被看到。调用方见 `over` 分支。
 */
function cxMinLeft(it) {
  if (!it) return null;
  if (it.endAt) return Math.round((it.endAt - Date.now() / 1000) / 60);
  if (it.leftMin != null) return it.leftMin;
  // 🔴 0.46.0：只有开始时间的签到，窗口用 CX_SIGN_LIVE_SEC 推出来。
  //    以前这里到 `leftMin == null` 就返回 null，于是「能签、但算不出还剩多久」
  //    的那类签到，行上什么都不写，落到「已结束」那一支去 —— 和卡头的
  //    「N 个正在进行」直接打架。判据必须和 cxSignOpen 用同一个窗口。
  if (it.kind === 'sign' && it.startAt) {
    return Math.round((it.startAt + CX_SIGN_LIVE_SEC - Date.now() / 1000) / 60);
  }
  return null;
}

function cxLeft(min) {
  if (min == null) return '';
  if (min < 1) return '不到 1 分钟';
  if (min < 60) return min + ' 分钟';
  const h = Math.floor(min / 60); const m = min % 60;
  if (h < 24) return m ? h + ' 小时 ' + m + ' 分钟' : h + ' 小时';
  const d = Math.floor(h / 24); const hh = h % 24;
  return hh ? d + ' 天 ' + hh + ' 小时' : d + ' 天';
}

/** 剩余时间**粗一档**：4 天 / 5 小时 / 20 分钟。
 *
 *  只给桌面小组件用。列表里写「4 天 22 小时」是对的（那一行有的是地方），
 *  而小组件标题行右侧只有 60dp —— 写全了会把「周三 · 3 节」挤成「周三 · 3 …」。
 */
function cxLeftShort(ms) {
  const m = Math.max(0, Math.round(Number(ms) / 60000));
  if (m < 1) return '不到 1 分钟';
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时';
  return Math.floor(h / 24) + ' 天';
}

/** 桌面小组件标题行右侧那条作业：**最近**要交的一条。
 *
 *  🔴 只给一条：那一格只有 60dp 宽，列三条就成了一片字。
 *  🔴 排除「我交过了」和已经过点的 —— 把一条早就交了的作业挂在桌面上，
 *     比不挂更让人不放心（他会以为它一直没交）。
 *  🔴 返回 null 时 Java 那边把这一格整个藏起来，不会留下一个空的「作业」。
 */
function dueSoon() {
  const one = dueSoonList()[0];
  if (!one) return null;
  return { c: one.c, h: one.h };
}

/** 桌面上要显示的那几条提醒：**最近的一条作业** + **最近的一场考试**（2026-11-14）。
 *
 *  用户：「作业截止和考试提醒也在小组件上添加一下，注意多尺寸适配」。
 *
 *  🔴 两类各取最近的一条，不是「总体上最近的两位」：全都堆成作业的时候，
 *     考试那条永远排不进去（考试本来就少），而它恰恰是最不该错过的。
 *  🔴 排序仍然是按时间 —— 谁先到谁排前面，Java 那边照顺序画，不重排。
 *  🔴 只要还没过点、没被标成「我交过了」的。挂在桌面上一条早就交了的，
 *     比不挂更让人不放心（他会以为它一直没交）。
 */
function dueSoonList() {
  const c = store.get(KEY.due, null);
  const list = (c && Array.isArray(c.list)) ? c.list : [];
  const now = Date.now();
  let work = null, exam = null;
  list.forEach((it) => {
    const end = Number(it && it.e) * 1000;
    if (!(end > now)) return;
    if (dueMarked(it)) return;
    const rec = {
      end: end,
      k: it.k === 'exam' ? 'exam' : 'work',
      c: String(it.c || '').slice(0, 8),
      t: String(it.t || '').slice(0, 16),
    };
    if (rec.k === 'exam') { if (!exam || end < exam.end) exam = rec; }
    else if (!work || end < work.end) work = rec;
  });
  const out = [work, exam].filter(Boolean)
    .sort((a, b) => a.end - b.end)
    .map((x) => ({ k: x.k, c: x.c, t: x.t, h: cxLeftShort(x.end - Date.now()) }));
  return out.slice(0, 2);
}

/** 「上次检查距今多久」。 */
function cxAgo(sec) {  if (sec == null || sec < 0) return '没查过';
  if (sec < 60) return '刚刚';
  if (sec < 3600) return Math.round(sec / 60) + ' 分钟前';
  if (sec < 86400) return Math.round(sec / 3600) + ' 小时前';
  return Math.round(sec / 86400) + ' 天前';
}

async function cxRefresh(silent) {
  try {
    const st = await api('/api/cx/status');
    CX.state = st.linked ? 'ok' : 'none';
    CX.user = st.user || '';
    CX.saved = !!st.saved;          // 本机存着密码
    CX.canRelink = !!st.canRelink;  // 账号+密码都在 ⇒ 能一键重连
    CX.scan = st.scan || null;
    const t = await api('/api/cx/todo');
    CX.scan = t.scan || CX.scan;
    CX.data = t.data;
    CX.age = typeof t.age === 'number' ? t.age : -1;
    // 读到就用：进「学习」页这一步拿到的就是学习通缓存，课表上的刻度和
    // 两小时前的提醒都靠这份（见 dueCacheSave 的数据源说明）。
    if (CX.data) dueCacheSave(CX.data.items, 'cx');
    renderMe();
    return true;
  } catch (e) {
    if (!silent) toast('读不到学习通状态：' + e.message);
    return false;
  }
}

/** 进「学习」页时调用。
 *
 *  🔴 第一次进来才问后端（CX.state === null），之后切 tab 只重画 ——
 *     学习通一次状态查询要打两个接口，来回切 tab 打得太密不合适。
 *     想强制刷新有「重新检查」按钮。 */
async function cxEnter() {
  if (CX.state === null) await cxRefresh(true);
  cxPaint();
  // 🔴 自动查必须放在 cxRefresh 之后：那之前 CX.data 还是空的，
  //    判断「上次什么时候查的」会永远得出「没查过」。
  cxAutoScan();
}

/** 到点了就自己查一次（0.39.0）。返回是否真的发了这一趟。
 *
 *  什么时候调：进「学习」页、从后台切回「学习」页、登录/重连成功后。
 *
 *  🔴 三条不做的事：
 *    1. **不弹 toast**。自动查是背景行为，弹一次「正在查」比不查更烦；
 *    2. **不打断正在进行的扫描**（CX.busy / scan.state==='scanning' 直接返回）；
 *    3. **不动登录态**。CX.state !== 'ok' 就返回 —— 别把用户刚打开的
 *       登录表单顶掉，也别替他决定要不要登录。
 */
function cxAutoScan() {
  if (CX.state !== 'ok') return false;
  if (CX.busy) return false;
  if (CX.scan && CX.scan.state === 'scanning') return false;
  // 上次自动查失败了 ⇒ 隔 CX_AUTO_RETRY 再试，别每次进页面都撞一次
  const nowSec = Date.now() / 1000;
  if (CX.autoFailAt && nowSec - CX.autoFailAt < CX_AUTO_RETRY) return false;
  // 判据用「上次扫完的时刻」，不用 CX.age ——
  //   age 是服务端算好的「距今多少秒」，它不会随时间自己长；
  //   用户在别的页面待了两小时再回来，age 还停在两小时前的那个数，永远不会触发。
  const lastAt = CX.data && CX.data.at ? Number(CX.data.at) : 0;
  if (lastAt && nowSec - lastAt < CX_AUTO_SEC) return false;
  cxScanStart(false, false, true);
  return true;
}

function cxPaint() {
  const box = $('cxBody');
  if (!box) return;
  if (CX.state === null) {
    box.innerHTML = '<p class="tip">正在读学习通状态…</p>';
    return;
  }
  if (CX.state !== 'ok') { cxPaintLogin(); return; }
  cxPaintTodo();
}

/* ---------------- 随堂练习快查（0.52.3 v6） ----------------
 *
 * 用户 2026-11-14：「很多随堂练习只有几分钟持续时间，当场刷新完全来不及」。
 *
 * 全量扫描四十秒起步，等它回来这一节已经下课了。而随堂练习只可能出现在
 * **今天正在上的那几门课**里 —— 拿教务课表算出今天有哪几门，只对这几门问
 * 活动列表，通常 1~3 个请求、两秒内回来。这条路只在**前台**跑，不进后台。
 *
 * 🔴 不顶进度条、不写扫描缓存、不改 CX.scan：它不是一次扫描，
 *    失败了也只是「这次没赶上」，页面上的数据照旧是上一轮全量那份。
 * 🔴 一分钟最多一次（切页来回点不该变成连发请求），和收件箱那条同一套思路。
 */
const CX_LIVE_GAP = 60 * 1000;
let cxLiveBusy = false;

/** 今天有课的那几门（课名 + 老师）—— 给快查收窄范围用。
 *  周次按本机开学日算（`currentWeek`），不看门户那个坏掉的周次。 */
function cxTodayNames() {
  const wk = currentWeek();
  const day = (new Date().getDay() + 6) % 7;      // 周一 = 0
  const out = [];
  ((DATA && DATA.courses) || []).forEach((c) => {
    if (!c || !c.name || !Array.isArray(c.slots)) return;
    if (!c.slots.some((s) => Number(s && s.day) === day)) return;
    // 有周次表就按周次判，没有就当天天有课（宁可多问一门，不能漏）。
    if (Array.isArray(c.weeks) && c.weeks.length && c.weeks.indexOf(wk) < 0) return;
    out.push({ name: c.name, teacher: c.teacher || '' });
  });
  return out.slice(0, 6);
}

/** 学习通自己说「已完成」的那批，按**归一化标题**做集合。
 *
 *  🔴 为什么不用 cxItemKey：快查（`/api/cx/live`）返回的条目没有 courseId，
 *     同一个练习在快查里和在扫描结果里 key 不一样 —— 拿 key 比会永远判成
 *     「两条」，于是做完的练习照样被顶上去。标题是两边唯一的共同点。
 *  🔴 按 CX.data 缓存一次：这个集合在每次重画里要被问几十次，逐条重建
 *     是 O(n²)，列表上百条时能拖出可感的卡顿。 */
let _cxDoneTitles = null;
let _cxDoneTitlesFor = null;
function cxDoneTitleSet() {
  const d = CX.data;
  if (_cxDoneTitles && _cxDoneTitlesFor === d) return _cxDoneTitles;
  const set = new Set();
  const rows = (d && Array.isArray(d.doneItems)) ? d.doneItems : [];
  rows.forEach((it) => {
    const k = cxTitleKey(it && it.title);
    if (k) set.add(k);
  });
  _cxDoneTitles = set;
  _cxDoneTitlesFor = d;
  return set;
}

/** 这条「正在进行」的练习还能不能算「现在就要做」。
 *
 *  用户 2026-11-15：「消息里面的随堂练习，有很多已经做完了，但老师没有手动
 *  结束，这种理应不再置顶」。
 *
 *  🔴 和签到同一个形状的毛病（见 cxSignOpen 那段）：`state === 'live'` 只是
 *     **老师没点结束**，不是「我还能做」。所以三条一起判：
 *       ① 我做过（学习通说已完成 / 我自己标过 / 它已经在那批「已完成」里）
 *          ⇒ 不再顶；
 *       ② 有截止时间就按截止时间；
 *       ③ 没有截止时间、只有开始时间：练习是几分钟的事，两个小时还挂着，
 *          一定是老师忘了关 —— 那时候还写「进行中」，等于替一个已经结束的
 *          活动继续催人。
 *  ⚠️ 两头都没有时间的，照旧算「正在进行」：没有任何证据说它结束了，
 *     这时候把「不知道」说成「结束了」，会让人漏做一场真的练习。 */
const CX_QUIZ_LIVE_SEC = 2 * 3600;

function cxQuizOpen(it) {
  if (!it) return false;
  if (it.state === 'done') return false;
  if (cxMarkedDone(it)) return false;
  const k = cxTitleKey(it.title);
  if (k && cxDoneTitleSet().has(k)) return false;
  if (it.state !== 'live') return false;
  const now = Date.now() / 1000;
  if (it.endAt) return it.endAt > now;
  if (it.startAt) return (now - it.startAt) < CX_QUIZ_LIVE_SEC;
  return true;
}

/** 快查回来的这条现在还值不值得顶到最上面。
 *  🔴 `state==='live'` 是扫描那一刻的说法，可能已经过了十几分钟 ——
 *     `cxSignOpen` 那套时间判断在这里同样适用，所以带 `leftMin` 的也看一眼。
 *     30 分钟是「一节课」的量级：练习就是这个尺度，作业不是。 */
function cxLiveOpen(it) {
  if (!it) return false;
  // 签到、练习各有一套「真的还能做吗」的判据（老师忘关的、我做完了的），
  // 这里直接借用 —— 三处（快查并表、消息弹层、这里的排序）必须是同一个答案。
  if (cxKindOf(it) === 'sign') return cxSignOpen(it);
  if (cxKindOf(it) === 'quiz') return cxQuizOpen(it);
  if (it.state === 'done' || cxMarkedDone(it)) return false;
  if (it.state === 'live') return true;
  const min = cxMinLeft(it);
  return min != null && min >= 0 && min <= 30;
}

/** 把快查到的「正在进行」并到列表最前面（去重按 cxItemKey）。
 *  返回新数组，不改入参 —— 调用方拿到的 all 还要用来算计数。 */
function cxWithLive(list) {
  const arr = Array.isArray(list) ? list : [];
  const live = ((CX.live && CX.live.items) || []).filter(cxLiveOpen);
  if (!live.length) return arr;
  const seen = {};
  arr.forEach((it) => { seen[cxItemKey(it)] = 1; });
  const extra = live
    .filter((it) => !seen[cxItemKey(it)])
    // 复制一份再打标：CX.live 里那份还要用来算「还开着吗」，不改它。
    .map((it) => Object.assign({}, it, { liveNow: 1 }));
  return extra.length ? extra.concat(arr) : arr;
}

/** 签到卡也要吃到快查的结果 —— 签到和一节课同寿，全量扫描那份常常是旧的。 */
function cxSignsWithLive(d) {
  const base = (d && Array.isArray(d.signs)) ? d.signs : [];
  const live = ((CX.live && CX.live.signs) || []);
  if (!live.length) return base;
  const seen = {};
  base.forEach((it) => { seen[cxItemKey(it)] = 1; });
  const extra = live.filter((it) => !seen[cxItemKey(it)]);
  return extra.length ? extra.concat(base) : base;
}

/** 跑一次快查。`force` 跳过一分钟节流。 */
async function cxLiveRun(force) {
  if (CX.state !== 'ok' || cxLiveBusy) return;
  if (!force && Date.now() - (CX.live.at || 0) < CX_LIVE_GAP) return;
  const names = cxTodayNames();
  if (!names.length) return;            // 今天没课，这门课就没练习
  cxLiveBusy = true;
  // 先记时刻：失败了也别在同一分钟里反复撞（学校服务器最烦的就是这个）。
  CX.live.at = Date.now();
  try {
    const r = await api('/api/cx/live', {
      names: names,
      semester: (DATA && DATA.semester) || '',
    });
    if (r && r.ok) {
      CX.live.items = Array.isArray(r.items) ? r.items : [];
      CX.live.signs = Array.isArray(r.signs) ? r.signs : [];
      CX.live.checked = Number(r.checked) || 0;
      if (CUR_PAGE === 'exams') cxPaint();
    }
  } catch (e) { /* 快查是加分项：失败就当没查，页面照旧 */ }
  cxLiveBusy = false;
}

// CX login and connection states are rendered below.

// 「连过但登录态过期」不走这里，走 cxPaintTodo 里的「重连」按钮 ——
// 那种情况下账号密码都还在本机，让人再输一遍正是用户 2026-10-22 抱怨的事。

function cxPaintLogin() {
  $('cxBody').innerHTML =
    '<div class="card cx-login">' +
    '<h2 class="cx-h">连上学习通</h2>' +
    // 0.39.1：原来是「用你自己的账号。只读作业和截止时间 —— 不签到、不刷课、
    //    不自动答题、不代交。」那串排比是**写给我们自己安心**的，
    //    用户只需要知道一件事：登进去能看到作业，别的不会发生。
    '<p class="cx-p">只读作业和截止时间，不代交、不刷课</p>' +
    // 学习通也是**全国**的平台，账号是你在超星注册的那个手机号 ——
    // 学号只在学校自己的教务里有。写清楚，省得用户拿学号白试一次。
    '<p class="cx-p cx-hint">账号是你在学习通绑定的手机号，不是学号。</p>' +
    '<label class="field"><span>手机号</span>' +
    '<input id="cxUser" type="text" inputmode="numeric" autocomplete="username" ' +
      'placeholder="学习通绑定的手机号"></label>' +
    '<label class="field"><span>密码</span><span class="pwdbox">' +
    '<input id="cxPass" type="password" autocomplete="current-password" ' +
      'placeholder="学习通密码">' + pwdEyeHtml('cxPass') + '</span></label>' +
    pwdHelpHtml('cx') +
    '<button class="btn primary block" id="cxGo">连上</button>' +
    // 0.39.1：原来是「密码只用来换一次登录凭证，之后和门户密码一样加密存在
    //    这台手机里。存住以后登录态过期，点一下「重连」就行，不用再输。」
    //    —— 三句话说了一件事，还夹着「登录凭证」这种词。
    '<p class="cx-note" id="cxTip">密码只存本机，过期点「重连」即可</p>' +
    '</div>';

  // 出错时把这行变红。默认是灰色说明 —— 一进来就红着，像在报错。
  const tip = (s, bad) => {
    const t = $('cxTip');
    if (!t) return;
    t.textContent = s || '';
    t.classList.toggle('err', !!bad);
  };

  const go = async () => {
    const user = ($('cxUser').value || '').trim();
    const pass = $('cxPass').value || '';
    // 密码可以留空（后端会用本机存的那份），账号必须填 ——
    // 后端要拿账号核对「存着的密码是不是这个人的」，对不上直接拒。
    if (!user) { tip('手机号要填', true); return; }
    if (!pass) { tip('密码要填', true); return; }
    const btn = $('cxGo');
    btn.disabled = true;
    btn.textContent = '连着…';
    tip('正在登录…');
    try {
      const r = await api('/api/cx/login', { user: user, pass: pass });
      if (!r.ok) {
        // 🔴 不重试：重试会把超星的 needVcode 撞成 1，之后要人做滑块
        tip(r.error || '登录没成功', true);
        if (r.pwdStale) CX.saved = false;
        btn.disabled = false;
        btn.textContent = '连上';
        return;
      }
      CX.state = 'ok';
      CX.user = r.user || user;
      CX.saved = true;
      CX.canRelink = true;    // 刚存下的账号+密码，下次过期能一键重连
      // 密码没存住要说出来 —— 静默失败的话，用户只会觉得「怎么又要输」
      if (r.saved) toast('连上了，但密码没能存下来（' + r.saved + '），下次还要再输一次');
      renderMe();
      cxPaint();
      // 连上就直接查一次，省得用户再点一下
      cxScanStart();
    } catch (e) {
      tip('登录出错：' + e.message, true);
      btn.disabled = false;
      btn.textContent = '连上';
    }
  };
  $('cxGo').addEventListener('click', go);
  $('cxPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// -- 已登录：待办 --------------------------------------------------
//
// 两种看法，用户 2026-10-22 的原话：
//   「可以按照课程单独看其信息，也可以直接看所有课程的作业和考试，
//     按照结束时间快慢（也就是紧急程度）排序」
// ⇒ 「按紧急度」= 所有课混在一起，最急的排最前；
//    「按课程」= 先按课分堆，堆内部照样按急的排，堆之间按「这堆里最急的那条」排。
//    选哪个记进 CFG（cxGroup），下次进来还是那个。

// -- 分类（作业 / 考试 / 签到 / 讨论 / 通知）------------------------
//
// 用户 2026-10-22 的原话：
//   「学习通的作业信息也分成几种，比如主题讨论，签到信息，作业，考试」
// 后端给每条都打了 kind（见 mobile/chaoxing.py 的 KIND_BUCKET），
// 这里只负责筛选和显示。🔴 顺序和中文名跟后端 KIND_ORDER / KIND_NAME 对齐，
// 两边各写一份会漂移 —— 改一处记得搜另一处。

// 「练习」是 0.39.0 加的：随堂练习（type 42）和互动练习（68）以前落在「其他」里，
// 和「白板 / 教案 / PDF 文档」挤同一格 —— 那格是垃圾桶，真正的任务淹在里面
// 等于没提示。用户 2026-11-01 原话：「还很容易错过作业和考试，还有随堂练习」。
const CX_KINDS = ['work', 'exam', 'quiz', 'sign', 'topic', 'notice', 'other'];
const CX_KIND_NAME = {
  work: '作业', exam: '考试', quiz: '练习', sign: '签到',
  topic: '讨论', notice: '通知', other: '其他',
};

/** 一条属于哪类。
 *  🔴 0.12 及以前的数据没有 kind 字段（那时只有作业），兜底成 work ——
 *     兜成 other 会让老数据全跑到「其他」里，看着像坏了。 */
function cxKindOf(it) {
  const k = it && it.kind ? String(it.kind) : 'work';
  return CX_KINDS.indexOf(k) >= 0 ? k : 'other';
}

function cxKindCounts(items) {
  // 🔴 2026-11-09：以前这里手写 `{work:0, exam:0, sign:0, topic:0, notice:0, other:0}`
  //    —— **少了 quiz**。于是 `m['quiz'] += 1` 是 `undefined + 1` = NaN，
  //    而 NaN 在 `if (!c[k]) return;` / `counts[k] > 0` 里都是假 ⇒
  //    「练习」那颗药丸永远不出现，用户点不进随堂练习。
  //    这就是「学习通看不到随堂练习」的直接原因。
  //    以后加分类只改 CX_KINDS 一处，这个表自己跟着长，不会再漏。
  const m = {};
  CX_KINDS.forEach((k) => { m[k] = 0; });
  (items || []).forEach((it) => { m[cxKindOf(it)] += 1; });
  return m;
}

/** 当前选的分类。选了个已经没数据的（比如重查后考试都考完了）就退回「全部」。 */
function cxKindFilter(items) {
  const want = CFG.cxKind || 'all';
  if (want === 'all') return 'all';
  const c = cxKindCounts(items);
  return (c[want] || 0) > 0 ? want : 'all';
}

/** 一场签到现在还能不能签。
 *
 *  `state` 是**扫描那一刻**学习通给的说法；时间和「签没签过」才是硬证据 ——
 *  缓存放一天，昨天那场签到还写着 live。卡片和顶部那句「签到在进行」
 *  必须用同一个判据，否则会一个说「正在进行」一个说「都清了」。
 *
 *  🔴 0.44.0：老师没点「结束」的签到要当成已结束。
 *     用户 2026-11-03：「有些签到似乎老师并没有截止，但事实上已经没用了
 *     或者签过了，应当视为已结束」。截图里那张卡的标题写着「1 个正在进行」，
 *     下面唯一一行却写着「已结束」—— 两句话自相矛盾，因为标题只看了
 *     `state === 'live'`，而那一行没有时间可用，落到了「已结束」。
 *     现在三条一起判，标题和行、顶部和卡片都用同一个答案：
 *       ① 已经签过的（signed === true）不算「正在进行」—— 签不了第二次，
 *          摆在「正在进行」里只会让人以为还有事没做；
 *       ② 有开始时间、但已经过去 CX_SIGN_LIVE_SEC 的，算结束。签到是当堂
 *          的事，过了一上午还挂着「进行中」，是老师忘了关；
 *       ③ 连开始时间都没有的一场 live，也不算能签 —— 没有任何证据说明
 *          它还没结束，这时候说「正在进行」就是把「不知道」说成了「知道」。
 *     ⚠️ 只有 endAt 的仍然照 endAt 判（那是老师真设了截止时间）。
 */
const CX_SIGN_LIVE_SEC = 4 * 3600;

function cxSignOpen(it) {
  if (!it) return false;
  // ① 签过了就是签过了。`signed` 认不出来时是 null，不能当成 false。
  if (it.signed === true) return false;
  // 🔴 只认 live。`pending`（未开始）**不算可签** —— 还没开始就点不进去，
  //    给一个「去签到」箭头等于给一个点开是空页面的按钮。
  //    （而且 showNotStartedActive=0 让 pending 压根不会返回，见 chaoxing.py。）
  if (it.state !== 'live') return false;
  const now = Date.now() / 1000;
  // 有终点就按终点算。这是唯一一个老师亲口设过的边界。
  if (it.endAt) return it.endAt > now;
  // ② 没有终点、只有起点：从起点起算一个「签到窗口」。
  if (it.startAt) return (now - it.startAt) < CX_SIGN_LIVE_SEC;
  // ③ 两头都没有：没有证据 ⇒ 不算能签。
  return false;
}

/** 「签到」卡 —— 只**看**，不代签。
 *
 *  🔴 为什么不做「一键签到」：学习通的签到有五种形式，其中三种的「钥匙」
 *     在老师那块屏幕上（手势图案要照着画、二维码要扫、四位数字码要听），
 *     第四种要 GPS 坐标、第五种要拍照。也就是说，除了「伪造位置」这种
 *     等于替他撒谎说「人在教室」的做法，剩下的根本无从下手 —— 那不是
 *     技术难度问题，是不该做。
 *     能做的、也真有用的是：**现在有没有签到、我漏了哪几次**。
 *
 *  数据来自扫描时留下的 d.signs（含已结束的）——
 *  只留正在进行的，「查看签到」就等于什么都没查。
 */
function cxSignCardHtml(d) {
  const list = Array.isArray(d.signs) ? d.signs : [];
  if (!list.length) return '';

  // 「正在签」= 状态是 live 且 endAt 还没过。未开始的不算（点了也签不了），
  // 已经结束的更不算。
  const live = list.filter(cxSignOpen);
  // 历史 = 其余全部（含「state 还说 live、但 endAt 已经过去」的），
  // 不能只写 state !== 'live' —— 那两条都不算，这场签到就凭空消失了。
  const past = list.filter((it) => !cxSignOpen(it));
  // 这里原来还数过「已签 / 漏了」两个数字，2026-11-10 跟着「不显示数量」一起撤了 ——
  // 首屏不再摆任何计数，明细展开就有。

  let h = '<div class="card cx-signcard">' +
    '<div class="cx-signhd"><b>签到</b>' +
    (live.length
      ? '<span class="cx-signlive">' + live.length + ' 个正在进行</span>'
      : '<span class="cx-signidle">现在没有要签的</span>') +
    '</div>';

  if (live.length) {
    h += '<div class="cx-srows">' +
      live.slice(0, 3).map((it) => cxSignRowHtml(it, false)).join('') + '</div>';
  }

  // 历史一律收起，只留一行摘要。
  // 🔴 0.47.0：以前「一条 signed 都认不出来」时会走兜底分支直接铺 8 行 ——
  //    用户 2026-11-06 的截图正是这个样子：签到卡下面挂了 8 条「已结束」，
  //    把整屏占满，真正要看的作业全被挤到下面。
  //    「已经结束一段时间了的就别显示了」—— 已结束的签到只有「我漏了哪次」
  //    的价值，默认收起、点开再看，不给它占首屏。
  // 🔴 一条状态都认不出来时**不给**「已签 0 / 漏了 0」：编个数字比不给更糟，
  //    那会让人以为真的一次没签过。这时只写「最近 N 次签到」。
  // 2026-11-10：用户「签到不要显示数量」。
  // 原来这里写「最近 118 次签到 · 已签 96 · 漏了 2」—— 三个数字。
  // 🔴 那个 118 是**这个账号历史上签到的次数**，属于用户自己的数据，
  //    不该摆在首屏（和「不写课程总数」是同一条口径）。
  //    而「已签 / 漏了」又只是「看全部」里那张表的汇总，点开就有，
  //    首屏留着它只是多一行比大小的数字。
  //    现在只留一句「最近的签到」，展开照样看明细。
  if (past.length) {
    h += '<button class="cx-signtot" id="cxSignMore" aria-expanded="' +
      (CX.signOpen ? 'true' : 'false') + '">' +
      '<span>最近的签到</span>' +
      '<i>' + (CX.signOpen ? '收起' : '看全部') + '</i></button>';
    if (CX.signOpen) {
      // 最多列 12 条。签到记录能到几十条，全铺出来会把下面的作业
      // 一路挤到屏幕外 —— 那是这个页面真正要看的东西。
      const cap = 12;
      h += '<div class="cx-srows">' +
        past.slice(0, cap).map((it) => cxSignRowHtml(it, true)).join('') + '</div>';
    }
  }

  return h + '</div>';
}

/** 签到卡里的一行。hist=true 是历史明细，带日期、不带箭头。 */
function cxSignRowHtml(it, hist) {
  // 只有还没结束的才谈得上「还剩多久」。已结束的 endAt 在过去，
  // cxMinLeft 会给出负数 —— 写出来是「还剩 不到 1 分钟」，像马上要截止。
  const open = cxSignOpen(it);
  const min = open ? cxMinLeft(it) : null;
  const left = (min != null && min >= 0) ? '还剩 ' + cxLeft(min) : '';

  let tail;
  if (it.signed === true) tail = '已签到';
  else if (it.signed === false) tail = left ? '没签 · ' + left : '没签';
  else if (left) tail = left;
  // 🔴 0.44.0：`live` 但已经判成不可签的（老师没关、过了签到窗口、没有时间），
  //    一律写「已结束」。以前这里回落到 `it.status`，学习通偶尔给个
  //    「进行中」，于是卡头说「现在没有要签的」、这一行说「进行中」——
  //    同一张卡里两句话打架。
  //
  // 🔴 0.46.0：**这里必须以 `open` 为准，不能只看 `state === 'live'`**。
  //    2026-11-06 用户截图：卡头「签到 1 个正在进行」，下面唯一一行写着
  //    「已结束」还带着箭头 —— 同一张卡两句话又打起来了。
  //    根因是两套口径：进不进 live 区看的是 cxSignOpen（它认「有 startAt 且
  //    在 4 小时窗口内」），而这一行写什么看的是 cxMinLeft（它只认 endAt /
  //    leftMin）。那类只有开始时间的签到 ⇒ 能签、但算不出剩余 ⇒ left 为空
  //    ⇒ 落到这一支被写成「已结束」。
  //    ⇒ 口径统一到 open 一个判据上。
  else if (it.state === 'live') tail = open ? '进行中' : '已结束';
  else tail = String(it.status || '') || '已结束';

  // 只有还来得及签的才给链接。已结束的签到点进去是一张空页面，
  // 点了没反应比不给箭头更让人困惑。
  const link = (!hist && it.url) ? String(it.url) : '';
  // 「签退」和「签到」是两件事，只写课程名分不出来 —— 标题不是「签到」
  // 的时候补上，是「签到」就省掉（那是绝大多数情况，写出来只是噪声）。
  const label = (it.title && it.title !== '签到')
    ? (it.course ? it.course + ' · ' + it.title : it.title)
    : (it.course || it.title || '签到');
  const name = it.course ? it.course + ' · ' + (it.title || '签到') : (it.title || '签到');

  return '<div class="cx-srow' + (link ? ' tap' : '') + '"' +
    (link ? ' data-url="' + escAttr(link) + '" data-title="' + escAttr(name) + '"' : '') + '>' +
    (hist ? '<span class="cx-sdate">' + esc(cxSignWhen(it)) + '</span>' : '') +
    (CX.newKeys && CX.newKeys.has(cxItemKey(it))
      ? '<span class="cx-new">新</span>' : '') +
    '<span class="cx-scourse">' + esc(label) + '</span>' +
    '<span class="cx-sstate' + (it.signed === false ? ' miss' : '') + '">' +
      esc(tail) + '</span>' +
    (link ? '<svg class="cx-go" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M9 6l6 6-6 6"/></svg>' : '') +
    '</div>';
}

/** 签到发生的日期：10-22 08:05。
 *
 *  🔴 「没有时间」和「时间解析不了」不能共用一个返回值。
 *     以前是 `const sec = it.startAt || it.endAt` —— 只要 startAt **有值**就用它，
 *     哪怕那个值解析不出日期，于是 `new Date(NaN)` 直接返回空串，明明有 endAt 也不看。
 *     界面上那一条历史签到就成了「没有日期」，看着像「学习通压根没给时间」。
 *
 *     现在改成逐个试：startAt 拿不到**可用**的时间才回落 endAt；
 *     两个都拿不到可用时间，才是真的没有时间可显示（返回空串）。
 *     注意「有值」和「能用」是两件事 —— 空值、解析失败的字符串都算不能用。 */
function cxSignWhen(it) {
  const fmt = (sec) => {
    if (!sec) return '';
    const d = new Date(sec * 1000);
    // 有值但解析不了 —— 不是「没有时间」，是「这个值不能用」，交给调用处试下一个
    if (isNaN(d.getTime())) return '';
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes());
  };
  return fmt(it.startAt) || fmt(it.endAt);
}

/** 分类筛选条。只列有数据的类（+ 永远有「全部」）——
 *  一个「考试 0」摆在那儿只会让人以为加载失败了。
 *
 *  🔴 2026-11-11：药丸上**不再挂计数**（原来写「作业 2」）。
 *     一屏 6 类时每个数字要 18px，整行溢出 105px —— 药丸区被排序按钮
 *     挤到 276px，而内容要 381px，最后两颗各被切掉半个字
 *     （用户看见的是「讨」和「按紧急」）。而这一行唯一要做的事是
 *     「一眼看全有哪几类」。数字是统计，点进去就看得到，不值这 105px。
 *     要数数看它上面那行「N 条要交」。 */
function cxCatsHtml(items, group) {
  const c = cxKindCounts(items);
  const cur = cxKindFilter(items);
  const total = (items || []).length;
  // 2026-11-15：这一行原来是**和上面导航一模一样的药丸**，两排挤在一起，
  // 用户看不出哪排是「换页面」、哪排是「筛列表」——「界面太杂乱」说的就是这个。
  // 现在它退成一行灰字：前面挂「只看」两个字，按钮去掉边框和底色，
  // 选中的那个只是**变黑加粗**。视觉重量从「一排按钮」降到「一行说明」。
  let h = '<div class="cx-cats" id="cxCats">' +
    '<span class="cx-cats-l">只看</span>' +
    '<button class="cx-cat' + (cur === 'all' ? ' on' : '') + '" data-kind="all"' +
    ' aria-label="全部，共 ' + total + ' 条">全部</button>';
  CX_KINDS.forEach((k) => {
    if (!c[k]) return;
    h += '<button class="cx-cat' + (cur === k ? ' on' : '') + '" data-kind="' + k + '"' +
      ' aria-label="' + CX_KIND_NAME[k] + '，共 ' + c[k] + ' 条">' +
      CX_KIND_NAME[k] + '</button>';
  });
  h += '</div>';
  // 🔴 2026-11-11：「按紧急度」不再挤在这一行右边。
  //     药丸区只剩 276px（360dp 上 246px），而 6 颗药丸要 303px ——
  //     最后两颗被各切掉半个字，用户看见的是「讨」和「按紧急」。
  //     排序移去头部那行（`.cx-hd`）当一颗 11px 的文字按钮：那一行本来就
  //     「左边 N 条要交 / 右边 5 分钟前 · 3 门课」，它属于同一种元信息，
  //     而且 11px 不撑高那一行。药丸行从此独占整宽，6 类一屏看全。
  return h;
}

/** 排序切换。放在 `.cx-hd` 右端（见 cxPaintTodo）——
 *  它回答的是「这张表怎么排」，和「共几门课」是同一类元信息。 */
function cxSortHtml(group) {
  const byCourse = group === 'course';
  return '<button class="cx-sort' + (byCourse ? ' on' : '') + '" id="cxSort" type="button"' +
    ' aria-label="' + (byCourse ? '当前按课程排序，点击改为按紧急度'
                                : '当前按紧急度排序，点击改为按课程') + '">' +
    (byCourse ? '按课程' : '按紧急度') + '</button>';
}

/** 紧急度排序。
 *  🔴 没倒计时的**垫底**，但不能当 0 —— 那不等于已经过期。
 *     实测真有「未交但没写截止时间」的作业。 */
/** 三段排序的档位：0 还能赶上 / 1 没有截止时间 / 2 已经过期。
 *  🔴 以前直接按剩余分钟升序 —— 过期那条剩余是**负数**，负数最小 ⇒ 排最前面，
 *     一年前的通知占着首屏第一行，真要交的作业掉到第三屏。
 *     后端 open_items.sort 已经是三段，这里是「按课程分堆」之后的重排，
 *     两边口径必须一致，否则分堆视图又把过期项顶回来。 */
function cxSortRank(it) {
  const m = cxMinLeft(it);
  if (m == null) return 1;
  if (it.endAt && it.endAt < Date.now() / 1000) return 2;
  return 0;
}

function cxSortItems(items) {
  return items.slice().sort((a, b) => {
    const ra = cxSortRank(a); const rb = cxSortRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      const x = cxMinLeft(a); const y = cxMinLeft(b);
      return (x || 0) - (y || 0);
    }
    return String(a.course || a.title || '')
      .localeCompare(String(b.course || b.title || ''));
  });
}

/** 按课程分堆。堆的顺序看「这堆里最急的那条」——
 *  一门课有明天到期的，就该排在只有下周到期的课前面。 */
function cxGroupByCourse(items) {
  const map = new Map();
  items.forEach((it) => {
    const k = String(it.course || '') || '（没写课程名）';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  });
  const out = [];
  map.forEach((list, course) => {
    let min = null;
    list.forEach((it) => {
      const mm = cxMinLeft(it);
      if (mm != null && (min == null || mm < min)) min = mm;
    });
    out.push({ course: course, items: cxSortItems(list), min: min });
  });
  out.sort((a, b) => {
    if (a.min == null && b.min == null) return a.course.localeCompare(b.course);
    if (a.min == null) return 1;
    if (b.min == null) return -1;
    return a.min - b.min;
  });
  return out;
}

/** 一条待办。
 *  `showCourse` 为 false 时（按课程分组里）不再重复写课程名。
 *  `showKind` 只在「全部」里为 true —— 分类视图里标题栏已经写着是哪类了，
 *  每条再挂一枚「作业」标纯属噪声。
 *
 *  🔴 有 `url` 的条目可以点开（作业、考试都有详情页；签到/讨论/通知没有，
 *     活动是弹在课程页里的，没有独立地址）。点开走 App 内 WebView，
 *     因为**学习通和门户共用同一个 java.net cookie 罐子**，WebActivity
 *     会把它整个倒进 WebView —— 所以点进去是已登录状态，不用再登一次。
 *     走系统浏览器就不行了，那是第三个罐子。 */
/** 绝对截止时间：10-23 23:59。跨年才带年份（同一年的都省掉，短一些）。 */
function cxDueAt(sec) {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  if (isNaN(d.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (sameYear ? '' : d.getFullYear() + '-') +
    p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 手动标了「我交过了」的作业（2026-11-13）。
 *
 *  为什么需要：我们判「交没交」只能看学习通自己翻没翻状态。实测有
 *  「在小程序里交了、网页状态还写着未交」的作业 —— 那条会一直挂在列表上、
 *  一直按点提醒、课表上一直挂一颗刻度。用户唯一的办法是卸载重装，
 *  而这明明是「他知道自己交了」这一件再简单不过的事。
 *
 *  🔴 key 是 `课程|标题`，值是标记那一刻的**截止秒**。
 *     存截止秒而不是 `true`：老师把截止时间改晚时这条应该复活 ——
 *     他并没有交那份新期限的作业。差 1 小时以内算同一次，
 *     因为学习通列表只给「剩余 90 小时」，每次反推都会差几秒。
 */
function cxMarkKey(it) {
  return String((it && it.course) || '') + '|' + String((it && it.title) || '');
}

function cxDoneMarks() {
  const v = store.get(KEY.cxDone, null);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v;
}

function cxMarksSave(m) {
  const keys = Object.keys(m || {});
  if (!keys.length) { store.del(KEY.cxDone); return; }
  store.set(KEY.cxDone, m);
}

/** 这条被手动标成交过了吗。`endAt` 缺失的（没有截止时间）标了就认。 */
function cxMarkedDone(it) {
  const m = cxDoneMarks();
  const key = cxMarkKey(it);
  if (!Object.prototype.hasOwnProperty.call(m, key)) return false;
  const at = Number(m[key]) || 0;
  const end = Number(it && it.endAt) || 0;
  if (!at || !end) return true;
  return Math.abs(end - at) <= 3600;
}

/** 标记 / 取消标记。返回标记后的状态。
 *
 *  🔴 只改本地这一份，**不**去改学习通的任何状态（只读红线）。
 *     所以它不是「替他交作业」，只是「告诉他这条我不用再看见」。 */
function cxMarkDone(it, on) {
  const m = cxDoneMarks();
  const key = cxMarkKey(it);
  if (!key || key === '|') return false;
  if (on) m[key] = Number(it && it.endAt) || Math.floor(Date.now() / 1000);
  else delete m[key];
  cxMarksSave(m);
  // 三处要跟着变：列表（沉到已完成）、提醒（不再响）、课表刻度（那颗点消失）。
  // 🔴 少了任何一处，用户都会觉得「标了没用」—— 而这三处他每天都会看到。
  try { _dueIdx = null; } catch (e) { /* 还没初始化过就算了 */ }
  remindPush(true);
  widgetPush();          // 桌面上那条「最近要交」也要跟着变/消失
  if (CUR_PAGE === 'schedule') renderSchedule();
  if (CUR_PAGE === 'exams') cxPaint();
  renderMe();
  return on;
}

/** 从当前扫描结果里按 key 找回条目。标记按钮只带 key 出门（DOM 里存整个对象
 *  太重，而且重画之后旧对象就过期了）。
 *
 *  🔴 必须把「收件箱捡回来的」也算进来（2026-11-15）：那几条不在 CX.data 里，
 *     只查扫描结果的话，它们身上的「我交过了」点了没反应 —— 而点了没反应
 *     正是用户上一轮抱怨的那件事。 */
function cxFindWork(key) {
  const d = CX.data;
  if (!key) return null;
  const rows = (d && Array.isArray(d.items)) ? d.items : [];
  for (const it of rows) {
    // 不再限定 kind==='work'：练习也有这颗药丸了（2026-11-15），
    // 只认 key 就够了 —— key 是「课程|标题」，本来就唯一。
    if (it && cxMarkKey(it) === key) return it;
  }
  for (const it of (Array.isArray(d && d.doneItems) ? d.doneItems : [])) {
    if (it && cxMarkKey(it) === key) return it;
  }
  for (const it of cxMailTodoItems()) {
    if (cxMarkKey(it) === key) return it;
  }
  return null;
}

/** 这条到底做完没有。返回 'done' / 'todo' / 'over'（来不及了）/ ''（这类没有「交没交」）。
 *
 *  用户 2026-11-09：「在每个作业和随堂练习旁边都加上已完成和未完成」。
 *
 *  🔴 为什么要在前端再算一遍，而不是直接用后端那个 state：
 *     后端 state 是三档（todo / done / ended），ended 混了「做完了」和
 *     「没做、时间过了」两种 —— 而这两件事对用户的含义完全相反。
 *     这里按「有没有截止且已经过了」拆开，说的才是他要的那句话。
 *  🔴 只给作业 / 考试 / 练习三类标：签到有自己的卡（签了没有写在卡上），
 *     讨论和通知没有「完成」这个概念 —— 硬标一个「未完成」等于凭空造出一个待办。
 */
function cxDoneOf(it) {
  const k = cxKindOf(it);
  if (k !== 'work' && k !== 'exam' && k !== 'quiz') return '';
  if (it.state === 'done') return 'done';
  // 手动标过「我交过了」的，和学习通自己说「已完成」一样对待 ——
  // 沉到已完成那一段，不再占「还有几条要交」的名额。
  if (cxMarkedDone(it)) return 'done';
  // 🔴 2026-11-15：练习的「做完没」和「这场活动结束了没」是两件事。老师没点
  //    结束的那场练习在活动列表里永远是 live，但它已经躺在「已完成」那批里
  //    （nameTwo 说已完成）—— 只看 state 的话，一条交过的练习会同时出现在
  //    「还能做」和最上面。这里按标题认一次，认出来就是已完成。
  if (k === 'quiz') {
    const t = cxTitleKey(it.title);
    if (t && cxDoneTitleSet().has(t)) return 'done';
  }
  const m = cxMinLeft(it);
  if (m != null && m < 0) return 'over';
  return 'todo';
}

const CX_DONE_TEXT = { done: '已完成', todo: '未完成', over: '已截止' };

function cxItemHtml(it, showCourse, showKind) {
  const min = cxMinLeft(it);
  const k = cxKindOf(it);
  const dn = cxDoneOf(it);
  const isDone = dn === 'done';
  // 已经过点了（学习通还会在列表里留一阵，缓存也会留更久）——
  // 这时候写「还剩 不到 1 分钟」还标红，是在催一件已经办不了的事。
  // 🔴 做完的不算「过点」：它的 endAt 当然在过去（做完了时间才走完），
  //    照 over 渲染会在一条「已完成」旁边写「已截止 11-08」——
  //    用户看了会以为「它说我超时了」，而其实早就交上去了。
  const over = min != null && min < 0 && !isDone;
  // 只有真·临近（一天以内）才标红。没倒计时的不标 —— 那不等于过期。
  const urgent = min != null && min >= 0 && min <= 1440;
  const link = it.url ? String(it.url) : '';
  const due = cxDueAt(it.endAt);

  // ---- 右边那**一句话**（2026-11-11 重做）----
  // 用户：「每个待做的作业条目都很丑」。
  // 原来是上下两行（「还剩 4 天」/「截止 11-15 19:07」）+ 左边一个圆点，
  // 一条作业里五段字，四种字号，右边缘还分成两行 —— 读起来像报错日志。
  // 现在压成一句：`4 天 22 小时 · 11-16 16:31`（还剩多久 · 几点截止）。
  //   · 去掉「还剩」两个字：它右边的数就是天数，不需要主语；
  //   · 去掉「截止」两个字：同一句话的第二个数字只能是截止时间；
  //   · 「已截止」保留 —— 那不是一个时间，是一个结论。
  // 一行字省下 16px，一屏多出一条作业；也才有地方把课程名写全。
  // 做完的不算倒计时：它的 endAt 当然在过去，照 over/还剩 渲染会写出
  // 「不到 1 分钟」这种吓人的假话。做完的只说截止的那一刻。
  // ⚠️ 只有这一支保留「截止」两个字：一条已完成旁边孤零零一个「11-08 21:49」，
  //    读完不知道那是交的时间还是截止的时间。待办那一支有倒计时领着，不用这两个字。
  // 🔴 红色只落在**倒计时**上，后面那个绝对时间一直是灰的：
  //    一整句都染红的话，页面上「急」的信号就从「还剩 20 分钟」扩散到一串日期，
  //    真正该被看见的那个数反而混进去了（DESIGN：红色只花在数据上，别花满一行）。
  // 只有作业能手动标「我交过了」：练习通常在课堂上就做完了、考试交了就是交了，
  // 它们的状态比我们准。多开两类只会多两种点错的机会。
  // 🔴 2026-11-15 改：练习也要能标。用户原话：「消息里面的随堂练习，有很多
  //    已经做完了，但老师没有手动结束，这种理应不再置顶」—— 老师不点结束，
  //    学习通就一直说这场活动在进行中，我们**没有任何别的证据**说明我做过了。
  //    能给他的是他自己知道的那一句「我交过了」，标完就不再顶在最上面。
  //    考试仍然不给：考试交没交，学习通从来没有认错过。
  // 从收件箱捡回来的（fromMail）不分类型都给一颗：它本来就没有「交没交」可查，
  // 那颗按钮的唯一意思是「这条我看过了，别再摆在这儿」—— 考试也一样。
  // 不给的话，一条捡来的考试会永远钉在待办里，没有任何办法收拾掉。
  const canMark = k === 'work' || k === 'quiz' || !!it.fromMail;
  const marked = canMark && cxMarkedDone(it);
  // 从收件箱捡回来的那条：没有真正的「交没交」可记，按钮只说「收起」。
  const markWord = it.fromMail ? '收起' : (marked ? '撤销' : '我交过了');
  // 「我交过了」那一行要不要写绝对时间。
  // 🔴 2026-11-15：第二行挤进了这颗药丸之后，360 屏上课程名被压成「数据…」——
  //    一眼看不出是哪门课，而那正是排在最前面要认的东西。药丸占着 60px，
  //    要腾回来的只能是那串绝对时间：倒计时（「6 小时」）已经说清还剩多久，
  //    精确到分钟的那个时刻点进去就在详情页第一行。
  //    ⚠️ 只对**还没做完**的作业这样：做完的那些没有倒计时，只剩一句
  //       「截止 11-08 21:49」—— 那是它唯一的时间信息，不能省。
  const compactWhen = canMark && !isDone;
  const whenHtml = isDone
    ? (due ? '<span class="cx-l">截止 ' + due + '</span>' : '')
    : over
      ? '<span class="cx-l over">已截止' + (due ? ' ' + due : '') + '</span>'
      : (min != null
          ? '<span class="cx-l' + (urgent ? ' urgent' : '') + '">' + cxLeft(min) + '</span>' +
            (due && !compactWhen ? '<span class="cx-due">' + due + '</span>' : '')
          : (due ? '<span class="cx-l">' + due + '</span>' : ''));
  // 「我交过了」从标题行右端挪到第二行（2026-11-15）。
  // 用户原话：「点击作业右侧为什么是标记为完成？这个功能压根一点提示都没有，
  // 用户想打开这个作业时却反复标记为已完成，用户会以为压根打不开」。
  // 三个毛病叠在一起：
  //   ① 它是一颗**没有字**的勾，长在标题行右端 —— 看着跟「打开」是一件事；
  //   ② 它盖在条目上，点偏一点就变成标记，而标记之后那条会沉进「已完成」，
  //      用户再找不着，只会觉得「这个作业打不开」；
  //   ③ 标记本身没有反馈（只换了个颜色）。
  // 现在：整条只做一件事（打开），标记退成第二行一颗**带字**的小药丸
  // （「我交过了」/「撤销标记」），点了还会说一句话。字写出来就不会被误认。
  const markHtml = canMark
    ? '<button class="cx-mark' + (marked ? ' on' : '') + '"' +
      ' data-cxmark="' + escAttr(cxMarkKey(it)) + '"' +
      ' aria-label="' + (it.fromMail ? '收起这一条'
                        : (marked ? '取消「我交过了」' : '标记为「我交过了」')) + '"' +
      ' aria-pressed="' + (marked ? 'true' : 'false') + '">' +
      markWord + '</button>'
    : '';
  return '<div class="cx-item' + (link ? ' tap' : '') + (over ? ' cx-over' : '') + '"' +
    (link ? ' data-url="' + escAttr(link) + '"' +
            ' data-title="' + escAttr(it.title || '') + '"' : '') + '>' +
    '<div class="cx-t">' +
    // 🔴 2026-11-11：标题里**已经写了类型**的就不再挂分类标。
    //    签到类后端给的 title 就叫「签到」，讨论类叫「第三章 栈和队列 讨论」——
    //    前面再挂一枚同名药丸，用户看见的是「签到 签到」「讨论 … 讨论」。
    //    类型看不出来的那几条（比如「实验报告一」）照旧挂标，那才是它要回答的问题。
    // 快查到的「现在就能做」（0.52.3 v6）：橙底那枚小标，压在所有分类标前面。
    // 用户要的就是「一眼看见、立刻点进去」—— 它出现的时候通常只剩几分钟。
    (it.liveNow ? '<span class="cx-k is-live">进行中</span>' : '') +
    (showKind && String(it.title || '').indexOf(CX_KIND_NAME[k]) < 0
      ? '<span class="cx-k">' + esc(CX_KIND_NAME[k]) + '</span>' : '') +
    (CX.newKeys && CX.newKeys.has(cxItemKey(it))
      ? '<span class="cx-new">新</span>' : '') +
    esc(it.title) +
    '</div>' +
    '<div class="cx-m">' +
    // 🔴 2026-11-09 用户要的「已完成 / 未完成」，一条一个结论，放最前面
    //    （课程名会被 ellipsis 吃掉，状态不能被吃）。
    //    2026-11-11 去掉了它前面那个小圆点：和右边的倒计时排在一起看，
    //    圆点像个走错位置的列表符号。
    (dn ? '<span class="cx-st ' + dn + '">' + CX_DONE_TEXT[dn] + '</span>' : '') +
    (showCourse ? '<span class="cx-c">' + esc(it.course) + '</span>' : '') +
    // 签到/讨论这类活动，学习通自己会给一句状态文字（「已签到」「待批阅」）。
    // 🔴 作业/考试/练习已经有「已完成 / 未完成」那个标了，再挂一句学习通的原话
    //    会变成「未完成 … 未交」—— 同一件事说两遍，还把课程名挤掉。
    // 🔴 通知不给时间位：它的 endTime 是**活动自己的生命周期终点**，不是待办截止。
    //    （后端 parse_active 已经把 notice 的 endAt/leftMin 置空，这里再兜一层。）
    (!dn && it.status ? '<span class="cx-s">' + esc(it.status) + '</span>' : '') +
    // 右端那一组（倒计时 / 标记 / 打开箭头）包成一块靠右对齐。
    // 分开排的话，没有倒计时的那几条里这颗药丸会飘在课程名后面 ——
    // 一列表的右边缘参差不齐，扫的时候要重新找位置。
    '<span class="cx-r">' +
    (k === 'notice' || !whenHtml ? '' : whenHtml) +
    markHtml +
    (link ? '<svg class="cx-go" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M9 6l6 6-6 6"/></svg>' : '') +
    '</span>' +
    '</div></div>';
}

/** 点条目 → 在 App 内打开详情页。
 *
 *  ⚠️ 网页版（没有原生壳）没有 WebView，只能新开标签页 —— 那个罐子里
 *     没有学习通的 cookie，进去要重新登一次。这一点在按钮文案里说清楚。 */
function cxOpenItem(el) {
  const url = el && el.dataset ? el.dataset.url : '';
  if (!url) return;
  const name = (el.dataset && el.dataset.title) || '学习通';
  if (NATIVE && window.NativeApi && typeof NativeApi.openWeb === 'function') {
    let why = 'none';
    try { why = NativeApi.openWeb(url, name); }
    catch (e) { why = 'fail: ' + ((e && e.message) || e); }
    if (why === '') return;
    // 老 APK / 起不来 —— 退回浏览器，宁可多登一次也不能点了没反应
  }
  if (!openExternal(url)) toast('打不开浏览器，可以复制链接手动打开');
}

/** 登录态过期时的一条捷径。
 *
 *  用户 2026-10-22 的原话：「能不能把学习通的账号密码也存到本地，
 *  后续再看就不需要输入账号密码了」。
 *  账号密码在第一次登录时就加密存了，过期时只需要点一下 —— 密码留空，
 *  后端拿本机那份去换新凭证。**不自动重试**：超星的 needVcode 撞一次
 *  就要人做滑块，必须是人主动点的。
 */
function cxRelinkHtml() {
  const s = CX.scan || {};
  if (s.state !== 'error' || s.kind !== 'auth' || !CX.canRelink) return '';
  return '<button class="btn primary block" id="cxRelink">用存着的密码重连</button>';
}

async function cxRelink() {
  const btn = $('cxRelink');
  if (btn) { btn.disabled = true; btn.textContent = '重连中…'; }
  try {
    // pass 留空 = 用本机存的那份。账号照传，后端会核对是不是同一个人 ——
    // 对不上直接拒，免得拿别人的密码去撞学习通的风控。
    const r = await api('/api/cx/login', { user: CX.user, pass: '' });
    if (!r.ok) {
      toast(r.error || '重连没成功');
      if (r.pwdStale) CX.canRelink = false;   // 存的那份错了，已经删掉
      cxPaint();
      return;
    }
    CX.state = 'ok';
    CX.canRelink = true;
    toast('重连上了');
    cxScanStart();
  } catch (e) {
    toast('重连出错：' + e.message);
    cxPaint();
  }
}

/** 底部动作 + 断开。放在页面里，不再有「关闭弹层」那种东西。
 *
 *  0.33.0：三颗并成一行。以前「断开学习通」是单独一整行（44px + 12 上边距），
 *  在「一屏装下」的预算里它占了 56 —— 而它是三者里最不常用的一个。
 *  降成一行里的小字按钮，仍然带二次确认（`cxDisconnect` 的 askConfirm）。
 */
function cxFootHtml(withScan) {
  // 文案写「打开学习通」而不是「浏览器打开」：走的是 App 内 WebView，
  // 那边带着学习通的登录态（和门户共用一个 cookie 罐子），点进去是已登录的。
  // 交给系统浏览器就变成第三个罐子，每次都要重登一次。
  //
  // 🔴 0.39.1：这一行原来还有第三颗「断开」。用户 2026-11-01：
  //    「删除东西的功能你做的实在是显眼过头了……还容易让用户误触」。
  //    它紧挨着「打开学习通」—— 两个按钮相隔 8px，一个天天点、一个一学期
  //    点一次，还都是 44px 高。断开是**删凭证**，误触一次的代价是重新登录。
  //    现在只在「我的 → 账号管理 → 学习通 → 断开」。
  // 🔴 0.50.0 v8：这一排**只许有两颗**，都是「天天点」的。
  //    「后台自动」的入口曾经塞在这里当第三颗（v5），两处都不对：
  //    · 用户 2026-11-01 的教训是「一个学期点一次的东西不许挨着天天点的」，
  //      并排 8px、一样高，就是误触的来源；
  //    · `check_danger_quiet` 钉的就是这一排只剩常用动作 —— 它红得对。
  //    现在入口在「我的」标题行右边（`#meAuto`，见 autoRepaint）。
  return '<div class="cx-acts">' +
    (withScan ? '<button class="btn primary" id="cxScan">重新检查</button>' : '') +
    '<button class="btn" id="cxOpen">打开学习通</button>' +
    '</div>';
}

/** 「后台自动」入口现在在「我的」标题行右侧（`#meAuto`）。
 *
 *  开关一动就要重画这里的字 —— 弹层里点开、关掉弹层，按钮还写着「后台自动」，
 *  用户会以为没生效再点一次。慧生活那一行（`#wtAutoV`）同理。
 */
function autoRepaint() {
  if ($('wtAutoV')) wtPaintAutoRow();
  const v = $('meAutoV');
  const b = $('meAuto');
  if (!v || !b) return;
  const a = CFG.auto || {};
  const on = !!(a.cxOn || a.wtOn);
  v.textContent = on ? '已开启' : '后台';
  b.classList.toggle('on', on);
}

/* ---------------- 学习通收件箱（通知中心） ----------------
 *
 * 用户 2026-11-13：「学习通的收件箱能不能也兼容进来，毕竟网页端有」。
 *
 * 它和学习页别的东西**不是一个来源**：作业/考试/签到来自「课程 → 活动」，
 * 收件箱是 notice.chaoxing.com 那个通知中心（老师发通知、平台公告）。
 * 所以单独拉、单独缓存、单独一张弹层 —— 不并进分类药丸，
 * 否则「作业 3 条」和「老师发了个通知」会混在同一张表里，
 * 而后者没有截止时间、也不该出现在「还有几条要交」里。
 *
 * 🔴 接口是纯逆向的（见 chaoxing.py 的 NOTICE_LIST），随时可能变。
 *    所以它坏了**绝不影响**学习页：拿不到就只是没有这一条入口，
 *    作业照样看、照样提醒 —— 用户不会因为收件箱挂了而用不了 App。
 */

/** 多久重拉一次。后端也有一份 5 分钟缓存，这里是对齐而不是另立一套：
 *  离开这页再回来时不该在同一个 5 分钟里连问好几次。 */
const CX_MAIL_TTL_MS = 5 * 60 * 1000;

/** 未读条数。
 *  🔴 `r` 是「已读」的布尔（后端把 `isread` 的 '0'/'1' 在那边就归一了）。
 *    这里千万别写 `!it.r` 之外的判断 —— 前后端各算一次未读必然对不上。 */
function cxMailUnread(list) {
  return (Array.isArray(list) ? list : []).filter((it) => it && it.r === false).length;
}

/** 拉一次收件箱。`force` 穿透后端的 5 分钟缓存（用户点「刷新」）。 */
async function cxMailLoad(force) {
  if (CX.state !== 'ok') return;                 // 没连学习通，不问
  if (CX.mail.state === 'loading') return;       // 已经在拉了
  CX.mail.state = 'loading';
  try {
    const r = await api('/api/cx/notices' + (force ? '?force=1' : ''));
    if (r && r.ok) {
      CX.mail.list = Array.isArray(r.list) ? r.list : [];
      CX.mail.unread = cxMailUnread(CX.mail.list);
      CX.mail.err = String(r.err || '');
      CX.mail.kind = String(r.kind || '');
      CX.mail.state = 'ok';
      // 读到了就顺手把里面「作业列表没有的」捡进待办（见 cxMailHarvest）。
      // 🔴 放在这里而不是画的时候：这一步要写盘，不能每次重画都写一遍。
      cxMailHarvest();
    } else {
      // 🔴 失败**不清空**上一次的列表：那会把「上次读到的 3 条」变成
      //    「一条都没有」，用户会以为老师没发。和作业那条「没读到 ≠ 没有」
      //    是同一件事。有旧数据就继续显示，只在弹层里说「这次没更新上」。
      CX.mail.err = String((r && r.error) || '读不到收件箱');
      CX.mail.kind = String((r && r.kind) || 'net');
      CX.mail.state = CX.mail.list.length ? 'ok' : 'error';
    }
  } catch (e) {
    CX.mail.err = '读不到收件箱';
    CX.mail.kind = 'net';
    CX.mail.state = CX.mail.list.length ? 'ok' : 'error';
  }
  // 🔴 成功失败都记时间。只在成功时记的话，失败会变成「每次重画都再拉一次」，
  //    这一页会因为一个挂掉的小接口不停发请求。
  CX.mail.at = Date.now();
  if (CX.mail.state === 'ok') CX.mail.unread = cxMailUnread(CX.mail.list);
  if (CUR_PAGE === 'exams') cxPaint();
}

/* ---------------- 作业 / 考试也进「消息」（2026-11-15） ----------------
 *
 * 用户：「各种作业之类的消息在发布和快结束时能直接在收件箱里面提示，
 * 能不能把收件箱也作为作业和考试的信息来源之一」。
 *
 * 学习通的收件箱里只有老师主动发的通知。而「新发了一份作业」「这份明天就截止」
 * 这两件事**从来不进通知**，偏偏是学生最怕漏的。所以这里不另发请求，
 * 直接拿**已经扫到的那份待办**合成两条提醒，摆在同一个弹层里。
 *
 * 🔴 合成的东西必须长得像合成的：这一段有小标题「作业与考试」，
 *    和学校发的通知分开排 —— 混在一起会让人以为老师真发了这么一条。
 * 🔴 各只取三条。列成十条就又变成「一个要读的列表」，
 *    而它本来只回答一件事：有没有新的事、有没有快到的。
 * 🔴 「新发布」只能按**我们第一次看见它**算：学习通不给发布时间。
 *    所以措辞是「新」，不是「刚刚发布」。
 */
const CX_EV_FRESH = 3 * 86400;    // 第一次见到它之后的 3 天内算「新」
const CX_EV_SOON = 24 * 60;       // 24 小时内截止算「快到了」
const CX_EV_MAX = 3;

function cxSeenMap() {
  const v = store.get(KEY.cxSeen, null);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v;
}

/** 记下「第一次见到」的时刻，顺手清掉一周前的。**只在真有条目时才写盘。**
 *  每次扫到都要调一次（见 cxPaintTodo）—— 只在第一次画的时候记的话，
 *  用户装完之后第一眼看的那批全算「新」，第二天再装一次又全算「新」。 */
function cxSeenTouch(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return;
  const m = cxSeenMap();
  const now = Math.floor(Date.now() / 1000);
  let dirty = false;
  rows.forEach((it) => {
    const k = cxMarkKey(it);
    if (!k || k === '|') return;
    if (m[k]) return;                     // 见过就不动它 —— 否则永远「新」
    m[k] = now;
    dirty = true;
  });
  Object.keys(m).forEach((k) => {
    if (now - (Number(m[k]) || 0) > 7 * 86400) { delete m[k]; dirty = true; }
  });
  if (dirty) store.set(KEY.cxSeen, m);
}

/** 合成出来的那两条提醒：新发布的 / 快截止的作业和考试。各最多三条。 */
function cxEvents() {
  const d = CX.data;
  const items = (d && Array.isArray(d.items)) ? d.items : [];
  const seen = cxSeenMap();
  const now = Math.floor(Date.now() / 1000);
  const fresh = [];
  const soon = [];
  items.forEach((it) => {
    if (!it) return;
    const k = cxKindOf(it);
    if (k !== 'work' && k !== 'exam' && k !== 'quiz') return;
    if (it.state === 'done' || cxMarkedDone(it)) return;   // 交过的别再提醒
    // 练习还要多看一眼「学习通那批已完成里有没有它」：老师没点结束的那场，
    // state 永远是 live（见 cxDoneOf 那段）。
    if (cxKindOf(it) === 'quiz') {
      const tk = cxTitleKey(it.title);
      if (tk && cxDoneTitleSet().has(tk)) return;
    }
    const min = cxMinLeft(it);
    if (min != null && min < 0) return;                    // 已经过了，说了也没用
    const t0 = Number(seen[cxMarkKey(it)]) || 0;
    if (t0 && now - t0 <= CX_EV_FRESH) fresh.push(it);
    if (min != null && min <= CX_EV_SOON) soon.push(it);
  });
  fresh.sort((a, b) =>
    (Number(seen[cxMarkKey(b)]) || 0) - (Number(seen[cxMarkKey(a)]) || 0));
  soon.sort((a, b) => (cxMinLeft(a) || 0) - (cxMinLeft(b) || 0));
  const f = fresh.slice(0, CX_EV_MAX);
  const s = soon.slice(0, CX_EV_MAX);
  return { fresh: f, soon: s, n: f.length + s.length };
}

/** 一条合成消息：`新` / `快` 一枚小标 + 标题 + 课程 · 还剩多久。 */
function cxEvRow(it, tag) {
  const url = String(it.url || '');
  const course = String(it.course || '');
  const min = cxMinLeft(it);
  const bits = [course, min != null ? cxLeft(min) : cxDueAt(it.endAt)].filter(Boolean);
  return '<div class="ml-evrow' + (url ? ' tap' : '') + '"' +
    (url ? ' data-ev="' + escAttr(url) + '"' +
           ' data-evtitle="' + escAttr(it.title || '') + '"' : '') + '>' +
    '<span class="ml-evk ' + (tag === '新' ? 'fresh' : 'soon') + '">' + tag + '</span>' +
    '<span class="ml-evt">' + esc(it.title || '') + '</span>' +
    '<span class="ml-evm">' + esc(bits.join(' · ')) + '</span>' +
    '</div>';
}

/* ---------------- 收件箱 → 作业 / 考试（2026-11-15） ----------------
 *
 * 用户：「收件箱可以作为一个信息获取渠道，如果发现收件箱里出现作业列表
 * 没有出现的，那就把它存进学习界面的作业或者考试里面，不要仅仅停留在收件箱」。
 *
 * 为什么真的会「有消息、没作业」：老师发通知时顺手挂一条任务，那条任务可能
 * 开在别的教学班、或者本来就只在消息里发（没走到作业列表那一页）。作业列表
 * 是「本学期这几门课的作业页」，消息是「老师按了什么」，两个集合本来就不重合。
 * 而漏掉一条的代价是扣分 —— 所以消息里认得出是作业/考试的，要捡回来。
 *
 * 🔴 只捡**带地址、且地址明显指向任务**的那几条：认不出来的（开会、放假、
 *    交材料）一条都不捡。把通知当作业塞进待办，用户会被一串假待办逼到
 *    不再看这一页 —— 那比漏一条更糟。
 * 🔴 捡回来的和扫到的长得不一样，所以带 `fromMail: 1`：课程那一格写「消息」，
 *    让人一眼知道**这条不是作业列表里的那一行**，我们没核对过它的截止时间。
 * 🔴 存根要落盘（见 KEY.cxMailTodo）：收件箱只有 5 分钟缓存，重启就更没了。
 *    不落盘的话，用户看到的还是「消息里有、作业里没有」—— 等于没做。
 * 🔴 去重按**归一化的标题**（去空格、书名号、标点）。扫描到同一条时以扫描
 *    那份为准，存根自己退场。
 */
const CX_MAIL_TODO_MAX = 40;      // 存根上限。再多就不是「漏了一条」了
const CX_MAIL_TODO_KEEP = 21 * 86400;   // 三周还没进作业列表 ⇒ 它大概真不是作业

/** 标题归一化：只用来比「是不是同一条」。学习通那两边写法常常差几个符号。 */
function cxTitleKey(s) {
  return String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[《》<>「」『』【】\[\]（）()、，。：:；;！!？?·—\-_~"'`]/g, '')
    .toLowerCase();
}

/** 消息里那个地址指的是哪一类任务。认不出来返回空串（= 不捡）。
 *  `attachment` 里学习通自己写的 `examOrWork` 就在地址上，所以先认它。 */
function cxMailKindOf(u) {
  const s = String(u || '').toLowerCase();
  if (!s) return '';
  if (s.indexOf('examorwork') >= 0) {
    if (/examorwork=exam|examorwork%3dexam/.test(s)) return 'exam';
    if (/examorwork=work|examorwork%3dwork/.test(s)) return 'work';
    // 没带参数：地址本身就是 examApi 那条 —— 至少能分出「不是练习」
    if (s.indexOf('exam') >= 0 && s.indexOf('work') < 0) return 'exam';
    return 'work';
  }
  if (s.indexOf('quiz') >= 0) return 'quiz';
  if (s.indexOf('exam') >= 0 || s.indexOf('examid') >= 0) return 'exam';
  if (s.indexOf('dowork') >= 0 || s.indexOf('workid') >= 0 ||
      s.indexOf('/mooc2/work') >= 0 || s.indexOf('/work/list') >= 0) return 'work';
  return '';
}

function cxMailTodoLoad() {
  const v = store.get(KEY.cxMailTodo, null);
  return Array.isArray(v) ? v : [];
}

function cxMailTodoSave(rows) {
  const list = (rows || []).slice(0, CX_MAIL_TODO_MAX);
  if (!list.length) { store.del(KEY.cxMailTodo); return; }
  store.set(KEY.cxMailTodo, list);
}

/** 从当前这批消息里捡作业/考试，和存根合并。返回合并后的存根。 */
function cxMailHarvest() {
  const list = Array.isArray(CX.mail.list) ? CX.mail.list : [];
  const old = cxMailTodoLoad();
  const took = {};                 // 归一化标题 → 存根（本次结果）
  old.forEach((r) => {
    if (!r || !r.t) return;
    took[cxTitleKey(r.t)] = r;
  });
  list.forEach((it) => {
    if (!it) return;
    const u = String(it.u || '');
    const k = cxMailKindOf(u);
    if (!k) return;
    const title = String(it.t || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    const key = cxTitleKey(title);
    if (!key || took[key]) return;      // 已经有了（先到先得，旧的保留）
    took[key] = { k: k, t: title.slice(0, 80), u: u,
                  at: Number(it.at) || Math.floor(Date.now() / 1000) };
  });
  const now = Math.floor(Date.now() / 1000);
  const rows = Object.keys(took).map((k2) => took[k2])
    .filter((r) => r && r.at && (now - r.at) <= CX_MAIL_TODO_KEEP);
  // 最新的排前面，超上限的从最旧那头丢
  rows.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
  cxMailTodoSave(rows);
  return rows.slice(0, CX_MAIL_TODO_MAX);
}

/** 存根 → 条目。和已经扫到的、或已经标记过的重复就不出现。 */
function cxMailTodoItems() {
  const rows = cxMailTodoLoad();
  if (!rows.length) return [];
  const d = CX.data;
  const have = {};
  ((d && Array.isArray(d.items)) ? d.items : []).forEach((it) => {
    if (!it) return;
    have[cxTitleKey(it.title)] = 1;
  });
  ((d && Array.isArray(d.doneItems)) ? d.doneItems : []).forEach((it) => {
    if (!it) return;
    have[cxTitleKey(it.title)] = 1;
  });
  const out = [];
  rows.forEach((r) => {
    if (!r || !r.t) return;
    if (have[cxTitleKey(r.t)]) return;        // 作业列表里已经有了 ⇒ 以那份为准
    const it = {
      kind: r.k || 'work', kindName: '消息',
      title: r.t, course: '消息', status: '',
      state: 'todo', left: '', leftMin: null,
      startAt: null, endAt: null, url: String(r.u || ''),
      fromMail: 1,
    };
    if (cxMarkedDone(it)) return;             // 标过「我交过了」的就不再出现
    out.push(it);
  });
  return out;
}

/** 把存根并进列表（不改入参）。 */
function cxWithMailTodo(list) {
  const arr = Array.isArray(list) ? list : [];
  const extra = cxMailTodoItems();
  if (!extra.length) return arr;
  return arr.concat(extra);
}

/** 从存根里删掉一条（按标题）。收件箱里捡回来的那条「处理完了」就这样退场。 */
function cxMailTodoDrop(title) {
  const key = cxTitleKey(title);
  if (!key) return;
  const old = cxMailTodoLoad();
  const rows = old.filter((r) => cxTitleKey(r && r.t) !== key);
  if (rows.length !== old.length) cxMailTodoSave(rows);
}

/** 学习页头部那行右端那颗「消息」。没有未读时也是普通灰字 ——
 *  入口不能只在有未读时才出现，否则用户永远不知道它存在。 */
function cxMailHtml() {  const n = CX.mail.unread || 0;
  // 红点管两件事：学校发的未读，和「有新作业 / 快截止」。
  // 只算未读的话，一条通知都没有的星期里，新作业永远不会在入口上露头。
  const ev = cxEvents().n;
  return '<button class="cx-sort cx-mail' + (n || ev ? ' on' : '') + '" id="cxMail"' +
    ' type="button" aria-label="学习通消息' +
    (n ? '，' + n + ' 条未读' : '') + (ev ? '，' + ev + ' 条作业提醒' : '') + '">消息' +
    (n || ev ? '<i class="cx-mdot"></i>' : '') + '</button>';
}

/** 一条消息的时间：11-13 10:22。没有时间就空着 —— 不要编。 */
function cxMailWhen(sec) {
  const t = Number(sec) || 0;
  if (!t) return '';
  const d = new Date(t * 1000);
  if (isNaN(d.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 收件箱弹层。
 *
 *  为什么用弹层而不是新一页：它是一次「看看有没有事」的扫视，看完就关；
 *  做成一级页面得加返回、加 tab 高亮，而它一周也开不了几次。 */
function cxMailOpen() {
  cxMailPaint();
  // 打开这一下顺手更新一次，但**不**每次都拉：30 秒内刚拉过就直接看。
  if (Date.now() - (CX.mail.at || 0) > 30000) cxMailLoad(false);
}

/** 现在就能做的 —— 一条还在进行中的练习 / 签到。
 *
 *  用户 2026-11-14：「很多随堂练习只有几分钟持续时间，当场刷新完全来不及」。
 *  消息里那几颗「打开」是老师发通知时给的；而**正在进行的**我们本来就知道
 *  （扫过一次就在 CX.data.items 里，见 cxScanAll）。所以弹层一打开就先说
 *  这一句：现在有没有能做的、还剩多久、点哪儿。
 *
 *  🔴 只用本地已经有的那批数据，**不为它发请求**。打开弹层顺带跑一次 40 秒的
 *     扫描，等于把「看一眼消息」变成一次等待 —— 那正是用户抱怨的事。
 *  🔴 只认 quiz / sign：讨论和通知不赶时间，混进来会让这条横条不再意味
 *     「现在必须动手」。
 *  🔴 只画一条（最急的那条）。列成一串就又变回「一个要读的列表」。
 */
function cxMailLive() {
  const items = (CX.data && CX.data.items) || [];
  const quick = (CX.live && CX.live.items) || [];
  let best = null;
  const all = items.concat(quick);
  all.forEach((it) => {
    if (!it || !it.url) return;
    if (it.kind !== 'quiz' && it.kind !== 'sign') return;
    // 🔴 2026-11-15：这里原来只判 `it.state === 'live'`，于是「我做完了、
    //    老师没点结束」的练习会一直占着这一格 —— 用户看到的是「现在就能做」，
    //    点进去却是自己早就交过的那份。判据改成共用的那一个（cxLiveOpen）：
    //    做过的不算、老师忘关的不算。
    if (!cxLiveOpen(it)) return;
    // 没有剩余分钟数的（nameFour 为空）排在有数的后面 —— 拿不准就先不抢位置。
    const rank = (typeof it.leftMin === 'number') ? Math.max(0, it.leftMin) : 1e9;
    if (!best || rank < best.rank) best = { it: it, rank: rank };
  });
  return best ? best.it : null;
}

function cxMailPaint() {
  const list = CX.mail.list || [];
  let h = '<div class="sh-title">学习通消息</div>';
  // 先说「现在能做什么」，再说「收到过什么」。顺序反过来，用户得先读完
  // 一串旧消息才看见那条还剩两分钟的练习。
  const lv = cxMailLive();
  if (lv) {
    const kd = lv.kind === 'sign' ? '签到' : '随堂练习';
    const left = String(lv.left || '').trim();
    h += '<div class="ml-live">' +
      '<div class="ml-live-h">' +
        '<span class="ml-live-k">' + esc(kd) + '</span>' +
        (left ? '<span class="ml-live-w">' + esc(left) + '</span>' : '') +
        '<button class="ml-go is-live" data-live="1" type="button">去作答' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M9 6l6 6-6 6"/></svg></button>' +
      '</div>' +
      '<div class="ml-live-t">' + esc(String(lv.title || '').trim() || kd) + '</div>' +
    '</div>';
  }
  // 作业 / 考试的两种变化，摆在「现在就能做」下面、学校通知上面。
  // 位置的理由：上面那条是「立刻动手」，这一段是「知道有这么回事」，
  // 学校通知是「老师说的话」—— 三档不同的紧迫程度，从上到下。
  const ev = cxEvents();
  if (ev.fresh.length || ev.soon.length) {
    h += '<div class="ml-ev">' +
      '<div class="ml-ev-h">作业与考试<span>从待办里挑出来的</span></div>' +
      ev.fresh.map((it) => cxEvRow(it, '新')).join('') +
      ev.soon.map((it) => cxEvRow(it, '快')).join('') +
      '</div>';
  }
  if (CX.mail.state === 'error' && !list.length) {
    h += '<p class="tip note bad">' + esc(CX.mail.err || '读不到收件箱') +
      (CX.mail.kind === 'auth' ? '，请点下方「刷新」重新连接' : '') + '</p>';
  } else if (!list.length) {
    h += '<p class="tip note">' +
      (CX.mail.state === 'loading' ? '正在读…' : '暂时没有消息。') + '</p>';
  } else {
    // 有旧数据但这次没更新上：说一句，但不把列表拿掉。
    if (CX.mail.err) {
      h += '<p class="tip note bad">这次没更新上，下面这些是上次读到的。</p>';
    }
    h += '<div class="ml-list">' + list.map((it, i) => {
      const open = CX.mail.open === i;
      const when = cxMailWhen(it.at) || String(it.when || '');
      const meta = [String(it.w || ''), when].filter(Boolean).join(' · ');
      // 这条消息指向的任务（作业 / 随堂练习）。空就是没有 —— 不长按钮，
      // 也不猜一个地址。见 native.js 的 cxNoticeUrl。
      const go = String(it.u || '');
      return '<div class="ml-item' + (it.r === false ? ' unread' : '') +
        (open ? ' open' : '') + '" data-ml="' + i + '">' +
        '<div class="ml-h"><span class="ml-t">' + esc(it.t || '（无标题）') + '</span>' +
        (go
          ? '<button class="ml-go" data-go="' + i + '"' +
            ' aria-label="打开这条消息里的任务">打开<svg viewBox="0 0 24 24"' +
            ' aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>'
          : '') +
        (it.r === false ? '<i class="ml-dot"></i>' : '') + '</div>' +
        (meta ? '<div class="ml-m">' + esc(meta) + '</div>' : '') +
        (open ? '<div class="ml-c">' + esc(it.c || '这条没有正文。') + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }
  h += '<div class="sheetbtns">' +
    '<button class="btn" id="mlClose">关闭</button>' +
    '<button class="btn primary" id="mlRe">刷新</button>' +
    '</div>';
  $('sheetBody').innerHTML = h;
  $('sheetMask').hidden = false;
  $('mlClose').addEventListener('click', () => { $('sheetMask').hidden = true; });
  $('mlRe').addEventListener('click', async () => {
    CX.mail.open = -1;
    $('mlRe').textContent = '正在读…';
    await cxMailLoad(true);
    cxMailPaint();
  });
  const liveGo = $('sheetBody').querySelector('[data-live]');
  if (liveGo && lv) {
    liveGo.addEventListener('click', () => {
      if (!openApp(lv.url, lv.title || '学习通')) {
        toast('打不开浏览器，可以复制链接手动打开');
      }
    });
  }
  // 合成的作业 / 考试提醒：点整行 = 打开那条作业（和列表里同一套打开方式）。
  $('sheetBody').querySelectorAll('[data-ev]').forEach((el) => {
    el.addEventListener('click', () => {
      const u = String(el.dataset.ev || '');
      if (!u) return;
      if (!openApp(u, el.dataset.evtitle || '学习通')) {
        toast('打不开浏览器，可以复制链接手动打开');
      }
    });
  });
  $('sheetBody').querySelectorAll('[data-ml]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      // 「打开」那颗按钮和「展开这条」是两件事。先认按钮 ——
      // 落在它身上就只管跳转，别顺手把这条折起来（那一下会让按钮跑掉）。
      const hit = ev.target && ev.target.closest
        ? ev.target.closest('.ml-go') : null;
      if (hit) {
        ev.stopPropagation();
        const k = Number(hit.dataset.go);
        const it = (CX.mail.list || [])[k] || {};
        const u = String(it.u || '');
        if (!u) { toast('这条消息里没有能打开的任务'); return; }
        // 在 App 内打开（WebActivity 会把 cookie 倒进罐子，进去就是登录态）。
        // 起不来就退回浏览器 —— 宁可多登一次，也不能点了没反应。
        if (!openApp(u, '学习通')) toast('打不开浏览器，可以复制链接手动打开');
        return;
      }
      const i = Number(el.dataset.ml);
      CX.mail.open = (CX.mail.open === i) ? -1 : i;
      cxMailPaint();
    });
  });
}

async function cxDisconnect() {
  const ok = await askConfirm('断开学习通',
    '删掉本机账号密码与作业记录，需重新登录', '断开');
  if (!ok) return;
  try { await api('/api/cx/logout', {}); } catch (e) { /* 本地清掉就行 */ }
  cxStopPoll();
  CX.state = 'none'; CX.user = ''; CX.data = null; CX.scan = null;
  CX.age = -1; CX.saved = false; CX.canRelink = false;
  // 🔴 收件箱一起清。不清的话换个人拿到这台手机，点开「消息」看到的
  //    还是上一个人的老师发的通知 —— 和作业缓存同一个道理。
  CX.mail = { state: '', list: [], unread: 0, age: -1, err: '', kind: '', at: 0, open: -1 };
  renderMe();
  cxPaint();
  toast('已断开学习通');
}

/** 重画之后重新挂事件。每次 innerHTML 都会把监听器一起冲掉，必须重挂。 */
function cxBind() {
  // ⚠️ 必须用箭头函数转一层：直接把 cxScanStart 交给 addEventListener 的话，
  //    第一个参数是 Event 对象（真值），冷却判断会被当成「用户手点」——
  //    虽然结果正好对，但那是碰巧，不是本意。
  // 🔴 2026-11-09：第二参数从「没传」改成 true —— 「重新检查」必须重扫作业。
  //    以前是 `cxScanStart(true)`，force 是 undefined ⇒ 后端走「结课判定」，
  //    被判成结课的课只探一下签到，**作业列表一个请求都不发**。
  //    于是用户做完作业再点「重新检查」，看到的还是上一轮那份状态：
  //    「明明交了，还显示没完成」。这就是那句反馈的根因。
  //    用户手点这一下的意思本来就是「别信缓存，给我重查」——
  //    自动扫（进页面那条路）仍然 force=false，保持按课表收范围。
  if ($('cxScan')) $('cxScan').addEventListener('click', () => cxScanStart(true, true));
  if ($('cxRelink')) $('cxRelink').addEventListener('click', cxRelink);
  if ($('cxOpen')) $('cxOpen').addEventListener('click', () => {
    // 有原生壳就走 App 内 WebView（带着学习通登录态）；
    // 网页版没得选，只能新开标签页 —— 那边要重新登一次，所以文案分开写。
    if (NATIVE && window.NativeApi && typeof NativeApi.openWeb === 'function') {
      let why = 'none';
      try { why = NativeApi.openWeb(CX_HOME, '学习通'); }
      catch (e) { why = 'fail: ' + ((e && e.message) || e); }
      if (why === '') return;
    }
    if (!openExternal(CX_HOME)) toast('打不开浏览器，可以复制链接手动打开');
  });
  // 0.39.1：`#cxOut`（底栏那颗「断开」）已删，见 cxFootHtml 的说明。
  // 断开仍走 cxDisconnect，只是入口在「账号管理 → 学习通」。
  // 条目点开：事件委托挂一次就够，别每条都挂 —— 列表最多几十条，
  // 每条挂一个监听器会在每次重画时堆积。
  // 🔴 而且 #cxBody 这个**元素本身**不随重画换掉（换的只是它的 innerHTML），
  //    所以这里必须打标记，否则 cxBind 每调一次就多挂一个监听器，
  //    点一下会打开 N 个窗口。
  if ($('cxBody') && !$('cxBody').dataset.cxBound) {
    $('cxBody').dataset.cxBound = '1';
    $('cxBody').addEventListener('click', (e) => {
      // 「我交过了」那颗药丸。**必须排在 `.cx-item.tap` 前面** ——
      // 它在条目里，点它不该同时把学习通详情页打开。
      // 标记只改本机，不去改学习通的任何状态（只读红线）。
      // 🔴 点完必须**说一句话**：药丸上的字会换成「撤销标记」，但如果用户没盯着
      //    那一行（手指正压着它），只换字等于没反馈 —— 这就是上一版「一点提示都没有」。
      const mk = e.target && e.target.closest
        ? e.target.closest('[data-cxmark]') : null;
      if (mk) {
        const key = mk.getAttribute('data-cxmark') || '';
        const one = cxFindWork(key);
        if (!one) return;
        // 从收件箱里捡回来的那条：它本来就不是作业列表里的一行，也没有
        // 可核对的截止时间 —— 点一下就是「这条不用再摆在这儿」，直接退场。
        // 🔴 不能走 cxMarkDone：那会往「我交过了」的名单里塞一条
        //    课程名叫「消息」的假记录，以后对不上任何真作业。
        if (one.fromMail) {
          cxMailTodoDrop(one.title);
          toast('已收起，这条不再出现在待办里');
          cxPaint();
          return;
        }
        const on = !cxMarkedDone(one);
        cxMarkDone(one, on);
        toast(on ? '已记下：这条交过了，能在「已完成」里看到'
                 : '已撤销，这条又回到待办里');
        return;
      }
      // 0.33.0：「还有 N 条没显示」—— 展开就是全铺（这时才需要滑，
      // 而且是用户自己点开的）。用体量而不是 true/false：
      // 换分类后这个数字就不对了，只能按条数放。
      if (e.target && e.target.closest && e.target.closest('#cxMore')) {
        CX.showN = 9999;
        cxPaint();
        return;
      }
      // 「已完成 N 条」—— 展开/收起做完的那一段。和「还有 N 条」同一个手势，
      // 但它不会把 showN 拉到全量：两件事各管各的。
      if (e.target && e.target.closest && e.target.closest('#cxDoneMore')) {
        CX.showDone = !CX.showDone;
        cxPaint();
        return;
      }
      // 收件箱。2026-11-13 加，理由见 cxMailOpen 上面那段。
      // ⚠️ 必须排在 `.cx-item.tap` 那条**前面**：它是 `.cx-hd` 里的一颗按钮，
      //    不在任何条目里，但顺序写反了以后一旦有人把药丸挪进列表就会串味。
      if (e.target && e.target.closest && e.target.closest('#cxMail')) {
        cxMailOpen();
        return;
      }
      // 签到卡里的行也是同一种「点开详情」，所以一起收在这里。
      const el = e.target && e.target.closest
        ? e.target.closest('.cx-item.tap, .cx-srow.tap') : null;
      if (el) cxOpenItem(el);
    });
  }
  // 签到卡的「看全部」。展开状态存在 CX.signOpen 上 —— 重画时 DOM 会换掉。
  if ($('cxSignMore')) {
    $('cxSignMore').addEventListener('click', () => {
      CX.signOpen = !CX.signOpen;
      cxPaint();
    });
  }
  // 「这次新查到 N 条」上的「知道了」：收起提示，也把条目的「新」标一起去掉。
  // 两件事要一起做 —— 留着标记、只收起提示的话，用户会以为那些标还在提示什么。
  if ($('cxNewBarX')) {
    $('cxNewBarX').addEventListener('click', () => {
      CX.newKeys = null;
      cxPaint();
    });
  }
  if ($('cxCats')) {
    $('cxCats').querySelectorAll('.cx-cat').forEach((b) => {
      b.addEventListener('click', () => {
        const k = b.dataset.kind === 'all' ? 'all' : b.dataset.kind;
        if (k === (CFG.cxKind || 'all')) return;
        CFG.cxKind = k;
        CX.showN = CX_FIRST;   // 换了分类，首屏重新铺起
        store.set(KEY.settings, CFG);
        cxPaint();
      });
    });
  }
  // 排序：一颗按钮切两态。原来是「按紧急度 | 按课程」两个 seg 按钮，
  // 单占一行 48px，紧贴在分类药丸下面 —— 90px 只为了「筛」这一件事。
  if ($('cxSort')) {
    $('cxSort').addEventListener('click', () => {
      CFG.cxGroup = (CFG.cxGroup === 'course') ? 'all' : 'course';
      CX.showN = CX_FIRST;
      store.set(KEY.settings, CFG);
      cxPaint();
    });
  }
}

/** 「有东西没读到」那一块。
 *
 *  改之前长这样（用户 2026-10-23 的原话是「未找到入口什么的是什么意思」）：
 *      40 处没查到，这些课的作业/考试可能没列进来：
 *      · 作业：拿不到入口：20 门
 *      · 考试：这门课拿不到考试入口：20 门
 *
 *  三个毛病：
 *    1. 「入口」是内部说法 —— 他既不知道指什么，也不知道自己能做什么。
 *    2. 同一门课被数了两遍（作业一次、考试一次），20 门课显示成「40 处」。
 *    3. 「页面里没这个入口」（不用管）和「登录态失效」（要管）摆在一起，
 *       分不清轻重。
 *
 *  现在按 part 合并：同一批课缺作业 + 缺考试 ⇒ 一句话「没读到作业和考试」；
 *  数字按**课**算；原因分成「页面里没这个入口」（多半结课了）和
 *  「真的没读到」（登录/接口问题）两类，各自说清楚。
 */
/** 「结课 / 不再查」那一段：2026-11-10 起**什么都不画**。
 *
 * 用户原话：「底下的这学期没有 20 门课这一段也不要显示」。
 * 原来这里是「这学期没有 N 门课，不再查（…课名…）」+「全部重查一遍」。
 * 三个问题：① 把「这门课没在超星上发东西」当成一件要用户理解的事；
 * ② 一次列三个课名、灰底一压就是半屏，把下面真正要看的作业挤下去；
 * ③ 「不再查」说得像我们替他做了决定，可他根本没要求过这个判断。
 *
 * 🔴 删掉的那半句话（`cxPausedHead`，2026-10-24 到 2026-11-10 存在过）
 *    连同它的三种说法一起删了 —— 留一个没人调用的函数，等于留着一条
 *    「改回来就能上线」的路，而它的三种说法（「这学期没有」「很久没动静」
 *    「已结课」）各有各的前提，很容易被谁顺手接回去。
 * 🔴 功能没丢：`#cxAllScan`（「全部重查一遍」）也删了，因为它和「重新检查」
 *    调的是同一个 `cxScanStart(true, true)`（见 cxBind）。少一个入口而已，
 *    不是少一个能力。`check_cx_rest_ui.py` 里 [3] 现在就钉这件事。
 */
function cxPausedHtml(d) {
  void d;
  return '';
}

/** 把后端给的失败原因翻译成「用户能做什么」。
 *
 *  🔴 后端的 `why` 是**写给维护者看的**：「课程页返回 202（查得太密，被临时
 *     限流了 —— 过几分钟再试）」。它原样出现在界面上时，用户读到的是
 *     「202」「限流」这些词，还得自己想「那我该干嘛」。用户 2026-11-01：
 *     「用户能看见的一切文案都应该面向用户，不应该有冗余的解释性文案」。
 *
 *  只翻译认得出的几种；认不出来的**照原样显示**（截断到 24 字），
 *  绝不编一句像模像样的话 —— 那是把「不知道」说成了「知道」（红线）。
 */
function cxWhySay(why) {
  const s = String(why || '').trim();
  if (!s) return '没查到';
  if (/202|限流|太密|太频繁|请求过多/.test(s)) return '访问太频繁，被学习通拦了，过几分钟再试';
  if (/登录|失效|无效的用户|未登录/.test(s)) return '登录过期了，去账号管理重连';
  if (/超时|timeout|网络|连接/.test(s)) return '网络没连上';
  return s.length > 24 ? s.slice(0, 24) + '…' : s;
}

function cxFailHtml(failed, d) {
  const noEntry = { work: [], exam: [] };
  const other = new Map();
  // 课程页没打开的课：它的「作业没查」「考试没查」两条**不是另外两件事**，
  // 而是 course 那条失败的直接后果。
  // 🔴 2026-10-24 修：以前这两条会进 other，于是 17 门课被数成
  //    「课程页返回 202：17 门」+「课程页没打开，没查：34 门」——
  //    17 + 34 = 51，可用户总共只有 32 门课。同一件事数了两遍，
  //    而且第二个数字还是重复计数（一门课 work + exam 各一条）。
  const noCourse = new Set();

  failed.forEach((f) => {
    const why = String(f.why || '没查到').slice(0, 50);
    const part = String(f.part || '');
    const code = String(f.code || '');
    const course = String(f.course || '');
    // 0.15.0 之前扫的缓存没有 part —— 退回按 why 原文分组，别因此崩掉
    if (!part) {
      if (!other.has(why)) other.set(why, []);
      other.get(why).push(course);
      return;
    }
    if (code === 'nocourse') { noCourse.add(course); return; }
    if (code === 'noentry' && (part === 'work' || part === 'exam')) {
      if (noEntry[part].indexOf(course) < 0) noEntry[part].push(course);
      return;
    }
    if (!other.has(why)) other.set(why, []);
    other.get(why).push(course);
  });

  const w = noEntry.work; const e = noEntry.exam;
  // 少于 4 门才把课名写出来，多了写出来是一整屏，反而没人看
  const names = (arr) => (arr.length <= 3 ? '（' + arr.join('、') + '）' : '');

  // 🔴 0.47.2：`noentry` 这一批**不再写进界面**。
  //    code=noentry 的含义是「课程页打开了，但里面没有作业/考试入口」——
  //    结课归档的课就是这样，属于**常态**，不是这次出了什么事。
  //    用户 2026-11-06 的截图里那句
  //    「3 门课没查到作业和考试（…）多半已经结课。没查到不等于没有。」
  //    正是这一支，他明确说「这些不用显示」。
  //
  //    真正要报的是**读失败**（限流 / 登录过期 / 网络），那些进 other，一条不少。
  //    唯一的例外见下面 allDead：全部课一个入口都没有 ⇒ 那是改版或解析坏了，
  //    不是「都结课了」，必须吭一声（这条守的是「没读到 ≠ 没有」）。
  let out = '';
  const allDead = !!(d && Number(d.deep) > 0 && !(Number(d.total) > 0) &&
                     (w.length >= Number(d.deep) || e.length >= Number(d.deep)));

  // 其余原因（限流、登录过期、网络）翻译成人话，但**按课去重** ——
  // 一门课可能作业和活动一起挂，不能数两次。
  if (other.size) {
    // 去重后的课数。不能拿 other 里的条目数：一门课挂两处就算了两遍，
    // 那正是原来「20 门课显示成 40 处」的毛病。
    const uniq = [];
    other.forEach((courses) => courses.forEach((c) => {
      if (c && uniq.indexOf(c) < 0) uniq.push(c);
    }));
    const nOther = uniq.length;

    // 只有一种原因，且这一种就覆盖了全部课（绝大多数情况：一次限流全挂）⇒
    // 折成一句「31 门课没查到（学习通限流了，过几分钟再试）」。
    // 0.39.1 之前是「31 门课有东西没读到」+ 一条只有一项的列表 + 两句解释：
    // 一个原因写成三行，用户读到的是「202」这种我们内部的词。
    const groups = Array.from(other.entries());
    const onlyOne = groups.length === 1 &&
      new Set(groups[0][1].filter(Boolean)).size === nOther;

    if (onlyOne) {
      out += '<b>' + nOther + ' 门课没查到</b>' + esc(names(uniq)) +
        '<p>' + esc(cxWhySay(groups[0][0])) + '。</p>';
    } else {
      out += '<b>' + nOther + ' 门课没查到</b>';

      let rows = '';
      groups.forEach((g) => {
        // 按课去重。目前主要靠上面 `nocourse` 那道拦截保证不重复
        // （17 门课 × 作业/考试两条 = 34 条，不拦就会数成 34 门）；
        // 这层是兜底：同一个 why 下真出现重复时，也别把门数数大。
        const uq = Array.from(new Set(g[1].filter(Boolean)));
        rows += '<li>' + esc(cxWhySay(g[0])) + '：' + uq.length + ' 门' +
          esc(names(uq)) + '</li>';
      });
      out += '<ul>' + rows + '</ul>';
    }
    // 0.39.1：这里原来还有一句「其中 N 门课连课程页都没打开，作业和考试
    //    因此也没查 —— 那是「没读到」，不等于没有。」它解释的是**我们的
    //    数据是怎么缺的**，而用户已经知道「N 门没查到」了。删掉。
    //    noCourse 仍然照常收集：它保证上面的门数不重复计数。
    void noCourse;
    out += '<p class="cx-failsub">没查到不等于没有。</p>';
  }

  if (!out && allDead) {
    // 全部课都没有作业/考试入口，而且一条也没读到 ⇒ 不是「都结课了」，
    // 是学习通改版、或者我们解析坏了。这时候不能一声不吭 —— 那会把
    // 「没读到」说成「没有」。
    out = '<b>这次没读到数据</b><p>请稍后重试。</p>';
  }
  if (!out) return '';      // 常态（几门课结课归档）就什么都不显示

  return '<div class="cx-note cx-fail">' + out + '</div>';
}

/** 扫描中的细进度条。
 *
 *  🔴 摆法很关键：它挂在**旧数据上面**，不替换旧数据。
 *     用户在等的时候还能翻上次的列表、还能点开作业看 —— 这才叫「不用等」。
 *     整块换成进度卡是 0.15.2 及以前的行为（见 cxPaintTodo 里的说明）。
 */
function cxScanStripHtml(s) {
  const pct = s.n ? Math.round(s.i / s.n * 100) : 0;
  return '<div class="cx-strip">' +
    '<div class="cx-strip-h">' +
      '<span class="cx-strip-l"><i class="cx-dot"></i>正在更新</span>' +
      '<span class="cx-strip-p">第 ' + (s.i || 0) + '/' + (s.n || '?') + ' 门' +
        (s.course ? ' · ' + esc(s.course) : '') + '</span>' +
    '</div>' +
    '<div class="cx-strip-bar"><i style="width:' + pct + '%"></i></div>' +
    '<p class="cx-strip-t">以下是上次结果，扫完自动更新</p>' +
    '</div>';
}

/** 一条条目的身份。用来算「这次新查到的是哪些」。
 *
 *  为什么不用下标/顺序：扫描结果的顺序会变（按紧急度排），
 *  下标一比全都「变了」。用「类型 + 课程 + 标题」才是稳定的。
 */
function cxItemKey(it) {
  return (it && it.kind ? it.kind : '') + '|' +
         (it && it.courseId != null ? it.courseId : '') + '|' +
         (it && it.title ? it.title : '');
}

/** 一份扫描结果里所有条目的 key。签到也算 —— 「漏了一次签到」正是要看的东西。 */
function cxKeysOf(d) {
  const set = new Set();
  if (!d) return set;
  for (const field of ['items', 'signs', 'otherItems']) {
    const rows = Array.isArray(d[field]) ? d[field] : [];
    for (const it of rows) set.add(cxItemKey(it));
  }
  return set;
}

/** 这次比上次多了哪些。
 *
 *  🔴 三道「不知道就别报」，一条都不能少 —— 都是「宁可不说，也不能瞎说」：
 *
 *  ① 上一份没有 `failed` 字段 ⇒ 不报。
 *     0.15.2 及以前的缓存有 failed，但更老的（或别的客户端写的）没有。
 *     缺了它就没法判断「上次这门课读到没读到」，等于假装上次全读到了 ——
 *     上次漏掉的课会整门被报成「新」。
 *
 *  ② 上一份 items 是空的 ⇒ 不报。
 *     典型形态是「暑假扫过一次 0 条、开学再扫 76 条」，报「新查到 76 条」
 *     等于把整个列表说成新的，比不报更误导。
 *     看起来损失了「上次全交完、这次来了一条新作业」这种场景 ——
 *     但那种时候整屏就那么一两条，标不标「新」都看得见。
 *     （这条是南师侧 2026-10-23 提的，两边实现必须一致，否则同一份数据
 *      在网页版和 APK 上会显示不同的数字。）
 *
 *  ③ 上次或这次没读到某门课（failed 里有它）⇒ 那门课不报。
 *     这次所有条目对它来说都是「第一次见」—— 那不是新作业，
 *     是我们上次没看见。这条和「没读到 ≠ 没有」是同一个道理的两个方向。
 */
function cxDiffNew(prev, now) {
  const out = new Set();
  if (!prev || !now) return out;
  if (!Array.isArray(prev.failed)) return out;
  if (!Array.isArray(prev.items) || !prev.items.length) return out;

  const blind = new Set();
  for (const src of [prev, now]) {
    for (const f of (Array.isArray(src.failed) ? src.failed : [])) {
      if (f && f.course) blind.add(String(f.course));
    }
  }
  const oldKeys = cxKeysOf(prev);
  for (const field of ['items', 'signs', 'otherItems']) {
    const rows = Array.isArray(now[field]) ? now[field] : [];
    for (const it of rows) {
      if (blind.has(String(it.course || ''))) continue;
      const k = cxItemKey(it);
      if (!oldKeys.has(k)) out.add(k);
    }
  }
  return out;
}

/** 「这次新查到 N 条」的一条提示。点「知道了」就收起。 */
function cxNewBarHtml() {
  const n = CX.newKeys ? CX.newKeys.size : 0;
  if (!n) return '';
  return '<div class="cx-newbar">' +
    '<span>这次新查到 <b>' + n + '</b> 条</span>' +
    '<button class="cx-newbar-x" id="cxNewBarX">知道了</button>' +
    '</div>';
}

/** 头部右边那句「这次查了多少」。**只说实话**：
 *  · 0.47.2 起后端给 `scope` ⇒ 有课表时说「本学期 17 门」。
 *    以前写「37 门课里查了 17 门」：那 37 是学习通里**历史上过的全部教学班**，
 *    跟这学期没关系，摆在那儿只会让人以为范围没收窄（用户 2026-11-06 的原话）。
 *  · 老缓存没有 `scope` ⇒ 退回「N 门课」，绝不编一个数出来。
 *
 *  🔴 2026-11-11：去掉「共」和「查的」。这一行是
 *     `5 分钟前 · 3 门课 · 按紧急度`，三个片语一个档位、一个分隔符。
 *     原来写「5 分钟前查的 · 共 3 门课」，两个都是废话字：
 *     数据列表顶上的时间只能是「几时查的」，数字后面的「门课」已经说明单位。
 *     省下的 26px 正好让「按紧急度」也挤进来。 */
function cxScanScope(d) {
  const n = Number((d && d.courses) || 0);
  if (!n) return '';
  if ((d && d.scope) === 'term') return '本学期 ' + n + ' 门';
  return n + ' 门课';
}

function cxPaintTodo() {
  const s = CX.scan || {};
  const d = CX.data;
  let html = '';

  // 进这一页顺手拉一次收件箱（5 分钟一次，后端也有一份同样长的缓存）。
  // 🔴 放在这里而不是 boot：没连学习通的人不该为一个用不上的接口发请求。
  // 🔴 不 await、不挡渲染：收件箱比作业次要得多，它慢或挂都不该让列表晚出现。
  if (CX.state === 'ok' && Date.now() - (CX.mail.at || 0) > CX_MAIL_TTL_MS) {
    cxMailLoad(false);
  }

  // 🔴 2026-10-23 改：扫描时**不再盖掉已有数据**。
  //    以前只要 state === 'scanning' 就把整个 #cxBody 换成一张进度卡，于是
  //    「想看新发的作业」= 盯着进度条等 90 秒，这期间连旧列表都看不见。
  //    用户原话：「学习通每次想看新发的作业都需要全量读取一遍，效率太低了」。
  //    现在：有旧数据就照常显示（只在顶上挂一条细进度），扫完原地替换。
  //    真没数据时才显示整块进度卡 —— 那种情况下本来也没有东西可看。
  const scanning = s.state === 'scanning';

  if (scanning && !d) {
    const pct = s.n ? Math.round(s.i / s.n * 100) : 0;
    html =
      '<div class="card cx-login">' +
      '<h2 class="cx-h">正在检查…</h2>' +
      '<p class="cx-p">第 ' + (s.i || 0) + ' / ' + (s.n || '?') + ' 门课' +
        (s.course ? '（' + esc(s.course) + '）' : '') + '</p>' +
      '<div class="cx-bar"><i style="width:' + pct + '%"></i></div>' +
      (s.phase ? '<p class="cx-note">正在查：' + esc(s.phase) + '</p>' : '') +
      '<p class="cx-note">约需 2 分钟，可先切换到其他页面，稍后返回查看进度。</p>' +
      '</div>';
    $('cxBody').innerHTML = html;
    return;
  }

  if (!d) {
    html =
      '<div class="card cx-login">' +
      '<h2 class="cx-h">还没查过</h2>' +
      '<p class="cx-p">' +
        (s.state === 'error' ? '上次出错：' + esc(s.err || '') + '。<br>' : '') +
        '大约要 2 分钟。查完会存下来，下次打开直接看。</p>' +
      cxRelinkHtml() +
      '<button class="btn primary block" id="cxScan">检查一次</button>' +
      '</div>' + cxFootHtml(false);
    $('cxBody').innerHTML = html;
    cxBind();
    return;
  }

  // ---- 有数据 ----
  // 记下「第一次见到」的时刻：收件箱里那两条合成提醒（新发布 / 快截止）靠它。
  // 🔴 放在这里而不是扫描完成那一刻：缓存恢复、前后台切回来都会走到这一句，
  //    而扫描完成的回调有三条路（原生 / Python / 恢复），漏一条就少记一批。
  cxSeenTouch(d.items);
  // 快查到的「正在进行」并到最前面（0.52.3 v6，见 cxWithLive）。
  // 🔴 并在这里而不是并进 CX.data：全量扫描那份是唯一真相，不能拿快查去改它。
  // 收件箱捡回来的那几条（0.53.0，见 cxMailTodoItems）也在这里并进来 ——
  // 它们不在扫描结果里，但必须出现在这一页，「消息里有、作业里没有」才叫修好。
  const all = cxWithLive(cxSortItems(
    cxWithMailTodo(Array.isArray(d.items) ? d.items : [])));
  const kind = cxKindFilter(all);
  const items = kind === 'all' ? all : all.filter((it) => cxKindOf(it) === kind);
  const group = CFG.cxGroup === 'course' ? 'course' : 'all';

  // 分类各有多少条，下面那排药丸上写着，不在这里重复。
  const counts = cxKindCounts(all);
  // 只有「混着好几类」才给每条挂分类标。全是作业的时候挂 4 个「作业」标
  // 纯属噪声 —— 那本来就是绝大多数情况。
  const showKind = kind === 'all' &&
    CX_KINDS.filter((k) => counts[k] > 0).length > 1;
  const dueN = (counts.work || 0) + (counts.exam || 0);
  // 这次**没读到**的课。必须在算头部大字之前就拿到 —— 下面「都清了」和
  // 「所有课的作业都交了」两句话都要先问它。
  // 🔴 2026-10-27 修（南师侧同一处）：以前这两句话完全不管 failed，
  //    于是「登录态过期、一门都没查成」的页面上会写着「都清了」，
  //    紧接着下面又列出 20 门没查到 —— 两句话互相打架，而前一句是假话。
  //    「没读到」被说成「没有」，正是这个产品最不能犯的错。
  // ⚠️ noentry（课程页里根本没这个入口）不算没查成：多半是已结课归档。
  //    算进来的话，学期中每门结课课都会让这句话天天挂着，
  //    用户三天就学会无视它 —— 那比不提示更糟。
  const failed = Array.isArray(d.failed) ? d.failed : [];
  const missedN = new Set(failed
    .filter((f) => String(f.code || '') !== 'noentry')
    .map((f) => String(f.course || ''))).size;
  let headMain, headWord;
  if (kind !== 'all') {
    headMain = items.length;
    headWord = ' 条' + CX_KIND_NAME[kind];
  } else if (dueN) {
    headMain = dueN;
    headWord = ' 条要交';
  } else if (all.length) {
    headMain = all.length;
    headWord = ' 条动态';
  } else {
    headMain = 0;
    headWord = '';
  }
  // 签到已经从待办里摘出去了，所以「作业考试都清了」的时候 all 是空的。
  // 这时候如果还有签到在等，头部不能写「都清了」—— 它会和下面那张
  // 「2 个正在进行」的签到卡直接打架。
  const liveSigns = (Array.isArray(d.signs) ? d.signs : []).filter(cxSignOpen).length;

  // 🔴 0.49.0：**自动扫不顶进度条**。
  //    用户 2026-11-07：「学习界面每次打开都会在上方出现个进度条并迅速显示
  //    查不到」。那一次扫描不是他发起的，页面上的数据照旧摆着，
  //    头部那行「N 分钟前查的」已经说清是旧的 —— 再顶一条进度条只是噪点。
  //    扫完原地换掉，没有任何痕迹。
  //    ⚠️ 没旧数据时照旧出（包括自动扫）：整页空着又没有进度，
  //       用户只会以为点坏了。手动点「重新查」也照旧出 —— 那是他要看的。
  const quiet = scanning && CX.autoScan;
  // 这次没更新上（自动扫失败），在头部副标题里说，不再占一整行红字。
  const stale = s.state === 'error';
  html = (scanning && !quiet ? cxScanStripHtml(s) : '') + cxNewBarHtml() +
    '<div class="cx-hd">' +
    (headMain ? '<b>' + headMain + '</b>' + headWord
              // 这里**不带数字**：下面那张签到卡第一行就写着「N 个正在进行」，
              // 隔 40px 把同一个数字说两遍，看着像出了 bug。
              : (liveSigns ? '签到在进行' : (missedN ? '没查全' : '都清了'))) +
    '<span class="cx-hdm">' + cxAgo(CX.age) + ' · ' +
      (stale ? '这次没更新上' : cxScanScope(d)) + '</span>' +
    // 排序挂在这行右端（2026-11-11 从药丸行搬过来的，理由见 cxCatsHtml）。
    // 收件箱（2026-11-13）排在排序**前面**：两个都是 11px 蓝字，并排时
    // 谁在后面谁就贴着屏幕边缘 —— 未读那个红点贴边会被系统手势区吃掉。
    // `all.length` 为 0 时整条列表都没有，排序没有意义，不出现；
    // 但**消息照样出**：作业全交完了照样可能有一条「老师把作业延期了」的
    // 公告，那正是最该看到的时候。
    // 2026-11-15：两颗动作收进 `.cx-hda` 靠右 —— 原来它们和
    // 「5 分钟前 · 3 门课」一起挤在右半边（那一行四样东西），
    // 左边「3 条要交」后面留一大片空白。现在左边是一整句信息、右边是动作。
    '<span class="cx-hda">' + cxMailHtml() +
    (all.length ? cxSortHtml(group) : '') + '</span>' +
    '</div>';

  // 🔴 0.49.0：失败提示分两种，不再一律顶一条红字。
  //    · 登录态过期（kind=auth）：**必须说**，而且要带一个能点的重连按钮 ——
  //      这是用户唯一能自己解决的那种，光沉默等于让他干等。
  //    · 其他（平台改版 / 网络抖动）：在头部副标题写「这次没更新上」就够了。
  //      每次打开都甩一条红字，只会让人以为 App 坏了 —— 而列表其实是好的。
  if (stale && s.kind === 'auth') {
    html += '<p class="cx-note err">登录态过期了，下面这些是上次查到的。</p>' +
            cxRelinkHtml();
  }

  // 签到卡摆在数据头下面、分类药丸上面。
  // 🔴 必须在 `if (all.length)` 外面：签到记录和「待办」是两回事 ——
  //    作业全交了（all 为空）的时候，签到历史照样该看得见。
  html += cxSignCardHtml(Object.assign({}, d, { signs: cxSignsWithLive(d) }));

  // 「N 门课已结课，这次没查」—— 摆在签到卡下面、列表上面。
  // 放这里而不是塞进失败提示：它不是「出错了」，是「我们主动省了事」，
  // 混在错误里会让人以为扫描坏了。
  html += cxPausedHtml(d);

  // 🔴 0.40.0：排序从「一行两个 seg 按钮」变成分类药丸行右边的一颗切换。
  //    原来那是上下两行（34 + 40 + 两个间距 = 90px），一行分类、一行排序，
  //    做的事却只有一件「筛」。合成一行之后省下 48px，而且更像一件事。
  if (all.length) html += cxCatsHtml(all, group);

  // 0.33.0：首屏只铺前 `CX.showN` 条。
  // 这一页天生是长列表（一条 84px），十条就 840px —— 不截的话必须滑。
  // 截断只影响**渲染**，不动 items：分类计数、失败提示、跳过统计还是全量的。
  const cap = Math.max(1, CX.showN || CX_FIRST);
  const shownItems = items.slice(0, cap);

  if (!items.length) {
    html += '<p class="cx-note">' +
      (all.length ? '这一类里现在没有东西。'
                  : (missedN
                      ? '这次没查全（' + missedN + ' 门课没读到），所以不能说'
                        + '「都交了」—— 没查到的课里可能有作业。'
                      : '上次检查：作业都交了，没有待考的试')) +
      '</p>';
  } else if (group === 'course') {
    html += '<div class="cx-list cx-list-page">' +
      cxGroupByCourse(shownItems).map((g) =>
        '<div class="cx-grp">' +
        '<div class="cx-grph"><span class="cx-grpn">' + esc(g.course) + '</span>' +
        '<span class="cx-grpc">' + g.items.length + ' 条</span></div>' +
        g.items.map((it) => cxItemHtml(it, false, showKind)).join('') +
        '</div>').join('') + '</div>';
  } else {
    html += '<div class="cx-list cx-list-page">' +
      shownItems.map((it) => cxItemHtml(it, true, showKind)).join('') + '</div>';
  }
  // 「还有 N 条」：说了还剩几条，而不是只说「展开」—— 数字让人知道
  // 后面是 2 条还是 20 条，值不值得点。
  if (items.length > shownItems.length) {
    html += '<button class="cx-more" id="cxMore">还有 ' +
      (items.length - shownItems.length) + ' 条没显示</button>';
  }

  // ---- 已完成的那一批（2026-11-09）----
  // 用户要「每个作业和随堂练习旁边都有已完成 / 未完成」。待办里天生只有
  // 未完成的，做完的那些被 open_items 滤掉了 —— 不在这里摆出来，
  // 「已完成」这个标就永远没有地方落，用户也就没法核对
  // 「我明明交了，它到底认没认」。
  // 默认收起：这一页的主角是「还要做什么」。点开才铺，和「还有 N 条」同一种手势。
  const doneList = Array.isArray(d.doneItems) ? d.doneItems : [];
  const doneShown = (kind === 'all' ? doneList
                                    : doneList.filter((it) => cxKindOf(it) === kind));
  if (doneShown.length) {
    html += '<button class="cx-more cx-donemore" id="cxDoneMore">' +
      (CX.showDone
        ? '收起已完成的 ' + doneShown.length + ' 条'
        : '已完成 ' + doneShown.length + ' 条 · 点开看') + '</button>';
    if (CX.showDone) {
      // 按课程分组视图里也照样写课程名 —— 这一段是「核对用」的，
      // 分开的时候少写课程名，反而认不出是哪门课的哪一条。
      html += '<div class="cx-list cx-list-page cx-donelist">' +
        doneShown.map((it) => cxItemHtml(it, true, showKind)).join('') + '</div>';
    }
  }

  // 有东西没读到时要说话；但「这门课没有作业入口」那种常态不说了
  // （见 cxFailHtml：自己会返回空串）。
  if (failed.length) html += cxFailHtml(failed, d);

  // 被筛掉的那些也要交代清楚。🔴 「没显示」不等于「不存在」——
  //    已交/已结束/状态认不出来，三种原因分开说，别揉成一句。
  //    只在「全部」里说：这些数字是整个扫描的全局统计，
  //    摆在「只看考试」里会读成「考试里有 86 条已交」，那是错的。
  //
  // 0.39.1：只留「认不出的」。「已交或已考完 442 条、已结束 442 条」是
  //    全库统计，对用户没有任何可做的事 —— 用户 2026-11-01：
  //    「不应该有冗余的解释性文案」。认不出的那几条要留着：它是**不确定**，
  //    不写出来就成了「悄悄丢掉」，两种性质完全不一样。
  const sk = d.skipped || {};
  if (kind === 'all') {
    const odd = sk.odd || d.other || 0;
    if (odd) {
      html += '<p class="cx-note">还有 ' + odd + ' 条状态认不出，没列进来。</p>';
    }
  }

  html += cxFootHtml(true);
  $('cxBody').innerHTML = html;
  cxBind();
}

// -- 扫描 ----------------------------------------------------------

/** 本学期教务课表里在修的课名 —— 给学习通扫描当「别降频」的白名单。
 *
 *  为什么需要它：0.39.0 起「最新内容三个月前 ⇒ 这门课不常扫了」。
 *  那是个猜，猜错就漏作业。教务课表是「这门课现在真的在上」的唯一权威来源，
 *  拿它兜住：课表里有的课**永不降频**。
 *
 *  🔴 拿不到就返回空数组，后端见空数组**一律不降频**（宁可慢）。
 *     绝不能因为「没绑教务」就退化成「全都当历史课」—— 那会把用户正在上的
 *     课全档住，而他甚至没做错什么。
 */
function cxActiveNames() {
  // 0.47.0：从「一串课名」升级成「课名 + 老师」。
  // 为什么非要老师：光靠课名分不清哪一门是本学期的 —— 实测这个账号的
  // 「高等数学（理工类）」同时挂着 25-26-1 / 25-26-2 / 非当前 三个教学班，
  // 课名一模一样，只有老师不一样。老师名是学习通班级名里唯一能对上的东西
  // （「25计科1-3班-于占军-大物2」）。
  //
  // 课表里同一门课会出现很多行（一个时段一行），所以按「课名+老师」去重；
  // 同一门课挂了两个老师的，把老师名并起来当一个词用。
  const byName = new Map();
  ((DATA && DATA.courses) || []).forEach((c) => {
    const n = c && c.name ? String(c.name).trim() : '';
    if (!n) return;
    const t = String((c && c.teacher) || '').trim();
    if (!byName.has(n)) { byName.set(n, []); }
    if (t) byName.get(n).push(t);
  });
  const out = [];
  byName.forEach((ts, n) => {
    // 「张强,苏博」拆成两条独立记录 —— 后端是拿**整串**去班级名里找的，
    // 拼成一条「张强苏博」永远也匹配不上。
    const parts = [];
    ts.forEach((x) => String(x).split(/[,，、;；\/]+/).forEach((y) => {
      const v = y.trim();
      if (v && parts.indexOf(v) < 0) parts.push(v);
    }));
    if (!parts.length) { out.push({ name: n, teacher: '' }); return; }
    parts.forEach((t) => out.push({ name: n, teacher: t }));
  });
  return out;
}

async function cxScanStart(manual, force, auto) {
  if (CX.busy) return;
  // 自动查（cxAutoScan 发起的那条路径）失败时不弹 toast —— 见 cxPoll。
  CX.autoScan = !!auto;
  // 🔴 90 秒冷却，只挡**用户手点**（manual=true）。
  //    一次全量扫描要 60~90 秒、几十个请求；刚扫完马上再点，学校的 WAF 会直接
  //    403（2026-10-23 南师侧实测：一分钟内再点必 403）。403 不是权限问题，
  //    是「查得太密」—— 挡在客户端，比让用户撞上去看一句看不懂的报错好。
  //    ⚠️ 自动查不挡：那条路径自己按 CX_AUTO_SEC 挡着（30 分钟），
  //       比 90 秒严得多，再叠一层只会让「刚扫完切个页面回来」被无谓拒绝。
  if (manual) {
    const lastAt = CX.data && CX.data.at ? Number(CX.data.at) : 0;
    const waited = Date.now() / 1000 - lastAt;
    if (lastAt && waited < CX_COOL_SEC) {
      toast('刚扫过，' + Math.ceil(CX_COOL_SEC - waited) +
            ' 秒后再试 —— 查太频繁会被学校网站临时拦下');
      return;
    }
  }
  CX.busy = true;
  // 记下扫描前的样子 —— 扫完要拿它算「这次新查到了什么」。
  // 「新」标记也一起清掉：那是上一轮的结论，不该跟着新结果继续挂着。
  CX.prevData = CX.data || null;
  CX.newKeys = null;
  try {
    const r = await api('/api/cx/scan', { force: !!force,
                                          activeNames: cxActiveNames(),
                                          // 教务给的当前学期。后端拿它判「学习通这个班
                                          // 是不是别的学期开的」—— 课名只能说明是同一门课，
                                          // 说明不了是不是这个学期的。
                                          semester: (DATA && DATA.semester) || '' });
    if (!r.ok) {
      CX.busy = false;
      // 🔴 只有**服务端确认会话没了**（needLogin）才退回登录态。
      //    限流/断网（kind=net）时保持「已登录」不动 —— 那种情况登录态是好的，
      //    把界面退回登录页会让人白输一遍密码。
      if (r.needLogin) {
        CX.state = 'none';
        CX.scan = null;
        // CX.data **不清**：重连之后还能立刻把上次的结果摆出来，
        // 清掉的话用户重连完还得再等一整轮扫描才有东西看。
        cxPaint();
      }
      toast(r.error || '启动失败');
      return;
    }
    CX.scan = r.scan || { state: 'scanning', i: 0, n: 0, course: '' };
    // 🔴 能开始扫 ⇒ 会话是活的。界面可能还停在登录表单上 ——
    //    两种来路：① 刚从「打开学习通」那个 WebView 里登录回来，
    //    cookie 已经回灌进罐子，但本页的 CX.state 还是旧的 'none'；
    //    ② cookie 名跟我们的判据对不上，可服务器认。
    //    不补这一步，用户会看到「明明能查，界面却让我再登一次」。
    if (CX.state !== 'ok') {
      CX.state = 'ok';
      cxPaint();
    }
    cxPaint();
    cxStopPoll();
    // 🔴 开始新一轮前清旧账。不清的话：sigAt 还是上个钟头的时刻，
    //    第一次轮询就判「卡住了」；pollFails 还带着上一场的失败次数，
    //    新一场第一次抖动就直接落 error。
    CX.pollFails = 0;
    CX.sig = '';
    CX.sigAt = 0;
    // 后端是后台线程跑的，前端只轮询进度。1.2 秒一次，别打太密。
    CX.timer = setInterval(cxPoll, 1200);
  } catch (e) {
    toast('启动失败：' + e.message);
  } finally {
    CX.busy = false;
  }
}

async function cxPoll() {
  // 已经收尾（done / error）之后又被叫了一次 —— 比如上一个定时器的回调
  // 正好在收尾那一瞬间排上队。这时候**不许再动状态**：把 done 改成 error
  // 等于把刚查到的结果作废，用户会看到「这次没查成」而其实查成了。
  const cur = (CX.scan || {}).state;
  if (cur === 'done' || cur === 'error') { cxStopPoll(); return; }
  let t;
  try {
    t = await api('/api/cx/todo');
  } catch (e) {
    // 一次抖动不算故障（切 WiFi、息屏、后端正好在忙都会这样）。
    // 连续 CX_POLL_FAIL_MAX 次都拿不到才判失联 —— 不判的话界面会永远停在
    // 「正在检查」，而那是没有任何出口的。
    CX.pollFails = (CX.pollFails || 0) + 1;
    if (CX.pollFails >= CX_POLL_FAIL_MAX) {
      cxPollGiveUp('跟后台失去联系（连续 ' + CX_POLL_FAIL_MAX + ' 次没回应）');
    }
    return;
  }
  CX.pollFails = 0;
  CX.scan = t.scan || CX.scan;
  CX.data = t.data || CX.data;
  CX.age = typeof t.age === 'number' ? t.age : CX.age;
  const s = CX.scan || {};

  // ---- 卡住判定：进度指纹一直不变 ----
  // 四个字段都要进指纹，理由各不相同：
  //   i      —— 最直观
  //   course —— 后端先写 i 再换 course，同一门上停住时两个都不变
  //   phase  —— 扫描刚开始那段 i/n 都是 0（还在拿课程列表），只看 i 的话
  //             从第一秒起就在攒「没变」的时间
  //   n      —— 换一场扫描（25 门 → 26 门）i 可能碰巧相同
  if (s.state === 'scanning') {
    const sig = [s.i, s.n, s.course, s.phase].join('|');
    const now = Date.now();
    if (sig !== CX.sig) {
      CX.sig = sig;
      CX.sigAt = now;
    } else if (CX.sigAt && now - CX.sigAt > CX_STUCK_MS) {
      cxPollGiveUp('检查卡住了，两分钟没动静');
      return;
    }
  }

  if (s.state === 'done' || s.state === 'error') {
    cxStopPoll();
    if (s.state === 'error') {
      // 自动查是静默的，失败也静默 —— 但要记一笔，让 cxAutoScan
      // 隔 CX_AUTO_RETRY 再试（见 CX.autoFailAt 的注释）。
      CX.autoFailAt = Date.now() / 1000;
      // 🔴 自动查失败**不弹 toast**。用户没点任何东西，突然一条「检查失败」
      //    只会让他以为 App 坏了；而真实情况往往是「这会儿没网」，
      //    十有八九他自己也看不出来。界面上那张错误卡已经写清楚了（cxPaint）。
      if (!CX.autoScan) toast('检查失败：' + (s.err || ''));
    } else {
      // 扫成了才谈得上「新」。失败那次一条都没读到，拿它当基线
      // 会把整份列表都说成「新查到」—— 那正是 cxDiffNew 要挡的事。
      CX.newKeys = cxDiffNew(CX.prevData, CX.data);
      CX.autoFailAt = 0;
      // 刚扫完这一份才是最新的：存进去，课表刻度和两小时前的提醒立刻跟上
      // （`done` 之后 cxStopPoll 不再轮询，这里只会跑一次）。
      if (CX.data) dueCacheSave(CX.data.items, 'cx');
    }
    renderMe();
  }
  cxPaint();
}

/* 「我的」里那一行学习通 2026-10-22 删掉了（用户：跟现有功能重复）。
   账号相关的事现在统一在「账号管理」页，见 renderAccounts()。 */

// ------------------------------------------------------------------ 绑定 / 同步

/** 解读 /api/login 回来的 `saved` 字段。
 *
 *  空串      → 存好了（网页版走 Windows DPAPI，APK 走 Android Keystore）
 *  'soft'    → 存好了，但用的是备用密钥（Keystore 不可用，退到 ANDROID_ID 派生）
 *  'fail: x' → 没存上，x 是原因
 *  undefined → 这个数据层没有 remember 机制（老版本），按「存好了」处理，
 *              否则老服务配新界面会天天弹「密码没存住」
 *
 *  🔴 以前这里是 `res.saved === false` 的布尔判断，而**重新输密码那条路
 *     根本没看这个字段**，于是「提示已保存 → 下次又要重输」能一直存在。
 *     所以这里统一成一个入口，两条路都必须走它。
 */
function credSaved(res) {
  const v = res ? res.saved : undefined;
  if (v === undefined || v === null) return { ok: true, soft: false, why: '' };
  // 老版本 bridge（布尔值）还在跑的时候也要认，别因为契约变了就误报「没存住」
  if (v === true) return { ok: true, soft: false, why: '' };
  if (v === false) return { ok: false, soft: false, why: '数据层报告保存失败（没有给原因）' };
  const s = String(v);
  if (!s) return { ok: true, soft: false, why: '' };
  if (s === 'soft') return { ok: true, soft: true, why: '' };
  return { ok: false, soft: false, why: s.replace(/^fail:\s*/, '') || '未知原因' };
}

function setBusy(btn, busy, text) {
  if (busy) {
    btn.dataset.old = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>' + (text || '处理中…');
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.old || text || '完成';
  }
}

async function doBind() {
  const user = $('inUser').value.trim();
  const pass = $('inPass').value;
  const tip = $('bindTip');
  tip.textContent = '';
  if (!user || !pass) { tip.textContent = '学号和密码都要填'; return; }

  const btn = $('btnBind');
  setBusy(btn, true, '正在登录教务系统…');
  try {
    // 🔴 一律 remember: true。以前跟着勾选框走，取消勾选后就会出现
    //    「明明登录成功了，刷新却说没绑定」—— 数据在、密码没存，界面看不出来。
    //    密码怎么存：网页版走 Windows DPAPI，APK 走 Android Keystore，都是密文。
    const res = await api('/api/login', { username: user, password: pass, remember: true });
    if (!res.ok) {
      // 上报「哪一档失败」。⚠️ 只报分类和**已经是我们写给用户看的那句话**，
      // 不报用户名 —— 学号在用户名框里，一个字节都不许带出去。
      tip.textContent = res.error || '绑定失败';
      return;
    }
    applyPayload(res, true);
    $('inPass').value = '';
    const sv = credSaved(res);
    if (sv.ok) {
      BOUND = true;
      CRED_STATE = 'ok';
      CRED_ERR = '';
    } else {
      // 🔴 没存住就是没存住，不能把 BOUND 置 true 蒙过去。
      //    置 false 之后「我的」里那张补密码的卡片会直接出现，
      //    用户当场就能再试一次，而不是等下次打开才发现白输了。
      BOUND = false;
      CRED_STATE = 'none';
      CRED_ERR = sv.why;
    }
    switchTab('schedule');
    renderMe();
    // applyPayload 里的 prefetchExams() 是同步跑到第一个 await 的，
    // 所以这时 prefetchTotal 已经知道有几个学期要补。告诉用户一声 ——
    // 不然他以后切学期时那一下等待还是没来由的。
    const more = prefetchTotal ? '，正在补齐其他学期的考试' : '';
    // 🔴 课表没读到 ≠ 绑定失败。学号密码是对的（登录已经过），成绩/考试/计划
    //    都是好的；只是课表这一页学校没给。以前这种情况整次绑定都算失败，
    //    用户只能一遍遍重输密码（2026-11-06 截图）。
    //    顺序要紧：密码没存住比课表没读到更急 —— 前者下次就要重输。
    if (!sv.ok) {
      toast('登录成功，但密码没存住：' + sv.why + '。下次打开要重新输入', 6000);
    } else if (res.timetableError) {
      // 绑上了但课表没读到 —— 这是那几天最费解的一类（辅修那次就是它）。
      toast('绑定成功了，但课表这次没读到：' + res.timetableError +
            '。成绩和考试照常能看', 7000);
    } else if (sv.soft) {
      toast('绑定成功，已同步 ' + res.courses.length + ' 条课程安排' + more + '（密码用了备用加密方式）', 4000);
    } else {
      toast('绑定成功，已同步 ' + res.courses.length + ' 条课程安排' + more);
    }
    // 只有课表真读到了才问。没课表就没有「哪节课、在哪上」，
    // 这时候问「要不要提醒你上课」是句空话。
    if (sv.ok && !res.timetableError) askRemindAfterBind();
  } catch (e) {
    tip.textContent = e.message || envText('连不上电脑上的服务', '连不上教务系统，请检查网络后重试');
  } finally {
    setBusy(btn, false, '绑定并同步');
  }
}

async function doSync(goSchedule) {
  return doNepuSync(goSchedule);
}

async function doNepuLogin() {
  const status = $('nepuStatus');
  status.textContent = '正在打开学校登录…';
  try {
    if (!window.AndroidNepu || typeof window.AndroidNepu.openLogin !== 'function') throw new Error('请在东油通 App 内打开教务登录');
    window.AndroidNepu.openLogin();
    nepuSession = false;
    status.textContent = '已打开学校登录页；完成登录后，返回此页同步以验证会话';
    renderAccounts();
  } catch (e) {
    status.textContent = e.message || '登录未完成';
  }
}

async function doNepuSync(goSchedule) {
  if (syncing) { toast('正在同步，请稍候'); return; }
  if (!window.Nepu || typeof Nepu.normalize !== 'function') {
    toast('教务数据模块尚未加载'); return;
  }
  syncing = true;
  const status = $('nepuStatus');
  const select = $('nepuTerm');
  const id = select ? select.value : '';
  const btn = $('btnSync');
  const v = $('meSyncTime');
  const old = v ? v.textContent : '';
  if (btn) btn.disabled = true;
  const panelBtn = $('nepuSync');
  if (panelBtn) panelBtn.disabled = true;
  if (v) v.textContent = '同步中…';
  if (status) status.textContent = '正在同步课表、成绩、考试和公告…';
  const generation = CACHE_GEN;
  try {
    const result = await nepuBridgeCall('sync', String(id || ''));
    if (generation !== CACHE_GEN) return;
    const raw = result.data || {};
    const payload = Nepu.normalize(raw);
    nepuTerms = payload.terms || nepuTerms;
    if (select && nepuTerms.length) {
      select.innerHTML = '<option value="">当前学期</option>' + nepuTerms.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('');
      select.value = id;
    }
    payload.source = 'nepu';
    payload.nepuTerms = nepuTerms;
    payload.week1Monday = raw.week1Monday || '';
    // 教务给的节次时间（Nepu.periodTimes 已按 45 分钟一节 + 排课记录修过）优先，
    // 但用户手改过的作息不覆盖 —— 他改就是因为学校临时调了课。
    const bh = payload.businessHours;
    if (Array.isArray(bh) && bh.some(r => Array.isArray(r) && r.length === 2) && CFG.timesSource !== 'manual') {
      CFG.times = bh;
      CFG.timesSource = 'nepu';
    }
    if (payload.week1Monday) {
      // The selected term replaces the displayed snapshot, so dates must follow it too.
      CFG.startDate = String(payload.week1Monday).slice(0, 10);
      CFG.semester = payload.semester;
      CFG.weeks = payload.totalWeeks;
    }
    applyPayload(payload);
    saveNepuNotices(raw);
    nepuSession = true;
    if (status) status.textContent = '已同步 ' + (payload.semester || '') + ' · ' + (payload.courses || []).length + ' 条课程安排';
    renderAccounts();
    toast('教务数据同步完成');
    if (goSchedule) switchTab('schedule');
  } catch (e) {
    if (/auth|login|session/i.test(e.kind || '')) nepuSession = false;
    if (status) status.textContent = (e.message || '同步失败') + '；本地数据已保留';
    toast(e.message || '教务同步失败', 3000);
  } finally {
    syncing = false;
    if (btn) btn.disabled = false;
    if (panelBtn) panelBtn.disabled = false;
    if (v) v.textContent = old;
    renderMe(); renderAccounts();
  }
}

$('nepuLogin').addEventListener('click', doNepuLogin);
$('nepuSync').addEventListener('click', () => doNepuSync());
if (DATA && DATA.source === 'nepu') {
  nepuTerms = Array.isArray(DATA.nepuTerms) ? DATA.nepuTerms : [];
}
if (DATA && DATA.source === 'nepu' && $('nepuTerm')) {
  $('nepuTerm').innerHTML = '<option value="">当前学期</option>' + nepuTerms.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('');
  $('nepuStatus').textContent = '本地缓存 · 登录状态需本次打开后验证';
}
function applyPayload(res, isBind) {
  // 换账号了就别留着上一个人的「其他学期考试」缓存。
  // 同一个人的话留着：切来切去不用重新打教务系统。
  const oldSid = (DATA && DATA.profile && DATA.profile.studentId) || '';
  const newSid = (res.profile && res.profile.studentId) || '';
  const keepBySem = (oldSid && oldSid === newSid && DATA && DATA.examsBySem) || {};
  // 同步回来的是**当前学期**：正在看历史学期的话，收回当前学期。
  // 否则下面 `CFG.week = currentWeek()` 会按历史学期算（恒为 1），
  // 而界面还挂着旧的那张历史课表，用户点刷新会看到「没反应」。
  TT = null;

  /* 🔴 2026-11-13：**没读到 ≠ 没有，更不代表本地要跟着清空。**
   *
   * 有人报「课表和个人信息都没了」，他并没有辅修专业 —— 跟「一个人挂多个
   * 编号」那条路无关。真正发生的事是：学校那一次没给出内容（空响应 / 网关页 /
   * 参数不对被弹回），后端把这一块兜成空，前端**照单全收**写回本机，
   * 于是屏幕上原本好好的课表和学籍一起空了。
   *
   * 现在的规矩：只要这一块带回来的是「没读到」（timetableError / profileError /
   * grades.error / exams.error），而本机有一份好的，就**留着本机那份**，
   * 另外把这几个标记挂上去，让界面说清「这次没读到，显示的是上次的」。
   * 只有**真读到了空表**（没有 error）才接受空 —— 新学期的空课表必须能显示出来。
   */
  const prev = DATA;
  const keepTT = !!res.timetableError &&
    !!(prev && prev.courses && prev.courses.length);
  // 学籍这条多一道闸：**只有能确认是同一个人**才留。
  // 绑的是另一个账号、而这次学籍又没读到时，留着上一个人的姓名/学号
  // 比空着更糟 —— 屏幕上会出现别人的名字。
  const sameGuy = !!oldSid && (newSid === oldSid || (!newSid && !isBind));
  const keepPF = (!!res.profileError || !newSid) && sameGuy &&
    !!(prev && prev.profile && prev.profile.studentId);
  const keepGR = !!(res.grades && res.grades.error) &&
    !!(prev && prev.grades && prev.grades.courses && prev.grades.courses.length);
  const keepEX = !!(res.exams && res.exams.error) &&
    !!(prev && prev.exams && prev.exams.exams && prev.exams.exams.length);

  const keepManualCourses = res.source === 'nepu' && prev && !keepTT
    ? (prev.courses || []).filter((c) => isMyCourse(c)) : [];
  DATA = {
    profile: (keepPF ? prev.profile : res.profile) || {},
    semester: keepTT ? prev.semester : res.semester,
    unitCount: keepTT ? prev.unitCount : res.unitCount,
    totalWeeks: keepTT ? prev.totalWeeks : res.totalWeeks,
    grades: keepGR ? prev.grades : res.grades,
    // 考试可能整块缺失（老版本服务、或后端兜底失败）—— 存 null 而不是 {}，
    // 让 renderExams 能区分「没这块数据」和「查了但学校没排考」
    exams: (keepEX ? prev.exams : res.exams) || null,
    // 培养计划。取不到时是个带 error 的空壳（native.js 里兜的），
    // 所以这里存 null 还是 {} 要分清：null = 老服务根本没有这块，
    // {} = 有这块但没取到，两种情况的提示语不一样。
    courses: (keepTT ? prev.courses : (res.courses || [])).concat(keepManualCourses),
    plan: res.plan || null,
    // 按学期缓存的考试（考试页切学期用），只存取成功的
    examsBySem: keepBySem,
    source: res.source || '',
    termId: res.termId || '',
    terms: res.terms || [],
    nepuTerms: res.nepuTerms || [],
    week1Monday: res.week1Monday || '',
    syncedAt: res.syncedAt,
    // 课表这次**没读到**的原因（学校没给 / 没分班 / 没读到）。
    // 没有这个键 = 读到了。空课表 + 这个键 ⇒ 界面要说「没读到」，不能说「没课」。
    timetableError: res.timetableError || '',
    profileError: res.profileError || '',
    // 这几块是**上一次读到的那份**（这次没读到）。界面据此加一句「显示的是上次的」。
    keptFrom: (keepTT || keepPF || keepGR || keepEX) ? (prev.syncedAt || 0) : 0,
    keptWhat: [keepTT ? '课表' : '', keepPF ? '个人信息' : '',
               keepGR ? '成绩' : '', keepEX ? '考试' : ''].filter(Boolean).join('、'),
  };
  // 新同步回来的就是当前学期 ⇒ 选中项回到默认，旧错误清掉
  examTerm = '';
  Object.keys(EXAM_ERR).forEach((k) => { delete EXAM_ERR[k]; });
  // 换了人就把上一位的空教室查询结果扔掉。同一人重新同步则留着：
  // 空教室查一次要打一次学校服务器，没换人就没必要再查一遍。
  if (oldSid !== newSid) resetRooms();
  store.set(KEY.data, DATA);
  if (res.source !== 'nepu' && migrateStartDate(DATA.semester)) { /* 旧默认值已纠正 */ }
  if (!CFG.startDate) CFG.startDate = ymd(defaultStart(DATA.semester));
  CFG.week = currentWeek();
  store.set(KEY.settings, CFG);
  renderSchedule(); renderGrades(); renderExams(); renderMe(); renderCredit();
  // 该办的事在后台查（十几秒），不挡住首屏。12 小时内不重复查。
  if (res.source !== 'nepu') loadTodo(false);
  // 不 await：课表先画出来。补取是给「考试页切学期」铺路的，
  // 用户可能压根不去考试页，不能为它挡住首屏。
  if (res.source !== 'nepu') prefetchExams();
}

$('btnBind').addEventListener('click', doBind);

/** 有数据但本机没存住密码时的补救入口：学号已知，只补一个密码。 */
$('btnReauth').addEventListener('click', async () => {
  const tip = $('reauthTip');
  const pass = $('inPass2').value;
  const sid = (DATA && DATA.profile && DATA.profile.studentId) || '';
  tip.textContent = '';
  if (!pass) { tip.textContent = '请输入密码'; return; }
  if (!sid) { tip.textContent = '本地没有学号，请用「解除绑定」后重新绑定'; return; }

  const btn = $('btnReauth');
  setBusy(btn, true, '正在登录…');
  try {
    const res = await api('/api/login', { username: sid, password: pass, remember: true });
    if (!res.ok) { tip.textContent = res.error || '登录失败'; return; }
    applyPayload(res);
    $('inPass2').value = '';
    // 🔴 这条路径以前**根本不看 res.saved**，登录成功就喊「已保存」。
    //    存不进去的时候照样报喜，用户下次打开又看到这张卡片 ——
    //    这正是「每次都要输密码」的由来。现在和绑定那条路走同一个判断。
    const sv = credSaved(res);
    if (!sv.ok) {
      BOUND = false;
      CRED_STATE = 'none';
      CRED_ERR = sv.why;
      renderMe();
      tip.textContent = '密码还是没存住：' + sv.why;
      toast('同步成功，但密码没存住', 5000);
      return;                              // 停在「我的」，别把用户送去课表
    }
    BOUND = true;
    CRED_STATE = 'ok';
    CRED_ERR = '';
    toast(sv.soft ? '已保存（备用加密方式），下次打开会自动同步' : '已保存，下次打开会自动同步');
    switchTab('schedule');
  } catch (e) {
    tip.textContent = e.message || envText('连不上电脑上的服务', '连不上教务系统，请检查网络后重试');
  } finally {
    setBusy(btn, false, '保存并同步');
  }
});
$('btnSync').addEventListener('click', () => doSync());
$('schRefresh').addEventListener('click', () => {
  if (!DATA || DATA.source === 'nepu') { doNepuSync(); return; }
  // 课表页的刷新和「我的 → 同步教务处数据」是同一件事：
  // 课表、成绩、考试一起重新拉，不是只刷课表。
  doSync();
});
$('examRefresh').addEventListener('click', () => {
  if (!DATA || DATA.source === 'nepu') { doNepuSync(); return; }
  // 看的是成绩 ⇒ 只能整份同步（成绩是随整份同步下来的，没有单取接口）
  // 成绩没有单取接口，只能整份同步。学校平台的「成绩」那一格才走这条路。
  if (CFG.examView === 'grade') { doSync(); return; }
  // 看的是别的学期就只刷那一个学期；当前学期才走整份同步
  // （整份同步要重登、重取课表成绩，为了看一眼旧学期的考试不值当）
  const curId = (DATA.exams && DATA.exams.semesterId) || '';
  if (examTerm && examTerm !== curId) {
    delete EXAM_ERR[examTerm];
    if (DATA.examsBySem) delete DATA.examsBySem[examTerm];
    loadExamTerm(examTerm);
    return;
  }
  doSync();
});

/* ---------------- 清本地缓存 ----------------
 *
 * 🔴 这里原来只清 `zt.data`（课表/成绩）。0.7.0 加了三个新缓存键之后，
 *    按钮说的和做的就对不上了：用户点「清除本机缓存」，一卡通和公告还是旧的那份。
 *
 * 分两个层次，别混：
 *   · **清缓存**（`clearLocalCaches`）：只扔「能重新拉回来」的数据，
 *     **保留登录状态** —— 清个缓存不该逼人重新输密码。
 *   · **解绑**：在清缓存的基础上，**再清登录状态**（教务 + 门户）。
 *     解绑的确认框写着「会删掉……缓存数据」，而 `resetRooms()` 早就在做
 *     「把别人的数据全扔掉」这件事了 —— 门户不跟着清就不一致。
 */
function clearLocalCaches() {
  cancelPrefetch();
  // 在飞的那几个请求回来时看见代数变了，就不会把数据写回缓存（见 CACHE_GEN）。
  CACHE_GEN += 1;
  // 在用户点进校园页之前，别自动把那几个缓存又取回来 ——
  // 「清除」之后立刻自己写回，按钮就等于摆设（见 loadCampus 开头）。
  CAMPUS.noAuto = true;
  DATA = null;
  store.del(KEY.data);
  store.del(KEY.card);
  store.del(KEY.apps);
  store.del(KEY.notice);
  store.del(NEPU_NOTICE_KEY);
  nepuNoticeCache = null; nepuNoticeError = ''; nepuNoticeSheetToken++;
  renderNepuNotices();
  examTerm = '';
  Object.keys(EXAM_ERR).forEach((k) => { delete EXAM_ERR[k]; });
  resetRooms();

  // 内存里的也要跟着清：只删 localStorage 的话，屏幕上那份还在，
  // 用户会以为「清了个寂寞」，直到下次重启才变。
  CAMPUS.bal = null; CAMPUS.rows = []; CAMPUS.total = 0;
  CAMPUS.apps = []; CAMPUS.at = 0; CAMPUS.fromCache = false;
  NT.all = []; NT.total = 0; NT.sources = 0; NT.at = 0;
  NT.failed = []; NT.err = ''; NT.tried = false; NT.fromCache = false;

  renderSchedule(); renderGrades(); renderExams(); renderMe();
  renderCampus();
  // 公告：tried=false 时 ntPaintState 会整块收起来（不当成「没有记录」），
  // 下次点进公告 tab 会自己重新取。
  renderNepuNotices();
}

/* 解绑教务。抽成具名函数是为了让「账号管理」页也能调它 ——
   抄第二份的话，以后改确认文案/清理范围必定漏一处。 */
async function unbindJw() {
  // 🔴 这里原来写的是 `if (!confirm(...)) return;` —— 在 APK 里 confirm()
  //    不弹框直接返回 false，于是整段代码从来没执行过（按钮形同虚设）。
  //    换成自绘确认框，原因见 askConfirm 上面那段。
  const ok = await askConfirm('解除绑定',
    envText('删掉账号密码与已同步数据，门户一并断开',
      '删掉账号密码与已同步数据，门户一并断开。'),
    '解除绑定');
  if (!ok) return;
  // 🔴 先停后台补取，再去打网络。以前这句放在 await 后面，
  //    而 /api/unbind 一个来回要几百毫秒 —— 这期间补取还会再发下一个学期的
  //    请求，等于「用户已经点了解绑，后台还在拿他的凭据打学校服务器」。
  cancelPrefetch();
  try { await api('/api/unbind', {}); } catch (e) { /* 服务没开也要能解绑本地 */ }
  // 门户单独一套凭据，`/api/unbind` 不管它。这里必须自己断 ——
  // 不断的话，换个人用这台手机，打开「校园」页看到的还是上一个人的一卡通。
  try { await api('/api/portal/logout', {}); } catch (e) { /* 同上，尽力而为 */ }
  CAMPUS.state = 'none'; CAMPUS.user = ''; CAMPUS.open = false;
  CAMPUS.saved = false; CAMPUS.savedUser = '';   // 解绑连门户密码一起清
  clearLocalCaches();
  CFG.startDate = '';
  store.set(KEY.settings, CFG);
  probeBound();                  // 电脑上已经不绑了 ⇒「直接同步」得跟着消失
  toast('已解除绑定');
  renderAccounts();
}
// 0.39.1：这一行原来挂的是「我的」页那个整行红按钮 `#btnUnbind`。
// 入口已收进「我的 → 账号管理 → 教务系统 → 解绑」（那里调的是同一个 unbindJw）。

/** 手机上的存储占用。网页版没有这个接口，返回 null。
 *
 *  为什么要问原生：装完五十多 MB，真正的大头是 WebView 在磁盘上的资源缓存
 *  （办事入口那些学校页面），网页里数不出来 —— localStorage 只有几十 KB，
 *  而且浏览器根本不让 JS 看磁盘。 */
function storageUsage() {
  try {
    if (!window.Android || typeof Android.storageInfo !== 'function') return null;
    const o = JSON.parse(Android.storageInfo() || '{}');
    if (!o || typeof o !== 'object' || !(o.data > 0)) return null;
    return o;
  } catch (e) {
    return null;
  }
}

/** 「清除本机缓存」确认框的正文。有真实占用就把数摆出来 ——
 *  「占 52 MB，其中 48 MB 是缓存」比「会删掉课表」更能让人明白点的是哪一件事。 */
function clearCacheTip(u) {
  if (!u) {
    return envText('只清手机里的缓存，电脑上的账号还留着。',
      '删掉课表、成绩、一卡通、公告，账号保留');
  }
  const cache = (Number(u.webview) || 0) + (Number(u.cache) || 0);
  const apk = Number(u.apk) || 0;
  const all = Number(u.total) || (Number(u.data) || 0) + apk;
  const tail = envText('电脑上的账号还留着。', '账号还留着，不用重新绑定。');
  if (cache < 1024 * 1024) {
    return '现在占 ' + fmtBytes(all) + '，没什么可清的。清掉课表、成绩这些缓存后，' +
      '下次进来会重新同步。' + tail;
  }
  return '现在占 ' + fmtBytes(all) + '，其中 ' + fmtBytes(cache) +
    ' 是网页图片和脚本，能重新下回来。\n\n清掉会腾出空间，只是下次打开慢一点。' + tail;
}

/** 清本机缓存。
 *
 *  2026-11-10 晚（第三版）从「我的」第一屏搬进「关于本项目」弹层最底下。
 *  用户原话：「别把清理本机缓存和反馈放到一块了，清理本机缓存平常很少用，
 *  你放深一些」。搬不是删：课表错乱、页面样式没更新时，它还是唯一的路。
 */
async function clearCacheAsk() {
  // 同上：confirm() 在 WebView 里不弹框，换成自绘的
  // 标题和按钮同名（按钮是「清除本机缓存」）。差一个字会让人怀疑
  // 点的是不是同一件事 —— 而这两个按钮就在同一页上下两行。
  const ok = await askConfirm('清除本机缓存', clearCacheTip(storageUsage()), '清除');
  if (!ok) return;
  // 🔴 必须走 clearLocalCaches()，不能在这儿手抄一遍删除语句 ——
  //    0.7.0 加了三个缓存键，抄漏了按钮就名不副实（清完一卡通还是旧的）。
  //    这里**不清登录状态**：清缓存不该逼人重新输密码。
  clearLocalCaches();
  // 0.43.0：再清磁盘上那几十 MB。以前这里只删 localStorage（几十 KB），
  // 用户点完「清除缓存」到系统设置里一看，占用一点没变 —— 按钮名不副实。
  // 不动 cookie / localStorage，所以不会掉登录，只是下次打开学校页面要重下资源。
  let freed = false;
  try {
    if (window.Android && typeof Android.clearWebCache === 'function') {
      Android.clearWebCache();
      freed = true;
    }
  } catch (e) { /* 清不掉就说没清缓存，别谎报 */ }
  toast(freed ? '已清除，空间会在几秒后释放' : '已清除，下次进来会重新同步');
}

$('goBind').addEventListener('click', doNepuLogin);
$('goBind2').addEventListener('click', () => switchTab('accounts'));
$('goBind3').addEventListener('click', () => switchTab('accounts'));
$('goBind4').addEventListener('click', () => switchTab('me'));
$('exRetry').addEventListener('click', () => {
  const sid = examTerm;
  delete EXAM_ERR[sid];
  loadExamTerm(sid);
});

// -- 空闲教室
$('rmGo').addEventListener('click', () => queryRooms());
$('rmRefresh').addEventListener('click', () => {
  if (!DATA) { toast('先绑定账号'); return; }
  queryRooms();
});
$('rmRetry').addEventListener('click', () => queryRooms());
$('rmFilterRow').addEventListener('click', () => {
  ROOM.filterOpen = !ROOM.filterOpen;
  renderRoomFilter();
  // 展开的时候顺手把筛选项拉回来（上次可能因为没网失败了）
  if (ROOM.filterOpen && !ROOM.opts) loadRoomOptions();
});
$('rmDate').addEventListener('change', () => {
  const v = $('rmDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;   // 用户点了取消
  if (v === ROOM.date) return;
  ROOM.date = v;
  roomChanged();
});

// ------------------------------------------------------------------ 已绑探测

/** 学号打码：2023123456 -> 2023****56
 *  屏幕可能被别人看到，也避免截图外传，所以只露头尾。
 *  （能拿到 token 的人本来就有权限，打码只是防「路过看一眼」）
 */
function maskUid(s) {
  s = String(s || '');
  if (s.length <= 6) return s ? s.slice(0, 1) + '****' : '';
  return s.slice(0, 4) + '****' + s.slice(-2);
}

/** 按运行环境替换文案。
 *
 *  HTML 里用 data-web / data-app 两个属性写两套说法，这里挑一套塞回去。
 *  为什么不用两套 HTML：两边共用一份界面，改一次就够，不会漂。
 */
function applyEnvTexts() {
  if (!NATIVE) return;                     // 网页版就用 HTML 里默认那套
  document.querySelectorAll('[data-app]').forEach((el) => {
    el.textContent = el.dataset.app;
  });
}

/** 问一下本地数据层：这台机器绑过账号没有。
 *
 *  场景：换了手机、清了浏览器缓存 —— 手机里没数据了，但电脑上的凭据还在。
 *  以前这种情况只能把密码再输一遍，其实没必要。
 *
 *  🔴 这里问的是「本机存住凭据了吗」，和「本地有课表数据吗」是两件事。
 *     两者可能不一致：数据在、密码没存（Keystore 失败 / 老版本没存）。
 *     所以结果存进 BOUND，让 renderMe 决定要不要提示「重新输入密码」。
 */
async function probeBound() {
  let st = null;
  try {
    st = await api('/api/state');
  } catch (e) {
    BOUND = null;                            // 服务没开：状态未知，别乱提示
    CRED_STATE = null;
    return;
  }
  BOUND = !!(st && st.ok && st.bound);
  // 服务没给 credState（老版本 bridge）⇒ 只知道自己没绑，不知道是哪种没绑
  CRED_STATE = (st && st.credState) ? String(st.credState) : (BOUND ? 'ok' : null);
  if (BOUND) CRED_ERR = '';                  // 存住了，上一次的失败原因就没意义了
  document.querySelectorAll('.quickbox').forEach((el) => { el.hidden = !BOUND; });
  if (BOUND) {
    document.querySelectorAll('.qwho').forEach((el) => { el.textContent = maskUid(st.username); });
  }
  // 🔴 0.46.0：课表空态要跟着重画一次。
  //    probeBound 是**不 await** 的（别挡住首屏），所以首屏 renderSchedule 跑的时候
  //    BOUND 还是 null，空态只能按「没绑」画 —— 于是已绑定的人第一眼看的是
  //    「还没绑定教务处账号 / 去绑定」。等这里问回来，必须让那一屏重算一遍，
  //    否则它就一直停在错的那句话上（用户 2026-11-06 报的就是这个）。
  if (CUR_PAGE === 'schedule') renderSchedule();
  renderMe();                                // 凭据状态变了，提示卡要跟着变
}

$('btnQuick').addEventListener('click', () => { doSync(true); });
$('goQuick').addEventListener('click', () => { switchTab('me'); doSync(true); });
if ($('btnUpdate')) $('btnUpdate').hidden = true;

/* ---------------- 关于本项目（0.41.0） ----------------
 *
 * 用户 2026-11-02：「我的 加上 关于本项目 的这一栏，里面写上本项目参考的项目
 * 及对应链接，再加上我的联系方式（话说这样会有风险吗）」。
 *
 * 🔴 这里每一句都必须是**用户能自己核对的事实**：谁做的、什么许可、用了它的
 *    什么、点开去哪。不写「实现了什么协议」「调了哪些接口」——用户不需要，
 *    而且把「照着做了什么」写细，只会给对方添麻烦。
 * 🔴 链接一律走 openExternal：APK 里交系统浏览器，网页版新开标签。
 *    这样两个版本行为一致（WebView 里直接跳会把 App 变成那个网站）。
 * 🔴 2026-11-25（用户明确要求）：原来那三条「参考的项目」署名、它们各自的
 *    「查看项目」/「在 GitHub 打开」跳转，连同整个二级页面都删掉了。
 *    这里原来写着「参考项目清单只增不删」—— 那条规矩**已经被用户推翻**，
 *    别再照它把清单加回来。署名的事现在只剩仓库根目录的 LICENSE 和 README
 *    （MIT 的版权与许可声明在那边随分发保留）。
 */
/* GitHub 仓库（用户 2026-11-14：「加上咱们的 github 项目地址跳转链接，
 * 要求跳转到系统默认浏览器，在 APP 里面求 star」）。
 *
 * 🔴 2026-11-25：地址换成 dsy-star/NepuPass（用户：「把 Github 的链接替换为
 *    https://github.com/dsy-star/NepuPass」）。同一次还要求把关于页里那两颗
 *    跳转按钮删掉，所以这个常量现在**只剩「求 Star」弹窗一处在用**。
 * 🔴 一律走 openExternal ⇒ 交系统浏览器。APK 里塞进 WebView 会让
 *    App 变成 GitHub 的页面，而且没法登录点赞。 */
const ABOUT_GH = 'https://github.com/dsy-star/NepuPass';
/* ---------------- 联系方式：只认本机，不去远端取 ----------------
 *
 * 这一页现在不联网（`aboutFetch()` 直接回 null）。原来它会去站点上取一份
 * `about.json`，但那个站点是旧项目的基础设施，随仓库分离一并下线了。
 * 下面这套清洗函数（aboutClean / aboutSafeUrl / aboutContactHtml）保留着：
 * 哪天重新接上远端数据，仍然走同样的三层校验 ——
 * 远端内容是**不可信输入**，它会被拼进 innerHTML（类型 → 长度 → 协议和域名）。
 */

const ABOUT_CACHE = 'hyt.about.v1';   // 上次从站上拿到的，下次先拿它顶上
const ABOUT_WAIT = 4000;              // 4 秒没回来就不等了，用手上这份
// 包里那份兜底：没有联系方式（整块不出现），也没有额外那句提示。
const ABOUT_FALLBACK = { contact: null, notice: '' };
// 链接只认这几个站。白名单比黑名单可靠 —— 谁把 about.json 换成了
// `javascript:` 或者一个钓鱼站，用户点「打开」就中招了。
const ABOUT_HOSTS = ['qm.qq.com', 'github.com', 'cnb.cool'];

// 2026-11-25：ABOUT_REFS（「参考的项目」那三条署名、以及它们各自的
// 「查看项目」/「在 GitHub 打开」跳转）按用户要求整块删掉了，二级页面
// aboutRefsHtml 和 aboutView 那个状态一起下线。关于页现在只有一屏。

/** 远端来的地址：只放 https，而且只认白名单里的站（含子域）。
 *  返回 '' 表示这个链接不能用 —— 调用方据此**不画那颗按钮**，
 *  而不是画一个点了报错的按钮。 */
function aboutSafeUrl(u) {
  u = String(u || '').trim();
  if (!/^https:\/\//i.test(u)) return '';
  let host = '';
  try { host = new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
  for (let i = 0; i < ABOUT_HOSTS.length; i += 1) {
    const d = ABOUT_HOSTS[i];
    if (host === d || host.slice(-(d.length + 1)) === '.' + d) return u;
  }
  return '';
}

/** 把远端那份 json 洗成能用的形状。**一个字段都不直接信。**
 *  长度上限不是洁癖：一段 10 万字能把弹层撑爆，也能让屏幕看起来像坏了。 */
function aboutClean(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const c = (o.contact && typeof o.contact === 'object') ? o.contact : {};
  const cut = (v, n) => String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  const label = cut(c.label, 12);
  // 群号只留「像群号的东西」：数字为主，允许字母和 - _（有些群号是字母开头）。
  // 这一步同时挡住了把 HTML 标签当群号塞进来的路子。
  const id = cut(c.id, 32).replace(/[^0-9A-Za-z_-]/g, '');
  const join = aboutSafeUrl(c.join);
  return {
    contact: id ? { label: label || 'QQ 群', id: id, join: join } : null,
    notice: cut(o.notice, 100),
  };
}

/** 本机存着的那份。读不到就是 null（不算错）。 */
function aboutCached() {
  try {
    const raw = localStorage.getItem(ABOUT_CACHE);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return aboutClean(o && o.data);
  } catch (e) { return null; }
}

/** 去站上取一次。拿不到一律返回 null —— 这个功能**不许有错误提示**：
 *  用户点「关于」是为了看署名，不是来看「网络异常的」。 */
function aboutFetch() {
  return Promise.resolve(null);
}

/** 「联系我」那一块。**没有群号必须返回空串**，不能返回一个只有标题的空壳 ——
 *  用户会以为「联系方式这一栏坏了」。
 *  参数既可以是字符串（老的喂法，也方便判据直接喂），也可以是对象。 */
function aboutContactHtml(c) {
  const o = (typeof c === 'string') ? { id: c } : (c || {});
  const id = String(o.id || '').trim();
  if (!id) return '';
  const label = String(o.label || 'QQ').trim() || 'QQ';
  const join = aboutSafeUrl(o.join || '');
  // 「群」和「个人号」是两种东西：一个说「进来说」，一个说「加我说」；
  // 按钮写「复制群号」还是「复制 QQ 号」也不一样。
  // 靠 label 里有没有「群」这个字判断就够，不用再加一个字段 ——
  // 多一个字段就多一处能填错的地方。
  const isGroup = label.indexOf('群') >= 0;
  return '<div class="ab-hd">联系我</div>'
    + '<div class="ab-item">'
    + '<div class="ab-name">' + esc(label) + ' ' + esc(id) + '</div>'
    + '<p>' + (isGroup
        ? '有问题或想加功能，请在群里反馈'
        : '有问题或想加功能，请加 QQ 反馈')
    + '</p>'
    + '<button class="ab-go" id="abCopyQq">复制' + (isGroup ? '群号' : ' QQ 号')
    + '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>'
    + (join ? '<button class="ab-go" data-url="' + escAttr(join) + '">直接加群'
        + '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>' : '')
    + '</div>';
}

/** 弹层正文。抽成纯函数有两个用处：
 *  ① 内容没变就不重画 —— 重画会把用户正在看的滚动位置弹回顶部；
 *  ② 判据可以直接比字符串，不用去数 DOM。
 *
 *  🔴 0.44.0 调过顺序（用户 2026-11-03：自己的项目、网站放前面，
 *     「参考的项目」压成一行点开再看）。2026-11-25 那份清单整个删了，
 *     现在这一屏是：这是什么 → 联系方式 → 清除本机缓存。
 */
function aboutHtml(state) {
  const st = state || ABOUT_FALLBACK;

  return '<div class="sh-title">关于本项目</div>'
    + '<div class="sh-sub">学生自制的校园助手：免费、无广告</div>'
    + (st.notice ? '<div class="ab-tip">' + esc(st.notice) + '</div>' : '')
    + '<div class="ab-hd">这个项目</div>'
    + '<div class="ab-item">'
    + '<div class="ab-name">东油通</div>'
    + '<p>面向东北石油大学的本地校园助手。</p>'
    + '</div>'
    + aboutContactHtml(st.contact)
    // 2026-11-25：这里原来有一行「参考的项目 N 个」，点开是二级页面。
    // 用户要求把那一屏连同「查看项目」「在 GitHub 打开」两颗按钮一起删掉，
    // 所以整行没了 —— 关于页现在只有这一屏，滚到底就是「清除本机缓存」。
    // 2026-11-10 晚（第三版）：「清除本机缓存」搬到这里 —— 用户原话
    // 「清理本机缓存平常很少用，你放深一些」。现在要两步才点得到
    // （我的 → 关于本项目 → 最底下），配得上「一年点不了两次」这个频率。
    // 🔴 比匿名上报还深一格：上报关掉只是不发数据，可逆；清缓存不可撤销 ——
    //    课表、成绩、一卡通都得重下一次，校园网还可能得重新登录。
    // 🔴 id 仍然是 btnClearCache：五套判据按这个 id 找它，
    //    改了 id 那几条会静默变成「找不到就跳过」。
    + '<div class="ab-more">'
    + '<button class="ab-more-b" id="btnClearCache">清除本机缓存</button>'
    + '</div>';
}

/** 当前手上这份内容（缓存先、网络后）。
 *  2026-11-25 之前还有 `aboutView`（'main' / 'refs'）管着两屏，二级页面
 *  下线之后它没有用处了 —— 留着只会让人以为还有别的屏。 */
let aboutCur = ABOUT_FALLBACK;

/** 按当前内容重画。**只有这一个地方动 `#sheetBody`** —— 多写一遍就会
 *  忘一处重绑（点了没反应，而且不报错）。 */
function aboutPaint() {
  const sc = $('sheetBody');
  const keep = sc.scrollTop;
  sc.innerHTML = aboutHtml(aboutCur);
  aboutBind();
  // 重画后把位置还回去，别让人自己再滚一次（联系方式刷新一下不该把人弹回顶部）。
  sc.scrollTop = keep;
}

/** 「我的」那行右边的灰字跟着变。写了「联系方式」却没有联系入口就是空话，
 *  而「暂时没填」是允许的状态（用户随时可能换群）。
 *  2026-11-25：这行字原来写的是「网站 · 源码 · 参考的项目」，可那三样现在
 *  一样都不在这一页里了 —— 关于页只剩「这个项目 + 联系方式 + 清缓存」。
 *  所以只留「联系方式」（有才写），不再替页面许诺它没有的东西。 */
function aboutSummary(state) {
  const v = document.querySelector('#rowAbout .v');
  if (!v) return;
  const st = state || ABOUT_FALLBACK;
  v.textContent = (st.contact && st.contact.id) ? '联系方式' : '';
}

function aboutBind() {
  const body = $('sheetBody');
  body.querySelectorAll('.ab-go[data-url]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!openExternal(b.getAttribute('data-url'))) {
        toast('打不开浏览器，可以复制链接手动打开');
      }
    });
  });
  // 复制群号：手机上点一下就能粘到 QQ 里。复制不了就说清楚怎么办，
  // 不能只丢一句「失败」（群号就在上面一行，长按能选中）。
  const cq = $('abCopyQq');
  if (cq) {
    cq.addEventListener('click', () => {
      const now = aboutCached() || ABOUT_FALLBACK;
      const id = (now.contact && now.contact.id) || '';
      if (wtCopy(id)) toast('已复制');
      else toast('无法复制，请长按上方号码手动选择');
    });
  }
  // 2026-11-25：这里原来绑着「进 / 出参考的项目二级页面」两颗按钮（#abRefs
  // 和 #abBack）。那一屏已经删了，绑定的节点不存在，所以一并去掉。
  // 「清除本机缓存」现在住在这一层（2026-11-10 第三版）。它每次重画都是新节点，
  // 所以只能在这里绑 —— 写成文件顶层的 $('btnClearCache') 会在第一屏找不到它。
  const cc = $('btnClearCache');
  if (cc) cc.addEventListener('click', clearCacheAsk);

}

/** 打开「关于本项目」。
 *
 *  顺序是有意的：**先画手上有的，再去取新的**。
 *  反过来（等网络回来再画）在弱网下就是一个空白弹层转 4 秒 ——
 *  而这一页的内容（署名、免责）本来就不依赖网络。 */
async function openAboutSheet() {
  const old = aboutCached();
  aboutCur = old || ABOUT_FALLBACK;
  aboutPaint();
  const sheet = $('sheetMask');
  sheet.hidden = false;
  aboutSummary(aboutCur);

  const fresh = await aboutFetch();
  if (!fresh) return;                     // 没拉到就保持现状，一个字都不提示
  // 内容一模一样就别重画：会把已经滚到下面的人弹回顶部
  if (aboutHtml(fresh) === aboutHtml(aboutCur)) { aboutCur = fresh; aboutSummary(fresh); return; }
  aboutCur = fresh;
  aboutSummary(fresh);
  if (sheet.hidden) return;               // 已经关掉了，别往空壳里写
  aboutPaint();
}

$('rowAbout').addEventListener('click', openAboutSheet);

/* ================= 求一次 Star（2026-11-25） =================
 *
 * 用户：「有一个弹窗是使用多次了给我点个 star，里面的两个按钮一个是
 * 下次再说一个是去 star，打开 Github，把 Github 的链接替换为
 * https://github.com/dsy-star/NepuPass」。
 *
 * 三条规矩（结论沿用 2026-11-14 那版 —— 那份实现随 app.js 重写丢了，
 * 这次按原意重新落地）：
 *   ① **只问一次**。答过（点了或跳过）就 `CFG.starAsked=true` 落盘，永不再弹。
 *      反复问是最快让人卸载的做法，而这一句本来只是想道个谢；
 *   ② 只问**已经用起来的人**：打开过 3 次以上、而且课表已经同步到了。
 *      第一次打开就伸手是要糖，不是道谢；
 *   ③ 走 App 自己的弹层（`#sheetMask`），不用原生弹窗 / Toast —— 别处长什么样，
 *      它就长什么样，用户不用学第二套。
 *
 *  ⚠️ 时机放在首屏画完 4 秒之后：开机那一下正在排闹钟、补作业考试，
 *     这时候盖一张卡上去，用户第一反应是「怎么一打开就推销」。
 *  🔴 链接一律走 openExternal（交系统浏览器）：APK 里塞进 WebView 会变成
 *     GitHub 的页面，而且没法登录点赞。
 */
function starAskOnce() {
  if (CFG.starAsked) return;                  // ① 只问一次
  if ((CFG.launchN || 0) < 3) return;         // ② 才算「使用多次了」
  if (!DATA || !(DATA.courses || []).length) return;
  // 正在看别的弹层（关于 / 消息 / 确认框）就别抢：等下次打开再说。
  // 🔴 这里**不置** starAsked —— 这不算回答，只是这一趟没空。
  if (!$('sheetMask').hidden) return;
  CFG.starAsked = true;
  store.set(KEY.settings, CFG);
  $('sheetBody').innerHTML =
    '<div class="sh-title">这个 App 帮上忙了吗</div>' +
    '<div class="sh-sub">学生自己做的，免费、无广告。' +
      '在 GitHub 上标一颗 Star，就是最好的支持。</div>' +
    '<div class="sheetbtns">' +
    '<button class="btn" id="starNo">下次再说</button>' +
    '<button class="btn primary" id="starYes">去 star</button>' +
    '</div>';
  $('sheetMask').hidden = false;
  $('starNo').addEventListener('click', closeSheet);
  $('starYes').addEventListener('click', () => {
    closeSheet();
    if (!openExternal(ABOUT_GH)) toast('打不开浏览器，可以复制链接手动打开');
  });
}

/* 更新设置从版本行下方进入：自动开关、检查频率和手动检查都放在同一张 sheet。 */
function renderUpdSettingsState() {
  const last = $('meUpdLast');
  if (last) last.textContent = CFG.updOn
    ? '自动检查已开启 · ' + (UPD_FREQ_CN[CFG.updFreq] || UPD_FREQ_CN.daily)
    : '自动检查已关闭';
}

function openUpdSettingsSheet() {
  const on = !!CFG.updOn;
  const freq = UPD_FREQ_SEC[CFG.updFreq] != null ? CFG.updFreq : 'daily';
  $('sheetBody').innerHTML =
    '<div class="sh-title">检查更新</div>' +
    '<div class="sh-sub">当前版本 v' + esc(MYVER) + ' · ' + esc(updAgo(CFG.updLast)) + '</div>' +
    '<div class="upd-setting-row"><span>自动检查更新</span>' +
      '<button type="button" class="upd-toggle' + (on ? ' active' : '') + '" id="updAutoToggle" role="switch" aria-checked="' + on + '"><i></i></button></div>' +
    '<div class="upd-setting-label">间隔</div>' +
    '<div class="upd-freq" role="group" aria-label="自动检查间隔">' +
      UPD_FREQ_LIST.map((key) => '<button type="button" data-upd-freq="' + key + '" class="' + (freq === key ? 'active' : '') + '" aria-pressed="' + (freq === key) + '">' + UPD_FREQ_CN[key] + '</button>').join('') +
    '</div>' +
    '<div class="sheetbtns upd-settings-actions"><button type="button" class="btn primary" id="updCheckNow">立即检查</button></div>';
  $('sheetMask').hidden = false;
  $('updAutoToggle').addEventListener('click', (e) => {
    CFG.updOn = !CFG.updOn;
    store.set(KEY.settings, CFG);
    openUpdSettingsSheet();
    renderUpdSettingsState();
  });
  $('sheetBody').querySelectorAll('[data-upd-freq]').forEach((button) => {
    button.addEventListener('click', () => {
      CFG.updFreq = button.dataset.updFreq;
      store.set(KEY.settings, CFG);
      openUpdSettingsSheet();
      renderUpdSettingsState();
    });
  });
  $('updCheckNow').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.disabled) return;
    b.disabled = true;
    b.textContent = '检查中…';
    try {
      const r = await checkUpdate(true);
      if (!r || !r.ok) toast((r && r.error) || '更新服务暂时不可用', 2600);
      else if (!r.newer) toast('已经是最新版本 v' + MYVER, 2000);
    } catch (_) {
      toast('检查更新失败，稍后再试', 2600);
    } finally {
      b.disabled = false;
      b.textContent = '立即检查';
    }
  });
}

$('meUpd').addEventListener('click', openUpdSettingsSheet);

/* ================= 权限自检（我的 → 权限，2026-11-15） =================
 *
 * 用户：「在我的界面加一个能看东油通需要的权限是否都打开的界面，方便查看」。
 *
 * 为什么需要这一页：这个 App 最要紧的两件事 —— 到点提醒、后台自动跑 ——
 * 全靠系统放行。而国产 ROM 的省电策略会在装完几天后把它悄悄掐掉，
 * 用户唯一的症状是「今天怎么没提醒我」，App 里没有任何地方能看出是这个原因。
 *
 * 🔴 只**读**状态、只**跳**设置，绝不替用户改：没有任何公开 API 能打开
 *    自启动或关掉省电限制，偷偷绕过去的做法不能用在要上架的 App 里。
 * 🔴 读不到的项写「看不出来」，绝不写「没开」—— 这两句话对用户的意思相反，
 *    而「没读到」被说成「没有」正是这个项目最不能犯的错。
 */
function permApi() {
  const n = window.NativeApi;
  if (!n || typeof n.permState !== 'function') return null;
  try { return n.permState(); } catch (e) { return null; }
}

/** 这一页上的几行。`state` 只有三种：ok / bad / unk（看不出来）。 */
function permRows(st) {
  const rows = [{
    k: '通知',
    state: st.notify === true ? 'ok' : 'bad',
    text: st.notify === true ? '能收到提醒' : '收不到作业提醒和签到通知',
    w: 'notify', btn: '去打开',
  }];
  // 精确闹钟只有 Android 12 起才有这个开关。没有这一项的系统不画 ——
  // 画一行「已开启」等于替系统说了一句它没说过的话。
  if (st.alarmKnown) {
    rows.push({
      k: '精确闹钟',
      state: st.alarm === true ? 'ok' : 'bad',
      text: st.alarm === true ? '到点准点响' : '提醒可能晚几分钟',
      w: 'alarm', btn: '去打开',
    });
  }
  rows.push({
    k: '省电限制',
    state: st.battery === true ? 'ok' : 'bad',
    text: st.battery === true ? '不会在后台被停' : '系统可能在后台把它停掉',
    w: 'battery', btn: '去设置',
  });
  // 自启动查不到（没有公开 API，厂商各写各的）。这一行只说两件事：
  // 我们看不出来、去哪儿自己看。
  rows.push({
    k: '自启动',
    state: 'unk',
    text: '系统不公开，要自己去确认',
    w: 'auto', btn: '去设置',
  });
  // 后台任务：和上面几条不是一回事 —— 权限全开、开关没开也照样一次不跑。
  // 这一项直接问系统（JobScheduler 里还有没有我们的一单），比看配置可信。
  rows.push({
    k: '后台任务',
    state: st.job === true ? 'ok' : (st.jobCx === false && st.jobWt === false ? 'bad' : 'unk'),
    text: st.job === true ? '已排上' : '没排上 · 到「我的 → 后台」打开',
    w: '', btn: '',
  });
  return rows;
}

function renderPerm() {
  const box = $('permBody');
  if (!box) return;
  const st = permApi();
  if (!st) {
    box.innerHTML = '<p class="tip note">这一页要在装好的 App 里看。' +
      '网页版没有系统权限这回事。</p>';
    if ($('permFoot')) $('permFoot').hidden = true;
    return;
  }
  const rows = permRows(st);
  const bad = rows.filter((r) => r.state === 'bad').length;
  let h = '<div class="perm-sum ' + (bad ? 'has' : 'ok') + '">' +
    (bad ? '<b>' + bad + '</b> 项没开' : '该开的都开了') +
    '<span>改动都在手机设置里，回来时会重新看</span></div>';
  h += rows.map((r) => '<div class="perm-row">' +
    '<span class="perm-k">' + esc(r.k) + '</span>' +
    '<span class="perm-s ' + r.state + '">' + esc(r.text) + '</span>' +
    // 已经开着的那几行不再挂「去打开」：那一行没有可做的事，
    // 挂一颗按钮只会让人以为还有哪一步没完成。
    (r.w && r.state !== 'ok'
      ? '<button class="perm-go" data-perm="' + r.w + '">' + esc(r.btn) + '</button>' : '') +
    '</div>').join('');
  box.innerHTML = h;
  box.querySelectorAll('[data-perm]').forEach((b) => {
    b.addEventListener('click', () => {
      const why = permOpen(b.dataset.perm);
      if (why) toast(why);
    });
  });
}

function permOpen(what) {
  const n = window.NativeApi;
  if (!n || typeof n.permOpen !== 'function') return '这个版本打不开系统设置';
  let why = 'none';
  try { why = String(n.permOpen(what) || ''); }
  catch (e) { why = '打不开系统设置'; }
  if (why === 'none') return '这个版本打不开系统设置';
  return why;
}

/** 「我的」页那颗「权限」入口。只在能读到状态的壳里出现 ——
 *  网页版点了只会得到一句「看不到」，那不如不出现。 */
function renderPermEntry() {
  const b = $('rowPerm');
  if (!b) return;
  b.hidden = !permApi();
}

$('rowPerm').addEventListener('click', () => { renderPerm(); switchTab('perm'); });
$('permBack').addEventListener('click', () => { switchTab('me'); });
// 从系统设置回来 ⇒ 重新看一遍。不重看的话，用户明明刚打开通知，
// 回来这一页还写着「收不到提醒」—— 那会让他以为设置没生效。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && CUR_PAGE === 'perm') renderPerm();
});

/* Campus account, service portal, and reference-page bindings. */

// 这一行右边的灰字在**开机时**就要对：用户可能先看到「我的」页，
// 再决定点不点进去。等打开弹层才更新的话，那里会先空着（或写着旧的
// 「… · 参考的项目」），然后在他眼前变一次 —— 一次没必要的跳动。
aboutSummary(aboutCached());
// 校园公告和校园服务从「校园」页进入；服务仍作为独立二级页呈现。
$('cpMoreToggle').addEventListener('click', () => { switchTab('services'); });
$('svBack').addEventListener('click', () => { switchTab('wiki'); });
$('cpOpenPortal').addEventListener('click', () => {
  const url = 'https://portal.nepu.edu.cn/#/index4';
  if (window.Android && typeof Android.openPortal === 'function') {
    const result = Android.openPortal();
    if (result !== 'ok') toast('暂时打不开学校门户');
    return;
  }
  window.open(url, '_blank', 'noopener');
});

/* ---------------- 要去微信里办（2026-11-16） ----------------
 *
 * 用户：「我们学校还有很多功能是分布在公众号上的，去看看能不能把他们也
 * 找出来，然后兼容进来」。
 *
 * 2026-11-16 清点了一遍，结论是**这四件事接不进来**，原因各不相同：
 *   · 空调电费 —— 缴费走微信公众号内的微信支付，没有对外的查询接口；
 *   · 宿舍报修 —— 同样在公众号里登录（学号 + 初始密码），系统是 SPA，
 *                只在维修那几天用一次；
 *   · 图书馆座位 —— 「高校鸿芒」平台，签到要扫馆内屏幕的**动态二维码**，
 *                而且取消关注公众号会直接释放座位 ⇒ 只能在微信里用；
 *   · 图书馆借阅 —— 门户是动态渲染的站点，登录接口要逆向它的前端包，
 *                图书馆系统改版又频繁，接了也是每个月修一次。
 *
 * 🔴 所以这里**不假装成功能**：点开是步骤，不是数据。
 *    写「电费还剩 12.4 元」会是编的 —— 我们根本没有这个接口。
 * 🔴 为什么不干脆不做：这四件事以前**连去哪办都没地方看**，用户只能翻
 *    聊天记录找公众号。写清「搜什么、点哪一步」已经解决了大半问题，
 *    而且零维护、零风控。
 * 🔴 图书馆那行是唯一能直接打开的：官网 https 可访问，走 openWeb。
 *    其余三行的地址在微信里，浏览器打不开，给「复制公众号名」比给链接有用。
 */
function dirSheet(title, sub, steps, copyName) {
  let h = '<div class="sh-title">' + esc(title) + '</div>' +
          '<div class="sh-sub">' + esc(sub) + '</div>' +
          '<ol class="howto">';
  steps.forEach((s) => { h += '<li>' + esc(s) + '</li>'; });
  h += '</ol>';
  if (copyName) {
    h += '<button class="btn block" id="dirCopy">复制公众号名</button>';
  }
  h += '<div class="sheetbtns">' +
       '<button class="btn primary" id="dirOk">知道了</button></div>';
  $('sheetBody').innerHTML = h;
  $('sheetMask').hidden = false;
  if (copyName) {
    $('dirCopy').addEventListener('click', () => {
      // 🔴 复制不上要说怎么手动来。只说「复制失败」，用户下一步还是不知道搜什么。
      if (wtCopy(copyName)) toast('已复制，去微信搜索框粘贴');
      else toast('复制不了，手动输入：' + copyName, 3200);
    });
  }
  $('dirOk').addEventListener('click', () => { $('sheetMask').hidden = true; });
}

// ---- 缴费平台
// 🔴 东油通**没有**接缴费平台：`PAY_URL` 留空，界面上那格点开只会提示。
//    上一代产品接过郑航的「校园统一支付平台」（学费/住宿费欠费、电费充值），
//    那套地址和登录态在这里都不通用，删掉了，留着空字符串当开关即可。
//    真要接东油的缴费入口，先确认学校有没有、地址是什么，再填进来 ——
//    别照抄别校的地址：点开一个 404 比不给入口更糟。
const PAY_URL = '';

// 公告使用 NEPU 教务会话与独立缓存。
$('ntEnter').addEventListener('click', () => { switchTab('notice'); });
$('nepuNoticeSync').addEventListener('click', syncNepuNotices);
$('nepuNoticeList').addEventListener('click', e => {
  const row = e.target.closest('[data-notice-id]');
  if (!row) return;
  const it = Nepu.normalizeNotices(nepuNoticeCache && nepuNoticeCache.items).find(n => n.id === row.dataset.noticeId);
  if (it) openNepuNotice(it);
});
renderNepuNotices();
// 没登慧生活时那颗按钮：账号在「我的 → 账号管理」，直接把人送过去并展开设备登录。
$('wtGoLogin').addEventListener('click', () => {
  // 「重试」= 这一页没读到登录状态，重读一次就行，别把人拖去登录页
  if ($('wtGoLogin').dataset.act === 'retry') { renderWater(); return; }
  // 记住从哪来：登完要送回这一页（见 wtLogin）。这里必须**先记再切** ——
  // 切过去之后 CUR_PAGE 就是 'accounts' 了，那时再问「从哪来」只会得到
  // 「账号管理」，人就永远回不去功能页。
  WT.loginBack = CUR_PAGE;
  switchTab('accounts');
  if (!WT.accounts.device) wtOpenLogin('device');
});
$('wtCapNew').addEventListener('click', () => { wtNewCaptcha(); });
// 点图也能换一张。图和「看不清？换一张」是同一个动作 —— 用户看图第一反应
// 是点图，不是找链接。
$('wtCapImg').addEventListener('click', () => { wtNewCaptcha(); });
// 图挂了也要给个交代：静默失败的话用户看到的是一个空框，不知道是网慢还是坏了。
// 🔴 这里**不能**自动重新拉 —— 会和 wtNewCaptcha 打成一个循环（每张图都挂就
//    无限请求）。只提示，让用户自己点。
$('wtCapImg').addEventListener('error', () => {
  $('wtCapImg').classList.add('bad');
  wtTip('图形验证码未加载，点击更换', true);
});
$('wtSend').addEventListener('click', () => { wtSendSms(); });
$('wtLogin').addEventListener('click', () => { wtLogin(); });
// 慧生活的两行现在和别的账号在同一张卡里（见 renderAccounts 的
// `data-acc="wt-device|-wt-score"`），点击统一走 #accList 那条监听。
$('wtLoginCancel').addEventListener('click', () => { wtCancelLogin(); });
// 刷新 = 刷新**这一页**（余额设备 + 积分 + 任务 + 账单），不是只刷余额。
// 只刷一半的话，用户看到「余额变了、积分还是刚才那个数」，会以为积分不更新。
// 0.27.0 起页头只有一颗刷新（直饮水并进功能页了），它两样都刷。
$('wtOpenApp').addEventListener('click', () => { openWater(); });
// 0.39.1：「退出登录」整行删了，改由「账号管理」里设备/积分各自的「退出」承担
// （`wtAccTap` → `wtLogout(kind)`）。这一页只留常用动作。
// 「重新登录」不跳别处，就在本页把表单换出来 —— 手机号还在，只要再收条短信。
$('wtRelogin').addEventListener('click', () => { wtOpenLogin(WT.expiredKind || 'device'); });
// 0.24.0：一键完成任务 / 加载更多账单 / 停止接水（2026-11-10 起「停止」
// 不再是一颗固定按钮 —— 它就是设备行上那颗「接水」变成的，见 wtPaintDevs）
$('wtRunAll').addEventListener('click', () => { wtRunAll(); });
// 0.50.0 v5：后台自动的入口（和学习通那一头是同一个弹层，见 openAutoSheet）
if ($('wtAuto')) $('wtAuto').addEventListener('click', () => openAutoSheet());
// 0.33.0：任务明细默认收起（一屏的预算），点标题行展开。
// 🔴 只折叠**明细**，不折「一键完成」—— 收起不是让操作多一步。
$('wtTaskOpen').addEventListener('click', () => {
  const box = $('wtTaskBox'), hd = $('wtTaskOpen');
  const open = box.hidden;
  box.hidden = !open;
  hd.setAttribute('aria-expanded', open ? 'true' : 'false');
});
// 「停下」只置标记，真正退出发生在下一个检查点 —— 不打断正在飞的那一个请求
// （打断了服务端可能已经收下，我们却当成没发，下次还会再发一次）。
$('wtRunStop').addEventListener('click', () => {
  WT.runStop = true;
  toast('正在停…（正在提交的那一个会走完）');
});
$('wtBillMore').addEventListener('click', () => { wtLoadBills(true); });
// ---- 积分兑换余额（0.27.1）----
// 默认收起：这一页已经很长，不兑换的人不该先看一堆控件。
$('wtExOpen').addEventListener('click', () => {
  WT.ex.open = !WT.ex.open;
  WT.ex.qty = 1;                 // 每次打开从 1 份开始，别记住上一次的份数
  $('wtExMsg').hidden = true;
  wtExPaint();
});
$('wtExUnits').addEventListener('click', (e) => {
  const b = e.target.closest('.wtchip');
  if (!b) return;
  WT.ex.unit = Number(b.dataset.unit);
  WT.ex.qty = 1;                 // 换档位时份数归 1 —— 留着旧份数会突然变成「积分不够」
  wtExPaint();
});
// 份数的上下限：下限 1，上限 = 可用积分买得起的份数（和 wtExTotalOf 同一个判据）
$('wtExMinus').addEventListener('click', () => {
  WT.ex.qty = Math.max(1, WT.ex.qty - 1);
  wtExPaint();
});
$('wtExPlus').addEventListener('click', () => {
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  const max = avail == null ? 1 : Math.floor(avail / WT.ex.unit);
  WT.ex.qty = Math.min(Math.max(1, max), WT.ex.qty + 1);
  wtExPaint();
});
// 多个钱包时点「兑换到」换一个（只有一个钱包时这颗按钮是 disabled 的）
$('wtExTo').addEventListener('click', async () => {
  const ws = Array.isArray(WT.ex.wallets) ? WT.ex.wallets : [];
  if (ws.length < 2) return;
  const cur = wtExCurWallet();
  const id = await openPick('兑换到哪个钱包', '', [{
    items: ws.map((w) => ({ id: w.endpointId, name: w.name })),
  }], cur ? cur.endpointId : '');
  if (id == null) return;        // 取消 = 不换
  WT.ex.eid = id;
  wtExPaint();
});
$('wtExGo').addEventListener('click', () => { wtExGo(); });
// 「全部兑换」：份数顶到上限，然后走**同一条**提交路径。
// 🔴 必须复用 wtExGo，不能另写一份「一次提交到底」：那等于把「只提交一次、
//    失败不重试、拿到账单号还要核 status」这一整套再抄一遍，抄漏一句就是
//    重复扣分。这里只负责把份数按到最大。
$('wtExMax').addEventListener('click', () => {
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  const max = wtExMaxQty(WT.ex.unit, avail);
  if (max < 1) return;
  WT.ex.qty = max;
  wtExPaint();
  wtExGo();
});
// 「做完自动换成余额」的开关（0.44.0，默认开）。
$('wtAutoEx').addEventListener('click', () => {
  // 老配置里没有这个键 —— 没有就是「开」（用户要的默认值）。
  CFG.wtAutoEx = !(CFG.wtAutoEx !== false);
  store.set(KEY.settings, CFG);
  wtPaintAutoEx();
});
$('wtDevAdd').addEventListener('click', () => { wtAddDevStart(); });
// 0.37.0：手动输入编号（不碰相机）。两颗图标各管一条路，
// 有相机也不影响这一颗 —— 用户点了「手动输入」就是不想扫。
$('wtDevType').addEventListener('click', () => { wtAddDev(); });
// 0.52.0 v7：碰一碰。机器上贴了我们写的贴纸时，贴一下就能到这台机器，
// 不用扫码、不用输编号。
$('wtDevNfc').addEventListener('click', () => { wtNfcOpen(); });
// 「已隐藏 N 台 · 恢复」：一次全恢复，不做二级页面（一共最多几十台）
$('wtDevShow').addEventListener('click', async () => {
  const n = wtHiddenCount();
  if (!n) return;
  const ok = await askConfirm('恢复 ' + n + ' 台？',
    '它们会重新出现在列表里。', '恢复', false);
  if (!ok) return;
  wtUnhideAll();
  wtPaintDevs();
});
// 消费记录默认收起：这一页先回答「还有多少钱」，明细是偶尔翻的。
$('wtBillOpen').addEventListener('click', () => {
  const open = $('wtBillBox').hidden;
  $('wtBillBox').hidden = !open;
  $('wtBillOpen').setAttribute('aria-expanded', open ? 'true' : 'false');
});
$('wtScanClose').addEventListener('click', () => { wtScanStop(); });
// 相机用不了时的退路：先关相机（不然灯一直亮），再走粘贴那条老路。
$('wtScanPaste').addEventListener('click', () => { wtScanStop(); wtAddDev(); });
// 2026-11-10：原来这里给 `#wtStop`（顶部那条上的按钮）挂监听。
// 那条已经删了 —— 「停止」现在就是设备行上那颗「接水」变的，
// 监听在 wtPaintDevs 里跟着重画一起重新绑（见那里的注释）。
$('wtTermsOk').addEventListener('click', () => { wtTermsOk(); });
// 返回回「校园」—— 百科 0.21.0 从「我的」搬到「校园」了（见 SUB_PARENT）。
// ⚠️ 这里和 SUB_PARENT 必须一致：不一致的话，点返回去的页面和底部高亮的
//    tab 是两个东西，用户会以为自己点错了。

/** 安卓返回键：先关浮层，再回课表，最后才退出 App。
 *
 *  不加这个的话，课程详情弹着的时候按返回会直接把 App 退掉，
 *  下次进来还得重新找那门课 —— 安卓上这属于「手感不对」。
 *  返回 true 表示「我处理了」，原生那边就不退出。
 */
window.appBack = function () {
  // 扫码浮层在最上面。返回键必须先把相机**关掉**再收浮层 —— 只藏浮层的话
  // 相机轨道还在跑，指示灯常亮，下次再开还会报「被占用」。
  if (!$('wtScan').hidden) { wtScanStop(); return true; }
  // 免责声明层在最上面，先关它。**不记「已读」** —— 没点「我知道了」就
  // 不算读过，下次进来还得看。挂着的那个动作也一起丢掉：用户按返回就是不想做了。
  if (!$('wtTerms').hidden) { $('wtTerms').hidden = true; wtPending = null; return true; }
  // 弹层开着 ⇒ 按返回 = 取消。走 closeSheet（它负责把挂着的 Promise 结掉）
  if (!$('sheetMask').hidden) { closeSheet(); return true; }
  // 子页（校历 / 空教室 / 账号管理）先回它所属的那个 tab；
  // 不在子页就先回课表，再按一次才退出
  if (SUBPAGES.indexOf(CUR_PAGE) >= 0) {
    switchTab(SUB_PARENT[CUR_PAGE] || 'schedule');
    return true;
  }
  if (CUR_PAGE !== 'schedule') { switchTab('schedule'); return true; }
  return false;
};

// ------------------------------------------------------------------ 本地版本信息
/* 更新清单是一份静态 JSON，跟发布页放在同一个域名下，APK 和网页版查的是同一份。
 *
 * 为什么不用 GitHub Releases API：国内访问 github.com 时通时断（校网里尤其明显），
 * 而且它要带 token、有速率限制、返回体还大。静态 JSON 一次几百字节，
 * 失败也不打扰人 —— 查更新失败对用户来说什么都不是，不该弹错误框。
 *
 * 🔴 这份 JSON 必须带 `Access-Control-Allow-Origin: *`：
 *    APK 的页面源是 https://app.local，网页版是 http://127.0.0.1:8788，
 *    两边都是跨域请求。少了这个头，fetch 会静默失败，
 *    表现成「永远显示已是最新版本」—— 又是一个把错误说成事实的坑。
 */
/* 清单挂在 GitHub 仓库里（2026-11-24）：仓库 dsy-star/NepuPass 的 `version.json`
 * 由发版工作流（.github/workflows/release.yml）在每次打 tag 时重写。
 *
 * 🔴 顺序有意义：GitHub Pages 更新最快（CDN 大约十分钟），排第一；
 *    jsDelivr 和 raw 都是从同一个 gh-pages 分支读的**同一份文件**，
 *    只是线路不同 —— 国内 jsDelivr 基本能连，raw 常被断，
 *    但多一条路总比少一条强（主源成功时备源根本不会发出去，见 fetchManifest）。
 * 🔴 三个地址的路径必须**一模一样**，否则备源拿到的可能是上一次发版的清单，
 *    会被判成「已是最新」而把更新吃掉。
 * 🔴 GitHub Pages 需要在仓库设置里开一次（Source: Deploy from a branch → gh-pages）。
 *    没开的时候这一条会 404，fetchManifest 会落到 jsDelivr 那条，不算错。
 */
// 正式版清单 = 所有人「检查更新」读的那份。
// 2026-11-25：加了 fastly 这条 —— cdn.jsdelivr.net 在移动网/校园网会直接 TLS 失败
// （实测 curl 报 000），fastly.jsdelivr.net 却 200，两个域名是同一份缓存，
// 加进来等于白捡一条活路，成本只是一次没人走到的请求。
const UPD_STABLE = [
  'https://dsy-star.github.io/NepuPass/version.json',
  'https://fastly.jsdelivr.net/gh/dsy-star/NepuPass@gh-pages/version.json',
  'https://cdn.jsdelivr.net/gh/dsy-star/NepuPass@gh-pages/version.json',
  'https://raw.githubusercontent.com/dsy-star/NepuPass/gh-pages/version.json',
];
/* 测试版清单（2026-11-07）：**不挂在任何页面上**，路径也不在公开页面、
   历史列表、正式版清单里出现 —— 只有测试版 App 自己知道这个地址。
   发版时正式版和测试版一起传上去，公开那一面看不到它。

   🔴 测试版必须**先看这一条**，取不到（还没发过测试版 / 地址被墙）再退回
      正式版清单。反过来的话，正在试的测试版会被正式版按回去，
      用户手上那个包第二天就自己变回正式版了。
   🔴 退回正式版清单是**兜底**，不是常态：正式版的 code 是发版那一刻重新
      打的、比测试版大，所以真退回去了会提示「有新版本」并装成正式版 ——
      比永远停在旧测试版强，但只该在测试版清单整个消失时发生。 */
const UPD_BETA = [];
const UPD_SRC = (APP_CHANNEL === 'beta' ? UPD_BETA : []).concat(UPD_STABLE);

/* 测试版那一层的口令（2026-11-10）。
 *
 * 测试版清单和安装包曾经挂在需要口令的私有路径下，路径虽然不在任何页面上
 * 露出来，但**猜得到**（版本号就那几个）。拿到了包就等于拿到了包里的东西。
 *
 * 🔴 源码里永远是空串，只有**打测试版那一刻**才由 build_apk.py 从
 *    `deploy/beta_key.txt`（已 gitignore）读出来塞进来。正式版一律空。
 *    理由和别处的密钥一样：源码在公开仓库里。
 * 🔴 空串时 `updBetaUrl()` 原样返回 —— 网页版、正式版都不带这个参数，
 *    也就不会因为「服务端要口令、本地没有」而把检查更新弄挂。
 * 🔴 现在 `UPD_BETA` 是空的（测试版改成走 GitHub Release 的 tag），
 *    这套口令是留给以后重新开测试版通道时用的，别顺手删掉。 */
const BETA_KEY = '';

/** 给测试版那一层的地址挂上口令。别的地址一律原样返回。
 *
 *  🔴 别把这个函数叫 updKey —— 那个名字已经被「一个版本的标识符」占了
 *     （`updKey(info)`，见下面）。同名函数在后一个声明处覆盖前一个，
 *     表现是「记住这一版」和「比对版本」全乱，而且不报错。
 */
function updBetaUrl(u) {
  const s = String(u || '');
  if (!BETA_KEY) return s;
  /* 只给「本项目的清单地址」挂口令。原来认的是旧站点的 `/hangyuantong/beta/`，
     现在清单在 gh-pages 上，认 `version.json` 就够了；别的地址一律原样返回，
     免得把口令带到第三方镜像（ghproxy、jsDelivr）的 URL 里。 */
  if (s.indexOf('/NepuPass') < 0 && s.indexOf('version.json') < 0) return s;
  if (s.indexOf('k=') >= 0) return s;             // 已经带过了，别挂两次
  return s + (s.indexOf('?') < 0 ? '?' : '&') + 'k=' + encodeURIComponent(BETA_KEY);
}

// 频率 → 允许的间隔（秒）。always = 0，即每次打开都查。
const UPD_FREQ_SEC = { always: 0, daily: 86400, weekly: 7 * 86400 };
const UPD_FREQ_CN = { always: '每次打开', daily: '每天一次', weekly: '每周一次' };
const UPD_FREQ_LIST = ['always', 'daily', 'weekly'];

/* 自动检查查到新版本时，用户正开着别的弹层 —— 先存这儿，等他关掉再弹。
   存的是清单本身，不是「待办标记」：关掉的那一刻直接拿来渲染。 */
let updPending = null;
// All sheet callers share this mask, including those that close it directly.
new MutationObserver(() => {
  if (!$('sheetMask').hidden || !updPending) return;
  const info = updPending;
  updPending = null;
  setTimeout(() => {
    if (CFG.updOn && CFG.updSkip !== updKey(info) && updNewer(info)) showUpdateSheet(info, false);
  }, 0);
}).observe($('sheetMask'), { attributes: true, attributeFilter: ['hidden'] });

/** 把 '0.10.2' 拆成 [0,10,2]。别用字符串比大小 —— "0.10" < "0.9"。 */
function verNum(s) {
  return String(s || '').replace(/^v/i, '').split(/[.\-+_]/)
    .map((x) => parseInt(x, 10) || 0);
}

/** 比较两个版本号：a 比 b 新返回 1，一样返回 0，旧返回 -1。 */
function verCmp(a, b) {
  const A = verNum(a); const B = verNum(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const fmtBytes = (n) => {
  const v = Number(n);
  if (!(v > 0)) return '';
  if (v < 1024 * 1024) return Math.round(v / 1024) + ' KB';
  return (v / 1024 / 1024).toFixed(1) + ' MB';
};

function updAgo(ts) {
  if (!ts) return '还没检查过';
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 0) return '刚刚检查过';
  if (d < 60) return '刚刚检查过';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前检查过';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前检查过';
  return Math.floor(d / 86400) + ' 天前检查过';
}

/** 依次试几个源，谁先给出合法清单就用谁。全挂了返回 ok:false + 原因。
 *
 *  🔴 界面上的原因只说人话，**状态码一律留在控制台**（2026-11-01 改）。
 *     以前非 2xx 直接 `why = 'HTTP ' + status`，用户看到的是
 *     「检查失败：HTTP 404」—— 他既不能改代码也不能重发版，
 *     这句话除了让人以为是自己手机坏了，没有任何用。
 *     现在只分两种，因为用户能做的只有两件事：
 *       · 连不上网     -> 去看网络
 *       · 服务暂时不可用 -> 过会儿再试
 */
/** 主源最多等这么久（2026-11-13：4 秒 → 8 秒）。
 *
 *  🔴 4 秒线是 v18 用户「检查更新一直没结果」的直接原因。
 *     线上实测这份清单 **0.8~5.2 秒**才回（Cloudflare 边缘命中也要 1 秒上下），
 *     4 秒经常把**已经成功、只是慢**的响应自己掐掉；掐掉之后再去等那两个
 *     国内根本连不上的备源，用户等满 9 秒，拿到的却是「检查失败：网络太慢」。
 *     8 秒能盖住实测最慢的 5.2 秒 —— 超时线该量出来，不是拍脑袋。
 */
const UPD_MAIN_MS = 8000;
/** 备源的上限。备源是兜底，主源都 8 秒没回时它们才上场。 */
const UPD_ALT_MS = 6000;
/** 备源晚这么久才发。
 *
 *  🔴 主源正常时（1 秒内）一个备源包都不打 —— dpdns 国内被 TLS 干扰、
 *     GitHub 国内基本连不上，提前发只是白发。
 *     主源慢的时候它们已经在路上了，总等待取「最慢那条」而不是「几条相加」。
 */
const UPD_ALT_DELAY_MS = 1200;
/** 刚查过的结果留多久（秒）。启动自动查一次、用户马上又点「立即检查」，
 *  不该打两遍网络。 */
const UPD_MEMO_SEC = 30;

let updMemo = null;        // { at, info } 上一次成功的结果
let updInflight = null;    // 正在查的那一次（手动点会跟着它等，不开第二条）

/** 试一个源。**保证在 ms 内返回**，且不往外抛。 */
async function fetchOne(base, ms) {
  const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  const tid = ctl
    ? setTimeout(() => { try { ctl.abort(); } catch (e) { /* 已经结束了 */ } }, ms)
    : 0;
  // 随机参数：清单换版本时必须立刻拿到新的（缓存在 CDN 边缘节点上）。
  // 口令挂在**最后**：先把 `?t=` 拼好再交给 updKey，否则会拼出
  // `...?k=xxx?t=...` 这种两个问号的地址（服务端只认第一个，t 变成值的一部分）。
  const u = updBetaUrl(base + (base.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now());
  try {
    const r = await fetch(u, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!r.ok) {
      console.warn('[upd] ' + u + ' -> HTTP ' + r.status);
      return { ok: false, error: '更新服务暂时不可用' };
    }
    const j = await r.json();
    const validVersion = j && typeof j === 'object' &&
      typeof j.version === 'string' && /^\d+(?:\.\d+){1,3}$/.test(j.version);
    const validCode = Number.isSafeInteger(j && j.code) && j.code > 0;
    const validSize = Number.isSafeInteger(j && j.size) && j.size > 0;
    const validSha = typeof (j && j.sha256) === 'string' && /^[a-f0-9]{64}$/i.test(j.sha256);
    const validUrls = j && typeof j === 'object' &&
      [j.apk_cn, j.apk, j.page].some((x) => typeof x === 'string' && /^https:\/\//i.test(x));
    if (!validVersion || !validCode || !validSize || !validSha || !validUrls) {
      console.warn('[upd] ' + u + ' 清单格式不对');
      return { ok: false, error: '更新服务暂时不可用' };
    }
    return { ok: true, info: j };
  } catch (e) {
    const m = (e && e.message) || String(e);
    console.warn('[upd] ' + u + ' 失败：' + m);
    // 🔴 三种原因要分开说：用户能做的只有「等一会儿」和「看一下网络」，
    //    把超时说成「服务不可用」等于把自己的问题赖到服务器头上。
    const aborted = (e && e.name === 'AbortError') || /abort/i.test(m);
    return {
      ok: false,
      error: aborted ? '网络太慢，没等到回应'
        : (/failed to fetch|load failed|networkerror|network error/i.test(m)
          ? '网络不可用，请检查网络' : '更新服务暂时不可用'),
    };
  } finally {
    if (tid) clearTimeout(tid);
  }
}

/** 拿清单：主源先上，备源在 1.2 秒后悄悄跟着上，谁先给出合法清单用谁。
 *
 *  🔴 以前是「主源失败后才并行问备源」—— 等于把最慢的那条串在前面：
 *     主源 4 秒超时 + 备源再各 4 秒，用户白等 8 秒以上（实测 9 秒）。
 *     现在两条腿同时跑，总等待 = 最慢那条，不是几条相加。
 *  🔴 主源成功就**优先用主源**：备源里那份可能是旧域名上的旧清单
 *     （dpdns 只有兜底时才更新），拿错会被判成「有新版本」或「已是最新」。
 */
async function fetchManifest() {
  // 清单数组被清空（本地构建、没配源）时不要往后走：
  // 原来这里会 fetchOne(undefined) 抛 TypeError，被 checkUpdate 兜成
  // 「更新服务暂时不可用」—— 一句话既不说是什么问题，也没法排查。
  if (!UPD_SRC.length) return { ok: false, error: '这个版本没有配置更新源' };
  const rest = UPD_SRC.slice(1);
  if (!rest.length) return fetchOne(UPD_SRC[0], UPD_MAIN_MS);
  // 主源成功就把备源按住不发 —— 备源里那两个国内基本连不上，
  // 每次开 App 都白打两条请求，除了耗用户的流量没有任何意义。
  let stop = false;
  const alts = (async () => {
    await new Promise((r) => setTimeout(r, UPD_ALT_DELAY_MS));
    if (stop) return [];
    return Promise.all(rest.map((b) => fetchOne(b, UPD_ALT_MS)));
  })();
  const f = await fetchOne(UPD_SRC[0], UPD_MAIN_MS);
  if (f.ok) { stop = true; alts.catch(() => {}); return f; }
  const rs = await alts;
  return rs.filter((x) => x && x.ok)[0] || f;
}

/** 手上的版本比清单新吗。code 是整数，优先信它；老格式退回比版本号字符串。 */
function updNewer(info) {
  return (typeof info.code === 'number')
    ? info.code > APP_CODE
    : verCmp(info.version, APP_VERSION) > 0;
}

/** 一个版本在「记住 / 比对」时用的标识：正式版就是版本号，测试版再带上序号。
 *
 *  🔴 只拿 `version` 当标识会出事：这一轮所有测试版都叫 0.49.0，
 *     用户在 v1 上点过「以后再说」，v2 出来会被当成同一版**一起静音** ——
 *     他再也收不到自动提示，还以为测试版没更新。
 *     下载续传、跳过、文件名三处都是同一个坑，所以统一走这里。 */
function updKey(info) {
  const v = String((info && info.version) || '');
  const s = Number(info && info.seq) > 0 ? Number(info.seq) : 0;
  return s ? v + '-v' + s : v;
}

/** 版本号在界面上的写法：正式版 `0.48.0`，测试版 `0.49.0 v1`。
    和 updKey 分开：一个给人看、一个用来比对，混用迟早把 `-v2` 显示到界面上。 */
function updLabel(info) {
  const v = String((info && info.version) || '');
  const s = Number(info && info.seq) > 0 ? Number(info.seq) : 0;
  return s ? v + ' v' + s : v;
}

/** 查一次。返回 {ok, newer, info, error}，界面怎么显示由调用方决定。
 *
 *  🔴 以前这里用 toast 报结果，结果弹层一开，toast 正好压在按钮上
 *     （弹层从底部升起，toast 也在底部）。现在一律不弹 toast：
 *     结果写在弹层自己那一行字里，或者直接换成「发现新版本」。
 */
async function checkUpdate(manual) {
  // 已经在查：**跟着等那一次**，不要直接回 busy。
  // 回 busy 的话「立即检查」的按钮会永远停在「正在检查…」——
  // 用户点了没反应，比慢更糟。
  if (updInflight) {
    const r = await updInflight.catch(() => null);
    if (r) {
      // 🔴 撞上的那次**不能让手动点白等**（2026-11-13，v18 用户报障）。
      //    它可能是启动时的自动检查；自动检查拿到新版本、而这个版本被用户
      //    点过「以后再说」时，返回的是 `skipped` —— 直接交回去，
      //    界面那边 `if (r.ok && r.newer) return;` 会当成「弹层已经换掉了」
      //    直接退出，按钮就永久停在「正在检查…」，一个字都不给。
      //    用户的原话：「一直在检查不出结果」，关掉再点也一样。
      //    手动点的语义就是「我现在要看」——有新版就当场弹，不管静音过没有。
      if (manual && r.ok && r.newer && r.info) {
        showUpdateSheet(r.info, true);
        return { ok: true, newer: true, info: r.info };
      }
      return r;
    }
  }
  // 🔴 明确没网就别等 8 秒（2026-11-13）。自动检查本来就不会弹，
  //    手动点的时候给一句立刻能懂的话，比转一圈再说「网络太慢」强。
  //    🔴 这句话和下面 fetch 失败那句**故意不一样**：真机上「离线」时
  //    fetch 有时不报错、就挂在那儿，只能靠这个快门；两句一样的话，
  //    判据就分不出快门到底有没有用（会被「反正也会说这句」蒙过去）。
  if (manual && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: '本机无网络，请检查连接' };
  }
  // 30 秒内刚查过：自动检查直接用上次的结果，不再打一遍网络。
  if (!manual && updMemo &&
      (Math.floor(Date.now() / 1000) - updMemo.at) < UPD_MEMO_SEC) {
    return { ok: true, newer: updNewer(updMemo.info), info: updMemo.info };
  }

  const run = (async () => {
    let r;
    try {
      r = await fetchManifest();
    } catch (e) {
      // fetchManifest 自己不该抛，但「不该」不等于「不会」——
      // 抛出来会让按钮一直转，所以这里必须兜住。
      r = { ok: false, error: '更新服务暂时不可用' };
    }
    if (!r.ok) {
      // 自动检查失败就彻底安静：查更新失败不代表任何功能坏了。
      return { ok: false, error: r.error };
    }
    const info = r.info;
    CFG.updLast = Math.floor(Date.now() / 1000);
    store.set(KEY.settings, CFG);
    updMemo = { at: CFG.updLast, info: info };

    const newer = updNewer(info);
    if (!newer) {
      if (manual) renderMe();
      return { ok: true, newer: false, info };
    }
    // 自动检查时，用户点过「以后再说」的那个版本不再自己弹；
    // 手动点「检查更新」还是弹 —— 那是他自己要看。
    if (!manual && CFG.updSkip === updKey(info)) {
      return { ok: true, newer: true, info, skipped: true };
    }
    // 手动点的时候必须当场换掉面板（他就是来看这个的），自动的则排队。
    showUpdateSheet(info, !!manual);
    return { ok: true, newer: true, info };
  })();

  updInflight = run;
  try {
    return await run;
  } finally {
    updInflight = null;
  }
}

/* ------------------------------------------------------------ 自动检查（每日）
 *
 * 和手动那条路的分工：手动是用户自己点「检查更新」，**什么都要说出来**
 * （没网、服务挂了、已经最新）。这条不是 —— 它只在确实有更新时才弹面板，
 * 失败／没网／清单挂了统统闭嘴。没人喜欢开个 App 就被一个红字拦住。
 *
 * 节奏由设置里那三个值决定（CFG.updOn / updFreq / updLast）：
 *   · updOn 关着就一次都不查（默认开）；
 *   · 间隔 always / daily / weekly 见 UPD_FREQ_SEC；
 *   · updLast 由 checkUpdate 在**成功拿到清单之后**自己写，
 *     所以关网、服务挂了不会把计时器白白重置成「今天查过了」。
 *
 * 已经被「以后再说」的那个版本不再自动弹（CFG.updSkip，判断在 checkUpdate 里），
 * 但用户手动点的时候照样弹 —— 那是他自己要看。
 */
const UPD_BOOT_DELAY_MS = 5000;

async function updAutoCheck() {
  try {
    if (!CFG.updOn) return;
    const freq = UPD_FREQ_SEC[CFG.updFreq];
    if (typeof freq !== 'number') return;
    const now = Math.floor(Date.now() / 1000);
    // freq 为 0（always）表示不限间隔；其余按秒数卡。
    // 少一分钟的容差是为了「刚查过又马上启动」时别立刻再来一轮。
    if (freq > 0 && CFG.updLast && now - CFG.updLast < freq - 60) return;
    await checkUpdate(false);
  } catch (e) {
    // 自动检查永远不许影响启动。
  }
}

/* ---------------------------------------------------------------- 应用内下载
 *
 * 只有 APK 里有（网页版 NativeApi.update.available() 返回 false，退回浏览器）。
 *
 * 为什么值得做：以前点「立即更新」是跳到系统浏览器，很多人下完根本不知道
 * 还要去通知栏点一下，回来问「怎么没更新」。现在是自己下、自己校验、自己
 * 把安装界面拉起来 —— 中间不用离开 App。
 *
 * 🔴 有一条做不到：**不能静默安装**。Android 不许一个 App 自己装自己，
 *    最后一定弹系统安装器让用户点「安装」。所以这里的终点是「把安装界面拉起来」。
 *
 * 状态机：idle → downloading → ready → （交给系统）→ 用户点安装
 *                ↘ failed（换线路重试一次，仍失败就报错）
 *                ↘ needperm（缺「安装未知应用」授权）
 */
let updDl = null;
/* { id, ver, lines, i, timer, state, pct, total, got, err, allowBrowser,
     note, startedAt, lastBytes, lastAt } */

/** 「下载器不动了」的判据。
 *
 *  🔴 为什么必须有这一条（0.26.4 加的，用户实测卡在 0%）：系统下载器有三种
 *     「没在动」的样子 —— 排队等(1)、网络错误后暂停(4)、以及下载中但一直
 *     0 字节 —— 它们和「正在下」在界面上**长得一模一样**。
 *     0.26.3 及以前只认 8(完成) 和 16(失败)，剩下的全当「正在下载」，
 *     于是卡住以后永远显示「正在下载 0%」，主按钮还是禁用的 ⇒ **没有任何出口**。
 *     状态机缺的不是分支，是**时间**。
 *
 *  🔴 0.37.0 拆成两个数（用户 2026-11-01：「点下载进度一直卡住，非常频繁」）：
 *     以前只有一个 30 秒，**「还没开始」和「下到一半停了」共用一个判据**，
 *     结果是「这条线路压根没起来」也要干等 30 秒。包只有 546 KB，正常线路
 *     一秒内就开始出字节了 —— 8 秒一个字节都没有，就不是「慢」，是「不通」。
 *     分开以后最坏等待从 60 秒（两条线各 30）降到 20 秒左右。
 */
const UPD_BOOT_MS = 8000;    // 入队后这么久一个字节都没下来 = 这条线路没起来
const UPD_STALL_MS = 20000;  // 已经出过字节，之后再停这么久 = 真的断了


/** 现查现用，不在模块加载时缓存 —— 网页版里这个对象永远不存在。 */
function nativeUpd() {
  const u = window.NativeApi && window.NativeApi.update;
  if (!u || typeof u.available !== 'function' || !u.available()) return null;
  return u;
}

/* ---- 下载线路（0.37.0）
 *
 * 两条线路对**系统下载器**的友好程度不一样，这是本轮排查的结论：
 *
 *   · 主站（Cloudflare Worker）回 `Content-Length: 559060` —— 下载器知道
 *     总大小，进度条能一格一格走。
 *   · CNB 制品库是**分块传输**：没有 `Content-Length`，也不支持断点
 *     （实测 `Range: bytes=0-99` 回的是 200 整包，不是 206）。
 *     这种响应在部分国产 ROM 上会让系统下载器一直停在 0%，用户看到的就是
 *     「进度卡住」—— 而它其实不是慢，是**读不到任何进度**。
 *
 * CNB 在国内快得多，所以默认仍然先走它（用户 2026-11-01 明确要求）；
 * 但「先走」不等于「只能走」：8 秒没字节就换下一条，弹层里也能手动换。
 * 记住用户手动选的那条 —— 他按过一次「换线路」，下次不该再按第二次。
 */
const UPD_LINES = [
  { id: 'cn', name: '国内线路', of: (info) => info.apk_cn },
  { id: 'main', name: '主站', of: (info) => info.apk },
];

/** 当前该用哪条线路。没选过 / 存的值不认识 ⇒ 国内线路（用户定的默认）。 */
function updLineId() {
  const v = String(CFG.updLine || '');
  return UPD_LINES.some((l) => l.id === v) ? v : 'cn';
}

/** 排好的线路：**选过的那条在最前**，其余按 UPD_LINES 顺序兜底。
 *  空地址和重复地址都在这里剔掉 —— 清单里 `apk_cn` 缺了是常事（老格式）。 */
function updLines(info) {
  const first = updLineId();
  const arr = UPD_LINES.slice().sort(
    (a, b) => (b.id === first ? 1 : 0) - (a.id === first ? 1 : 0));
  const out = [], seen = {};
  arr.forEach((l) => {
    const u = l.of(info);
    if (typeof u !== 'string' || !/^https?:\/\//.test(u) || seen[u]) return;
    seen[u] = 1;
    out.push({ id: l.id, name: l.name, url: u });
  });
  return out;
}

/** 只要地址（「用浏览器下载」那条退路，以及判据里比顺序用）。 */
function updUrls(info) {
  return updLines(info).map((l) => l.url);
}

/** 下载到本机的文件名。只用 ASCII —— 中文名在有些 ROM 的下载目录里会变乱码。
 *
 *  2026-11-24 前缀从 `hangyuantong-` 改成 `dongyoutong-`：改名之后
 *  清单里的安装包就叫 `dongyoutong-0.1.1.apk`，这里再写旧前缀，
 *  用户手机里会同时躺着两种前缀的包，回滚的时候根本分不清哪个是新的。
 *  ApkProvider 那边只认 `.apk` 结尾的 ASCII 名字，两边必须对得上。 */
function updName(info) {
  const v = updKey(info).replace(/[^0-9A-Za-z._-]/g, '');
  return 'dongyoutong-' + (v || 'new') + '.apk';
}

/** DownloadManager 的失败原因码。不翻译的话界面上就是一句「错误码 1008」。 */
function updReason(code) {
  const m = {
    1001: '存不下这个文件',
    1002: '下载服务出问题了，请重试',
    1003: '下载中断了（可能断网了）',
    1004: '下载地址不对',
    1005: '存储空间不够',
    1006: '手机存储读不了',
    1007: '下载中断了，重新下一次',
    1008: '连不上网',
    1009: '文件已存在',
    1010: '被系统拦下了',
    1011: '文件太大',
  };
  return m[code] || ('错误码 ' + code);
}

/** 按当前状态把按钮、进度条、提示刷一遍。找不到元素（弹层已关）就直接返回。 */
function updPaint(info) {
  const box = $('updProg'), bar = $('updBarFill'), pct = $('updPct');
  const go = $('updGo'), later = $('updLater'), tip = $('updTip');
  if (!box || !bar || !pct || !go || !later || !tip) return;
  const st = updDl ? updDl.state : 'idle';
  const p = updDl ? updDl.pct : 0;

  // 失败时**不显示**进度条：一条 100% 的红条看着像「下满了」，
  // 而失败跟进度没关系，说明不了任何事，只会误导。
  box.hidden = (st === 'idle' || st === 'failed');
  // 总大小未知时进度条改成「来回跑」的不确定态 —— 停在 0% 的死条和
  // 「卡住」长得一样，而我们这时**确实不知道**还剩多少。
  box.classList.toggle('indet', st === 'downloading' && !updDl.total);
  if (box.classList.contains('indet')) bar.style.width = '';
  else bar.style.width = (st === 'ready' || st === 'needperm') ? '100%' : p + '%';
  updLinePaint(info);

  if (st === 'downloading') {
    go.disabled = true;
    go.textContent = updDl.total ? ('正在下载 ' + p + '%') : '正在下载';
    later.textContent = '后台下载';
    pct.textContent = (updDl.total
      ? ('已下载 ' + (fmtBytes(updDl.got) || '0 KB') + ' / ' + fmtBytes(updDl.total) +
         '（' + p + '%）')
      : ('已下载 ' + (fmtBytes(updDl.got) || '0 KB') + '（这条线路没给文件大小）')) +
      (updDl.note ? ' · ' + updDl.note : '');
    tip.textContent = '';
    tip.classList.remove('bad');
  } else if (st === 'ready') {
    go.disabled = false;
    go.textContent = '安装';
    later.textContent = '以后再说';
    pct.textContent = '下载完成，安装包已校验';
    tip.textContent = '';
    tip.classList.remove('bad');
  } else if (st === 'needperm') {
    go.disabled = false;
    go.textContent = '去允许安装';
    later.textContent = '以后再说';
    pct.textContent = '下载完成，安装包已校验';
    tip.textContent = '还没允许安装应用。点上面的按钮去开启，' +
      '回来再点一次「安装」。';
    tip.classList.remove('bad');
  } else if (st === 'failed') {
    go.disabled = false;
    go.textContent = updDl && updDl.allowBrowser ? '用浏览器下载' : '重试';
    later.textContent = '以后再说';
    pct.textContent = '';
    tip.textContent = (updDl && updDl.err) || '下载失败';
    tip.classList.add('bad');
  } else {
    go.disabled = false;
    go.textContent = '立即更新';
    later.textContent = '以后再说';
    pct.textContent = '';
    tip.textContent = '';
    tip.classList.remove('bad');
  }
}

/** 画「线路」那一行。清单里只有一个地址时整行不出现 ——
 *  一颗按了没得选的按钮比没有更糟（同一个理由见「兑换到」那行）。 */
function updLinePaint(info) {
  const row = $('updLineRow'), sw = $('updLineSw');
  if (!row || !sw) return;
  const lines = info ? updLines(info) : [];
  const st = updDl ? updDl.state : 'idle';
  // 已经下完了就不给换了：这时候换线路只是把校验过的包再下一遍。
  row.hidden = lines.length < 2 || st === 'ready' || st === 'needperm';
  if (row.hidden) return;
  const cur = (updDl && updDl.lines[updDl.i]) ? updDl.lines[updDl.i] : lines[0];
  sw.textContent = '线路：' + cur.name;
}

/** 手动换一条线路。
 *
 *  🔴 下载中换线路 = **取消当前任务、从 0 重下**，不是「接着下」——
 *     两条地址是同一个包的两份拷贝，字节对不上，硬接会把包装坏。
 *     这里不弹确认：用户按了「换线路」就是受够了这条，再多一次确认只是添堵。
 * 🔴 换之前必须 cancel 旧任务（理由见 updDropLine 那段注释：僵尸任务会自己
 *     活过来往同一个文件名里写）。
 */
function updSwitchLine(info) {
  const lines = updLines(info);
  if (lines.length < 2) return;
  const cur = (updDl && updDl.lines[updDl.i]) ? updDl.lines[updDl.i].id : lines[0].id;
  const next = lines.filter((l) => l.id !== cur)[0];
  if (!next) return;
  const u = nativeUpd();
  if (updDl) {
    if (u && updDl.id) u.cancel(updDl.id);
    if (updDl.timer) clearInterval(updDl.timer);
    updDl = null;
    CFG.updDlId = 0;
  }
  // 记住他选的这条：按过一次「换线路」，下次不该再按第二次
  CFG.updLine = next.id;
  store.set(KEY.settings, CFG);
  if (updStart(info)) updPaint(info);
  else updPaint(info);
}

/** 入队下载。返回 false = 这台设备/这个版本没有应用内下载能力。 */
function updStart(info) {
  const u = nativeUpd();
  if (!u) return false;
  const lines = updLines(info);
  if (!lines.length) return false;
  if (updDl && updDl.timer) clearInterval(updDl.timer);
  updDl = { id: 0, ver: updKey(info), lines: lines, i: 0, timer: 0,
            state: 'downloading', pct: 0, total: Number(info.size) || 0,
            err: '', allowBrowser: false, note: '', got: 0,
            // lastBytes 从 -1 起步：第一次拿到 0 也算「变了」，好让计时从
            // 真正开始查的那一刻算，而不是从页面打开的那一刻算。
            startedAt: Date.now(), lastBytes: -1, lastAt: Date.now() };
  updEnqueue(info);
  return true;
}

/** 按当前线路入队；入队本身失败就换下一条。 */
function updEnqueue(info) {
  const u = nativeUpd();
  if (!u || !updDl) return;
  // 测试版那条地址要带口令（正式版恒为空、原样返回）。下载走的是系统下载器，
  // 它只认 URL —— 口令只能挂在查询串上，没法走请求头。
  const r = u.start(updBetaUrl(updDl.lines[updDl.i].url), updName(info));
  if (!r || !r.ok) {
    if (updDl.i + 1 < updDl.lines.length) {
      updDl.i++;
      updEnqueue(info);
      return;
    }
    updDl.state = 'failed';
    updDl.err = '下载没能开始：' + ((r && r.error) || '未知原因');
    updPaint(info);
    return;
  }
  updDl.id = r.id;
  // 这一条线路的「起跑计时」从真正入队那一刻算 —— 不是从点按钮那一刻，
  // 中间还隔着 nativeUpd() / 建目录 / 删同名文件
  updDl.startedAt = Date.now();
  updDl.lastAt = Date.now();
  updDl.got = 0;
  updDl.lastBytes = -1;
  // 记下来：用户关掉弹层再打开，进度还能接上（下载本身在系统里跑，不受影响）
  CFG.updDlId = r.id;
  CFG.updDlVer = updDl.ver;
  // 存线路 id 而不是下标：下次打开弹层时清单里可能少了一条线路，
  // 存下标会指到别的线上（界面写着「国内线路」其实在下主站）。
  CFG.updDlLine = updDl.lines[updDl.i].id;
  store.set(KEY.settings, CFG);
  updPoll(info);
}

function updPoll(info) {
  if (!updDl) return;
  clearInterval(updDl.timer);
  updDl.timer = setInterval(() => updTick(info), 600);
  updTick(info);
}

/** 这条线路不要了：换下一条，没得换就报失败。
 *
 *  🔴 换线之前**必须 cancel** 掉卡住的那个任务。不然系统里留着一个「等网络」
 *     的僵尸任务，它稍后会自己活过来、往同一个文件名里写；而 start() 又会
 *     先删同名文件 —— 两个任务抢一个文件，或者下次打开弹层被 updResume
 *     接回来，永远卡在同一个地方。这条不写，看门狗会把「卡一次」变成「卡死」。
 */
function updDropLine(info, why, browser) {
  const u = nativeUpd();
  if (!updDl) return;
  if (u && updDl.id) u.cancel(updDl.id);
  if (updDl.i + 1 < updDl.lines.length) {
    updDl.i++;
    updDl.pct = 0;
    updDl.note = '';
    updDl.state = 'downloading';
    updDl.got = 0;
    updDl.lastBytes = -1;
    updDl.lastAt = Date.now();
    updEnqueue(info);
    return;
  }
  updDl.state = 'failed';
  updDl.err = why;
  updDl.allowBrowser = !!browser;
  updPaint(info);
}

function updTick(info) {
  const u = nativeUpd();
  if (!u || !updDl) return;
  const st = u.state(updDl.id);
  if (!st || !st.ok) {
    // 任务没了（系统清了 / 卸载重装）：别继续显示「正在下载」，那是在骗人
    clearInterval(updDl.timer);
    updDl = null;
    CFG.updDlId = 0;
    store.set(KEY.settings, CFG);
    updPaint(info);
    return;
  }
  if (st.total > 0) updDl.total = st.total;
  updDl.pct = updDl.total > 0
    ? Math.min(100, Math.floor(st.bytes * 100 / updDl.total))
    : 0;

  if (st.status === 8) {                    // SUCCESSFUL
    clearInterval(updDl.timer);
    updVerify(info);
    return;
  }
  if (st.status === 16) {                   // FAILED
    clearInterval(updDl.timer);
    // 原生那边会随状态带一句人话（「连不上网」「下载中断了」）。
    // 有就用它 —— 只给一个「错误码 1008」，用户拿着也没法做什么。
    updDropLine(info, String(st.error || '').trim() ||
      ('下载失败：' + updReason(st.reason)), false);
    return;
  }

  // 走到这里说明还没结束：1 等待 / 2 下载中 / 4 暂停。
  // 这三种里只有 2 且 bytes 在涨才是真在下载，所以判据只能是「有没有在动」。
  const bytes = Number(st.bytes) || 0;
  if (bytes !== updDl.lastBytes) {
    updDl.lastBytes = bytes;
    updDl.got = bytes;
    updDl.lastAt = Date.now();
    updDl.note = '';
  } else if (st.status === 1) {
    updDl.note = '系统下载器还在排队';
  } else if (st.status === 4) {
    updDl.note = '被系统暂停了（在等网络）';
  }
  // 判据分两段：**还没出过字节**说明这条线路压根没起来（8 秒就够判），
  // 出过字节之后再停才是「断了」（给 20 秒，可能只是网抖了一下）。
  const booting = !updDl.got;
  const still = Date.now() - (updDl.lastAt || 0);
  const limit = booting ? UPD_BOOT_MS : UPD_STALL_MS;
  if (still >= limit) {
    clearInterval(updDl.timer);
    // 把系统状态码留在话里：下次他再报「卡住」，这一句能直接告诉我们
    // 是排队(1)、等网络(4) 还是别的 —— 不用再猜一轮。
    const sec = Math.round(limit / 1000);
    updDropLine(info,
      booting
        ? ('这条线路 ' + sec + ' 秒还没开始传（系统状态 ' + st.status + '）')
        : ('下载停在第 ' + updDl.pct + '%，' + sec + ' 秒没动（系统状态 '
           + st.status + '）'),
      true);
    return;
  }
  updDl.state = 'downloading';
  updPaint(info);
}

/** 下载完先对 sha256 再交给安装器。
 *
 *  🔴 「算出来不一样」和「没读到」必须分开说：
 *     前者是「这个包不是我们要的那个」（被人换了 / 传错了），必须删掉重来；
 *     后者是「读不出文件」，同样不能装 —— 但我们没说它坏，只说读不到。
 */
function updVerify(info) {
  const u = nativeUpd();
  const want = String(info.sha256 || '').toLowerCase();
  const got = (u && u.sha256(updDl.id)) || '';
  if (!/^[a-f0-9]{64}$/.test(want) || !/^[a-f0-9]{64}$/.test(got) || got !== want) {
    u.cancel(updDl.id);                 // 连文件一起删掉，别留在手机上
    updDl.state = 'failed';
    updDl.allowBrowser = true;          // 给一条退路，别把人卡死在这
    updDl.err = got
      ? '安装包不完整，已经删掉了，请重试'
      : '安装包没存好，已经删掉了，请重试';
    updDl.id = 0;
    CFG.updDlId = 0;
    store.set(KEY.settings, CFG);
    updPaint(info);
    return;
  }
  updDl.state = 'ready';
  updPaint(info);
}

function updInstall(info) {
  const u = nativeUpd();
  if (!u || !updDl) return;
  if (!u.canInstall()) { updDl.state = 'needperm'; updPaint(info); return; }
  const r = u.install(updDl.id);
  const tip = $('updTip');
  if (r === '') {
    // 已经交给系统安装器了。这里只留一句说明 —— 真正的「装」在系统界面里
    if (tip) {
      tip.textContent = '已打开安装界面，按提示安装。';
      tip.classList.remove('bad');
    }
    return;
  }
  if (r === 'need-permission') { updDl.state = 'needperm'; updPaint(info); return; }
  updDl.state = 'failed';
  updDl.err = '没能打开安装界面：' + String(r).replace(/^fail:\s*/, '');
  updPaint(info);
}

/** 主按钮点下去该干什么，全看当前状态。 */
function updAction(info) {
  const st = updDl ? updDl.state : 'idle';
  if (st === 'needperm') {
    const u = nativeUpd();
    if (u && u.canInstall()) updInstall(info);
    else if (u) u.openInstallSettings();
    return;
  }
  if (st === 'ready') { updInstall(info); return; }
  if (st === 'downloading') return;          // 按钮此时是禁用的
  if (st === 'failed' && updDl && updDl.allowBrowser) {
    openExternal(updUrls(info)[0] || info.page || '');
    return;
  }
  if (updStart(info)) { updPaint(info); return; }
  // 网页版 / 没有原生下载能力：老办法，交给系统浏览器
  const url = info.apk_cn || info.apk || info.page || '';
  if (!url) {
    const tip = $('updTip');
    if (tip) {
      tip.classList.add('bad');
      tip.textContent = '清单无下载地址，去发布页下载。';
    }
    return;
  }
  if (!openExternal(url)) {
    const tip = $('updTip');
    if (tip) {
      tip.classList.add('bad');
      tip.textContent = '没能打开浏览器，请手动访问：' + url;
    }
  }
}

/** 弹层重新打开时，把还在跑的那个下载接上。 */
function updResume(info) {
  if (!nativeUpd()) return false;
  const id = CFG.updDlId;
  if (!id || String(CFG.updDlVer || '') !== updKey(info)) return false;
  // 旧的那个轮询先停掉，否则关一次弹层就多一个定时器，几个定时器一起
  // 往界面上写 —— 看着像「进度条来回跳」，其实是同一份数据被刷了多次。
  if (updDl && updDl.timer) clearInterval(updDl.timer);
  const lines = updLines(info);
  // 接着上次那条线路，别退回第一条：用户已经换过一次了，回来又换回去
  // 等于让他再点一次「换线路」。
  const li = lines.findIndex((l) => l.id === String(CFG.updDlLine || ''));
  updDl = { id: id, ver: updKey(info), lines: lines, i: li >= 0 ? li : 0, timer: 0,
            state: 'downloading', pct: 0, total: Number(info.size) || 0,
            err: '', allowBrowser: false, note: '', got: 0,
            startedAt: Date.now(), lastBytes: -1, lastAt: Date.now() };
  updPoll(info);
  return true;
}

/** 新版本提示。只有三样东西：版本号、更新内容、两个按钮。
 *
 *  force=false（自动检查）时，如果用户正开着别的弹层，先记下来等他关掉再弹 ——
 *  否则他正在填「学期设置」的日期，内容会被凭空换掉。
 */
function showUpdateSheet(info, force) {
  if (!force && !$('sheetMask').hidden) { updPending = info; return; }
  updPending = null;
  const notes = (Array.isArray(info.notes) ? info.notes : [])
    .filter((x) => typeof x === 'string' && x.trim());
  const size = fmtBytes(info.size);
  $('sheetBody').innerHTML =
    '<div class="sh-title">发现新版本 ' + esc(updLabel(info)) + '</div>' +
    '<div class="sh-sub">当前 v' + esc(MYVER) + (size ? ' · 新版本 ' + size : '') + '</div>' +
    (notes.length
      ? '<ul class="updnotes">' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>'
      : '<p class="sh-sub">这次主要是修问题和细节优化。</p>') +
    '<div class="updprog" id="updProg" hidden>' +
      '<div class="updbar"><i id="updBarFill"></i></div>' +
      '<p class="tip note" id="updPct"></p>' +
    '</div>' +
    '<div class="updline" id="updLineRow" hidden>' +
      '<button class="updline-sw" id="updLineSw">线路：国内线路</button>' +
      '<span class="updline-k">下不动就换一条</span>' +
    '</div>' +
    '<p class="tip note" id="updTip"></p>' +
    '<div class="sheetbtns">' +
      '<button class="btn" id="updLater">以后再说</button>' +
      '<button class="btn primary" id="updGo">立即更新</button>' +
    '</div>';
  $('sheetMask').hidden = false;

  $('updLater').addEventListener('click', () => {
    // 正在下载时这个按钮是「后台下载」：只收起弹层，不记「以后再说」——
    // 用户已经决定要装了，只是不想盯着进度条。
    if (updDl && updDl.state === 'downloading') {
      $('sheetMask').hidden = true;
      return;
    }
    // 记住「这个版本我不想现在装」。下次发新版照弹，不会因为点过一次就永远静音。
    CFG.updSkip = updKey(info);
    store.set(KEY.settings, CFG);
    $('sheetMask').hidden = true;
  });

  $('updGo').addEventListener('click', () => { updAction(info); });
  $('updLineSw').addEventListener('click', () => { updSwitchLine(info); });

  // 关掉再打开时，如果这个版本的下载还在跑，接着显示进度
  if (!updResume(info)) { updDl = null; updPaint(info); }
}

/** 交给外部打开：APK 里走系统浏览器，网页版新开一个标签页。 */
function openExternal(url) {
  if (NATIVE && window.NativeApi && typeof window.NativeApi.openUrl === 'function') {
    try { if (window.NativeApi.openUrl(url)) return true; } catch (e) { /* 落到下面 */ }
  }
  try {
    const w = window.open(url, '_blank');
    if (w) return true;
  } catch (e) { /* 被拦截 */ }
  return false;
}

/* ---- 直饮水（慧生活798）----------------------------------------------
   喝水和门户、一卡通是**三个**系统：门户管余额和办事，一卡通管食堂刷卡，
   饮水机是慧生活798（长沙云多啦）自己一套，跟学校账号不通。
   ⇒ 所以这张卡和百科一样留在 #cpOff / #cpOn 外面（没连门户也接得了水）。

   🔴 我们**只做入口，不搬它的功能**。它的接口地址和签名密钥在开源仓库里
      是被 secrets.properties 排除掉的，仓库里只有 your_salt_here 这种占位符；
      硬搬等于把别人的密钥写进我们仓库，推 CNB 就是公开 —— 不做。
      （第三方客户端 nocookies111/life-798 是 MIT，代码可以读，
        但密钥不在里面，从它的 APK 里能挖出来 —— 那更不该写进我们的仓库。）

   两个包名都试，因为同学装的可能不是同一个：
     com.cloudora.android  慧生活798 官方
     com.water.widget      WaterWidget，第三方客户端
   ⚠️ 这两个包名必须和 AndroidManifest 的 <queries>、NativeBridge.ALLOWED_APPS
      三处一致。少一处都**不报错**，只是「装了却说没装」或「点了没反应」。
*/
const WATER_APPS = [
  ['com.cloudora.android', '慧生活798'],
  ['com.water.widget', 'WaterWidget'],
];
// 没装时跳这里。用小米应用商店的页面：国内能直接打开，而且是官方渠道。
// ⚠️ 别换成 GitHub 的 release 页 —— 那个域名在国内经常打不开，
//    点了就是「白屏 → 退回来」，比不给入口还糟。
const WATER_STORE = 'https://app.mi.com/details?id=com.cloudora.android';

/** 装了哪几个（按 WATER_APPS 顺序）。网页版 / 没有这个接口的老 APK 返回空。 */
function waterTargets() {
  const out = [];
  if (!NATIVE || !window.NativeApi || typeof NativeApi.hasApp !== 'function') return out;
  WATER_APPS.forEach((a) => {
    if (NativeApi.hasApp(a[0]) === '1') out.push(a);
  });
  return out;
}

/** 打开慧生活798 客户端。
 *
 *  0.23.0 起它不再是「宿舍接水」那一行的去向 —— 那一行现在进我们自己的
 *  `#page-water`（查余额 / 列设备 / 接水）。这里只负责页内那行
 *  「打开慧生活798」：充值、签代扣协议、绑一卡通都得在那边做。
 *
 *  装了就直接切过去；没装就跳商店 —— 不在这里弹窗问「要不要装」：
 *  想接水的人本来就得有那个 App，多一层选择只是多一次点击。
 */
function openWater() {
  const got = waterTargets();
  if (got.length) {
    const r = NativeApi.openApp(got[0][0]);
    if (r === 'ok') return;                  // 已经切过去了，这边不用再做任何事
    // 起不来的原因要说一句，但**别停在这里** —— 用户要的是接水，不是错误码
    if (r !== 'notinstalled') toast('打不开' + got[0][1] + '，请到应用商店安装');
  }
  if (!openExternal(WATER_STORE)) {
    toast('应用商店搜「慧生活798」');
  }
}

/* ==================================================================
   直饮水页（#page-water）
   ------------------------------------------------------------------
   现在做的是：查余额 / 列设备 / 接水 / 停止 / 积分 / 账单 / 积分任务 /
   签到 / 两套账号。0.26.0 这里写着「别扩张，积分任务要签名盐值」——
   那个前提是错的（盐在官方 APK 里，2026-10-30 取到了，见 water.py 开头）。

   🔴 界面硬规矩（改这一页之前先读）：
     1. `start` 是**唯一**会真的出水扣钱的调用 ⇒ 二次确认。
        任务 / 签到也有副作用（动账号），同样要确认。
     2. 余额 `null` ≠ `0`。接口改字段名和「真的没钱了」看起来一模一样，
        但该做的事相反 ⇒ `null` 显示「没读到」，绝不显示 ¥0.00
     3. 出错按 `kind` 说话，不许一律「操作失败」
     4. 批量提交之间**至少 30 秒**，而且要能停（原版限流器就是 30 秒）
   🔴 登录失败**绝不自动重试**（尤其验证码）：错一次就换一张图，
        让用户重新读。自动重试会把账号试锁。
   ================================================================== */
const WT = {
  key: '',      // 图形验证码的会话串（服务端按它认这张图）
  busy: false,  // 有请求在飞 —— 防连点，不是防重复提交
  cd: 0,        // 短信倒计时还剩几秒
  timer: 0,
  phone: '',
  bal: null,    // null = 没读到（**不是 0**）
  balErr: '',
  devs: [],
  devErr: '',
  loadedAt: 0,  // 余额最后一次读到的时间（ms）
  expired: false, // 登录态过期了 —— 过期卡已经解释过，别再在别处重复

  // ---- 0.24.0：积分 / 积分任务 / 消费记录 ----
  score: null,       // {valid,total}；null = 没读到（**不是 0 分**）
  scoreErr: '',
  // [{refId,name,score,limit,used,left}]
  // 🔴 是 refId 不是 adId —— 响应里就叫 refId，只有请求 body 里才叫 adId
  //    （2026-10-30 查原项目 5.5.0 源码确认）。0.25.0 按 adId 找，所以
  //    真机上一直报「找不到带 adId 的数组」。
  missions: [],
  missionErr: '',
  missionSkipped: 0, // 列表里被跳过的条数（没 refId / 属于「不做的类别」）
  daily: null,       // 签到状态 {adId,score,week,weekday,signed,rewards}；null=没这功能
  run: {},           // refId -> 'wait'|'ok'|'bad'，这一轮跑出来的状态
  running: false,    // 批量任务正在跑（和 busy 分开：busy 是防连点）
  cur: '',           // 正在跑的那个 refId，界面上高亮那一行

  // ---- 0.26.2：两套账号 ----
  // 设备登录（1,1）管接水/余额/设备；积分登录（1,5）管积分/任务/签到。
  // 两个 token 互不通用，任务列表按平台各返回一份。
  accounts: { device: null, score: null },
  // 🔴 0.40.0：设备账号没登时，余额 / 消费记录 / 积分 / 今日任务四张卡
  //    各说一遍「没读到：要用「设备登录」那个账号……」—— 同一个原因说四遍，
  //    加起来近百像素，真机上这一页就装不下。置真之后各卡不再重复原因，
  //    只在页顶说一次（见 wtPaintOffNote）。
  offNote: false,
  loginKind: '',     // '' = 不显示登录表单；'device' / 'score' = 正在登哪个
  lanes: null,       // {device:'ok'|'missing'|'error', score:…}；null = 还没读
  laneErr: {},       // 平台 -> 读失败的原因
  runStop: false,    // 用户点了「停」—— 跑任务时每一轮都要看它
  runGap: 0,         // 两次提交之间的间隔（ms），0 = 用默认 30 秒
  runDone: 0,        // 这一轮已经提交了几次（不是几个任务）
  runTotal: 0,       // 这一轮一共要提交几次
  // 这一轮**到目前为止挣到的分**（按任务列表里写的分值累加）。
  // 只用来在跑的时候把「可用」显示成 `35+25`；跑完以服务端读回来的为准。
  // 🔴 它是**估的**：平台给不给、给多少，只有重读积分才知道 —— 所以它
  //    只活在跑的这一段时间里，跑完立刻清零（见 wtRunAll 末尾）。
  runGain: 0,
  // 「+25」前面那个 35 —— 开跑那一刻读到的可用积分，**冻结住**。
  // 🔴 必须冻：`WT.score` 会被任何一次重读（切页、点刷新、后台回来）
  //    换成服务端的新数，而那个新数里可能已经含了这一轮的一半分。
  //    基准和增量不同源 = 屏幕上出现 `30+25`，用户读成 55 分
  //    （2026-11-12 用户报的）。基准跟着增量一起冻，两者才是一笔账。
  //    null = 没有基准（开跑时就没读到），那就不显示「+N」。
  runBase: null,
  bills: [],         // 消费记录（翻页是往里追加，不是替换）
  billErr: '',
  billsPage: 0,
  billsMore: false,
  billsLoaded: false,
  live: null,        // {did,name,at} 本地记的「刚才你启动了」——**不是**服务端状态
  last: null,        // {did,name,at,money|null} 刚停完那一次的结算（内存，不落盘）

  // ---- 0.27.1：积分兑换余额 ----
  ex: {
    open: false,     // 兑换那块默认收起（这一页已经很长）
    unit: 100,       // 档位，只有 100 / 1000（原版 amounts）
    qty: 1,          // 份数
    eid: '',         // 选中的钱包端点 id（空 = 用第一个）
    wallets: null,   // null = 还没读；[] = 确实没有钱包
    err: '',         // 读钱包失败的原因
    busy: false,     // 提交中（防连点，不是防重复提交）
  },
};

/** 把 kind 翻译成「用户下一步该做什么」。
 *  原样抛 `msg` 等于什么都没说 —— 每条错误用户要做的事都不一样。 */
function wtErrText(kind, msg) {
  const m = msg || '操作失败';
  if (kind === 'limit') return m + '。请勿立即重试，等待几分钟后再操作。';
  if (kind === 'net') return m + '。请更换网络后重试。';
  if (kind === 'sign') return m;
  return m;
}

/** 页内提示。说明用灰字（.note），出错才加 .bad。
 *  🔴 光写 `class="tip"` 是红字居中 —— 那是错误样式，不是提示样式。 */
function wtTip(msg, bad) {
  const el = $('wtTip');
  if (!msg) { el.hidden = true; el.textContent = ''; el.classList.remove('bad'); return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
}

/** 换一张图形验证码。
 *  🔴 服务端按 `s=key` 认这张图，所以**必须**先拿到新 key 再换 src，
 *     不能只改 src 上的时间戳 —— 那样图变了、key 还是旧的，发短信必错。 */
async function wtNewCaptcha() {
  const img = $('wtCapImg');
  try {
    const r = await api('/api/water/captcha');
    if (!r || !r.ok) { wtTip((r && r.error) || '没取到图形验证码', true); return; }
    WT.key = r.key;
    img.classList.remove('bad');
    img.src = r.url;
    $('wtGraph').value = '';
  } catch (e) {
    wtTip('没取到图形验证码：' + e.message, true);
  }
}

/** 短信倒计时。倒计时里按钮是禁用的 —— 不禁用的话用户会连点，
 *  服务端按 202 限流，报出来是「请求太频繁」，看着像我们坏了。 */
function wtCountdown(sec) {
  clearInterval(WT.timer);
  const btn = $('wtSend');
  let n = sec;
  const paint = () => {
    if (n <= 0) {
      clearInterval(WT.timer);
      WT.timer = 0; WT.cd = 0;
      btn.disabled = false;
      btn.textContent = '发送';
      return;
    }
    WT.cd = n;
    btn.disabled = true;
    btn.textContent = n + 's';
    n -= 1;
  };
  paint();
  WT.timer = setInterval(paint, 1000);
}

function wtShowOff(reason) {
  WT.expired = false;      // 卡要藏起来了，标记必须一起清（见 wtExpire 注释）
  // 🔴 账号卡在两种状态下都要显示 —— 它是「哪半功能缺账号」的唯一说明处。
  //    藏起来的话，用户只看到「没登录」，不知道该登哪个。
  wtPaintAccounts();
  $('waterOff').hidden = !WT.loginKind;   // 只有点了某一行才展开表单
  $('waterOn').hidden = true;
  $('wtExpired').hidden = true;
  // 这一页的主体是直饮水，没登录时给一句「还没登录 + 去登录」，
  // 登录表在「我的 → 账号管理 → 慧生活账号」。
  $('wtNeedLogin').hidden = !!WT.loginKind;
  // 🔴 「没登过」和「这次没读到登录状态」是两件事（reason='unknown'）。
  //    后者说成「还没登录」，人照着去登一遍，回来还是同一句 —— 白折腾。
  const unknown = (reason === 'unknown');
  $('wtNeedTitle').textContent = unknown ? '这次没读到登录状态' : '还没登录慧生活';
  $('wtNeedSub').textContent = unknown
    ? '网络无响应，账号不会丢，点下面重试'
    : '接水、余额、积分任务都要先登录。';
  $('wtGoLogin').textContent = unknown ? '重试' : '去登录';
  $('wtGoLogin').dataset.act = unknown ? 'retry' : '';
  // 进这一页就该看见一张能读的图。没有 key 才去要 —— 有 key 就说明
  // 刚才那张还没用过，换掉反而让用户白读一次。
  if (WT.loginKind && !WT.key) wtNewCaptcha();
}

/** 直饮水「还没连上」的那一行。
 *  🔴 只讲**要做的事**：去哪登、登完能看什么。四张卡里各自那句
 *     「没读到：要用「设备登录」那个账号……」是同一件事的四个副本，
 *     它们占的高度正是这一页在真机上要滑的那 50px。 */
function wtPaintOffNote() {
  const el = $('wtOffNote');
  if (!el) return;
  const off = !WT.accounts.device;
  WT.offNote = off;
  el.hidden = !off || WT.expired;
  el.textContent = off
    ? '饮水还没连，去「账号管理」登设备账号。'
    : '';
}

function wtShowOn() {
  WT.expired = false;
  wtPaintAccounts();
  wtPaintOffNote();
  $('waterOff').hidden = !WT.loginKind;
  $('waterOn').hidden = false;
  $('wtNeedLogin').hidden = true;
  $('wtExpired').hidden = true;
  // 手机号打码：屏幕可能被别人看到，截图也会外传。露头尾够自己认就行
  // （和 maskUid 同一个理由）。
  const dev = WT.accounts.device;
  WT.phone = (dev && dev.phone) || '';
  // 右边这格是「这个号」。没登设备账号时写「未登录」，不写「—」：
  // 一个破折号在这一行看起来像「功能坏了」，而它其实是「还没登」。
  $('wtPhoneShown').textContent = WT.phone ? wtMaskPhone(WT.phone) : '未登录';
}

/** 慧生活的两个账号各自的状态变了 → 重画「账号管理」那一页。
 *
 *  🔴 2026-11-13：惠生活的两个登录**改回和别的账号同一种行**（用户：
 *     「账号管理改回类似 3/4 的样子，惠生活的两个登录视为两个账号」）。
 *     所以这里不再自己画一张卡，只把活交给 renderAccounts ——
 *     两份「账号长什么样」迟早会走岔，而那时屏幕上会出现两个不一致的状态。
 */
function wtPaintAccounts() {
  if (typeof wtPaintOffNote === 'function') wtPaintOffNote();
  if (typeof renderAccounts === 'function' && CUR_PAGE === 'accounts') renderAccounts();
}

/** 138****5678。太短的不打码（打完全看不出是什么了）。 */
function wtMaskPhone(p) {
  const s = String(p || '').replace(/\s+/g, '');
  if (s.length < 7) return s;
  return s.slice(0, 3) + '****' + s.slice(-4);
}

/** 登录过期。数据留着（能留的都留着），只把「要重登」这件事摆到最上面 ——
 *  整块换成登录表单的话，用户看到的是「数据没了」，其实只是票过期了。
 *
 *  🔴 **这一张卡是唯一的声音**：不把服务端那句「登录状态过期了，要重新登录
 *     一次」再拼进来 —— 拼出来是「…要重新登录一次。重新登录一次就行…」，
 *     同一句话说两遍。而且余额和设备那两处也不再加红字，否则同屏三遍。
 *     固定的文案写在 index.html 的 `.sub` 里，这里只管显示。 */
function wtExpire(kind) {
  WT.expired = true;
  // 🔴 必须点名是哪个账号。两个账号各管一半：只写「登录过期了」，
  //    用户重登了另一个回来还是这一句 —— 2026-11-08 就是这么转圈的。
  WT.expiredKind = (kind === 'device' || kind === 'score') ? kind : '';
  const k = WT.expiredKind;
  const name = k === 'device' ? '设备账号' : (k === 'score' ? '积分账号' : '');
  $('wtExpiredTitle').textContent = name ? (name + '登录过期了') : '登录过期了';
  $('wtExpiredSub').textContent = name
    ? (k === 'device'
        ? '接水、余额需要它，重新登录即可。'
        : '积分、任务需要它，重新登录即可。')
    : '一段时间后会失效，重新登录。';
  $('wtRelogin').textContent = name ? ('重新登录' + name) : '重新登录';
  $('wtExpired').hidden = false;
}

/** 画余额。🔴 `null` 走「没读到」，绝不兜底成 0。 */
function wtPaintBal() {
  const tip = $('wtBalTip');
  // 🔴 2026-11-13：余额这个数**只画一处** —— 顶上那张「饮水」小卡（`#mcWaterV`）。
  //    这里原来还有 `<div id="wtBalV">` 的大字，和顶上那张写的是同一个数；
  //    真机 360×712 上功能页本来只剩 36px 余量，并排两张小卡一加就溢出 48px。
  //    同一个数在一屏上出现两遍，用户还会问「以哪个为准」。
  //    所以大字撤了，这里只留「没读到的原因」——它平时 hidden，占 0px。
  if (tip) {
    if (WT.balErr && !WT.expired && !WT.offNote) {
      tip.hidden = false;
      tip.classList.add('bad');
      tip.textContent = '余额没读到：' + WT.balErr;
    } else {
      tip.hidden = true;
      tip.classList.remove('bad');
      tip.textContent = '';
    }
  }
  // 顶上那张「饮水」小卡跟着这个数走（余额的唯一落点）。
  if (typeof paintMiniWallets === 'function') paintMiniWallets();
}

/** 画设备列表。🔴「一台都没有」和「没读到」必须分开说：
 *  前者要去慧生活798 里绑一台，后者是网络/接口问题 —— 该做的事完全不同。 */
/* --------------------------------------- 手动添加的设备（0.28.1）
 * 场景：教学楼的机器不在「我的设备」里，扫一下二维码就知道它是哪台。
 *
 * 🔴 归一是照原版 `DeviceIdParser.normalize()` **逐条**抄的：
 *      · 先 URL-decode 一次（二维码里常常是编码过的）
 *      · 键值形式：`?did=xxx` / `&deviceId:xxx` / `{"id":"xxx"}`
 *      · hnkzy.com 的路径里取最后一段 8~32 位纯数字
 *      · 路径里有 device/did/bind/q/qr 这类标记时，取标记**之后**那段
 *        （6~64 位字母数字，而且**必须含数字** —— 纯字母的 "bind" 不算编号）
 *      · 都没有就把整串当设备号
 *    ⚠️ `_lab/out/check_device_id.py` 拿一张表钉着这套规则，改一边必须改另一边。
 *
 * 🔴 **不扫相机**：WebView 读相机要额外的二维码解码库 + 相机权限（那会在
 *    第一次接水时弹一个「允许使用相机」，为了一件偶尔才做的事不值得），
 *    而系统相机本来就会读二维码，复制过来是同一个结果。
 */
const WT_DEV_KEY = 'wt.devs.local';
/* 0.37.0：自己起的名字。服务端那几台的名字是慧生活798 里的设备名（常常是
   「3号机」这种），楼里好几台都叫这个。这里存的是**本机别名**，只覆盖显示，
   不发给服务端 —— 我们没有改名的接口，假装改了只会让下次刷新白回来。 */
const WT_NAME_KEY = 'wt.names.local';
/* 0.37.0：「在本机隐藏」。服务端绑的那几台删不掉（删了下次刷新又回来），
   但用户可能就是想让它别占这一行 —— 记在本地，不画出来，随时能恢复。 */
const WT_HIDE_KEY = 'wt.hide.local';
/* 0.52.1：贴纸编号 → 设备编号。
   机器上那张蓝环贴纸里是 `nfc.html?q=<贴纸芯片的序列号>`，不是设备号 ——
   用户 2026-11-11 两头都给了：贴纸上是 1D893A12171080（7 字节，正是 NFC
   标签 UID 的长度），东油通里这台机器是 869810053542983。两个换算不出来，
   只有慧生活的服务器认那个对应关系。
   所以：第一次碰见这张贴纸时问一句「是哪台」，记在这儿，以后一碰就出水。 */
const WT_TAG_KEY = 'wt.tags.local';

function wtLocalDevs() {
  const a = store.get(WT_DEV_KEY, []);
  return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : [];
}

/** 本机别名表。键是设备编号，值是最多 20 字的显示名。 */
function wtNames() {
  const o = store.get(WT_NAME_KEY, {});
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {};
  Object.keys(o).forEach((k) => {
    if (typeof o[k] === 'string' && o[k]) out[k] = o[k];
  });
  return out;
}

function wtSetName(id, name) {
  const o = wtNames();
  if (name) o[id] = String(name).slice(0, 20);
  else delete o[id];
  store.set(WT_NAME_KEY, o);
}

function wtHidden() {
  const a = store.get(WT_HIDE_KEY, []);
  return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : [];
}

function wtHideDev(id) {
  const a = wtHidden();
  if (a.indexOf(id) < 0) a.push(id);
  store.set(WT_HIDE_KEY, a.slice(-50));
}

function wtUnhideAll() {
  store.set(WT_HIDE_KEY, []);
}

/** 贴纸编号 → 设备编号（见 WT_TAG_KEY 上的说明）。认不出来的形状一律当空。 */
function wtTagMap() {
  const o = store.get(WT_TAG_KEY, {});
  return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
}

/** 记住「这张贴纸是哪一台」。只留最近 20 张 —— 这是用过的机器，不是通讯录。 */
function wtTagBind(code, did) {
  const o = wtTagMap();
  o[String(code)] = String(did);
  const ks = Object.keys(o);
  if (ks.length > 20) ks.slice(0, ks.length - 20).forEach((k) => { delete o[k]; });
  store.set(WT_TAG_KEY, o);
}

/** 从本机列表里撤掉一条（不碰服务端名单）。
 *  只给「临时记上、结果没接成」那一趟用，见 wtNfcStart 末尾。 */
function wtDropLocalDev(id) {
  store.set(WT_DEV_KEY, wtLocalDevs().filter((x) => x !== id));
}

function wtSaveLocalDev(id) {
  const a = wtLocalDevs();
  if (a.indexOf(id) < 0) a.push(id);
  // 只留最近 20 个：这是「快捷入口」，不是通讯录。旧的不清会一直涨。
  store.set(WT_DEV_KEY, a.slice(-20));
  // 重新加回来的时候顺手从「已隐藏」里摘掉 —— 不然加了却看不见，
  // 用户只会以为「加失败了」（这两件事都不报错）。
  const h = wtHidden().filter((x) => x !== id);
  store.set(WT_HIDE_KEY, h);
}

function wtDevFromUrl(value) {
  let u = null;
  try { u = new URL(value); } catch (e) { return ''; }
  const scheme = String(u.protocol || '').replace(':', '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'ilife'
      && scheme !== 'hyt') return '';
  const dec = (v) => { try { return decodeURIComponent(v); } catch (e) { return v; } };
  const segs = String(u.pathname || '').split('/')
    .map(dec).map((x) => x.trim()).filter(Boolean);
  if (!segs.length) return '';
  // 我们自己的贴纸（0.52.0 v7）：hyt://water/<编号>。
  // 不走下面那套「找关键词、再找 8~32 位数字」的启发式 —— 这个地址是我们
  // 自己写上去的，格式确定，按确定格式解比猜准。机器上的二维码那种
  // 各家平台格式不一，才需要猜。
  if (scheme === 'hyt') {
    if (String(u.hostname || '').toLowerCase() !== 'water') return '';
    return String(segs[segs.length - 1] || '').slice(0, 64);
  }
  const strong = (v) => /^\d{8,32}$/.test(v);
  const flex = (v) => /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/.test(v) && /\d/.test(v);
  const host = String(u.hostname || '').toLowerCase();
  if (host === 'hnkzy.com' || host.endsWith('.hnkzy.com')) {
    for (let i = segs.length - 1; i >= 0; i -= 1) if (strong(segs[i])) return segs[i];
  }
  const MARK = ['device', 'devices', 'did', 'bind', 'binding', 'q', 'qr'];
  let idx = -1;
  for (let i = segs.length - 1; i >= 0; i -= 1) {
    if (MARK.indexOf(segs[i].toLowerCase()) >= 0) { idx = i; break; }
  }
  if (idx >= 0) {
    for (let i = segs.length - 1; i > idx; i -= 1) if (flex(segs[i])) return segs[i];
  }
  const last = segs[segs.length - 1];
  return strong(last) ? last : '';
}

/** 二维码内容 / 手动输入 → 设备编号。认不出就返回空串（**不编一个**）。 */
function wtNormDevice(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  try { s = decodeURIComponent(s); } catch (e) { /* 不是编码过的，原样用 */ }
  const KEY = /(?:[?&#;,\s{]|^)["']?(?:did|deviceId|device_id|id)["']?\s*(?:=|:)\s*["']?([^&#\/,}\s"']+)/i;
  const m = KEY.exec(s);
  let got = m ? m[1] : '';
  if (!got) got = wtDevFromUrl(s);
  if (!got) got = s;
  got = got.trim();
  // 原版是 removeSurrounding("\"") 再 removeSurrounding("'")：**两端都有**才去掉，
  // 只有一端不动；而且两步是**先后**做的（'"abc"' 会先掉双引号再掉单引号）。
  const rm = (v, q) => (v.length >= 2 && v[0] === q && v[v.length - 1] === q)
    ? v.slice(1, -1) : v;
  got = rm(rm(got, '"'), "'");
  // 同样两步、同样区分大小写：原版只认 "did:" 和 "DID:" 这两种写法。
  if (got.slice(0, 4) === 'did:') got = got.slice(4);
  else if (got.slice(0, 4) === 'DID:') got = got.slice(4);
  return got.slice(0, 160);
}

/** 服务端设备 + 本机手动添加的，按 id 去重（服务端优先，名字更准）。
 *  0.37.0：再过两道本机的闸 —— 别名覆盖、已隐藏的不画。 */
function wtDevRows() {
  const server = Array.isArray(WT.devs) ? WT.devs : [];
  const names = wtNames(), hide = wtHidden();
  const out = [], seen = {};
  server.forEach((d) => {
    const id = String((d && d.id) || '').trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, name: names[id] || (d && d.name) || '', local: false });
  });
  wtLocalDevs().forEach((id) => {
    if (seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, name: names[id] || '', local: true });
  });
  return out.filter((d) => hide.indexOf(d.id) < 0);
}

/** 被隐藏了几台。**只数还在列表里的那些** —— 设备早就不在服务端了
 *  （在慧生活798 里解绑了），隐藏记录还留着的话，这个数会一直虚高。 */
function wtHiddenCount() {
  const hide = wtHidden();
  if (!hide.length) return 0;
  const alive = {};
  (Array.isArray(WT.devs) ? WT.devs : []).forEach((d) => {
    const id = String((d && d.id) || '').trim();
    if (id) alive[id] = 1;
  });
  wtLocalDevs().forEach((id) => { alive[id] = 1; });
  return hide.filter((id) => alive[id]).length;
}

/** 机器上那张蓝环贴纸（慧生活/支付宝铺的）里写的是什么。
 *
 *  用户 2026-11-11 碰了一下饮水机，我们弹「这不是饮水机的卡」，
 *  原文是 `https://i.ilife798.com/nfc.html?q=1D893A12171080`。
 *  —— 那**是**饮水机，只是它写着慧生活的地址：`q` 就是这台机器的编号。
 *
 *  🔴 只认这一个地址形态，别的一概不看：
 *     · host 必须**正好**是 ilife798.com 或它的子域。写成
 *       `indexOf('ilife798.com') >= 0` 的话，`evil.com/?x=ilife798.com`
 *       也能骗到我们 —— 那是一条能塞任意编号的链接。
 *     · 路径必须是 /nfc.html，参数里必须有 q；q 还得过 wtDevIdOk。
 *       认不出就返回空串，让上层说「这不是饮水机的卡」—— **不猜**。
 */
function wtVendorCode(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const m = /^https?:\/\/(?:[A-Za-z0-9-]+\.)*ilife798\.com\/nfc\.html\?(.*)$/i.exec(s);
  if (!m) return '';
  const segs = m[1].split('&');
  for (let i = 0; i < segs.length; i += 1) {
    const eq = segs[i].indexOf('=');
    const k = eq < 0 ? segs[i] : segs[i].slice(0, eq);
    if (decodeURIComponent(k) !== 'q') continue;
    const v = eq < 0 ? '' : segs[i].slice(eq + 1);
    let got = v;
    try { got = decodeURIComponent(v); } catch (e) { got = v; }
    got = got.trim();
    return wtDevIdOk(got) ? got : '';
  }
  return '';
}

/** 存之前再看一眼：这一串**像不像**设备编号。
 *
 *  🔴 只挡「明显不是」的三种：整条链接（含 `/`）、一句话（含空白）、
 *     长得离谱（>64）。不设「至少几位数字」这种门槛 —— 门槛是编出来的，
 *     真设备号多长我们并不知道；而接水时服务端认不认，本来就是最终判据。
 *     之所以要挡，是因为扫到「官网二维码」时归一的结果就是整条 URL，
 *     存进去之后接水才报错，用户会以为是我们的问题。 */
function wtDevIdOk(id) {
  const s = String(id || '');
  if (!s || s.length > 64) return false;
  if (/[\/\s]/.test(s)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(s);
}

/** 「扫码」那枚图标：有相机就扫码，没有就直接给输入框。
 *  没有 `getUserMedia`（桌面浏览器、http 的网页版）时弹一个永远黑的浮层
 *  是最糟的选择 —— 用户只会以为坏了。 */
function wtAddDevStart() {
  if (wtScanReady()) { wtScanOpen(); return; }
  wtAddDev();
}

/** 「手动输入」那枚图标（0.37.0）：**不进相机**，直接要编号。
 *  和扫码分开是有必要的 —— 扫码那条路在没相机时会退化成输入框，但反过来
 *  不行：用户明确点了「手动输入」，再给他弹一次相机权限是答非所问。
 *  机器身上印的编号、同学发来的一串数字、二维码里的整段内容，都走这里。 */
async function wtAddDev() {
  const raw = await openInput('添加饮水机',
    '机器上印的编号，或者二维码里的那串内容',
    '设备编号', '添加');
  if (raw == null) return;                    // 点了取消
  const id = wtNormDevice(raw);
  if (!id) { toast('没读到内容，再贴一次'); return; }
  if (!wtDevIdOk(id)) { toast('这不是设备编号'); return; }
  wtSaveLocalDev(id);
  wtPaintDevs();
  toast('已添加');
}

/* ---- 扫码（0.31.0） --------------------------------------------------
   为什么自己解：系统相机确实能读二维码，但要用户「拍照→回相册→复制文字
   →切回来粘贴」，四步。这里点一下、对着码停半秒就好了。
   解码用 jsQR（见 jsqr.js），相机用 getUserMedia —— WebView 从 5.0 起就支持，
   前提是原生那边把相机权限批给网页（MainActivity.onPermissionRequest）。

   🔴 三条容易踩的：
     ① 关浮层必须 stop 轨道，否则相机一直开着、指示灯常亮，下次再开还会
        报「被占用」（NotReadableError）。
     ② 打开相机是异步的，等的过程中用户可能已经把浮层关了 ⇒ 拿到流之后
        要再确认一次浮层还在，不在就立刻掐掉。
     ③ 视频还没出画面时 videoWidth 是 0，往 canvas 上画会得到空图 ⇒ 每帧
        先看 videoWidth，画布尺寸也按它算。 */

const WT_SCAN = { stream: null, timer: 0, waitT: 0, last: '', cv: null };

/** 能不能扫。少任何一样都给粘贴那条路，不硬来。
 *  ⚠️ 这里**不再检查 `window.jsQR`** —— 它现在按需加载，点开扫码之前
 *     本来就不在。真正用之前会 `await wtLoadJsQR()`（见 wtScanOpen）。 */
function wtScanReady() {
  return !!(navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof document.createElement('canvas').getContext === 'function');
}

/** 把 jsQR 那个 250KB 的解析器装上。**只在点扫码时调**。
 *
 *  为什么从 <script> 里挪走（0.42.0）：它原来在首屏同步加载，于是每次冷启动
 *  都要先解析完这 250KB 才能继续 —— 而它只在「扫码加饮水机」用过一次。
 *  挪走之后启动少一段主线程时间；代价是第一次点扫码要多等它装一下，
 *  用「正在打开相机…」那句遮住就够了（相机本身也要几百毫秒才出画面）。
 *
 *  🔴 同一个 Promise 复用：连点两下不能注入两个 <script>。
 *     失败要**清掉缓存的 Promise**，否则一次失败之后永远不再重试。 */
let jsqrPromise = null;
function wtLoadJsQR() {
  if (window.jsQR) return Promise.resolve(true);
  if (jsqrPromise) return jsqrPromise;
  jsqrPromise = new Promise((done) => {
    const s = document.createElement('script');
    s.src = 'jsqr.js';
    s.async = true;
    s.onload = () => { done(!!window.jsQR); };
    s.onerror = () => { jsqrPromise = null; done(false); };
    document.head.appendChild(s);
  });
  return jsqrPromise;
}

function wtScanSay(msg) { $('wtScanTip').textContent = msg; }
/** 取景器正中间那句话。同一条信息放这儿比放底部 hint 更靠眼睛，
 *  但只放**状态**；怎么解决写在底部 hint 里。 */
function wtScanWait(msg) { $('wtScanWaitT').textContent = msg; }

/** 相机起不来时统一收尾：撤掉取景框，图标转红，把话说清楚。 */
function wtScanFail(head, why) {
  $('wtScan').classList.add('bad');
  $('wtScanWait').hidden = false;
  wtScanWait(head);
  wtScanSay(why);
}

async function wtScanOpen() {
  if (!$('wtScan').hidden) return;
  WT_SCAN.last = '';
  $('wtScan').hidden = false;
  $('wtScan').classList.remove('bad');
  $('wtScanWait').hidden = false;
  wtScanWait('正在打开相机…');
  wtScanSay('把二维码放进框里');

  // 解码器现在按需装（见 wtLoadJsQR 的注释）。**先装再开相机**：
  // 反过来就是相机已经亮了、却发现解不了码，用户会以为是相机坏了。
  // 装不上也不报「出错」—— 说清楚还有另一条路就行。
  if (!(await wtLoadJsQR())) {
    if (!$('wtScan').hidden) {
      wtScanFail('这台设备现在扫不了码', '用下面「粘贴二维码内容」添加，效果一样。');
    }
    return;
  }
  // 装脚本这段时间用户可能已经把浮层关了。相机不许开（开了也没人看，
  // 还亮着指示灯）。
  if ($('wtScan').hidden) return;

  // 🔴 5 秒没动静就把话说清楚。
  //    有些机器上 getUserMedia 会**一直不 resolve**（系统权限框被吞掉、
  //    WebView 没把请求交出去），表现就是永远停在「正在打开相机…」。
  //    这里**不 reject、也不放弃**：用户之后点了「允许」，画面照样会来；
  //    只是别让他在那 5 秒之后还以为「再等等就好」。
  const slow = setTimeout(() => {
    if (WT_SCAN.stream) return;
    wtScanFail('相机还没起来', '可能没给相机权限。用不了就点下面粘贴。');
  }, 5000);

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },   // 手机上有后置就用后置
      audio: false,
    });
  } catch (e) {
    clearTimeout(slow);
    // 「没给权限」和「没有相机」要说不同的话：一种能去设置里打开，
    // 另一种只能换个办法。
    const n = (e && e.name) || '';
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      wtScanFail('没给相机权限',
        '去「设置 → 应用 → 东油通」开相机，或粘贴');
    } else if (n === 'NotFoundError') {
      wtScanFail('这台设备没有相机', '用「粘贴二维码内容」添加，效果一样。');
    } else {
      wtScanFail('相机打不开',
        '可能被其他 App 占用，关闭后重试或粘贴');
    }
    return;                                     // 浮层留着，「粘贴」在下面
  }
  clearTimeout(slow);

  // ① 等相机的这段时间里浮层可能已经被关了
  if ($('wtScan').hidden) {
    stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
    return;
  }

  WT_SCAN.stream = stream;
  const v = $('wtScanV');
  v.srcObject = stream;
  try { await v.play(); } catch (e) { /* 静音自动播放；个别 WebView 仍会拒，下面按帧等画面 */ }

  // ② 拿到流 ≠ 有画面（有些机器要一两秒才出第一帧）。
  //    以 videoWidth 为准再撤占位层，不然会先闪一下黑，再出现那个大三角。
  const show = () => {
    if (WT_SCAN.stream !== stream) return;
    if (!v.videoWidth) return;
    $('wtScanWait').hidden = true;
    $('wtScan').classList.remove('bad');
    wtScanSay('把二维码放进框里');
    if (WT_SCAN.waitT) { clearInterval(WT_SCAN.waitT); WT_SCAN.waitT = 0; }
  };
  show();
  WT_SCAN.waitT = setInterval(show, 120);

  WT_SCAN.timer = setInterval(wtScanTick, 160);
}

/** 关相机。**幂等**：没开的时候调用什么也不做。 */
function wtScanStop() {
  if (WT_SCAN.timer) { clearInterval(WT_SCAN.timer); WT_SCAN.timer = 0; }
  if (WT_SCAN.waitT) { clearInterval(WT_SCAN.waitT); WT_SCAN.waitT = 0; }
  const s = WT_SCAN.stream;
  WT_SCAN.stream = null;
  if (s) {
    try { s.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} }); } catch (e) {}
  }
  const v = $('wtScanV');
  try { v.pause(); } catch (e) {}
  try { v.srcObject = null; } catch (e) {}
  $('wtScan').hidden = true;
  // 下一次打开要回到干净状态：失败态的「bad」不能带过去，
  // 否则第二次点「添加设备」会先闪一屏红字。
  $('wtScan').classList.remove('bad');
  $('wtScanWait').hidden = false;
  wtScanWait('正在打开相机…');
  WT_SCAN.last = '';
  wtScanSay('把二维码放进框里');
}

/** 每帧：缩到 640 宽再解。手机原图 1280 宽，jsQR 要扫全部像素，
 *  不缩的话低端机上会掉到每秒几帧、还费电；二维码不需要那么细。 */
function wtScanTick() {
  const v = $('wtScanV');
  if (!v || !v.videoWidth) return;              // ③ 还没出画面
  const w = v.videoWidth, h = v.videoHeight;
  const sc = Math.min(1, 640 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
  if (!WT_SCAN.cv) WT_SCAN.cv = document.createElement('canvas');
  const cv = WT_SCAN.cv;
  if (cv.width !== cw) cv.width = cw;
  if (cv.height !== ch) cv.height = ch;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, 0, 0, cw, ch);
  let img = null;
  try { img = g.getImageData(0, 0, cw, ch); } catch (e) { return; }
  // 解码器还没装好（或者装失败）就先不认这一帧 —— 相机照常显示，
  // 用户看得见自己在拍什么，不会以为是死界面。
  if (!window.jsQR) return;
  let r = null;
  try {
    r = window.jsQR(img.data, cw, ch, { inversionAttempts: 'dontInvert' });
  } catch (e) { return; }
  if (r && r.data) wtScanTaken(r.data);
}

/** 解出一条码。认不出是设备就**留在相机里**继续扫，只改提示那句。 */
function wtScanTaken(raw) {
  const text = String(raw || '').trim();
  if (!text || text === WT_SCAN.last) return;   // 同一帧会连着解出好几次
  WT_SCAN.last = text;
  const id = wtNormDevice(text);
  if (!wtDevIdOk(id)) { wtScanSay('这不是饮水机的码'); return; }
  wtScanStop();
  wtSaveLocalDev(id);
  wtPaintDevs();
  toast('已添加');
}

/** 移到后台（切 App、锁屏）就关相机：前台服务都没开，凭什么开着摄像头。 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !$('wtScan').hidden) wtScanStop();
});

/* ---- 设备行的「⋯」（0.37.0）----------------------------------------
 * 以前：手动加的那几台有一颗 ✕，服务端绑的那几台**什么都没有** ——
 * 同一行左边一个样右边一个样，看着像「这几台不是我的」。
 * 现在每台都有同一个「⋯」，点开三件事：重命名 / 复制编号 / 移除。
 *
 * 🔴 三件事都**只动本机**，一件都不往服务端发：
 *      · 改名 —— 没有改名接口，发了也没用；
 *      · 复制 —— 只是把编号放进剪贴板，方便发给同学；
 *      · 移除 —— 手动加的删记录，服务端绑的记「本机隐藏」。
 *    服务端那几台真删不掉（下次刷新会回来），所以文案必须说「隐藏」，
 *    说「删除」就是在骗人。
 */

/** 复制到剪贴板。返回是否成功。
 *
 *  🔴 用 `execCommand` 而不是 `navigator.clipboard`：后者要求**安全上下文**，
 *     而 APK 里的页面源是 `https://app.local` —— 不是每个 ROM 都认它是安全的。
 *     认不出时 clipboard 直接 undefined，调用就抛，而且**没有任何提示**。
 */
function wtCopy(text) {
  const s = String(text || '');
  if (!s) return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;'
      + 'opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, s.length);
    const ok = document.execCommand ? document.execCommand('copy') : false;
    document.body.removeChild(ta);
    if (ok) return true;
  } catch (e) { /* 落到下面 */ }
  return false;
}

/** 改名。清空再保存 = 恢复原名（服务端给的那个 / 「手动添加的饮水机」）。 */
async function wtRenameDev(row) {
  const v = await openInput('重命名',
    '只改本机显示，慧生活798 里的名称不变',
    '给这台起个名字', '保存', row.name || '');
  if (v == null) return;
  const name = String(v).trim().slice(0, 20);
  wtSetName(row.id, name);
  wtPaintDevs();
  toast(name ? '已重命名' : '已恢复原名');
}

/** 复制编号。复制不了就把编号摊开让用户自己长按 —— 不能只说一句「失败」。 */
async function wtCopyDev(row) {
  if (wtCopy(row.id)) { toast('已复制编号'); return; }
  await openInput('复制编号', '长按下面这串选中，再复制', '', '好', row.id);
}

/** 移除。手动加的删记录，服务端绑的只在本机隐藏。
 *
 *  0.44.0：确认从「底部弹层」改成**气泡**（popconfirm），就地长在「⋯」旁边。
 *  两句话还是原来那两句 —— 服务端那几台真删不掉（下次刷新会回来），
 *  所以文案必须说「隐藏」，说「删除」就是骗人。
 */
function wtRemoveDev(row, anchor) {
  const local = !!row.local;
  const title = local ? '移除这台设备？' : '在这台手机上隐藏？';
  const sub = local
    ? '移除后要接水得重新贴一次二维码'
    : '它仍在慧生活798 名下，随时可恢复。';
  const yes = local ? '移除' : '隐藏';
  wtPopShow(anchor,
    '<div class="wtpop-t">' + esc(title) + '</div>' +
    '<div class="wtpop-s">' + esc(sub) + '</div>' +
    '<div class="wtpop-btns">' +
      '<button class="wtpop-btn" data-no>取消</button>' +
      '<button class="wtpop-btn danger" data-yes>' + esc(yes) + '</button>' +
    '</div>',
    (el, close) => {
      el.querySelector('[data-no]').addEventListener('click', close);
      el.querySelector('[data-yes]').addEventListener('click', () => {
        close();
        if (local) wtDropLocalDev(row.id);
        else wtHideDev(row.id);
        wtPaintDevs();
      });
    });
}

/* ---------------- 气泡菜单 / 气泡确认（0.44.0） ----------------
 *
 * 用户 2026-11-03：「饮水机右侧那三个点，点击后不要在底部出现弹窗，
 * 改成 popconfirm 这种气泡确认框」。
 *
 * 🔴 为什么底部弹层在这里是错的：点的是列表第三行的「⋯」，弹层却从**屏幕
 *    另一头**升起来，还盖住整页 ——「我在这一行点的东西，怎么跑到下面去了」
 *    是人的第一反应。气泡贴在按钮旁边，源头和结果在同一个地方。
 *
 * 🔴 只做「就地变成问句」，不做整页确认：点「在本机隐藏」时，菜单原地换成
 *    一行问句 + 取消/隐藏。**不换一屏、不改变位置** —— 换屏的话，用户刚要
 *    点的位置变成了别的东西，误触就是一次不可撤销的操作。
 */
// ⚠️ 用 `var` 而不是 `let`：switchTab 在文件更靠前的位置就要能安全地调
//    wtPopClose（换页时关气泡）。`let` 在那一行执行之前是 TDZ，调用即抛。
var wtPop = null;      // { el, down, key, scroll }

/** 关掉当前气泡。重复调用是空操作。 */
function wtPopClose() {
  if (!wtPop) return;
  const p = wtPop;
  wtPop = null;
  document.removeEventListener('pointerdown', p.down, true);
  document.removeEventListener('keydown', p.key, true);
  window.removeEventListener('scroll', p.scroll, true);
  window.removeEventListener('resize', p.scroll);
  if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
}

/** 在 anchor 旁边开一个气泡。html 是内容，bind(el) 负责绑事件。
 *
 *  ⚠️ 位置一律**夹在屏幕内**：贴着右边缘那一颗「⋯」如果右对齐再往外长，
 *     在窄屏上会有一半跑到屏幕外 —— 而它是 fixed 定位，跑出去就点不到了。
 */
function wtPopShow(anchor, html, bind) {
  wtPopClose();
  if (!anchor || !anchor.getBoundingClientRect) return;
  const el = document.createElement('div');
  el.className = 'wtpop';
  el.innerHTML = html;
  document.body.appendChild(el);

  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  // 右边缘对齐按钮，再夹进屏幕
  let left = r.right - w;
  if (left < 8) left = 8;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  // 优先朝下；下面放不下就翻到上面去
  let top = r.bottom + 6, up = false;
  if (top + h > window.innerHeight - 8) {
    const above = r.top - h - 6;
    if (above >= 8) { top = above; up = true; }
    else { top = Math.max(8, window.innerHeight - h - 8); }
  }
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
  el.classList.toggle('up', up);

  // 点外面 / 按 Esc / 滚动 —— 三条路都能关。滚动必须关：
  // 气泡是 fixed 的，页面一滚它就悬在别的行上面，指着一台不相干的设备。
  //
  // 🔴 点「开它的那颗按钮」**不在这里关**（2026-11-13）。以前这里无条件关：
  //    pointerdown 先把气泡关了，紧接着那颗按钮的 click 又把它打开 ——
  //    用户看到的是「再点一次三个点，菜单闪一下又出来」，永远关不掉。
  //    现在这一下留给按钮自己判断（见 wtPaintDevs 里 data-more 的 click）。
  const down = (e) => {
    if (el.contains(e.target)) return;
    if (anchor.contains && anchor.contains(e.target)) return;
    wtPopClose();
  };
  const key = (e) => { if (e.key === 'Escape') wtPopClose(); };
  const scroll = () => { wtPopClose(); };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', scroll);

  // anchor 一起记下来：按钮要靠它认出「这个气泡是我开的」。
  wtPop = { el, down, key, scroll, anchor };
  if (typeof bind === 'function') bind(el, wtPopClose);
  return el;
}

/** 点「⋯」弹出的气泡菜单。
 *
 *  三件事都**只动本机**，一件都不往服务端发（见上面那段老注释）。
 *  选「在本机隐藏 / 移除」时，气泡**就地**变成确认问句（popconfirm）。
 */
function wtDevMenu(row, anchor) {
  const pick = (id) => {
    wtPopClose();
    if (id === 'rename') wtRenameDev(row);
    else if (id === 'copy') wtCopyDev(row);
    else if (id === 'write') wtNfcWrite(row);
    else if (id === 'remove') wtRemoveDev(row, anchor);
  };
  const items = [
    { id: 'rename', name: '重命名' },
    { id: 'copy', name: '复制编号' },
    // 碰一碰（0.52.0 v7）：把贴纸写成这台机器。只在 APK 里有 —
    // 网页版没有 NFC，摆一颗点了只会说「用不了」的菜单项是骗人。
    // 位置在「移除」**上面**：下面那颗是不可撤销的那类操作。
  ].concat(nfcApi() ? [{ id: 'write', name: '写一张卡' }] : []).concat([
    { id: 'remove', name: row.local ? '移除' : '在本机隐藏', danger: true },
  ]);
  wtPopShow(anchor,
    items.map((it) =>
      '<button class="wtpop-i' + (it.danger ? ' danger' : '') +
      '" data-act="' + escAttr(it.id) + '">' + esc(it.name) + '</button>').join(''),
    (el) => {
      el.querySelectorAll('[data-act]').forEach((b) => {
        b.addEventListener('click', () => pick(b.dataset.act));
      });
    });
}

function wtPaintDevs() {
  const box = $('wtDevs'), tip = $('wtDevTip'), n = $('wtDevN');
  const devs = wtDevRows();
  const hid = wtHiddenCount();
  // 卡头的台数。**读到 0 台时不写「0 台」** —— 那种情况下面的提示文字
  // 已经在说「还没绑」，卡头再喊一句 0 台是同一个坏消息说两遍。
  if (n) n.textContent = devs.length > 1 ? (devs.length + ' 台') : '';
  if (devs.length) {
    // 正在接水的那一台：按钮原地变成「停止」（红色），名字下面多一行小字。
    // 2026-11-10 之前这条是页面顶部单独一条 `#wtLive`（用户：「不要在顶部
    // 单独显示退出，直接把接水按钮换成退出就行了」）。
    const liveDid = (WT.live && WT.live.did) || '';
    box.innerHTML = devs.map((d) => {
      const on = !!liveDid && liveDid === d.id;
      return '<div class="wtdev">' +
        // 0.49.0：设备编号不再显示。用户 2026-11-07：「我的饮水机在饮水机名字
        // 底下的编号不要显示出来，看着很乱」。
        // 🔴 只是不画出来，`data-did` 照样带着真正的编号 —— 接水和菜单都靠它。
        '<span class="wtdev-main' + (on ? ' has-sub' : '') + '">' +
          '<span class="wtdev-name">' + esc(d.name || '手动添加的饮水机') + '</span>' +
          (on ? '<span class="wtdev-sub">' + esc(wtLiveText()) + '</span>' : '') +
        '</span>' +
        '<button class="wtdev-go' + (on ? ' stop' : '') + '" data-did="' + escAttr(d.id) + '"' +
        ' data-name="' + escAttr(d.name || '') + '"' +
        (on ? ' aria-label="停止接水"' : '') + '>' +
        (on ? (wtStopping ? '正在停…' : '停止') : '接水') + '</button>' +
        // 「⋯」放在**最右**：菜单本来就在行尾，而「接水」要是被挤到边上，
        // 主操作就只剩 2px 的余量贴着卡片边缘。
        '<button class="wtdev-more" data-more="' + escAttr(d.id) + '"' +
        ' aria-label="更多操作">' +
          '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/>' +
          '<circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>' +
        '</button>' +
      '</div>';
    }).join('');
    // innerHTML 会把旧节点连同监听一起扔掉 ⇒ 每次重画都重新绑一遍。
    // 不重绑的话第二次进来点了没反应，而且**不报错**。
    // 同一颗按钮两种身份：`.stop` 的是「停这次水」，其余是「接水」。
    box.querySelectorAll('button[data-did]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.classList.contains('stop')) wtStop();
        else wtStart(b.dataset.did, b.dataset.name);
      });
    });
    box.querySelectorAll('button[data-more]').forEach((b) => {
      b.addEventListener('click', () => {
        // 这颗按钮开着的那个气泡还在 ⇒ 这一下就是「收起来」。
        // 一颗按钮管一件事的两头：点开、再点关。别在这里做成「关掉再开」——
        // 那和「点了没反应」在屏幕上长得一模一样（用户 2026-11-13 报的就是这个）。
        if (wtPop && wtPop.anchor === b) { wtPopClose(); return; }
        const row = wtDevRows().filter((x) => x.id === b.dataset.more)[0];
        // 0.44.0：把**这颗按钮**传下去当锚点 —— 气泡要长在它旁边。
        if (row) wtDevMenu(row, b);
      });
    });
  } else {
    box.innerHTML = '';
  }

  // 「已隐藏 N 台」那一行：**只在本机真藏了东西时出现**。
  const showRow = $('wtDevShow'), showN = $('wtDevHideN');
  if (showRow) {
    showRow.hidden = !hid;
    if (hid && showN) showN.textContent = hid + ' 台 · 恢复';
  }

  if (WT.devErr && !WT.expired) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '设备列表没读到：' + WT.devErr;
  } else if (!devs.length && !WT.expired && !hid) {
    // ⚠️ 全部被隐藏时**不说「还没有绑定」** —— 那是「没有」和「被我藏了」
    //    两件不同的事，说错了用户会去慧生活798 重新绑一台。
    tip.hidden = false;
    tip.classList.remove('bad');
    // 一句话说完。原来那句「要在慧生活798 里先绑一台，绑完这里就能看到」
    // 换行成两行，多占 20px —— 而「去哪儿绑」下面那颗「添加设备」已经说了。
    tip.textContent = '这个账号名下还没有绑定饮水机，去慧生活798 绑一台。';
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }

  // 🔴 0.40.0：一台设备都没有的时候，「接水会真的出水扣钱；充值、绑一卡通
  //    去慧生活798 里做。」这句没有对象 —— 没有设备就接不了水，而上面那行
  //    提示已经在说「还没有绑定，去慧生活798 绑一台」。这 22px 换成一句
  //    读不通的话，正是这一页在「刚装好、什么都还没登」时多出来的高度。
  //    有设备时它永远在（风险告知不能省）。
  const risk = $('wtRisk');
  if (risk) risk.hidden = !devs.length;
}

/** 「积分 / 任务 / 钱包 / 账单」上一次读的时刻，以及新鲜期。
 *
 *  为什么要有：这一页有四块要联网，而用户会在 tab 之间来回切。
 *  每次切回来都重读，一天能打出几十次什么都不会变的请求 ——
 *  更要命的是会把「跑任务中途」的半截数读回来（见 wtPaintScore 那段）。
 *  30 秒是量着定的：切去看一眼公告再回来，还在期内；真的想刷新就点右上角。 */
const WT_FRESH_MS = 30000;
let wtExtrasAt = 0;
let wtExtrasBusy = false;

/** 拉一次余额 + 设备。
 *  🔴 这两件事**分开报错**：一个挂了不该把另一个也变成「读不到」，
 *    也不许安静吞掉（「没读到」和「没有」是两件事）。后端已经是这个形状，
 *    这里只负责照着画。 */
async function wtLoad() {
  // 0.27.0：页头只剩一颗刷新（直饮水并进功能页了），忙态挂在它身上。
  // 🔴 只能加 class，**不能设 disabled** —— 这颗按钮现在同时管「刷门户」，
  //    接水那边一请求它就灰掉的话，用户想刷一卡通会点不动（而且不报错）。
  const btn = $('cpRefresh');
  if (btn) btn.classList.add('busy');
  try {
    const r = await api('/api/water/home');
    if (!r || !r.ok) {
      // auth 是唯一需要换页面状态的：其余错误就地把话说清楚
      if (r && r.kind === 'auth') { wtExpire('device'); }
      WT.bal = null;
      WT.balErr = (r && r.error) || '读不到';
      WT.devErr = (r && r.error) || '读不到';
      wtPaintBal();
      wtPaintDevs();
      return;
    }
    WT.expired = false;      // 读到了 ⇒ 票是好的，把过期标记清掉
    WT.bal = (typeof r.balance === 'number' && isFinite(r.balance)) ? r.balance : null;
    WT.balErr = r.balanceError || '';
    WT.devs = Array.isArray(r.devices) ? r.devices : [];
    WT.devErr = r.devicesError || '';
    WT.loadedAt = Date.now();
    wtPaintBal();
    wtPaintDevs();
  } catch (e) {
    WT.bal = null;
    WT.balErr = e.message;
    WT.devErr = e.message;
    wtPaintBal();
    wtPaintDevs();
  } finally {
    if (btn) btn.classList.remove('busy');
  }
}

/* ---- 0.24.0：积分 / 积分任务 / 消费记录 ----------------------------
   三块各自独立拉、各自独立报错。合成一次请求的话，任务接口挂了余额也会
   跟着变「没读到」，用户会以为账号出问题 —— 而该做的事完全不同。

   🔴 全部守同一条：`null` ≠ `0`。
      积分没读到写「没读到」，金额没读到写「金额没读到」，
      绝不写 0 分 / ¥0.00 —— 前者像「今天没挣到」，后者像「这单免费」。 */

/** 画积分。两个数各自判断：一个读到、一个没读到，也要分开说。 */
function wtPaintScore() {
  const paint = (id, n) => {
    const el = $(id);
    if (typeof n === 'number' && isFinite(n)) {
      el.className = 'wtpair-v';
      el.textContent = String(n);
    } else {
      el.className = 'wtpair-v unknown';
      // 同 wtPaintBal：「积分账号没登」和「读失败」是两件事。
      // 积分归 score 那个账号管，所以看的是 accounts.score，不是 offNote。
      el.textContent = WT.accounts.score ? '没读到' : '登录后显示';
    }
  };
  const sc = WT.score;
  const vEl = $('wtScoreValid');

  // 跑任务的时候把「可用」写成 `35+25`：35 是开跑前读到的，+25 是这一轮
  // 已经挣到的（2026-11-08 用户要求）。用主色（和进度条同一个颜色），
  // 一眼能看出后半截是**这次新挣的**，不是余额里本来就有的。
  //
  // 🔴 2026-11-12：前半截必须用**冻结的** `WT.runBase`，不能再用 `sc.valid`。
  //    原因：`sc.valid` 会被任何一次重读换掉，而重读拿到的是平台结算到一半
  //    的数。5 分起步、这一轮挣了 25 ⇒ 中间重读回 30 ⇒ 屏幕上是 `30+25`，
  //    用户读成 55 分。基准和增量必须**同一时刻、同一来源**。
  //    代价：跑的过程中「可用」不再跟着服务端跳 —— 这正是我们要的，
  //    真数以跑完那一刻重读回来的为准。
  // 🔴 只在有基准、且这一轮真的挣到了分时才加 —— 基准都没读到时
  //    写「没读到+25」是胡说。
  const gain = Number(WT.runGain) || 0;
  const base = (typeof WT.runBase === 'number' && isFinite(WT.runBase))
    ? WT.runBase : null;
  const layered = gain > 0 && base !== null;
  paint('wtScoreValid', layered ? base : (sc ? sc.valid : null));
  paint('wtScoreTotal', sc ? sc.total : null);
  if (vEl && layered) {
    const g = document.createElement('span');
    g.className = 'wtgain';
    g.textContent = '+' + gain;
    vEl.appendChild(g);
  }

  const tip = $('wtScoreTip');
  if (WT.scoreErr && !WT.expired && !WT.offNote) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '积分没读到：' + WT.scoreErr;
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }
  wtExPaint();
}

/* ---------------------------------------------------- 积分兑换余额（0.27.1）
 * 照出水小部件的 WalletActivity 做的同一件事：
 *   1000 积分 = ¥1，档位只有 100 / 1000，份数从 1 起，**一次提交**。
 *
 * 🔴 请求体只传**总积分**、不传份数（原版 `ScoreExchangeParserTest` 明确断言
 *    body 里没有 `count`）。份数是界面自己乘出来的。
 * 🔴 拿到账单号 ≠ 兑换完成：要再查一次 `bill.status === 3` 才算。
 * 🔴 任何一步失败都**不自动重试** —— 重试等于再扣一次积分。网络类失败连
 *    「到底扣没扣」都不知道，所以文案是「先别重复兑换」，不是「再试一次」。
 */
const WT_EX_UNITS = [100, 1000];

/** 档位 × 份数 = 这次要花的积分；不合法返回 null（**不兜底成 0**）。
 *
 *  和原版 `ScoreExchangeParser.totalScore` 逐条对应：档位只能是 100/1000，
 *  份数 ≥1，且不能超过「可用积分买得起的份数」。
 *  ⚠️ 这条规则**只写这一份** —— 网页版和 APK 跑的是同一份 app.js，
 *     没有第二份需要对齐（再写一份就是「各自合规、其实早已分叉」）。
 */
function wtExTotalOf(unit, qty, avail) {
  const u = Number(unit), q = Number(qty), a = Number(avail);
  if (avail == null || !isFinite(u) || !isFinite(q) || !isFinite(a)) return null;
  if (WT_EX_UNITS.indexOf(u) < 0) return null;
  if (q < 1 || a < 0) return null;
  if (q > Math.floor(a / u)) return null;
  return u * q;
}

/** 「全部兑换」能换几份：可用积分 ÷ 档位，向下取整。
 *  ⚠️ 读不到可用积分时返回 0（= 现在没得换），**不猜一个数** —— 猜大了
 *     提交上去只会被服务端拒，用户以为是按钮坏了。 */
function wtExMaxQty(unit, avail) {
  const u = Number(unit), a = Number(avail);
  if (!isFinite(u) || u <= 0 || !isFinite(a) || a < 0) return 0;
  return Math.floor(a / u);
}

/** 现在选中的钱包。没选过就用第一个（只有一个钱包时这是唯一的那个）。 */
function wtExCurWallet() {
  const ws = Array.isArray(WT.ex.wallets) ? WT.ex.wallets : [];
  if (!ws.length) return null;
  const hit = ws.filter((w) => w.endpointId === WT.ex.eid)[0];
  return hit || ws[0];
}

/** 画兑换那块。入口的显示条件由它自己成不成立决定（红线 50）：
 *  有可用积分、读到了钱包、没在读钱包的错误 —— 三条都满足才给入口。
 *  否则点进去只能说「没有钱包」，那是挖坑。 */
function wtExPaint() {
  const open = $('wtExOpen'), box = $('wtExBox');
  if (!open || !box) return;
  const ws = Array.isArray(WT.ex.wallets) ? WT.ex.wallets : [];
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  const can = ws.length > 0 && !WT.ex.err && avail != null && !WT.expired;
  open.hidden = !can;
  if (!can) { box.hidden = true; WT.ex.open = false; return; }
  box.hidden = !WT.ex.open;
  if (!WT.ex.open) return;

  const w = wtExCurWallet();
  // 多个钱包时这一行能点开选择器；只有一个时它就是标签 —— 箭头藏掉、按钮
  // 禁用。**不能**留一颗点了没反应的按钮（那比没有按钮更让人恼火）。
  const more = ws.length > 1;
  $('wtExWallet').textContent = (w && w.name) || '—';
  $('wtExChev').hidden = !more;
  $('wtExTo').disabled = !more;

  $('wtExUnits').querySelectorAll('.wtchip').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.unit) === WT.ex.unit);
  });
  $('wtExQty').textContent = String(WT.ex.qty);

  const total = wtExTotalOf(WT.ex.unit, WT.ex.qty, avail);
  const sum = $('wtExSum');
  if (total == null) {
    sum.textContent = '积分不够换这么多份。';
    sum.classList.add('bad');
  } else {
    sum.classList.remove('bad');
    // 1000 分 = ¥1，所以元 = 分 / 1000。留两位小数，别写成 ¥0.2000000001
    sum.textContent = '消耗 ' + total + ' 积分，兑 ¥' + (total / 1000).toFixed(2);
  }
  const go = $('wtExGo');
  go.disabled = total == null || WT.ex.busy;
  go.textContent = WT.ex.busy ? '兑换中…' : '兑换';
  // 「全部兑换」（0.44.0）。份数已经顶到上限时就没有意义了 —— 置灰，
  // 而不是让它点下去什么都不发生。
  const mx = $('wtExMax');
  if (mx) {
    const max = wtExMaxQty(WT.ex.unit, avail);
    mx.disabled = max < 1 || WT.ex.busy || max === WT.ex.qty;
  }
}

/** 「做完自动换成余额」开关的样子。默认开（老配置里没有这个键）。
 *  单独一个函数：任务卡每次重画都要调它，开关状态必须和 CFG 一致 ——
 *  两处各写一遍的话，会出现「关了但它还亮着」。 */
function wtPaintAutoEx() {
  const b = $('wtAutoEx');
  if (b) {
    const on = (CFG.wtAutoEx !== false);
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  // 0.50.0 v5：任务列表上面那一行「每天自己跑一遍」的右边要跟着开关变。
  // 和上面那颗开关同一处画：少画一次就会出现「开关开着、行里写着关着」。
  wtPaintAutoRow();
}

/** 「每天自己跑一遍」那一行右边那几个字。 */
function wtPaintAutoRow() {
  const v = $('wtAutoV');
  if (!v) return;
  const a = autoCfg();
  // 不再有「每天几点」这回事（2026-11-09 改的）：开着就写「开着」，
  // 具体「今天做完了没」在弹层里说 —— 那一行只有 44px，塞不下两件事。
  v.textContent = a.wtOn ? '已开启' : '已关闭';
}

/** 读钱包列表。读失败要说出来，不能安静当成「没有钱包」。 */
async function wtLoadWallets() {
  try {
    const r = await api('/api/water/wallets');
    if (!r || !r.ok) {
      WT.ex.wallets = null;
      WT.ex.err = (r && r.error) || '读不到';
    } else {
      WT.ex.wallets = Array.isArray(r.wallets) ? r.wallets : [];
      WT.ex.err = '';
      const cur = wtExCurWallet();
      WT.ex.eid = cur ? cur.endpointId : '';
    }
  } catch (e) {
    WT.ex.wallets = null;
    WT.ex.err = e.message;
  }
  wtExPaint();
}

/** 真正发那一次兑换请求。**只提交一次**，失败不重试。
 *
 *  抽出来是为了「全部兑换」和「做完自动换」共用同一段 —— 这段里有三条
 *  踩过坑的规矩（只提交一次 / 网络类失败说「结果未知，别重复兑换」/
 *  拿到账单号还要核 status === 3），抄第二份就一定会漏一条。
 *
 *  say(text) 是个可选的「进度播报」函数：手动兑换时写进面板，自动兑换时
 *  写进任务卡下面那行提示。
 *  返回 { done, text }。
 */
async function wtExSend(total, w, say) {
  const note = (typeof say === 'function') ? say : function () {};
  WT.ex.busy = true;
  wtExPaint();
  note('正在兑换…');

  let sn = '';
  try {
    const r = await api('/api/water/exchange', { eid: w.endpointId, score: total });
    if (!r || !r.ok) {
      // 🔴 网络类失败时**我们不知道扣没扣**。这时候让用户「再试一次」是最坏的
      //    建议（等于再扣一次），所以文案分开写。
      const netish = !r || !r.kind || r.kind === 'net' || r.kind === 'limit';
      WT.ex.busy = false;
      wtExPaint();
      return {
        done: false,
        text: netish
          ? '兑换结果未知：' + ((r && r.error) || '没连上') + '。请先到官方 App 核对记录，不要重复兑换。'
          : wtErrText(r && r.kind, r && r.error),
      };
    }
    sn = r.sn;
  } catch (e) {
    WT.ex.busy = false;
    wtExPaint();
    return { done: false,
             text: '兑换结果未知：' + e.message + '。请先到官方 App 核对记录，不要重复兑换。' };
  }

  // 拿到账单号只是「提交成功」。再查一次账单，status === 3 才算真的到账。
  note('已提交，正在核对…');
  let done = false, why = '';
  try {
    const b = await api('/api/water/exchange-bill?id=' + encodeURIComponent(sn));
    if (b && b.ok) {
      done = !!b.done;
      if (!done) why = '（账单状态 ' + b.status + '，还没完成）';
    } else {
      why = '（' + ((b && b.error) || '账单查不到') + '）';
    }
  } catch (e) {
    why = '（' + e.message + '）';
  }

  WT.ex.busy = false;
  wtExPaint();
  if (done) {
    // 余额和积分都变了 —— 两样都重读，别让界面停在旧数上
    if (WT.accounts.device) { wtLoad().catch(() => {}); }
    wtLoadScore().catch(() => {});
    return { done: true,
             text: '兑换完成：¥' + (total / 1000).toFixed(2) + ' 已到「' + w.name + '」。' };
  }
  return { done: false,
           text: '兑换结果待确认' + why + '。请先到官方 App 核对记录，不要重复兑换。' };
}

/** 手动兑换：算总数 → 确认 → 发出去 → 把结果写在面板里。 */
async function wtExGo() {
  if (WT.ex.busy) return;
  const w = wtExCurWallet();
  if (!w) return;
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  const total = wtExTotalOf(WT.ex.unit, WT.ex.qty, avail);
  if (total == null) return;

  // 这是账号行为、会扣积分，还要真金白银地变成余额 —— 必须二次确认。
  const ok = await askConfirm('兑换积分',
    '用 ' + total + ' 积分兑换 ¥' + (total / 1000).toFixed(2)
      + ' 到「' + w.name + '」。兑换只能提交一次，中途出错不会自动重试。',
    '兑换');
  if (!ok) return;

  const msg = $('wtExMsg');
  msg.hidden = false;
  msg.classList.remove('bad');
  const r = await wtExSend(total, w, (t) => { msg.textContent = t; });
  msg.classList.toggle('bad', !r.done);
  msg.textContent = r.text;
}

/** 任务跑完之后把积分换成余额（0.44.0，默认开）。
 *
 *  🔴 三条不做的事：
 *    1. **不问**。这是用户自己开的开关，每次都弹一个框等于把开关废掉；
 *       而且这时候他正等着看「今天挣了多少」。
 *    2. **不猜金额**。可用积分读不到、钱包读不到、上一次兑换结果未知 ——
 *       一律不动手，只在下面那行提示里说清楚为什么没换。
 *    3. **不重试**。兑换失败就是失败，重试等于再扣一次（见 wtExSend）。
 *
 *  返回一句要接在任务结果后面的话；没换就是空串。
 */
async function wtAutoExchange(doneCount) {
  if (CFG.wtAutoEx === false) return '';
  if (doneCount <= 0) return '';              // 这一轮一次都没成功，没什么可换
  if (WT.ex.busy) return '';                  // 用户正手动兑换着
  if (!WT.ex.wallets || WT.ex.err) {          // 钱包还没读到就现读一次
    await wtLoadWallets();
    if (WT.ex.err || !Array.isArray(WT.ex.wallets) || !WT.ex.wallets.length) return '';
  }
  const w = wtExCurWallet();
  if (!w) return '';
  const avail = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;
  if (avail == null) return '';
  // 用大档位换：1000 分 = ¥1，和 100 分那档同价，但少一次记账。
  // 不够 1000 才退回 100 那档（比如只剩 350 分）。
  const unit = avail >= 1000 ? 1000 : 100;
  const qty = wtExMaxQty(unit, avail);
  if (qty < 1) return '';
  const total = unit * qty;

  const r = await wtExSend(total, w, null);
  return r.done ? ('，并把 ' + total + ' 积分换成了 ¥' + (total / 1000).toFixed(2))
                : ('。自动兑换没成功：' + r.text);
}

async function wtLoadScore() {
  // 🔴 2026-11-12：**跑任务的过程中不重读**。
  //    用户点「一键完成」之后会切页去看别的，切回「功能」页时
  //    `renderWater()` 会把积分再读一遍 —— 读回来的是平台结算到一半的数，
  //    和屏幕上那个「5+25」叠在一起就成了 `30+25`（读成 55 分）。
  //    这一轮的分以**跑完之后**那一次重读为准（见 wtRunAll 末尾），
  //    中间谁来要都不给。切页只重画，不联网。
  if (WT.running) { wtPaintScore(); return; }
  try {
    const r = await api('/api/water/score');
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire('score'); }
      WT.score = null;
      WT.scoreErr = (r && r.error) || '读不到';
    } else {
      WT.score = {
        valid: (typeof r.valid === 'number' && isFinite(r.valid)) ? r.valid : null,
        total: (typeof r.total === 'number' && isFinite(r.total)) ? r.total : null,
      };
      WT.scoreErr = '';
    }
  } catch (e) {
    WT.score = null;
    WT.scoreErr = e.message;
  }
  wtPaintScore();
}

/** 画任务列表。
 *
 *  🔴 「还剩几次」是**自己算的** `limit - used`，响应里没有现成的剩余
 *     （`missions[i].limit` 是总次数，`accScoreRsp.limits[j].limit` 是已做次数，
 *      同名反义 —— 见 water.py 那一大段）。
 *
 *  🔴 按钮的显示条件是 `canRun`（有任务、没读失败）。0.26.0/0.26.1 那两版
 *     写的是「永远不显示，因为盐值没公开」—— 那个前提是错的（盐在官方 APK
 *     里，2026-10-30 取到）。现在签名自己算，不看响应里有没有 `sign`。
 */
/** 「这一页要跑的东西」= 签到（如果有）+ 全部积分任务。
 *
 *  🔴 只写**一处**。列表、计数、确认框、执行循环全部从这里拿 —— 0.26.2 就是
 *     列表和执行各写一遍，结果卡片写「共 3 个」、确认框写「2 个」（红线 59）。
 *  🔴 签到排第一行，因为它是每天必做的那一件；`kind` 决定用哪个请求体：
 *     签到 `{weekday, adId}` / 任务 `{adId, type:101}`。**不能混**（见 wtRunAll）。
 *  ⚠️ 服务端的任务列表里有时也会带一条「每日签到」（refId == daily.adId），
 *     先按 id 剔掉再补我们自己的那一行，否则会重复。
 */
/* ---------------- 今天做完的任务，记在本机（0.49.0） ----------------
 *
 * 用户 2026-11-07：「接水界面的今日任务，每天无论做了多少任务，再次打开都是
 * 待做 8 个」。
 *
 * 🔴 病根是状态只活在内存里：`WT.run` 是这一轮跑出来的，关掉 App 就清零；
 *    而服务端返回的「已做次数」并不总是跟着变（有缓存，也有平台自己没刷的时候）。
 *    两边都不记得 ⇒ 每次打开都是全新的一天，用户看着像白做。
 *
 * 所以按**日期**记一份在本机：今天是哪天、哪几条做完了、一共几条。
 * 换天整体作废 —— 昨天的「已完成」不能拿来标今天。
 * 它只影响界面上的「已完成」标记和「待做 N 个」的计数，**不影响真的会跑哪些**：
 * 真跑什么仍然由服务端给的剩余次数决定（见 wtRunnableRows）。
 */

/** 本机今天。用本地时区，不用 UTC —— `toISOString()` 会把 00:00-08:00 算成前一天。 */
function wtToday() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 读今天那份记录。日期对不上（换天了）就返回一个空的，不写盘。 */
function wtDoneLoad() {
  const empty = { d: wtToday(), done: {}, total: 0 };
  try {
    const raw = localStorage.getItem(KEY.wtDone);
    if (!raw) return empty;
    const o = JSON.parse(raw);
    if (!o || o.d !== empty.d) return empty;
    return {
      d: o.d,
      done: (o.done && typeof o.done === 'object') ? o.done : {},
      total: Number(o.total) || 0,
    };
  } catch (e) {
    return empty;
  }
}

function wtDoneSave(o) {
  try {
    localStorage.setItem(KEY.wtDone, JSON.stringify(o));
  } catch (e) {
    // 存不下不影响这一次的使用，只是下次打开又不记得了。
  }
}

/** 这一条今天是不是已经做完了（本机记的）。 */
function wtDoneHas(refId) {
  if (!refId) return false;
  return !!wtDoneLoad().done[refId];
}

/** 记一条「今天做完了」。跑任务成功后立刻调，**不要等整轮跑完** ——
 *  中途停下 / 断网时，已经成功的那些也算数。 */
function wtDoneMark(refId, total) {
  if (!refId) return;
  const o = wtDoneLoad();
  o.done[refId] = 1;
  if (typeof total === 'number' && total > 0) o.total = total;
  wtDoneSave(o);
}

/** 记下「今天一共有几条任务」—— 桌面小组件要靠它算进度。
 *  只在读列表成功时调；读失败时**不动**旧值（旧的至少是个参考，
 *  清零的话小组件会突然显示 0/0）。 */
function wtDoneTotal(n) {
  if (!(n > 0)) return;
  const o = wtDoneLoad();
  if (o.total === n) return;
  o.total = n;
  wtDoneSave(o);
}

/** 今天做完了几条（用于小组件和「今天的都做完了」那句结论）。 */
function wtDoneCount() {
  const o = wtDoneLoad();
  let n = 0;
  Object.keys(o.done).forEach((k) => { if (o.done[k]) n += 1; });
  return n;
}

function wtTaskRows() {
  const all = Array.isArray(WT.missions) ? WT.missions : [];
  const d = WT.daily;
  const dailyId = (d && d.adId) || '';
  const rest = dailyId ? all.filter((x) => x.refId !== dailyId) : all;
  if (!dailyId) return rest;
  const base = (typeof d.score === 'number' && isFinite(d.score)) ? d.score : null;
  return [{
    kind: 'signin',
    refId: dailyId,
    name: '每日签到',
    score: base,
    left: d.signed ? 0 : 1,
    used: d.signed ? 1 : 0,
    signed: !!d.signed,
  }].concat(rest);
}

/** 真正**还能跑**的那些（签过的签到不算）。
 *  计数、确认文案、按钮的可用性都按它算 —— 和 `wtTaskRows()` 是同一次计算
 *  的两个视角，不是两份数据。 */
function wtRunnableRows() {
  return wtTaskRows().filter((x) => {
    // 签到：平台说今天签过了，就不算这一轮待做
    if (x.kind === 'signin' && x.signed) return false;
    // 🔴 0.35.0：剩余次数被平台算成 0，就是「今天做完了」。
    //    以前只认签到那一行，于是八个任务全跑完、每一行都写着「已完成」，
    //    上面的计数还写着「待做 8 个」—— 同一张卡里两句话互相打架，
    //    用户会以为「一键完成」没生效。
    //    left 是后端用 limit - used 算出来的；None 表示「不限次」或「读不到」，
    //    那种**不能**当成做完了。
    if (typeof x.left === 'number' && x.left <= 0) return false;
    // 🔴 0.49.0：本机记着今天做完了的也不再算待做。
    //    服务端的「已做次数」并不总是立刻跟着变，只信它的话，用户关掉 App
    //    再打开就会看到一个「待做 8 个」的全新页面（他刚才明明做完了）。
    //    这条和上一条不重复：上一条是**平台说**做完了，这条是**我们眼看着**
    //    做完了 —— 两种来源都要认。
    if (wtDoneHas(x.refId)) return false;
    return true;
  });
}

/** 单个任务封顶几次、整轮封顶几次。
 *  30 秒一次 ⇒ 60 次是半小时。上限不是「省事」，是防止平台给一个离谱的
 *  剩余次数（比如 999）把我们变成一台刷分机器。 */
const WT_MAX_PER_TASK = 10;
const WT_MAX_TOTAL = 60;

/** 这个任务这一轮要提交几次。
 *
 *  🔴 0.40.3 修的就是这里。以前**每个任务只提交一次** —— 而平台的任务是
 *     「一天能做 N 次、每做一次给一份分」。于是「看视频 30 分 × 5 次」我们
 *     只拿到 30 分，官方那边拿 150。用户 2026-11-02：「出水小部件每天能搞
 *     二三百积分，你这个却只有不到 100」—— 差的正是没做的那些次。
 *
 *  `left` = 平台算出的剩余次数（limit - used）。null 有两种情况：
 *    · 已做次数是 -1（平台说「不限次」）
 *    · 已做次数压根没读到（limits 里没有这条）
 *  两者都**不是**「做完了」，退回按任务自己的总次数 `limit` 算，
 *  再不行才做一次 —— 不能因为读不到就只做一次，那正是这次的 bug。
 */
function wtTimesOf(x) {
  const cap = (v) => Math.max(1, Math.min(WT_MAX_PER_TASK, Math.floor(v)));
  if (x && x.kind === 'signin') return 1;      // 签到一天就一次
  if (x && typeof x.left === 'number' && isFinite(x.left) && x.left > 0) return cap(x.left);
  if (x && typeof x.limit === 'number' && isFinite(x.limit) && x.limit > 0) return cap(x.limit);
  return 1;
}

/** 跑任务时那一块「正在进行 + 进度条」（0.49.0）。
 *
 *  用户 2026-11-07：「点一键完成的时候别显示全部任务了，点一下直接显示
 *  正在进行任务，可以加个进度条」。
 *
 *  🔴 数字和标题行右边那个「3/8 次」是**同一份**（WT.runDone / WT.runTotal），
 *     不是各算一遍 —— 各算一遍就会出现「进度条走到头、数字还停在 2/8」。
 *  🔴 只做显隐，不重画列表：列表那一棵树跑完要原样露出来，重画会把
 *     刚标上的「已完成」搞丢。
 */
function wtPaintRunNow(items) {
  const box = $('wtRunNow'), list = $('wtMissions');
  if (!box || !list) return;
  box.hidden = !WT.running;
  list.hidden = !!WT.running;
  if (!WT.running) return;

  const total = Number(WT.runTotal) || 0;
  const doneN = Math.min(Number(WT.runDone) || 0, total);
  const row = (items || []).filter((x) => x.refId === WT.cur)[0];

  const nm = $('wtRunNowName');
  // 没有正在跑的那一条（两轮之间那一瞬）别留空标题 —— 空白看起来像卡住了。
  if (nm) nm.textContent = row ? (row.name || '这一条') : '正在做';
  const ct = $('wtRunNowCnt');
  if (ct) ct.textContent = doneN + '/' + total;
  const fill = $('wtRunNowFill');
  // total 为 0 时宽度写 0，不要写 NaN% —— 那会让整条进度条消失。
  if (fill) fill.style.width = (total > 0 ? Math.round(doneN * 100 / total) : 0) + '%';

  const sub = $('wtRunNowSub');
  if (sub) {
    // 两次提交之间要等 30 秒，这段时间最容易让人以为卡住了。
    // 这句话说清「已经做完的不会白做」—— 正好是这次修的那件事。
    sub.hidden = doneN === 0;
    sub.textContent = doneN > 0 ? '已完成的部分已记录，关闭本页不会丢失' : '';
  }
}

function wtPaintMissions() {
  const box = $('wtMissions'), tip = $('wtMissionTip'), btn = $('wtRunAll');
  const items = wtTaskRows();
  const todo = wtRunnableRows();
  // 开关的样子跟着 CFG 走（关掉之后还亮着 = 骗人）
  wtPaintAutoEx();

  box.innerHTML = items.map((it) => {
    const st = WT.run[it.refId] || '';
    // 签到已经签过：直接标「已签」，不参与这一轮，也不显示「剩 0 次」那种怪话
    const signed = it.kind === 'signin' && it.signed && !st;
    // 0.35.0：平台算出的剩余次数为 0 —— 今天这个任务到次数了。
    // 和签到同一个待遇：标一句「今天做完了」，不给「剩 0 次」（读起来像还能做零次）。
    const doneToday = !st && typeof it.left === 'number' && it.left <= 0;
    // 🔴 0.49.0：本机记着今天做完了（这次打开是关掉再开的，`WT.run` 已经清零）。
    //    没有这一条，重开 App 后八行又全是空白、卡头又写「待做 8 个」。
    const recorded = !st && !signed && !doneToday && wtDoneHas(it.refId);
    const cls = st === 'ok' ? 'ok' : st === 'bad' ? 'bad' : st ? 'wait'
              : (signed || doneToday || recorded ? 'ok' : '');
    const txt = st === 'ok' ? '已完成' : st === 'bad' ? '失败'
              : st ? '执行中'
              : (signed ? '今天已签'
                        : ((doneToday || recorded) ? '已完成' : ''));
    const money = (typeof it.score === 'number' && isFinite(it.score))
      ? '<span class="wtmission-s">+' + it.score + '</span>'
      : '<span class="wtmission-s unknown">分值没读到</span>';
    // 剩余次数：null = 不限次（或读不到），不显示 —— 别编一个数字出来
    // 签到那条固定「剩 1 次」/已签时不显示，它的次数没有意义
    const doneNow = doneToday || recorded || st === 'ok';
    const left = it.kind === 'signin' ? ''
      : doneNow ? ''
      : (typeof it.left === 'number' && isFinite(it.left))
        ? '<span class="wtmission-l">剩 ' + it.left + ' 次</span>'
        : (it.used === -1 ? '<span class="wtmission-l">不限次</span>' : '');
    return '<div class="wtmission' + (WT.cur === it.refId ? ' on' : '')
             + (signed || doneNow ? ' done' : '') + '">' +
             '<span class="wtmission-t">' + esc(it.name || it.refId) + '</span>' +
             left + money +
             (txt ? '<span class="wtmission-st ' + cls + '">' + txt + '</span>' : '') +
           '</div>';
  }).join('');

  // 🔴 0.26.2 起签名能算了（盐从官方 APK 里取到），所以按钮该出现就出现。
  //    仍然要求「至少有一条可跑的」—— 一条都没有时按钮没意义。
  //    计数用 `todo`（签过的签到不算），和确认文案是**同一个数**。
  const canRun = todo.length > 0 && !WT.missionErr;
  btn.hidden = !canRun || WT.running;
  // 🔴 0.35.0：这一轮已经跑成功的不再算「待做」。
  //    WT.run 记着本轮每一条的结果；不扣的话跑完八个，列表每行都写着
  //    「已完成」，卡头还是「待做 8 个」—— 同一张卡里两句话对着干。
  const pending = todo.filter((x) => WT.run[x.refId] !== 'ok');
  const allDone = todo.length > 0 && pending.length === 0;
  btn.disabled = WT.running || allDone;
  // 0.33.0：按钮从卡片底部的通栏按钮挪到标题行，文案跟着变短 ——
  // 「一键完成全部任务」八个字在标题行里会把它挤到下一行。
  btn.textContent = allDone ? '都做完了' : '一键完成';
  // 自动展开：正在跑的时候必须看得见每一行的状态和「停下」，
  // 否则收起状态跑起来就成了「按了没反应」。
  if (WT.running) {
    $('wtTaskBox').hidden = false;
    $('wtTaskOpen').setAttribute('aria-expanded', 'true');
  }
  // 0.49.0：跑的时候把八行列表换成一块「正在进行 + 进度条」。
  // 🔴 只改显隐，不动 innerHTML —— 列表那一棵还在，跑完原样露出来
  //    （重画反而会把刚标上的「已完成」搞丢）。
  wtPaintRunNow(items);
  const stop = $('wtRunStop');
  if (stop) stop.hidden = !WT.running;

  // 哪个平台没读到/没登，要在这儿说出来 —— 不说的话「任务只有这几条」
  // 看起来就是全部，用户不会想到「另一半在另一个账号里」。
  const laneMsg = (() => {
    const L = WT.lanes || {};
    const out = [];
    if (L.score === 'missing') out.push('积分账号没登，另一个平台的任务看不到');
    if (L.device === 'missing') out.push('设备账号没登，另一个平台的任务看不到');
    if (L.score === 'error') out.push('积分平台任务读失败：' + (WT.laneErr.score || ''));
    if (L.device === 'error') out.push('设备平台任务读失败：' + (WT.laneErr.device || ''));
    return out.join('；');
  })();

  const cnt = $('wtTaskCount');
  if (WT.running) {
    // 0.40.3：跑的时候按**次**报进度。按任务报的话，一个任务做 5 次
    // 界面上从头到尾都是「0/8」，看着像卡住了。
    cnt.textContent = WT.runDone + '/' + (WT.runTotal || 0) + ' 次';
  } else if (todo.length) {
    // 全做完了就说「做完了」。写「待做 0 个」是把一句结论说成一次统计。
    cnt.textContent = pending.length ? '待做 ' + pending.length + ' 个' : '今天的都做完了';
  } else {
    // 🔴 0.40.0：一条可做的都没有时，**结论写在标题行右边**，不再另起一行。
    //    原来这里下面是 `#wtMissionTip` 单独一行「现在没有可做的任务。」，
    //    33px 只说一句「没事可做」—— 这一页最紧的 25 像素就差在这。
    //    签过到、又没有别的任务 ⇒ 不是「没有任务」，是「今天的做完了」；
    //    这两句话对用户是两件事，所以照旧分开说，只是搬到标题行上。
    //    有 laneMsg 时不写，让下面那行提示独占（它才是用户不知道的事）。
    cnt.textContent = laneMsg ? ''
      : (items.length ? '今天的都做完了' : '没有可做的');
  }

  if (WT.missionErr && !WT.expired && !WT.offNote) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '任务列表没读到：' + WT.missionErr;
  } else if (laneMsg) {
    // 哪个平台没读到 / 没登 —— 这句话用户自己看不出来，必须占一整行说
    tip.hidden = false;
    tip.classList.remove('bad');
    tip.textContent = laneMsg;
  } else if (WT.missionSkipped > 0) {
    tip.hidden = false;
    tip.classList.remove('bad');
    tip.textContent = '有 ' + WT.missionSkipped + ' 条跳过（无 ID 或属于不支持的类别）。';
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }

  // 🔴 0.47.2：一条任务都没有、也没有话要说时，整个「今日任务」块**不画**。
  //    原来这时留着一条标题行，右边写「没有可做的」，点开是一个空列表 ——
  //    52px（上下留白 16 + 标题 32 + 间距 4）只说一句「没事可做」，
  //    而这 52px 正好是把这一页顶出一屏的那 21px（真机 360×712，
  //    内容 615 / 可用 594）。
  //    ⚠️ 不能连着「今天的都做完了」一起藏：那是**结论**（items 里有做完的
  //       条目），不是空状态；也不能在 laneMsg / 读失败 / 有跳过条目时藏，
  //       那些话是用户自己看不出来的事。只在真的什么都没有时藏。
  const nothing = !items.length && !WT.running && !tip.textContent;
  $('wtTaskCard').hidden = nothing;
}

/** 读任务列表（两个平台合并的那种）。
 *
 *  `keepRun` = true 时**保留** `WT.run`（本轮每行跑出来的状态）。
 *  跑完一轮要重新读一次「剩余次数」，但那时如果把状态清了，八行会一起变回
 *  空白 —— 看着像什么都没做。只有列表真的换了（重新登录 / 换账号）才清。
 */
async function wtLoadMissions(keepRun) {
  // 🔴 2026-11-12：跑的过程中切页回来，不许重读任务列表。
  //    重读会做两件坏事：① 剩余次数变成跑到一半的数（名单跳来跳去）；
  //    ② 调用点没传 keepRun 时把 `WT.run` 清空 —— 八行的「已完成」
  //    一起消失，用户以为白跑了。跑完那一次重读带 keepRun=true。
  if (WT.running && !keepRun) { wtPaintMissions(); return; }
  try {
    const r = await api('/api/water/missions');
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire('score'); }
      // 「积分任务一直失败」是 2026-11-06 那轮的主要问题。报上去才知道
      // 是所有人都失败（平台改版），还是只有某类账号失败。
      WT.missions = [];
      WT.missionErr = (r && r.error) || '读不到';
      WT.missionSkipped = 0;
      WT.daily = null;
      WT.lanes = null;
      WT.laneErr = {};
    } else {
      WT.missions = Array.isArray(r.items) ? r.items : [];
      WT.missionErr = '';
      WT.missionSkipped = Number(r.skipped) || 0;
      // 签到状态和任务列表是同一个响应里的两块（dailyRSP / accScoreRsp.daily）
      WT.daily = r.daily || null;
      // 哪个平台读了、哪个没登/读失败 —— 界面要靠它说「少的那半在另一个账号里」
      WT.lanes = r.lanes || null;
      WT.laneErr = r.errors || {};
      // 任务列表换了（比如重新登录），上一轮的状态就没意义了
      if (!keepRun) WT.run = {};
      // 0.49.0：记下「今天一共几条」—— 桌面小组件按它算进度条。
      // 放在 wtPaintMissions 之前，因为那里面会重算「待做 N 个」。
      wtDoneTotal(wtTaskRows().length);
      // 读到了新列表 ⇒ 小组件上那个分母变了。推一次（不推的话，
      // 用户加了平台、任务从 5 条变成 8 条，桌面上还写着 3/5）。
      widgetPush();
    }
  } catch (e) {
    WT.missions = [];
    WT.missionErr = e.message;
    WT.daily = null;
    WT.lanes = null;
    WT.laneErr = {};
  }
  wtPaintMissions();
}

const wtSleep = (ms) => new Promise((res) => { setTimeout(res, ms); });

/** 两次提交之间等一会儿。**默认 30 秒**，和原版 TokenTaskRateLimiter 一致。
 *
 *  为什么必须等：原版每次提交之间自己压 30 秒，说明打快了会被平台限流
 *  （服务端回 202），更糟的是可能触发风控 —— 而风控的后果是账号被限制、
 *  积分被冻结，不是「重试一下就好」。所以宁可慢。
 *
 *  等待期间每秒更新一次倒计时，并且**随时可以停** —— 让用户干等 30 秒
 *  看着屏幕不动，他会以为卡死了。
 *  返回 false = 用户点了「停」，调用方应该收工。 */
async function wtPace(ms) {
  // 🔴 后台那一路**必须一次睡完**，不能像前台那样「每 250ms 醒一次看时间」。
  //
  //    原因是 WebView 不在窗口上时，Chromium 把它当隐藏页面，`setTimeout`
  //    会被拉到至少 1 秒一次。前台那圈 `while` 循环跑 120 次 = 120 秒，
  //    30 秒的等待变成两分钟；十几次提交叠起来就是二十多分钟 ——
  //    而系统给单个后台任务的上限是 9 分钟，所以**永远跑不完**。
  //    这正是用户说的「积分任务仍然无法后台进行」。
  //
  //    一次 `setTimeout(30000)` 只被拉长一次（而且长定时器基本不受节流影响，
  //    被节流的主要是 1 秒以内的短定时器），误差是几秒不是几倍。
  if (BG_MODE) {
    if (ms > 0) await wtSleep(ms);
    return !WT.runStop;
  }
  const box = $('wtRunPace');
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    if (WT.runStop) {
      if (box) { box.hidden = true; box.textContent = ''; }
      return false;
    }
    const left = Math.ceil((endAt - Date.now()) / 1000);
    if (box) {
      box.hidden = false;
      // 光写「等 3 秒再提交下一个」像是在拖时间 —— 得说清是平台在限流，
      // 不是我们慢。这句话只在倒计时那几秒里出现，过了就消失。
      box.textContent = '等 ' + left + ' 秒（连着提交平台会冻结）';
    }
    await wtSleep(250);
  }
  if (box) { box.hidden = true; box.textContent = ''; }
  return !WT.runStop;
}

/** 提交**一次**（签到一次 / 任务一次）。前台循环和后台那一路共用这一个。
 *
 *  🔴 2026-11-12 抽出来的。原来这段写在 `wtRunAll` 的循环里，后台要复用
 *     就得抄一份 —— 而「签到走 signin、任务走 mission」这条分派错一次，
 *     服务端不会报错，只会把签到记成一次普通任务。只能有一处。
 *
 *  返回 `{ok:true}` 或 `{ok:false, kind, error}`；**不抛**（网络错了也是这条）。
 */
async function wtSubmitOne(it) {
  // 签到 `{weekday, adId}` / 任务 `{adId, type:101}`：两个 body 不能混。
  const d = WT.daily || {};
  try {
    const r = (it.kind === 'signin')
      ? await api('/api/water/signin', {
          adId: it.refId,
          weekday: (d.weekday >= 1 && d.weekday <= 7) ? d.weekday : 0,
          score: (typeof it.score === 'number' && isFinite(it.score)) ? it.score : 0,
        })
      : await api('/api/water/mission', {
          adId: it.refId, score: it.score, platform: it.platform || '',
        });
    if (r && r.ok) return { ok: true };
    const kind = (r && r.kind) || '';
    return { ok: false, kind: kind, error: wtErrText(kind, r && r.error) };
  } catch (e) {
    return { ok: false, kind: '', error: (e && e.message) || String(e) };
  }
}

/** 一键完成全部任务。
 *
 *  🔴 这是**第三个有副作用**的批量操作，而且一次动 N 次账号。三条自我约束：
 *     1. 二次确认，文案要说清「会真的动你的账号、可能被风控」
 *     2. **失败不重试**；连续两个失败就停下 —— 原项目 README 自己写着
 *        「出现异常时请停止任务，勿反复运行期待自动恢复」
 *     3. 跑完**重新读一次积分**来核验。服务端回「成功」不等于到账，
 *        原 README 也写着「请求成功不等于奖励到账」。不信提示，信数字。
 *
 *  🔴 0.40.3：**按次数跑，不是按任务跑**。平台的任务是「一天能做 N 次、
 *     每做一次给一份分」；以前每个任务只提交一次，等于把 N 分之 N-1 丢掉。
 */
async function wtRunAll() {
  if (WT.busy || WT.running) return;
  // 第一次点它：先把风险说清楚。点完「知道了」自动接着走（见 wtNeedTerms）
  if (!wtNeedTerms(() => { wtRunAll(); })) return;
  // 🔴 签到和任务**请求体不一样**，所以在下面的循环里按 `kind` 分派：
  //    签到 `{weekday, adId}` / 任务 `{adId, type:101}`。用错 body 服务端可能
  //    当成一次普通任务，甚至把「签到」记成「做任务」—— 而且**不报错**。
  //    原版也是两条独立的路（DailySignInPlanner / TaskMissionPlanner），
  //    只是被同一个按钮串起来跑。
  //    ⚠️ 用 `wtRunnableRows()` 而**不是**自己再过滤一遍：0.26.2 就是列表和
  //    执行各写一遍，结果列表没剔、执行剔了 ⇒ 卡片一个数、确认框另一个数。
  const items = wtRunnableRows();
  if (!items.length) return;

  // 每个任务做几次 + 这一轮一共几次。两个数都**算一次**，确认框、进度、
  // 循环全用它们 —— 三个地方各算一遍就会出现「说 8 次结果跑 5 次」。
  const plan = items.map((it) => ({ it: it, n: wtTimesOf(it) }));
  let total = plan.reduce((a, p) => a + p.n, 0);
  if (total > WT_MAX_TOTAL) {
    // 砍到上限为止：宁可少做几个，也不要一次把半小时以上排进去
    total = 0;
    for (const p of plan) {
      if (total + p.n > WT_MAX_TOTAL) { p.n = Math.max(0, WT_MAX_TOTAL - total); }
      total += p.n;
    }
  }

  /* 🔴 后台那一轮**必须再砍一刀**（2026-11-11）。
   *
   *     每次提交之间法定要等 30 秒（平台限流）。系统给单个后台任务的
   *     上限是 9 分钟，按 30 秒一次算，**最多也就十几下**。可是任务表
   *     摊开来常常二十几下 —— 一轮从来跑不完，每轮都被判超时，
   *     超时又被记成「失败」，三次之后当天彻底不动。
   *
   *     所以后台一次只做一小批（默认 5 下），剩下的留给下一个小时。
   *     这不是妥协：每小时 5 下，一天醒 8 轮就是 40 下，正常账号一天
   *     的任务量根本到不了这个数，而且每轮都在时限内稳稳跑完。
   *     ⚠️ 前台不受影响：用户点了「一键完成」，就该当场做完。 */
  if (BG_MODE && total > 0) {
    const cap = Math.max(1, Math.floor(Number(WT.bgCap) || 5));
    if (total > cap) {
      total = 0;
      for (const p of plan) {
        if (total + p.n > cap) p.n = Math.max(0, cap - total);
        total += p.n;
      }
    }
  }
  const multi = plan.some((p) => p.n > 1);

  // 🔴 0.44.0：**不再弹确认框**。用户 2026-11-03：「积分任务点击一键完成时
  //    不要再显示弹窗」。那颗按钮的名字就是「一键完成」—— 点完再问一次
  //    「要开始吗」，等于把它变成两颗按钮。
  //    风险告知没有消失：第一次点的时候那张说明（wtNeedTerms）还在，
  //    而且只出现一次；之后的每一次点击都直接开始。
  void multi;

  WT.running = true;
  WT.runStop = false;
  WT.run = {};
  WT.cur = '';
  WT.missionErr = '';
  WT.runDone = 0;
  WT.runTotal = total;
  WT.runGain = 0;      // 新一轮从 0 开始算「这次挣了多少」
  // 「+N」前面那个基准，**开跑这一刻冻住**（见 wtPaintScore 里那条说明）。
  // 中途任何重读都不许动它 —— 它是这一轮的起跑线，不是实时余额。
  WT.runBase = (WT.score && typeof WT.score.valid === 'number' &&
    isFinite(WT.score.valid)) ? WT.score.valid : null;
  const before = WT.runBase;
  wtPaintMissions();

  let done = 0, fails = 0, stopped = false, firstErr = '', authOut = false;
  let quotaOut = 0;      // 有几个任务是「第二次就被平台拒了」= 剩余次数已经到底
  let needPace = false;  // 两次提交之间至少 30 秒，第一次之前不用等
  let stopAll = false;

  // 🔴 0.40.3：外层是任务，内层是「这个任务做第几次」。
  for (let i = 0; i < plan.length && !stopAll; i += 1) {
    const it = plan[i].it, n = plan[i].n;
    let okCount = 0;      // 这个任务成功提交了几次
    for (let k = 0; k < n; k += 1) {
      // 等 30 秒放在**每次提交之前**（第一次除外）：这样无论上一条是成功、
      // 失败还是跳出，两次真实提交之间都隔着够长的时间。停下指令也在里面看。
      if (needPace && !(await wtPace(WT.runGap || 30000))) {
        stopped = true; stopAll = true; break;
      }
      needPace = true;
      if (k === 0) {
        WT.run[it.refId] = 'wait';
        WT.cur = it.refId;
        wtPaintMissions();
      }

      let bad = '', kind = '';
      {
        // 请求体、签名、错误分档全在 wtSubmitOne 里（后台也调它）。
        const r0 = await wtSubmitOne(it);
        if (r0.ok) {
          done += 1;
          okCount += 1;
          fails = 0;                 // 成功一次就重置，判的是「连续」失败
          // 🔴 0.49.0：成功一次就落盘记一笔，**不等整轮跑完**。
          //    中途点「停」/ 断网 / 被平台拦下时，已经成功的那些也算数 ——
          //    不记的话用户重开 App 会看到它们又变回「待做」。
          wtDoneMark(it.refId);
          // 0.50.0：把这一次挣到的分记进「本次新增」，界面上的「可用」
          // 就是 `35+25` 那个样子。分值按**任务列表里写的**算 —— 平台最后
          // 给多少，跑完重读积分才知道（所以它不是账，是进度）。
          if (typeof it.score === 'number' && isFinite(it.score) && it.score > 0) {
            WT.runGain += it.score;
            wtPaintScore();
          }
        } else {
          kind = r0.kind;
          bad = r0.error;
        }
      }
      WT.runDone += 1;

      if (bad) {
        if (!firstErr) firstErr = bad;
        if (kind === 'auth') authOut = true;
        if (k > 0) {
          // 第二次以后被拒 = 这个任务的次数比列表里显示的少（平台当天只剩这么多次）。
          // 这是**可预期**的，不是账号坏了：不计入「连续失败」，也不再重试这个任务。
          quotaOut += 1;
        } else {
          fails += 1;
          WT.run[it.refId] = 'bad';
        }
        break;
      }
      wtPaintMissions();
    }
    // 一个任务全部做完才标「已完成」：做 5 次的那个在第 1 次成功后
    // 就标上的话，后面 4 次还在跑，界面却已经说做完了。
    if (okCount > 0) WT.run[it.refId] = 'ok';
    WT.cur = '';
    wtPaintMissions();
    if (authOut) { wtExpire(); stopped = true; break; }
    if (fails >= 2) { stopped = true; break; }
  }

  WT.running = false;
  WT.runStop = false;
  WT.cur = '';
  const pace = $('wtRunPace');
  if (pace) { pace.hidden = true; pace.textContent = ''; }
  wtPaintMissions();

  // ---- 核验：重新读一次任务（剩余次数要跟着变）和积分，用数字说话 ----
  //     任务列表这一读**保留**本轮每行的「已完成」标记（keepRun），
  //     否则跑完八行全变回空白，看着像没跑。
  await wtLoadMissions(true);
  // 重读之前先把「+N」和它的基准一起清掉：屏幕上的可用分马上就要变成
  // 服务端那个真数，还留着基准的话，真数会被 `runBase+gain` 盖住 ——
  // 用户看到的是「开跑前那个数」，会以为这轮白跑了。
  // 🔴 两样必须**同时**清：只清 gain 不清 base，画出来的是开跑前的旧数；
  //    只清 base 不清 gain，画的又是服务端真数 + 一个孤零零的「+25」。
  WT.runGain = 0;
  WT.runBase = null;
  await wtLoadScore();       // 它自己会重画积分
  // 0.49.0：跑完把新的进度推给桌面小组件。
  // 不推的话，用户跑完八个任务回到桌面，那张卡片还写着「0/8」——
  // 而它下一次刷新是系统那半小时一跳（还不保证）。
  widgetPush();
  const after = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : null;

  // 🔴 0.49.0 v10：一个都没成的时候，别写「提交了 0 次（5 个任务），中途停下了」——
  //    用户要的是「为什么没成、我该干嘛」，不是一份执行报告。2026-11-08 那张
  //    截图里，这段报告后面还跟着同一句解释，一共三段，谁都不想读。
  let msg = '';
  const why = firstErr || '';
  if (done === 0 && why) {
    msg = '这次一个都没提交上：' + why;
  } else if (done === 0) {
    msg = '这次一个都没提交上';
  } else {
    msg = '提交了 ' + done + ' 次（' + items.length + ' 个任务）';
    if (stopped) msg += '，中途停下了';
  }
  if (quotaOut > 0) {
    msg += '。有 ' + quotaOut + ' 个任务做到一半平台就不收了（当天的次数已经用完）';
  }
  if (before != null && after != null) {
    const diff = after - before;
    msg += '，可用积分 ' + before + ' → ' + after;
    if (diff > 0) {
      msg += '（+' + diff + '）';
    } else if (diff < 0) {
      // 🔴 变少必须明说。只写「没变」等于把「积分被扣了」说成「什么都没发生」——
      //    用户看到这句就不会去查，而分数确实少了（红线 66g：变多自动接受、
      //    变少必须明说）。
      msg += '（少了 ' + (-diff) + ' 分 —— 积分已扣除，请注意）';
    } else if (done > 0) {
      msg += '（没变，可能还没到账）';
    }
  } else {
    msg += '，但积分没读到，到账情况核不了';
  }

  // ---- 做完就换（0.44.0，默认开）----
  // 🔴 放在「积分 before → after」之后：先让人看见今天挣了多少，
  //    再说「这些已经换成余额了」。反过来读起来像「白干了」。
  const exNote = await wtAutoExchange(done);
  if (exNote) msg += exNote;

  // 已经在上面的「一个都没提交上」里说过了，别重复第二遍
  if (firstErr && done > 0) msg += '。第一个错误：' + firstErr;

  const tip = $('wtMissionTip');
  tip.hidden = false;
  tip.classList.toggle('bad', done === 0 && !!firstErr);
  tip.textContent = msg;
}



/* 🔴 0.40.0：0.39.3 删「今日/本月/本年用水量」那一块时，剪切点选在了
   `function wtPaintBills() {` 这一行**下面** —— 函数头被删掉，52 行函数体
   留在了 `wtRunAll` 后面游离着（顶层执行，还顺手声明了几个同名 const）。
   结果是：三个调用点全报 `wtPaintBills is not defined`，消费记录列表
   整个空着，而且**不报错**的地方看起来一切正常。
   现在把函数原样补回来，只去掉结尾那句 `wtPaintStats()`（用水量三格，
   已随功能一起撤掉）。 */
function wtPaintBills() {
  const box = $('wtBills'), tip = $('wtBillTip'), more = $('wtBillMore');
  const items = Array.isArray(WT.bills) ? WT.bills : [];

  box.innerHTML = items.map((b) => {
    const money = (typeof b.money === 'number' && isFinite(b.money))
      ? '<span class="wtbill-money">¥' + b.money.toFixed(2) + '</span>'
      : '<span class="wtbill-money unknown">金额没读到</span>';
    const when = b.at ? ntStamp(b.at / 1000) : '';
    const sub = [when, b.did ? '设备 ' + b.did : ''].filter(Boolean).join(' · ');
    return '<div class="wtbill">' +
             '<span class="wtbill-main">' +
               '<span class="wtbill-t1">' + esc(b.msg || '消费') + '</span>' +
               (sub ? '<span class="wtbill-t2">' + esc(sub) + '</span>' : '') +
             '</span>' + money +
           '</div>';
  }).join('');

  // 加载更多：只在「确实还有下一页」时出现。靠「这页是不是满的」猜的话，
  // 最后一页正好装满时会多给一个点了是空的按钮。
  more.hidden = !WT.billsMore;

  if (WT.billErr && !WT.expired && !WT.offNote) {
    tip.hidden = false;
    tip.classList.add('bad');
    tip.textContent = '消费记录没读到：' + WT.billErr;
  } else if (!items.length && WT.billsLoaded && !WT.expired) {
    tip.hidden = false;
    tip.classList.remove('bad');
    tip.textContent = '还没有消费记录。';
  } else {
    tip.hidden = true;
    tip.classList.remove('bad');
    tip.textContent = '';
  }

  // 收起时右边那行字：最近一条。不展开也知道刚被扣了多少。
  // 🔴 没读到就说「没读到」，不许写成 ¥0.00 或空着 —— 空着像是「今天没花钱」。
  const brief = $('wtBillBrief');
  if (WT.billErr && !WT.expired) {
    // 同余额：没登设备账号时这句话是「要用设备登录那个账号」，不是读失败。
    brief.textContent = WT.accounts.device ? '没读到' : '登录后显示';
  } else if (!WT.billsLoaded) {
    brief.textContent = '—';
  } else if (!items.length) {
    brief.textContent = '还没有记录';
  } else {
    const b = items[0];
    const money = (typeof b.money === 'number' && isFinite(b.money))
      ? '¥' + b.money.toFixed(2) : '金额没读到';
    brief.textContent = (b.at ? money + ' · ' + agoText(b.at / 1000) : money);
  }
}

/** 拉消费记录。`more` = true 表示翻下一页（往已有列表后面追加）。 */
async function wtLoadBills(more) {
  const btn = $('wtBillMore');
  if (more) btn.disabled = true;
  const page = more ? WT.billsPage + 1 : 0;
  try {
    const r = await api('/api/water/bills?page=' + page);
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire('device'); }
      WT.billErr = (r && r.error) || '读不到';
      if (!more) { WT.bills = []; WT.billsPage = 0; WT.billsMore = false; }
    } else {
      const got = Array.isArray(r.items) ? r.items : [];
      WT.bills = more ? WT.bills.concat(got) : got;
      WT.billsPage = page;
      WT.billsMore = !!r.more;
      WT.billErr = '';
      WT.billsLoaded = true;
    }
  } catch (e) {
    WT.billErr = e.message;
  } finally {
    btn.disabled = false;
  }
  wtPaintBills();
}

/* ---- 接水进行中（本机记的会话，**不是**服务端状态）---------------
   /ui/app/master 只给设备列表，没有「这台正在出水」这个字段。所以这里
   记的是「你在本机点过 start」，不是「设备真的在出水」—— 文案不能装作
   知道设备真实状态。

   🔴 0.38.0：光记一笔**不够**，必须自己判断它什么时候结束。
      用户 2026-11-01：「在饮水机上结束后 APP 里还是显示正在接水」。
      旧写法只有两条路能把它清掉：本机点「停止」、或者等 2 小时过期。
      人在机器上按了结束，APP 就一路挂着「正在出水」两小时 —— 而且那两小时
      里它还会按「正在出水」的样子继续显示，用户以为在一直扣钱。
      照 WaterWidget（nocookies111/life-798，MIT）的做法补两件事：
        ① **查账单**：启动 8 秒后开始，每 10 秒读一次消费记录；
           出现「启动时刻之后」的账单 ⇒ 这次接水结束了，立刻收条子 + 结算。
        ② **超时兜底**：10 分钟（= WaterWidget 的 MAX_MONITOR_MILLIS）
           还没读到账单，就当它已经结束，把条子收掉。
      ⚠️ WaterWidget 的会话**只存内存**、重启就没了；我们存在 localStorage
         （网页版刷新一次不该把「正在出水」弄丢），所以**有效期是唯一的安全阀**
         —— 它必须短，短到「挂着一条假的」比「漏掉一次真的」更烦人。
      ⚠️ 判据只能是「账单里有没有新条目」：设备状态接口不存在，
         「过了 X 秒」只是兜底，不能拿它当结束信号。 */
const WT_LIVE_KEY = 'wt.live';
const WT_LIVE_TTL = 10 * 60 * 1000;   // 10 分钟，对齐 WaterWidget 的最长监测
const WT_POLL_FIRST = 8000;           // 启动后 8 秒先查一次（账单不会立刻出）
const WT_POLL_EVERY = 10000;          // 之后每 10 秒一次
let wtPollTimer = null;
/* 点了「停止」之后等账单等多久。**不是**「等这么久就当停了」——
   等不到就如实说「没确认到」，见 wtStop。8 秒：够账单出来的那种情况
   （真停了通常几秒内就记账），又不至于让人对着「正在停…」干等。 */
const WT_END_WAIT = 8000;
const WT_END_STEP = 2000;             // 等的时候每 2 秒查一次
let wtStopping = false;               // 停止请求在飞（只防连点，不占 WT.busy）
/* 停止请求发出去了、账单还没出来时，设备行下面那句要说什么。
   空串 = 还是「刚才启动 · 接完自动结算」。
   为什么要单独存：那句话要在 wtStop 里写一次、wtPaintLive 里读几次，
   写两处就会有一处忘了改（「正在发停止请求」和「请求已发出」是两件事）。 */
let wtLiveHint = '';

function wtLoadLive() {
  const v = store.get(WT_LIVE_KEY, null);
  if (!v || !v.did || !v.at) { WT.live = null; return; }
  if (Date.now() - v.at > WT_LIVE_TTL) {      // 过期就扔掉，别留着吓人
    store.del(WT_LIVE_KEY);
    WT.live = null;
    return;
  }
  WT.live = v;
}

/** 接水中那台设备下面那行小字。
 *  🔴 只能写**本机发生过的事**：设备真实有没有在流，没有接口能证明
 *     （/ui/app/master 只给设备列表）。所以是「刚才启动」，不是「正在出水」。
 *     这一句就是原来顶部那条 `#wtLive` 上的字，2026-11-10 搬到行里。 */
function wtLiveText() {
  if (!WT.live || !WT.live.did) return '';
  // 🔴 hint 要比 wtStopping 先看：请求已经发出去了、正在等账单的那几秒里，
  //    wtStopping 还是 true（要等 finally 才清），只按它写的话屏幕上会一直
  //    停在「正在发停止请求…」—— 用户以为卡住了，其实已经在等设备了。
  if (wtLiveHint) return wtLiveHint;
  if (wtStopping) return '正在发停止请求…';
  return '刚才启动 · 接完自动结算';
}

/** 把「这台在接水」画到**设备行**上。
 *
 *  2026-11-10 用户：「开启饮水机后不要在顶部单独显示退出，直接把接水按钮
 *  换成退出就行了」。所以现在没有顶部那条了 —— 状态和按钮都在那一行里。
 *
 *  🔴 **只改已有节点，不重画整个列表**：它在 renderWater 开头就会被调，
 *     那时候设备还没拉回来；`wtPaintDevs` 会把 `box.innerHTML` 清空，
 *     等于每进一次页面设备列表先闪空一下（而且不报错）。
 */
function wtPaintLive() {
  const box = $('wtDevs');
  if (!box) return;
  const did = (WT.live && WT.live.did) || '';
  box.querySelectorAll('.wtdev').forEach((row) => {
    const go = row.querySelector('.wtdev-go');
    if (!go) return;
    const main = row.querySelector('.wtdev-main');
    const on = !!did && go.dataset.did === did;
    go.classList.toggle('stop', on);
    go.textContent = on ? (wtStopping ? '正在停…' : '停止') : '接水';
    if (on) {
      // 无障碍：屏幕阅读器读到的是「停止接水」，不是一个没头没脑的「停止」
      go.setAttribute('aria-label', '停止接水');
      if (main) main.classList.add('has-sub');
      let sub = row.querySelector('.wtdev-sub');
      if (!sub) {
        sub = document.createElement('span');
        sub.className = 'wtdev-sub';
        if (main) main.appendChild(sub);
      }
      sub.textContent = wtLiveText();
    } else {
      go.removeAttribute('aria-label');
      if (main) main.classList.remove('has-sub');
      const sub = row.querySelector('.wtdev-sub');
      if (sub) sub.remove();
    }
  });
}

/** 停掉轮询。离开这一页 / 停水 / 过期都要调 —— 不调就是每 10 秒打一次服务器。 */
function wtLiveStopPoll() {
  if (wtPollTimer) { clearTimeout(wtPollTimer); wtPollTimer = null; }
}

/** 结算这次接水：刷余额 + 读账单 + 填「刚才那次」。
 *  🔴 账单可能还没出 ⇒ money 为 null，写「账单还没出」，绝不写 ¥0.00。
 *  wtStop（本机点的）和 wtLivePoll（机器上按的）共用这一份，别各写一遍。 */

/** 等「这次接水」的账单出来（最多等 ms 毫秒）。
 *  返回 true = 读到了启动之后的新账单（= 这次真的结束了）；
 *  false = 没等到 —— **不等于没停**：平台记账会晚，见 wtStop 的文案。
 *  🔴 只看账单，不改任何状态、不结算：收条子统一走 wtLiveEnd，
 *     两处各收一次会把同一次接水结算两遍（余额和「刚才那次」都会重复刷）。 */
async function wtWaitEnd(lv, ms) {
  const endAt = Date.now() + ms;
  while (Date.now() < endAt) {
    // 人换了账号 / 又启动了一台：这一趟作废
    if (!WT.live || WT.live.at !== lv.at) return false;
    try {
      const r = await api('/api/water/bills?page=0');
      if (r && r.ok) {
        const bills = Array.isArray(r.items) ? r.items : [];
        if (wtSumSince(bills, lv.at).money !== null) return true;
      }
    } catch (e) { /* 读不到就当还没出，接着等 */ }
    await wtSleep(WT_END_STEP);
  }
  return false;
}

async function wtSettle(lv) {
  await wtLoad();
  await wtLoadBills(false);
  const sm = wtSumSince(WT.bills, lv.at);
  WT.last = { did: lv.did, name: lv.name, at: lv.at,
              money: sm.money, partial: sm.partial };
  wtPaintLast();
}

/** 结束这次接水（不论是谁结束的）：收条子、清本机记录、结算。 */
async function wtLiveEnd(msg, lv) {
  wtLiveStopPoll();
  WT.live = null;
  wtLiveHint = '';
  store.del(WT_LIVE_KEY);
  wtPaintLive();
  if (msg) toast(msg, 3000);
  try { await wtSettle(lv); } catch (e) { /* 结算失败不影响「已经结束」这个事实 */ }
}

/** 查一次账单，看这次接水是不是已经结束了。
 *  🔴 查不到 ≠ 结束：网络错误、还没记账都当「继续等」，
 *     只有**真读到**启动时刻之后的账单才收条子。 */
function wtLivePoll() {
  wtLiveStopPoll();
  const lv = WT.live;
  if (!lv || !lv.did) return;
  // 超时兜底：等满 10 分钟还没账单，就当它早停了（WaterWidget 的 expireIfNeeded）
  if (Date.now() - lv.at > WT_LIVE_TTL) {
    wtLiveEnd('这次接水提醒已经结束，账单可以往下看消费记录', lv);
    return;
  }
  if (document.hidden) return;      // 页面看不见就不查，回到前台再起（见 visibilitychange）
  const at = lv.at;
  api('/api/water/bills?page=0').then((r) => {
    // 期间被停掉 / 换了另一台：这一趟作废，别拿旧数据去收新会话
    if (!WT.live || WT.live.at !== at) return;
    if (!r || !r.ok) { wtPollTimer = setTimeout(wtLivePoll, WT_POLL_EVERY); return; }
    const bills = Array.isArray(r.items) ? r.items : [];
    if (wtSumSince(bills, at).money !== null) {
      wtLiveEnd('这次接水结束了，已按账单结算', lv);
      return;
    }
    wtPollTimer = setTimeout(wtLivePoll, WT_POLL_EVERY);
  }).catch(() => {
    if (WT.live && WT.live.at === at) wtPollTimer = setTimeout(wtLivePoll, WT_POLL_EVERY);
  });
}

/** 起轮询。启动成功后调一次；回到「功能」页 / 回到前台也调（幂等，先清旧定时器）。 */
function wtLiveStartPoll() {
  wtLiveStopPoll();
  if (!WT.live || !WT.live.did) return;
  const left = WT_LIVE_TTL - (Date.now() - WT.live.at);
  if (left <= 0) { wtLiveEnd('这次接水提醒已经结束，账单可以往下看消费记录', WT.live); return; }
  wtPollTimer = setTimeout(wtLivePoll, Math.min(WT_POLL_FIRST, left));
}

/* ---- 「刚才那次」结算 ----------------------------------------------
   原版接水结束会通知「本次消费 + 估算水量」。水量要一个金额↔升数的兑换
   比例（原版可配置，我们不知道真值），**不编** —— 只报金额。

   🔴 账单不是立刻出的：停止后立刻读一次，读不到就写「账单还没出」，
      绝不当成 ¥0.00。这是「没读到 ≠ 0」在同一页的第三次应用。 */
function wtPaintLast() {
  const box = $('wtLast'), v = $('wtLastV'), tip = $('wtLastTip');
  if (!WT.last || !WT.last.at) { box.hidden = true; return; }
  box.hidden = false;
  $('wtLastWhen').textContent = ntStamp(WT.last.at / 1000) + ' 起';
  if (typeof WT.last.money === 'number' && isFinite(WT.last.money)) {
    v.textContent = (WT.last.partial ? '≥ ' : '') + '¥' + WT.last.money.toFixed(2);
    v.classList.remove('unknown');
    v.classList.toggle('lower', !!WT.last.partial);
    tip.hidden = !WT.last.partial;
    tip.textContent = WT.last.partial ? '有几笔的金额还没读到，所以这是下限。' : '';
  } else {
    v.textContent = '账单还没出';
    v.classList.add('unknown');
    tip.hidden = false;
    tip.textContent = '平台几分钟后才记账，请稍后刷新查看。';
  }
}

/** 从已读到的账单里，把「这次接水」那几笔挑出来加总。
 *  时间窗从启动前一分钟算起（服务端记账时间可能比我们点「开始」早几秒）。
 *  返回 {money, partial}：一条都找不到 ⇒ money = null（= 还没出账），**不是 0**；
 *  有几条金额没读到 ⇒ partial = true（那个数是下限）。 */
function wtSumSince(bills, since) {
  let sum = 0, hit = 0, partial = false;
  (Array.isArray(bills) ? bills : []).forEach((b) => {
    if (!b || !b.at || b.at < since - 60000) return;
    hit += 1;
    if (typeof b.money === 'number' && isFinite(b.money)) sum += b.money;
    else partial = true;
  });
  return { money: hit ? sum : null, partial: partial };
}

/** 停止接水。**第二个有副作用**的调用（结束计费）。
 *  🔴 不自动重试：同一台设备可能不止一个人在用，重试可能停掉别人的水。
 *  🔴 **不弹二次确认**（2026-10-31 用户拍板：「结束」按一颗就走）。
 *     停水是**往安全方向**的动作 —— 每多一次点击，水就多流一会儿；
 *     而误点「结束」最多是这次少接一点，再点一次「接水」就行。
 *     防误触靠的是按钮位置（在「正在出水」条里，红色）和它只在这一条里出现。 */
async function wtStop() {
  const lv = WT.live;
  // 🔴 三种「什么都不发生」都是 bug（2026-11-08 用户：「为什么我这没反应」）：
  //    ① 连点两下，第二下被 WT.busy 吞掉 —— 这里改成自己的 `wtStopping`，
  //       不再借 busy：接水时 busy 是共享的，别的请求挂着就点不动停止，
  //       而水多流一秒都是钱。
  //    ② 本机没记着这次接水（在机器上按的 / 清过数据）—— 不能静默返回，
  //       要说清「这台不是从这个 App 开的，去机器上停」。
  //    ③ 平台回了 code 0 —— 那只是「请求收到了」，不是「水停了」。
  //       以前立刻写「已停止」并把条子收掉，等于替设备保证了一件我们
  //       证明不了的事。现在去核账单：真出账单才算结束。
  if (!lv || !lv.did) {
    toast('非本 App 启动，请在饮水机上按停止', 4000);
    return;
  }
  if (wtStopping) return;

  wtStopping = true;
  wtLiveHint = '';
  // 按钮自己变成「正在停…」、下面那行小字变成「正在发停止请求…」——
  // 都在 wtPaintLive 里，别在这里再写一遍文案（写两处必然有一处忘改）。
  wtPaintLive();
  try {
    const r = await api('/api/water/end', { did: lv.did });
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire('device'); return; }
      toast(wtErrText(r && r.kind, r && r.error), 4000);
      return;                        // 没停成，按钮留在「停止」—— 别让用户以为停了
    }
    // 平台收下了。等账单：它是「这次接水真的结束」唯一能从服务端读到的证据。
    wtLiveHint = '停止请求已发出，等设备结束';
    wtPaintLive();
    const ended = await wtWaitEnd(lv, WT_END_WAIT);
    if (WT.live && WT.live.at === lv.at) {
      if (ended) {
        await wtLiveEnd('这次接水结束了，已按账单结算', lv);
      } else {
        // 没等到账单 ≠ 没停（记账会晚）。但也不能装作停了 ——
        // 说清「请求发出去了」，把「水还在流」的退路指出来，并且**留着那颗按钮**：
        // 账单真出来那一刻它会自己变回「接水」、顺手结算（见 wtLivePoll）。
        toast('停止请求已发出；仍在出水就在饮水机上按', 6000);
        wtLiveStartPoll();
      }
    }
  } catch (e) {
    toast('停止失败：' + e.message, 4000);
  } finally {
    wtStopping = false;
    wtPaintLive();
  }
}

/* ---- 免责声明：**积分任务**那一条路弹一次 ----------------------------
   文案在 index.html 里（照 WaterWidget 的 README / TaskRiskDialog 抄的）。
   🔴 每次进都弹等于逼人盲点「我知道了」，那这个提示就白写了 ⇒ 记一笔。
   🔴 也**不能**一进「功能」页就弹：那一页还有一卡通和办事入口，多数人不是
      为积分来的；而这一层是 `position:fixed; inset:0` 的全屏遮罩，会把底部
      导航一起盖住 —— 用户看到的是「点了没反应」，以为 App 卡死了。
      ⇒ 只挂在「一键完成」这个**真会动账号**的动作前面。
   🔴 0.38.0：**接水那条路已经不弹它了**（用户 2026-11-01：「点接水不要出
      弹窗提示了，太麻烦了」）。接水的风险改成卡里常驻一行 `#wtRisk`。
      这里保留是因为积分任务会被平台风控（扣分/冻结/限流），
      那是用户明确要求过的一次性告知，跟「接水会出水」不是一回事。 */
const WT_TERMS_KEY = 'wt.terms.ok';
/* 点了「知道了」要接着做的那件事（只在首次弹层时存在） */
let wtPending = null;

/** true = 已经读过，可以继续；false = 刚弹出来，等用户点「知道了」。 */
function wtNeedTerms(next) {
  if (store.get(WT_TERMS_KEY, false)) return true;
  wtPending = (typeof next === 'function') ? next : null;
  $('wtTerms').hidden = false;
  return false;
}

function wtTermsOk() {
  $('wtTerms').hidden = true;
  store.set(WT_TERMS_KEY, true);
  const f = wtPending;
  wtPending = null;
  if (f) f();
}

/** 进这一页。**先画缓存再探网** —— 每次进来都从空白开始等，是白等。 */
/* 开机预热（2026-11-16）
 *
 * 用户原话：「打开功能界面时经常会出现打开时内容不完整，一两秒后展开变成
 * 全部界面的问题，你看看能不能做一个打开 APP 时预加载其他常用页面的功能」。
 *
 * 根因不是画得慢，是**整页的显隐在等一次本机请求**：
 *   · 功能页的主体（`#waterOn`）要等 `/api/water/state` 才知道该不该露；
 *   · 校园页要等 `CAMPUS.state`，没拿到就先画「连接智慧门户」那张空壳。
 * 这两次都是**本机 bridge 的接口**（不是学校服务器），几十毫秒到几百毫秒，
 * 手机上还要加上 WebView 唤醒的时间 —— 那就是「先半截、后展开」。
 *
 * ⇒ 开机先把这几份状态拿回来存着，进页面时**先用存着的这份画完整的**，
 *   再让真实请求回来纠正。数据是旧的（最多几十秒）就先说旧的，
 *   但页面不会从半截跳成长条。
 */
let wtSnap = null;          // 上一次读到的 /api/water/state

/** 按一份登录状态把整页画成该有的样子。返回「有没有登录」。
 *  quiet=true：只画界面，不去拉余额/账单 —— 给预热那份用，
 *  真正的网络请求由紧接着的那次非 quiet 调用发，避免开机打两遍。 */
function wtApplyState(st, quiet) {
  const acc = (st && st.accounts) || {};
  WT.accounts = { device: acc.device || null, score: acc.score || null };
  if (!st || st.state === 'none' || st.state === 'broken') {
    WT.loginKind = '';
    wtShowOff();
    // 「存着但解不开」（换过手机 / 清过数据 / Keystore 换密钥）和「从没登录」
    // 长得一样，但该说的话不一样：前者重登一次就好，后者是第一次用。
    if (st && st.state === 'broken') {
      wtTip('保存的登录已失效（换手机或清除数据），重新登录即可', true);
    }
    return false;
  }

  // partial = 只登了其中一个账号。**照常显示能看的部分**，缺的那半在账号卡上说。
  if (Array.isArray(st.devices)) WT.devs = st.devices;
  wtShowOn();
  wtPaintDevs();          // 本机缓存，不用等网络
  wtPaintBal();           // 余额没有缓存，先画「没读到」，等下面那次结果
  wtPaintScore();         // 同上：先画「没读到」，别让格子空着像坏了
  wtPaintMissions();
  wtPaintBills();
  if (!WT.accounts.device) {
    // 设备账号才有余额/设备/账单；只登了积分账号时别去请求（会白报一个 auth 错）
    WT.balErr = '要用「设备登录」那个账号才能查余额和接水';
    WT.devErr = '';
    wtPaintBal();
    wtPaintDevs();
  }
  return true;
}

async function renderWater() {
  wtLoadLive();           // 「刚才你启动了 X」是本机记的，不用等网络
  wtPaintLive();
  wtPaintLast();          // 「刚才那次」只在本进程里有，切回来还在就还显示
  // 顶部两张小卡：先用手里有的数画一次，再让两边各自补。
  // 不 await —— 卡是入口，不该为一次余额查询挡住「接水」那一屏。
  paintMiniWallets();
  // 🔴 校园卡那张挪去「我的 → 账号管理」了，这里**不许再调 wxCardLoad**：
  //    完美校园单会话，一进页面就去查余额 = 把用户手机上的官方 App 顶下去。
  //    电费是财务处的，60 秒内重复进来不重读（节流在 cwStateRefresh 里）。
  // 有会话就接着盯账单（切走时 switchTab 会停掉，回来这里再起）
  if (WT.live) wtLiveStartPoll();

  // 先拿开机预热那份把整页画出来（有的话）。没有就是第一次进——
  // 首屏那一屏本来就空着，下面照样会等真实结果。
  if (wtSnap) wtApplyState(wtSnap, true);

  let st;
  try {
    st = await api('/api/water/state');
  } catch (e) {
    // 手里有预热那份就留着它，别把已经画好的页面退回去说「读不到」。
    if (!wtSnap) {
      wtShowOff('unknown');
      wtTip('读不到登录状态：' + e.message, true);
    }
    return;
  }
  wtSnap = st;
  const on = wtApplyState(st, false);
  if (!on) return;
  if (WT.accounts.device) await wtLoad();
  await wtLoadExtras();
}

/** 余额设备之外的三块（积分 / 任务 / 消费记录）并行拉。
 *  并行不是图快：串行的话任务接口慢一点，账单就跟着晚三秒才出来。
 *  每块自己 catch，一块挂了不影响另外两块 —— 用户至少要看到能看的那部分。 */
async function wtLoadExtras(force) {
  // 🔴 2026-11-12：**不是切一次页面就重读一次**。
  //    用户原话：「饮水功能的积分你改成完成所有任务后刷新，而不是切一次页面
  //    刷新一次」。以前每次点「功能」tab 都会把这四块各打一次服务器
  //    （积分 / 任务 / 钱包 / 账单），来回切两下就是八次请求，而其中九成
  //    什么都没变。现在 30 秒内回到这一页只重画、不联网；点右上角那颗刷新
  //    才强制重读（它本来就是「现在去看一眼」的意思）。
  //    ⚠️ 跑任务的过程中本来就不读（见 wtLoadScore / wtLoadMissions）。
  //    ⚠️ 时间戳记在**跑完**之后，不是进去的时候：中间失败了一次
  //       （比如刚好断网），下次进来要还能重试，不能被自己刚记的时间挡住。
  //       `wtExtrasBusy` 是防连点 —— 手指快点两下 tab 只该打一批。
  if (!force && (wtExtrasBusy || Date.now() - wtExtrasAt < WT_FRESH_MS)) return;
  wtExtrasBusy = true;
  const jobs = [
    wtLoadScore().catch(() => {}),
    wtLoadMissions().catch(() => {}),
    // 兑换要的钱包端点。和积分同一个账号，所以一起拉；失败不影响别的块。
    wtLoadWallets().catch(() => {}),
  ];
  // 🔴 消费记录只认**设备账号**（1,1）。只登了积分账号时别去请求：
  //    打过去会被路由的守卫挡回来，`kind` 是 auth，而 `wtLoadBills` 见到
  //    auth 就弹「登录状态过期」—— 明明没过期，只是没登另一个账号。
  //    「没登这个账号」和「票过期了」在界面上必须是两句话。
  if (WT.accounts.device) {
    jobs.push(wtLoadBills(false).catch(() => {}));
  } else {
    WT.billErr = '要用「设备登录」那个账号才能看消费记录';
    WT.bills = [];
    WT.billsLoaded = false;
    wtPaintBills();
  }
  try {
    await Promise.all(jobs);
  } finally {
    // 这一批跑完才记时间戳（失败也算「刚问过」—— 每块自己会在界面上说来没读到，
    // 而用户真想再问一次，点右上角那颗刷新就行）。
    wtExtrasAt = Date.now();
    wtExtrasBusy = false;
  }
}

/** 点右上角刷新：这一页所有东西都重读一遍。 */
async function wtRefreshAll() {
  // 同上：没有设备账号时 `/home` 会回 auth，被当成「登录过期」弹卡。
  if (WT.accounts.device) {
    await wtLoad();
  } else {
    WT.bal = null;
    WT.balErr = '要用「设备登录」那个账号才能查余额和接水';
    wtPaintBal();
    wtPaintDevs();
  }
  // 用户点了刷新 = 「现在就看最新的」，这一下必须真的联网，
  // 不能被 wtLoadExtras 那个 30 秒的新鲜期挡掉。
  await wtLoadExtras(true);
}

/** 发短信验证码。🔴 失败不自动重试，换一张图让用户重新读。 */
async function wtSendSms() {
  if (WT.busy) return;
  const phone = $('wtPhone').value.trim();
  const graph = $('wtGraph').value.trim();
  if (!/^1\d{10}$/.test(phone)) { wtTip('手机号要 11 位数字', true); return; }
  if (!graph) { wtTip('先把图上的字填进去', true); return; }
  if (!WT.key) { wtTip('图形验证码没加载出来，点「换一张」', true); return; }

  WT.busy = true;
  $('wtSend').disabled = true;
  wtTip('正在发短信…', false);
  try {
    const r = await api('/api/water/sms', { phone, key: WT.key, graph });
    if (!r || !r.ok) {
      // 发短信这一步失败（图形码不对 / 手机号被限 / 平台改版）。
      wtTip(wtErrText(r && r.kind, r && r.error), true);
      wtNewCaptcha();               // 图形验证码一次性，失败必须换
      return;
    }
    wtTip('短信已发送，请查看手机', false);
    wtCountdown(60);
    $('wtSms').focus();
  } catch (e) {
    wtTip('发短信失败：' + e.message, true);
  } finally {
    WT.busy = false;
    if (!WT.timer) $('wtSend').disabled = false;
  }
}

/** 用短信验证码换 token。🔴 失败**绝不自动重试**（红线）：错一次就换图。 */
/** 点了某一行的按钮：已登录就退出，没登录就展开表单登这个。 */
async function wtAccTap(kind) {
  if (WT.busy) return;
  const a = WT.accounts[kind];
  if (a) { await wtLogout(kind); return; }
  wtOpenLogin(kind);
}

/** 把登录表展开在**当前这一页**（不跳去「我的」）。
 *  「过期了，重登一次」和「第一次用，去登录」要落在同一个动作上 ——
 *  两处各写一份的话，总有一处会忘了带手机号或忘了换图。 */
function wtOpenLogin(kind) {
  WT.loginKind = (kind === 'score') ? 'score' : 'device';
  WT.key = '';                 // 换账号就换一张图，别用上一张的 key
  // 过期卡收起来：表单已经出来了，再摆一张「过期了」只会挤占屏幕
  WT.expired = false;
  $('wtExpired').hidden = true;
  if (typeof wtPaintAccounts === 'function') wtPaintAccounts();
  // 🔴 表单在「账号管理」页上，人却在「功能」页（过期卡就在那儿）。
  //    不切过去的话，点了「重登设备账号」屏幕上什么都不变 —— 2026-11-08
  //    用户原话：「点击前往设备登录应该直接跳转过去」。记住从哪来，
  //    登完送回去（见 wtLogin），别让人自己再找一遍。
  if (CUR_PAGE !== 'accounts') {
    WT.loginBack = CUR_PAGE;
    switchTab('accounts');
  }
  const box = $('waterOff');
  box.hidden = false;
  // 号码带出来：退出登录之后它还在（见 KEY.wtPhone），别让人再背一遍
  const phEl = $('wtPhone');
  if (phEl && !phEl.value.trim()) {
    phEl.value = WT.phone || store.get(KEY.wtPhone, '') || '';
  }
  $('wtLoginTitle').textContent = WT.loginKind === 'device' ? '登录设备账号' : '登录积分账号';
  // 一行说清「这个账号是干什么的」。原来这里还解释了一遍「用短信验证码、
  // 密码不用填」—— 表单上就三行、没有密码框，看得见，不用再说。
  $('wtLoginWhy').textContent = WT.loginKind === 'device'
    ? '管接水、余额和设备。短信验证码登录。'
    : '积分是另一个账号，也得单独登一次。';
  // 表单在页面上方，滚上去让人看见它出来了
  if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  wtNewCaptcha();
}

function wtCancelLogin() {
  WT.loginKind = '';
  WT.key = '';
  WT.loginBack = '';       // 取消了就别再「登完送回去」
  $('waterOff').hidden = true;
  $('wtSms').value = '';
  $('wtGraph').value = '';
  wtTip('', false);
  wtPaintAccounts();
  // 一个账号都没有的话，账号卡本来就空着 —— 把它顶上来当「首次使用」的说明
  if (!WT.accounts.device && !WT.accounts.score) wtShowOff();
}

async function wtLogin() {
  if (WT.busy) return;
  const kind = WT.loginKind || 'device';
  const phone = $('wtPhone').value.trim();
  const sms = $('wtSms').value.trim();
  if (!/^1\d{10}$/.test(phone)) { wtTip('手机号要 11 位数字', true); return; }
  if (!/^\d{4,8}$/.test(sms)) { wtTip('短信验证码是手机收到的那串数字', true); return; }

  WT.busy = true;
  $('wtLogin').disabled = true;
  wtTip('正在登录…', false);
  try {
    const r = await api('/api/water/login', { phone, sms, kind });
    if (!r || !r.ok) {
      // 慧生活登录失败。它最近改得勤（2026-11-06 那次「请升级最新版」），
      // 有上报才能看出是「版本墙」还是「码不对」还是「校验变了」。
      // ⚠️ 手机号和验证码都不报 —— 只报分类和平台自己说的话。
      wtTip(wtErrText(r && r.kind, r && r.error), true);
      wtNewCaptcha();
      $('wtSms').value = '';
      return;
    }
    WT.phone = r.phone || phone;
    // 记住号码，下次（包括退出登录以后）直接带出来
    store.set(KEY.wtPhone, WT.phone);
    WT.key = '';                  // 这张图用完了，下次登录要新的
    WT.loginKind = '';            // 表单收起来
    $('wtSms').value = '';
    $('wtGraph').value = '';
    wtTip('', false);
    clearInterval(WT.timer);
    WT.timer = 0; WT.cd = 0;
    $('wtSend').disabled = false;
    $('wtSend').textContent = '发送';
    // 🔴 登完**整页重画**，不是只画账号卡：补登积分账号后，任务列表会多出
    //    另一个平台的那一半，签到卡也可能才第一次能显示。只画账号卡的话，
    //    用户看到「已登录」却还是那几条任务，会以为没生效。
    //
    // 🔴 2026-11-08：人是从「功能」页点「重登」进来的，登完**直接送回去**，
    //    并且回去时重读这一页 —— 用户原话：「登录完成后应该直接刷新状态，
    //    不然还需要退出APP清后台再进来才能刷新状态」。
    //    送回去用 switchTab（它自己会调 renderWater），不自己改 hidden：
    //    改 hidden 不同步 CUR_PAGE / 底部高亮，返回键就指错地方了。
    const back = WT.loginBack || '';
    WT.loginBack = '';
    if (back && back !== 'accounts') {
      switchTab(back);           // renderWater 在里面，数据跟着重读
    } else {
      await renderWater();
    }
  } catch (e) {
    wtTip('登录失败：' + e.message, true);
  } finally {
    WT.busy = false;
    $('wtLogin').disabled = false;
  }
}

/** 启动一台饮水机。
 *  🔴 **唯一有副作用**的调用：真的会出水、真的会按用量扣钱。
 *  🔴 **什么都不弹**（2026-10-31 拍板不弹二次确认；2026-11-01 又把免责弹层也撤了：
 *     「点接水不要出弹窗提示了，太麻烦了」）。
 *     走过的两版理由都记在这儿，免得以后有人又「出于安全」加回去：
 *       · 二次确认问的是「会出水、会扣钱」—— 这是接水这件事的定义，
 *         问第二遍只是挡路；真正防误触的是**位置**（按钮只长在某一台设备那一行）
 *         和**即时反馈**（点完这一行立刻变成「正在出水 + 停止」）。
 *       · 免责声明原来是一次性全屏遮罩，但它挡住的恰恰是「第一次用水」那一下，
 *         而且「知道了」点完还是要接水 —— 它的作用是**告知**，不是**关卡**。
 *         ⇒ 改成卡里常驻的一行小字（`#wtRisk`），风险照旧写在用户眼前，
 *           只是不再拦着他。
 *     ⚠️ 积分任务的免责弹层**没撤**（wtRunAll 那条路）：那是会动账号的风控动作，
 *        用户明确要求过那一次告知，两者不是一回事。
 *  ⚠️ 参数 `name` 只用于提示文案，不参与请求。 */
/** 返回有没有真的出水（true / false）。
 *  🔴 返回值只给「碰一碰」用：它会在开始之前先把编号记进本机列表，
 *     好让「停止」有地方长；接都没接上的话那条空壳得撤掉。 */
async function wtStart(did, name) {
  if (WT.busy) return false;
  if (!did) { toast('没读到本机设备编号，请刷新'); return false; }
  const label = name || ('设备 ' + did);

  WT.busy = true;
  try {
    const r = await api('/api/water/start', { did });
    if (!r || !r.ok) {
      if (r && r.kind === 'auth') { wtExpire('device'); return false; }
      // 业务错误逐条说清楚（欠费 / 没签约 / 没绑卡 / 没权限…），
      // 这些**不是**重试能救的，所以要停 4 秒让人读完。
      toast(wtErrText(r && r.kind, r && r.error), 4000);
      return false;
    }
    toast(r.msg || '已经启动了，接完自动结算', 3000);
    // 记下「你在本机点了启动」，提醒条要用它。
    // 🔴 这只是**本机记录**，不是服务端状态 —— /ui/app/master 没有
    //    「这台正在出水」这个字段，别把猜的说成读到的。
    WT.live = { did: did, name: label, at: Date.now() };
    store.set(WT_LIVE_KEY, WT.live);
    wtLiveHint = '';      // 新一轮开始，上一轮的「等设备结束」不许跟过来
    // 新一轮开始，「刚才那次」就该让位 —— 留着会让人以为这次已经结算过了
    WT.last = null;
    wtPaintLive();
    wtPaintLast();
    // 开始盯账单：人可能在机器上按结束，APP 得自己发现（见 wtLivePoll）
    wtLiveStartPoll();
    return true;
  } catch (e) {
    toast('启动失败：' + e.message, 4000);
    return false;
  } finally {
    WT.busy = false;
  }
}

/* ---------------- 碰一碰（0.52.0 v7） ----------------
 *
 * 用户 2026-11-10：「慧生活能 NFC 碰一碰直接开饮水机，看看能不能兼容」。
 *
 * 做的是同一件事，但**不是同一张卡**：
 *   · 机器上那张蓝环贴纸是支付宝 / 慧生活的，里面写着它们的地址。
 *     注册同一个 scheme 只会变成每次碰都弹「用哪个应用打开」，两家都变难用
 *     ⇒ **不抢注册**；但用户在我们的「碰一碰」里读到它时（2026-11-11），
 *     里面那句 `nfc.html?q=<编号>` 的编号是能用的 —— 直接当设备号接水，
 *     于是「碰一下出水」在两张贴纸上都成立，也不会跳去慧生活再登一次。
 *   · 手机当校园卡刷（机器直接读手机芯片）要学校的卡片密钥，而且 Android
 *     模拟不了水机读的那类卡 ⇒ 做不到。
 *   · 我们自己写一张 hyt://water/<编号> 的贴纸贴上去。碰一下由系统按
 *     Manifest 里那个过滤器直接拉起 App，编号从 URL 进来落到这里。
 *     这张贴纸是**通用的**：谁装了这个 App，碰一下都能用自己的账号出水。
 *
 * 🔴 三条别踩：
 *   1. 编号只有两种来源，都要**认得死**：我们自己的地址（MainActivity.didOf
 *      已经把字符集卡死）、慧生活贴纸的 `ilife798.com/nfc.html?q=`（wtVendorCode，
 *      host 精确匹配）。其它卡读出来认不出就说不认识，**不猜**。
 *   2. 这台正在出水时不重复启动 —— 再 start 一次就是第二笔账。
 *   3. 读不到就把读到的原文摊给用户看。那是他唯一能反馈、我们唯一能定位的线索。
 */
function nfcApi() {
  return (window.AndroidNfc && typeof window.AndroidNfc.state === 'function')
    ? window.AndroidNfc : null;
}

/** 深链入口：贴纸把 App 拉起来之后落到这里。返回有没有认出设备编号。 */
/**
 * 从 hyt://water/<设备号> 进来（碰卡，或者别人递来的一条链接）。
 *
 * `byTag` = 这一趟是不是**真的碰了卡**。原生那边只有拿到 NFC 标签对象
 * （`EXTRA_TAG`，别的应用伪造不出来）才回 true。
 *
 * 🔴 不碰卡的一律先问一句（0.52.0 v10）。这个入口是 exported 的：
 *    任何应用、任何网页都能 `hyt://water/12345678` 把 App 叫起来。不问就开阀，
 *    等于给所有人一个「用他的账号、他的钱接水」的按钮 —— 人可能根本不在机器边上。
 *    碰卡那趟不问，因为「把手机贴上去」本身就是那个确认动作。
 */
window.__hytWater = function (raw, byTag) {
  const did = String(raw == null ? '' : raw).trim().slice(0, 64);
  if (!wtDevIdOk(did)) return false;
  switchTab('campus');
  if (byTag === true) {
    // 等换页那一下落位再启动：现在就塞进列表，用户看到的是刚滑到一半的
    // 页面里某一行突然变成「停止」。
    setTimeout(() => { wtNfcStart(did); }, 360);
    return true;
  }
  const known = (Array.isArray(WT.devs) ? WT.devs : [])
    .filter((d) => String((d && d.id) || '') === did)[0];
  const nm = (known && known.name) ? known.name : did;
  setTimeout(() => { wtNfcAsk(did, nm); }, 360);
  return true;
};

/**
 * 「有人递了个接水链接过来」时的确认框。
 *
 * 🔴 主按钮（接水）和取消必须并排放在同一个 `.sheetbtns` 里 —— 不塞进设备行、
 *    也不和删除类操作挨着（设计规范第 29 条）。这里两件事都有，但一个是
 *    「同意」一个是「不」，语义对等，并排是对的。
 */
function wtNfcAsk(did, name) {
  wtNfcOpenFlag = false;
  $('sheetBody').innerHTML =
    '<div class="sh-title">在这儿接水？</div>' +
    '<div class="sh-sub">' + esc(name) + '</div>' +
    '<div class="sheetbtns">' +
      '<button class="btn" id="wtNfcNo">取消</button>' +
      '<button class="btn primary" id="wtNfcYes">接水</button>' +
    '</div>';
  $('sheetMask').hidden = false;
  $('wtNfcNo').addEventListener('click', () => { closeSheet(); });
  $('wtNfcYes').addEventListener('click', () => {
    closeSheet();
    wtNfcStart(did);
  });
}

/** 认出一台机器之后：记进本机列表 → 滚到它 → 开始接水。 */
async function wtNfcStart(did) {
  if (WT.live && WT.live.did === did) { toast('这台正在接水'); return; }
  // 必须记进本机列表：开始之后那颗「停止」就长在这一行上，
  // 列表里没有它，用户连停都停不了。
  // 服务端名单里已经有的就不用再记一份 —— 记了会在名单里留一条「手动添加」的
  // 影子，哪天在慧生活里解绑了它还在。
  const known = (Array.isArray(WT.devs) ? WT.devs : [])
    .some((d) => String((d && d.id) || '') === did) || wtLocalDevs().indexOf(did) >= 0;
  if (!known) wtSaveLocalDev(did);
  wtPaintDevs();
  const row = wtDevRows().filter((d) => d.id === did)[0];
  wtScrollDev(did);
  const ok = await wtStart(did, row ? row.name : '');
  // 🔴 服务端不认这个编号（碰到的贴纸里那串号不是这台机器的设备号）时，
  //    刚才为了「停止」临时记下的那条要撤掉 —— 不然设备列表里会永远多一台
  //    「手动添加的饮水机」，点它还是同样的失败，用户只能自己猜着删。
  if (!ok && !known) { wtDropLocalDev(did); wtPaintDevs(); }
}

/** 把某一行滚到屏幕中间。找不到就算了 —— 设备列表可能还没读回来。 */
function wtScrollDev(did) {
  const box = $('wtDevs');
  if (!box) return;
  const b = Array.prototype.filter.call(
    box.querySelectorAll('[data-more]'), (x) => x.dataset.more === did)[0];
  if (b && b.scrollIntoView) b.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** 读卡的弹层。开着的这一小段时间里，NFC 的标签都会先到我们这儿。
 *  🔴 用 `var` 不用 `let`：closeSheet 在文件更靠前的位置就要能安全地读它 ——
 *     `let` 在那行执行之前是 TDZ，一读就抛（和上面 wtPop 同一个理由）。 */
var wtNfcOpenFlag = false;

/** 「第一次用手机接水」要走的四步。只在**本机还没成功碰过**时摊开。
 *
 *  用户 2026-11-13：「点击碰一碰按钮后应该在上面显示出首次绑定云卡需要进行的
 *  操作，分步进行」。原话就是下面这四步，只是拆成了两句一行。
 *
 *  🔴 这四步里**只有第 2 步是我们做的**（读卡号），1/3/4 都要他离开这个页面去
 *     做别的事。所以第 2 步标成「现在这一步」—— 不标的话，用户看到四条并列的
 *     待办，会以为要一口气做完才能走。
 *  🔴 第 4 步不是「绑定完成」，是「以后怎么用」：绑完还得把手机贴到机器顶部
 *     （那一步机器要读到手机模拟的卡），拿开才停 —— 不写这句，他绑完回来
 *     贴上去以为坏了。
 */
var WT_NFC_DONE_KEY = 'hyt_wt_nfc_done';

function wtNfcSteps() {
  return [
    { t: '拿出学生卡，在饮水机上刷一次。' },
    { t: '学生卡贴到手机背面 NFC 区，读到卡号后复制', now: true },
    { t: '支付宝搜「慧生活798」→ 卡包 → 添加云卡，填姓名和卡号' },
    { t: '贴到饮水机顶部 IC 卡区接水，拿开即停' },
  ];
}

function wtNfcSheet(title, sub, steps) {
  wtNfcOpenFlag = true;
  const list = (steps && steps.length)
    ? '<ol class="sh-steps">' + steps.map((s) =>
        '<li' + (s.now ? ' class="now"' : '') + '>' + esc(s.t) + '</li>').join('') + '</ol>'
    : '';
  $('sheetBody').innerHTML =
    '<div class="sh-title">' + esc(title) + '</div>' +
    (sub ? '<div class="sh-sub">' + esc(sub) + '</div>' : '') +
    list +
    '<div class="wt-nfc-wait"><span class="wt-nfc-dot"></span>' +
      '<span>正在等卡…把手机背面贴紧机器上的读卡区</span></div>' +
    '<div class="sheetbtns"><button class="btn" id="wtNfcCancel">取消</button></div>';
  $('sheetMask').hidden = false;
  $('wtNfcCancel').addEventListener('click', () => {
    const api = nfcApi();
    if (api) api.stop('');
    wtNfcOpenFlag = false;
    closeSheet();
  });
}

/** 结果页。retry 给了就多一颗「再试一次」。 */
function wtNfcSay(head, sub, retry) {
  wtNfcOpenFlag = true;
  $('sheetBody').innerHTML =
    '<div class="sh-title">' + esc(head) + '</div>' +
    '<div class="sh-sub">' + esc(sub) + '</div>' +
    '<div class="sheetbtns">' +
      (retry ? '<button class="btn" id="wtNfcAgain">再试一次</button>' : '') +
      '<button class="btn primary" id="wtNfcDone">好</button>' +
    '</div>';
  $('sheetMask').hidden = false;
  if (retry) $('wtNfcAgain').addEventListener('click', retry);
  $('wtNfcDone').addEventListener('click', () => {
    wtNfcOpenFlag = false;
    closeSheet();
  });
}

/** 十六进制卡号 → 十进制字符串。
 *
 *  🔴 不用 `BigInt`：七个字节最大是 72057594037927935，早就出了 Number 的
 *     安全整数范围，而老 WebView 上 `BigInt` 不一定有。这里按位算：
 *     一次乘 16 加进位，卡号最多二十个十六进制位，跑不满一毫秒。
 */
function wtHexToDec(h) {
  const s = String(h == null ? '' : h).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (!s) return '';
  const d = [0];                    // 十进制各位，低位在前
  for (let i = 0; i < s.length; i += 1) {
    let carry = parseInt(s[i], 16);
    for (let j = 0; j < d.length; j += 1) {
      const v = d[j] * 16 + carry;
      d[j] = v % 10;
      carry = Math.floor(v / 10);
    }
    while (carry > 0) { d.push(carry % 10); carry = Math.floor(carry / 10); }
  }
  while (d.length > 1 && d[d.length - 1] === 0) d.pop();
  return d.reverse().join('');
}

/** 芯片号（十六进制）→ 水机屏幕上显示的那串十进制。
 *
 *  🔴 是**字节倒序**，不是直接十六进制转十进制。2026-11-11 23:18 实机对拍：
 *     同一张一卡通，App 读到 `97 69 3B BA`（十六进制 `97693BBA`），
 *     水机屏幕上印的是 `3124455831` —— 正好是 `BA3B6997` 的值。
 *     机器把 UID 的最后一个字节当最高位（小端）。
 *     直接用直转那个数（2540256186）到机器上对不上，绑云卡也会失败。
 */
function wtCardNo(hex) {
  const up = String(hex == null ? '' : hex).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (!up) return '';
  const b = [];
  for (let i = 0; i + 2 <= up.length; i += 2) b.push(up.slice(i, i + 2));
  if (up.length % 2) b.push('0' + up.slice(-1));   // 奇数位（不该出现）：凑成整字节，别把最后一位丢了
  return wtHexToDec(b.reverse().join(''));
}

/** 读到的是一张卡（一卡通 / 门禁卡 / 别的 M1 卡），不是饮水机贴纸。
 *
 *  屏幕那串号 = UID 字节倒序的十进制（见 wtCardNo 的实机对拍记录）。
 *  上面那行大字就是**机器上会显示的号**；下面那行是卡里原样的芯片号，
 *  留着好核对 —— 两个摆出来，用户一眼能看出对不对得上。
 *
 *  🔴 2026-11-13 用户实测：**把号填进支付宝小程序不算绑完**，
 *     小程序最后还要把卡贴到饮水机上刷一次，机器读到卡才认。
 *     那一步替不了：机器要亲眼看见这张卡的芯片，我们不在那条链路上。
 *     所以这里的文案必须把「哪一步能省、哪一步不能」说明白 ——
 *     光写「复制走去添加云卡」，用户照着做完还是接不了水，
 *     会以为是号读错了，然后一遍遍重新读卡。
 *
 *  🔴 卡号是**身份**，不是密码：谁拿到它，谁就能在支付宝里把这张卡绑成
 *     自己的云卡（绑完刷的是**他自己**的钱，不损卡主）。所以这里只显示、
 *     只在用户点了「复制」时才进剪贴板 —— **不进日志、不进上报、不落存储**。
 */
function wtNfcCard(hex) {
  wtNfcOpenFlag = true;
  const up = String(hex == null ? '' : hex).toUpperCase();
  const dec = wtCardNo(up);
  $('sheetBody').innerHTML =
    '<div class="sh-title">读到一张卡</div>' +
    '<div class="sh-sub">这是水机屏幕上那串号。' +
      '支付宝搜「慧生活798」→ 卡包 → 添加云卡，填这串号；' +
      '<b>最后要把卡贴到饮水机上刷一次</b>才算绑上，' +
      '这一步需在本机完成。</div>' +
    '<div class="wt-cardno">' +
      '<div class="wt-cardno-k">机器上显示的号</div>' +
      '<div class="wt-cardno-v" id="wtCardDec">' + esc(dec) + '</div>' +
      '<div class="wt-cardno-k">芯片号（卡里读出来的）</div>' +
      '<div class="wt-cardno-v wt-cardno-dim">' + esc(up) + '</div>' +
    '</div>' +
    '<div class="sheetbtns">' +
      '<button class="btn" id="wtCardCopy">复制卡号</button>' +
      '<button class="btn primary" id="wtNfcDone">好</button>' +
    '</div>';
  $('sheetMask').hidden = false;
  // 这两颗都判一下空：模板里少一颗按钮不该让整段读卡流程抛异常 ——
  // 用户看到的现象会是「贴了卡没反应」，而我们连日志都拿不到。
  const doneBtn = $('wtNfcDone');
  if (doneBtn) doneBtn.addEventListener('click', () => {
    wtNfcOpenFlag = false;
    closeSheet();
  });
  const copyBtn = $('wtCardCopy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    if (wtCopy(dec)) { toast('卡号已复制'); return; }
    // 复制不了就把号摊进输入框里长按选中 —— 跟「复制编号」同一个退路。
    await openInput('卡号', '长按下面这串选中，再复制', '', '好', dec);
  });
}

/** 点「碰一碰」：读一张卡，认得出编号就接着接水。 */
function wtNfcOpen() {
  const api = nfcApi();
  if (!api) { toast('碰一碰要装 App 才能用'); return; }
  const st = api.state();
  if (st === 'nofc') { toast('这台手机没有 NFC'); return; }
  if (st === 'off') { toast('先在系统设置里把 NFC 打开'); return; }
  // 第一次用（这台手机还没成功碰过饮水机）才摊那四步。
  // 已经碰成功过的人每点一次都看一遍四步，是噪音 —— 他就想开个水。
  const first = !store.get(WT_NFC_DONE_KEY, false);
  wtNfcSheet('碰一碰饮水机',
    first
      ? '第一次接水，四步完成。'
      : '贴机器上的贴纸；学生卡贴上来也能读卡号。',
    first ? wtNfcSteps() : null);
  api.listen(30);
}

/** 碰到的是慧生活贴纸：认得出是哪台就直接接水，认不出就问一次再记住。
 *
 *  `code` = 贴纸里那串芯片序列号（wtVendorCode 取出来的 q）。
 */
async function wtNfcTag(code) {
  wtNfcOpenFlag = false;
  const bound = String(wtTagMap()[code] || '');
  if (wtDevIdOk(bound)) { window.__hytWater(bound, true); return; }
  const devs = wtDevRows();
  if (!devs.length) {
    // 设备列表还没读回来（或者一台都没绑）：这时没法问「是哪台」。
    wtNfcSay('这是饮水机的贴纸', '设备列表未读到，等它出来再碰一次', null);
    return;
  }
  // 🔴 第一次见这张贴纸，必须问。**不按「只有一台就当成那台」猜** ——
  //    猜错就是在他不在的那台机器上开阀，水白流、钱照扣。
  const pick = await openPick('这是饮水机的贴纸',
    '这台是列表中的哪一台？选定后碰一碰即可出水。',
    [{ items: devs.map((d) => ({ id: d.id, name: d.name || '手动添加的饮水机' })) }]);
  if (pick == null) return;          // 点了取消：当没发生过，不猜
  wtTagBind(code, pick);
  window.__hytWater(pick, true);
}

/** 点设备菜单里的「写一张卡」：把这张贴纸写成这台机器。 */
function wtNfcWrite(row) {
  const api = nfcApi();
  if (!api) { toast('写卡要装 App 才能用'); return; }
  const st = api.state();
  if (st === 'nofc') { toast('这台手机没有 NFC'); return; }
  if (st === 'off') { toast('先在系统设置里把 NFC 打开'); return; }
  wtNfcSheet('写一张贴纸', '空白 NFC 贴纸（NTAG213）贴手机背面');
  const r = api.write('hyt://water/' + row.id);
  if (r !== 'ok') {
    wtNfcSay('写不了', r === 'deny'
      ? '这台设备的编号里有不能写进地址的字符。'
      : 'NFC 当前不可用，请到系统设置查看。', null);
  }
}

/** 原生读到一张卡。text 是卡上的原文（读不出内容时是 id: 开头的卡号）。 */
window.__hytNfc = function (raw) {
  const text = String(raw == null ? '' : raw).trim();
  wtNfcOpenFlag = false;
  // 🔴 先认「这是一张卡」，**在 wtNormDevice 之前**。
  //    原生读不出 NDEF 内容时兜底给的是 `id:<UID>`，而 wtNormDevice 会把
  //    `id:` 当键名剥掉、剩下纯字母数字，wtDevIdOk 一看「没斜杠」就放行 ——
  //    于是一卡通会被当成设备号去请求出水，必然报错（0.52.1 v3 之前都这样）。
  //    `id:` 是原生读卡时自己加的标记，没有任何设备号长这样 ⇒ 只要见到它，
  //    不管后面是什么，都**绝不**拿去开阀。
  const card = /^id:(.*)$/i.exec(text);
  if (card) {
    const hex = card[1].replace(/[^0-9A-Fa-f]/g, '');
    if (hex.length >= 6 && hex.length <= 20) { wtNfcCard(hex); return; }
    wtNfcSay('这个卡号读不懂',
      text ? ('读到的是：' + text.slice(0, 80)) : '卡上什么都没读到。',
      () => { wtNfcOpen(); });
    return;
  }
  const id = wtNormDevice(text);
  if (wtDevIdOk(id)) {
    // 碰成功过一次 ⇒ 以后点「碰一碰」不再摊那四步（见 wtNfcOpen）。
    store.set(WT_NFC_DONE_KEY, true);
    closeSheet();
    // 用户自己点的「碰一碰」、自己贴的卡 —— 这一趟不用再问。
    window.__hytWater(id, true);
    return;
  }
  // 机器上原来那张蓝环贴纸（2026-11-11）。它不是「别人的卡」，它**就是**
  // 这台饮水机：里面写着慧生活的地址，`q` 是那张贴纸芯片的序列号。
  // 这个号换算不出设备号（只有慧生活的服务器认这个对应关系），所以第一次
  // 碰见时问一句「是哪台」，记住之后一碰就出水。
  const vq = wtVendorCode(text);
  if (vq) {
    store.set(WT_NFC_DONE_KEY, true);
    closeSheet();
    wtNfcTag(vq);
    return;
  }
  // 认不出：把原文摊出来。裁到 80 字 —— 再长就不是能贴在机器上的东西了。
  wtNfcSay('这不是饮水机的卡',
    text ? ('读到的是：' + text.slice(0, 80)) : '卡上什么都没读到。',
    () => { wtNfcOpen(); });
};

/** 原生那边等超时了 / 开不起来。只有弹层还开着才说话（关掉之后就别再弹回来）。 */
window.__hytNfcEnd = function (why) {
  if (!wtNfcOpenFlag || $('sheetMask').hidden) return;
  // 开不起来（原生 enableReaderMode 抛了）也**必须说话**：
  // 不说的话这一屏就永远停在「正在等卡…」，用户会一直贴在机器上等。
  if (why === 'fail') {
    wtNfcSay('读卡没打开', '退出后重新进入；仍不行说明 NFC 被其他应用占用',
      () => { wtNfcOpen(); });
    return;
  }
  if (why !== 'timeout') return;
  wtNfcSay('没读到卡',
    '贴紧一点，停一秒；机器上没贴纸就写一张',
    () => { wtNfcOpen(); });
};

/** 写卡结果。几种失败分得清清楚楚 —— 用户下一步要做的事完全不同。 */
window.__hytNfcWrite = function (res) {
  wtNfcOpenFlag = false;
  const m = {
    ok: ['写好了', '贴到饮水机上，以后手机一碰就能接水。'],
    readonly: ['这张卡锁死了', '它是出厂写死的那种，换一张空白贴纸。'],
    small: ['这张卡装不下', '容量不够，换 NTAG213 或更大的。'],
    unsupported: ['这不是能写的贴纸', '可能是校园卡或门禁卡，不要写入。'],
    fail: ['没写进去', '把手机再贴紧一点重试；还不行就换一张。'],
  }[String(res || 'fail')] || ['没写进去', '请重新粘贴。'];
  wtNfcSay(m[0], m[1], null);
};

/** 退出登录。只清本机的 token，**不动**慧生活798 那边的登录态 ——
 *  我们没资格替用户在别人的平台上登出。 */
async function wtLogout(kind) {
  const one = (kind === 'device' || kind === 'score') ? kind : '';
  const name = one === 'device' ? '设备账号' : (one === 'score' ? '积分账号' : '登录');
  const ok = await askConfirm('退出' + name,
    one
      ? '只清这个账号，另一个不受影响。'
      : '只清这台手机上的登录，另一个账号不受影响。',
    '退出');
  if (!ok) return;
  try {
    await api('/api/water/logout', one ? { kind: one } : {});
  } catch (e) { /* 清不掉也要把界面切回去，别卡在「已登录」 */ }
  WT.key = '';
  WT.loginKind = '';
  if (one) {
    // 🔴 只退一格：另一个账号的数据原样留着。整套清掉的话，退积分账号会
    //    把余额和设备也变成「没读到」，而用户只是不想跑任务了。
    WT.accounts[one] = null;
    if (one === 'score') {
      WT.score = null; WT.scoreErr = '';
      WT.missions = []; WT.missionErr = ''; WT.missionSkipped = 0;
      WT.daily = null; WT.lanes = null; WT.laneErr = {};
      WT.run = {}; WT.running = false; WT.cur = '';
    } else {
      WT.bal = null; WT.balErr = ''; WT.devs = []; WT.devErr = '';
      WT.loadedAt = 0;
      WT.live = null; store.del(WT_LIVE_KEY);
      WT.last = null;
      wtPaintLive(); wtPaintLast();
    }
    clearInterval(WT.timer);
    WT.timer = 0; WT.cd = 0;
    $('wtSend').disabled = false;
    $('wtSend').textContent = '发送';
    // 号码留着（退出登录不清），下次点「登录」直接带出来
    $('wtPhone').value = WT.phone || store.get(KEY.wtPhone, '') || '';
    $('wtSms').value = '';
    $('wtGraph').value = '';
    await renderWater();
    return;
  }
  WT.bal = null; WT.balErr = ''; WT.devs = []; WT.devErr = '';
  WT.loadedAt = 0; WT.expired = false;
  // 0.24.0 的三块也要清：不清的话换个人登录，屏幕上还挂着上一个人的积分和账单
  WT.score = null; WT.scoreErr = '';
  WT.missions = []; WT.missionErr = ''; WT.missionSkipped = 0;
  WT.daily = null; WT.lanes = null; WT.laneErr = {};
  WT.run = {}; WT.running = false; WT.cur = '';
  WT.bills = []; WT.billErr = ''; WT.billsPage = 0; WT.billsMore = false;
  WT.billsLoaded = false;
  WT.accounts = { device: null, score: null };
  WT.live = null; store.del(WT_LIVE_KEY);      // 换账号了，上一个人接的水不关我事
  wtLiveStopPoll();                            // 轮询也得停，否则拿新账号去查旧会话
  WT.last = null;                              // 「刚才那次」也是上一个人的
  wtPaintLive();
  wtPaintLast();
  clearInterval(WT.timer);
  WT.timer = 0; WT.cd = 0;
  $('wtSend').disabled = false;
  $('wtSend').textContent = '发送';
  $('wtPhone').value = WT.phone || store.get(KEY.wtPhone, '') || '';
  $('wtSms').value = '';
  $('wtGraph').value = '';
  wtShowOff();
}

function renderWikiPage() {
  const list = $('wikiList');
  if (!list) return;
  if (!$('ntEnter')) {
    list.innerHTML = '<div class="card"><p class="tip note">东油适配中</p></div>';
  }
}

function autoCfg() {
  if (!CFG.auto || typeof CFG.auto !== 'object') CFG.auto = {};
  const a = CFG.auto;
  if (typeof a.cxOn !== 'boolean') a.cxOn = false;
  if ([60, 120, 240].indexOf(a.cxMin) < 0) a.cxMin = 120;
  if (typeof a.wtOn !== 'boolean') a.wtOn = false;
  return a;
}

const AUTO_CX_CN = { 60: '每小时', 120: '每 2 小时', 240: '每 4 小时' };

/** 未来某个时刻点，说成「15:40」/「明天 09:10」。取不到就给空串。
 *
 *  🔴 只说「大约」：JobScheduler 会把任务攒到它自己方便的维护窗口，
 *     实际可能晚几十分钟。写死一个精确时刻，用户会对表 —— 然后说它不准。 */
function autoClock(sec) {
  const t = Number(sec);
  if (!t) return '';
  const d = new Date(t * 1000);
  if (isNaN(d.getTime())) return '';
  // 已经过去的时刻不叫「下次」—— 那多半是任务被系统清掉了（链条断了）。
  // 这时给一句「还没排上」比给一个过去的钟点诚实。
  if (d.getTime() < Date.now() - 60_000) return '';
  const p = (n) => (n < 10 ? '0' : '') + n;
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  const a = new Date();
  const same = a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth()
            && a.getDate() === d.getDate();
  return same ? hm : ('明天 ' + hm);
}

/** 后台跑过的轮次（2026-11-14）。
 *
 *  用户：「点开有个按钮，再点开可以看历史的学习通和积分任务的后台进行记录，
 *  包括时间与完成度」。
 *
 *  🔴 默认**收起**：一夜能跑十几轮，全摊开会把「允许后台运行」那颗主按钮
 *     顶到屏幕外 —— 而那颗才是这一页唯一的动作。
 *
 *  🔴 百分比的分母是「开跑那一刻今天还能拿的分」（`c`），不是平台给的上限
 *     —— 平台根本没有这个字段。所以文案写「%」，不写「占上限」。见 bgWtInit。
 */
function autoHistHtml(list) {
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length) {
    return '<div class="setlabel">运行记录</div>' +
      '<p class="tip note">暂无记录</p>';
  }
  const body = rows.slice(0, 40).map((it) => {
    const cx = it && it.k === 'cx';
    const d = Number(it && it.d) || 0;
    const b = Number(it && it.b);
    const a = Number(it && it.a);
    const diff = (isFinite(b) && isFinite(a)) ? (a - b) : null;
    const cap = Number(it && it.c) || 0;
    let val = String((it && it.w) || '');
    if (!cx && it && it.ok) {
      const pct = (diff !== null && cap > 0)
        ? Math.round(diff / cap * 100) : null;
      val = d + ' 项' +
        (diff !== null ? ' · ' + (diff >= 0 ? '+' : '') + diff + ' 分' : '') +
        (pct === null ? '' : ' · ' + pct + '%');
    }
    return '<div class="hs-row' + (it && it.ok ? '' : ' bad') + '">' +
      '<span class="hs-t">' + esc(cxMailWhen(it && it.t)) + '</span>' +
      '<b class="hs-k">' + (cx ? '学习通' : '积分') + '</b>' +
      '<span class="hs-v">' + esc(val) + '</span></div>';
  }).join('');
  return '<button class="hs-toggle" id="acHist" type="button" ' +
    'aria-expanded="false">运行记录 · ' + rows.length + ' 条' +
    '<i class="hs-caret"></i></button>' +
    '<div class="hs-list" id="acHistList" hidden>' + body + '</div>';
}

function openAutoSheet() {
  const a = autoCfg();
  const api0 = autoApi();
  let st = {};
  try { st = JSON.parse((api0 && api0.state()) || '{}'); } catch (e) { st = {}; }
  const canRun = !!(api0 && st.avail !== false);
  const word = [];
  // 每个开关**一行**：什么时候跑过、结果、下次大约几点。
  // 🔴 2026-11-13 用户：「底部一堆啰嗦的文字和重复的按钮」。
  //    以前是「学习通上次查是 3 分钟前，」「下次大约 23:27」分成两条 push，
  //    两行说的其实是同一件事，中间还夹着别的行 —— 读起来像流水账。
  if (a.cxOn) {
    let s = '学习通 · ';
    // 🔴 用「最近一次尝试」而不是「最近一次成功」（2026-11-16）。
    //    失败过一次之后面板原来写「未跑过 · 未连上」，而下面运行记录里明明白白
    //    躺着两条 18:08 / 18:23 —— 同一个弹层里两句话互相打脸。
    const when = st.cxLast || st.cxTry;
    s += when ? autoAgo(when) : '没跑过';
    if (st.cxWord) s += ' · ' + st.cxWord;
    word.push(s);
  }
  if (a.wtOn) {
    // 状态句里写「积分」不写「积分任务」：上面那颗开关已经叫全名了，
    // 这一行只回答「上次什么时候、结果怎么样」。多两个字就把这行推过 24 字。
    let s = '积分 · ';
    // 🔴 2026-11-16 用同一句话回答「今天做完没」（原来这块下面另起一行
    //    「今天未完成」，下面状态句又写「积分 · 未跑过」—— 三行都在说积分，
    //    用户原话「我让你把文案全面精简，精简在哪了」）。
    if (st.wtDoneToday) s += '今天已完成';
    else if (st.wtLast) s += autoAgo(st.wtLast);
    else s += '今天还没跑';
    if (st.wtWord) s += ' · ' + st.wtWord;
    word.push(s);
  }

  $('sheetBody').innerHTML =
    '<div class="sh-title">后台运行</div>' +
    (canRun ? '' : '<p class="tip note bad">仅手机版可用</p>') +
    '<div class="setrows">' +
      '<div class="setrow">' +
        '<span class="sk">学习通</span>' +
        '<button class="switch' + (a.cxOn ? ' on' : '') + '" id="acCx" role="switch" ' +
        'aria-checked="' + (a.cxOn ? 'true' : 'false') + '" aria-label="学习通"></button>' +
      '</div>' +
    '</div>' +
    '<div id="acCxBox"' + (a.cxOn ? '' : ' hidden') + '>' +
      // 「下次几点」放在这一行右边，而不是塞进下面的状态句 —— 状态句一长，
      // 用户读到的就是「这段字真多」，反而漏掉「今天做完没」。
      '<div class="setlabel">多久查一次' +
        (autoClock(st.cxNext)
          ? '<span class="sl-side">下次 ' + esc(autoClock(st.cxNext)) + '</span>'
          : '') +
      '</div>' +
      '<div class="seg flat" id="acCxSeg">' +
        [60, 120, 240].map((k) =>
          '<button class="seg-btn' + (k === a.cxMin ? ' on' : '') +
          '" data-min="' + k + '">' + AUTO_CX_CN[k] + '</button>').join('') +
      '</div>' +
    '</div>' +
    '<div class="setrows">' +
      '<div class="setrow">' +
        '<span class="sk">积分任务</span>' +
        '<button class="switch' + (a.wtOn ? ' on' : '') + '" id="acWt" role="switch" ' +
        'aria-checked="' + (a.wtOn ? 'true' : 'false') + '" aria-label="积分任务"></button>' +
      '</div>' +
    '</div>' +
    // 用户 2026-11-09：不要「每天几点」了 ——
    //   「会记忆当天的完成情况，没完成的话后台随时都能做，做完后当天就记为完成」。
    // 所以这里没有可选的钟点。「今天做完没」并进上面那行状态句（2026-11-16），
    // 这块不再单独占一行两行。
    (word.length ? '<p class="tip note acstate">' + word.map(esc).join('<br>') + '</p>' : '') +
    // 「开关开着」和「系统里真排上了」是两件事（2026-11-13）。
    // 被强行停止过、被系统清过、或者 ROM 自己的省电策略把任务扔掉，
    // 表现都是「开关亮着、后台从不动」。这一行把它说出来，并给一个
    // 立刻能自证的办法 —— 不然用户只能干等，等不到就以为功能是假的。
    (function () {
      if (typeof st.jobs !== 'string') return '';   // 旧版原生没有这个字段：别瞎判
      if (!a.wtOn && !a.cxOn) return '';
      const hasWt = /(^|,)(7102|7104)(,|$)/.test(st.jobs);
      const hasCx = /(^|,)(7101|7103)(,|$)/.test(st.jobs);
      const miss = (a.wtOn && !hasWt) || (a.cxOn && !hasCx);
      return miss
        ? '<p class="tip note bad">系统未排任务 · 点「现在试一次」</p>'
        : '';
    })() +
    (canRun && st.notify === false
      ? '<p class="tip note bad">通知未开，结果看不到 ' +
        '<button class="linkbtn" id="acNotify">去开启</button></p>'
      : '') +
    // 「现在试一次」是**次要动作**，做成一行小字链接（2026-11-13）。
    // 用户原话：「底部一堆啰嗦的文字和重复的按钮，把按钮变成一个」——
    // 两颗一样大的按钮并排，看起来像「两个都要点」。这里只留一颗，
    // 试跑退成链接：它本来就是「现在就想看」的人才会点的东西。
    (canRun && a.wtOn
      ? '<p class="tip note acrun"><button class="linkbtn" id="acRunNow">' +
        '现在试一次</button></p>'
      : '') +
    autoHistHtml(st.hist) +
    '<div class="sheetbtns">' +
      '<button class="btn" id="acBat">允许后台运行</button>' +
    '</div>';

  $('sheetMask').hidden = false;

  const sw = (id, key) => {
    const b = $(id);
    if (!b) return;
    b.addEventListener('click', () => {
      // 🔴 打开「每天自己做积分任务」的这一下，就是用户在说「可以动我的账号」。
      //    风险说明必须**在这一下**摊开。2026-11-13 用户报「从来没自动跑过」，
      //    根因之一就是这里：那道门原来只有前台点「一键完成」才会弹，
      //    而后台那条路（bgWtInit）遇到没同意过只是静默 `skip:'terms'` ——
      //    它不弹层、不报错、不通知，只在面板底部写一行小字。
      //    用户开完开关就去等，等到的是「每小时醒一次、每次跳过、永远不动」。
      if (key === 'wtOn' && !a[key] && !store.get(WT_TERMS_KEY, false)) {
        const ok = wtNeedTerms(() => {
          a[key] = true;
          const w = autoPush();
          if (w) toast(w);
          autoRepaint();
          openAutoSheet();
        });
        if (!ok) return;       // 说明已经摊开；点了「知道了」才真的打开开关
      }
      a[key] = !a[key];
      // 打开任何一个后台开关时顺手要一次通知权限：不给的话，跑完一条都看不到，
      // 而用户会以为「它没跑」。这里要权限是用户点开关带出来的，不算打扰。
      const r0 = remindApi();
      if (a[key] && r0) {
        try { r0.ask(); } catch (e) { /* 老系统没有这个权限 */ }
      }
      const why = autoPush();
      if (why) toast(why);
      autoRepaint();
      openAutoSheet();
    });
  };
  sw('acCx', 'cxOn');
  sw('acWt', 'wtOn');

  if ($('acCxSeg')) {
    $('acCxSeg').querySelectorAll('.seg-btn').forEach((b) => {
      b.addEventListener('click', () => {
        a.cxMin = Number(b.dataset.min) || 120;
        const why = autoPush();
        if (why) toast(why);
        autoRepaint();
        openAutoSheet();
      });
    });
  }
  if ($('acNotify')) {
    $('acNotify').addEventListener('click', () => {
      const r1 = remindApi();
      if (r1) r1.ask();
      toast('开启通知后才收得到结果');
    });
  }
  if ($('acRunNow')) {
    $('acRunNow').addEventListener('click', () => {
      if (!api0) { toast('仅手机版可用'); return; }
      let why = '';
      try { why = String(api0.runNow('wt') || ''); }
      catch (e) { why = String((e && e.message) || e); }
      if (why) { toast(why); return; }
      toast('已排上，约半分钟开始', 3000);
      // 90 秒后自己重画一次：面板还开着的话，用户不用关掉再打开才看得到结果。
      // （这不是「定时刷新」，只在这一下之后触发一次。）
      setTimeout(() => {
        const m = $('sheetMask');
        if (m && !m.hidden) { try { openAutoSheet(); } catch (e) { /* 面板已经换了 */ } }
      }, 90000);
    });
  }
  if ($('acHist')) {
    $('acHist').addEventListener('click', () => {
      const box = $('acHistList');
      if (!box) return;
      box.hidden = !box.hidden;
      $('acHist').classList.toggle('open', !box.hidden);
      $('acHist').setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
    });
  }
  if ($('acBat')) {
    $('acBat').addEventListener('click', () => {
      if (!api0) { toast('仅手机版可用'); return; }
      // Java 那边会跳它认得的那个厂商页面，并回一句「到了那儿该点什么」。
      // 🔴 这句提示不能省：跳过去之后用户面对的是一个陌生页面，
      //    没有这句话他多半会退回来，然后以为「点了没用」。
      let tip = '';
      try { tip = String(api0.openBattery() || ''); } catch (e) { tip = ''; }
      if (tip) toast(tip, 4000);
    });
  }
}

/** 打开 App 时按设置自动查一次。默认「每次打开」。 */
// ------------------------------------------------------------------ 校历
/* 数据来源：学校发布的《2026–2027 学年校历》（外国语学院转载的公开页面
   原网站），关键日期逐条人工核对过。

   🔴 为什么写死在代码里，而不是每次去抓：
      ① 校历一个学年只变一次，天天去抓 364 天是白抓；
      ② 它是一张 3504×5096 的图片，没有结构化接口，抓回来也解析不出日期；
      ③ 抓不到的时候只能显示「没有校历」—— 把「没抓到」说成「没有」，
         正是红线 40 那种错。
      代价是每学年要改一次，所以只留 CAL_TERMS 一个入口。

   每周的起止是**算出来的**，不是抄的：第 1 周一定是周一
   （2026-09-07、2027-02-22 都核对过是星期一），第 n 周 = 开学 + (n-1)×7 天。
   拿它跟校历图上印的日期对过，19 周末正好是放假前一天。 */
const CAL_YEAR = '2026–2027';
const CAL_TERMS = [
  {
    name: '第一学期',
    start: '2026-09-07',        // 第 1 周的周一
    weeks: 19,
    holiday: { d: '2027-01-18', label: '寒假' },
    marks: [
      { d: '2026-09-05', e: '2026-09-06', t: '在校生、第二学士学位新生报到注册' },
      { d: '2026-09-07', t: '在校生开始上课' },
      { d: '2026-09-07', e: '2026-09-08', t: '新生（研究生、本科、专升本）报到注册' },
      { d: '2026-09-09', t: '专升本新生开始上课' },
      { d: '2026-09-14', t: '研究生新生开始上课' },
      { d: '2026-10-08', t: '本科新生开始上课' },
      // 这两条跨整学期，日期列改成「第几周」，比印两个日期好读
      { d: '2026-09-07', e: '2027-01-10', w: '1–18 周', t: '理论教学' },
      { d: '2027-01-11', e: '2027-01-17', w: '19 周', t: '考试周' },
      { d: '2027-01-18', t: '放寒假' },
    ],
  },
  {
    name: '第二学期',
    start: '2027-02-22',
    weeks: 19,
    holiday: { d: '2027-07-05', label: '暑假' },
    marks: [
      { d: '2027-02-22', e: '2027-02-23', t: '在校生报到注册' },
      { d: '2027-02-24', t: '开始上课' },
      { d: '2027-02-22', e: '2027-06-27', w: '1–18 周', t: '理论教学' },
      { d: '2027-06-28', e: '2027-07-04', w: '19 周', t: '考试周' },
      { d: '2027-07-05', t: '放暑假' },
    ],
  },
];

const calYmd = (d) => d.getFullYear() + '-' +
  String(d.getMonth() + 1).padStart(2, '0') + '-' +
  String(d.getDate()).padStart(2, '0');

/** 校历里哪个学期的日期条目是**收起**的（0.33.0）。
 *
 *  默认：当前学期展开、另一学期收起 —— 两学期全摊开是 14 条 = 721px，
 *  这一页可用只有 726（还要放头卡和脚注），必须滑。
 *
 *  `fold[i]` 存的是**用户手点之后的状态**（true=展开）。没点过就是
 *  `undefined`，回落到默认：当前学期展开、另一学期收起。
 *  存在内存里就够，这是「这一眼想不想看」，不是设置，没必要落盘。
 */
const CAL = { fold: {}, past: {} };

// 校历「开学前那几条」默认收起：现在是第 8 周，9.5 报到注册、9.7 开始上课
// 这些早过去了，却是列表最上面四条、占 150 多 px —— 真机 360×712 上
// 校历页正好差这 127px。收起不是删：点一下全回来。
const CAL_PAST_KEEP = 1;   // 第一个「今天及以后」的条目往上，再留一条做上下文
const calMd = (d) => (d.getMonth() + 1) + '.' + d.getDate();

/** 某个学期在今天处于什么阶段。三种：没开学 / 学期中 / 已放假。 */
function calState(term, today) {
  const s = parseYmd(term.start);
  const last = addDays(s, term.weeks * 7 - 1);
  const diff = Math.round((today - s) / 86400000);
  if (diff < 0) return { phase: 'before', toStart: -diff, s: s, last: last };
  const week = Math.floor(diff / 7) + 1;
  if (week > term.weeks) return { phase: 'after', over: diff - (term.weeks * 7 - 1), s: s, last: last };
  return {
    phase: 'in', week: week, s: s, last: last,
    wStart: addDays(s, (week - 1) * 7),
    wEnd: addDays(s, (week - 1) * 7 + 6),
  };
}

/** 今天「最该看」的那个学期：学期中优先，其次下一个要开的，最后是刚结束的。 */
function calCurrent(today) {
  let before = null;
  for (let i = 0; i < CAL_TERMS.length; i++) {
    const st = calState(CAL_TERMS[i], today);
    if (st.phase === 'in') return { term: CAL_TERMS[i], st: st };
    if (st.phase === 'before' && !before) before = { term: CAL_TERMS[i], st: st };
  }
  if (before) return before;
  const lastTerm = CAL_TERMS[CAL_TERMS.length - 1];
  return { term: lastTerm, st: calState(lastTerm, today) };
}

function renderCalendar() {
  $('calLab').textContent = '东油校历适配中';
  $('calWeek').textContent = '待接入';
  $('calRange').textContent = '';
  $('calFill').style.width = '0%';
  $('calBody').innerHTML = '<div class="card"><p class="tip note">东油适配中，请以学校发布的校历为准。</p></div>';
  return;
  const today = today0();
  const cur = calCurrent(today);
  const term = cur.term;
  const st = cur.st;
  const curIdx = CAL_TERMS.indexOf(term);

  $('calLab').textContent = CAL_YEAR + ' 学年 · ' + term.name;

  const wk = $('calWeek');
  const rng = $('calRange');
  const fill = $('calFill');
  const find = $('calFind');

  if (st.phase === 'in') {
    wk.textContent = '第 ' + st.week + ' 周';
    rng.textContent = calMd(st.wStart) + ' – ' + calMd(st.wEnd);
    fill.style.width = Math.round((st.week / term.weeks) * 100) + '%';
    const left = term.weeks - st.week;
    const days = Math.round((parseYmd(term.holiday.d) - today) / 86400000);
    const parts = [];
    if (left <= 0) parts.push('本周就是考试周');
    else if (left === 1) parts.push('下周就是考试周');
    else parts.push('距考试周还有 ' + left + ' 周');
    if (days > 0) parts.push(term.holiday.label + '还有 ' + days + ' 天');
    find.textContent = parts.join(' · ');
  } else if (st.phase === 'before') {
    // 别把「还没开学」显示成「第 1 周」—— 那是拿一个假数字冒充事实
    wk.textContent = '还没开学';
    rng.textContent = calMd(st.s) + ' 开始';
    fill.style.width = '0%';
    find.textContent = '还有 ' + st.toStart + ' 天开学 · ' +
      term.name + '共 ' + term.weeks + ' 周';
  } else {
    wk.textContent = '已放假';
    rng.textContent = calMd(st.last) + ' 结束';
    fill.style.width = '100%';
    find.textContent = term.name + '已结束 ' + st.over + ' 天 · 下一学期见下方';
  }

  // 两个学期都列出来：在读的那个在前，另一个在后 —— 顺序跟着时间走，
  // 不因为「哪个是当前学期」而调换，否则用户每次都要重新找。
  //
  // 0.33.0：**非当前学期默认收起**（点标题展开）。
  // 两个学期全摊开是 14 条 = 721px，一页 933、可用只有 726 —— 必须滑。
  // 收起以后当前学期 9 条 + 两个学期头 = 约 490，一屏装得下。
  // 🔴 收起的那个学期只显示「几号到几号」，不显示任何日期条目 ——
  //    要看得点一下，这是用户自己的选择。
  let html = '';
  for (let i = 0; i < CAL_TERMS.length; i++) {
    const t = CAL_TERMS[i];
    const ts = calState(t, today);
    // 当前学期默认展开（除非用户点过收起），另一个默认收起。
    // 🔴 `CAL.fold[i]` 存的是「用户手点之后的状态」：一旦点过就以它为准，
    //    没点过才回落到默认。别拿「和默认反着来」当语义 —— 那样第一次点
    //    收起会变成「再点还是收起」（实测：第二个学期永远展不开）。
    const open = (CAL.fold[i] === undefined) ? (i === curIdx) : CAL.fold[i];
    html += '<button class="calsec tap" data-cali="' + i + '" aria-expanded="' +
      (open ? 'true' : 'false') + '">' +
      '<h2>' + esc(t.name) + '</h2>' +
      '<span>' + calMd(ts.s) + ' – ' + calMd(ts.last) + '</span>' +
      '<svg class="rowico calchev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' +
      '</button>';
    if (!open) continue;
    // 先数一数「今天之前」有几条 —— 收起来的是它们，不是删。
    let firstUp = t.marks.length;
    for (let j = 0; j < t.marks.length; j++) {
      const m = t.marks[j];
      const md = parseYmd(m.d);
      const me = m.e ? parseYmd(m.e) : md;
      if (me >= today) { firstUp = j; break; }
    }
    const hide = Math.max(0, firstUp - CAL_PAST_KEEP);
    const showPast = !!CAL.past[i];
    html += '<ul class="caltl">';
    if (hide > 0) {
      html += '<li class="calpast"><button class="calpast-btn" data-calpast="' + i +
        '" aria-expanded="' + (showPast ? 'true' : 'false') + '">' +
        (showPast ? '收起开学前那几条' : '前面还有 ' + hide + ' 条（开学前）') +
        '<svg class="rowico calchev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' +
        '</button></li>';
    }
    // 「下一件事」只认**开始日期在今天或以后**的第一条。
    // 不能拿「结束日期」判 —— 理论教学那条跨整学期，用它判会一直霸占高亮。
    let marked = false;
    for (let j = 0; j < t.marks.length; j++) {
      const m = t.marks[j];
      if (j < hide && !showPast) continue;
      const md = parseYmd(m.d);
      const me = m.e ? parseYmd(m.e) : md;
      let cls = '';
      if (me < today) cls = ' past';
      else if (!marked && md >= today) { cls = ' next'; marked = true; }
      const lab = m.w || (m.e && m.e !== m.d ? calMd(md) + '–' + calMd(me) : calMd(md));
      html += '<li class="' + cls.trim() + '"><span class="d">' + esc(lab) +
        '</span><span class="t">' + esc(m.t) + '</span></li>';
    }
    html += '</ul>';
  }
  $('calBody').innerHTML = html;
}

// ------------------------------------------------------------------ 校园（智慧门户）
/*
 * 这一页装的是**智慧门户**的东西，跟教务系统是两套账号：
 *   · 密码不一样（实测自助服务 9 位、门户 10 位）
 *   · 登录要算一道**算术验证码**，而且**错 5 次锁号**
 *
 * 三条硬规矩：
 *   1. **绝不自动登录、绝不 OCR 验证码** —— 锁号是用户自己的损失，省那 5 秒不值。
 *   2. 连一次由用户自己输；之后靠 CASTGC（CAS 的「身份证」）静默换票，
 *      门票（customsid）过期也不用重输密码。实测 CASTGC 撑不过 7.2 小时，
 *      但只要在失效前用一次就会续期 —— 「偶尔打开一次」的人基本不会掉线。
 *   3. 过期就老实说「要重新登录」。🔴 **不许**把「没读到」显示成「没有数据」：
 *      余额读不到时显示「—」而不是「0.00 元」—— 后者会让人以为钱没了。
 */

/** 学习通的课程页。
 *
 *  为什么是「送过去」而不是「读回来」：它的作业/考试没有一次性拿全的接口，
 *  藏在每门课的 iframe 里，爬一轮 20 多次请求、15 秒起步；超星一改版就
 *  静默返回 0 条。一个「可能读不到」的提醒比没有提醒更危险。
 *  用系统浏览器打开，登录一次之后 cookie 长期有效，不用每次输密码。
 */
const CX_HOME = 'https://mooc2-ans.chaoxing.com/mooc2-ans/visit/interaction';

const CAMPUS = {
  state: null,     // null=还没问过 / 'none' 没连 / 'ok' 已连 / 'expired' 过期了
  user: '',
  saved: false,    // 本机存着门户密码 ⇒ 过期重登只需算一道验证码
  savedUser: '',   // 存的是哪个学号的密码（只回学号，密码永远不出后端）
  bal: null,       // null = 没读到（**不是 0 元**）
  rows: [],
  total: 0,
  apps: [],
  open: false,     // 明细展开着没有
  busy: false,
  at: 0,           // 这批数据是什么时候拿到的（unix 秒）。0 = 不知道
  fromCache: false,// 是不是从本机读出来的
  // 刚清过缓存：在用户**自己**点进校园页之前，不许自动去取（见 clearLocalCaches）
  noAuto: false,
};

/* ---------------- 校园页的本地缓存 ----------------
 *
 * 用户的原话：
 *   「一些不需要太强即时性的信息（比如消费记录）也存到本地，
 *     只有在看校园卡余额之类的需要即时更新的东西的时候才需要访问门户」
 *
 * 所以分两类：
 *   · **消费记录 / 办事入口** —— 几小时前的和现在的没有区别，存本机，
 *     进页面**一个门户请求都不打**。
 *   · **余额** —— 随时会变，必须联网。但「必须联网」不等于「进页面就联网」：
 *     进来先显示上次那个数并写明「更新于 X」，用户点刷新才真去问。
 *
 * 这样还有一个副作用，是更重要的：**门户过期不再是灾难**。
 * CASTGC 撑不过 7.2 小时（学校那边的硬限制，改不了），
 * 以前一过期整块内容就消失；现在过期只是「余额可能不准」，
 * 消费记录和 19 个办事入口照常能用。
 */
/* 缓存「第几代」。清一次缓存就 +1，正在飞的请求回来看见代数变了就不许写回。
 *
 * 🔴 2026-11-12 踩到的：开机时那一批取数还没回来，用户点「清除本机缓存」，
 *    数据随后到达又把 zt.card / zt.apps / zt.notice 写了回去 ——
 *    按钮看着点了，实际等于没清（判据 check_cache [10] 偶发红，就是这么来的：
 *    单独跑 3 次，2 次红 1 次绿，取决于那次请求有没有在 1200ms 内回来）。
 *    cancelPrefetch() 只停「预取」，停不了已经在路上的那一个。 */
let CACHE_GEN = 0;

function cpCacheSave() {
  const at = CAMPUS.at || Math.floor(Date.now() / 1000);
  try {
    store.set(KEY.card, {
      user: CAMPUS.user, at: at, bal: CAMPUS.bal,
      rows: CAMPUS.rows, total: CAMPUS.total,
    });
    store.set(KEY.apps, { user: CAMPUS.user, at: at, apps: CAMPUS.apps });
  } catch (e) { /* 存不下不影响使用 */ }
}

/** 从本机读回来。**同一个学号才算数** —— 换人登录时必须重拿，
 *  否则会把上一个账号的消费记录摆给下一个人看。 */
function cpCacheLoad() {
  const c = store.get(KEY.card, null);
  const a = store.get(KEY.apps, null);
  let got = false;
  if (c && Array.isArray(c.rows) && (!c.user || !CAMPUS.user || c.user === CAMPUS.user)) {
    CAMPUS.bal = typeof c.bal === 'number' ? c.bal : null;
    CAMPUS.rows = c.rows;
    CAMPUS.total = c.total || 0;
    CAMPUS.at = c.at || 0;
    got = true;
  }
  if (a && Array.isArray(a.apps) && a.apps.length &&
      (!a.user || !CAMPUS.user || a.user === CAMPUS.user)) {
    CAMPUS.apps = a.apps;
    if (!CAMPUS.at) CAMPUS.at = a.at || 0;
    got = true;
  }
  CAMPUS.fromCache = got;
  return got;
}

/** 本机有没有能显示的东西（决定「过期」是整块藏起来、还是只加一条提示）。 */
function cpHasData() {
  return CAMPUS.rows.length > 0 || CAMPUS.apps.length > 0 || CAMPUS.bal != null;
}

/* ---------------- 消费小结（0.9.0）----------------
 *
 * 🔴 这个函数最难的地方不是算数，是**说清楚这份数据覆盖到哪儿**。
 *    门户那个接口一页 12 条、最多翻 3 页 ⇒ 手里只有最近 33 笔。
 *    这个月要是刷了 50 次，我们只看到 33 条；把「33 条里的合计」说成
 *    「本月一共」就是编数字。
 *
 *    判断办法：数据里**最早那一笔**早于本月 1 日 ⇒ 本月的记录从月初就有，
 *    统计是完整的；否则只能说「从 X 月 X 日算起」。
 *
 * 🔴 日均只在完整时给。被截断的时候连「这几天花了多少」都不知道，
 *    除出来的数只会误导人 —— 宁可不给。
 */
function yktYM(t) {
  const m = /^(\d{4})-(\d{2})/.exec(String(t || ''));
  return m ? m[1] + '-' + m[2] : '';
}

function yktStats() {
  // 只算支出。充值/补助是正数，混进「花了多少」里就全错了。
  const all = (Array.isArray(CAMPUS.rows) ? CAMPUS.rows : [])
    .filter((r) => r && r.time && Number(r.amount) < 0);
  if (!all.length) return { empty: true };

  const now = new Date();
  const ym = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
  const month = all.filter((r) => yktYM(r.time) === ym);
  if (!month.length) return { empty: true };

  let total = 0;
  let maxRow = month[0];
  const byPlace = {};
  month.forEach((r) => {
    const a = Number(r.amount);
    total += -a;
    if (a < Number(maxRow.amount)) maxRow = r;
    const p = String(r.place || '').trim();
    if (p) byPlace[p] = (byPlace[p] || 0) + 1;
  });

  const earliest = all.reduce((a, b) => (String(b.time) < String(a.time) ? b : a), all[0]);
  const full = String(earliest.time).slice(0, 7) < ym;
  const day = now.getDate();

  let topPlace = '';
  let topN = 0;
  Object.keys(byPlace).forEach((p) => {
    if (byPlace[p] > topN) { topN = byPlace[p]; topPlace = p; }
  });

  return {
    empty: false,
    full: full,
    count: month.length,
    total: total,
    avg: full && day > 0 ? total / day : 0,
    // 只去过一次不算「常去」，说了等于没说
    topPlace: topN >= 2 ? topPlace : '',
    topN: topN,
    maxAmt: -Number(maxRow.amount),
    maxPlace: String(maxRow.place || ''),
    since: String(earliest.time).slice(5, 10),
  };
}

/** Render the verified school-portal entry without claiming unsupported local data. */
function renderServices() {
  renderCampus();
}

function renderCampus() {
  const box = $('cpMoreBox');
  if (box) box.hidden = false;
  if ($('cpNote')) $('cpNote').textContent = '办事服务目录已在学校门户验证；应用内目录读取待接入。';
}

/** 取校园页数据。
 *
 *  `force = false`（默认，进页面/开机走这条）：
 *      只问一次本地状态（不探网），本机有缓存就直接画，**一个门户请求都不打**。
 *  `force = true`（用户点右上角刷新 / 重新连接后走这条）：
 *      真去门户取一次，取到就更新缓存。
 *
 *  🔴 为什么默认不联网：门户的 CASTGC 撑不过 7.2 小时，用户一天要撞上好几次
 *     「门票过期」。如果每次进页面都硬取，那就是每次都要输密码+验证码 ——
 *     而消费记录和办事入口其实几小时前的完全够用。
 */
async function loadCampus(force, quiet) {
  return { ok: false, kind: 'school_not_configured', error: '东油适配中' };
  if (CAMPUS.busy) return;
  // 刚清过缓存、用户还没点进校园页 ⇒ 一次请求都不发（force=用户点了刷新除外）。
  if (!force && CAMPUS.noAuto) { renderCampus(); return; }
  CAMPUS.busy = true;
  const gen = CACHE_GEN;          // 这一趟属于第几代（清缓存后作废，见 CACHE_GEN）
  try {
    const st = await api('/api/portal/status');
    CAMPUS.state = st.ok ? (st.state || 'ok') : 'none';
    CAMPUS.user = st.user || '';
    // 本机存着门户密码吗？（只回「存的是哪个学号」，密码永远不出后端）
    // 有了它，过期重登就只剩一道算术验证码要人算。
    CAMPUS.saved = !!st.saved;
    CAMPUS.savedUser = String(st.savedUser || '');
    // 'none' = 本机根本没存过门户会话（从没连过 / 断开了）。
    // 这时候**不许**拿缓存顶上 —— 缓存是「这个账号的数据」，
    // 而这时连「是不是同一个人」都无从判断。
    if (CAMPUS.state === 'none') { renderCampus(); return; }

    // 本机有缓存就先画出来，不管门户现在通不通。
    // 🔴 这一步必须在「state 判断」之后、联网之前：过期时也要能显示旧数据。
    const had = cpCacheLoad();

    // 缓存优先：不是「用户主动刷新」就到此为止，**一个门户请求都不打**。
    if (!force && had) { renderCampus(); return; }

    // 一卡通和应用列表并行拉。**任何一个失败都不许拖垮另一个** ——
    // 应用列表挂了也还能看余额，反过来也一样。
    const [card, apps] = await Promise.all([
      api('/api/portal/card').catch((e) => ({ ok: false, error: String((e && e.message) || e) })),
      api('/api/portal/apps').catch((e) => ({ ok: false, error: String((e && e.message) || e) })),
    ]);
    // 这期间用户点过「清除本机缓存」⇒ 这份数据属于上一代，整份作废。
    // 不加这一条的表现是：清完缓存，屏幕上又自己跳出余额和消费记录。
    if (gen !== CACHE_GEN) { renderCampus(); return; }
    let fresh = false;
    if (card && card.ok) {
      CAMPUS.bal = typeof card.balance === 'number' ? card.balance : null;
      CAMPUS.rows = card.rows || [];
      CAMPUS.total = card.total || 0;
      fresh = true;
    } else if (card && card.needLogin) {
      CAMPUS.state = 'expired';
    }
    if (apps && apps.ok) { CAMPUS.apps = apps.apps || []; fresh = true; }
    if (apps && apps.needLogin) CAMPUS.state = 'expired';

    if (fresh) {
      CAMPUS.at = Math.floor(Date.now() / 1000);
      CAMPUS.fromCache = false;
      cpCacheSave();
    } else if (!cpHasData()) {
      // 一样都没拿到、本机又是空的 ⇒ 让用户看到失败，而不是一片空白
      // ⚠️ `quiet` 只给开机预热用：那时候用户还没问任何事，
      //    更没点过「刷新」—— 弹一个「校园数据没读上来」是他没要的。
      const why = (card && card.error) || (apps && apps.error) || '没取到数据';
      if (!quiet) toast('校园数据没读上来：' + why, 3500);
    }
    renderCampus();
  } catch (e) {
    if (!quiet) toast('校园数据没读上来：' + ((e && e.message) || e), 3500);
    renderCampus();
  } finally {
    CAMPUS.busy = false;
  }
}

/* 连接门户的弹层。
 *
 * 🔴 0.8.0 起这里多了一种形态：**本机存着密码时，密码那一行变成一个按钮**
 *    （「已保存 · 点这里改成手动输入」），人只需要算一道验证码。
 *    为什么值得：门户那张身份证撑不过 7.2 小时，一天要撞好几次过期；
 *    每撞一次就要翻密码本的话，这个功能基本没法用。
 *
 * 🔴 密码**不回显**：/api/portal/status 只告诉我们「存的是哪个学号」，
 *    密码留在后端 / 原生层。所以这里只有「用」和「不用」两个状态，没有第三个。
 */
async function openPortalSheet() {
  // 进弹层前先问一次本机状态：存过密码吗？存的是哪个学号？
  // 问不到就按「没存」处理 —— 绝不假装有（那样用户会卡在一个填不了密码的框里）。
  let saved = CAMPUS.saved;
  let savedUser = CAMPUS.savedUser;
  let pwdState = '';          // none / ok / broken（空串 = 这个壳没这能力）
  try {
    const st = await api('/api/portal/status');
    if (st && st.ok) {
      saved = !!st.saved;
      savedUser = String(st.savedUser || '');
      pwdState = String(st.pwdState || '');
      CAMPUS.saved = saved;
      CAMPUS.savedUser = savedUser;
    }
  } catch (e) { /* 用已知的那份，别让弹层打不开 */ }

  let savedMode = saved;                 // 现在是不是「用存着的密码」
  const preUser = savedUser || CAMPUS.user || '';

  const passHtml = saved
    ? '<div class="field"><span>密码</span>' +
      '<button type="button" class="savedpw" id="pfPassBtn">' +
      '<b>已保存</b><i>点这里改成手动输入</i></button></div>'
    : '<label class="field"><span>密码</span><span class="pwdbox">' +
      '<input id="pfPass" type="password" autocomplete="current-password" ' +
      'placeholder="智慧门户密码">' + pwdEyeHtml('pfPass') + '</span></label>';

  // 「存着但解不开」必须单独说一句。
  // 不说的话，用户看到密码框只会得出一个结论：「它根本没记住密码」——
  // 而真相是存过、但系统把密钥重置了。两种情况该给的话不一样。
  const pwdWarn = (pwdState === 'broken')
    ? '<p class="tip warn">密码已失效（换手机或清数据），重输一次</p>'
    : '';

  $('sheetBody').innerHTML =
    '<div class="sh-title">连接智慧门户</div>' +
    '<div class="sh-sub">密码与教务处不同；验证码是算术题</div>' +
    '<label class="field"><span>学号</span>' +
    '<input id="pfUser" type="text" inputmode="numeric" autocomplete="username" ' +
    'placeholder="学号" value="' + escAttr(preUser) + '"></label>' +
    passHtml +
    pwdHelpHtml('portal') +
    pwdWarn +
    '<label class="field"><span>验证码</span>' +
    '<div class="caprow">' +
    '<input id="pfCode" type="text" inputmode="numeric" placeholder="算出结果">' +
    '<img id="pfCap" class="capimg" alt="验证码" title="点一下换一张">' +
    '</div></label>' +
    '<div class="sheetbtns"><button class="btn primary" id="pfGo">连接</button></div>' +
    '<p class="tip" id="pfTip"></p>';
  $('sheetMask').hidden = false;

  const tip = (s) => { $('pfTip').textContent = s || ''; };

  /** 从「已保存」切到手动输入。`why` 非空就同时提示一句原因。 */
  const toManual = (why) => {
    if (!savedMode) return;
    savedMode = false;
    const btn = $('pfPassBtn');
    if (btn) {
      const box = btn.parentNode;
      box.innerHTML = '<span>密码</span><span class="pwdbox">' +
        '<input id="pfPass" type="password" autocomplete="current-password" ' +
        'placeholder="智慧门户密码">' + pwdEyeHtml('pfPass') + '</span>';
      const el = $('pfPass');
      if (el) el.focus();
    }
    if (why) tip(why);
  };
  if ($('pfPassBtn')) $('pfPassBtn').addEventListener('click', () => toManual(''));

  const loadCap = async () => {
    $('pfCap').removeAttribute('src');
    try {
      const r = await api('/api/portal/captcha');
      if (r.ok && r.img) $('pfCap').src = r.img;
      else tip(r.error || '没取到验证码');
    } catch (e) { tip('没取到验证码：' + ((e && e.message) || e)); }
  };
  $('pfCap').addEventListener('click', loadCap);
  loadCap();

  $('pfGo').addEventListener('click', async () => {
    const user = $('pfUser').value.trim();
    // 空串 = 让后端用本机存着的那份（见 bridge.py / native.js 的 portal/login）
    const pass = $('pfPass') ? $('pfPass').value : '';
    const code = $('pfCode').value.trim();
    if (!user) { tip('学号要填'); return; }
    if (!pass && !savedMode) { tip('密码要填'); return; }
    if (!code) { tip('还没算验证码'); return; }
    $('pfGo').disabled = true;
    tip('正在登录…');
    try {
      const r = await api('/api/portal/login', { user: user, pass: pass, code: code });
      if (r.ok) {
        $('sheetMask').hidden = true;
        CAMPUS.state = 'ok';
        CAMPUS.user = r.user || '';
        // 登录成功后后端/原生会顺手把密码存下来，但**可能失败**。
        // 🔴 存不上就不许喊「已保存」—— 否则下次又白输一遍，
        //    用户还以为是自己记错了。这里如实说，并给出原因。
        const sv = String(r.pwdSave == null ? '' : r.pwdSave);
        const bad = sv.indexOf('fail') === 0;
        CAMPUS.saved = !bad;
        CAMPUS.savedUser = bad ? '' : user;
        if (bad) {
          toast('已连接门户，但密码没存住：' + sv.replace(/^fail:\s*/, ''));
        } else if (sv === 'soft') {
          toast('已连接门户（密码用的是备用加密方式存的）');
        } else {
          toast('已连接门户');
        }
        // 🔴 必须 force：刚登完就要看新的。走缓存优先的话，
        //    重新连接之后屏幕上还是上一次那个余额，等于白登。
        await loadCampus(true);
      } else {
        tip(r.error || '登录失败');
        // 后端说「存着的那份密码不对，已经删了」⇒ 立刻切成手输，
        // 否则用户再点一次还是用同一个错密码，撞满 5 次号就锁了。
        if (r.pwdStale) { CAMPUS.saved = false; CAMPUS.savedUser = ''; toManual(''); }
        // 🔴 验证码是一次性的，失败后一定换一张。不换的话用户再点一次
        //    必然还是错 —— 而门户错 5 次就锁号。
        loadCap();
        $('pfCode').value = '';
      }
    } catch (e) {
      tip('登录出错：' + ((e && e.message) || e));
    } finally {
      $('pfGo').disabled = false;
    }
  });
}

/* 在 App 内打开一个外链。办事入口、公告原文、百科、忘记密码全走这里。
 *
 * 三条路，差别只在「cookie 罐子」：
 *   - APK（0.6.0 起）：走 NativeApi.openWeb → App 内的 WebActivity。
 *     那边会把门户的 cookie（含 CASTGC 这张「身份证」）倒进 WebView 的罐子，
 *     所以 CAS 认得出你是谁，**点一下直接进，不用再登**。
 *   - APK 但窗口起不来（老版本没这能力 / 起 Activity 失败）：退回
 *     openExternal，也就是系统浏览器。那边是第三个 cookie 罐子，门户的登录态
 *     不在里面，第一次进去要再登一次 —— 但**点了必须有反应**，
 *     宁可多登一次也不能静默失败。
 *   - 网页版：openExternal 退成新标签页。
 *
 * 🔴 返回 true = 交出去了；false = 三条路都不通，**调用方负责说一句话**。
 *    （以前这里返回 undefined，而且兜底是裸 `window.open` —— 在 APK 里
 *      会被 MainActivity 拦掉，于是「点了没反应且不报错」。）
 *
 * 🔴 第三个参数 `warn`（默认 true）：这个地址「本来就要登录」吗。
 *    false 用于公开页（公告正文、校园百科）—— 那边没有 CASTGC 也照样能看，
 *    不该弹「门户登录已过期」。办事入口必须留默认值 true。
 *
 * 🔴 界面上那句说明是**两套文案**（index.html 的 data-app / 默认值）。
 *    网页版不许写「不用再登」—— 那是假的，用户一点就发现被骗了。
 */
/* 上一次 openApp 走了哪条路：'app' = App 内打开了；别的是降级/失败的原因。
 *
 * 🔴 为什么要记这个（0.17.3）：以前「App 内起不来 ⇒ 退回系统浏览器」是**静默**的。
 *    用户看到的是「跳浏览器 + 又要重新登录」，而 App 一声不响 —— 既像功能没做，
 *    又拿不到任何线索。有了这个字段，界面能把原因说出来，
 *    用户也能一眼告诉我们断在哪一步（'none' / 'fail: xxx' / '→ 浏览器'）。
 */
let OPEN_WHY = '';

function openApp(url, name, warn) {
  OPEN_WHY = '';
  if (!url) { OPEN_WHY = '没有地址'; return false; }
  if (NATIVE && window.NativeApi && typeof NativeApi.openWeb === 'function') {
    let why = 'none';
    try { why = NativeApi.openWeb(url, name || '', warn !== false); }
    catch (e) { why = 'fail: ' + ((e && e.message) || e); }
    if (why === '') { OPEN_WHY = 'app'; return true; }   // 窗口开出来了，收工
    // 'none' = 老 APK 没这能力；'fail: xxx' = 起不来。两种都往下退。
    OPEN_WHY = why;
  }
  if (openExternal(url)) { OPEN_WHY += ' → 浏览器'; return true; }
  return false;
}

/** 打开一个**办事系统**：先换票，再开。
 *
 * ================================================================
 * 为什么不能直接 openApp（2026-10-27 真机截图）
 * ================================================================
 * 用户点「学生信息管理」，App 内确实打开了 —— 但落在统一身份认证的登录页，
 * 底下还弹着「门户登录已过期」。真相不是过期：
 *
 *   APK 的登录走 CAS REST（POST /v1/tickets），服务端把 TGT 放在**响应体**里，
 *   **不会下发 CASTGC 这张 cookie**。而 WebActivity 判断「有没有登录态」
 *   看的偏偏就是 CASTGC ⇒ 永远判成过期 ⇒ 每次点都弹那句假话，
 *   而且「把 cookie 倒进 WebView」这条路在 APK 上根本不成立（罐子里没这张）。
 *
 * 正确做法：拿手上的 TGT 换一张**以这个系统地址为 service** 的票，
 * 拼在地址后面打开。办事系统自己拿票去 CAS 验，验过就是登录态 ——
 * 这条路不经过任何 cookie，所以不受「两个罐子」影响。
 *
 * ⚠️ 换不到票时**不能假装成功**：照旧打开原地址（用户至少能手动登），
 *    并且说清楚是哪一种失败。三种原因对用户是三种不同的动作：
 *      过期  → 去「账号管理」重新连一次
 *      没凭据 → 同上
 *      网络  → 换个网再试，别急着重登（重登要算验证码，还耗错误次数）
 */
async function openService(url, name) {
  if (!url) { OPEN_WHY = '没有地址'; return false; }
  let target = url;
  let ticketWhy = '';
  let haveTicket = false;
  // 🔴 票只能拼在 query 里，而且必须在 `#` 之前。
  //    拼到 `#` 后面会变成 fragment，**根本不会发给服务器**，票就等于丢了；
  //    而 CAS 校验的是「实际访问的 URL」，票丢了就退回登录页 ——
  //    表现和「没换票」一模一样，很难看出是拼串拼错了。
  //    service 也传去掉 fragment 的那一段：CAS 比对时不带 fragment。
  const hashAt = url.indexOf('#');
  const svc = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const frag = hashAt >= 0 ? url.slice(hashAt) : '';
  try {
    const r = await api('/api/portal/ticket?service=' + encodeURIComponent(svc));
    if (r && r.ok && r.ticket) {
      target = svc + (svc.indexOf('?') >= 0 ? '&' : '?') +
               'ticket=' + encodeURIComponent(r.ticket) + frag;
      haveTicket = true;
    } else {
      // 网页版走 bridge：那边失败时给的是 needLogin + error（没有 why）。
      ticketWhy = (r && r.needLogin) ? 'expired'
        : String((r && (r.why || r.error)) || 'unknown');
    }
  } catch (e) {
    ticketWhy = 'net';
  }
  // 有票 ⇒ 里面一定是登录态，别再让原生弹「登录已过期」（warn=false）。
  const ok = openApp(target, name, !haveTicket);
  if (!ok) return false;
  if (haveTicket) return true;
  // 没换到票：打开是打开了，但要如实说一句，否则用户以为是「设计如此」。
  // 🔴 三种原因对应**三种不同的动作**，不能合并成一句「登录过期了」：
  //      no-tgt  —— 本机一条门户凭据都没有（没连过 / 刚断开）⇒ 进去登一次就好
  //      expired —— 有凭据，服务端不认了（约 7 小时闲到过期）⇒ 同上，但要知道是时间到了
  //      net     —— 连不上门户 ⇒ 换个网再试，**别急着重登**（重登要算验证码，
  //                 还消耗错误次数）
  //    括号里那个英文码是给排查用的：用户截图一发，就知道断在哪一条分支。
  // 🔴 括号里的技术码（net / no-tgt / expired）只留给日志，不给人看
  //    （2026-11-01）：用户既分不清这几样，也不会因此做不同的事 —— 都要手动登一次。
  if (ticketWhy === 'net') {
    toast('这次没连上学校门户，进去可能要手动登一次', 5000);
  } else if (ticketWhy === 'no-tgt') {
    toast('需要手动登录一次门户', 6000);
  } else if (ticketWhy === 'expired') {
    toast('门户登录过期，重新登录', 6000);
  } else {
    console.warn('[portal] 自动登录失败：' + ticketWhy);
    toast('这次没能自动登录，进去可能要手动登一次', 6000);
  }
  return true;
}


/* 断开门户。同样抽成具名函数给「账号管理」页复用。 */
async function unbindPortal() {
  if (!(await askConfirm('断开门户？',
    '断开后一卡通与办事入口不可见，密码删除',
    '断开'))) return;
  try { await api('/api/portal/logout', {}); } catch (e) { /* 本地断开就够了 */ }
  CAMPUS.state = 'none'; CAMPUS.bal = null; CAMPUS.rows = []; CAMPUS.apps = [];
  CAMPUS.open = false; CAMPUS.at = 0; CAMPUS.fromCache = false;
  // 密码也跟着没了（后端 logout 会连密码一起删）—— 界面上的标记必须同步，
  // 否则下次进来还会说「只要算一道验证码」，点进去却要填密码。
  CAMPUS.saved = false; CAMPUS.savedUser = '';
  // 🔴 缓存必须一起清。不清的话下次连上别人的账号，
  //    会在「拿到新数据之前」先闪一下上一个人的消费记录。
  store.del(KEY.card);
  store.del(KEY.apps);
  renderCampus();
  renderAccounts();
}
// 0.39.1：`#cpUnbind`（校园页那张「断开门户」整行）已删，入口统一到
// 「我的 → 账号管理 → 智慧门户 → 断开」，调的还是这个 unbindPortal。

// --------------------------------------------------- 密码框：显示密码 / 找回密码
//
// 用户 2026-10-22：「很多时候用户可能忘记了密码，再去找官网改密码之类的很麻烦」
// +「在输入密码的密码框右侧加个显示密码的按键吧」。
//
// 🔴 三个地址都得是**这个 App 已经在用的那几个域名**，别凭印象改：
//      · 教务 —— 走学校的 WebVPN 登录页（`NepuActivity.LOGIN_URL` 同一个地址），
//        教务系统本身没有独立的「忘记密码」页，重置由统一认证那边管。
//      · 学习通 —— 超星账号级的找回页，跟学校 id 关系不大。
//      · 门户 —— 统一身份认证入口（`portal.nepu.edu.cn`），重置在它里面。
//   写错的代价比不给还大：点开一个 404 或者别人学校的站，用户会以为整个 App 坏了。

const PWD_HELP = {
  jw: { name: '统一认证',
        url: 'https://webvpn.nepu.edu.cn/users/sign_in' },
  cx: { name: '学习通',
        url: 'https://passport2.chaoxing.com/pwd/findpwd?version=1&fid=1286' },
  portal: { name: '智慧门户',
            url: 'https://portal.nepu.edu.cn/#/index4' },
};

/** 「显示密码」眼睛按钮。`id` 是要切换的那个输入框。
 *  图标走 index.html 顶部的 <symbol> 精灵表 —— 静态两处、动态两处共用一份。 */
function pwdEyeHtml(id) {
  return '<button type="button" class="pweye" data-for="' + escAttr(id) + '" ' +
    'aria-label="显示密码" aria-pressed="false">' +
    '<svg class="eye-on"><use href="#i-eye"/></svg>' +
    '<svg class="eye-off"><use href="#i-eye-off"/></svg></button>';
}

/** 密码框下面那行「忘记密码」。`sys` 是 PWD_HELP 的键。 */
function pwdHelpHtml(sys) {
  const h = PWD_HELP[sys];
  if (!h) return '';
  return '<button type="button" class="pwdlost" data-pwdhelp="' + escAttr(sys) +
    '">忘记密码？去' + escAttr(h.name) + '重置</button>';
}

/** 切换明文/密文。
 *
 *  ⚠️ 改 `type` 之后光标会跑到末尾，有的内核（老 Safari）还会直接丢焦点。
 *     两个都补一下 —— 用户正在打字时按到眼睛，回来必须还在原来位置附近。 */
function togglePwdEye(btn) {
  const input = document.getElementById(btn.getAttribute('data-for') || '');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  btn.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
  try {
    input.focus();
    const n = input.value.length;
    input.setSelectionRange(n, n);
  } catch (e) { /* 不支持就算了，别为了光标位置报错 */ }
}

/** 委托到 document，不挂在按钮上。
 *
 *  🔴 学习通的密码框和学习页一起被 innerHTML 重画（切 tab、重新检查都会换掉），
 *     门户弹层里那个在「已保存 → 手动输入」时也会被换掉。
 *     挨个 addEventListener 的话，重画一次就少一个能用的按钮，而且不报错。 */
document.addEventListener('click', (e) => {
  const eye = e.target.closest ? e.target.closest('.pweye') : null;
  if (eye) {
    // 按钮在 <label class="field"> 里，不拦的话 label 会把点击转发给输入框
    e.preventDefault();
    e.stopPropagation();
    togglePwdEye(eye);
    return;
  }
  const lost = e.target.closest ? e.target.closest('.pwdlost') : null;
  if (lost) {
    e.preventDefault();
    e.stopPropagation();
    const h = PWD_HELP[lost.getAttribute('data-pwdhelp') || ''];
    if (!h) return;
    // 0.17.3 起在 App 内打开：jwglxt / sfrz 都在学校域名下，门户连着就直接进。
    // 以前交给系统浏览器 —— 那是第三个 cookie 罐子，找回密码页先让你登一次，
    // 而用户点「忘记密码」的原因恰恰是登不进去。
    // 兜底仍是系统浏览器（openApp 内部），网页版退成新标签页。
    if (!openApp(h.url, '找回密码')) {
      toast('打不开，可以复制这个地址手动打开：' + h.url, 6000);
    }
  }
});

// ------------------------------------------------------------------ 启动

/* 课表上「作业 / 考试」这两份数据是**晚到**的（2026-11-14）。
 *
 * 用户报：「新增作业或者考试，好像不会自动添加到课表」。
 *
 * 根因不是画错，是**没人去要**：
 *   · 学习通的作业只有扫过一次才有；后台扫完那条路以前压根不落截止缓存
 *     （见 bgStep 的 state==='done' 分支，已补）；
 *   · 教务的考试安排只在用户点进「考试」页时才取（loadExamTerm），
 *     不点就永远没有 —— 课表上当然一条带子都不长。
 *
 * 所以开机后补一次、从后台切回来再补一次（限流五分钟一次）。
 * 🔴 只读**已经扫过**的那份（/api/cx/todo），不在这里点扫描：
 *    扫描是几十个请求、几十秒的事，开机时干那个会把首屏拖垮，
 *    而且会被平台当成脚本。真扫描有后台任务那条路。
 */
let _schExtrasAt = 0;

function schExtrasRefresh() {
  const now = Date.now();
  if (now - _schExtrasAt < 5 * 60_000) return;
  _schExtrasAt = now;
  try {
    if (CX && CX.state === 'ok') cxRefresh(true);
  } catch (e) { /* 没连学习通就跳过 */ }
  try {
    const sid = (DATA && DATA.semester && DATA.semester.id) || '';
    if (!sid) return;
    const rec = examBucket(sid);
    const at = Number(rec && rec.at) || 0;
    // 六小时：考试安排一天变不了几次，而这是学校服务器上的一个重请求。
    const stale = !at || (Date.now() / 1000 - at) > 6 * 3600;
    if (stale && !EXAM_ERR[sid]) loadExamTerm(sid);
  } catch (e) { /* 取不到就等下一次 */ }
}

/** 开机预热常用页（2026-11-16）。
 *
 *  只碰**本机 bridge 的接口**（`/api/water/state`、`/api/portal/status`、
 *  `/api/cw/state`），不打学校服务器 —— 那些有节流、有验证码，开机就去问
 *  属于白打。所以这里不会让「打开 App 就多几张请求单」。
 *
 *  🔴 不 await、失败不管：预热是为了下一屏好看，不能拖慢首屏，也不能
 *     因为某一页没连账号就在启动时弹一句错误。
 */
function warmCommonPages() {
  if (!wtSnap) {
    api('/api/water/state').then((st) => {
      if (st) wtSnap = st;
      if (CUR_PAGE === 'campus' && st) wtApplyState(st, true);
    }).catch(() => {});
  }
}

async function boot() {
  // 本地课表直接使用本机数据；联网服务由 Android 原生层处理。
  // 开机那一行：版本和运行环境只记在本机。
  appLog('启动 v' + APP_VERSION + ' code ' + APP_CODE + ' ' +
         (NATIVE ? 'android' : 'web'));
  // 打开次数 +1（求 Star 的时机靠它，见 starAskOnce）。只加一个数字，
  // 不碰别的设置；后台那个隐藏页面走 bgStart，不经过这里，所以不会被算进去。
  CFG.launchN = (CFG.launchN || 0) + 1;
  store.set(KEY.settings, CFG);
  // CX、WT 在脚本末尾初始化后才可访问，先用基础数据画出首屏。
  // 老版本存的默认开学日期比真实开学早一周（见 migrateStartDate），先修再画
  if (DATA && DATA.source !== 'nepu' && migrateStartDate(DATA.semester)) store.set(KEY.settings, CFG);
  applyEnvTexts();
  renderExamView();
  renderSchedule(); renderMe();
  renderCalendar();                          // 纯本地算，零成本，开机就画好
  // 校历的学期头可点（0.33.0）。#calBody 这个元素本身不随重画换掉
  // （换的只是 innerHTML），所以挂一次就够 —— 挂在里面会越积越多。
  $('calBody').addEventListener('click', (e) => {
    // 「前面还有 N 条（开学前）」
    const pb = e.target && e.target.closest ? e.target.closest('.calpast-btn') : null;
    if (pb) {
      const k = Number(pb.dataset.calpast);
      CAL.past[k] = !CAL.past[k];
      renderCalendar();
      return;
    }
    const b = e.target && e.target.closest ? e.target.closest('.calsec') : null;
    if (!b) return;
    const i = Number(b.dataset.cali);
    // 点一下就翻转。以**界面上现在是什么状态**为准，不猜默认值。
    CAL.fold[i] = b.getAttribute('aria-expanded') !== 'true';
    renderCalendar();
  });
  probeBound();                              // 不 await：别挡住首屏
  // 两份「后台自动」设置对齐一次（原生那份才是真在跑的那份）。
  // 只在这一刻做，点开关那条路照旧 —— 每开一次 App 都重推会重置计时器。
  autoBootSync();
  // 常用页预热：等首屏画完、也不跟查更新抢那点带宽（1.2 秒后）。
  setTimeout(() => { try { warmCommonPages(); } catch (e) { /* 预热失败不该影响启动 */ } }, 1200);
  // 查更新（2026-11-24）：5 秒后，等首屏、课表、闹钟都排完，也不跟预热抢带宽。
  // 开关关着时 updAutoCheck 第一行就返回，这里不用再判断一遍。
  setTimeout(() => { updAutoCheck(); }, UPD_BOOT_DELAY_MS);

  // 通知 / 小组件点进来的落点（0.47.8）。`p` 由 MainActivity 拼在 URL 上，
  // 应用已经开着时走 onNewIntent，直接调 window.__hytPage，不经过这里。
  const qs = new URLSearchParams(location.search);
  const pgIn = qs.get('p');
  if (pgIn) setTimeout(() => { window.__hytPage(pgIn); }, 300);
  // 碰一碰（0.52.0 v7）：贴纸里的设备编号拼在 URL 上（见 MainActivity.onCreate）。
  // 比 p 晚 60ms：先切页、再启动，两个动作挤在同一帧里页面会闪一下。
  const didIn = qs.get('did');
  // `nfc=1` 只有原生那边确认「这一趟带着真实 NFC 标签」时才拼上（见
  // MainActivity.fromTag）。别的应用 / 网页递进来的链接没有这一位，页面会先问一句。
  if (didIn) {
    const byTag = qs.get('nfc') === '1';
    setTimeout(() => { window.__hytWater(didIn, byTag); }, 360);
  }

  // 提醒：本地算好推给系统闹钟，不联网、不等任何请求。
  // 放在 1.2 秒后 —— 首屏先画出来，排 60 个闹钟要 cancel/create 一百多次，
  // 挤在启动那一瞬间会让人感觉「打开有点卡」。
  setTimeout(() => { remindPush(true); widgetPush(); }, 1200);
  // 从后台切回来时重排一次：清单里最早那几条可能已经过去了，
  // 不重排的话，用户切出去一天再回来，后续提醒就断了。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    remindPush();
    widgetPush();
    schExtrasRefresh();          // 作业 / 考试晚到的那两份（限流五分钟）
    // 回前台再快查一次随堂练习（0.52.3 v6）：练习只有几分钟，
    // 出去接个电话再回来，正是最需要知道「现在还有没有」的时候。
    // 一分钟节流在 cxLiveRun 里，切来切去不会变成连发请求。
    if (CUR_PAGE === 'exams') cxLiveRun();
  });
  // 首屏画完之后再补作业和考试（两秒后，别和首屏抢带宽）。
  // 不这么补的话，用户不进「考试」页、不进「学习」页，课表上永远没有刻度和带子。
  setTimeout(schExtrasRefresh, 2000);
  // 求一次 Star（2026-11-25）：等首屏、闹钟、预热都排完再说 —— 4 秒。
  // 「第几次打开 / 有没有课表 / 有没有别的弹层」全在 starAskOnce 里判，
  // 这里只负责别在开机那一下盖上去。
  setTimeout(starAskOnce, 4000);


}


/* ==================================================================
   后台自动检查（0.50.0 v5）
   ==================================================================
   用户 2026-11-09：「让软件能够后台运行，每隔一段时间，比如一个小时或者
   两个小时扫一次学习通」「每天自动做积分任务，这样就不用一直待在这个页面」。

   做法：Android 那边到点起一个**看不见的网页**（`AutoJob`，系统的定时任务），
   它加载的就是这一页，只是带着 `?bg=1` —— 于是下面这段接管，跑完一件事
   就通过 `AndroidBg.done()` 回报，服务随即关掉自己。

   🔴 为什么让后台也走这一整份 app.js，而不是在 native.js 里另写一套：
      查学习通和跑任务里有大量「判据」（哪条算新、还能做几次、连续几次失败
      就停、积分变动怎么说）。抄一遍的后果不是崩，而是**两边结论不一样**，
      而且不报错 —— 这类问题在这个项目里吃过太多次亏了。
      代价只是后台那几分钟多占一份内存，跑完就还回去。

   🔴 后台这条路**什么都不许自己决定**：
      · 开关默认是关的，用户点了才排闹钟；
      · 风险说明没同意过（wtNeedTerms）就一次都不动账号；
      · 页面上正开着这个应用时，后台那一路直接跳过（见 MainActivity.alive）。
   ================================================================== */

const BG_MODE = /(?:^|[?&])bg=1(?:&|$)/.test(String(location.search || ''));

/** 后台这一轮的结果交回给 Android。桥不在（网页版）就当没这回事。 */
function bgReport(o) {
  try {
    if (window.AndroidBg) window.AndroidBg.done(JSON.stringify(o));
  } catch (e) { /* 交不回去也要让页面自己安静下来 */ }
}

/* ---------------------------------------------------------------- 后台的进度
 * 🔴 2026-11-09 重做：后台这一路**不许再靠 setTimeout 等**。
 *
 * 用户报「学习通在后台经常没法成功检查」。原因不是网络，是这个：
 * 后台那个 WebView 不挂在任何窗口上（见 AutoJob），Chromium 把它当
 * 「隐藏页面」，`setTimeout` 会被节流到 1 秒/次、隐藏久了变 1 分钟/次。
 * 原来 `bgCx` 是「睡 1.5 秒 → 查一次 → 再睡」，140 秒的窗口里只来得及
 * 查几次，扫描还没完就被判超时 —— 而界面上什么错都没有。
 *
 * 现在拆成「一步一个函数」：`bgStep()` 只做当前这一小步（发请求、看一眼），
 * 由 **Java 那边每 1.2 秒推一步**（Handler 的定时器不受网页节流影响），
 * JS 里一个 sleep 都没有。网页版/老 APK 没人来调，下面那个 setInterval
 * 兜着 —— 能跑就跑，跑不动也有 Java 那条路。
 🔴 2026-11-11：Java 那边原来只调 `bgState()`（纯查询），推进其实全靠
    下面这个 `setInterval` —— 而它正是被节流到 1 分钟一次的那个。
    一轮扫描几十步就是几十分钟，必然撞 5 分钟上限。现在 Java 会调
    `bgStep()` 了，这条路才真的成立。
 * ------------------------------------------------------------------ */
let BG_JOB = null;

/** 后台当前这一小步的结果。`ok === null` 表示还在跑，Java 那边继续等。 */
function bgState() {
  if (!BG_JOB) return '';
  if (BG_JOB.out) return JSON.stringify(BG_JOB.out);
  const s = { ok: null, job: BG_JOB.job, phase: BG_JOB.phase };
  // 扫到第几门也交回去（2026-11-16）：超时那条记录原来只有一句「没查完（等太久）」，
  // 谁都不知道是卡在第 3 门还是第 30 门 —— 用户报了十几遍，我们每次都只能猜。
  // 有了 i/n，超时就能写「没查完 12/37」，一眼看出是「压根没动」还是「差一点」。
  if (BG_JOB.prog) {
    s.i = BG_JOB.prog.i;
    s.n = BG_JOB.prog.n;
  }
  return JSON.stringify(s);
}

/** 推进一小步。**不循环、不 sleep**，做完一步就返回。 */
async function bgStep() {
  const J = BG_JOB;
  if (!J || J.out || J.busy) return;
  J.busy = true;
  try {
    if (J.job === 'wt') {
      // 一步只交一次：先排队，之后每推一步交一下（30 秒节奏在 JS 外面耗）。
      const r = BG_WT ? await bgWtNext() : await bgWtInit();
      if (r) J.out = r;
    } else if (J.phase === 'start') {
      let active = null, sem = '';
      try { active = cxActiveNames(); } catch (e) { active = null; }
      try { sem = (DATA && DATA.semester) || ''; } catch (e) { sem = ''; }
      const r0 = await api('/api/cx/scan', { force: false, activeNames: active, semester: sem });
      if (!r0 || !r0.ok) {
        J.out = { ok: false, job: 'cx',
                  error: String((r0 && r0.error) || '没连上'),
                  kind: String((r0 && r0.kind) || ''),
                  needLogin: !!(r0 && r0.needLogin) };
      } else {
        // started=false 不一定是错：上一次还在扫的时候也是 false（风控怕并发，
        // 不排队）。所以先记下「这一发到底启没启动」，下一步看状态再定性。
        J.started = !!r0.started;
        J.phase = 'poll';
      }
    } else {
      // 🔴 轮询阶段自己限速：原生现在每 1.2 秒就推一步（见 AutoJob.poll），
      //    但真正问服务端状态别超过两秒一次 —— 扫描本身要几分钟，
      //    问得再密也只是白打请求。跳过的这一步不算「在跑」，直接返回。
      if (J.lastAsk && Date.now() - J.lastAsk < 1800) { J.busy = false; return; }
      J.lastAsk = Date.now();
      const t = await api('/api/cx/todo', {});
      const st = (t && t.scan) || {};
      const state = String(st.state || '');
      // 进度也记一份（见 bgState 的说明）：超时那一刻要能说出「扫到第几门」。
      J.prog = { i: Number(st.i) || 0, n: Number(st.n) || 0 };
      if (state === 'done') {
        // 🔴 后台扫完也要落一份截止缓存（2026-11-14 用户报「新增的作业
        //    不会自动进课表」）。原来只有前台「学习」页那条路存，
        //    后台扫到的几十条新作业停在服务端，课表上一颗刻度都没有 ——
        //    用户看不出「扫到了」和「没扫到」的区别。
        //    存在同一个 localStorage 上，前台下次开机读到就是新的。
        try { if (t && t.data && t.data.items) dueCacheSave(t.data.items, 'cx'); } catch (e) {}
        J.out = bgCxSum((t && t.data) || {});
      }
      else if (state === 'error') {
        J.out = { ok: false, job: 'cx', error: String(st.err || '没查成'),
                  kind: String(st.kind || '') };
      } else if (state !== 'scanning') {
        // 状态既不是「扫着」也不是「完事」⇒ 这一发扫描根本没起来
        // （接口没接住 / 上一次刚结束还没写状态）。只有**这一次没启动**才算失败；
        // 「上一次还在扫」那种由上面的 scanning 分支继续等。
        if (!J.started) J.out = { ok: false, job: 'cx', error: '没能开始检查' };
      }
    }
  } catch (e) {
    J.out = { ok: false, job: J.job, error: String((e && e.message) || e) };
  }
  J.busy = false;
  if (J.out) bgReport(J.out);
}

/** 把这一轮的结果压成一句话要用的几个数。
 *  「新」= 这一轮还在待办里、而**上一次没记过**的那几条。
 *  🔴 第一次跑（本机还没有记录）不算「新」：那会儿要是一口气报二十条，
 *     用户收到的是一条「有 20 项新的」，而他其实早就知道。 */
function bgCxSum(d) {
  const items = (Array.isArray(d.items) ? d.items : [])
    .filter((it) => it && it.state !== 'done');
  const keys = items.map((it) => [
    it.course || it.courseName || '', it.kind || '',
    it.title || '', it.left || '',
  ].join('|'));
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem('hyt_auto_cx') || '[]'); } catch (e) { seen = []; }
  const old = new Set(Array.isArray(seen) ? seen : []);
  if (!old.size) {
    // 第一次：只记下来，不报新的
    try { localStorage.setItem('hyt_auto_cx', JSON.stringify(keys.slice(0, 400))); } catch (e) {}
    return { ok: true, job: 'cx', total: items.length, fresh: 0, seeded: items.length,
             missed: Array.isArray(d.failed) ? d.failed.length : 0 };
  }
  const fresh = items.filter((it, i) => !old.has(keys[i]));
  try { localStorage.setItem('hyt_auto_cx', JSON.stringify(keys.slice(0, 400))); } catch (e) {}
  const one = fresh[0] || null;
  return { ok: true, job: 'cx', total: items.length, fresh: fresh.length,
           first: one ? String(one.title || '') : '',
           course: one ? String(one.course || one.courseName || '') : '',
           missed: Array.isArray(d.failed) ? d.failed.length : 0 };
}

/* ---------------- 后台跑积分任务：一步只交一次 ----------------
 *
 * 🔴 2026-11-12 重做。原来这一路是 `await wtRunAll()` 一口气跑完：
 *    里面每次提交之间要 sleep(30 秒)，而 WebView 不挂在窗口上时 Chromium
 *    会节流定时器（1 秒的拉到 1 分钟）—— 五下就是五倍时间，必然撞上系统给
 *    单个后台任务的 9 分钟上限。超时被记成失败，一天三次之后当天彻底不动。
 *    用户看到的就是「自动积分任务形同虚设，完全不会自动完成」。
 *
 * 现在后台这条路**一个定时器都不用**：每被推一步只交一次，两次之间那 30 秒
 * 由 native 的轮询在 JS 外面耗掉（AutoJob.poll，1.2 秒一次，不受页面节流影响）。
 * 五下 2 分半、八下 4 分钟，稳稳在时限里。
 */
const BG_WT_CAP = 8;          // 一轮最多交 8 下（30 秒一次 ≈ 4 分钟）
let BG_WT = null;

/** 第一小步：读状态、读任务、排这一轮的队。返回 null = 还在跑。 */
async function bgWtInit() {
  // 风险说明没同意过：一次都不许动账号，安安静静跳过。
  if (!store.get(WT_TERMS_KEY, false)) return { ok: false, job: 'wt', skip: 'terms' };

  const st = await api('/api/water/state', {});
  if (!st || !st.accounts || !st.accounts.score) {
    return { ok: false, job: 'wt', error: '还没连积分账号' };
  }
  await wtLoadMissions(false);
  // 🔴 列表读失败**不许**当成「今天没有要做的」（2026-11-12）：
  //    那样会落一个「今天做完了」的标记，当天再也不跑 ——
  //    而用户什么都没做错，只是一次请求没成。
  if (WT.missionErr) {
    return { ok: false, job: 'wt', error: '任务列表没读到：' + WT.missionErr };
  }
  const items = wtRunnableRows();
  if (!items.length) return { ok: true, job: 'wt', none: true, done: 0 };

  // 先读一次积分：跑完要拿「跑之前 / 跑之后」两个数说话（用户最关心的就是
  // 到底涨没涨）。读不到也不影响跑，只是那句话里少一段。
  if (!WT.score) { try { await wtLoadScore(); } catch (e) {} }

  const plan = [];
  let cap = BG_WT_CAP;
  for (let i = 0; i < items.length && cap > 0; i += 1) {
    const n = Math.min(wtTimesOf(items[i]), cap);
    for (let k = 0; k < n; k += 1) plan.push(items[i]);
    cap -= n;
  }
  // 「今天还能拿多少分」——所有待做任务「剩余次数 × 单次分值」之和。
  // 🔴 平台**没有**「当日可获积分上限」这个字段（water.py 里 daily 只有签到、
  //    missions 只有单任务 limit/score）。这是唯一有数据支撑的分母：
  //    开跑那一刻还没做的分。用户要的「占上限的百分比」就是拿它当分母，
  //    所以界面上要写清是「今日剩余」，不能写成平台给的「上限」。
  const capScore = items.reduce(
    (a, x) => a + wtTimesOf(x) * (Number(x.score) || 0), 0);
  BG_WT = {
    plan: plan, i: 0, done: 0, fails: 0, firstErr: '', kind: '',
    before: (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : -1,
    cap: capScore,
    lastAt: 0,
  };
  return null;
}

/** 下一小步：到点了就交一次；没到点、或者还在等平台那 30 秒，直接返回 null。 */
async function bgWtNext() {
  const S = BG_WT;
  const gap = Math.max(0, Number(WT.runGap) || 30000);
  const now = Date.now();
  if (S.lastAt && now - S.lastAt < gap) return null;
  if (S.i >= S.plan.length) return await bgWtDone();

  const it = S.plan[S.i];
  S.i += 1;
  S.lastAt = now;
  const r = await wtSubmitOne(it);
  if (r.ok) {
    S.done += 1;
    S.fails = 0;
    wtDoneMark(it.refId);
  } else {
    S.fails += 1;
    if (!S.firstErr) { S.firstErr = r.error; S.kind = r.kind; }
    // 🔴 和前台同一套：登录过期立刻停；连着两次失败也停 ——
    //    原项目 README 自己写着「出现异常时请停止任务，勿反复运行期待自动恢复」。
    if (r.kind === 'auth' || S.fails >= 2) S.i = S.plan.length;
  }
  return null;
}

/** 收尾：重读任务和积分，把结论交回原生。 */
async function bgWtDone() {
  const S = BG_WT || { done: 0, before: -1, firstErr: '', kind: '', cap: 0 };
  BG_WT = null;
  // 重读一遍：剩余次数和积分都要拿服务端那个真数说话（和前台一致）。
  await wtLoadMissions(true);
  await wtLoadScore();
  const after = (WT.score && typeof WT.score.valid === 'number') ? WT.score.valid : -1;
  let rest = 0, leftTotal = 0;
  try {
    const rows = wtRunnableRows();
    rest = rows.length;
    leftTotal = rows.reduce((a, x) => a + wtTimesOf(x), 0);
  } catch (e) { rest = 0; leftTotal = 0; }
  // 一次都没交上：这不是「做完了」，是失败。原生按 ok=false 记一次失败。
  if (S.done === 0) {
    return { ok: false, job: 'wt', error: S.firstErr || '这次一个都没提交上',
             kind: S.kind || '', before: S.before, after: after,
             rest: rest, left: leftTotal, cap: S.cap || 0 };
  }
  const out = { ok: true, job: 'wt', done: S.done, before: S.before, after: after,
                rest: rest, left: leftTotal, cap: S.cap || 0 };
  if (S.firstErr) out.error = S.firstErr;
  return out;
}

/** 后台这一轮的入口。**只点火，不等** —— 等的是 Java 那边的轮询。 */
function bgStart() {
  const m = String(location.search || '').match(/[?&]job=([a-z]+)/);
  const job = m ? m[1] : 'cx';
  BG_JOB = { job: job, phase: 'start', busy: false, out: null, t0: Date.now() };
  BG_WT = null;                  // 每一轮从空队列开始（别接上一轮剩下的）

  // 先把方法挂到 window 上：Java 那边 evaluateJavascript 调的就是这个名字。
  window.bgState = bgState;
  window.bgStep = bgStep;

  bgStep();                      // 立刻走第一步，别等第一次轮询

  // 兜底：老 APK 不轮询、或者网页版直接打开这个地址时，自己每 2.5 秒推一步。
  // （新 APK 里这条基本是空转 —— 有 Java 那条路，节流也轮不到它。）
  const keep = setInterval(() => {
    if (BG_JOB && BG_JOB.out) { clearInterval(keep); return; }
    bgStep();
  }, 2500);
}

if (BG_MODE) bgStart();
else boot();