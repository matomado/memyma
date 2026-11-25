// 무분할 루틴 + 점진적 과부하(레벨업) 도우미
import { db, fmtShort } from './store.js';

export const ROUTINE = [
  { name: '풀다운', part: '등', alts: ['케이블 로우', '원암 덤벨로우', '바벨 로우', '어시스트 풀업'] },
  { name: '인클라인 벤치프레스', part: '가슴', alts: ['벤치프레스', '덤벨 벤치프레스', '체스트 프레스', '스미스 인클라인 벤치프레스'] },
  { name: '스쿼트', part: '하체', alts: ['브이스쿼트', '프론트 스쿼트', '레그프레스', '시티드 레그프레스', '스미스 스쿼트', '런지'] },
  { name: '밀리터리프레스', part: '어깨', alts: ['덤벨 숄더프레스', '숄더프레스 머신', '스미스 숄더프레스'] },
  { name: '바벨컬', part: '이두', alts: ['덤벨 컬', '이지바 컬', '케이블 컬'] },
  { name: '스컬크러셔', part: '삼두', alts: ['케이블 푸시다운', '덤벨 트라이셉 익스텐션', '클로즈그립 벤치프레스'] },
];
export const ROUTINE_NAMES = ROUTINE.flatMap((r) => [r.name, ...r.alts]);

const norm = (s) => String(s || '').replace(/\s+/g, '');

/** 세트별 반복수: "10,9,9,8,6" 또는 reps × sets */
export function repsList(s) {
  const raw = String(s.reps ?? '').trim();
  const nums = raw.split(/[^\d]+/).filter(Boolean).map(Number);
  if (nums.length > 1) return nums;
  if (nums.length === 1) return Array(Math.max(1, +s.sets || 1)).fill(nums[0]);
  return [];
}
export const setVolume = (s) => (+s.kg || 0) * repsList(s).reduce((a, b) => a + b, 0);
export const setText = (s) => {
  const l = repsList(s);
  if (!l.length) return '';
  const allSame = l.every((x) => x === l[0]);
  return `${s.kg ? s.kg + 'kg × ' : ''}${allSame && l.length > 1 ? `${l[0]}회 × ${l.length}세트` : l.join(',') + (l.length > 1 ? '' : '회')}`;
};

/** 이 종목의 이전 기록들 (최근순) */
function history(name, date, excludeId) {
  const out = [];
  for (const w of db.workouts) {
    if (!['weight', 'pt'].includes(w.type) || w.id === excludeId || w.date > date) continue;
    for (const s of w.sets || []) if (norm(s.name) === norm(name) && repsList(s).length) out.push({ date: w.date, kg: +s.kg || 0, reps: repsList(s) });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
export const lastKg = (name) => history(name, '9999-12-31', null)[0]?.kg || '';

export function altsOf(name) {
  const r = ROUTINE.find((x) => norm(x.name) === norm(name) || x.alts.some((a) => norm(a) === norm(name)));
  if (!r) return [];
  return [r.name, ...r.alts].filter((x) => norm(x) !== norm(name));
}

/** 종목 옆에 보여줄 안내 {text, level: 'up'|'add'|'info'} */
export function progressHint(name, date, excludeId) {
  if (!norm(name)) return null;
  const h = history(name, date, excludeId);
  if (!h.length) return { level: 'info', text: '첫 기록이에요. 가벼운 무게로 자세부터 익혀요. 6회부터 시작!' };
  const last = h[0];
  const lastStr = `지난번(${fmtShort(last.date)}) ${last.kg ? last.kg + 'kg × ' : ''}${last.reps.join(',')}`;
  const diet = (db.settings.goal || 'diet') === 'diet';
  if (last.reps.length >= 5 && last.reps.every((r) => r >= 10)) {
    return { level: 'up', text: `${lastStr} — 🎉 5세트 10회 달성! ${diet ? '다이어트 중이면 무게는 유지해도 괜찮아요. 근육 지키기가 목표예요.' : '이번엔 무게를 올리고 다시 6회부터 시작해요.'}` };
  }
  let same = 1;
  for (let i = 1; i < h.length; i++) {
    if (h[i].kg === last.kg && h[i].reps.join() === last.reps.join()) same++;
    else break;
  }
  if (same >= 4) return { level: 'add', text: `${lastStr} — 같은 횟수로 ${same}번 했어요. 이번엔 전체에서 2개 더 해봐요!` };
  return { level: 'info', text: `${lastStr}${same > 1 ? ` (${same}번째 유지 중, 4~5번 유지 후 2개 추가)` : ''}` };
}

/** 저장할 때 5×10 달성한 종목 */
export const levelUps = (sets) => sets.filter((s) => { const l = repsList(s); return l.length >= 5 && l.every((r) => r >= 10); }).map((s) => s.name);
