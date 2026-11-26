// 음식 사진 또는 음식 이름 → 음식 목록 + kcal 추정 (Claude)
import { claudeImageJSON, dataUrlToBlob, maxImages, chunks } from './inbody.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['note', 'items'],
  properties: {
    note: { type: 'string', description: '사진 속 식사에 대한 짧은 한국어 메모' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['foodId', 'name', 'amount', 'unit', 'kcal', 'groups', 'carb', 'protein', 'fat', 'fiber'],
        properties: {
          foodId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '등록된 음식과 같으면 그 id, 아니면 null' },
          name: { type: 'string' },
          amount: { type: 'number', description: '사진 속 양 (unit 기준)' },
          unit: { type: 'string' },
          kcal: { type: 'number', description: '사진 속 양 전체의 kcal' },
          groups: { type: 'array', items: { type: 'string', enum: ['carb', 'protein', 'fiber'] }, description: '주요 영양 분류' },
          carb: { anyOf: [{ type: 'number' }, { type: 'null' }] }, protein: { anyOf: [{ type: 'number' }, { type: 'null' }] }, fat: { anyOf: [{ type: 'number' }, { type: 'null' }] }, fiber: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
      },
    },
  },
};

function prompt(foods) {
  const lib = foods.map((f) => `- id=${f.id}: ${f.name} (${f.amount}${f.unit} = ${f.kcal}kcal)`).join('\n');
  return `이 사진은 다이어트 중인 사람의 한 끼 식사입니다(사진이 여러 장이면 같은 식사를 여러 각도로 찍은 것이니, 같은 음식을 두 번 세지 마세요). 사진에 보이는 음식을 하나씩 나누어 양과 칼로리를 추정하세요.

- 그릇·숟가락·손 크기 등을 기준으로 양을 추정하고, 한국 일반 기준(식약처 영양성분 DB 수준)의 칼로리로 계산하세요.
- 아래는 이 사람이 자주 먹는 음식 목록입니다. 사진 속 음식이 이 중 하나와 같으면 foodId 에 그 id 를 넣고, unit 은 목록과 같은 단위로, kcal 는 목록의 kcal 를 양에 비례해 계산하세요. 목록에 없으면 foodId 는 null.
${lib || '(등록된 음식 없음)'}
- 소스·드레싱·기름처럼 칼로리에 영향이 큰 것이 보이면 따로 항목으로 넣으세요.
- groups: 그 음식이 끼니에서 맡는 주요 역할. carb(탄수화물: 밥·빵·면·감자·과일), protein(단백질: 고기·생선·계란·두부·콩·유제품), fiber(섬유질: 채소·나물·김치·해조류·과일). 여러 개 가능.
- carb·protein·fat·fiber: 그 양 전체의 탄수화물·단백질·지방·식이섬유 g(한국 일반 기준 추정, 소수점 한 자리).
- 음식 사진이 아니면 items 를 빈 배열로 두고 note 에 이유를 쓰세요.`;
}

function textPrompt(text, foods) {
  const lib = foods.map((f) => `- id=${f.id}: ${f.name} (${f.amount}${f.unit} = ${f.kcal}kcal)`).join('\n');
  return `다이어트 중인 사람이 먹은 음식을 글로 적었습니다. 음식마다 하나씩 나누어 양과 칼로리를 알려주세요.

입력: "${text.replace(/"/g, "'")}"

- 여러 음식이 쉼표·띄어쓰기·줄바꿈으로 섞여 있으면 각각 따로 항목으로 만드세요.
- 양이 적혀 있으면(예: 2개, 반 공기, 200g) 그 양으로, 없으면 한국에서 보통 먹는 1인분(반찬은 1회 제공량, 대략 작은 접시 하나)으로 정하세요.
- 칼로리는 식약처 식품영양성분 DB 같은 한국 일반 기준에 맞춰 현실적으로 계산하세요. 볶음·전·튀김은 기름을 포함해서요.
- 아래 자주 먹는 음식 목록과 같은 음식이면 foodId 에 그 id 를 넣고, unit 은 목록과 같은 단위로, kcal 는 목록의 kcal 를 양에 비례해 계산하세요. 아니면 foodId 는 null.
${lib || '(등록된 음식 없음)'}
- groups: carb(탄수화물: 밥·빵·면·감자·과일), protein(단백질: 고기·생선·계란·두부·콩·유제품), fiber(섬유질: 채소·나물·김치·해조류·과일) 중 해당하는 것들.
- carb·protein·fat·fiber: 그 양 전체의 탄수화물·단백질·지방·식이섬유 g(소수점 한 자리).
- note 에는 기준(예: "반찬 1회 제공량 기준")을 짧게 적으세요. 음식이 아니면 items 를 빈 배열로 두세요.`;
}

const JSON_FORMAT = `

반드시 JSON 하나만 답하세요. 형식:
{"note": "짧은 메모", "items": [{"foodId": "id 또는 null", "name": "음식 이름", "amount": 숫자, "unit": "단위", "kcal": 숫자, "groups": ["carb"|"protein"|"fiber"], "carb": 숫자, "protein": 숫자, "fat": 숫자, "fiber": 숫자}]}`;

export async function analyzeFoodPhoto({ sample, apiKey, jpegs, foods }) {
  const items = [], notes = [];
  for (const part of chunks(jpegs, await maxImages(sample))) {
    const out = sample
      ? await sample.json(prompt(foods) + JSON_FORMAT, { images: part.map(dataUrlToBlob), modelTier: 'default' })
      : await claudeImageJSON(part, apiKey, prompt(foods), SCHEMA);
    const r = tidy(out, foods);
    items.push(...r.items);
    if (r.note) notes.push(r.note);
  }
  return { items, note: notes.join(' ') };
}

export async function analyzeFoodText({ sample, apiKey, text, foods }) {
  const out = sample
    ? await sample.json(textPrompt(text, foods) + JSON_FORMAT, { modelTier: 'default' })
    : await claudeImageJSON(null, apiKey, textPrompt(text, foods), SCHEMA);
  return tidy(out, foods);
}

/** {carb, protein, fat, fiber} 가 다 숫자면 mac 으로 */
export function macOf(o) {
  const v = ['carb', 'protein', 'fat', 'fiber'].map((k) => o?.[k] ?? (k === 'carb' ? o?.carbs : undefined));
  if (v.some((x) => x == null || x === '' || !isFinite(+x))) return {};
  return { mac: { carb: +(+v[0]).toFixed(1), protein: +(+v[1]).toFixed(1), fat: +(+v[2]).toFixed(1), fiber: +(+v[3]).toFixed(1) } };
}

function tidy(out, foods) {
  const ids = new Set(foods.map((f) => f.id));
  const items = (Array.isArray(out?.items) ? out.items : [])
    .filter((it) => it && typeof it.name === 'string' && isFinite(+it.kcal))
    .map((it) => ({
      foodId: ids.has(it.foodId) ? it.foodId : null,
      name: it.name.trim().slice(0, 40),
      amount: +it.amount > 0 ? +it.amount : 1,
      unit: typeof it.unit === 'string' && it.unit.trim() ? it.unit.trim().slice(0, 12) : '인분',
      kcal: Math.max(0, Math.round(+it.kcal)),
      groups: Array.isArray(it.groups) ? it.groups.filter((g) => ['carb', 'protein', 'fiber'].includes(g)) : [],
      ...macOf(it),
    }));
  return { items, note: typeof out?.note === 'string' ? out.note : '' };
}

/* ---------- 영양성분표 사진 → 음식 1개 ---------- */
const LABEL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['found', 'name', 'amount', 'unit', 'kcal', 'carbs', 'protein', 'fat', 'fiber', 'groups', 'note'],
  properties: {
    found: { type: 'boolean' },
    name: { type: 'string' },
    amount: { type: 'number' }, unit: { type: 'string' }, kcal: { type: 'number' },
    carbs: { anyOf: [{ type: 'number' }, { type: 'null' }] }, protein: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    fat: { anyOf: [{ type: 'number' }, { type: 'null' }] }, fiber: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    groups: { type: 'array', items: { type: 'string', enum: ['carb', 'protein', 'fiber'] } },
    note: { type: 'string' },
  },
};
const LABEL_PROMPT = `이 사진은 식품 포장의 영양성분표(또는 제품 포장)입니다(여러 장이면 같은 제품의 앞·뒷면). 식단 기록용으로 이 제품 하나를 정리하세요.
- name: 제품 이름(보이면 그대로, 안 보이면 짧은 일반 이름).
- 기준량 정하기: 한 번에 다 먹는 제품(편의점 도시락, 삼각김밥, 프로틴바, 요거트 1컵, 음료 1병, 과자 1봉 등)이면 amount=1, unit="개(총 내용량 120g)"처럼 포장 1개 기준, kcal=총 내용량 열량.
  여러 번 나눠 먹는 제품(우유 1L, 시리얼, 견과 큰 봉지 등)이면 표에 적힌 1회 제공량 기준(예: amount=30, unit="g"), kcal=1회 제공량 열량.
- 표에 "총 내용량 OOg, 100g당 OOkcal"만 있으면 총 내용량 열량을 계산해서 포장 1개 기준으로.
- carbs·protein·fat·fiber: kcal 와 같은 기준량의 탄수화물·단백질·지방·식이섬유 g(표에 없으면 null).
- 숫자는 소수점 위치를 특히 조심해서 읽으세요(15g 을 1.5g 으로, 1.5g 을 15g 으로 읽지 않게). 다 읽은 뒤 탄수화물×4 + 단백질×4 + 지방×9 가 kcal 와 대략 맞는지 확인하고, 크게 다르면 다시 읽으세요.
- groups: 영양성분을 보고 주요 역할. 탄수화물이 많으면 carb, 단백질이 열량의 20% 이상이면 protein, 식이섬유 3g 이상이거나 채소·과일 제품이면 fiber. 여러 개 가능.
- note: 기준을 한 줄로(예: "총 내용량 120g 1개 기준, 단백질 20g").
- 영양성분표나 열량을 찾을 수 없으면 found=false.
- 숫자는 표에 적힌 값만 쓰고 추측하지 마세요.`;

export async function analyzeLabel({ sample, apiKey, jpegs }) {
  const out = sample
    ? await sample.json(LABEL_PROMPT + '\n\n반드시 JSON 하나만 답하세요. 형식: {"found": true, "name": "...", "amount": 숫자, "unit": "...", "kcal": 숫자, "carbs": 숫자 또는 null, "protein": 숫자 또는 null, "fat": 숫자 또는 null, "fiber": 숫자 또는 null, "groups": ["protein"], "note": "..."}', { images: jpegs.slice(0, 3).map(dataUrlToBlob), modelTier: 'default' })
    : await claudeImageJSON(jpegs.slice(0, 3), apiKey, LABEL_PROMPT, LABEL_SCHEMA);
  if (!out || out.found === false || !isFinite(+out.kcal)) return null;
  const g = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);
  const kcal = Math.max(0, Math.round(+out.kcal));
  const m = { carbs: g(out.carbs), protein: g(out.protein), fat: g(out.fat), fiber: g(out.fiber) };
  // 영양 분류는 숫자로 정함
  let groups = Array.isArray(out.groups) ? out.groups.filter((x) => ['carb', 'protein', 'fiber'].includes(x)) : [];
  if (m.carbs != null || m.protein != null || m.fiber != null) {
    groups = [];
    if (m.carbs != null && (m.carbs >= 10 || (kcal && (m.carbs * 4) / kcal >= 0.3))) groups.push('carb');
    if (m.protein != null && kcal && (m.protein * 4) / kcal >= 0.2) groups.push('protein');
    if (m.fiber != null && m.fiber >= 3) groups.push('fiber');
  }
  // 검산: 탄수×4 + 단백×4 + 지방×9 ≈ kcal
  let warn = '';
  if (m.carbs != null && m.protein != null && m.fat != null && kcal > 30) {
    const calc = m.carbs * 4 + m.protein * 4 + m.fat * 9;
    if (Math.abs(calc - kcal) / kcal > 0.25) warn = `영양성분으로 계산하면 약 ${Math.round(calc)}kcal인데 표에는 ${kcal}kcal로 읽혔어요. 숫자가 잘못 읽혔을 수 있으니 성분표와 비교해 주세요.`;
  }
  const macro = [m.carbs != null ? `탄수 ${m.carbs}g` : '', m.protein != null ? `단백 ${m.protein}g` : '', m.fat != null ? `지방 ${m.fat}g` : '', m.fiber != null ? `식이섬유 ${m.fiber}g` : ''].filter(Boolean).join(' · ');
  return {
    macro, warn,
    name: String(out.name || '').trim().slice(0, 40),
    amount: +out.amount > 0 ? +out.amount : 1,
    unit: String(out.unit || '개').trim().slice(0, 24) || '개',
    kcal, groups,
    ...(m.carbs != null && m.protein != null && m.fat != null ? { mac: { carb: m.carbs, protein: m.protein, fat: m.fat, fiber: m.fiber ?? 0 } } : {}),
    note: typeof out.note === 'string' ? out.note : '',
  };
}


/* ---------- 영양정보 없는 음식들 한꺼번에 채우기 ---------- */
const FILL_SCHEMA = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'carb', 'protein', 'fat', 'fiber'], properties: { i: { type: 'number' }, carb: { type: 'number' }, protein: { type: 'number' }, fat: { type: 'number' }, fiber: { type: 'number' } } } } } };
/** list: [{name, amount, unit, kcal}] → 같은 순서의 mac 배열 (모르면 null) */
export async function fillMacros({ sample, apiKey, list }) {
  const prompt = `아래 음식들의 탄수화물·단백질·지방·식이섬유(g)를 적힌 양 기준으로 추정하세요. 한국 일반 기준(식약처 영양성분 DB 수준)으로, 적힌 kcal 와 대략 맞게(탄수×4+단백×4+지방×9 ≈ kcal). 소수점 한 자리.
${list.map((x, i) => `${i}. ${x.name} ${x.amount}${x.unit} (${x.kcal}kcal)`).join('\n')}`;
  const out = sample
    ? await sample.json(prompt + '\n\n반드시 JSON 하나만 답하세요. 형식: {"items": [{"i": 번호, "carb": 숫자, "protein": 숫자, "fat": 숫자, "fiber": 숫자}]}', { modelTier: 'default' })
    : await claudeImageJSON(null, apiKey, prompt, FILL_SCHEMA);
  const res = list.map(() => null);
  for (const r of out?.items || []) if (Number.isInteger(+r.i) && res[+r.i] === null) res[+r.i] = macOf(r).mac || null;
  return res;
}
