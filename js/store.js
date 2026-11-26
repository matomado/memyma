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
// 끼니 균형 체크용: 탄수화물 / 단백질 / 섬유질
export const GROUPS = [['carb', '탄수'], ['protein', '단백'], ['fiber', '섬유']];
const DEFAULT_GROUPS = {
  '현미밥': ['carb', 'fiber'], '흰쌀밥': ['carb'], '닭가슴살': ['protein'], '삶은 계란': ['protein'], '고구마': ['carb', 'fiber'],
  '그릭요거트': ['protein'], '바나나': ['carb', 'fiber'], '사과': ['carb', 'fiber'], '샐러드(드레싱 X)': ['fiber'], '두부': ['protein'],
  '연어': ['protein'], '오트밀': ['carb', 'fiber'], '우유': ['protein'], '프로틴 쉐이크': ['protein'], '아몬드': ['protein', 'fiber'],
  '아메리카노': [], '김치': ['fiber'],
};
/** 예전에 만든 음식 목록에도 기본 분류를 채워 줌 */
// 기본 음식 영양정보 (기준량당 g: 탄수 carb · 단백 protein · 지방 fat · 식이섬유 fiber)
const DEFAULT_MAC = {
  '현미밥': [66, 6, 1.6, 3.2], '흰쌀밥': [69, 5.7, 0.6, 0.6], '닭가슴살': [0, 23, 1.2, 0], '삶은 계란': [0.6, 6.3, 5.3, 0],
  '고구마': [31, 1.4, 0.2, 2.5], '그릭요거트': [4, 9, 5, 0], '바나나': [24, 1.1, 0.3, 2.6], '사과': [28, 0.5, 0.3, 4.8],
  '샐러드(드레싱 X)': [7, 2, 0.4, 3], '두부': [2, 9, 5, 0.5], '연어': [0, 20, 13, 0], '오트밀': [27, 5, 2.8, 4],
  '우유': [10, 6.4, 7, 0], '프로틴 쉐이크': [3, 24, 1.5, 0.5], '아몬드': [2.5, 2.5, 6, 1.5], '아메리카노': [1.5, 0.5, 0, 0], '김치': [2.5, 1, 0.3, 1.2],
};
const toMac = (a) => ({ carb: a[0], protein: a[1], fat: a[2], fiber: a[3] });
/** 예전에 만든 음식 목록에도 기본 분류·영양정보를 채워 줌 */
export function fillFoodGroups() {
  for (const f of state.foods) {
    if (!Array.isArray(f.groups) && DEFAULT_GROUPS[f.name]) f.groups = DEFAULT_GROUPS[f.name];
    if (!f.mac && DEFAULT_MAC[f.name]) f.mac = toMac(DEFAULT_MAC[f.name]);
  }
}

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
      goal: 'diet',     // diet | maintain | bulk (체중 × 25 / 30 / 35)
      autoKcal: false,  // 체중이 바뀌면 목표 kcal 자동 조정
      equipment: [],    // 우리 헬스장 기구
      pt: { total: null, done0: 0, days: [], time: '', bookings: [] }, // PT 등록 횟수·이미 받은 횟수·고정 요일·기본 시간·날짜별 예약
    },
    foods: DEFAULT_FOODS.map(([name, amount, unit, kcal]) => ({ id: uid(), name, amount, unit, kcal, fav: false, groups: DEFAULT_GROUPS[name] || [], ...(DEFAULT_MAC[name] ? { mac: toMac(DEFAULT_MAC[name]) } : {}) })),
    meals: {},     // { 'YYYY-MM-DD': { breakfast: [...], lunch: [...], dinner: [...], snack: [...] } }
    workouts: [],  // [{ id, date, type, ... }]
    inbody: [],    // [{ id, date, time, weight, smm, bfm, pbf, ... }]
    weights: {},   // 매일 아침 체중 { 'YYYY-MM-DD': kg }
    plan: null,    // 이번 주 추천 루틴
  };
}

let state;
try {
  const raw = localStorage.getItem(KEY);
  state = raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  state.settings = { ...defaults().settings, ...state.settings };
  state.weights ||= {};
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
  const docs = { meta: { settings, foods: state.foods, plan: state.plan || null }, inbody: { records: state.inbody }, weights: { days: state.weights || {} } };
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
      else if (d.id === 'weights') state.weights = body.days || {};
      else if (d.id.startsWith('meals-')) Object.assign(meals, body.days || {});
      else if (d.id.startsWith('workouts-')) workouts.push(...(body.items || []));
    }
    const apiKey = state.settings.apiKey;
    if (meta) {
      state.settings = { ...defaults().settings, ...meta.settings, apiKey };
      state.foods = meta.foods || state.foods;
      state.plan = meta.plan || null;
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
export const MAC_KEYS = [['carb', '탄'], ['protein', '단'], ['fat', '지'], ['fiber', '섬']];
/** 음식 한 줄의 기준량당 영양정보 (없으면 같은 기준량의 자주 먹는 음식 것) */
export function baseMac(it) {
  if (it.mac) return it.mac;
  const f = state.foods.find((x) => x.id === it.foodId);
  if (f?.mac && +f.amount === +it.amount && f.unit === it.unit) return f.mac;
  return null;
}
/** 여러 음식의 탄단지섬 합계 (먹은 양 반영) + 정보 없는 음식 수 */
export function sumMacros(items) {
  const t = { carb: 0, protein: 0, fat: 0, fiber: 0, missing: 0 };
  for (const it of items) {
    const m = baseMac(it);
    if (!m) { t.missing++; continue; }
    const k = it.qty * (it.eaten ?? 1);
    for (const [key] of MAC_KEYS) t[key] += (+m[key] || 0) * k;
  }
  return t;
}
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
/** 그날 체중: 아침 체중 기록 우선, 없으면 그날 인바디 체중 */
export function weightOn(date) {
  const w = state.weights?.[date];
  if (w) return w;
  return inbodyOn(date)?.weight ?? null;
}
/** 날짜순 체중 기록 [{date, kg}] (아침 체중 + 인바디) */
export function weightSeries() {
  const map = {};
  for (const r of inbodySorted()) if (r.weight) map[r.date] = r.weight;
  Object.assign(map, state.weights || {});
  return Object.keys(map).sort().map((date) => ({ date, kg: map[date] }));
}
export function latestWeight() {
  const s = weightSeries();
  return s.length ? s[s.length - 1].kg : null;
}
export const GOAL = { diet: ['다이어트', 25], maintain: ['유지', 30], bulk: ['근육 증가', 35] };
export const goalKcal = (kg, goal = state.settings.goal) => Math.round((kg * (GOAL[goal] || GOAL.diet)[1]) / 10) * 10;
/** 자동 맞춤이 켜져 있으면 최근 체중으로 목표 kcal 갱신 */
export function syncKcalTarget() {
  const kg = latestWeight();
  if (state.settings.autoKcal && kg) state.settings.kcalTarget = goalKcal(kg);
}
