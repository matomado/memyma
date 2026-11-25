// InBody 앱 스타일 꺾은선 그래프 (SVG, 외부 라이브러리 없음)
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

function smoothPath(pts) {
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/**
 * points: [{ x: '11.19', value: 38.7, tip: '26.11.19 20:24' }]
 * opts: { unit, decimals, colorFor(value) }
 */
export function lineChart(points, opts = {}) {
  const { unit = '', decimals = 1, colorFor = () => '#f0506e' } = opts;
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  wrap.appendChild(tip);

  if (!points.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = '아직 기록이 없어요';
    wrap.appendChild(e);
    return wrap;
  }

  // 점이 8개 넘으면 한 칸 간격을 고정하고 그래프를 옆으로 늘려서 가로 스크롤
  const n0 = points.length, STEP = 47;
  const W = n0 > 8 ? 34 * 2 + (n0 - 1) * STEP : 400;
  const H = 250, padX = 34, top = 34, bottom = 210, axisY = 236;
  const vals = points.map((p) => p.value);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.35; max += span * 0.35;
  const n = points.length;
  const xAt = (i) => (n === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (n - 1));
  const yAt = (v) => bottom - ((v - min) / (max - min)) * (bottom - top);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  if (W > 400) svg.style.width = `${(W / 400) * 100}%`;
  for (let i = 0; i < 5; i++) {
    const y = top + ((bottom - top) * i) / 4;
    svg.appendChild(el('line', { x1: 0, x2: W, y1: y, y2: y, class: 'grid' }));
  }
  svg.appendChild(el('line', { x1: 0, x2: W, y1: bottom + 14, y2: bottom + 14, class: 'grid' }));

  const sel = el('line', { x1: 0, x2: 0, y1: 4, y2: bottom + 14, class: 'sel' });
  svg.appendChild(sel);

  const pts = points.map((p, i) => [xAt(i), yAt(p.value)]);
  // 왼쪽에서 들어오는 꼬리 (InBody 느낌)
  if (n > 1) svg.appendChild(el('path', { d: `M0,${pts[0][1] - 10} L${pts[0][0]},${pts[0][1]}`, class: 'line' }));
  svg.appendChild(el('path', { d: smoothPath(pts), class: 'line' }));

  const fmt = (v) => Number(v).toFixed(decimals);
  const dots = [];
  points.forEach((p, i) => {
    const [x, y] = pts[i];
    svg.appendChild(el('text', { x, y: y - 11, class: 'val' }, fmt(p.value)));
    const c = el('circle', { cx: x, cy: y, r: 4.5, fill: colorFor(p.value), stroke: '#fff', 'stroke-width': 1.5 });
    dots.push(c);
    svg.appendChild(c);
    svg.appendChild(el('text', { x, y: axisY, class: 'xl' }, p.x));
  });
  // 터치 영역
  points.forEach((p, i) => {
    const x = xAt(i);
    const w = n === 1 ? W : (W - padX * 2) / (n - 1);
    const r = el('rect', { x: x - w / 2, y: 0, width: w, height: H, class: 'hit' });
    r.addEventListener('click', () => select(i));
    svg.appendChild(r);
  });

  function select(i) {
    const x = xAt(i);
    sel.setAttribute('x1', x); sel.setAttribute('x2', x);
    dots.forEach((d, j) => d.setAttribute('r', j === i ? 6 : 4.5));
    const p = points[i];
    tip.innerHTML = `<span>${p.tip || p.x}<b>${fmt(p.value)}${unit}</b></span>`;
  }
  select(n - 1);
  if (W > 400) {
    const sc = document.createElement('div');
    sc.className = 'chart-scroll';
    sc.appendChild(svg);
    wrap.appendChild(sc);
    wrap.appendChild(Object.assign(document.createElement('div'), { className: 'chart-hint', textContent: '← 옆으로 밀어서 이전 기록 보기' }));
    requestAnimationFrame(() => { sc.scrollLeft = sc.scrollWidth; }); // 최신 기록부터
  } else {
    wrap.appendChild(svg);
  }
  return wrap;
}

/** 간단 막대그래프 (주간 섭취/소모 kcal) — bars: [{ x, a, b }] a=섭취, b=소모 */
export function barChart(bars, { target = 0, overColor = '#f0506e', targetLabel = null, unit = '' } = {}) {
  const W = 400, H = 200, top = 20, bottom = 168, padX = 20;
  const maxV = Math.max(target, ...bars.map((b) => Math.max(b.a, b.b)), 100) * 1.15;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  const yAt = (v) => bottom - (v / maxV) * (bottom - top);
  for (let i = 0; i < 4; i++) {
    const y = top + ((bottom - top) * i) / 3;
    svg.appendChild(el('line', { x1: 0, x2: W, y1: y, y2: y, class: 'grid' }));
  }
  svg.appendChild(el('line', { x1: 0, x2: W, y1: bottom, y2: bottom, class: 'grid' }));
  const slot = (W - padX * 2) / bars.length;
  bars.forEach((b, i) => {
    const cx = padX + slot * i + slot / 2;
    const bw = Math.min(16, slot / 3);
    if (b.a > 0) {
      const over = target && b.a > target;
      svg.appendChild(el('rect', { x: cx - bw - 1, y: yAt(b.a), width: bw, height: bottom - yAt(b.a), rx: 4, fill: over ? overColor : '#2f3640' }));
      svg.appendChild(el('text', { x: cx - bw / 2 - 1, y: yAt(b.a) - 4, class: 'xl', style: 'font-size:10px' }, Math.round(b.a) + unit));
    }
    if (b.b > 0) {
      svg.appendChild(el('rect', { x: cx + 1, y: yAt(b.b), width: bw, height: bottom - yAt(b.b), rx: 4, fill: '#3bb98a' }));
    }
    svg.appendChild(el('text', { x: cx, y: H - 12, class: 'xl' }, b.x));
  });
  if (target) {
    const y = yAt(target);
    svg.appendChild(el('line', { x1: 0, x2: W, y1: y, y2: y, stroke: '#f0506e', 'stroke-dasharray': '4 4', 'stroke-width': 1.5 }));
    svg.appendChild(el('text', { x: W - 4, y: y - 4, class: 'xl', style: 'text-anchor:end;fill:#f0506e;font-size:10px' }, targetLabel || `목표 ${target}`));
  }
  return svg;
}
