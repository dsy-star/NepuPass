'use strict';
const assert = require('node:assert/strict');
const {normalize, weeks, termName} = require('../web/nepu.js');
const row = {kcmc:'测试课程', kcbh:'A1', kcrwdm:'task', jxbdm:'class', zc:'16,1,2,2', qsxq:'01', ps:'07', pe:'08', qssj:'15:25', jssj:'17:00', jxcdmc:'默认楼', jxcdmc2:'楼-A-101-1,楼-B-202-16', teaxms:'教师'};
const raw = {term:'202601', week1Monday:'2026-09-07', courses:[row], grades:[
  {kcmc:'课程',kcbh:'C',xnxqdm:'202601',zcj:'优秀',xf:'2',cjjd:'4',ismax:'1'},
  {kcmc:'课程',kcbh:'C',xnxqdm:'202601',zcj:'59',xf:'2',cjjd:'0',ismax:'0'},
  {kcmc:'另一门',kcbh:'D',xnxqdm:'202601',zcj:'80',xf:'3',cjjd:'3.2',ismax:'1'}], exams:[]};
assert.deepEqual(weeks('3,1,3,5-7'), [1,3,5,6,7]);
assert.equal(termName('202601'), '2026-2027学年第1学期');
const result = normalize(raw);
assert.equal(result.courses.length, 3);
assert.deepEqual(result.courses[0].slots, [{day:6,period:6},{day:6,period:7}]);
for (let schoolDay = 1; schoolDay <= 7; schoolDay++) {
  const mapped = normalize({...raw, courses:[{...row, qsxq:String(schoolDay)}]}).courses[0].slots[0].day;
  assert.equal(mapped, (schoolDay + 5) % 7);
}
assert.equal(normalize({...raw, courses:[{...row, qsxq:'2', xq:'1'}]}).courses[0].slots[0].day, 0);
assert.equal(result.courses[0].room, '楼-A-101');
assert.deepEqual(result.courses[0].weeks, [1]);
assert.equal(result.courses[1].room, '楼-B-202');
assert.deepEqual(result.courses[1].weeks, [16]);
assert.deepEqual(result.courses[2].weeks, [2]);
assert.equal(result.courses[0].endTime, '17:00');
assert.equal(new Set(result.courses.map(c => c.code)).size, 3);
assert.equal(result.grades.courses.length, 3);
assert.equal(result.grades.overall.gpa, '3.52');
assert.equal(result.grades.overall.credits, '5');
assert.equal(result.grades.overall.courses, 2);
assert.equal(result.grades.courses[0].passed, true);
assert.equal(result.grades.courses[1].passed, false);
assert.equal(result.grades.courses[0].final, '优秀');
assert.equal(result.grades.courses[0].term, '2026-2027 1');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'优秀',xf:'1',cjjd:'4'}]}).grades.overall.gpa, '4.00');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'90',zcjfs:'90',xf:'3',cjjd:''}]}).grades.overall.gpa, '4.00');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'85',xf:'3',cjjd:''}]}).grades.courses[0].gpaEstimated, true);
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'90',xf:'3',cjjd:''}]}).grades.overall.estimated, true);
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'60',xf:'3',cjjd:''}]}).grades.courses[0].gpa, '1.0');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'61',xf:'3',cjjd:''}]}).grades.courses[0].gpa, '1.1');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'100',xf:'3',cjjd:''}]}).grades.courses[0].gpa, '5.0');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'59',xf:'3',cjjd:''}]}).grades.courses[0].gpa, '0.0');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'50',xf:'3',cjjd:''}]}).grades.courses[0].gpa, '0.0');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'90',xf:'3',cjjd:'3.5'}]}).grades.overall.gpa, '3.50');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'90',xf:'3',cjfsmc:'公选课',cjjd:''}]}).grades.overall.gpa, '');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'优秀',xf:'3',cjjd:''}]}).grades.overall.gpa, '');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'缺考',xf:'1',cjjd:''}]}).grades.overall.credits, '');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'',xf:'',cjjd:''}]}).grades.overall.gpa, '');
assert.equal(normalize({...raw, grades:[{kcbh:'X',zcj:'',xf:'2',cjjd:''}]}).grades.overall.credits, '');
assert.deepEqual(normalize({...raw, courses:[]}).courses, []);
assert.throws(() => normalize({...raw, grades:null}), /结构不完整/);
assert.throws(() => normalize({...raw, courses:[{...row, ps:'00'}]}), /节次/);
assert.deepEqual(normalize(raw).courses.map(c => c.code), result.courses.map(c => c.code));
assert.equal(raw.courses[0].zc, '16,1,2,2');
assert.equal(typeof result.syncedAt, 'number');
const onlyFirst = normalize({...raw, businessHours:[{jcdm:'01',start:'08:00:00',end:'08:45:00'}]}).businessHours;
assert.deepEqual(onlyFirst[0], ['08:00','08:45']);
// 页面只给了第 1 节时，第 7 节（period 6）的开始时间从排课记录（15:25）补上，不再留空洞
assert.deepEqual(onlyFirst[6], ['15:25','16:10']);

// 教务页面 businessHours 的下午结束时间是错的（13:30 配 14:45、14:20 配 15:35），
// 直接抄会画出互相重叠的节次栏；periodTimes 要按 45 分钟一节 + 排课记录修回来。
const {periodTimes} = require('../web/nepu.js');
const pageHours = ['08:00','08:50','09:55','10:45','13:30','14:20','15:25','16:15','18:00','18:50','19:55','20:45']
  .map((start, i) => {
    const [h, m] = start.split(':').map(Number);
    const end = new Date(2026, 0, 1, h, m + (i < 4 ? 45 : 75));   // 上午 45 分钟，下午 75 分钟
    return {jcdm: String(i + 1).padStart(2, '0'), start, end: end.toTimeString().slice(0, 5)};
  });
const fixed = periodTimes(pageHours, [], 12);
assert.equal(fixed.length, 12);
assert.deepEqual(fixed[4], ['13:30', '14:15']);
askMonotonic(fixed);
function askMonotonic(table) {
  for (let i = 0; i + 1 < table.length; i++) {
    if (!table[i] || !table[i + 1]) continue;
    assert.ok(table[i][1] <= table[i + 1][0], `第${i + 1}节结束晚于第${i + 2}节开始`);
  }
}
// 排课记录 7-8 节 15:25-17:00：块末节按记录收口，前一节仍是 45 分钟
const courseBlock = {slots:[{day:0, period:6}, {day:0, period:7}], startTime:'15:25', endTime:'17:00'};
assert.deepEqual(periodTimes(pageHours, [courseBlock], 12).slice(6, 8), [['15:25','16:10'], ['16:15','17:00']]);
// 页面没给第 9 节开始时间时，用课程块的开始时间补
assert.deepEqual(periodTimes([], [{slots:[{period:8}], startTime:'18:00', endTime:'18:45'}], 12)[8], ['18:00','18:45']);
// 越到下一节里的结束时间不采信，保留推算值（第 5 节 13:30 不该收到 15:40）
assert.deepEqual(periodTimes(pageHours, [{slots:[{period:4}], startTime:'13:30', endTime:'15:40'}], 12)[4], ['13:30','14:15']);
const {normalizeNotices} = require('../web/nepu.js');
const now = new Date(2026, 10, 24, 17).getTime();
const notice = (id, date, title = '通知') => ({id, date, title});
assert.deepEqual(normalizeNotices([
  notice('1', '2026-08-24 00:00:00'), notice('2', '2026-08-23 23:59:59'),
  notice('3', '2026-11-09 16:11:13'), notice('3', '2026-11-09 16:11:13'),
  notice('../1', '2026-11-01'), notice('4', '2026-11-25'),
  notice('5', '2026-02-30'), notice('6', '2026-11-01', '')
], now).map(n => n.id), ['3', '1']);
assert.equal(normalizeNotices([notice('1', '2026-02-28')], new Date(2026, 4, 31).getTime()).length, 1);
assert.equal(normalizeNotices([notice('1', '2026-02-27')], new Date(2026, 4, 31).getTime()).length, 0);
assert.deepEqual(normalizeNotices(null, now), []);
assert.equal(normalizeNotices([notice('1', '2026-11-09')], now)[0].url, '/new/desktop/ggtzview.page?ggtzdm=1');
console.log('NEPU normalization and notice assertions passed');
