import {
  db, save, uid, replaceAll, getBg, setBg,
  today, addDays, parseISO, iso, fmtDate, fmtShort, weekStart, DOW, pad,
  MEAL_SLOTS, dayMeals, ensureDayMeals, itemKcal, intakeOf, hasMeals,
  workoutsOf, burnedOf, inbodySorted, inbodyOn, latestWeight,
  initCloud, isCloud, setSaveErrorHandler,
  weightOn, weightSeries, GOAL, goalKcal, syncKcalTarget, fillFoodGroups, GROUPS,
} from './store.js';
import { weightFeedback, goalLabel } from './weight.js';
import { bookings, bookingOn, addBooking, removeBooking, ptPlanOn, nextPt, pruneBookings, dowOf, ptDone } from './pt.js';
import { DOWS, ACTS, defaultPrefs, generatePlan, templatePlan, presetFrom } from './plan.js';
import { EQUIPMENT, ALL_EQUIP, MY_GYM, identifyEquipment, myRoutine, machineRoutine, freeRoutine, optionsFor } from './gym.js';
import { ROUTINE, ROUTINE_NAMES, repsList, setVolume, setText, lastKg, altsOf, progressHint, levelUps } from './routine.js';
import { lineChart, barChart } from './chart.js';
import { analyzeFoodPhoto, analyzeFoodText } from './food-photo.js';
import { analyzeWatch } from './watch.js';
import { weeklyStats, swimPaces, comments, coachPrompt } from './workout-analysis.js';
import {
  METRICS, METRIC, colorFor, standardRange, analyze,
  fileToImage, imageToJpeg, analyzeWithClaude, analyzeWithOCR, sampleImageReady, sampleReady, analyzeWithSample, claudeText, dataUrlToBlob,
} from './inbody.js';

/* ================= 공통 유틸 ================= */
const $view = document.getElementById('view');
const ui = { date: today(), calMode: 'week', calAnchor: today(), ibRange: 7, woRange: 4, coach: '', pending: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 1) => (v == null || v === '' ? '-' : (+v).toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'));
const kc = (v) => Math.round(v).toLocaleString('ko-KR');
function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
function sheet(title, body, { onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const bd = h(`<div class="sheet-backdrop"><div class="sheet"><div class="sheet-head"><h2>${esc(title)}</h2><button class="x" aria-label="닫기">×</button></div></div></div>`);
  const sh = bd.querySelector('.sheet');
  sh.appendChild(body);
  const close = () => { bd.remove(); document.body.style.overflow = ''; onClose?.(); };
  bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
  bd.querySelector('.x').onclick = close;
  root.appendChild(bd);
  document.body.style.overflow = 'hidden';
  return close;
}
/** 고른 사진들 → JPEG 목록 (최대 10장) */
async function readImages(fileList) {
  const files = [...(fileList || [])].slice(0, 10);
  const out = [];
  for (const f of files) {
    try { out.push(imageToJpeg(await fileToImage(f), files.length > 3 ? 1280 : 1568)); } catch { /* 못 여는 파일은 건너뜀 */ }
  }
  if (fileList?.length > 10) toast('한 번에 10장까지만 올릴 수 있어요');
  return out;
}
const previews = (jpegs) => `<div class="thumbs">${jpegs.map((j) => `<img src="${j}" alt="">`).join('')}</div>`;

function ask(msg, okLabel = '삭제') {
  return new Promise((res) => {
    let done = false;
    const body = h(`<div><p style="margin-top:0">${esc(msg)}</p><div class="grid2"><button class="btn">취소</button><button class="btn primary">${esc(okLabel)}</button></div></div>`);
    const close = sheet('확인', body, { onClose: () => { if (!done) res(false); } });
    const [no, yes] = body.querySelectorAll('button');
    no.onclick = () => close();
    yes.onclick = () => { done = true; res(true); close(); };
  });
}
function dateNav(onChange) {
  const d = ui.date;
  const rel = d === today() ? '오늘' : d === addDays(today(), -1) ? '어제' : d === addDays(today(), 1) ? '내일' : d.slice(0, 4) + '년';
  const nav = h(`<div class="datenav card" style="padding:10px 12px">
    <button class="btn sm ghost" data-d="-1">◀</button>
    <label class="label">${fmtDate(d)}<small>${rel}</small><input type="date" value="${d}"></label>
    <button class="btn sm ghost" data-d="1">▶</button></div>`);
  nav.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { ui.date = addDays(ui.date, +b.dataset.d); onChange(); }));
  const inp = nav.querySelector('input');
  nav.querySelector('.label').onclick = (e) => { if (e.target !== inp) { try { inp.showPicker(); } catch { inp.click(); } } };
  inp.onchange = () => { if (inp.value) { ui.date = inp.value; onChange(); } };
  return nav;
}
const TYPE = {
  swim: { label: '수영', icon: '🏊' },
  weight: { label: '웨이트', icon: '🏋️' },
  cardio: { label: '유산소', icon: '🏃' },
  etc: { label: '기타', icon: '✨' },
  pt: { label: 'PT', icon: '🧑‍🏫' },
};

/* ================= 배경 ================= */
function applyBackground() {
  const bg = getBg();
  const mode = bg ? db.settings.bgMode : 'none';
  document.body.classList.toggle('bg-full', mode === 'full');
  document.body.classList.toggle('bg-header', mode === 'header');
  const url = bg ? `url("${bg}")` : '';
  document.getElementById('bg-layer').style.backgroundImage = url;
  document.getElementById('top-banner').style.backgroundImage = url;
  document.documentElement.style.setProperty('--card-alpha', db.settings.cardAlpha);
}

/* ================= 라우팅 ================= */
const routes = { home: renderHome, meals: renderMeals, workout: renderWorkout, inbody: renderInbody, calendar: renderCalendar, prefs: renderSettings };
function route() {
  const name = location.hash.slice(1) || 'home';
  const fn = routes[name] || renderHome;
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  $view.innerHTML = '';
  fn();
}
function closeSheets() {
  document.getElementById('sheet-root').innerHTML = '';
  document.body.style.overflow = '';
}
function rerender() {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}
window.addEventListener('hashchange', () => { closeSheets(); route(); window.scrollTo(0, 0); });
document.getElementById('btn-settings').onclick = () => (location.hash = '#prefs');

/* ================= 홈 ================= */
function renderHome() {
  const t = today();
  const intake = intakeOf(t), burned = burnedOf(t), target = db.settings.kcalTarget;
  const pct = Math.min(100, (intake / target) * 100);
  const recs = inbodySorted();
  const last = recs[recs.length - 1], prev = recs[recs.length - 2];
  const delta = (k) => {
    if (!last || last[k] == null || !prev || prev[k] == null) return '';
    const d = last[k] - prev[k];
    const cls = Math.abs(d) < 0.05 ? 'same' : d > 0 ? 'up' : 'down';
    return `<div class="d ${cls}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${nf(Math.abs(d))}</div>`;
  };

  $view.appendChild(h(`<div class="card">
    <h2>${fmtDate(t)} <small>오늘</small></h2>
    <div class="row between small"><span>섭취 <b style="font-size:20px">${kc(intake)}</b> / ${kc(target)} kcal</span>
      <span class="${intake > target ? 'up' : 'muted'}">${intake > target ? `${kc(intake - target)} 초과` : `${kc(target - intake)} 남음`}</span></div>
    <div class="bar ${intake > target ? 'over' : ''}" style="margin:8px 0 12px"><i style="width:${pct}%"></i></div>
    <div class="grid3">
      <div class="stat"><div class="k">섭취</div><div class="v">${kc(intake)}<small>kcal</small></div></div>
      <div class="stat"><div class="k">운동 소모</div><div class="v">${kc(burned)}<small>kcal</small></div></div>
      <div class="stat"><div class="k">순 섭취</div><div class="v">${kc(intake - burned)}<small>kcal</small></div></div>
    </div>
    ${burned > 0 ? '<p class="small muted" style="margin:10px 0 0">💡 목표는 <b>먹은 양</b> 기준이에요. 운동한 만큼 더 먹으면 살이 빠지지 않아요.</p>' : ''}
  </div>`));
  $view.appendChild(weightCard());

  $view.appendChild(h(`<div class="card">
    <h2>최근 인바디 <small>${last ? fmtDate(last.date) : ''}</small></h2>
    ${last ? `<div class="grid3">
      <div class="stat"><div class="k">체중</div><div class="v">${nf(last.weight)}<small>kg</small></div>${delta('weight')}</div>
      <div class="stat"><div class="k">골격근량</div><div class="v">${nf(last.smm)}<small>kg</small></div>${delta('smm')}</div>
      <div class="stat"><div class="k">체지방률</div><div class="v">${nf(last.pbf)}<small>%</small></div>${delta('pbf')}</div>
    </div>` : `<div class="empty">인바디 캡처를 올리면 자동으로 기록돼요<br><a href="#inbody" class="btn sm" style="margin-top:8px">인바디 추가</a></div>`}
  </div>`));

  const ws = workoutsOf(t);
  const wcard = h(`<div class="card"><h2>오늘 운동 <a href="#workout" class="btn sm">+ 기록</a></h2></div>`);
  const tpt = ptPlanOn(t);
  if (tpt && !ptDone(t)) {
    const r = h(`<div class="today-plan"><span>🧑‍🏫 오늘 <b>${tpt.time || ''} PT</b> 있어요</span><button class="btn sm primary">기록하기</button></div>`);
    r.querySelector('button').onclick = () => workoutForm(null, 'pt');
    wcard.appendChild(r);
  }
  const todayPlan = curPlan()?.days.find((d) => d.date === t);
  if (todayPlan) {
    const tp = h(`<div class="today-plan"><span>${todayPlan.type === 'rest' ? '😴 오늘은 쉬는 날이에요' : `추천: <b>${PLAN_ICON[todayPlan.type]} ${esc(todayPlan.title)}</b>${todayPlan.duration ? ` · ${todayPlan.duration}분` : ''}`}</span>${todayPlan.type !== 'rest' && !planDone(todayPlan) ? '<button class="btn sm primary">기록하기</button>' : planDone(todayPlan) ? '<span class="chip ok">✓ 완료</span>' : ''}</div>`);
    tp.querySelector('button')?.addEventListener('click', () => workoutForm(null, todayPlan.type, presetFrom(todayPlan)));
    wcard.appendChild(tp);
  }
  wcard.appendChild(ws.length ? workoutList(ws, false) : h(`<div class="empty">아직 운동 기록이 없어요</div>`));
  $view.appendChild(wcard);

  const wk = weekStart(t);
  const bars = Array.from({ length: 7 }, (_, i) => { const d = addDays(wk, i); return { x: DOW[parseISO(d).getDay()], a: intakeOf(d), b: burnedOf(d) }; });
  const c = h(`<div class="card"><h2>이번 주 칼로리 <a href="#calendar" class="btn sm">자세히</a></h2></div>`);
  c.appendChild(barChart(bars, { target }));
  c.appendChild(h(`<div class="legend"><span><i style="background:#2f3640"></i>섭취</span><span><i style="background:#3bb98a"></i>운동 소모</span><span><i style="background:#f0506e"></i>목표 초과</span></div>`));
  $view.appendChild(c);
}

function weightCard() {
  const t = today();
  const cur = db.weights?.[t];
  const card = h(`<div class="card analysis"><h2>아침 체중 <small>${goalLabel()} 모드 · 목표 ${kc(db.settings.kcalTarget)}kcal</small></h2>
    <div class="row"><input type="number" inputmode="decimal" step="0.1" class="wkg grow" placeholder="오늘 아침 체중 (kg)" value="${cur ?? ''}"><button class="btn primary">${cur ? '수정' : '기록'}</button></div>
    <p class="small muted" style="margin:6px 0 4px">일어나서 화장실 다녀온 뒤, 먹기 전에 재면 가장 정확해요.</p>
    <div class="fb"></div></div>`);
  const fb = card.querySelector('.fb');
  weightFeedback().forEach((p) => fb.appendChild(h(`<div class="pt"><span class="dot" style="background:${p.color}"></span><div>${p.html}</div></div>`)));
  const series = weightSeries().filter((r) => r.date >= addDays(t, -60));
  if (series.length >= 2) {
    fb.appendChild(lineChart(series.map((r) => ({ x: fmtShort(r.date), value: r.kg, tip: r.date.slice(2).replace(/-/g, '.') })), { unit: 'kg', decimals: 1, colorFor: () => '#4a7bf7' }));
  }
  const inp = card.querySelector('.wkg');
  const go = () => {
    const v = parseFloat(inp.value);
    if (!(v > 20 && v < 300)) return toast('체중을 kg으로 입력해 주세요');
    db.weights[t] = Math.round(v * 10) / 10;
    const before = db.settings.kcalTarget;
    syncKcalTarget();
    save(); rerender();
    toast(before !== db.settings.kcalTarget ? `기록했어요 · 목표 ${kc(db.settings.kcalTarget)}kcal로 맞췄어요` : '체중을 기록했어요');
  };
  card.querySelector('.btn').onclick = go;
  inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  return card;
}

/* ================= 식단 ================= */
function renderMeals() {
  $view.appendChild(dateNav(rerender));
  const d = ui.date;
  const meals = dayMeals(d);
  const intake = intakeOf(d), target = db.settings.kcalTarget;
  const slotK = (k) => (meals[k] || []).reduce((a, it) => a + itemKcal(it), 0);

  $view.appendChild(h(`<div class="card">
    <div class="row between"><b style="font-size:17px">총 ${kc(intake)} kcal</b><span class="small ${intake > target ? 'up' : 'muted'}">목표 ${kc(target)} · ${intake > target ? kc(intake - target) + ' 초과' : kc(target - intake) + ' 남음'}</span></div>
    <div class="bar ${intake > target ? 'over' : ''}" style="margin:8px 0"><i style="width:${Math.min(100, (intake / target) * 100)}%"></i></div>
    <div class="row between small muted">${MEAL_SLOTS.map(([k, l]) => `<span>${l} ${kc(slotK(k))}</span>`).join('')}</div>
  </div>`));

  for (const [k, label] of MEAL_SLOTS) {
    const items = meals[k] || [];
    const card = h(`<div class="card meal-slot"><h3>${label} <span class="kc">${kc(slotK(k))} kcal</span></h3><ul class="list"></ul>
      <div class="row" style="margin-top:8px"><button class="btn sm primary" data-a="add">+ 추가</button><button class="btn sm ghost" data-a="copy">이전 ${label} 불러오기</button></div></div>`);
    const ul = card.querySelector('ul');
    if (!items.length) ul.appendChild(h(`<li class="muted small" style="border:0;padding:4px 0">기록 없음</li>`));
    if (items.length && k !== 'snack') card.insertBefore(balanceRow(items), card.querySelector('.row'));
    items.forEach((it, i) => {
      const li = h(`<li><div class="name"><b>${esc(it.name)}</b><span class="sub">${nf(it.amount * it.qty, 2)}${esc(it.unit)}${it.eaten < 1 ? ` · <span class="up">${eatenText(it.eaten)}</span>` : ''}</span></div><span class="kcal">${kc(itemKcal(it))}</span><button class="x" aria-label="삭제">×</button></li>`);
      li.querySelector('.name').onclick = () => editMealItem(d, k, i);
      li.querySelector('.x').onclick = () => { ensureDayMeals(d)[k].splice(i, 1); save(); rerender(); };
      ul.appendChild(li);
    });
    card.querySelector('[data-a=add]').onclick = () => addFoodSheet(d, k, label);
    card.querySelector('[data-a=copy]').onclick = () => {
      for (let i = 1; i <= 60; i++) {
        const pd = addDays(d, -i);
        const src = db.meals[pd]?.[k];
        if (src?.length) {
          ensureDayMeals(d)[k].push(...src.map((x) => ({ ...x, id: uid() })));
          save(); rerender(); toast(`${fmtShort(pd)} ${label} 식단을 불러왔어요`);
          return;
        }
      }
      toast('최근 60일 안에 기록된 식단이 없어요');
    };
    $view.appendChild(card);
  }

  const lib = h(`<div class="card"><h2>자주 먹는 음식 <small>${db.foods.length}개</small></h2>
    <p class="small muted" style="margin:0 0 10px">자주 먹는 음식을 등록해 두면 탭 한 번으로 kcal가 자동 입력돼요.</p>
    <button class="btn block">음식 목록 관리</button></div>`);
  lib.querySelector('button').onclick = foodLibrarySheet;
  $view.appendChild(lib);
}

const EATEN = [[1, '다 먹음'], [0.75, '¾'], [0.5, '절반'], [0.25, '¼']];
const eatenText = (e) => (e == null || e >= 1 ? '' : (EATEN.find(([v]) => v === e)?.[1] || `${Math.round(e * 100)}%`) + ' 먹음');
function eatenSeg(cur, onPick) {
  const seg = h(`<div class="seg">${EATEN.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`);
  const mark = (x) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === x));
  seg.querySelectorAll('button').forEach((b) => (b.onclick = () => { mark(+b.dataset.v); onPick(+b.dataset.v); }));
  mark(cur);
  return seg;
}

const groupsOf = (it) => it.groups || db.foods.find((f) => f.id === it.foodId)?.groups || [];
const GROUP_TIP = { carb: '밥·빵·고구마 같은 탄수화물', protein: '계란·두부·고기·생선 같은 단백질', fiber: '채소·나물·김치·과일 같은 섬유질' };
function balanceRow(items) {
  const have = new Set(items.flatMap(groupsOf));
  const miss = GROUPS.filter(([g]) => !have.has(g));
  return h(`<div class="bal">${GROUPS.map(([g, l]) => `<span class="chip ${have.has(g) ? 'ok' : 'no'}">${have.has(g) ? '✓' : '✗'} ${l}</span>`).join('')}
    ${miss.length ? `<span class="small muted">${miss.map(([g]) => GROUP_TIP[g]).join(', ')}을 곁들이면 좋아요</span>` : '<span class="small good">균형 잡힌 끼니 👍</span>'}</div>`);
}
function groupPills(cur) {
  const box = h(`<div class="pills" style="flex-wrap:wrap">${GROUPS.map(([g, l]) => `<button type="button" class="pill ${cur.includes(g) ? 'on' : ''}" data-g="${g}">${l}</button>`).join('')}</div>`);
  box.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => { const g = b.dataset.g; const i = cur.indexOf(g); i >= 0 ? cur.splice(i, 1) : cur.push(g); b.classList.toggle('on'); }));
  return box;
}

function foodUseCount() {
  const cnt = {};
  for (const day of Object.values(db.meals)) for (const [k] of MEAL_SLOTS) for (const it of day[k] || []) cnt[it.foodId] = (cnt[it.foodId] || 0) + 1;
  return cnt;
}

function addFoodSheet(date, slot, label) {
  const cnt = foodUseCount();
  const sel = new Map(); // foodId -> qty
  const body = h(`<div>
    <label class="btn block" style="margin-bottom:10px">📷 음식 사진으로 칼로리 계산 (여러 장 가능)<input type="file" accept="image/*" class="photo" multiple hidden></label>
    <div class="row" style="margin-bottom:10px"><input type="text" placeholder="음식 검색 (예: 멸치볶음, 시금치나물)" class="q grow" enterkeyhint="search"></div>
    <button class="btn ghost block ask-ai" style="margin-bottom:10px" hidden></button>
    <div class="food-grid"></div>
    <div class="hr"></div>
    <div class="picked"></div>
    <details style="margin:10px 0"><summary class="small" style="cursor:pointer">목록에 없는 음식 직접 입력</summary>
      <div class="grid2" style="margin-top:8px">
        <label class="field"><span>이름</span><input type="text" class="nn"></label>
        <label class="field"><span>kcal</span><input type="number" inputmode="decimal" class="nk"></label>
        <label class="field"><span>양</span><input type="number" inputmode="decimal" class="na" value="1"></label>
        <label class="field"><span>단위</span><input type="text" class="nu" value="개"></label>
      </div>
      <label class="small row"><input type="checkbox" class="ns" checked> 자주 먹는 음식에 저장</label>
      <button class="btn sm" style="margin-top:8px" data-a="custom">추가</button>
    </details>
    <button class="btn primary block" data-a="ok">추가하기</button>
  </div>`);
  const grid = body.querySelector('.food-grid');
  const picked = body.querySelector('.picked');
  const okBtn = body.querySelector('[data-a=ok]');

  function drawGrid() {
    const q = body.querySelector('.q').value.trim();
    grid.innerHTML = '';
    const foods = db.foods
      .filter((f) => !q || f.name.includes(q))
      .sort((a, b) => (b.fav - a.fav) || ((cnt[b.id] || 0) - (cnt[a.id] || 0)) || a.name.localeCompare(b.name));
    foods.forEach((f) => {
      const b = h(`<button class="food-item ${sel.has(f.id) ? 'on' : ''}"><b>${f.fav ? '★ ' : ''}${esc(f.name)}</b><span>${nf(f.amount, 2)}${esc(f.unit)} · ${kc(f.kcal)}kcal</span></button>`);
      b.onclick = () => { sel.has(f.id) ? sel.delete(f.id) : sel.set(f.id, 1); drawGrid(); drawPicked(); };
      grid.appendChild(b);
    });
    if (!foods.length) grid.appendChild(h(`<div class="empty">목록에 없어요. 위 버튼을 누르면 Claude가 칼로리를 찾아줘요</div>`));
    const ai = body.querySelector('.ask-ai');
    ai.hidden = !q;
    ai.textContent = `🤖 '${q}' 칼로리 Claude에게 물어보기`;
  }
  function drawPicked() {
    picked.innerHTML = '';
    let total = 0;
    for (const [id, qty] of sel) {
      const f = db.foods.find((x) => x.id === id);
      total += f.kcal * qty;
      const row = h(`<div class="row between" style="margin-bottom:6px"><div class="grow"><b>${esc(f.name)}</b> <span class="small muted">${nf(f.amount * qty, 2)}${esc(f.unit)} · ${kc(f.kcal * qty)}kcal</span></div>
        <div class="stepper"><button>−</button><input type="number" inputmode="decimal" step="0.5" value="${qty}"><button>+</button></div></div>`);
      const [minus, plus] = row.querySelectorAll('.stepper button');
      const inp = row.querySelector('input');
      minus.onclick = () => { sel.set(id, Math.max(0.5, +(qty - 0.5).toFixed(2))); drawPicked(); };
      plus.onclick = () => { sel.set(id, +(qty + 0.5).toFixed(2)); drawPicked(); };
      inp.onchange = () => { const v = parseFloat(inp.value); if (v > 0) sel.set(id, v); drawPicked(); };
      picked.appendChild(row);
    }
    if (!sel.size) picked.appendChild(h(`<div class="small muted">음식을 선택하세요 (여러 개 선택 가능, 수량은 0.5 단위 조절)</div>`));
    okBtn.textContent = sel.size ? `${sel.size}개 추가 · ${kc(total)} kcal` : '추가하기';
  }
  body.querySelector('.q').oninput = drawGrid;
  const askAI = () => {
    const q = body.querySelector('.q').value.trim();
    if (!q) return;
    close();
    aiMealSheet(date, slot, label, { text: q });
  };
  body.querySelector('.ask-ai').onclick = askAI;
  body.querySelector('.q').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); askAI(); } };
  const close = sheet(`${label} 추가`, body);
  body.querySelector('.photo').onchange = async (e) => {
    const jpegs = await readImages(e.target.files);
    if (!jpegs.length) return toast('사진을 열 수 없어요');
    close();
    aiMealSheet(date, slot, label, { jpegs });
  };
  okBtn.onclick = () => {
    if (!sel.size) return;
    const arr = ensureDayMeals(date)[slot];
    for (const [id, qty] of sel) {
      const f = db.foods.find((x) => x.id === id);
      arr.push({ id: uid(), foodId: f.id, name: f.name, amount: f.amount, unit: f.unit, kcal: f.kcal, qty, groups: f.groups || [] });
    }
    save(); close(); rerender();
  };
  body.querySelector('[data-a=custom]').onclick = () => {
    const name = body.querySelector('.nn').value.trim();
    const kcal = parseFloat(body.querySelector('.nk').value);
    const amount = parseFloat(body.querySelector('.na').value) || 1;
    const unit = body.querySelector('.nu').value.trim() || '개';
    if (!name || !(kcal >= 0)) return toast('이름과 kcal를 입력해 주세요');
    let foodId = uid();
    if (body.querySelector('.ns').checked) db.foods.push({ id: foodId, name, amount, unit, kcal, fav: false });
    ensureDayMeals(date)[slot].push({ id: uid(), foodId, name, amount, unit, kcal, qty: 1 });
    save(); close(); rerender();
  };
  drawGrid(); drawPicked();
}

async function aiMealSheet(date, slot, label, { jpegs, text }) {
  const jpeg = jpegs?.length;
  const body = h(`<div>
    ${jpeg ? previews(jpegs) : `<p style="margin-top:0"><b>${esc(text)}</b></p>`}
    <div class="out"><p class="row small"><span class="spinner"></span><span>${jpeg ? 'Claude가 음식과 양을 보고 칼로리를 계산하는 중… (10~30초)' : 'Claude가 칼로리를 찾는 중… (5~20초)'}</span></p></div>
  </div>`);
  const close = sheet(`${label} · ${jpeg ? '사진으로 추가' : 'Claude에게 물어보기'}`, body);
  const out = body.querySelector('.out');
  const sample = jpeg ? await sampleImageReady() : await sampleReady();
  const apiKey = db.settings.apiKey;
  if (!sample && !apiKey) {
    out.innerHTML = `<p class="small up">${window.claude?.use ? 'Claude 사용을 허용해야 쓸 수 있어요. 페이지를 새로고침한 뒤 허용을 눌러 주세요.' : '이 기능은 claude.ai 링크로 열거나, 설정에 Claude API 키를 넣으면 쓸 수 있어요.'}</p>`;
    return;
  }
  let res;
  try {
    res = jpeg
      ? await analyzeFoodPhoto({ sample, apiKey, jpegs, foods: db.foods })
      : await analyzeFoodText({ sample, apiKey, text, foods: db.foods });
  } catch (err) {
    console.error(err);
    const code = err?.code;
    out.innerHTML = `<p class="small up">${code === 'not_granted' ? 'Claude 사용을 허용해야 쓸 수 있어요.'
      : code === 'rate_limited' ? '지금은 Claude 사용량이 많아요. 잠시 후 다시 올려 주세요.'
      : code === 'invalid_json' ? '음식을 제대로 알아보지 못했어요. 다시 해보거나 직접 입력해 주세요.'
      : err?.status === 401 ? 'API 키가 올바르지 않아요. 설정에서 확인해 주세요.'
      : '분석 실패: ' + esc(err?.message || err)}</p>`;
    return;
  }
  const rows = res.items.map((it) => ({ ...it, use: true, per: it.amount > 0 ? it.kcal / it.amount : it.kcal }));
  let eaten = 1;
  out.innerHTML = '';
  if (res.note) out.appendChild(h(`<p class="small muted" style="margin-top:0">${esc(res.note)}</p>`));
  if (!rows.length) { out.appendChild(h(`<p class="small up">음식을 찾지 못했어요. 다르게 적어 보거나 직접 입력해 주세요.</p>`)); return; }
  const list = h(`<div></div>`);
  const total = h(`<button class="btn primary block" style="margin-top:12px"></button>`);
  const saveLib = h(`<label class="small row" style="margin-top:10px"><input type="checkbox"> 새로 찾은 음식을 '자주 먹는 음식'에 저장</label>`);
  const sum = () => {
    const used = rows.filter((r) => r.use);
    total.textContent = used.length ? `${used.length}개 추가 · ${kc(used.reduce((a, r) => a + r.kcal, 0) * eaten)} kcal` : '추가할 음식을 선택하세요';
  };
  rows.forEach((r) => {
    const lib = r.foodId ? db.foods.find((f) => f.id === r.foodId) : null;
    const c = h(`<div class="card" style="box-shadow:none;border:1px solid var(--line);padding:12px;margin-bottom:8px">
      <div class="row" style="margin-bottom:8px"><input type="checkbox" class="use" checked style="width:20px;height:20px;flex:none">
        <input type="text" class="nm grow" value="${esc(r.name)}">${lib ? '<span class="tag" style="flex:none">★ 등록 음식</span>' : ''}</div>
      <div class="grid3">
        <label class="field" style="margin:0"><span>양</span><input type="number" inputmode="decimal" step="any" class="am" value="${r.amount}"></label>
        <label class="field" style="margin:0"><span>단위</span><input type="text" class="un" value="${esc(r.unit)}"></label>
        <label class="field" style="margin:0"><span>kcal</span><input type="number" inputmode="numeric" class="kc" value="${r.kcal}"></label>
      </div></div>`);
    const kcIn = c.querySelector('.kc');
    c.querySelector('.use').onchange = (e) => { r.use = e.target.checked; sum(); };
    c.querySelector('.nm').oninput = (e) => (r.name = e.target.value);
    c.querySelector('.un').oninput = (e) => (r.unit = e.target.value);
    c.querySelector('.am').oninput = (e) => { const v = parseFloat(e.target.value); if (v > 0) { r.amount = v; r.kcal = Math.round(r.per * v); kcIn.value = r.kcal; sum(); } };
    kcIn.oninput = () => { r.kcal = Math.max(0, Math.round(+kcIn.value || 0)); r.per = r.amount > 0 ? r.kcal / r.amount : r.kcal; sum(); };
    list.appendChild(c);
  });
  const eat = h(`<div class="field" style="margin-top:6px"><span>얼마나 먹었나요? (남겼다면 골라 주세요)</span></div>`);
  eat.appendChild(eatenSeg(1, (v) => { eaten = v; sum(); }));
  eat.appendChild(h(`<div class="small muted" style="margin-top:4px">음식마다 다르게 남겼다면, 추가한 뒤 그 음식을 눌러서 바꿀 수 있어요.</div>`));
  out.append(list, eat, saveLib, total);
  out.appendChild(h(`<p class="small muted">Claude가 추정한 값이라 실제와 다를 수 있어요. 양이나 kcal를 고친 뒤 추가하세요.</p>`));
  sum();
  total.onclick = () => {
    const used = rows.filter((r) => r.use && r.name.trim());
    if (!used.length) return;
    const store = saveLib.querySelector('input').checked;
    const arr = ensureDayMeals(date)[slot];
    for (const r of used) {
      let foodId = r.foodId || uid();
      if (!r.foodId && store) db.foods.push({ id: foodId, name: r.name.trim(), amount: r.amount, unit: r.unit || '인분', kcal: r.kcal, fav: false, groups: r.groups || [] });
      arr.push({ id: uid(), foodId, name: r.name.trim(), amount: r.amount, unit: r.unit || '인분', kcal: r.kcal, qty: 1, groups: r.groups || [], ...(eaten < 1 ? { eaten } : {}) });
    }
    save(); close(); rerender(); toast(`${label}에 ${used.length}개 추가했어요`);
  };
}

function editMealItem(date, slot, idx) {
  const it = ensureDayMeals(date)[slot][idx];
  const body = h(`<div>
    <p><b>${esc(it.name)}</b> <span class="muted small">(${nf(it.amount, 2)}${esc(it.unit)}당 ${kc(it.kcal)}kcal)</span></p>
    <label class="field"><span>수량 (배수)</span><input type="number" inputmode="decimal" step="0.5" value="${it.qty}"></label>
    <div class="field"><span>먹은 양 (남겼다면 골라 주세요)</span><div class="eat"></div></div>
    <p class="small muted kcal-now" style="margin-top:-4px"></p>
    <label class="field"><span>이동</span><select>${MEAL_SLOTS.map(([k, l]) => `<option value="${k}" ${k === slot ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button class="btn primary block">저장</button></div>`);
  let eaten = it.eaten ?? 1;
  const qIn = body.querySelector('input');
  const now = () => { const q = parseFloat(qIn.value) || it.qty; body.querySelector('.kcal-now').textContent = `→ ${kc(it.kcal * q * eaten)} kcal로 기록돼요`; };
  body.querySelector('.eat').appendChild(eatenSeg(eaten, (v) => { eaten = v; now(); }));
  qIn.oninput = now; now();
  const close = sheet('음식 수정', body);
  body.querySelector('.btn.primary').onclick = () => {
    const q = parseFloat(qIn.value);
    if (q > 0) it.qty = q;
    if (eaten >= 1) delete it.eaten; else it.eaten = eaten;
    const to = body.querySelector('select').value;
    if (to !== slot) { const m = ensureDayMeals(date); m[slot].splice(idx, 1); m[to].push(it); }
    save(); close(); rerender();
  };
}

function foodLibrarySheet() {
  const body = h(`<div><button class="btn primary block" data-a="new" style="margin-bottom:10px">+ 새 음식 등록</button><ul class="list"></ul></div>`);
  const ul = body.querySelector('ul');
  function draw() {
    ul.innerHTML = '';
    [...db.foods].sort((a, b) => (b.fav - a.fav) || a.name.localeCompare(b.name)).forEach((f) => {
      const li = h(`<li><button class="x" style="color:${f.fav ? '#f2a33a' : '#ccc'}" aria-label="즐겨찾기">★</button>
        <div class="name"><b>${esc(f.name)}</b><span class="sub">${nf(f.amount, 2)}${esc(f.unit)}${f.groups?.length ? ' · ' + f.groups.map((g) => GROUPS.find((x) => x[0] === g)[1]).join('·') : ''}</span></div><span class="kcal">${kc(f.kcal)} kcal</span>
        <button class="btn sm ghost">수정</button></li>`);
      li.querySelector('.x').onclick = () => { f.fav = !f.fav; save(); draw(); };
      li.querySelector('.btn').onclick = () => foodForm(f, draw);
      ul.appendChild(li);
    });
  }
  body.querySelector('[data-a=new]').onclick = () => foodForm(null, draw);
  draw();
  sheet('자주 먹는 음식', body, { onClose: rerender });
}

function foodForm(food, after) {
  const f = food || { name: '', amount: 1, unit: '개', kcal: '' };
  const body = h(`<div>
    <label class="field"><span>음식 이름</span><input type="text" class="n" value="${esc(f.name)}" placeholder="예: 닭가슴살 스테이크"></label>
    <div class="grid3">
      <label class="field"><span>기준량</span><input type="number" inputmode="decimal" class="a" value="${f.amount}"></label>
      <label class="field"><span>단위</span><input type="text" class="u" value="${esc(f.unit)}" list="units"></label>
      <label class="field"><span>kcal</span><input type="number" inputmode="decimal" class="k" value="${f.kcal}"></label>
    </div>
    <div class="field"><span>영양 분류 (끼니 균형 체크용)</span><div class="grp"></div></div>
    <datalist id="units"><option>g</option><option>개</option><option>공기</option><option>잔</option><option>ml</option><option>스쿱</option><option>접시</option><option>팩</option><option>봉</option></datalist>
    <p class="small muted" style="margin-top:0">예) 기준량 100, 단위 g, 109kcal → 식단에서 1.5 입력 시 150g · 164kcal</p>
    <div class="row"><button class="btn primary grow" data-a="s">저장</button>${food ? '<button class="btn danger" data-a="d">삭제</button>' : ''}</div></div>`);
  const groups = [...(f.groups || [])];
  body.querySelector('.grp').appendChild(groupPills(groups));
  const close = sheet(food ? '음식 수정' : '새 음식', body);
  body.querySelector('[data-a=s]').onclick = () => {
    const name = body.querySelector('.n').value.trim();
    const kcal = parseFloat(body.querySelector('.k').value);
    if (!name || !(kcal >= 0)) return toast('이름과 kcal를 입력해 주세요');
    const rec = { name, amount: parseFloat(body.querySelector('.a').value) || 1, unit: body.querySelector('.u').value.trim() || '개', kcal, groups: [...groups] };
    if (food) Object.assign(food, rec); else db.foods.push({ id: uid(), fav: false, ...rec });
    save(); close(); after();
  };
  const del = body.querySelector('[data-a=d]');
  if (del) del.onclick = () => { ask(`'${food.name}'을(를) 목록에서 삭제할까요? (지난 식단 기록은 유지돼요)`).then((ok) => { if (ok) { db.foods = db.foods.filter((x) => x !== food); save(); close(); after(); } }); };
}

/* ================= 운동 ================= */
const SWIM_STROKES = ['자유형', '배영', '평영', '접영', '혼합', '킥판'];
const PARTS = ['가슴', '등', '하체', '어깨', '팔', '복근', '전신'];
const CARDIO = { 러닝: 9, 걷기: 3.8, 실내자전거: 6.8, 천국의계단: 8.8, 일립티컬: 5, 줄넘기: 11, 등산: 6.5, 기타: 5 };
const LIFTS = ['스쿼트', '데드리프트', '루마니안 데드리프트', '벤치프레스', '랫풀다운', '시티드 로우', '바벨 로우', '레그프레스', '레그 익스텐션', '레그 컬', '숄더프레스', '사이드 레터럴 레이즈', '힙 쓰러스트', '런지', '케이블 크런치', '덤벨 컬', '트라이셉스 푸시다운', '풀업', '플랭크'];
const INTENSITY = [['low', '가볍게', 0.8], ['mid', '보통', 1], ['high', '힘들게', 1.2]];

function metOf(w) {
  const f = (INTENSITY.find((x) => x[0] === w.intensity) || INTENSITY[1])[2];
  const base = w.type === 'swim' ? 8 : w.type === 'weight' || w.type === 'pt' ? 5 : w.type === 'cardio' ? CARDIO[w.kind] || 5 : 5;
  return base * f;
}
const estimateKcal = (w) => Math.round(metOf(w) * (latestWeight() || 60) * ((+w.duration || 0) / 60));

function workoutDetail(w) {
  const p = [];
  if (w.duration) p.push(`${w.duration}분`);
  if (w.type === 'swim') { if (w.strokes?.length) p.push(w.strokes.join('·')); if (w.distance) p.push(`${w.distance}m`); }
  if (w.type === 'cardio') { if (w.kind) p.push(w.kind); if (w.distance) p.push(`${w.distance}km`); }
  if (w.type === 'pt' && w.ptNo) p.push(`${w.ptNo}회차`);
  if (w.type === 'weight' || w.type === 'pt') {
    if (w.parts?.length) p.push(w.parts.join('·'));
    const sets = (w.sets || []).filter((s) => s.name);
    if (sets.length) {
      const vol = sets.reduce((a, s) => a + setVolume(s), 0);
      p.push(`${sets.length}종목`);
      if (vol) p.push(`볼륨 ${kc(vol)}kg`);
    }
  }
  if (w.type === 'etc' && w.title) p.push(w.title);
  if (w.avgHr) p.push(`♥${w.avgHr}`);
  return p.join(' · ');
}

function workoutList(ws, editable = true) {
  const ul = h(`<ul class="list"></ul>`);
  ws.forEach((w) => {
    const sets = w.type === 'weight' || w.type === 'pt' ? (w.sets || []).filter((s) => s.name).map((s) => `${esc(s.name)} ${esc(setText(s))}`).join('<br>') : '';
    const li = h(`<li style="align-items:flex-start"><span class="tag ${w.type}">${TYPE[w.type].icon} ${TYPE[w.type].label}</span>
      <div class="name"><b>${esc(workoutDetail(w)) || '-'}</b>${sets ? `<span class="sub">${sets}</span>` : ''}${w.memo ? `<span class="sub">📝 ${esc(w.memo)}</span>` : ''}</div>
      <span class="kcal">${kc(w.kcal || 0)}<span class="small muted"> kcal</span></span></li>`);
    if (editable) li.onclick = () => workoutForm(w);
    ul.appendChild(li);
  });
  return ul;
}

function renderWorkout() {
  $view.appendChild(dateNav(rerender));
  const ws = workoutsOf(ui.date);
  const card = h(`<div class="card"><h2>운동 기록 <small>${ws.length ? `${kc(burnedOf(ui.date))} kcal 소모` : ''}</small></h2></div>`);
  card.appendChild(ws.length ? workoutList(ws) : h(`<div class="empty">이 날 운동 기록이 없어요</div>`));
  const watch = h(`<label class="btn block" style="margin-top:12px">⌚ 애플워치 캡처로 추가 (여러 장 가능)<input type="file" accept="image/*" multiple hidden></label>`);
  watch.querySelector('input').onchange = async (e) => {
    const jpegs = await readImages(e.target.files);
    e.target.value = '';
    if (!jpegs.length) return toast('사진을 열 수 없어요');
    watchSheet(jpegs);
  };
  card.appendChild(watch);
  const btns = h(`<div class="grid3" style="margin-top:8px"></div>`);
  ['swim', 'weight', 'cardio'].forEach((t) => {
    const b = h(`<button class="btn">${TYPE[t].icon} ${TYPE[t].label}</button>`);
    b.onclick = () => workoutForm(null, t);
    btns.appendChild(b);
  });
  card.appendChild(btns);
  const etc = h(`<div class="grid2" style="margin-top:8px"><button class="btn">🧑‍🏫 PT 수업</button><button class="btn ghost">✨ 기타 운동</button></div>`);
  const [ptB, etcB] = etc.querySelectorAll('button');
  ptB.onclick = () => workoutForm(null, 'pt');
  etcB.onclick = () => workoutForm(null, 'etc');
  card.appendChild(etc);
  const pst = ptStatus();
  if (pst || bookings().length) {
    const row = h(`<div class="today-plan" style="margin:10px 0 0"><span>🧑‍🏫 ${pst?.html || 'PT 예약'}</span><button class="btn sm">+ 예약</button></div>`);
    row.querySelector('button').onclick = () => ptBookSheet();
    card.appendChild(row);
  }
  $view.appendChild(card);

  $view.appendChild(planCard());

  // 이번 주 요약
  const wk = weekStart(ui.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  const all = days.flatMap(workoutsOf);
  const by = (t) => all.filter((w) => w.type === t);
  const sum = (arr, k) => arr.reduce((a, w) => a + (+w[k] || 0), 0);
  $view.appendChild(h(`<div class="card"><h2>이번 주 운동 <small>${fmtShort(days[0])} ~ ${fmtShort(days[6])}</small></h2>
    <div class="grid3">
      <div class="stat"><div class="k">🏊 수영</div><div class="v">${by('swim').length}<small>회</small></div><div class="d muted">${kc(sum(by('swim'), 'distance'))}m</div></div>
      <div class="stat"><div class="k">🏋️ 웨이트</div><div class="v">${by('weight').length}<small>회</small></div><div class="d muted">${kc(sum(by('weight'), 'duration'))}분</div></div>
      <div class="stat"><div class="k">🏃 유산소</div><div class="v">${by('cardio').length}<small>회</small></div><div class="d muted">${nf(sum(by('cardio'), 'distance'))}km</div></div>
    </div>
    <div class="row between small" style="margin-top:10px"><span>총 ${kc(sum(all, 'duration'))}분 · ${new Set(all.map((w) => w.date)).size}일 운동</span><b>${kc(sum(all, 'kcal'))} kcal</b></div>
    <div class="row" style="gap:4px;margin-top:10px">${days.map((d) => { const n = workoutsOf(d); return `<div class="grow" style="text-align:center"><div class="small muted">${DOW[parseISO(d).getDay()]}</div><div style="height:26px;line-height:26px;border-radius:8px;background:${n.length ? '#2f3640' : '#f4f5f7'};color:#fff;font-size:12px">${n.map((w) => TYPE[w.type].icon).join('')}</div></div>`; }).join('')}</div>
  </div>`));
  renderWorkoutAnalysis();
}

function renderWorkoutAnalysis() {
  const weeks = weeklyStats(ui.woRange);
  const card = h(`<div class="card analysis"><h2>운동 분석 <span class="pills">${[[4, '4주'], [12, '12주']].map(([v, l]) => `<button class="pill ${ui.woRange === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</span></h2></div>`);
  card.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { ui.woRange = +b.dataset.v; rerender(); }));
  comments(weeks).forEach((p) => card.appendChild(h(`<div class="pt"><span class="dot" style="background:${p.color}"></span><div>${p.html}</div></div>`)));

  card.appendChild(h(`<h3 style="margin-top:14px">주별 운동 시간</h3>`));
  card.appendChild(barChart(weeks.map((w) => ({ x: w.label, a: w.minutes, b: 0 })), { target: 150, overColor: '#3bb98a', targetLabel: '권장 150분', unit: '분' }));
  card.appendChild(h(`<div class="legend"><span><i style="background:#2f3640"></i>운동 시간</span><span><i style="background:#3bb98a"></i>권장량 달성</span><span>주 시작(월요일) 날짜 기준</span></div>`));

  const tot = (k) => weeks.reduce((a, w) => a + w[k], 0);
  card.appendChild(h(`<div class="grid2" style="margin-top:12px">
    <div class="stat"><div class="k">🏊 수영</div><div class="v">${tot('swim')}<small>회 · ${kc(tot('swimM'))}m</small></div></div>
    <div class="stat"><div class="k">🏋️ 웨이트</div><div class="v">${tot('weight')}<small>회</small></div></div>
    <div class="stat"><div class="k">🏃 유산소</div><div class="v">${tot('cardio')}<small>회 · ${nf(tot('cardioKm'))}km</small></div></div>
    <div class="stat"><div class="k">총 소모</div><div class="v">${kc(tot('kcal'))}<small>kcal</small></div></div>
  </div>`));

  const paces = swimPaces(weeks[0].start);
  if (paces.length >= 2) {
    card.appendChild(h(`<h3 style="margin-top:14px">수영 100m 페이스 <small class="muted">(분, 낮을수록 빠름)</small></h3>`));
    card.appendChild(lineChart(paces.map((p) => ({ x: fmtShort(p.date), value: p.pace, tip: p.date.slice(2).replace(/-/g, '.') })), { unit: '분', decimals: 2, colorFor: () => '#4a7bf7' }));
  }
  const hrs = weeks.flatMap((w) => w.ws).filter((w) => w.avgHr).sort((a, b) => a.date.localeCompare(b.date));
  if (hrs.length >= 2) {
    card.appendChild(h(`<h3 style="margin-top:14px">운동 평균 심박수 <small class="muted">(bpm)</small></h3>`));
    card.appendChild(lineChart(hrs.slice(-10).map((w) => ({ x: fmtShort(w.date), value: w.avgHr, tip: `${w.date.slice(2).replace(/-/g, '.')} ${TYPE[w.type].label}` })), { unit: 'bpm', decimals: 0, colorFor: () => '#f0506e' }));
  }
  $view.appendChild(card);

  // Claude 코치
  const coach = h(`<div class="card"><h2>🤖 Claude 코치</h2>
    <p class="small muted" style="margin-top:0">최근 4주 운동·식단·인바디 기록을 보고 잘한 점, 아쉬운 점, 다음 주 운동 계획을 알려줘요.</p>
    <div class="coach-out" style="white-space:pre-wrap;line-height:1.6"></div>
    <button class="btn primary block" style="margin-top:10px">${ui.coach ? '다시 분석 받기' : '분석 받기'}</button></div>`);
  const outEl = coach.querySelector('.coach-out');
  outEl.textContent = ui.coach;
  const btn = coach.querySelector('button');
  btn.onclick = async () => {
    const sample = await sampleReady();
    const apiKey = db.settings.apiKey;
    if (!sample && !apiKey) {
      outEl.textContent = window.claude?.use ? 'Claude 사용을 허용해야 분석을 받을 수 있어요. 페이지를 새로고침한 뒤 허용을 눌러 주세요.' : '이 기능은 claude.ai 링크로 열거나, 설정에 Claude API 키를 넣으면 쓸 수 있어요.';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 분석 중…';
    outEl.textContent = '';
    try {
      const text = sample
        ? (await sample(coachPrompt(), { modelTier: 'default', cache: false, onText: ({ text }) => { outEl.textContent = text; } })).text
        : await claudeText(apiKey, coachPrompt());
      ui.coach = text;
      outEl.textContent = text;
    } catch (err) {
      console.error(err);
      outEl.textContent = err?.code === 'rate_limited' ? '지금은 Claude 사용량이 많아요. 잠시 후 다시 눌러 주세요.'
        : err?.code === 'not_granted' ? 'Claude 사용을 허용해야 분석을 받을 수 있어요.'
        : `분석하지 못했어요: ${err?.message || err}`;
    }
    btn.disabled = false;
    btn.textContent = '다시 분석 받기';
  };
  $view.appendChild(coach);
}

const curPlan = () => (db.plan && db.plan.week === weekStart(today()) ? db.plan : null);
const PLAN_ICON = { weight: '🏋️', pt: '🧑‍🏫', swim: '🏊', cardio: '🏃', etc: '✨', rest: '😴' };

/* ---------- PT ---------- */
const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
const ptCount = (excludeId) => db.workouts.filter((w) => w.type === 'pt' && w.id !== excludeId).length;
const nextPtNo = () => (+db.settings.pt?.done0 || 0) + ptCount() + 1;
function ptStatus() {
  const pt = db.settings.pt || {};
  if (!pt.total && !(pt.days || []).length && !(pt.bookings || []).length && !ptCount()) return null;
  const used = (+pt.done0 || 0) + ptCount();
  const remain = pt.total ? pt.total - used : null;
  const n = nextPt();
  const next = n ? `${n.date === today() ? '오늘' : fmtShort(n.date) + '(' + dowOf(n.date) + ')'}${n.time ? ' ' + n.time : ''}` : '';
  const remainText = pt.total ? `${used}/${pt.total}회 · <b>${Math.max(0, remain)}회 남음</b>` : `${used}회 받음`;
  return { remainText, next, html: `PT ${remainText}${next ? ` · 다음 PT <b>${next}</b>` : ' · <span class="muted">다음 예약 없음</span>'}${remain != null && remain <= 3 ? ' <span class="up">· 곧 끝나요</span>' : ''}` };
}
const planDone = (d) => d.type !== 'rest' && workoutsOf(d.date).some((w) => w.type === d.type || (d.type === 'etc'));

/** PT 예약 넣기·보기 */
function ptBookSheet(preDate) {
  pruneBookings();
  const pt = db.settings.pt;
  let date = preDate || addDays(today(), 1);
  const body = h(`<div>
    <div class="field"><span>날짜</span><div class="pills days" style="flex-wrap:wrap"></div>
      <input type="date" class="bd" style="margin-top:8px" value="${date}"></div>
    <label class="field"><span>시간</span><input type="time" class="bt" value="${esc(pt.time || '')}"></label>
    <button class="btn primary block add">예약 추가</button>
    <div class="hr"></div>
    <h3>예약된 PT</h3><ul class="list bl"></ul></div>`);
  const close = sheet('📅 PT 예약', body, { onClose: rerender });
  const dIn = body.querySelector('.bd');
  const pills = body.querySelector('.days');
  const drawPills = () => {
    pills.innerHTML = '';
    for (let i = 0; i < 14; i++) {
      const d = addDays(today(), i);
      const b = h(`<button type="button" class="pill ${d === date ? 'on' : ''}">${i === 0 ? '오늘' : i === 1 ? '내일' : parseISO(d).getDate() + '일'}(${dowOf(d)})${bookingOn(d) ? ' ✓' : ''}</button>`);
      b.onclick = () => { date = d; dIn.value = d; drawPills(); };
      pills.appendChild(b);
    }
  };
  dIn.onchange = () => { if (dIn.value) { date = dIn.value; drawPills(); } };
  const ul = body.querySelector('.bl');
  const drawList = () => {
    ul.innerHTML = '';
    const up = bookings().filter((b) => b.date >= today());
    if (!up.length) ul.appendChild(h(`<li class="muted small">예약이 없어요</li>`));
    for (const b of up) {
      const li = h(`<li><div class="name"><b>${b.date === today() ? '오늘' : fmtShort(b.date)} (${dowOf(b.date)})</b><span class="sub">${b.time || '시간 미정'}${ptDone(b.date) ? ' · 기록 완료' : ''}</span></div><button class="x" aria-label="예약 취소">×</button></li>`);
      li.querySelector('.x').onclick = () => { removeBooking(b.date); save(); drawList(); drawPills(); toast('예약을 취소했어요'); };
      ul.appendChild(li);
    }
  };
  body.querySelector('.add').onclick = () => {
    if (!date) return;
    addBooking(date, body.querySelector('.bt').value);
    save(); drawList(); drawPills();
    toast(`${fmtShort(date)}(${dowOf(date)}) PT 예약을 넣었어요`);
  };
  drawPills(); drawList();
  return close;
}

function ptCard() {
  const pt = (db.settings.pt ||= { total: null, done0: 0, days: [], time: '' });
  pt.days ||= [];
  const card = h(`<div class="card"><h2>PT 수업</h2>
    <p class="small muted" style="margin-top:0">수업 날짜를 예약해 두면 다음 PT와 남은 횟수를 보여주고, 루틴 추천에서 그날은 PT로 고정해요.</p>
    <div class="grid2">
      <label class="field"><span>등록한 총 횟수</span><input type="number" inputmode="numeric" class="tot" placeholder="예: 20" value="${pt.total ?? ''}"></label>
      <label class="field"><span>앱 쓰기 전 받은 횟수</span><input type="number" inputmode="numeric" class="d0" value="${pt.done0 || ''}" placeholder="0"></label>
    </div>
    <button class="btn primary block bk" style="margin-bottom:12px">📅 PT 예약 날짜 넣기 / 보기</button>
    <details class="eq-box" style="margin-bottom:12px"><summary class="small">매주 같은 요일에 하면 (선택)</summary>
      <div class="pills" style="flex-wrap:wrap;margin-top:10px">${['월', '화', '수', '목', '금', '토', '일'].map((d) => `<button type="button" class="pill ${pt.days.includes(d) ? 'on' : ''}" data-d="${d}">${d}</button>`).join('')}</div>
      <label class="field" style="margin:10px 0 0"><span>기본 시간</span><input type="time" class="tm" value="${esc(pt.time || '')}"></label>
    </details>
    <p class="small st" style="margin:0"></p></div>`);
  card.querySelector('.bk').onclick = () => ptBookSheet();
  const st = card.querySelector('.st');
  const show = () => { const s = ptStatus(); st.innerHTML = s ? '🧑‍🏫 ' + s.html : ''; };
  card.querySelector('.tot').onchange = (e) => { pt.total = +e.target.value || null; save(); show(); };
  card.querySelector('.d0').onchange = (e) => { pt.done0 = +e.target.value || 0; save(); show(); };
  card.querySelector('.tm').onchange = (e) => { pt.time = e.target.value; save(); show(); };
  card.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { const i = pt.days.indexOf(b.dataset.d); i >= 0 ? pt.days.splice(i, 1) : pt.days.push(b.dataset.d); b.classList.toggle('on'); save(); show(); }));
  show();
  return card;
}

/** 내 무분할 루틴 고치기 */
function routineCard() {
  const s = db.settings;
  const equip = s.equipment || [];
  const cur = myRoutine(s);
  const card = h(`<div class="card"><h2>내 무분할 루틴</h2>
    <p class="small muted" style="margin-top:0">부위마다 한 종목씩, 하루에 모두 해요. 웨이트 기록의 '내 무분할 루틴 불러오기'와 루틴 추천에 이 종목이 쓰여요.${equip.length ? '' : ' 헬스장 기구를 등록하면 할 수 있는 종목만 보여요.'}</p>
    <div class="grid2" style="margin-bottom:12px"><button class="btn sm mach">🏋️ 머신 위주로</button><button class="btn sm free">🏋️‍♀️ 프리웨이트 기본</button></div>
    <div class="rt"></div></div>`);
  const rt = card.querySelector('.rt');
  ROUTINE.forEach((r, i) => {
    const opts = optionsFor(r, equip);
    const val = cur.find((x) => x.part === r.part)?.name || opts[0] || r.name;
    if (!opts.includes(val)) opts.unshift(val);
    const row = h(`<label class="rt-row"><span>${r.part}</span><select>${opts.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`);
    row.querySelector('select').onchange = (e) => {
      const next = ROUTINE.map((x) => ({ part: x.part, name: cur.find((c) => c.part === x.part)?.name || x.name }));
      next[i].name = e.target.value;
      s.myRoutine = next;
      save(); toast(`${r.part}: ${e.target.value}로 바꿨어요`);
      cur.splice(0, cur.length, ...next);
    };
    rt.appendChild(row);
  });
  card.querySelector('.mach').onclick = () => { s.myRoutine = machineRoutine(equip); save(); rerender(); toast('머신 위주로 바꿨어요'); };
  card.querySelector('.free').onclick = () => { s.myRoutine = freeRoutine(equip); save(); rerender(); toast('프리웨이트 기본으로 바꿨어요'); };
  return card;
}

/** 헬스장 기구 고르기 (설정·루틴 추천에서 같이 씀) */
function equipSection(onChange) {
  const box = h(`<div class="equip"></div>`);
  const list = () => (db.settings.equipment ||= []);
  const changed = () => { save(); draw(); onChange?.(); };
  function draw() {
    box.innerHTML = '';
    const missing = MY_GYM.filter((x) => !list().includes(x));
    if (missing.length) {
      const pre = h(`<button type="button" class="btn block" style="margin-bottom:12px">📍 보내준 헬스장 사진 기준으로 한 번에 선택 (${MY_GYM.length}개)</button>`);
      pre.onclick = () => { list().push(...missing); changed(); toast(`기구 ${missing.length}개를 선택했어요. 다른 게 있으면 더 눌러 주세요`); };
      box.appendChild(pre);
    }
    for (const [group, items] of EQUIPMENT) {
      const row = h(`<div class="field" style="margin-bottom:10px"><span>${group}</span><div class="pills" style="flex-wrap:wrap"></div></div>`);
      const pills = row.querySelector('.pills');
      for (const it of items) {
        const b = h(`<button type="button" class="pill ${list().includes(it) ? 'on' : ''}">${esc(it)}</button>`);
        b.onclick = () => { const l = list(); const i = l.indexOf(it); i >= 0 ? l.splice(i, 1) : l.push(it); changed(); };
        pills.appendChild(b);
      }
      box.appendChild(row);
    }
    const others = list().filter((x) => !ALL_EQUIP.includes(x));
    const extra = h(`<div class="field" style="margin-bottom:10px"><span>직접 추가한 기구</span><div class="pills" style="flex-wrap:wrap"></div>
      <div class="row" style="margin-top:8px"><input type="text" class="grow eqin" placeholder="예: 어시스트 풀업 머신"><button type="button" class="btn sm">추가</button></div></div>`);
    others.forEach((x) => {
      const b = h(`<button type="button" class="pill on">${esc(x)} ✕</button>`);
      b.onclick = () => { db.settings.equipment = list().filter((y) => y !== x); changed(); };
      extra.querySelector('.pills').appendChild(b);
    });
    const addOne = () => { const v = extra.querySelector('.eqin').value.trim(); if (v && !list().includes(v)) { list().push(v.slice(0, 20)); changed(); } };
    extra.querySelector('.btn').onclick = addOne;
    extra.querySelector('.eqin').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addOne(); } };
    box.appendChild(extra);
    const photo = h(`<label class="btn block">📷 헬스장 사진으로 기구 찾기 (여러 장 가능)<input type="file" accept="image/*" multiple hidden></label>`);
    const msg = h(`<div class="small" style="margin-top:6px"></div>`);
    photo.querySelector('input').onchange = async (e) => {
      const jpegs = await readImages(e.target.files);
      e.target.value = '';
      if (!jpegs.length) return;
      const sample = await sampleImageReady();
      const apiKey = db.settings.apiKey;
      if (!sample && !apiKey) { msg.textContent = 'Claude를 쓸 수 있을 때만 사진으로 찾을 수 있어요. 목록에서 골라 주세요.'; return; }
      msg.innerHTML = '<span class="spinner"></span> Claude가 기구를 찾는 중…';
      try {
        const res = await identifyEquipment({ sample, apiKey, jpegs });
        const l = list();
        const added = [...res.known, ...res.other].filter((x) => !l.includes(x));
        l.push(...added);
        changed();
        toast(added.length ? `기구 ${added.length}개를 추가했어요: ${added.join(', ')}` : '새로 찾은 기구가 없어요');
      } catch (err) {
        console.error(err);
        msg.textContent = err?.code === 'rate_limited' ? '지금은 Claude 사용량이 많아요. 잠시 후 다시 해 주세요.' : '기구를 찾지 못했어요. 목록에서 골라 주세요.';
      }
    };
    box.append(photo, msg);
  }
  draw();
  return box;
}

function planCard() {
  const plan = curPlan();
  const card = h(`<div class="card"><h2>이번 주 추천 루틴 ${plan ? '<button class="btn sm ghost re">다시 받기</button>' : ''}</h2></div>`);
  if (!plan) {
    card.appendChild(h(`<p class="small muted" style="margin-top:0">운동할 수 있는 요일과 시간을 고르면, 최근 기록과 인바디를 보고 이번 주 요일별 루틴을 짜 드려요.${db.plan ? ' (지난주 루틴은 끝났어요)' : ''}</p>`));
    const b = h(`<button class="btn primary block">📅 이번 주 루틴 추천 받기</button>`);
    b.onclick = planPrefsSheet;
    card.appendChild(b);
    return card;
  }
  card.querySelector('.re').onclick = planPrefsSheet;
  if (plan.summary) card.appendChild(h(`<p class="small" style="margin-top:0">${esc(plan.summary)}</p>`));
  const list = h(`<div class="plan"></div>`);
  for (const d of plan.days) {
    const isToday = d.date === today();
    const done = planDone(d);
    const meta = [d.duration ? `${d.duration}분` : '', d.type === 'swim' && d.distance ? `${d.distance}m` : '', d.type === 'cardio' ? [d.kind, d.distance ? d.distance + 'km' : ''].filter(Boolean).join(' ') : ''].filter(Boolean).join(' · ');
    const row = h(`<details class="plan-day ${isToday ? 'today' : ''} ${d.type}" ${isToday ? 'open' : ''}>
      <summary><span class="pd-dow">${d.dow}<small>${fmtShort(d.date)}</small></span>
        <span class="pd-title">${PLAN_ICON[d.type] || ''} ${esc(d.title)}${meta ? `<small>${esc(meta)}</small>` : ''}</span>
        ${d.type !== 'pt' && ptPlanOn(d.date) && !ptDone(d.date) ? '<span class="chip pt-chip">PT 예약</span>' : ''}${done ? '<span class="chip ok">✓ 완료</span>' : isToday && d.type !== 'rest' ? '<span class="chip today-chip">오늘</span>' : ''}</summary>
      ${d.items.length ? `<ul class="pd-items">${d.items.map((x) => `<li><b>${esc(x.name)}</b> <span>${esc(x.detail)}</span></li>`).join('')}</ul>` : ''}
    </details>`);
    if (d.type !== 'rest') {
      const go = h(`<button class="btn sm ${isToday ? 'primary' : ''}" style="margin:4px 0 6px">이 운동 기록하기</button>`);
      go.onclick = () => workoutForm(null, d.type, presetFrom(d));
      row.appendChild(go);
    }
    list.appendChild(row);
  }
  card.appendChild(list);
  if (plan.tips?.length) card.appendChild(h(`<div class="small" style="margin-top:10px">${plan.tips.map((t) => `<div>💡 ${esc(t)}</div>`).join('')}</div>`));
  if (plan.source === 'template') card.appendChild(h(`<p class="small muted">기본 루틴이에요. Claude를 쓸 수 있으면 내 기록에 맞춘 루틴을 받아요.</p>`));
  return card;
}

async function planPrefsSheet() {
  const prefs = structuredClone({ ...defaultPrefs(), ...(db.settings.planPrefs || {}) });
  const body = h(`<div>
    <div class="field"><span>운동할 수 있는 요일</span><div class="pills dows" style="flex-wrap:wrap">${DOWS.map((d) => `<button type="button" class="pill ${prefs.days.includes(d) ? 'on' : ''}" data-d="${d}">${d}</button>`).join('')}</div></div>
    <div class="field"><span>1회 운동 시간</span><div class="seg mins">${[30, 45, 60, 90].map((m) => `<button type="button" data-m="${m}" class="${prefs.minutes === m ? 'on' : ''}">${m}분</button>`).join('')}</div></div>
    <div class="field"><span>넣을 운동</span><div class="pills acts" style="flex-wrap:wrap">${ACTS.map(([k, l]) => `<button type="button" class="pill ${prefs.acts.includes(k) ? 'on' : ''}" data-a="${k}">${l}</button>`).join('')}</div></div>
    <details class="field eq-box"><summary class="eq-sum"></summary><div class="eq"></div></details>
    <label class="field"><span>요청사항 (선택)</span><input type="text" class="note" placeholder="예: 무릎이 안 좋아요, 수영은 주 2회만" value="${esc(prefs.note)}"></label>
    <div class="out"></div>
    <button class="btn primary block go">추천 받기</button></div>`);
  const close = sheet('📅 루틴 추천 조건', body);
  const eqSum = () => { const n = (db.settings.equipment || []).length; body.querySelector('.eq-sum').innerHTML = `🏋️ 헬스장 기구 <b>${n ? n + '개 등록됨' : '등록 안 함'}</b> <span class="small muted">· 눌러서 ${n ? '수정' : '등록'}</span>`; };
  eqSum();
  body.querySelector('.eq').appendChild(equipSection(eqSum));
  const tog = (arr, x) => { const i = arr.indexOf(x); i >= 0 ? arr.splice(i, 1) : arr.push(x); };
  body.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { tog(prefs.days, b.dataset.d); b.classList.toggle('on'); }));
  body.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { tog(prefs.acts, b.dataset.a); b.classList.toggle('on'); }));
  body.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { prefs.minutes = +b.dataset.m; body.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); }));
  const sample = await sampleReady();
  const apiKey = db.settings.apiKey;
  const goBtn = body.querySelector('.go');
  goBtn.textContent = sample || apiKey ? '🤖 Claude에게 추천 받기' : '기본 루틴 만들기';
  goBtn.onclick = async () => {
    prefs.days.sort((a, b) => DOWS.indexOf(a) - DOWS.indexOf(b));
    prefs.note = body.querySelector('.note').value.trim();
    if (!prefs.days.length || !prefs.acts.length) return toast('요일과 운동을 하나 이상 골라 주세요');
    const out = body.querySelector('.out');
    let plan;
    if (sample || apiKey) {
      goBtn.disabled = true;
      goBtn.innerHTML = '<span class="spinner"></span> 루틴 짜는 중… (10~30초)';
      try {
        plan = await generatePlan({ sample, apiKey, prefs });
      } catch (err) {
        console.error(err);
        out.innerHTML = `<p class="small up">${err?.code === 'rate_limited' ? '지금은 Claude 사용량이 많아요. 잠시 후 다시 눌러 주세요.' : err?.code === 'not_granted' ? 'Claude 사용을 허용해야 추천을 받을 수 있어요.' : '추천을 받지 못했어요. 다시 눌러 주세요.'}</p>`;
        goBtn.disabled = false; goBtn.textContent = '🤖 다시 시도';
        return;
      }
    } else plan = templatePlan(prefs);
    db.settings.planPrefs = prefs;
    db.plan = plan;
    save(); close(); rerender(); toast('이번 주 루틴을 만들었어요');
  };
}

async function watchSheet(jpegs) {
  const body = h(`<div>${previews(jpegs)}
    <div class="out"><p class="row small"><span class="spinner"></span><span>Claude가 애플워치 기록을 읽는 중… (10~30초)</span></p></div></div>`);
  const close = sheet('⌚ 애플워치 캡처', body);
  const out = body.querySelector('.out');
  const sample = await sampleImageReady();
  const apiKey = db.settings.apiKey;
  if (!sample && !apiKey) {
    out.innerHTML = `<p class="small up">${window.claude?.use ? 'Claude 사용을 허용해야 캡처를 읽을 수 있어요. 페이지를 새로고침한 뒤 허용을 눌러 주세요.' : '캡처 읽기는 claude.ai 링크로 열거나, 설정에 Claude API 키를 넣으면 쓸 수 있어요.'}</p>`;
    return;
  }
  let res;
  try {
    res = await analyzeWatch({ sample, apiKey, jpegs });
  } catch (err) {
    console.error(err);
    const code = err?.code;
    out.innerHTML = `<p class="small up">${code === 'not_granted' ? 'Claude 사용을 허용해야 캡처를 읽을 수 있어요.'
      : code === 'rate_limited' ? '지금은 Claude 사용량이 많아요. 잠시 후 다시 올려 주세요.'
      : code === 'invalid_json' ? '캡처를 제대로 읽지 못했어요. 다시 올리거나 직접 입력해 주세요.'
      : err?.status === 401 ? 'API 키가 올바르지 않아요. 설정에서 확인해 주세요.'
      : '분석 실패: ' + esc(err?.message || err)}</p>`;
    return;
  }
  const toPreset = (x) => {
    const p = { date: x.date || ui.date, strokes: x.strokes, distance: x.distance, avgHr: x.avgHr, source: 'watch' };
    if (x.duration != null) p.duration = x.duration;
    if (x.kcal != null) { p.kcal = x.kcal; p.kcalManual = true; }
    if (x.type === 'cardio') p.kind = x.kind;
    if (x.type === 'etc') p.title = x.title;
    if (x.title) p.memo = `애플워치: ${x.title}`;
    return p;
  };
  if (!res.workouts.length) {
    out.innerHTML = `<p class="small up">운동 기록을 찾지 못했어요. ${esc(res.note)}</p>`;
    return;
  }
  if (res.workouts.length === 1) {
    // 하나면 바로 입력 화면으로 (확인 후 저장)
    const x = res.workouts[0];
    close();
    workoutForm(null, x.type, toPreset(x));
    return;
  }
  // 여러 개면 골라서 한 번에 추가
  const picks = res.workouts.map(() => true);
  out.innerHTML = '';
  if (res.note) out.appendChild(h(`<p class="small muted" style="margin-top:0">${esc(res.note)}</p>`));
  const ul = h(`<ul class="list"></ul>`);
  res.workouts.forEach((x, i) => {
    const w = { type: x.type, ...toPreset(x) };
    const li = h(`<li><input type="checkbox" checked style="width:20px;height:20px;flex:none"><span class="tag ${x.type}">${TYPE[x.type].icon} ${TYPE[x.type].label}</span>
      <div class="name"><b>${esc(workoutDetail(w)) || esc(x.title) || '-'}</b><span class="sub">${esc(x.title)} · ${fmtShort(w.date)}</span></div><span class="kcal">${x.kcal != null ? kc(x.kcal) : '-'}</span></li>`);
    li.querySelector('input').onchange = (e) => (picks[i] = e.target.checked);
    ul.appendChild(li);
  });
  const add = h(`<button class="btn primary block" style="margin-top:12px">선택한 운동 추가</button>`);
  add.onclick = () => {
    let n = 0;
    res.workouts.forEach((x, i) => {
      if (!picks[i]) return;
      const base = { id: uid(), type: x.type, duration: 0, intensity: 'mid', strokes: [], parts: [], sets: [], kind: '러닝', distance: '', memo: '', title: '', kcal: 0, kcalManual: false, avgHr: null };
      const w = { ...base, ...toPreset(x) };
      if (!w.kcalManual) w.kcal = estimateKcal(w);
      db.workouts.push(w);
      n++;
    });
    save(); close(); rerender(); toast(`운동 ${n}개를 추가했어요`);
  };
  out.append(ul, add, h(`<p class="small muted">추가한 뒤 누르면 수정할 수 있어요.</p>`));
}

function workoutForm(existing, type, preset = {}) {
  const w = existing ? structuredClone(existing) : { id: uid(), date: ui.date, type, duration: type === 'swim' ? 50 : type === 'weight' ? 60 : type === 'pt' ? 50 : 30, ptNo: type === 'pt' ? nextPtNo() : null, intensity: 'mid', strokes: [], parts: [], sets: [], kind: '러닝', distance: '', memo: '', title: '', kcal: 0, kcalManual: false, avgHr: null, ...preset };
  if ((w.type === 'weight' || w.type === 'pt') && !w.sets.length) w.sets.push({ name: '', kg: '', reps: '', sets: '' });
  const body = h(`<div>
    <label class="field"><span>날짜</span><input type="date" class="dt" value="${w.date}"></label>
    <div class="typed"></div>
    <div class="grid3">
      <label class="field"><span>시간 (분)</span><input type="number" inputmode="numeric" class="du" value="${w.duration || ''}"></label>
      <label class="field"><span>소모 kcal</span><input type="number" inputmode="numeric" class="kc" value="${w.kcal || ''}"></label>
      <label class="field"><span>평균 심박</span><input type="number" inputmode="numeric" class="hrate" placeholder="선택" value="${w.avgHr || ''}"></label>
    </div>
    <p class="help auto"></p>
    <div class="field"><span>강도</span><div class="seg it">${INTENSITY.map(([k, l]) => `<button type="button" data-k="${k}" class="${w.intensity === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <label class="field"><span>${w.type === 'pt' ? '트레이너 피드백 · 메모' : '메모'}</span><textarea class="me" placeholder="${w.type === 'pt' ? '트레이너 피드백, 배운 자세 포인트, 숙제' : '컨디션, 느낀 점 등'}">${esc(w.memo)}</textarea></label>
    <div class="row"><button class="btn primary grow" data-a="s">저장</button>${existing ? '<button class="btn danger" data-a="d">삭제</button>' : ''}</div>
  </div>`);
  const typed = body.querySelector('.typed');
  const kcIn = body.querySelector('.kc');
  const autoLbl = body.querySelector('.auto');
  const recalc = () => {
    const est = estimateKcal(w);
    autoLbl.textContent = w.kcalManual ? (w.source === 'watch' ? '소모 kcal은 애플워치 활동 칼로리예요.' : '소모 kcal은 직접 입력한 값이에요.') : `소모 kcal은 시간·강도·체중(${latestWeight() || 60}kg)으로 자동 계산돼요. 직접 고쳐도 돼요.`;
    if (!w.kcalManual) { w.kcal = est; kcIn.value = est || ''; }
  };
  const pills = (arr, cur, multi, onPick) => {
    const box = h(`<div class="pills wrap" style="flex-wrap:wrap"></div>`);
    arr.forEach((x) => {
      const on = multi ? cur.includes(x) : cur === x;
      const b = h(`<button type="button" class="pill ${on ? 'on' : ''}">${x}</button>`);
      b.onclick = () => { onPick(x); drawTyped(); recalc(); };
      box.appendChild(b);
    });
    return box;
  };
  const toggle = (arr, x) => { const i = arr.indexOf(x); i >= 0 ? arr.splice(i, 1) : arr.push(x); };

  function drawTyped() {
    typed.innerHTML = '';
    if (w.type === 'swim') {
      typed.appendChild(h(`<div class="field"><span>영법 (여러 개 선택)</span></div>`)).appendChild(pills(SWIM_STROKES, w.strokes, true, (x) => toggle(w.strokes, x)));
      const f = h(`<label class="field"><span>거리 (m)</span><input type="number" inputmode="numeric" step="25" value="${w.distance || ''}" placeholder="예: 1000"></label>`);
      f.querySelector('input').oninput = (e) => (w.distance = e.target.value);
      typed.appendChild(f);
    } else if (w.type === 'cardio') {
      typed.appendChild(h(`<div class="field"><span>종류</span></div>`)).appendChild(pills(Object.keys(CARDIO), w.kind, false, (x) => (w.kind = x)));
      const f = h(`<label class="field"><span>거리 (km, 선택)</span><input type="number" inputmode="decimal" step="0.1" value="${w.distance || ''}"></label>`);
      f.querySelector('input').oninput = (e) => (w.distance = e.target.value);
      typed.appendChild(f);
    } else if (w.type === 'weight' || w.type === 'pt') {
      if (w.type === 'pt') {
        const st = ptStatus();
        const f = h(`<div class="grid2"><label class="field"><span>회차</span><input type="number" inputmode="numeric" value="${w.ptNo ?? ''}"></label><div class="field"><span>남은 횟수</span><div class="small" style="line-height:44px">${st?.remainText || '설정에서 등록 횟수를 넣어 주세요'}</div></div></div>`);
        f.querySelector('input').oninput = (e) => (w.ptNo = +e.target.value || null);
        typed.appendChild(f);
      }
      typed.appendChild(h(`<div class="field"><span>부위</span></div>`)).appendChild(pills(PARTS, w.parts, true, (x) => toggle(w.parts, x)));
      const box = h(`<div class="field"><span>종목</span>
        <button type="button" class="btn sm block tpl" style="margin:6px 0">📋 내 무분할 루틴 불러오기</button>
        <div class="set-head"><span>운동</span><span>kg</span><span>세트별 회수</span><span>세트</span><span></span></div><div class="sets"></div>
        <p class="help" style="margin-top:0">세트별 회수는 쉼표나 점으로 이어서 적어요. 예: 10,9,9,8,6</p>
        <datalist id="lifts">${[...new Set([...ROUTINE_NAMES, ...LIFTS])].map((l) => `<option>${l}</option>`).join('')}</datalist>
        <button type="button" class="btn sm ghost add">+ 종목 추가</button></div>`);
      const setsEl = box.querySelector('.sets');
      w.sets.forEach((s, i) => {
        const r = h(`<div><div class="set-row"><input type="text" list="lifts" placeholder="운동명" value="${esc(s.name)}"><input type="number" inputmode="decimal" value="${s.kg}"><input type="text" inputmode="decimal" placeholder="10,9,9,8,6" value="${esc(s.reps)}"><input type="number" inputmode="numeric" value="${s.sets}"><button type="button" class="x">×</button></div><div class="lv"></div></div>`);
        const [n, kg, reps, st] = r.querySelectorAll('input');
        const lv = r.querySelector('.lv');
        const hint = () => {
          const p = progressHint(s.name, w.date, w.id);
          const alts = altsOf(s.name);
          lv.className = 'lv ' + (p?.level || '');
          lv.textContent = p ? p.text + (alts.length ? `  ·  대체: ${alts.slice(0, 3).join(', ')}` : '') : '';
        };
        n.oninput = () => { s.name = n.value; hint(); };
        n.onchange = () => { if (!s.kg && lastKg(s.name)) { s.kg = lastKg(s.name); kg.value = s.kg; } };
        kg.oninput = () => (s.kg = kg.value);
        reps.oninput = () => { s.reps = reps.value; const l = repsList({ reps: s.reps, sets: 1 }); if (l.length > 1) { s.sets = l.length; st.value = l.length; } };
        st.oninput = () => (s.sets = st.value);
        r.querySelector('.x').onclick = () => { w.sets.splice(i, 1); drawTyped(); };
        hint();
        setsEl.appendChild(r);
      });
      box.querySelector('.add').onclick = () => { const l = w.sets[w.sets.length - 1]; w.sets.push({ name: '', kg: l?.kg || '', reps: '', sets: l?.sets || '' }); drawTyped(); };
      box.querySelector('.tpl').onclick = () => {
        w.sets = w.sets.filter((x) => x.name.trim());
        const picks = myRoutine(db.settings);
        for (const g of picks) if (!w.sets.some((x) => x.name.replace(/\s/g, '') === g.name.replace(/\s/g, ''))) w.sets.push({ name: g.name, kg: lastKg(g.name), reps: '', sets: 5 });
        for (const p of ['등', '가슴', '하체', '어깨', '팔']) if (!w.parts.includes(p)) w.parts.push(p);
        drawTyped();
        toast(`내 무분할 루틴 ${picks.length}종목을 불러왔어요 (설정에서 바꿀 수 있어요)`);
      };
      typed.appendChild(box);
    } else {
      const f = h(`<label class="field"><span>운동 이름</span><input type="text" value="${esc(w.title)}" placeholder="예: 필라테스, 요가"></label>`);
      f.querySelector('input').oninput = (e) => (w.title = e.target.value);
      typed.appendChild(f);
    }
  }
  body.querySelector('.du').oninput = (e) => { w.duration = e.target.value; recalc(); };
  kcIn.oninput = () => { w.kcalManual = kcIn.value !== ''; w.kcal = +kcIn.value || 0; if (!w.kcalManual) recalc(); else autoLbl.textContent = '소모 kcal은 직접 입력한 값이에요.'; };
  body.querySelectorAll('.it button').forEach((b) => (b.onclick = () => { w.intensity = b.dataset.k; body.querySelectorAll('.it button').forEach((x) => x.classList.toggle('on', x === b)); recalc(); }));
  drawTyped(); recalc();

  const close = sheet(`${TYPE[w.type].icon} ${TYPE[w.type].label} ${existing ? '수정' : '기록'}`, body);
  body.querySelector('[data-a=s]').onclick = () => {
    w.date = body.querySelector('.dt').value || ui.date;
    w.memo = body.querySelector('.me').value.trim();
    w.avgHr = +body.querySelector('.hrate').value || null;
    w.duration = +w.duration || 0;
    // 회수를 적은 종목만 저장 (루틴에서 불러왔지만 안 한 종목은 빼기)
    if (w.type === 'weight' || w.type === 'pt') w.sets = w.sets.filter((s) => s.name.trim() && String(s.reps ?? '').trim());
    const ups = w.type === 'weight' || w.type === 'pt' ? levelUps(w.sets) : [];
    const i = db.workouts.findIndex((x) => x.id === w.id);
    if (i >= 0) db.workouts[i] = w; else db.workouts.push(w);
    save(); close(); rerender();
    toast(ups.length ? `🎉 레벨업! ${ups.join(', ')} 5세트 10회 달성 — ${(db.settings.goal || 'diet') === 'diet' ? '다이어트 중엔 무게 유지도 OK' : '다음엔 무게 올리기'}` : '운동을 저장했어요');
  };
  const del = body.querySelector('[data-a=d]');
  if (del) del.onclick = () => { ask('이 운동 기록을 삭제할까요?').then((ok) => { if (ok) { db.workouts = db.workouts.filter((x) => x.id !== w.id); save(); close(); rerender(); } }); };
}

/* ================= 인바디 ================= */
function renderInbody() {
  const up = h(`<div class="card"><h2>인바디 기록 추가</h2>
    <label class="drop"><b>📷 인바디 캡처 올리기</b><span class="small muted">결과 화면, '변화' 그래프 화면 캡처를 여러 장 한 번에 올려도 돼요<br>체중·골격근·체지방률 등을 읽어서 입력해요</span>
      <input type="file" accept="image/*" multiple hidden></label>
    <div class="status"></div>
    <button class="btn ghost block" data-a="manual" style="margin-top:10px">✏️ 직접 입력</button></div>`);
  const status = up.querySelector('.status');
  up.querySelector('input[type=file]').onchange = async (e) => {
    const jpegs = await readImages(e.target.files);
    e.target.value = '';
    status.innerHTML = '';
    if (!jpegs.length) return toast('이미지를 열 수 없어요');
    const sample = await sampleImageReady();
    const key = db.settings.apiKey;
    if (!sample && window.claude?.use) {
      status.appendChild(h(`<p class="small up">Claude가 캡처를 읽으려면 사용 허용이 필요해요. 페이지를 새로고침한 뒤 허용을 눌러 주세요. 지금은 '직접 입력'으로도 기록할 수 있어요.</p>`));
      return;
    }
    const smart = !!(sample || key);
    status.appendChild(h(previews(jpegs)));
    const msg = h(`<p class="row small"><span class="spinner"></span><span class="t">${smart ? 'Claude가 캡처를 읽는 중… (10~30초)' : '문자 인식(OCR) 중… 처음엔 엔진을 받느라 조금 걸려요'}</span></p>`);
    status.appendChild(msg);
    try {
      const res = sample
        ? await analyzeWithSample(sample, jpegs)
        : key
          ? await analyzeWithClaude(jpegs, key)
          : await analyzeWithOCR(jpegs, (p) => (msg.querySelector('.t').textContent = `문자 인식 중… ${Math.round(p * 100)}%`));
      msg.remove();
      if (!res.measurements.length) { status.appendChild(h(`<p class="small up">측정값을 찾지 못했어요. 직접 입력해 주세요.</p>`)); return; }
      reviewSheet(res.measurements, res.note + (smart ? '' : ' (설정에서 Claude API 키를 넣으면 훨씬 정확하고, 변화 그래프의 여러 날짜도 한 번에 읽어요.)'));
    } catch (err) {
      console.error(err);
      msg.remove();
      const code = err?.code;
      const m = err?.status === 401 ? 'API 키가 올바르지 않아요. 설정에서 확인해 주세요.'
        : code === 'not_granted' ? 'Claude 사용을 허용해야 캡처를 읽을 수 있어요. 직접 입력도 가능해요.'
        : code === 'rate_limited' ? '지금은 Claude 사용량이 많아요. 잠시 후 다시 올려 주세요.'
        : code === 'invalid_json' ? '캡처에서 값을 제대로 읽지 못했어요. 다시 올리거나 직접 입력해 주세요.'
        : `분석 실패: ${esc(err?.message || err)}`;
      status.appendChild(h(`<p class="small up">${m}</p>`));
    }
  };
  up.querySelector('[data-a=manual]').onclick = () => reviewSheet([{ date: today(), time: null }], '', true);
  $view.appendChild(up);

  const all = inbodySorted();
  if (!all.length) { $view.appendChild(h(`<div class="card"><div class="empty">아직 인바디 기록이 없어요</div></div>`)); return; }

  // 분석
  const pts = analyze(all, db.settings);
  const last = all[all.length - 1];
  const an = h(`<div class="card analysis"><h2>인바디 분석 <small>${fmtDate(last.date)} 기준</small></h2></div>`);
  pts.forEach((p) => an.appendChild(h(`<div class="pt"><span class="dot" style="background:${p.color}"></span><div>${p.html}</div></div>`)));
  if (!pts.length) an.appendChild(h(`<div class="muted small">측정이 2회 이상 쌓이면 변화 분석이 보여요.</div>`));
  $view.appendChild(an);

  // 기간 선택
  const ranges = [[7, '최근 7회'], [30, '1개월'], [90, '3개월'], [0, '전체']];
  const rp = h(`<div class="pills" style="margin-bottom:12px">${ranges.map(([v, l]) => `<button class="pill ${ui.ibRange === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`);
  rp.querySelectorAll('button').forEach((b) => (b.onclick = () => { ui.ibRange = +b.dataset.v; rerender(); }));
  $view.appendChild(rp);

  let recs = all;
  if (ui.ibRange === 7) recs = all.slice(-7);
  else if (ui.ibRange) recs = all.filter((r) => r.date >= addDays(today(), -ui.ibRange));

  for (const m of METRICS) {
    const series = recs.filter((r) => r[m.key] != null);
    if (!series.length) continue;
    const card = h(`<div class="card chart-card"><h2><span>${m.label}${m.unit ? `<span class="unit">(${m.unit})</span>` : ''}</span></h2></div>`);
    const rng = standardRange(m.key, db.settings);
    card.appendChild(lineChart(
      series.map((r) => ({ x: fmtShort(r.date), value: r[m.key], tip: `${r.date.slice(2).replace(/-/g, '.')}${r.time ? ' ' + r.time : ''}` })),
      { unit: m.unit, decimals: m.dec, colorFor: colorFor(m.key, db.settings) },
    ));
    if (rng) card.appendChild(h(`<div class="legend"><span>표준 ${rng[0]}~${rng[1]}${m.unit}</span><span><i style="background:#3bb98a"></i>표준</span><span><i style="background:#f0506e"></i>표준 이상</span><span><i style="background:#f2a33a"></i>표준 이하</span></div>`));
    $view.appendChild(card);
  }

  // 측정 목록
  const list = h(`<div class="card"><h2>측정 기록 <small>${all.length}회</small></h2><ul class="list"></ul></div>`);
  const ul = list.querySelector('ul');
  [...all].reverse().forEach((r) => {
    const li = h(`<li><div class="name"><b>${fmtDate(r.date)}${r.time ? ' ' + r.time : ''}</b><span class="sub">체중 ${nf(r.weight)} · 골격근 ${nf(r.smm)} · 체지방률 ${nf(r.pbf)}%${r.whr != null ? ' · 복부 ' + nf(r.whr, 2) : ''}</span></div><button class="btn sm ghost">수정</button></li>`);
    li.querySelector('button').onclick = () => reviewSheet([r], '', true, r.id);
    ul.appendChild(li);
  });
  $view.appendChild(list);
}

function reviewSheet(measurements, note, showAll = false, editId = null) {
  const rows = measurements.map((m) => ({ use: true, ...m }));
  const keys = showAll ? METRICS.map((m) => m.key) : METRICS.filter((m) => m.main || rows.some((r) => r[m.key] != null)).map((m) => m.key);
  const body = h(`<div>${note ? `<p class="small muted" style="margin-top:0">${esc(note)}</p>` : ''}<div class="items"></div>
    <div class="row" style="margin-top:12px"><button class="btn primary grow" data-a="s">저장</button>${editId ? '<button class="btn danger" data-a="d">삭제</button>' : ''}</div></div>`);
  const items = body.querySelector('.items');
  rows.forEach((r) => {
    const exists = !editId && inbodyOn(r.date);
    const c = h(`<div class="card" style="box-shadow:none;border:1px solid var(--line);padding:12px">
      <div class="row" style="margin-bottom:8px">${rows.length > 1 ? '<input type="checkbox" class="use" checked style="width:20px;height:20px">' : ''}
        <input type="date" class="date grow" value="${r.date}"><input type="time" class="time" value="${r.time || ''}" style="width:110px"></div>
      ${exists ? '<div class="small" style="color:#f2a33a;margin-bottom:6px">같은 날짜 기록이 있어요 → 입력한 항목만 덮어써요</div>' : ''}
      <div class="grid3">${keys.map((k) => `<label class="field" style="margin:0"><span>${METRIC[k].label}${METRIC[k].unit ? ` (${METRIC[k].unit})` : ''}</span><input type="number" inputmode="decimal" step="any" data-k="${k}" value="${r[k] ?? ''}"></label>`).join('')}</div>
    </div>`);
    c.querySelector('.use')?.addEventListener('change', (e) => (r.use = e.target.checked));
    c.querySelector('.date').onchange = (e) => (r.date = e.target.value);
    c.querySelector('.time').onchange = (e) => (r.time = e.target.value || null);
    c.querySelectorAll('[data-k]').forEach((inp) => (inp.oninput = () => (r[inp.dataset.k] = inp.value === '' ? null : parseFloat(inp.value))));
    items.appendChild(c);
  });
  const close = sheet(editId ? '인바디 수정' : '측정값 확인', body);
  body.querySelector('[data-a=s]').onclick = () => {
    let n = 0;
    for (const r of rows) {
      if (!r.use || !r.date) continue;
      const vals = Object.fromEntries(METRICS.map((m) => [m.key, r[m.key] ?? null]));
      if (Object.values(vals).every((v) => v == null)) continue;
      // 체지방률 자동 계산 (체중·체지방량만 있을 때)
      if (vals.pbf == null && vals.weight && vals.bfm) vals.pbf = +((vals.bfm / vals.weight) * 100).toFixed(1);
      let target = editId ? db.inbody.find((x) => x.id === editId) : db.inbody.find((x) => x.date === r.date);
      if (editId) Object.assign(target, { date: r.date, time: r.time || null }, vals);
      else if (target) {
        for (const [k, v] of Object.entries(vals)) if (v != null) target[k] = v;
        if (r.time) target.time = r.time;
      } else db.inbody.push({ id: uid(), date: r.date, time: r.time || null, ...vals });
      n++;
    }
    save(); close(); rerender(); toast(n ? `${n}건 저장했어요` : '저장할 값이 없어요');
  };
  const del = body.querySelector('[data-a=d]');
  if (del) del.onclick = () => { ask('이 측정 기록을 삭제할까요?').then((ok) => { if (ok) { db.inbody = db.inbody.filter((x) => x.id !== editId); save(); close(); rerender(); } }); };
}

/* ================= 기록 (주간 / 월간) ================= */
function renderCalendar() {
  const seg = h(`<div class="seg" style="margin-bottom:12px"><button data-m="week">주간</button><button data-m="month">월간</button></div>`);
  seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.m === ui.calMode); b.onclick = () => { ui.calMode = b.dataset.m; rerender(); }; });
  $view.appendChild(seg);
  ui.calMode === 'week' ? renderWeek() : renderMonth();
}

function periodSummary(days) {
  const logged = days.filter(hasMeals);
  const avgIn = logged.length ? logged.reduce((a, d) => a + intakeOf(d), 0) / logged.length : 0;
  const ws = days.flatMap(workoutsOf);
  const ib = inbodySorted().filter((r) => r.date >= days[0] && r.date <= days[days.length - 1] && r.weight != null);
  const dW = ib.length > 1 ? ib[ib.length - 1].weight - ib[0].weight : null;
  return h(`<div class="grid2" style="margin-bottom:12px">
    <div class="stat"><div class="k">평균 섭취 (${logged.length}일 기록)</div><div class="v">${kc(avgIn)}<small>kcal</small></div></div>
    <div class="stat"><div class="k">운동</div><div class="v">${ws.length}<small>회 · ${kc(ws.reduce((a, w) => a + (+w.duration || 0), 0))}분</small></div></div>
    <div class="stat"><div class="k">총 운동 소모</div><div class="v">${kc(ws.reduce((a, w) => a + (+w.kcal || 0), 0))}<small>kcal</small></div></div>
    <div class="stat"><div class="k">체중 변화</div><div class="v ${dW == null ? '' : dW < 0 ? 'down' : dW > 0 ? 'up' : ''}">${dW == null ? '-' : (dW > 0 ? '+' : '') + dW.toFixed(1)}<small>kg</small></div></div>
  </div>`);
}

function renderWeek() {
  const ws = weekStart(ui.calAnchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const nav = h(`<div class="datenav"><button class="btn sm ghost" data-d="-7">◀</button><div class="label">${fmtShort(days[0])} ~ ${fmtShort(days[6])}<small>${parseISO(ws).getFullYear()}년</small></div><button class="btn sm ghost" data-d="7">▶</button></div>`);
  nav.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { ui.calAnchor = addDays(ui.calAnchor, +b.dataset.d); rerender(); }));
  const card = h(`<div class="card"></div>`);
  card.appendChild(nav);
  card.appendChild(periodSummary(days));
  card.appendChild(barChart(days.map((d) => ({ x: `${DOW[parseISO(d).getDay()]} ${parseISO(d).getDate()}`, a: intakeOf(d), b: burnedOf(d) })), { target: db.settings.kcalTarget }));
  card.appendChild(h(`<div class="legend"><span><i style="background:#2f3640"></i>섭취</span><span><i style="background:#3bb98a"></i>운동 소모</span><span><i style="background:#f0506e"></i>목표 초과</span></div>`));
  $view.appendChild(card);

  const list = h(`<div class="card"></div>`);
  days.forEach((d) => {
    const intake = intakeOf(d), wos = workoutsOf(d), ib = inbodyOn(d);
    const row = h(`<div class="week-day ${d === today() ? 'today' : ''}">
      <div class="head"><b>${fmtDate(d)}</b><span class="${intake > db.settings.kcalTarget ? 'up' : ''}" style="font-weight:700">${hasMeals(d) ? kc(intake) + ' kcal' : '<span class="muted small">식단 없음</span>'}</span></div>
      <div class="detail">${ptPlanOn(d) && !ptDone(d) && d >= today() ? `<span class="tag pt">🧑‍🏫 PT 예약 ${ptPlanOn(d).time || ''}</span>` : ''}${wos.map((w) => `<span class="tag ${w.type}">${TYPE[w.type].icon} ${esc(workoutDetail(w))}</span>`).join('')}
        ${weightOn(d) ? `<span class="tag">⚖️ ${nf(weightOn(d))}kg${ib?.pbf != null ? ' · ' + nf(ib.pbf) + '%' : ''}</span>` : ''}
        ${!wos.length && !ib ? '' : ''}</div></div>`);
    row.onclick = () => dayDetail(d);
    list.appendChild(row);
  });
  $view.appendChild(list);
}

function renderMonth() {
  const a = parseISO(ui.calAnchor);
  const y = a.getFullYear(), m = a.getMonth();
  const first = new Date(y, m, 1), lastDay = new Date(y, m + 1, 0).getDate();
  const monthDays = Array.from({ length: lastDay }, (_, i) => iso(new Date(y, m, i + 1)));
  const nav = h(`<div class="datenav"><button class="btn sm ghost" data-d="-1">◀</button><div class="label">${y}년 ${m + 1}월</div><button class="btn sm ghost" data-d="1">▶</button></div>`);
  nav.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { ui.calAnchor = iso(new Date(y, m + +b.dataset.d, 1)); rerender(); }));
  const card = h(`<div class="card"></div>`);
  card.appendChild(nav);
  card.appendChild(periodSummary(monthDays));
  const cal = h(`<div class="cal">${DOW.map((d) => `<div class="dow">${d}</div>`).join('')}</div>`);
  const start = new Date(y, m, 1 - first.getDay());
  const cells = Math.ceil((first.getDay() + lastDay) / 7) * 7;
  for (let i = 0; i < cells; i++) {
    const dt = new Date(start); dt.setDate(start.getDate() + i);
    const d = iso(dt);
    const intake = intakeOf(d), wos = workoutsOf(d), ib = inbodyOn(d);
    const cell = h(`<div class="day ${dt.getMonth() !== m ? 'out' : ''} ${d === today() ? 'today' : ''}">
      <span class="n">${dt.getDate()}</span>
      ${hasMeals(d) ? `<span class="kc ${intake > db.settings.kcalTarget ? 'over' : ''}">${kc(intake)}</span>` : ''}
      ${wos.length || (ptPlanOn(d) && !ptDone(d)) ? `<span class="ic">${[...new Set(wos.map((w) => TYPE[w.type].icon))].join('')}${ptPlanOn(d) && !ptDone(d) && d >= today() ? '<span class="pt-dot">PT</span>' : ''}</span>` : ''}
      ${weightOn(d) ? `<span class="w">${nf(weightOn(d))}</span>` : ''}</div>`);
    cell.onclick = () => dayDetail(d);
    cal.appendChild(cell);
  }
  card.appendChild(cal);
  card.appendChild(h(`<div class="legend"><span><b style="color:#333">1,234</b> 섭취 kcal</span><span><b style="color:#f0506e">빨강</b> 목표 초과</span><span>🏊🏋️🏃 운동</span><span><b style="color:#4a7bf7">55.2</b> 체중</span></div>`));
  $view.appendChild(card);
}

function dayDetail(d) {
  const meals = dayMeals(d);
  const body = h(`<div></div>`);
  const intake = intakeOf(d), burned = burnedOf(d);
  body.appendChild(h(`<div class="grid3" style="margin-bottom:12px">
    <div class="stat"><div class="k">섭취</div><div class="v">${kc(intake)}</div></div>
    <div class="stat"><div class="k">소모</div><div class="v">${kc(burned)}</div></div>
    <div class="stat"><div class="k">순 섭취</div><div class="v">${kc(intake - burned)}</div></div></div>`));
  body.appendChild(h(`<h3>식단</h3>`));
  if (!hasMeals(d)) body.appendChild(h(`<p class="muted small">기록 없음</p>`));
  for (const [k, l] of MEAL_SLOTS) {
    const items = meals[k] || [];
    if (!items.length) continue;
    body.appendChild(h(`<p class="small" style="margin:4px 0"><b>${l}</b> ${items.map((it) => `${esc(it.name)} ${nf(it.amount * it.qty, 2)}${esc(it.unit)}${it.eaten < 1 ? '(' + eatenText(it.eaten) + ')' : ''}`).join(', ')} <span class="muted">· ${kc(items.reduce((a, it) => a + itemKcal(it), 0))}kcal</span></p>`));
  }
  body.appendChild(h(`<div class="hr"></div>`));
  body.appendChild(h(`<h3>운동</h3>`));
  const ws = workoutsOf(d);
  body.appendChild(ws.length ? workoutList(ws, false) : h(`<p class="muted small">기록 없음</p>`));
  const ib = inbodyOn(d);
  if (ib) {
    body.appendChild(h(`<div class="hr"></div>`));
    body.appendChild(h(`<h3>인바디</h3>`));
    body.appendChild(h(`<p class="small">${METRICS.filter((m) => ib[m.key] != null).map((m) => `${m.label} <b>${nf(ib[m.key], m.dec)}</b>${m.unit}`).join(' · ')}</p>`));
  }
  if (d >= today()) {
    const b = bookingOn(d);
    const pr = h(`<div class="today-plan" style="margin-top:12px"><span>🧑‍🏫 ${b ? `PT 예약 <b>${b.time || '시간 미정'}</b>` : 'PT 예약 없음'}</span><button class="btn sm">${b ? '예약 취소' : 'PT 예약'}</button></div>`);
    pr.querySelector('button').onclick = () => {
      if (b) { removeBooking(d); save(); toast('예약을 취소했어요'); close(); rerender(); }
      else { close(); ptBookSheet(d); }
    };
    body.appendChild(pr);
  }
  const btns = h(`<div class="grid2" style="margin-top:14px"><button class="btn" data-go="meals">식단 기록하기</button><button class="btn" data-go="workout">운동 기록하기</button></div>`);
  body.appendChild(btns);
  const close = sheet(fmtDate(d), body);
  btns.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { ui.date = d; close(); location.hash = '#' + b.dataset.go; }));
}

/* ================= 설정 ================= */
function renderSettings() {
  const s = db.settings;
  const bg = getBg();
  const card = h(`<div class="card"><h2>배경 사진</h2>
    ${bg ? `<img src="${bg}" class="preview-img" alt="">` : '<p class="small muted" style="margin-top:0">사진을 고르면 앱 배경 또는 상단에 표시돼요.</p>'}
    <div class="row wrap"><label class="btn">사진 선택<input type="file" accept="image/*" hidden></label>${bg ? '<button class="btn danger" data-a="rm">사진 삭제</button>' : ''}</div>
    ${bg ? `<div class="field" style="margin-top:12px"><span>표시 위치</span><div class="seg mode">
      <button data-v="none">사용 안 함</button><button data-v="header">상단에만</button><button data-v="full">전체 배경</button></div></div>
      ${s.bgMode === 'full' ? `<label class="field"><span>카드 불투명도 (${Math.round(s.cardAlpha * 100)}%)</span><input type="range" min="0.5" max="1" step="0.05" value="${s.cardAlpha}" style="width:100%"></label>` : ''}` : ''}
  </div>`);
  card.querySelector('input[type=file]').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const img = await fileToImage(f);
      const url = imageToJpeg(img, 1400, 0.8);
      const assets = await window.claude?.use?.('assets').catch(() => null);
      if (assets) {
        // claude.ai: 계정에 올려서 다른 기기에서도 보이게
        const blob = dataUrlToBlob(url);
        const up = await assets.upload(blob);
        s.bgUrl = up.url;
      } else {
        s.bgUrl = '';
        if (!setBg(url)) return toast('사진이 너무 커서 저장하지 못했어요');
      }
      if (s.bgMode === 'none') s.bgMode = 'header';
      save(); applyBackground(); rerender();
    } catch { toast('사진을 열 수 없어요'); }
  };
  card.querySelector('[data-a=rm]')?.addEventListener('click', () => { setBg(''); s.bgUrl = ''; save(); applyBackground(); rerender(); });
  card.querySelectorAll('.mode button').forEach((b) => { b.classList.toggle('on', b.dataset.v === s.bgMode); b.onclick = () => { s.bgMode = b.dataset.v; save(); applyBackground(); rerender(); }; });
  const rng = card.querySelector('input[type=range]');
  if (rng) rng.oninput = () => { s.cardAlpha = +rng.value; save(); applyBackground(); rng.previousElementSibling.textContent = `카드 불투명도 (${Math.round(s.cardAlpha * 100)}%)`; };
  $view.appendChild(card);

  const kgNow = latestWeight();
  const gc = h(`<div class="card"><h2>목표 칼로리 계산</h2>
    <div class="seg gseg">${Object.entries(GOAL).map(([k, [l, f]]) => `<button type="button" data-g="${k}" class="${(s.goal || 'diet') === k ? 'on' : ''}">${l}<br><small>체중×${f}</small></button>`).join('')}</div>
    <p class="calc" style="margin:12px 0 8px">${kgNow ? `최근 체중 <b>${nf(kgNow)}kg</b> × ${GOAL[s.goal || 'diet'][1]} = <b style="font-size:18px">${kc(goalKcal(kgNow))}kcal</b> <span class="small muted">(지금 목표 ${kc(s.kcalTarget)}kcal)</span>` : '체중 기록이 없어요. 홈에서 아침 체중을 먼저 기록해 주세요.'}</p>
    <label class="small row" style="margin-bottom:10px"><input type="checkbox" class="auto" ${s.autoKcal ? 'checked' : ''}> 체중을 기록할 때마다 목표 kcal 자동으로 맞추기</label>
    <button class="btn primary block apply" ${kgNow ? '' : 'disabled'}>이 값으로 목표 설정</button>
    <p class="small muted" style="margin-bottom:0">공식은 추정치예요. 매일 아침 체중 추세를 보고 100~200kcal씩 조절하세요. 다이어트는 하루 약 100g, 근육 증가는 한 달 1kg 미만이 좋은 속도예요.</p></div>`);
  gc.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => { s.goal = b.dataset.g; syncKcalTarget(); save(); rerender(); }));
  gc.querySelector('.auto').onchange = (e) => { s.autoKcal = e.target.checked; syncKcalTarget(); save(); rerender(); toast(s.autoKcal ? `목표를 ${kc(s.kcalTarget)}kcal로 맞췄어요` : '자동 맞추기를 껐어요'); };
  gc.querySelector('.apply').onclick = () => { s.kcalTarget = goalKcal(kgNow); save(); rerender(); toast(`하루 목표를 ${kc(s.kcalTarget)}kcal로 정했어요`); };
  $view.appendChild(gc);

  const gym = h(`<div class="card"><h2>우리 헬스장 기구</h2>
    <p class="small muted" style="margin-top:0">등록하면 루틴 추천과 '무분할 루틴 불러오기'가 있는 기구로 할 수 있는 종목만 골라요. 아무것도 안 고르면 일반 헬스장 기준이에요.</p></div>`);
  gym.appendChild(equipSection(rerender));
  $view.appendChild(gym);
  $view.appendChild(routineCard());
  $view.appendChild(ptCard());

  const goal = h(`<div class="card"><h2>내 정보 · 목표</h2>
    <div class="grid2">
      <label class="field"><span>하루 섭취 목표 (kcal)</span><input type="number" inputmode="numeric" data-k="kcalTarget" value="${s.kcalTarget}"></label>
      <label class="field"><span>목표 체중 (kg)</span><input type="number" inputmode="decimal" data-k="goalWeight" value="${s.goalWeight ?? ''}"></label>
      <label class="field"><span>키 (cm)</span><input type="number" inputmode="decimal" data-k="height" value="${s.height ?? ''}"></label>
      <label class="field"><span>성별 (표준 범위 계산용)</span><select data-k="sex"><option value="female" ${s.sex !== 'male' ? 'selected' : ''}>여성</option><option value="male" ${s.sex === 'male' ? 'selected' : ''}>남성</option></select></label>
    </div></div>`);
  goal.querySelectorAll('[data-k]').forEach((inp) => (inp.onchange = () => {
    const k = inp.dataset.k;
    s[k] = k === 'sex' ? inp.value : inp.value === '' ? null : +inp.value;
    if (k === 'kcalTarget' && !s[k]) s[k] = 1500;
    save(); toast('저장했어요');
  }));
  $view.appendChild(goal);

  const ai = h(`<div class="card"><h2>인바디 캡처 자동 분석</h2>
    ${isCloud() ? '<p class="small good" style="margin-top:0"><b>claude.ai에서 열려 있어서 API 키 없이 Claude가 캡처를 읽어요.</b> 아래 키는 다른 곳(GitHub Pages 등)에서 열 때만 필요해요.</p>' : ''}
    <p class="small" style="margin-top:0">Claude API 키를 넣으면 캡처를 Claude가 읽어서 정확하게 입력해요. '변화' 그래프 화면처럼 여러 날짜가 있는 캡처도 한 번에 가져와요.
    키가 없으면 무료 문자 인식(OCR)을 쓰는데, 정확도가 낮아서 확인이 더 필요해요.</p>
    <label class="field"><span>Claude API 키 (console.anthropic.com 에서 발급)</span><input type="password" value="${esc(s.apiKey)}" placeholder="sk-ant-..." autocomplete="off"></label>
    <p class="small muted">키는 이 기기 브라우저에만 저장되고, 분석할 때 Anthropic API로만 전송돼요. 캡처 1장 분석에 몇십 원 수준의 API 비용이 들어요.</p></div>`);
  ai.querySelector('input').onchange = (e) => { s.apiKey = e.target.value.trim(); save(); toast(s.apiKey ? 'API 키를 저장했어요' : 'API 키를 지웠어요'); };
  $view.appendChild(ai);

  const data = h(`<div class="card"><h2>데이터</h2>
    <p class="small muted" style="margin-top:0">${isCloud() ? '기록은 내 claude.ai 계정에 저장돼서 폰·PC 어디서 열어도 같아요. 나만 볼 수 있어요.' : '기록은 이 기기 브라우저에 저장돼요. 브라우저 데이터를 지우면 사라지니 가끔 백업해 두세요.'}</p>
    <div class="grid2"><button class="btn" data-a="exp">백업 파일 저장</button><label class="btn">백업 불러오기<input type="file" accept="application/json,.json" hidden></label></div>
    <button class="btn danger block" data-a="reset" style="margin-top:10px">모든 기록 삭제</button></div>`);
  data.querySelector('[data-a=exp]').onclick = async () => {
    const out = { ...db, settings: { ...db.settings, apiKey: '' } };
    const json = JSON.stringify(out, null, 1);
    const downloads = await window.claude?.use?.('downloads').catch(() => null);
    if (downloads) {
      try { await downloads.save({ filename: `memyma-backup-${today()}.json`, data: json }); toast('백업 파일을 저장했어요'); }
      catch { toast('저장을 취소했어요'); }
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `memyma-backup-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  data.querySelector('input[type=file]').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!obj.foods || !obj.meals) throw new Error();
      if (!(await ask('현재 기록을 백업 파일 내용으로 바꿀까요?', '바꾸기'))) return;
      const key = db.settings.apiKey;
      replaceAll(obj);
      if (!db.settings.apiKey) { db.settings.apiKey = key; save(); }
      applyBackground(); rerender(); toast('백업을 불러왔어요');
    } catch { toast('올바른 백업 파일이 아니에요'); }
  };
  data.querySelector('[data-a=reset]').onclick = async () => {
    if (!(await ask('식단·운동·인바디 기록을 모두 삭제할까요? 되돌릴 수 없어요.'))) return;
    db.meals = {}; db.workouts = []; db.inbody = [];
    save(); rerender(); toast('기록을 삭제했어요');
  };
  $view.appendChild(data);
}

/* ================= 시작 ================= */
setSaveErrorHandler((e) => toast(e?.code === 'quota_exceeded' ? '저장 공간이 가득 찼어요. 백업 후 오래된 기록을 정리해 주세요.' : '저장하지 못했어요. 인터넷 연결을 확인해 주세요.'));
fillFoodGroups();
applyBackground();
route();
initCloud().then((ok) => { if (ok) { fillFoodGroups(); applyBackground(); rerender(); } });
