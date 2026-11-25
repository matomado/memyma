// 우리 헬스장 기구 → 할 수 있는 종목 고르기
import { ROUTINE } from './routine.js';
import { claudeImageJSON, dataUrlToBlob, maxImages, chunks } from './inbody.js';

export const EQUIPMENT = [
  ['웨이트', ['바벨', '덤벨', '이지바', '플랫 벤치', '인클라인 벤치', '파워랙(스쿼트 랙)', '스미스 머신', '풀업 바']],
  ['머신', ['랫풀다운 머신', '시티드 로우 머신', '케이블 머신', '체스트프레스 머신', '숄더프레스 머신', '레그프레스', '브이스쿼트 머신', '핵스쿼트 머신', '레그 익스텐션', '레그 컬', '힙 쓰러스트 머신', '펙덱 머신', '어시스트 친업·딥스 머신', '백 익스텐션(로만체어)', '힙 어브덕션·어덕션', '시티드 레그프레스']],
  ['유산소', ['러닝머신', '천국의계단', '실내자전거', '일립티컬', '로잉머신']],
];
export const ALL_EQUIP = EQUIPMENT.flatMap(([, l]) => l);

/** 보내주신 헬스장 사진에서 확인한 기구 */
export const MY_GYM = ['바벨', '덤벨', '이지바', '플랫 벤치', '인클라인 벤치', '파워랙(스쿼트 랙)', '스미스 머신', '풀업 바',
  '랫풀다운 머신', '시티드 로우 머신', '케이블 머신', '체스트프레스 머신', '펙덱 머신', '레그프레스', '시티드 레그프레스', '레그 익스텐션',
  '어시스트 친업·딥스 머신', '백 익스텐션(로만체어)', '힙 어브덕션·어덕션', '러닝머신', '천국의계단', '실내자전거'];

// 종목 → 필요한 기구 (여러 방법 중 하나만 갖추면 됨)
const NEEDS = {
  '풀다운': [['랫풀다운 머신'], ['케이블 머신']],
  '케이블 로우': [['시티드 로우 머신'], ['케이블 머신']],
  '원암 덤벨로우': [['덤벨', '플랫 벤치'], ['덤벨']],
  '바벨 로우': [['바벨']],
  '풀업': [['풀업 바'], ['파워랙(스쿼트 랙)'], ['어시스트 친업·딥스 머신']],
  '인클라인 벤치프레스': [['인클라인 벤치', '바벨'], ['인클라인 벤치', '덤벨'], ['스미스 머신', '인클라인 벤치']],
  '벤치프레스': [['플랫 벤치', '바벨'], ['스미스 머신', '플랫 벤치']],
  '덤벨 벤치프레스': [['플랫 벤치', '덤벨'], ['인클라인 벤치', '덤벨']],
  '체스트 프레스': [['체스트프레스 머신']],
  '스쿼트': [['파워랙(스쿼트 랙)', '바벨'], ['스미스 머신']],
  '브이스쿼트': [['브이스쿼트 머신'], ['핵스쿼트 머신']],
  '프론트 스쿼트': [['파워랙(스쿼트 랙)', '바벨']],
  '레그프레스': [['레그프레스'], ['시티드 레그프레스']],
  '런지': [['덤벨'], []],
  '밀리터리프레스': [['바벨'], ['스미스 머신']],
  '덤벨 숄더프레스': [['덤벨']],
  '숄더프레스 머신': [['숄더프레스 머신']],
  '바벨컬': [['바벨']],
  '덤벨 컬': [['덤벨']],
  '이지바 컬': [['이지바']],
  '스컬크러셔': [['이지바', '플랫 벤치'], ['바벨', '플랫 벤치'], ['덤벨', '플랫 벤치']],
  '케이블 푸시다운': [['케이블 머신']],
  '덤벨 트라이셉 익스텐션': [['덤벨']],
  '클로즈그립 벤치프레스': [['바벨', '플랫 벤치'], ['스미스 머신', '플랫 벤치']],
};

const hasGym = (equip) => Array.isArray(equip) && equip.length > 0;
export function canDo(name, equip) {
  if (!hasGym(equip)) return true; // 기구를 안 적었으면 전부 가능으로
  const ways = NEEDS[name];
  if (!ways) return true;
  return ways.some((w) => w.every((e) => equip.includes(e)));
}

/** 무분할 6부위를 우리 헬스장 기구로: [{name, main, swapped, missing}] */
export function gymRoutine(equip) {
  return ROUTINE.map((r) => {
    const pick = [r.name, ...r.alts].find((n) => canDo(n, equip));
    return { name: pick || r.name, main: r.name, part: r.part, swapped: !!pick && pick !== r.name, missing: !pick };
  });
}

/** 있는 기구로 할 수 있는 유산소 */
export function cardioKinds(equip) {
  const kinds = ['걷기', '러닝', '등산', '줄넘기'];
  if (!hasGym(equip)) return [...kinds, '천국의계단', '실내자전거', '일립티컬'];
  if (equip.includes('천국의계단')) kinds.push('천국의계단');
  if (equip.includes('실내자전거')) kinds.push('실내자전거');
  if (equip.includes('일립티컬')) kinds.push('일립티컬');
  return kinds;
}

/** 헬스장 사진 → 기구 이름 */
export async function identifyEquipment({ sample, apiKey, jpegs }) {
  const prompt = `헬스장 사진입니다(여러 장일 수 있음). 보이는 운동 기구를 알려주세요.
- 아래 목록에 있는 기구면 목록의 이름 그대로 known 에 넣으세요: ${ALL_EQUIP.join(', ')}
- 목록에 없는 기구는 짧은 한국어 이름으로 other 에 넣으세요(예: "어시스트 풀업 머신").
- 확실히 보이는 것만. 같은 기구는 한 번만.`;
  const SCHEMA = { type: 'object', additionalProperties: false, required: ['known', 'other'], properties: { known: { type: 'array', items: { type: 'string' } }, other: { type: 'array', items: { type: 'string' } } } };
  const known = new Set(), other = new Set();
  for (const part of chunks(jpegs, await maxImages(sample))) {
    const out = sample
      ? await sample.json(prompt + '\n\n반드시 JSON 하나만 답하세요. 형식: {"known": ["..."], "other": ["..."]}', { images: part.map(dataUrlToBlob), modelTier: 'default' })
      : await claudeImageJSON(part, apiKey, prompt, SCHEMA);
    (out?.known || []).forEach((x) => ALL_EQUIP.includes(x) && known.add(x));
    (out?.other || []).forEach((x) => typeof x === 'string' && x.trim() && !ALL_EQUIP.includes(x.trim()) && other.add(x.trim().slice(0, 20)));
  }
  return { known: [...known], other: [...other] };
}
