/* NEPU read-only data adapter. No credentials or network transport live here. */
(function (root) {
  'use strict';
  const text = v => v == null ? '' : String(v).trim();
  function weeks(value) {
    const out = new Set();
    text(value).split(/[,，;；\s]+/).forEach(part => {
      const m = /^(\d+)(?:[-~至](\d+))?$/.exec(part);
      if (!m) return;
      const a = Number(m[1]), b = Number(m[2] || m[1]);
      if (a < 1 || b < a || b > 60) return;
      for (let w = a; w <= b; w++) out.add(w);
    });
    return Array.from(out).sort((a, b) => a - b);
  }
  function termName(id, supplied) {
    const m = /^(\d{4})0?([12])$/.exec(text(id));
    return m ? m[1] + '-' + (Number(m[1]) + 1) + '学年第' + m[2] + '学期' : text(supplied || id);
  }
  function gradeTerm(row) {
    const n = termName(row.xnxqdm, row.xnxqmc);
    const m = /(\d{4})-(\d{4}).*?([12])学期/.exec(n);
    return m ? m[1] + '-' + m[2] + ' ' + m[3] : n;
  }
  function time(value) {
    const m = /(?:^|\s|T)(\d{1,2}):(\d{2})(?::\d{2})?/.exec(text(value));
    return m && +m[1] < 24 && +m[2] < 60 ? m[1].padStart(2, '0') + ':' + m[2] : '';
  }
  function stable(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function courseRows(rows) {
    const result = [], seen = new Set();
    rows.forEach(row => {
      const ws = weeks(row.zc), p0 = Number(row.ps), p1 = Number(row.pe || row.ps);
      const day = Number(row.qsxq || row.xq);
      if (!text(row.kcmc) || !ws.length || !Number.isInteger(day) || day < 1 || day > 7 ||
          !Number.isInteger(p0) || !Number.isInteger(p1) || p0 < 1 || p1 < p0 || p1 > 24) {
        throw new Error('课表记录缺少有效周次、星期或节次，请保留缓存并重试');
      }
      const rooms = new Map(), mapped = new Set();
      text(row.jxcdmc2).split(/[,，]/).forEach(item => {
        const m = /^(.*)-(\d+)$/.exec(item.trim());
        if (!m || !ws.includes(Number(m[2]))) return;
        const room = m[1].trim(), w = Number(m[2]);
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(w); mapped.add(w);
      });
      const rest = ws.filter(w => !mapped.has(w));
      if (rest.length) {
        const room = text(row.jxcdmc);
        if (!rooms.has(room)) rooms.set(room, new Set());
        rest.forEach(w => rooms.get(room).add(w));
      }
      rooms.forEach((set, room) => {
        const sorted = Array.from(set).sort((a, b) => a - b);
        const identity = JSON.stringify([row.kcrwdm, row.jxbdm, row.kcbh, row.kcmc, day, p0, p1, room, sorted, row.qssj, row.jssj, row.teaxms]);
        if (seen.has(identity)) return;
        seen.add(identity);
        const slots = [];
        // Existing app uses zero-based weekdays AND zero-based periods.
        const appDay = (day + 5) % 7;
        for (let p = p0; p <= p1; p++) slots.push({day: appDay, period: p - 1});
        result.push({code: 'nepu:' + stable(identity), originalCode: text(row.kcbh),
          name: text(row.kcmc), teacher: text(row.teaxms), room, weeks: sorted, slots,
          startTime: time(row.qssj), endTime: time(row.jssj), note: text(row.bz), source: 'nepu'});
      });
    });
    return result;
  }
  function normalizeNotices(rows, nowMs, months) {
    const now = new Date(nowMs == null ? Date.now() : nowMs);
    const cutoff = new Date(now);
    const day = cutoff.getDate();
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth() - (months || 3));
    const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
    cutoff.setDate(Math.min(day, lastDay));
    cutoff.setHours(0, 0, 0, 0);
    const minTime = cutoff.getTime();
    const seen = new Set(), result = [];
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const id = text(row && row.id);
      const title = text(row && row.title);
      const date = text(row && row.date);
      const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(date);
      if (!match) return;
      const parsed = new Date(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
      const time = parsed.getTime();
      if (parsed.getFullYear() !== +match[1] || parsed.getMonth() !== +match[2] - 1 || parsed.getDate() !== +match[3] ||
          +(match[4] || 0) > 23 || +(match[5] || 0) > 59 || +(match[6] || 0) > 59 ||
          !/^\d{1,32}$/.test(id) || !title || !Number.isFinite(time) || time < minTime || time > now.getTime() || seen.has(id)) return;
      seen.add(id);
      result.push({id, title, date, url: '/new/desktop/ggtzview.page?ggtzdm=' + id});
    });
    result.sort((a, b) => Date.parse(b.date.replace(' ', 'T')) - Date.parse(a.date.replace(' ', 'T')));
    return result;
  }
  function truthyFlag(value) {
    return value === true || value === 1 || /^(1|true|y)$/i.test(text(value));
  }
  function estimateGpa(score) {
    const raw = text(score);
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return '';
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) return '';
    if (value < 60) return '0.0';
    return ((value - 50) / 10).toFixed(1);
  }
  function gradeStats(grades) {
    const byCode = new Map();
    grades.forEach((grade, index) => {
      const key = text(grade.code) || text(grade.attemptId) || 'row:' + index;
      const list = byCode.get(key) || [];
      list.push(grade);
      byCode.set(key, list);
    });
    const selected = [];
    byCode.forEach(list => {
      const marked = list.filter(g => truthyFlag(g.ismax));
      const candidates = marked.length ? marked : list;
      candidates.sort((a, b) => {
        const scoreA = Number(text(a.score)), scoreB = Number(text(b.score));
        const validA = text(a.score) !== '' && Number.isFinite(scoreA);
        const validB = text(b.score) !== '' && Number.isFinite(scoreB);
        if (validA !== validB) return validB - validA;
        if (validA && scoreA !== scoreB) return scoreB - scoreA;
        return Number(truthyFlag(b.isactive)) - Number(truthyFlag(a.isactive));
      });
      selected.push(candidates[0]);
    });
    let weighted = 0, weight = 0, credits = 0, creditCount = 0;
    // 老缓存里的成绩行没有 passed 字段（这个字段是后加的），不能因此把所有课
    // 都算成未通过 —— 缺的时候按分数≥60 现场判一次，口径和 normalize 一致。
    const passedOfRow = (grade) => {
      if (typeof grade.passed === 'boolean') return grade.passed;
      const score = text(grade.score) || text(grade.final);
      const s = Number(score);
      return score !== '' && Number.isFinite(s) ? s >= 60 : false;
    };
    let estimated = false;
    selected.forEach(grade => {
      const credit = Number(text(grade.credit));
      const eligible = !/公选|公共选修/.test(text(grade.nature) + text(grade.category));
      let pointText = text(grade.gpa);
      if (grade.gpaEstimated) estimated = true;
      if (!pointText && eligible) {
        pointText = estimateGpa(text(grade.score) || text(grade.final));
        if (pointText) estimated = true;
      }
      const point = Number(pointText);
      if (eligible && pointText !== '' && Number.isFinite(point) && point >= 0 &&
          text(grade.credit) !== '' && Number.isFinite(credit) && credit > 0) {
        weighted += point * credit;
        weight += credit;
      }
      if (text(grade.credit) !== '' && credit > 0 && Number.isFinite(credit) && passedOfRow(grade)) {
        credits += credit;
        creditCount++;
      }
    });
    return {
      gpa: weight ? (weighted / weight).toFixed(2) : '',
      estimated,
      credits: creditCount ? Number(credits.toFixed(2)).toString() : '',
      count: grades.length,
      courses: selected.length,
    };
  }
  function normalize(raw) {
    if (!raw || !Array.isArray(raw.courses) || !Array.isArray(raw.grades) || !Array.isArray(raw.exams))
      throw new Error('教务响应结构不完整，已保留原有缓存');
    const term = text(raw.term), semester = termName(term);
    if (!/^\d{6}$/.test(term) || !/^\d{4}-\d{2}-\d{2}$/.test(text(raw.week1Monday)))
      throw new Error('学期或第一周日期缺失，已保留原有缓存');
    const courses = courseRows(raw.courses);
    const businessHours = [];
    (Array.isArray(raw.businessHours) ? raw.businessHours : []).forEach(r => {
      const index = Number(r.jcdm) - 1;
      const start = time(r.start || r.qssj), end = time(r.end || r.jssj);
      if (Number.isInteger(index) && index >= 0 && index < 24 && start && end) businessHours[index] = [start, end];
    });
    const grades = raw.grades.map(r => {
      const score = text(r.zcjfs) || text(r.zcj);
      const numericScore = Number(score);
      const passed = Number.isFinite(numericScore) && score !== '' ? numericScore >= 60
        : /不及格|未通过|缺考|旷考|作弊/.test(score) ? false
        : /优秀|良好|中等|及格|合格|通过|优|良|中/.test(score) ? true : null;
      const gpa = text(r.cjjd);
      const gpaEstimated = !gpa && !/公选|公共选修/.test(text(r.ksxzmc) + text(r.cjfsmc))
        ? estimateGpa(text(r.zcjfs) || text(r.zcj)) : '';
      return {name: text(r.kcmc), code: text(r.kcbh), term: gradeTerm(r),
        final: text(r.zcj), score, credit: text(r.xf), gpa: gpa || gpaEstimated,
        gpaEstimated: !!gpaEstimated, nature: text(r.ksxzmc), category: text(r.cjfsmc), note: text(r.cjbzmc), passed,
        attemptId: text(r.cjdm), ismax: r.ismax, isactive: r.isactive};
    });
    const terms = (raw.terms || []).map(t => ({id: text(t.id), name: termName(t.id, t.name)}));
    if (!terms.some(t => t.id === term)) terms.unshift({id: term, name: semester});
    const summary = [];
    Array.from(new Set(grades.map(g => g.term))).forEach(t => {
      const m = /^(\d{4}-\d{4}) ([12])$/.exec(t);
      if (m) summary.push({year: m[1], term: Number(m[2])});
    });
    return {ok: true, source: 'nepu', profile: {}, termId: term, semester, terms,
      week1Monday: raw.week1Monday, businessHours, unitCount: Math.max(12, ...courses.flatMap(c => c.slots.map(s => s.period + 1))),
      totalWeeks: Math.max(Number(raw.totalWeeks) || 22, ...courses.flatMap(c => c.weeks)), courses,
      grades: {courses: grades, summary, overall: gradeStats(grades)},
      exams: {semesterId: term, semesters: terms, exams: raw.exams.map(r => ({
        name: text(r.kcmc), code: text(r.kcbh), date: text(r.ksrq), arrange: text(r.kssj),
        room: text(r.kscdmc), seat: text(r.zwh), category: text(r.ksxsmc || r.kslbmc),
        form: text(r.khxsmc), weekText: [r.zc && '第' + r.zc + '周', r.xq && '周' + r.xq, r.jcdm2].filter(Boolean).join(' '),
        status: text(r.ksaplxmc), note: text(r.bz)}))},
      syncedAt: Math.floor(Date.now() / 1000)};
  }
  const api = {normalize, normalizeNotices, weeks, termName, gradeStats, estimateGpa};
  root.Nepu = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
