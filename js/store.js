// 데이터 저장소 (브라우저 localStorage)
const KEY = 'memyma.v1';
const BG_KEY = 'memyma.bg';

const DEFAULT_FOODS = [
  ['현미밥', 1, '공기(210g)', 310],
  ['흰쌀밥', 1, '공기(210g)', 315],
  ['닭가슴살', 100, 'g', 109],
  ['삶은 계란', 1, '개', 77],
  ['고구마', 100, 'g', 128],
  ['그릭요거트', 100, 'g', 97],
  ['바나나', 1, '개', 93],
  ['사과', 1, '개(200g)', 104],
  ['샐러드(드레싱 X)', 1, '접시', 40],
  ['두부', 100, 'g', 84],
  ['연어', 100, 'g', 208],
  ['오트밀', 40, 'g', 152],
  ['우유', 200, 'ml', 130],
  ['프로틴 쉐이크', 1, '스쿱', 120],
  ['아몬드', 10, '알', 70],
  ['아메리카노', 1, '잔', 10],
  ['김치', 50, 'g', 15],
];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function defaults() {
  return {
    version: 1,
    settings: {
      kcalTarget: 1500,
      sex: 'female',
      height: null,
      goalWeight: null,
      apiKey: '',
      bgMode: 'none', // none | header | full
      cardAlpha: 0.9,
    },
    foods: DEFAULT_FOODS.map(([name, amount, unit, kcal]) => ({ id: uid(), name, amount, unit, kcal, fav: false })),
    meals: {},     // { 'YYYY-MM-DD': { breakfast: [...], lunch: [...], dinner: [...], snack: [...] } }
    workouts: [],  // [{ id, date, type, ... }]
    inbody: [],    // [{ id, date, time, weight, smm, bfm, pbf, ... }]
  };
}

let state;
try {
  const raw = localStorage.getItem(KEY);
  state = raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  state.settings = { ...defaults().settings, ...state.settings };
} catch {
  state = defaults();
}

export const db = state;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alert('저장 공간이 부족합니다. 설정에서 백업 후 정리해 주세요.');
  }
}

export function replaceAll(data) {
  const d = defaults();
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, d, data);
  state.settings = { ...d.settings, ...(data.settings || {}) };
  save();
}

export function getBg() {
  try { return localStorage.getItem(BG_KEY) || ''; } catch { return ''; }
}
export function setBg(dataUrl) {
  try {
    if (dataUrl) localStorage.setItem(BG_KEY, dataUrl);
    else localStorage.removeItem(BG_KEY);
    return true;
  } catch {
    return false;
  }
}

/* ---------- date helpers ---------- */
export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => iso(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const fmtDate = (s) => { const d = parseISO(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; };
export const fmtShort = (s) => { const d = parseISO(s); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
export const weekStart = (s) => { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }; // 월요일 시작

/* ---------- derived ---------- */
export const MEAL_SLOTS = [
  ['breakfast', '아침'],
  ['lunch', '점심'],
  ['dinner', '저녁'],
  ['snack', '간식'],
];

export function dayMeals(date) {
  return state.meals[date] || { breakfast: [], lunch: [], dinner: [], snack: [] };
}
export function ensureDayMeals(date) {
  if (!state.meals[date]) state.meals[date] = { breakfast: [], lunch: [], dinner: [], snack: [] };
  return state.meals[date];
}
export const itemKcal = (it) => Math.round(it.kcal * it.qty);
export function intakeOf(date) {
  const m = state.meals[date];
  if (!m) return 0;
  return MEAL_SLOTS.reduce((s, [k]) => s + (m[k] || []).reduce((a, it) => a + itemKcal(it), 0), 0);
}
export function hasMeals(date) {
  const m = state.meals[date];
  return !!m && MEAL_SLOTS.some(([k]) => (m[k] || []).length);
}
export const workoutsOf = (date) => state.workouts.filter((w) => w.date === date);
export const burnedOf = (date) => workoutsOf(date).reduce((s, w) => s + (Number(w.kcal) || 0), 0);
export const inbodySorted = () => [...state.inbody].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
export const inbodyOn = (date) => inbodySorted().filter((r) => r.date === date).pop();
export function latestWeight() {
  const list = inbodySorted().filter((r) => r.weight);
  return list.length ? list[list.length - 1].weight : null;
}
