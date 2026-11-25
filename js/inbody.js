// 인바디: 항목 정의, 표준 범위, 캡처 이미지 분석(Claude / OCR), 분석 코멘트
import { today } from './store.js';

export const METRICS = [
  { key: 'weight', label: '체중', unit: 'kg', dec: 1, range: [25, 250], main: true },
  { key: 'smm', label: '골격근량', unit: 'kg', dec: 1, range: [5, 80], main: true },
  { key: 'bfm', label: '체지방량', unit: 'kg', dec: 1, range: [1, 150], main: true },
  { key: 'pbf', label: '체지방률', unit: '%', dec: 1, range: [2, 70], main: true },
  { key: 'bmi', label: 'BMI', unit: '', dec: 1, range: [10, 60], main: true },
  { key: 'whr', label: '복부지방률', unit: '', dec: 2, range: [0.5, 1.5], main: true },
  { key: 'vfl', label: '내장지방레벨', unit: '', dec: 0, range: [1, 30] },
  { key: 'bmr', label: '기초대사량', unit: 'kcal', dec: 0, range: [600, 4000] },
  { key: 'tbw', label: '체수분', unit: 'L', dec: 1, range: [10, 80] },
  { key: 'protein', label: '단백질', unit: 'kg', dec: 1, range: [2, 30] },
  { key: 'mineral', label: '무기질', unit: 'kg', dec: 2, range: [1, 10] },
  { key: 'score', label: '인바디점수', unit: '점', dec: 0, range: [30, 110] },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));

/** 표준 범위 (InBody 결과지 기준 근사치) */
export function standardRange(key, { sex = 'female', height } = {}) {
  const f = sex !== 'male';
  switch (key) {
    case 'pbf': return f ? [18, 28] : [10, 20];
    case 'whr': return f ? [0.75, 0.85] : [0.8, 0.9];
    case 'bmi': return [18.5, 25];
    case 'vfl': return [1, 9];
    case 'weight': {
      if (!height) return null;
      const h = height / 100;
      return [+(18.5 * h * h).toFixed(1), +(23 * h * h).toFixed(1)];
    }
    default: return null;
  }
}

export function colorFor(key, settings) {
  const r = standardRange(key, settings);
  return (v) => {
    if (!r) return '#f0506e';
    if (v > r[1]) return '#f0506e';
    if (v < r[0]) return '#f2a33a';
    return '#3bb98a';
  };
}

/* ---------- 이미지 준비 ---------- */
export function fileToImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}
export function imageToJpeg(img, maxSide = 1568, quality = 0.85) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/* ---------- Claude 로 분석 ---------- */
const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['measurements', 'note'],
  properties: {
    note: { type: 'string', description: '화면 종류나 읽기 어려웠던 부분 등 짧은 한국어 메모' },
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'time', ...METRICS.map((m) => m.key)],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { anyOf: [{ type: 'string', description: 'HH:MM' }, { type: 'null' }] },
          ...Object.fromEntries(METRICS.map((m) => [m.key, num])),
        },
      },
    },
  },
};

const PROMPT = (t) => `이 이미지는 InBody(인바디) 앱 화면 캡처 또는 인바디 결과지입니다. 보이는 측정값을 모두 추출하세요.

- 오늘 날짜는 ${t} 입니다. 화면에 연도가 없으면(예: "11.19") 오늘 기준으로 가장 최근의 해당 날짜로 연도를 정하세요. "26.11.19" 같은 표기는 2026-11-19 입니다.
- '변화' 탭처럼 여러 날짜의 그래프가 있으면, 날짜마다 하나씩 measurements 항목을 만들고 그래프 점 위에 적힌 숫자를 해당 날짜에 넣으세요.
- 한 번의 측정 결과 화면이면 measurements 에 하나만 넣으세요.
- 항목: weight=체중(kg), smm=골격근량(kg), bfm=체지방량(kg), pbf=체지방률(%), bmi=BMI, whr=복부지방률(허리엉덩이둘레비), vfl=내장지방레벨, bmr=기초대사량(kcal), tbw=체수분(L), protein=단백질(kg), mineral=무기질(kg), score=인바디점수.
- 화면에 없는 항목은 null. 추측해서 계산하지 말고 보이는 숫자만 넣으세요.
- 측정 시각이 보이면 time 에 HH:MM, 없으면 null.`;

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.6.0/+esm';

export async function analyzeWithClaude(jpegDataUrl, apiKey) {
  const { default: Anthropic } = await import(SDK_URL);
  // 개인용 앱: 키는 이 브라우저(localStorage)에만 저장되고 Anthropic API 로만 전송됩니다.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const data = jpegDataUrl.split(',')[1];
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: PROMPT(today()) },
        ],
      },
    ],
  });
  if (res.stop_reason === 'refusal') throw new Error('분석이 거절되었습니다. 다른 캡처로 시도해 주세요.');
  if (res.stop_reason === 'max_tokens') throw new Error('응답이 잘렸습니다. 다시 시도해 주세요.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = JSON.parse(text);
  return { measurements: out.measurements.map(clean), note: out.note || '' };
}

/** data: URL -> Blob (claude.ai 안에서는 fetch(data:) 가 막혀 있어서 직접 변환) */
export function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const type = head.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* ---------- claude.ai 에서 열었을 때: 키 없이 Claude 사용 ---------- */
export async function sampleImageReady() {
  try {
    const sample = await window.claude?.use?.('sample');
    if (!sample) return null;
    const lim = await sample.limits().catch(() => null);
    return lim?.images ? sample : null;
  } catch { return null; }
}

export async function analyzeWithSample(sample, jpegDataUrl) {
  const blob = dataUrlToBlob(jpegDataUrl);
  const keys = METRICS.map((m) => m.key).join(', ');
  const prompt = PROMPT(today()) + `

반드시 JSON 하나만 답하세요. 형식:
{"note": "짧은 한국어 메모", "measurements": [{"date": "YYYY-MM-DD", "time": "HH:MM" 또는 null, ${METRICS.map((m) => `"${m.key}": 숫자 또는 null`).join(', ')}}]}
(키 목록: date, time, ${keys})`;
  const out = await sample.json(prompt, { images: [blob], modelTier: 'default' });
  const list = Array.isArray(out?.measurements) ? out.measurements : [];
  return { measurements: list.map(clean), note: typeof out?.note === 'string' ? out.note : '' };
}

/* ---------- OCR (API 키 없을 때) ---------- */
const LABELS = {
  weight: ['체중'],
  smm: ['골격근량', '골격근'],
  bfm: ['체지방량'],
  pbf: ['체지방률', '체지방율'],
  bmi: ['BMI', '신체질량지수'],
  whr: ['복부지방률', '복부지방율', '허리엉덩이둘레비'],
  vfl: ['내장지방레벨', '내장지방'],
  bmr: ['기초대사량'],
  tbw: ['체수분'],
  protein: ['단백질'],
  mineral: ['무기질'],
  score: ['인바디점수', 'InBody점수'],
};

let tessLoading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tessLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.onload = () => res(window.Tesseract);
    s.onerror = () => rej(new Error('OCR 엔진을 불러오지 못했습니다.'));
    document.head.appendChild(s);
  });
  return tessLoading;
}

export async function analyzeWithOCR(jpegDataUrl, onProgress) {
  const T = await loadTesseract();
  const worker = await T.createWorker('kor+eng', 1, {
    logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress),
  });
  const { data } = await worker.recognize(jpegDataUrl);
  await worker.terminate();
  return { measurements: [parseText(data.text)], note: '문자 인식(OCR) 결과입니다. 값이 맞는지 꼭 확인해 주세요.' };
}

export function parseText(raw) {
  const text = raw.replace(/[ \t]+/g, '').replace(/,/g, '.');
  const rec = { date: today(), time: null };
  const dm = text.match(/(\d{2,4})[.\-/년](\d{1,2})[.\-/월](\d{1,2})/);
  if (dm) {
    let y = +dm[1];
    if (y < 100) y += 2000;
    const m = +dm[2], d = +dm[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) rec.date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const tm = text.match(/(\d{1,2}):(\d{2})/);
  if (tm) rec.time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
  for (const m of METRICS) {
    rec[m.key] = null;
    for (const label of LABELS[m.key]) {
      let idx = text.indexOf(label);
      while (idx >= 0) {
        const after = text.slice(idx + label.length, idx + label.length + 30);
        const nm = after.match(/\d+(?:\.\d+)?/);
        if (nm) {
          const v = parseFloat(nm[0]);
          if (v >= m.range[0] && v <= m.range[1]) { rec[m.key] = v; break; }
        }
        idx = text.indexOf(label, idx + 1);
      }
      if (rec[m.key] != null) break;
    }
  }
  return rec;
}

function clean(r) {
  const out = { date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today(), time: r.time || null };
  for (const m of METRICS) {
    const v = r[m.key];
    out[m.key] = typeof v === 'number' && isFinite(v) ? v : null;
  }
  return out;
}

/* ---------- 분석 코멘트 ---------- */
const sign = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);

export function analyze(records, settings) {
  const pts = [];
  if (!records.length) return pts;
  const last = records[records.length - 1];
  const prev = records.length > 1 ? records[records.length - 2] : null;
  const first = records[0];
  const add = (color, html) => pts.push({ color, html });
  const diff = (a, b, k) => (a?.[k] != null && b?.[k] != null ? a[k] - b[k] : null);

  if (prev) {
    const dw = diff(last, prev, 'weight'), ds = diff(last, prev, 'smm'), df = diff(last, prev, 'bfm');
    const parts = [];
    if (dw != null) parts.push(`체중 <b>${sign(dw)}kg</b>`);
    if (ds != null) parts.push(`골격근 <b>${sign(ds)}kg</b>`);
    if (df != null) parts.push(`체지방 <b>${sign(df)}kg</b>`);
    if (parts.length) add('#2f3640', `지난 측정 대비 ${parts.join(', ')}`);
    if (df != null && ds != null) {
      if (df < 0 && ds >= -0.2) add('#3bb98a', '근육은 지키면서 체지방이 줄었어요. 지금 방향 아주 좋아요 👍');
      else if (df < 0 && ds < -0.2) add('#f2a33a', '체지방과 함께 골격근도 줄었어요. 단백질 섭취와 웨이트 비중을 조금 늘려보세요.');
      else if (df > 0 && ds > 0) add('#f2a33a', '근육과 체지방이 함께 늘었어요. 식사량(특히 간식)을 점검해 보세요.');
      else if (df > 0) add('#f0506e', '체지방이 늘었어요. 최근 며칠 식단 기록을 확인해 보세요.');
    }
  }

  if (records.length > 2 && first.weight != null && last.weight != null) {
    const days = (new Date(last.date) - new Date(first.date)) / 86400000;
    if (days >= 7) {
      const perWeek = ((last.weight - first.weight) / days) * 7;
      const txt = `처음(${first.date.slice(5).replace('-', '.')}) 대비 체중 <b>${sign(last.weight - first.weight)}kg</b>, 주당 평균 <b>${sign(perWeek, 2)}kg</b>`;
      add(perWeek < -1.2 ? '#f2a33a' : '#2f3640', txt + (perWeek < -1.2 ? ' — 감량 속도가 빨라요. 근손실에 주의하세요.' : ''));
    }
  }

  const pr = standardRange('pbf', settings);
  if (last.pbf != null && pr) {
    if (last.pbf > pr[1]) {
      let more = '';
      if (last.weight != null && last.bfm != null) {
        const lean = last.weight - last.bfm;
        const targetW = lean / (1 - pr[1] / 100);
        more = ` 지금 제지방량을 유지한다면 체지방 약 <b>${(last.weight - targetW).toFixed(1)}kg</b> 감량 시 표준 상한에 도달해요.`;
      }
      add('#f0506e', `체지방률 ${last.pbf}% — 표준(${pr[0]}~${pr[1]}%)보다 <b>${(last.pbf - pr[1]).toFixed(1)}%p</b> 높아요.${more}`);
    } else if (last.pbf >= pr[0]) add('#3bb98a', `체지방률 ${last.pbf}% — 표준 범위(${pr[0]}~${pr[1]}%) 안이에요.`);
    else add('#f2a33a', `체지방률 ${last.pbf}% — 표준보다 낮아요.`);
  }
  const wr = standardRange('whr', settings);
  if (last.whr != null && wr) {
    if (last.whr > wr[1]) add('#f0506e', `복부지방률 ${last.whr} — 표준(${wr[0]}~${wr[1]})보다 높아요. 유산소 + 식단 관리가 효과적이에요.`);
    else add('#3bb98a', `복부지방률 ${last.whr} — 표준 범위예요.`);
  }
  if (last.vfl != null && last.vfl >= 10) add('#f0506e', `내장지방레벨 ${last.vfl} — 10 이상은 관리가 필요한 단계예요.`);
  if (settings.goalWeight && last.weight != null) {
    const left = last.weight - settings.goalWeight;
    add('#4a7bf7', left > 0 ? `목표 체중 ${settings.goalWeight}kg까지 <b>${left.toFixed(1)}kg</b> 남았어요.` : `목표 체중 ${settings.goalWeight}kg 달성! 🎉`);
  }
  if (last.bmr != null) add('#8a9099', `기초대사량 ${last.bmr}kcal — 하루 섭취 목표를 이 값 아래로 너무 낮추지 않는 것이 좋아요.`);
  return pts;
}
