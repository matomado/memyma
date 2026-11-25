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
      bgUrl: '',
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

/* ---------- 저장: 이 기기(localStorage) + claude.ai 계정(db, 있을 때) ---------- */
let remote = null;      // { db, base } — claude.ai 아티팩트로 열었을 때만
let lastSent = {};      // docId -> 마지막으로 보낸 JSON
let flushTimer = null, flushing = null;
export let onSaveError = () => {};
export const setSaveErrorHandler = (fn) => (onSaveError = fn);
export const isCloud = () => !!remote;

function localSave() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 저장 불가한 환경 */ }
}

export function save() {
  localSave();
  if (remote) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 700);
  }
}

// state -> 문서 묶음 (문서 하나당 256KB 제한이 있어서 월별로 나눔)
function toDocs() {
  const { apiKey, ...settings } = state.settings; // API 키는 기기에만
  const docs = { meta: { settings, foods: state.foods } , inbody: { records: state.inbody } };
  for (const [date, day] of Object.entries(state.meals)) {
    const id = 'meals-' + date.slice(0, 7);
    (docs[id] ||= { days: {} }).days[date] = day;
  }
  for (const w of state.workouts) {
    const id = 'workouts-' + w.date.slice(0, 7);
    (docs[id] ||= { items: [] }).items.push(w);
  }
  return docs;
}

async function flush() {
  if (flushing) { await flushing; }
  flushing = (async () => {
    const docs = toDocs();
    // 비워진 월 문서도 비운 채로 덮어쓰기
    for (const id of Object.keys(lastSent)) if (!docs[id]) docs[id] = id.startsWith('meals-') ? { days: {} } : id.startsWith('workouts-') ? { items: [] } : {};
    for (const [id, body] of Object.entries(docs)) {
      const json = JSON.stringify(body);
      if (lastSent[id] === json) continue;
      try {
        await remote.db.doc(`${remote.base}/${id}`).set(body);
        lastSent[id] = json;
      } catch (e) {
        onSaveError(e);
        break;
      }
    }
  })();
  await flushing;
  flushing = null;
}

/** claude.ai 에서 열렸으면 계정 저장소에 연결하고 기록을 불러옴. 연결되면 true */
export async function initCloud() {
  if (!window.claude?.use) return false;
  try {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return false;
    const uid = await user.id();
    if (!uid) return false;
    const base = `data/users/${uid}`;
    const snap = await db.collection(base).get();
    remote = { db, base };
    if (snap.empty) {
      // 처음: 이 기기에 있던 기록을 올림
      await flush();
      return true;
    }
    const meals = {}, workouts = [];
    let meta = null, inbody = [];
    for (const d of snap.docs) {
      // claude.ai 가 주는 데이터는 수정 불가(frozen) 상태라 복사해서 사용
      const json = JSON.stringify(d.data() || {});
      const body = JSON.parse(json);
      lastSent[d.id] = json;
      if (d.id === 'meta') meta = body;
      else if (d.id === 'inbody') inbody = body.records || [];
      else if (d.id.startsWith('meals-')) Object.assign(meals, body.days || {});
      else if (d.id.startsWith('workouts-')) workouts.push(...(body.items || []));
    }
    const apiKey = state.settings.apiKey;
    if (meta) {
      state.settings = { ...defaults().settings, ...meta.settings, apiKey };
      state.foods = meta.foods || state.foods;
    }
    state.meals = meals;
    state.workouts = workouts;
    state.inbody = inbody;
    localSave();
    return true;
  } catch (e) {
    console.warn('cloud store unavailable', e);
    remote = null;
    return false;
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
  if (state.settings.bgUrl) return state.settings.bgUrl;
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
export const itemKcal = (it) => Math.round(it.kcal * it.qty * (it.eaten ?? 1)); // eaten: 먹은 비율(남긴 경우)
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
