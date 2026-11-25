// 매일 아침 체중 → 7일 평균 추세 → 먹는 양 조절 피드백 (식단 80 : 운동 20 원칙)
import { db, today, addDays, weightSeries, GOAL } from './store.js';

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** 최근 7일 / 그 전 7일 평균 체중 */
export function weeklyAverages() {
  const map = Object.fromEntries(weightSeries().map((r) => [r.date, r.kg]));
  const range = (from, n) => Array.from({ length: n }, (_, i) => map[addDays(from, i)]).filter((v) => v != null);
  const t = today();
  const cur = range(addDays(t, -6), 7);
  const prev = range(addDays(t, -13), 7);
  return { cur, prev, curAvg: cur.length ? avg(cur) : null, prevAvg: prev.length ? avg(prev) : null };
}

/** 피드백: [{color, html}] */
export function weightFeedback() {
  const goal = db.settings.goal || 'diet';
  const { cur, prev, curAvg, prevAvg } = weeklyAverages();
  const out = [];
  const add = (color, html) => out.push({ color, html });
  if (cur.length < 3 || prev.length < 3) {
    add('#8a9099', `매일 아침 체중을 재면 7일 평균으로 속도를 알려줘요. (최근 7일 ${cur.length}회 · 그 전 7일 ${prev.length}회 기록, 각각 3회 이상 필요)`);
    return out;
  }
  const perDay = (curAvg - prevAvg) / 7; // kg/일
  const g = Math.round(perDay * 1000);
  const speed = `7일 평균 ${prevAvg.toFixed(1)} → <b>${curAvg.toFixed(1)}kg</b> (하루 ${g > 0 ? '+' : ''}${g}g)`;
  if (goal === 'diet') {
    if (perDay < -0.15) add('#f2a33a', `${speed} — 너무 빨리 빠지고 있어요. 근손실을 막으려면 하루 <b>100~150kcal 더</b> 드세요.`);
    else if (perDay <= -0.05) add('#3bb98a', `${speed} — 하루 약 100g, 딱 좋은 속도예요 👍 지금 식사량을 유지하세요.`);
    else if (perDay < 0.03) add('#f0506e', `${speed} — 정체 중이에요. 하루 <b>100~200kcal 줄여</b> 보세요.`);
    else add('#f0506e', `${speed} — 체중이 늘고 있어요. 하루 <b>200kcal 정도 줄여</b> 보세요.`);
  } else if (goal === 'maintain') {
    if (Math.abs(perDay) <= 0.03) add('#3bb98a', `${speed} — 잘 유지되고 있어요 👍`);
    else if (perDay > 0) add('#f2a33a', `${speed} — 조금씩 늘고 있어요. 체지방이 붙는다면 하루 100kcal 줄여 보세요.`);
    else add('#f2a33a', `${speed} — 조금씩 빠지고 있어요. 유지가 목표면 하루 100kcal 늘려 보세요.`);
  } else {
    const perMonth = perDay * 30;
    if (perMonth > 1) add('#f0506e', `${speed} — 한 달 약 ${perMonth.toFixed(1)}kg 속도로 늘어요. 1kg 넘으면 살크업이에요. 하루 100kcal 줄이세요.`);
    else if (perMonth >= 0.2) add('#3bb98a', `${speed} — 한 달 1kg 미만으로 늘고 있어요. 근육 붙이기 좋은 속도예요 👍`);
    else add('#f2a33a', `${speed} — 거의 늘지 않아요. 힘이 딸리면 하루 100kcal 늘려 보세요.`);
  }
  return out;
}

export const goalLabel = () => (GOAL[db.settings.goal] || GOAL.diet)[0];
