// 이번 주 운동 루틴 추천 (Claude, 없으면 기본 템플릿)
import { db, today, addDays, weekStart, GOAL } from './store.js';
import { claudeImageJSON } from './inbody.js';
import { recordSummary } from './workout-analysis.js';
import { ROUTINE, lastKg } from './routine.js';

export const DOWS = ['월', '화', '수', '목', '금', '토', '일'];
export const KINDS = ['러닝', '걷기', '실내자전거', '천국의계단', '일립티컬', '줄넘기', '등산', '기타'];
export const ACTS = [['swim', '🏊 수영'], ['weight', '🏋️ 웨이트'], ['cardio', '🏃 유산소']];
export const defaultPrefs = () => ({ days: ['월', '화', '수', '목', '금', '토'], minutes: 60, acts: ['swim', 'weight', 'cardio'], note: '' });

const nnum = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const nstr = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'tips', 'days'],
  properties: {
    summary: { type: 'string' },
    tips: { type: 'array', items: { type: 'string' } },
    days: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['dow', 'type', 'title', 'duration', 'kind', 'distance', 'items'],
        properties: {
          dow: { type: 'string', enum: DOWS },
          type: { type: 'string', enum: ['weight', 'swim', 'cardio', 'etc', 'rest'] },
          title: { type: 'string' }, duration: nnum, kind: nstr, distance: nnum,
          items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'detail'], properties: { name: { type: 'string' }, detail: { type: 'string' } } } },
        },
      },
    },
  },
};

function lastLifts() {
  return ROUTINE.map((r) => `${r.name}: ${lastKg(r.name) ? lastKg(r.name) + 'kg' : '기록 없음'}`).join(', ');
}

function prompt(prefs) {
  const s = db.settings;
  const { lines, ib } = recordSummary(21);
  const ws = weekStart(today());
  const doneThisWeek = lines.filter((l) => l.slice(0, 10) >= ws && l.slice(0, 10) < today()).filter((l) => !l.endsWith('운동 없음'));
  return `당신은 다이어트 중인 사람의 운동 코치입니다. 이번 주(월 ${ws} ~ 일 ${addDays(ws, 6)}) 요일별 운동 루틴을 짜 주세요. 오늘은 ${today()} 입니다.

[조건]
• 운동 가능한 요일: ${prefs.days.join(', ')} (나머지 요일은 type "rest")
• 1회 운동 시간: 약 ${prefs.minutes}분
• 넣을 운동: ${prefs.acts.map((a) => ({ swim: '수영', weight: '웨이트', cardio: '유산소' }[a])).join(', ')}
• 목적: ${(GOAL[s.goal] || GOAL.diet)[0]} / 성별 ${s.sex === 'male' ? '남성' : '여성'}
• 요청사항: ${prefs.note || '없음'}

[따를 원칙]
• 웨이트는 무분할: 풀다운, 인클라인 벤치프레스, 스쿼트, 밀리터리프레스, 바벨컬, 스컬크러셔를 하루에 모두, 각 5세트(시간이 부족하면 3~4세트). 근육 회복을 위해 웨이트 날 사이에 하루 이상 쉬게(주 2~3회).
• 다이어트 중에는 무게 욕심 없이 지금 무게 유지가 목표. 반복수를 조금씩 늘린다.
• 살 빼기는 식단이 핵심이라 운동을 과하게 늘리지 않는다. 꾸준히 할 수 있는 양으로.
• 수영·유산소는 웨이트가 없는 날 위주로, 웨이트 날에 넣는다면 웨이트 뒤 짧게.
• 이번 주에 이미 한 운동은 고려해서 남은 요일을 짜기.

[최근 지난 종목별 무게] ${lastLifts()}

[이번 주 이미 한 운동]
${doneThisWeek.length ? doneThisWeek.join('\n') : '없음'}

[최근 3주 기록]
${lines.join('\n')}

[인바디] ${ib.length ? ib.join(' / ') : '없음'}

규칙:
• days 는 월~일 7개, 순서대로.
• type: weight | swim | cardio | etc | rest. cardio 면 kind 는 ${KINDS.join(', ')} 중 하나, 아니면 null. swim 이면 distance 에 목표 거리(m), cardio 면 km(없으면 null), 그 외 null.
• items: 그날 할 것들. weight 는 종목마다 {name: 종목명, detail: "5세트 · 지난번 무게 유지, 반복수 +1~2"}처럼. swim/cardio 는 구간별(워밍업·본운동·마무리)로.
• title 은 짧게(예: "무분할 웨이트", "수영 인터벌"). summary 는 이번 주 계획 한두 문장. tips 는 2~3개, 짧게.
• 한국어로.`;
}

const JSON_HINT = `

반드시 JSON 하나만 답하세요. 형식:
{"summary": "...", "tips": ["..."], "days": [{"dow": "월", "type": "weight|swim|cardio|etc|rest", "title": "...", "duration": 숫자 또는 null, "kind": 문자열 또는 null, "distance": 숫자 또는 null, "items": [{"name": "...", "detail": "..."}]}]}`;

export async function generatePlan({ sample, apiKey, prefs }) {
  const out = sample
    ? await sample.json(prompt(prefs) + JSON_HINT, { modelTier: 'default' })
    : await claudeImageJSON(null, apiKey, prompt(prefs), SCHEMA);
  return normalize(out, 'claude');
}

function normalize(out, source) {
  const byDow = Object.fromEntries((Array.isArray(out?.days) ? out.days : []).map((d) => [d?.dow, d]));
  const ws = weekStart(today());
  const days = DOWS.map((dow, i) => {
    const d = byDow[dow] || { type: 'rest' };
    const type = ['weight', 'swim', 'cardio', 'etc', 'rest'].includes(d.type) ? d.type : 'rest';
    return {
      date: addDays(ws, i), dow, type,
      title: typeof d.title === 'string' && d.title ? d.title.slice(0, 30) : type === 'rest' ? '휴식' : '',
      duration: +d.duration > 0 ? Math.round(+d.duration) : null,
      kind: type === 'cardio' ? (KINDS.includes(d.kind) ? d.kind : '기타') : null,
      distance: +d.distance > 0 ? +d.distance : null,
      items: (Array.isArray(d.items) ? d.items : []).filter((x) => x && x.name).slice(0, 10).map((x) => ({ name: String(x.name).slice(0, 30), detail: String(x.detail || '').slice(0, 80) })),
    };
  });
  return {
    week: ws, createdAt: today(), source,
    summary: typeof out?.summary === 'string' ? out.summary : '',
    tips: (Array.isArray(out?.tips) ? out.tips : []).filter((t) => typeof t === 'string').slice(0, 4),
    days,
  };
}

/** Claude 없이 쓰는 기본 루틴 */
export function templatePlan(prefs) {
  const avail = DOWS.filter((d) => prefs.days.includes(d));
  const sets = prefs.minutes >= 60 ? 5 : prefs.minutes >= 45 ? 4 : 3;
  const weightDays = [];
  if (prefs.acts.includes('weight')) {
    // 하루 이상 띄워서 주 2~3회
    for (const d of avail) {
      const i = DOWS.indexOf(d);
      if (weightDays.length < 3 && !weightDays.some((w) => Math.abs(DOWS.indexOf(w) - i) < 2)) weightDays.push(d);
    }
  }
  const others = prefs.acts.filter((a) => a !== 'weight');
  let k = 0;
  const days = DOWS.map((dow) => {
    if (!avail.includes(dow)) return { dow, type: 'rest' };
    if (weightDays.includes(dow)) return { dow, type: 'weight', title: '무분할 웨이트', duration: prefs.minutes, items: ROUTINE.map((r) => ({ name: r.name, detail: `${sets}세트 · ${lastKg(r.name) ? lastKg(r.name) + 'kg 유지, 반복수 +1~2' : '가벼운 무게로 6회부터'}` })) };
    if (!others.length) return { dow, type: 'rest' };
    const a = others[k++ % others.length];
    if (a === 'swim') return { dow, type: 'swim', title: '수영', duration: prefs.minutes, distance: Math.round(prefs.minutes * 20 / 50) * 50, items: [{ name: '워밍업', detail: '자유형·배영 천천히 200m' }, { name: '본운동', detail: '자유형 50m × 반복, 30초 휴식' }, { name: '마무리', detail: '킥판 100m + 천천히 100m' }] };
    return { dow, type: 'cardio', title: '유산소', kind: '걷기', duration: Math.min(prefs.minutes, 45), items: [{ name: '빠르게 걷기 / 천국의계단', detail: '대화는 가능하지만 노래는 힘든 강도로' }] };
  });
  return normalize({ days, summary: '기본 루틴이에요. Claude를 쓸 수 있으면 내 기록에 맞춘 루틴을 받아 보세요.', tips: ['웨이트는 하루 이상 쉬고 다시 해요.', '다이어트 중엔 무게 유지, 반복수만 조금씩 늘려요.'] }, 'template');
}

/** 추천 → 운동 기록 화면 미리 채우기 */
export function presetFrom(day) {
  const p = { date: day.date };
  if (day.duration) p.duration = day.duration;
  if (day.type === 'weight') {
    const known = day.items.filter((x) => x.name);
    p.sets = known.map((x) => ({ name: x.name, kg: lastKg(x.name), reps: '', sets: +(x.detail.match(/(\d)\s*세트/)?.[1]) || 5 }));
    p.parts = ['등', '가슴', '하체', '어깨', '팔'];
  }
  if (day.type === 'swim' && day.distance) p.distance = String(day.distance);
  if (day.type === 'cardio') { p.kind = day.kind || '기타'; if (day.distance) p.distance = String(day.distance); }
  if (day.type === 'etc') p.title = day.title;
  p.memo = `추천 루틴: ${day.title}`;
  return p;
}
