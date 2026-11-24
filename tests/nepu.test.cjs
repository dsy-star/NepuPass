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
assert.deepEqual(normalize({...raw, businessHours:[{jcdm:'01',start:'08:00:00',end:'08:45:00'}]}).businessHours, [['08:00','08:45']]);
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
