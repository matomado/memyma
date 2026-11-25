// 애플워치(피트니스/운동 앱) 캡처 → 운동 기록 (Claude)
import { claudeImageJSON, dataUrlToBlob } from './inbody.js';
import { today } from './store.js';

const KINDS = ['러닝', '걷기', '실내자전거', '천국의계단', '일립티컬', '줄넘기', '등산', '기타'];
const STROKES = ['자유형', '배영', '평영', '접영', '혼합', '킥판'];
const nnum = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const nstr = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['note', 'workouts'],
  properties: {
    note: { type: 'string' },
    workouts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'kind', 'title', 'date', 'duration', 'activeKcal', 'totalKcal', 'distance', 'avgHr', 'strokes'],
        properties: {
          type: { type: 'string', enum: ['swim', 'weight', 'cardio', 'etc'] },
          kind: nstr, title: nstr, date: nstr,
          duration: nnum, activeKcal: nnum, totalKcal: nnum, distance: nnum, avgHr: nnum,
          strokes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const PROMPT = (t) => `이 이미지는 애플워치 운동 기록(아이폰 '피트니스' 앱 또는 워치 운동 요약) 캡처입니다. 보이는 운동을 모두 읽으세요.

- 오늘은 ${t} 입니다. 날짜가 "오늘"/"어제"/요일/연도 없는 날짜로 보이면 오늘 기준으로 YYYY-MM-DD 로 바꾸세요. 날짜가 안 보이면 null.
- type: 수영(풀 수영·실외 수영) → "swim", 근력 운동(기능성/전통적 근력 운동, 코어 트레이닝) → "weight", 달리기·걷기·사이클·계단 오르기·일립티컬·하이킹·줄넘기·HIIT 등 → "cardio", 그 밖(요가, 필라테스 등) → "etc".
- kind: cardio 일 때만 다음 중 하나: ${KINDS.join(', ')} (실내/실외 달리기→러닝, 실내/실외 걷기→걷기, 실내 사이클·실외 사이클→실내자전거, 계단 오르기·스테퍼→천국의계단, 하이킹→등산, 나머지→기타). 아니면 null.
- title: 애플워치에 표시된 운동 이름 그대로(예: "실외 걷기", "기능성 근력 운동").
- duration: 운동 시간(분, 소수점 가능. 예: 0:45:30 → 45.5).
- activeKcal: "활동 킬로칼로리", totalKcal: "총 킬로칼로리". 없으면 null.
- distance: 수영은 미터(m), 그 외는 킬로미터(km). 없으면 null.
- avgHr: 평균 심박수(bpm). 없으면 null.
- strokes: 수영 영법이 보이면 ${STROKES.join(', ')} 중에서(자유형=Freestyle, 배영=Backstroke, 평영=Breaststroke, 접영=Butterfly, 혼합=Mixed, 킥판=Kickboard). 없으면 빈 배열.
- 화면에 숫자로 보이지 않는 값은 계산하거나 추측하지 말고 null.
- 애플워치 운동 화면이 아니면 workouts 를 빈 배열로 두고 note 에 이유를 쓰세요.`;

export async function analyzeWatch({ sample, apiKey, jpeg }) {
  const out = sample
    ? await sample.json(PROMPT(today()) + `

반드시 JSON 하나만 답하세요. 형식:
{"note": "짧은 메모", "workouts": [{"type": "swim|weight|cardio|etc", "kind": 문자열 또는 null, "title": 문자열 또는 null, "date": "YYYY-MM-DD" 또는 null, "duration": 숫자 또는 null, "activeKcal": 숫자 또는 null, "totalKcal": 숫자 또는 null, "distance": 숫자 또는 null, "avgHr": 숫자 또는 null, "strokes": []}]}`, { images: [dataUrlToBlob(jpeg)], modelTier: 'default' })
    : await claudeImageJSON(jpeg, apiKey, PROMPT(today()), SCHEMA);
  const num = (v) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : null);
  const workouts = (Array.isArray(out?.workouts) ? out.workouts : []).map((w) => {
    const type = ['swim', 'weight', 'cardio', 'etc'].includes(w?.type) ? w.type : 'etc';
    const kcal = num(w.activeKcal) ?? num(w.totalKcal);
    return {
      type,
      kind: type === 'cardio' ? (KINDS.includes(w.kind) ? w.kind : '기타') : '러닝',
      title: typeof w.title === 'string' ? w.title.slice(0, 30) : '',
      date: typeof w.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date) ? w.date : null,
      duration: num(w.duration) != null ? Math.round(w.duration) : null,
      kcal: kcal != null ? Math.round(kcal) : null,
      distance: num(w.distance) != null ? String(type === 'swim' ? Math.round(w.distance) : +w.distance.toFixed(2)) : '',
      avgHr: num(w.avgHr) != null ? Math.round(w.avgHr) : null,
      strokes: Array.isArray(w.strokes) ? w.strokes.filter((s) => STROKES.includes(s)) : [],
    };
  });
  return { workouts, note: typeof out?.note === 'string' ? out.note : '' };
}
