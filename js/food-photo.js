// 음식 사진 → 음식 목록 + kcal 추정 (Claude)
import { claudeImageJSON, dataUrlToBlob } from './inbody.js';

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
  return `이 사진은 다이어트 중인 사람의 한 끼 식사입니다. 사진에 보이는 음식을 하나씩 나누어 양과 칼로리를 추정하세요.

- 그릇·숟가락·손 크기 등을 기준으로 양을 추정하고, 한국 일반 기준(식약처 영양성분 DB 수준)의 칼로리로 계산하세요.
- 아래는 이 사람이 자주 먹는 음식 목록입니다. 사진 속 음식이 이 중 하나와 같으면 foodId 에 그 id 를 넣고, unit 은 목록과 같은 단위로, kcal 는 목록의 kcal 를 양에 비례해 계산하세요. 목록에 없으면 foodId 는 null.
${lib || '(등록된 음식 없음)'}
- 소스·드레싱·기름처럼 칼로리에 영향이 큰 것이 보이면 따로 항목으로 넣으세요.
- 음식 사진이 아니면 items 를 빈 배열로 두고 note 에 이유를 쓰세요.`;
}

export async function analyzeFoodPhoto({ sample, apiKey, jpeg, foods }) {
  let out;
  if (sample) {
    out = await sample.json(prompt(foods) + `

반드시 JSON 하나만 답하세요. 형식:
{"note": "짧은 메모", "items": [{"foodId": "id 또는 null", "name": "음식 이름", "amount": 숫자, "unit": "단위", "kcal": 숫자}]}`, { images: [dataUrlToBlob(jpeg)], modelTier: 'default' });
  } else {
    out = await claudeImageJSON(jpeg, apiKey, prompt(foods), SCHEMA);
  }
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
