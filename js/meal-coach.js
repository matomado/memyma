// 식단 코치: 하루 평가 · 다음 끼니 추천 · 최근 7일 점검 (Claude)
import { db, today, addDays, MEAL_SLOTS, dayMeals, itemKcal, intakeOf, hasMeals, burnedOf, GOAL, fmtShort } from './store.js';
import { claudeImageJSON, claudeText } from './inbody.js';
import { weightFeedback } from './weight.js';

const GL = { carb: '탄수', protein: '단백', fiber: '섬유' };
const strip = (html) => html.replace(/<[^>]+>/g, '');

function principles() {
  const s = db.settings;
  return `[이 사람의 원칙]
• 목적: ${(GOAL[s.goal] || GOAL.diet)[0]}, 하루 섭취 목표 ${s.kcalTarget}kcal (체중×25/30/35 공식). 운동한 만큼 더 먹지 않는다.
• 살 빼기는 식단 80%. 매일 체중 7일 평균을 보고 100~200kcal씩 조절. 다이어트는 하루 약 100g 감량이 적당.
• 매 끼니 탄수화물+단백질+섬유질. 단백질은 무리해서 챙길 필요 없음. 저염식·고구마 식단 같은 극단적 식단은 권하지 않음.
• 메뉴를 고정하면 양 비교가 쉬움. 칼로리가 명확한 음식이 유리.`;
}

function dayText(d, groupsOf) {
  const m = dayMeals(d);
  return MEAL_SLOTS.map(([k, l]) => {
    const items = m[k] || [];
    if (!items.length) return `${l}: 기록 없음`;
    return `${l}: ` + items.map((it) => `${it.name} ${+(it.amount * it.qty).toFixed(2)}${it.unit}${it.eaten < 1 ? `(${Math.round(it.eaten * 100)}%만 먹음)` : ''} ${itemKcal(it)}kcal[${groupsOf(it).map((g) => GL[g]).join('·') || '분류없음'}]`).join(', ');
  }).join('\n');
}

function weightLine() {
  return weightFeedback().map((p) => strip(p.html)).join(' ');
}

function library() {
  const cnt = {};
  for (const day of Object.values(db.meals)) for (const [k] of MEAL_SLOTS) for (const it of day[k] || []) cnt[it.foodId] = (cnt[it.foodId] || 0) + 1;
  return [...db.foods].sort((a, b) => (b.fav - a.fav) || ((cnt[b.id] || 0) - (cnt[a.id] || 0))).slice(0, 40)
    .map((f) => `- id=${f.id}: ${f.name} (${f.amount}${f.unit} = ${f.kcal}kcal, ${(f.groups || []).map((g) => GL[g]).join('·') || '분류없음'}${cnt[f.id] ? `, ${cnt[f.id]}회 먹음` : ''})`).join('\n');
}

async function askJSON({ sample, apiKey }, prompt, schema, hint) {
  return sample
    ? await sample.json(prompt + '\n\n반드시 JSON 하나만 답하세요. 형식: ' + hint, { modelTier: 'default' })
    : await claudeImageJSON(null, apiKey, prompt, schema);
}

/* ---------- 1. 하루 평가 ---------- */
const EVAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['score', 'summary', 'good', 'fix'],
  properties: { score: { type: 'number' }, summary: { type: 'string' }, good: { type: 'array', items: { type: 'string' } }, fix: { type: 'array', items: { type: 'string' } } },
};
export async function evaluateDay(ai, d, groupsOf) {
  const prompt = `당신은 현실적이고 다정한 다이어트 식단 코치입니다. ${d}${d === today() ? '(오늘, 아직 하루가 끝나지 않았을 수 있음)' : ''}의 식단을 평가하세요.

${principles()}

[이날 식단] 총 ${intakeOf(d)}kcal / 목표 ${db.settings.kcalTarget}kcal, 운동 소모 ${burnedOf(d)}kcal(참고만, 더 먹을 근거 아님)
${dayText(d, groupsOf)}

[체중 추세] ${weightLine() || '기록 부족'}

규칙:
• score: 0~100. 목표 칼로리 대비(가장 중요), 끼니별 탄단섬 균형, 간식·음료 칼로리, 끼니 거르기 여부로 평가. 오늘이고 저녁 전이면 지금까지 기준으로.
• summary: 한 문장.
• good: 잘한 점 1~3개, fix: 고칠 점 1~3개. 각각 짧고 구체적으로(음식 이름과 kcal 숫자를 넣어서). 예: "간식 아이스크림 90kcal를 그릭요거트로 바꾸면 균형도 좋아져요"
• 기록에 없는 걸 지어내지 말 것. 한국어 존댓말.`;
  const out = await askJSON(ai, prompt, EVAL_SCHEMA, '{"score": 숫자, "summary": "...", "good": ["..."], "fix": ["..."]}');
  return {
    score: Math.max(0, Math.min(100, Math.round(+out?.score || 0))),
    summary: String(out?.summary || ''),
    good: (out?.good || []).filter((x) => typeof x === 'string').slice(0, 3),
    fix: (out?.fix || []).filter((x) => typeof x === 'string').slice(0, 3),
  };
}

/* ---------- 2. 다음 끼니 추천 ---------- */
const REC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['note', 'options'],
  properties: {
    note: { type: 'string' },
    options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'why', 'items'], properties: {
      title: { type: 'string' }, why: { type: 'string' },
      items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['foodId', 'name', 'amount', 'unit', 'kcal', 'groups'], properties: {
        foodId: { anyOf: [{ type: 'string' }, { type: 'null' }] }, name: { type: 'string' }, amount: { type: 'number' }, unit: { type: 'string' }, kcal: { type: 'number' },
        groups: { type: 'array', items: { type: 'string', enum: ['carb', 'protein', 'fiber'] } } } } },
    } } },
  },
};
export async function recommendMeal(ai, d, slot, groupsOf) {
  const slotLabel = MEAL_SLOTS.find(([k]) => k === slot)[1];
  const left = db.settings.kcalTarget - intakeOf(d);
  const emptySlots = MEAL_SLOTS.filter(([k]) => k !== 'snack' && !(dayMeals(d)[k] || []).length && k !== slot).map(([, l]) => l);
  const prompt = `당신은 다이어트 식단 코치입니다. ${d}의 ${slotLabel} 메뉴를 2~3가지 조합으로 추천하세요.

${principles()}

[지금까지 먹은 것] ${intakeOf(d)}kcal, 남은 칼로리 ${left}kcal${emptySlots.length ? ` (아직 ${emptySlots.join('·')}도 남아 있으니 나눠서 생각)` : ''}
${dayText(d, groupsOf)}

[자주 먹는 음식 — 가능하면 이 안에서 고르기]
${library() || '(없음)'}

규칙:
• 각 조합은 ${slotLabel}로 적당한 양, 남은 칼로리 안에서. ${slot === 'snack' ? '간식은 100~200kcal 정도.' : '가능하면 탄수·단백·섬유가 다 들어가게. 오늘 앞 끼니에 부족했던 걸 채우기.'}
• 자주 먹는 음식이면 foodId 에 그 id, amount/unit 은 그 음식 기준량의 배수로(예: 기준 100g 이면 150g 처럼), kcal 는 비례 계산. 목록에 없는 음식은 foodId=null, 한국 일반 기준 kcal.
• groups: 각 음식의 분류(carb/protein/fiber).
• 조합 1개는 집에서 쉽게, 1개는 밖에서(편의점·식당) 먹을 수 있는 걸로.
• title 은 짧게(예: "현미밥 + 닭가슴살 샐러드"), why 는 한 문장. note 는 남은 칼로리 관련 한 문장.
• 한국어.`;
  const out = await askJSON(ai, prompt, REC_SCHEMA, '{"note": "...", "options": [{"title": "...", "why": "...", "items": [{"foodId": "id 또는 null", "name": "...", "amount": 숫자, "unit": "...", "kcal": 숫자, "groups": ["carb"]}]}]}');
  const ids = new Set(db.foods.map((f) => f.id));
  const options = (out?.options || []).slice(0, 3).map((o) => ({
    title: String(o.title || '').slice(0, 40), why: String(o.why || ''),
    items: (o.items || []).filter((x) => x && x.name && isFinite(+x.kcal)).map((x) => ({
      foodId: ids.has(x.foodId) ? x.foodId : null, name: String(x.name).slice(0, 40),
      amount: +x.amount > 0 ? +x.amount : 1, unit: String(x.unit || '인분').slice(0, 16), kcal: Math.max(0, Math.round(+x.kcal)),
      groups: Array.isArray(x.groups) ? x.groups.filter((g) => GL[g]) : [],
    })),
  })).filter((o) => o.items.length);
  return { note: String(out?.note || ''), options, left };
}

/* ---------- 3. 최근 7일 점검 (글) ---------- */
export async function weeklyReview(ai, groupsOf, onText) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), -6 + i));
  const lines = days.map((d) => `[${fmtShort(d)}] ${hasMeals(d) ? `총 ${intakeOf(d)}kcal` : '기록 없음'}\n${hasMeals(d) ? dayText(d, groupsOf) : ''}`).join('\n');
  const prompt = `당신은 다정하지만 현실적인 다이어트 식단 코치입니다. 최근 7일 식단을 점검해 주세요.

${principles()}

[체중 추세] ${weightLine() || '기록 부족'}

[최근 7일 식단]
${lines}

답변 규칙:
- 한국어 존댓말, 마크다운 기호(#, *, **) 없이. 항목 앞에는 "•"만.
- 네 부분, 전체 500자 안팎:
  1. 한 줄 총평 (평균 섭취 kcal 와 목표 비교, 체중 추세와 연결)
  2. 잘하고 있는 점
  3. 반복되는 아쉬운 패턴 (예: 저녁 과식, 간식·음료, 섬유질 부족, 끼니 거르기) — 날짜·음식을 근거로
  4. 다음 주 바꿔볼 것 1~2가지 (구체적인 음식 바꾸기나 kcal 조절 숫자로)
- 기록이 부족하면 그렇다고 말하고 지어내지 마세요.`;
  if (ai.sample) return (await ai.sample(prompt, { modelTier: 'default', cache: false, onText: ({ text }) => onText?.(text) })).text;
  return claudeText(ai.apiKey, prompt);
}
