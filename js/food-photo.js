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
        required: ['foodId', 'name', 'amount', 'unit', 'kcal'],
        properties: {
          foodId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: '등록된 음식과 같으면 그 id, 아니면 null' },
          name: { type: 'string' },
          amount: { type: 'number', description: '사진 속 양 (unit 기준)' },
          unit: { type: 'string' },
          kcal: { type: 'number', description: '사진 속 양 전체의 kcal' },
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
- note 에는 기준(예: "반찬 1회 제공량 기준")을 짧게 적으세요. 음식이 아니면 items 를 빈 배열로 두세요.`;
}

const JSON_FORMAT = `

반드시 JSON 하나만 답하세요. 형식:
{"note": "짧은 메모", "items": [{"foodId": "id 또는 null", "name": "음식 이름", "amount": 숫자, "unit": "단위", "kcal": 숫자}]}`;

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
    }));
  return { items, note: typeof out?.note === 'string' ? out.note : '' };
}
