import {
  db, save, uid, replaceAll, getBg, setBg,
  today, addDays, parseISO, iso, fmtDate, fmtShort, weekStart, DOW, pad,
  MEAL_SLOTS, dayMeals, ensureDayMeals, itemKcal, intakeOf, hasMeals,
  workoutsOf, burnedOf, inbodySorted, inbodyOn, latestWeight,
  initCloud, isCloud, setSaveErrorHandler,
} from './store.js';
import { lineChart, barChart } from './chart.js';
import {
  METRICS, METRIC, colorFor, standardRange, analyze,
  fileToImage, imageToJpeg, analyzeWithClaude, analyzeWithOCR, sampleImageReady, analyzeWithSample, dataUrlToBlob,
} from './inbody.js';

/* ================= 공통 유틸 ================= */
const $view = document.getElementById('view');
const ui = { date: today(), calMode: 'week', calAnchor: today(), ibRange: 7, pending: null };

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
  </div>`));

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
  wcard.appendChild(ws.length ? workoutList(ws, false) : h(`<div class="empty">아직 운동 기록이 없어요</div>`));
  $view.appendChild(wcard);

  const wk = weekStart(t);
  const bars = Array.from({ length: 7 }, (_, i) => { const d = addDays(wk, i); return { x: DOW[parseISO(d).getDay()], a: intakeOf(d), b: burnedOf(d) }; });
  const c = h(`<div class="card"><h2>이번 주 칼로리 <a href="#calendar" class="btn sm">자세히</a></h2></div>`);
  c.appendChild(barChart(bars, { target }));
  c.appendChild(h(`<div class="legend"><span><i style="background:#2f3640"></i>섭취</span><span><i style="background:#3bb98a"></i>운동 소모</span><span><i style="background:#f0506e"></i>목표 초과</span></div>`));
  $view.appendChild(c);
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
    items.forEach((it, i) => {
      const li = h(`<li><div class="name"><b>${esc(it.name)}</b><span class="sub">${nf(it.amount * it.qty, 2)}${esc(it.unit)}</span></div><span class="kcal">${kc(itemKcal(it))}</span><button class="x" aria-label="삭제">×</button></li>`);
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

function foodUseCount() {
  const cnt = {};
  for (const day of Object.values(db.meals)) for (const [k] of MEAL_SLOTS) for (const it of day[k] || []) cnt[it.foodId] = (cnt[it.foodId] || 0) + 1;
  return cnt;
}

function addFoodSheet(date, slot, label) {
  const cnt = foodUseCount();
  const sel = new Map(); // foodId -> qty
  const body = h(`<div>
    <input type="text" placeholder="음식 검색" class="q" style="margin-bottom:10px">
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
    if (!foods.length) grid.appendChild(h(`<div class="empty">검색 결과가 없어요</div>`));
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
  const close = sheet(`${label} 추가`, body);
  okBtn.onclick = () => {
    if (!sel.size) return;
    const arr = ensureDayMeals(date)[slot];
    for (const [id, qty] of sel) {
      const f = db.foods.find((x) => x.id === id);
      arr.push({ id: uid(), foodId: f.id, name: f.name, amount: f.amount, unit: f.unit, kcal: f.kcal, qty });
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

function editMealItem(date, slot, idx) {
  const it = ensureDayMeals(date)[slot][idx];
  const body = h(`<div>
    <p><b>${esc(it.name)}</b> <span class="muted small">(${nf(it.amount, 2)}${esc(it.unit)}당 ${kc(it.kcal)}kcal)</span></p>
    <label class="field"><span>수량 (배수)</span><input type="number" inputmode="decimal" step="0.5" value="${it.qty}"></label>
    <label class="field"><span>이동</span><select>${MEAL_SLOTS.map(([k, l]) => `<option value="${k}" ${k === slot ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <button class="btn primary block">저장</button></div>`);
  const close = sheet('음식 수정', body);
  body.querySelector('button').onclick = () => {
    const q = parseFloat(body.querySelector('input').value);
    if (q > 0) it.qty = q;
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
        <div class="name"><b>${esc(f.name)}</b><span class="sub">${nf(f.amount, 2)}${esc(f.unit)}</span></div><span class="kcal">${kc(f.kcal)} kcal</span>
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
    <datalist id="units"><option>g</option><option>개</option><option>공기</option><option>잔</option><option>ml</option><option>스쿱</option><option>접시</option><option>팩</option><option>봉</option></datalist>
    <p class="small muted" style="margin-top:0">예) 기준량 100, 단위 g, 109kcal → 식단에서 1.5 입력 시 150g · 164kcal</p>
    <div class="row"><button class="btn primary grow" data-a="s">저장</button>${food ? '<button class="btn danger" data-a="d">삭제</button>' : ''}</div></div>`);
  const close = sheet(food ? '음식 수정' : '새 음식', body);
  body.querySelector('[data-a=s]').onclick = () => {
    const name = body.querySelector('.n').value.trim();
    const kcal = parseFloat(body.querySelector('.k').value);
    if (!name || !(kcal >= 0)) return toast('이름과 kcal를 입력해 주세요');
    const rec = { name, amount: parseFloat(body.querySelector('.a').value) || 1, unit: body.querySelector('.u').value.trim() || '개', kcal };
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
  const base = w.type === 'swim' ? 8 : w.type === 'weight' ? 5 : w.type === 'cardio' ? CARDIO[w.kind] || 5 : 5;
  return base * f;
}
const estimateKcal = (w) => Math.round(metOf(w) * (latestWeight() || 60) * ((+w.duration || 0) / 60));

function workoutDetail(w) {
  const p = [];
  if (w.duration) p.push(`${w.duration}분`);
  if (w.type === 'swim') { if (w.strokes?.length) p.push(w.strokes.join('·')); if (w.distance) p.push(`${w.distance}m`); }
  if (w.type === 'cardio') { if (w.kind) p.push(w.kind); if (w.distance) p.push(`${w.distance}km`); }
  if (w.type === 'weight') {
    if (w.parts?.length) p.push(w.parts.join('·'));
    const sets = (w.sets || []).filter((s) => s.name);
    if (sets.length) {
      const vol = sets.reduce((a, s) => a + (+s.kg || 0) * (+s.reps || 0) * (+s.sets || 0), 0);
      p.push(`${sets.length}종목`);
      if (vol) p.push(`볼륨 ${kc(vol)}kg`);
    }
  }
  if (w.type === 'etc' && w.title) p.push(w.title);
  return p.join(' · ');
}

function workoutList(ws, editable = true) {
  const ul = h(`<ul class="list"></ul>`);
  ws.forEach((w) => {
    const sets = w.type === 'weight' ? (w.sets || []).filter((s) => s.name).map((s) => `${esc(s.name)} ${s.kg ? s.kg + 'kg×' : ''}${s.reps || '-'}회×${s.sets || '-'}세트`).join('<br>') : '';
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
  const btns = h(`<div class="grid3" style="margin-top:12px"></div>`);
  ['swim', 'weight', 'cardio'].forEach((t) => {
    const b = h(`<button class="btn">${TYPE[t].icon} ${TYPE[t].label}</button>`);
    b.onclick = () => workoutForm(null, t);
    btns.appendChild(b);
  });
  card.appendChild(btns);
  const etc = h(`<button class="btn ghost block" style="margin-top:8px">✨ 기타 운동</button>`);
  etc.onclick = () => workoutForm(null, 'etc');
  card.appendChild(etc);
  $view.appendChild(card);

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
}

function workoutForm(existing, type) {
  const w = existing ? structuredClone(existing) : { id: uid(), date: ui.date, type, duration: type === 'swim' ? 50 : type === 'weight' ? 60 : 30, intensity: 'mid', strokes: [], parts: [], sets: [], kind: '러닝', distance: '', memo: '', title: '', kcal: 0, kcalManual: false };
  if (w.type === 'weight' && !w.sets.length) w.sets.push({ name: '', kg: '', reps: '', sets: '' });
  const body = h(`<div>
    <label class="field"><span>날짜</span><input type="date" class="dt" value="${w.date}"></label>
    <div class="typed"></div>
    <div class="grid2">
      <label class="field"><span>운동 시간 (분)</span><input type="number" inputmode="numeric" class="du" value="${w.duration || ''}"></label>
      <label class="field"><span>소모 kcal <em class="small muted auto"></em></span><input type="number" inputmode="numeric" class="kc" value="${w.kcal || ''}"></label>
    </div>
    <div class="field"><span>강도</span><div class="seg it">${INTENSITY.map(([k, l]) => `<button type="button" data-k="${k}" class="${w.intensity === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <label class="field"><span>메모</span><textarea class="me" placeholder="컨디션, 느낀 점 등">${esc(w.memo)}</textarea></label>
    <div class="row"><button class="btn primary grow" data-a="s">저장</button>${existing ? '<button class="btn danger" data-a="d">삭제</button>' : ''}</div>
  </div>`);
  const typed = body.querySelector('.typed');
  const kcIn = body.querySelector('.kc');
  const autoLbl = body.querySelector('.auto');
  const recalc = () => {
    const est = estimateKcal(w);
    autoLbl.textContent = w.kcalManual ? '(직접 입력)' : `(자동 · ${latestWeight() || 60}kg 기준)`;
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
    } else if (w.type === 'weight') {
      typed.appendChild(h(`<div class="field"><span>부위</span></div>`)).appendChild(pills(PARTS, w.parts, true, (x) => toggle(w.parts, x)));
      const box = h(`<div class="field"><span class="small muted">종목</span><div class="set-head" style="margin-top:4px"><span>운동</span><span>kg</span><span>회</span><span>세트</span><span></span></div><div class="sets"></div>
        <datalist id="lifts">${LIFTS.map((l) => `<option>${l}</option>`).join('')}</datalist>
        <button type="button" class="btn sm ghost">+ 종목 추가</button></div>`);
      const setsEl = box.querySelector('.sets');
      w.sets.forEach((s, i) => {
        const r = h(`<div class="set-row"><input type="text" list="lifts" placeholder="운동명" value="${esc(s.name)}"><input type="number" inputmode="decimal" value="${s.kg}"><input type="number" inputmode="numeric" value="${s.reps}"><input type="number" inputmode="numeric" value="${s.sets}"><button type="button" class="x">×</button></div>`);
        const [n, kg, reps, st] = r.querySelectorAll('input');
        n.oninput = () => (s.name = n.value); kg.oninput = () => (s.kg = kg.value); reps.oninput = () => (s.reps = reps.value); st.oninput = () => (s.sets = st.value);
        r.querySelector('.x').onclick = () => { w.sets.splice(i, 1); drawTyped(); };
        setsEl.appendChild(r);
      });
      box.querySelector('.btn').onclick = () => { const l = w.sets[w.sets.length - 1]; w.sets.push({ name: '', kg: l?.kg || '', reps: l?.reps || '', sets: l?.sets || '' }); drawTyped(); };
      typed.appendChild(box);
    } else {
      const f = h(`<label class="field"><span>운동 이름</span><input type="text" value="${esc(w.title)}" placeholder="예: 필라테스, 요가"></label>`);
      f.querySelector('input').oninput = (e) => (w.title = e.target.value);
      typed.appendChild(f);
    }
  }
  body.querySelector('.du').oninput = (e) => { w.duration = e.target.value; recalc(); };
  kcIn.oninput = () => { w.kcalManual = kcIn.value !== ''; w.kcal = +kcIn.value || 0; if (!w.kcalManual) recalc(); else autoLbl.textContent = '(직접 입력)'; };
  body.querySelectorAll('.it button').forEach((b) => (b.onclick = () => { w.intensity = b.dataset.k; body.querySelectorAll('.it button').forEach((x) => x.classList.toggle('on', x === b)); recalc(); }));
  drawTyped(); recalc();

  const close = sheet(`${TYPE[w.type].icon} ${TYPE[w.type].label} ${existing ? '수정' : '기록'}`, body);
  body.querySelector('[data-a=s]').onclick = () => {
    w.date = body.querySelector('.dt').value || ui.date;
    w.memo = body.querySelector('.me').value.trim();
    w.duration = +w.duration || 0;
    if (w.type === 'weight') w.sets = w.sets.filter((s) => s.name.trim());
    const i = db.workouts.findIndex((x) => x.id === w.id);
    if (i >= 0) db.workouts[i] = w; else db.workouts.push(w);
    save(); close(); rerender(); toast('운동을 저장했어요');
  };
  const del = body.querySelector('[data-a=d]');
  if (del) del.onclick = () => { ask('이 운동 기록을 삭제할까요?').then((ok) => { if (ok) { db.workouts = db.workouts.filter((x) => x.id !== w.id); save(); close(); rerender(); } }); };
}

/* ================= 인바디 ================= */
function renderInbody() {
  const up = h(`<div class="card"><h2>인바디 기록 추가</h2>
    <label class="drop"><b>📷 인바디 캡처 올리기</b><span class="small muted">결과 화면 또는 '변화' 그래프 화면 캡처를 올리면<br>체중·골격근·체지방률 등을 읽어서 입력해요</span>
      <input type="file" accept="image/*" hidden></label>
    <div class="status"></div>
    <button class="btn ghost block" data-a="manual" style="margin-top:10px">✏️ 직접 입력</button></div>`);
  const status = up.querySelector('.status');
  up.querySelector('input[type=file]').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    status.innerHTML = '';
    let jpeg;
    try {
      const img = await fileToImage(file);
      jpeg = imageToJpeg(img);
    } catch { return toast('이미지를 열 수 없어요'); }
    const sample = await sampleImageReady();
    const key = db.settings.apiKey;
    if (!sample && window.claude?.use) {
      status.appendChild(h(`<p class="small up">Claude가 캡처를 읽으려면 사용 허용이 필요해요. 페이지를 새로고침한 뒤 허용을 눌러 주세요. 지금은 '직접 입력'으로도 기록할 수 있어요.</p>`));
      return;
    }
    const smart = !!(sample || key);
    status.appendChild(h(`<img class="preview-img" src="${jpeg}" alt="">`));
    const msg = h(`<p class="row small"><span class="spinner"></span><span class="t">${smart ? 'Claude가 캡처를 읽는 중… (10~30초)' : '문자 인식(OCR) 중… 처음엔 엔진을 받느라 조금 걸려요'}</span></p>`);
    status.appendChild(msg);
    try {
      const res = sample
        ? await analyzeWithSample(sample, jpeg)
        : key
          ? await analyzeWithClaude(jpeg, key)
          : await analyzeWithOCR(jpeg, (p) => (msg.querySelector('.t').textContent = `문자 인식 중… ${Math.round(p * 100)}%`));
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
      <div class="detail">${wos.map((w) => `<span class="tag ${w.type}">${TYPE[w.type].icon} ${esc(workoutDetail(w))}</span>`).join('')}
        ${ib ? `<span class="tag">⚖️ ${nf(ib.weight)}kg${ib.pbf != null ? ' · ' + nf(ib.pbf) + '%' : ''}</span>` : ''}
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
      ${wos.length ? `<span class="ic">${[...new Set(wos.map((w) => TYPE[w.type].icon))].join('')}</span>` : ''}
      ${ib?.weight ? `<span class="w">${nf(ib.weight)}</span>` : ''}</div>`);
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
    body.appendChild(h(`<p class="small" style="margin:4px 0"><b>${l}</b> ${items.map((it) => `${esc(it.name)} ${nf(it.amount * it.qty, 2)}${esc(it.unit)}`).join(', ')} <span class="muted">· ${kc(items.reduce((a, it) => a + itemKcal(it), 0))}kcal</span></p>`));
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
applyBackground();
route();
initCloud().then((ok) => { if (ok) { applyBackground(); rerender(); } });
