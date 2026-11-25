// 운동 분석: 주별 통계 + 자동 코멘트 + Claude 코치용 요약
import { db, today, addDays, weekStart, fmtShort, workoutsOf, intakeOf, hasMeals, burnedOf, inbodySorted } from './store.js';

const sum = (arr, f) => arr.reduce((a, x) => a + (+f(x) || 0), 0);

export function weeklyStats(nWeeks) {
  const thisWeek = weekStart(today());
  return Array.from({ length: nWeeks }, (_, i) => {
    const start = addDays(thisWeek, -7 * (nWeeks - 1 - i));
    const days = Array.from({ length: 7 }, (_, d) => addDays(start, d));
    const ws = days.flatMap(workoutsOf);
    const by = (t) => ws.filter((w) => w.type === t);
    return {
      start, label: fmtShort(start), ws,
      minutes: sum(ws, (w) => w.duration),
      kcal: sum(ws, (w) => w.kcal),
      days: new Set(ws.map((w) => w.date)).size,
      swim: by('swim').length, weight: by('weight').length, cardio: by('cardio').length, etc: by('etc').length,
      swimM: sum(by('swim'), (w) => w.distance),
      cardioKm: sum(by('cardio'), (w) => w.distance),
    };
  });
}

/** 수영 페이스 (100m 당 분) 기록 */
export function swimPaces(fromDate) {
  return db.workouts
    .filter((w) => w.type === 'swim' && w.date >= fromDate && +w.distance > 0 && +w.duration > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({ date: w.date, pace: (+w.duration / +w.distance) * 100 }));
}

export function streak() {
  let d = today();
  if (!workoutsOf(d).length) d = addDays(d, -1);
  let n = 0;
  while (workoutsOf(d).length) { n++; d = addDays(d, -1); }
  return n;
}

export function comments(weeks) {
  const pts = [];
  const add = (color, html) => pts.push({ color, html });
  const done = weeks.slice(0, -1).length ? weeks.slice(0, -1) : weeks; // 지난 주들 (이번 주는 진행 중)
  const avgMin = sum(done, (w) => w.minutes) / done.length;
  const avgDays = sum(done, (w) => w.days) / done.length;
  const avgWeight = sum(done, (w) => w.weight) / done.length;
  const all = weeks.flatMap((w) => w.ws);

  if (!all.length) { add('#8a9099', '아직 이 기간에 운동 기록이 없어요. 기록이 쌓이면 분석이 보여요.'); return pts; }

  if (avgMin >= 150) add('#3bb98a', `주 평균 <b>${Math.round(avgMin)}분</b> 운동 — 권장량(주 150분 이상)을 채우고 있어요 👍`);
  else add('#f2a33a', `주 평균 <b>${Math.round(avgMin)}분</b> 운동 — 권장량(주 150분)까지 주 <b>${Math.round(150 - avgMin)}분</b> 더 필요해요.`);
  add('#2f3640', `주 평균 <b>${avgDays.toFixed(1)}일</b> 운동했어요.`);

  const smm = inbodySorted().filter((r) => r.smm != null);
  const smmDrop = smm.length >= 2 && smm[smm.length - 1].smm < smm[smm.length - 2].smm - 0.2;
  if (avgWeight < 2) add(smmDrop ? '#f0506e' : '#f2a33a', `근력 운동이 주 평균 <b>${avgWeight.toFixed(1)}회</b>예요. 다이어트 중 근손실을 막으려면 주 2회 이상이 좋아요.${smmDrop ? ' 최근 인바디에서 골격근도 줄었어요.' : ''}`);
  else add('#3bb98a', `근력 운동 주 평균 <b>${avgWeight.toFixed(1)}회</b> — 근육 지키기에 충분해요.`);

  const st = streak();
  if (st >= 2) add('#4a7bf7', `<b>${st}일 연속</b> 운동 중이에요!`);
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today(), -i));
  if (!last7.some((d) => workoutsOf(d).length)) add('#f0506e', '최근 7일 동안 운동 기록이 없어요. 가볍게 걷기부터 다시 시작해 봐요.');

  const paces = swimPaces(weeks[0].start);
  if (paces.length >= 2) {
    const a = paces[0].pace, b = paces[paces.length - 1].pace;
    const fmt = (p) => `${Math.floor(p)}분 ${String(Math.round((p % 1) * 60)).padStart(2, '0')}초`;
    const diff = a - b;
    add(diff > 0 ? '#3bb98a' : '#2f3640', `수영 100m 페이스 ${fmt(a)} → <b>${fmt(b)}</b>${diff > 0.05 ? ' — 빨라졌어요!' : ''}`);
  }

  const logged = last7.filter(hasMeals);
  if (logged.length >= 3) {
    const inAvg = sum(logged, intakeOf) / logged.length;
    const burnAvg = sum(last7, burnedOf) / 7;
    add('#2f3640', `최근 7일 하루 평균 섭취 <b>${Math.round(inAvg)}kcal</b>, 운동 소모 <b>${Math.round(burnAvg)}kcal</b> → 순 섭취 <b>${Math.round(inAvg - burnAvg)}kcal</b> (목표 ${db.settings.kcalTarget}kcal)`);
  }
  return pts;
}

/** Claude 코치에게 보낼 최근 4주 요약 */
export function coachPrompt() {
  const s = db.settings;
  const days = Array.from({ length: 28 }, (_, i) => addDays(today(), -27 + i));
  const lines = days.map((d) => {
    const ws = workoutsOf(d).map((w) => {
      const p = [{ swim: '수영', weight: '웨이트', cardio: '유산소', etc: '기타' }[w.type]];
      if (w.type === 'cardio' && w.kind) p.push(w.kind);
      if (w.type === 'etc' && w.title) p.push(w.title);
      if (w.duration) p.push(`${w.duration}분`);
      if (w.distance) p.push(w.type === 'swim' ? `${w.distance}m` : `${w.distance}km`);
      if (w.type === 'weight' && w.sets?.length) p.push(w.sets.map((x) => `${x.name} ${x.kg || '-'}kg×${x.reps || '-'}×${x.sets || '-'}`).join('/'));
      if (w.kcal) p.push(`${w.kcal}kcal`);
      if (w.avgHr) p.push(`심박 ${w.avgHr}`);
      return p.join(' ');
    });
    return `${d}: 섭취 ${hasMeals(d) ? intakeOf(d) + 'kcal' : '기록없음'} | 운동 ${ws.length ? ws.join(', ') : '없음'}`;
  });
  const ib = inbodySorted().slice(-6).map((r) => `${r.date}: 체중 ${r.weight ?? '-'}kg, 골격근 ${r.smm ?? '-'}kg, 체지방률 ${r.pbf ?? '-'}%`);
  return `당신은 다정하지만 현실적인 다이어트·운동 코치입니다. 아래 기록을 보고 이 사람에게 조언해 주세요.

[정보] 성별 ${s.sex === 'male' ? '남성' : '여성'}, 키 ${s.height || '모름'}cm, 목표 체중 ${s.goalWeight || '모름'}kg, 하루 섭취 목표 ${s.kcalTarget}kcal. 주로 하는 운동: 수영, 웨이트, 유산소.

[최근 4주 기록]
${lines.join('\n')}

[인바디]
${ib.length ? ib.join('\n') : '기록 없음'}

답변 규칙:
- 한국어 존댓말, 마크다운 기호(#, *, **) 없이 일반 글로. 항목 앞에는 "•"만 사용.
- 아래 네 부분으로, 전체 600자 안팎:
  1. 잘하고 있는 점
  2. 아쉬운 점 (기록에 근거해서 구체적으로)
  3. 다음 주 운동 계획 (요일별로 짧게, 수영·웨이트·유산소를 섞어서)
  4. 식단 한 가지 팁
- 기록이 부족하면 부족하다고 말하고, 없는 사실을 지어내지 마세요.`;
}
