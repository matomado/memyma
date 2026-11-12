(() => {
  'use strict';

  const STORAGE_KEY = 'memyma:v1';
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- 데이터 ----------
  // debts: { id, name, principal(처음 빌린 돈), paidBefore(기록 시작 전에 이미 갚은 돈), startDate,
  //          rate(연이율 %), monthly(매달 고정으로 나가는 상환액), interestOnly(이자만 내는 중), dueDate(만기일) }
  // payments: { id, debtId, amount, date, memo, source('salary'|'side'|'other') }
  // adjustments: 은행 앱 실제 잔액에 맞추면서 생긴 차이(이자 등)
  // plan: { salary(월급에서 매달 빚 갚는 데 쓸 돈), sideRatio(부수입 중 빚 갚는 데 쓸 %), order(갚는 순서) }
  const emptyPlan = () => ({ salary: 0, sideRatio: 100, order: [] });
  const emptyState = () => ({ debts: [], payments: [], incomes: [], adjustments: [], plan: emptyPlan() });

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      return normalize(JSON.parse(raw));
    } catch {
      return emptyState();
    }
  }

  function normalize(d) {
    if (!d || typeof d !== 'object') throw new Error('잘못된 데이터');
    return {
      debts: Array.isArray(d.debts) ? d.debts : [],
      payments: Array.isArray(d.payments) ? d.payments : [],
      incomes: Array.isArray(d.incomes) ? d.incomes : [],
      adjustments: Array.isArray(d.adjustments) ? d.adjustments : [],
      plan: { ...emptyPlan(), ...(d.plan && typeof d.plan === 'object' ? d.plan : {}) },
    };
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      toast('저장에 실패했어요. 백업 파일을 내려받아 두세요.');
    }
    render();
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- 유틸 ----------
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const shortWon = (n) => {
    const a = Math.abs(n);
    if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억';
    if (a >= 1e4) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
    return Math.round(n).toLocaleString('ko-KR');
  };
  const parseAmount = (s) => {
    const n = Number(String(s).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const parseRate = (s) => {
    const n = parseFloat(String(s ?? '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const monthKey = (dateStr) => dateStr.slice(0, 7);
  const fmtDate = (s) => s.replace(/-/g, '.');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
  const byDateDesc = (a, b) => b.date.localeCompare(a.date);

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // 금액 입력칸: 입력하면서 자동으로 천 단위 콤마
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('input[inputmode="numeric"]')) {
      const digits = el.value.replace(/[^\d]/g, '');
      el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
    }
  });

  // ---------- 계산 ----------
  const paidFor = (debtId) => sum(state.payments.filter((p) => p.debtId === debtId), (p) => p.amount);
  const adjustFor = (debtId) => sum(state.adjustments.filter((a) => a.debtId === debtId), (a) => a.amount);
  const paidTotalFor = (d) => (d.paidBefore || 0) + paidFor(d.id);
  const remainingFor = (d) => Math.max(0, d.principal - paidTotalFor(d) + adjustFor(d.id));
  const monthlyInterestOf = (d) => remainingFor(d) * (d.rate || 0) / 100 / 12;

  function totals() {
    const principal = sum(state.debts, (d) => d.principal);
    const paid = sum(state.debts, paidTotalFor);
    const remaining = sum(state.debts, remainingFor);
    return { principal, paid, remaining };
  }

  // 상환 순서: 저장된 순서 + 새로 추가된 빚은 뒤에
  function orderedDebts() {
    const ids = state.plan.order.filter((id) => state.debts.some((d) => d.id === id));
    state.debts.forEach((d) => { if (!ids.includes(d.id)) ids.push(d.id); });
    return ids.map((id) => state.debts.find((d) => d.id === id));
  }

  // 평균 낼 기간: 최근 3개월. 기록을 시작한 지 3개월이 안 됐으면 시작한 달부터
  function recentMonths() {
    const starts = [...state.debts.map((d) => d.startDate), ...state.payments.map((p) => p.date), ...state.incomes.map((i) => i.date)].filter(Boolean).sort();
    const months = monthsBack(3);
    if (!starts.length) return months;
    const first = monthKey(starts[0]);
    const within = months.filter((m) => m >= first);
    return within.length ? within : months.slice(-1);
  }
  const avgOver = (items, f = (x) => x.amount) => {
    const months = recentMonths();
    return sum(items.filter((x) => months.includes(monthKey(x.date))), f) / months.length;
  };
  const sideIncomeAvg = () => avgOver(state.incomes);
  const salaryPaymentAvg = () => avgOver(state.payments.filter((p) => p.source === 'salary'));
  const recentPaymentAvg = (debtId) => avgOver(state.payments.filter((p) => p.debtId === debtId));
  // 월급 상환액: 정해 두면 그 금액, 비워 두면 실제 월급 상환 기록 평균
  const salaryForPlan = () => (state.plan.salary > 0 ? { amount: state.plan.salary, auto: false } : { amount: salaryPaymentAvg(), auto: true });

  // 한 달씩 굴려 보는 상환 시뮬레이션
  //  1) 이자 붙이기 (이자만 내는 빚은 이자를 따로 내니까 잔액에 안 붙음)
  //  2) 빚마다 정해진 고정 상환액 납부
  //  3) 남는 돈(월급 + 부수입 + 다 갚은 빚의 고정 상환액)을 정한 순서대로 몰아서 갚기
  function simulatePlan() {
    const plan = state.plan;
    const sideAvg = sideIncomeAvg();
    const side = sideAvg * (plan.sideRatio ?? 100) / 100;
    const salary = salaryForPlan();
    const extra = salary.amount + side;
    const debts = orderedDebts().map((d) => {
      let fixed = d.monthly || 0;
      // 계획이 없으면 그 빚의 최근 상환 평균으로 대신 계산
      if (!extra && !fixed && !d.interestOnly) fixed = recentPaymentAvg(d.id);
      return { d, bal: remainingFor(d), r: (d.rate || 0) / 100 / 12, fixed, interest: 0, months: null };
    });
    const result = { sideAvg, side, salary, extra, fixedTotal: sum(debts, (x) => x.fixed), byId: {}, totalInterest: 0, months: 0 };

    let active = debts.filter((x) => x.bal > 0.5);
    debts.filter((x) => x.bal <= 0.5).forEach((x) => (x.months = 0));
    let m = 0;
    while (active.length && m < 600) {
      m++;
      let pool = extra;
      for (const x of active) {
        const i = x.bal * x.r;
        x.interest += i;
        if (!x.d.interestOnly) x.bal += i;
      }
      for (const x of debts) {
        if (!x.fixed) continue;
        if (x.bal <= 0.5) { pool += x.fixed; continue; }
        const pay = Math.min(x.fixed, x.bal);
        x.bal -= pay; pool += x.fixed - pay;
      }
      for (const x of active) {
        if (pool <= 0) break;
        const pay = Math.min(pool, x.bal);
        x.bal -= pay; pool -= pay;
      }
      active = active.filter((x) => {
        if (x.bal <= 0.5) { x.months = m; return false; }
        return true;
      });
      // 갚는 돈이 없거나 이자도 못 따라가면 더 돌릴 필요 없음
      if (m === 1 && !extra && !result.fixedTotal) break;
    }

    for (const x of debts) {
      let status;
      if (x.months === 0) status = 'done';
      else if (x.months != null) status = 'ok';
      else if (x.d.interestOnly) status = 'interestOnly';
      else if (!extra && !x.fixed) status = 'nopay';
      else status = 'stuck';
      result.byId[x.d.id] = { status, months: x.months, interest: x.interest, monthlyInterest: monthlyInterestOf(x.d), dueDate: x.d.dueDate };
      if (status === 'ok') { result.totalInterest += x.interest; result.months = Math.max(result.months, x.months); }
    }
    return result;
  }

  const monthLabel = (months) => {
    const end = new Date();
    end.setMonth(end.getMonth() + months);
    return `${end.getFullYear()}년 ${end.getMonth() + 1}월`;
  };
  const durLabel = (m) => (m >= 12 ? `${Math.floor(m / 12)}년 ${m % 12 ? (m % 12) + '개월' : ''}`.trim() : `${m}개월`);

  function monthsBack(n) {
    const out = [];
    const d = new Date();
    d.setDate(1);
    for (let i = n - 1; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  }

  // ---------- 렌더 ----------
  function render() {
    renderSummary();
    renderDebts();
    renderIncome();
  }

  function renderSummary() {
    const t = totals();
    const thisMonth = monthKey(todayStr());
    const lastMonthKey = monthsBack(2)[0];
    const monthIncome = sum(state.incomes.filter((i) => monthKey(i.date) === thisMonth), (i) => i.amount);
    const lastMonthIncome = sum(state.incomes.filter((i) => monthKey(i.date) === lastMonthKey), (i) => i.amount);
    const totalIncome = sum(state.incomes, (i) => i.amount);
    const monthPaid = sum(state.payments.filter((p) => monthKey(p.date) === thisMonth), (p) => p.amount);
    const sidePaid = sum(state.payments.filter((p) => p.source === 'side'), (p) => p.amount);

    $('#s-remaining').textContent = won(t.remaining);
    $('#s-remaining-sub').textContent = t.principal ? `처음 ${won(t.principal)}` : '빚 탭에서 추가해 보세요';
    $('#s-paid').textContent = won(t.paid);
    $('#s-paid-sub').textContent = `이번 달 ${won(monthPaid)}` + (sidePaid ? ` · 부수입으로 ${won(sidePaid)}` : '');
    $('#s-month-income').textContent = won(monthIncome);
    const diff = monthIncome - lastMonthIncome;
    $('#s-month-income-sub').textContent = lastMonthIncome || monthIncome
      ? `지난달보다 ${diff >= 0 ? '+' : '−'}${won(Math.abs(diff))}`
      : '부수입 탭에서 기록해 보세요';
    $('#s-total-income').textContent = won(totalIncome);
    $('#s-total-income-sub').textContent = `${state.incomes.length}건`;

    const pct = t.principal ? Math.min(100, ((t.principal - t.remaining) / t.principal) * 100) : 0;
    $('#s-progress-pct').textContent = pct.toFixed(1) + '%';
    $('#s-progress-bar').style.width = pct + '%';

    renderForecast(t);

    $('#chart-debt').innerHTML = debtChart();
    $('#chart-income').innerHTML = incomeChart();
  }

  function renderForecast(t) {
    const box = $('#s-forecast');
    if (!state.debts.length) { box.innerHTML = ''; return; }
    if (t.remaining <= 0) { box.innerHTML = '<p class="big-forecast">🎉 모든 빚을 다 갚았어요!</p>'; return; }

    const sim = simulatePlan();
    const rows = orderedDebts().filter((d) => remainingFor(d) > 0);
    const res = rows.map((d) => ({ d, f: sim.byId[d.id] }));
    const blocking = res.filter((x) => x.f.status === 'stuck' || x.f.status === 'nopay');
    const ok = res.filter((x) => x.f.status === 'ok');

    let head = '';
    if (!sim.extra && !sim.fixedTotal) {
      head = `<p class="big-forecast">갚은 기록이 쌓이면 완납 시점이 나와요</p>
        <p class="hint">월급이나 부수입으로 갚은 기록이 쌓이면 그 평균으로 완납 시점을 계산해요.
        정해 둔 금액이 있으면 빚 탭 맨 위 <b>상환 계획</b>에 넣어도 돼요.</p>`;
    } else if (blocking.length) {
      head = `<p class="big-forecast">지금 계획으로는 다 못 갚아요</p>
        <p class="hint warn">매달 갚는 돈이 이자보다 적어요. 상환 계획 금액을 늘려 보세요.</p>`;
    } else if (ok.length) {
      const allOk = ok.length === res.length;
      head = `<p class="big-forecast">${monthLabel(sim.months)} ${allOk ? '모든 빚 완납' : '완납'} 예상 <span>(${durLabel(sim.months)} 뒤)</span></p>
        <p class="hint">앞으로 낼 이자는 약 <b>${won(sim.totalInterest)}</b>이에요.</p>`;
    } else {
      head = `<p class="big-forecast">이자만 내는 중이에요</p>`;
    }
    if (sim.extra) {
      const n = recentMonths().length;
      head += `<p class="hint">매달 ${won(sim.extra)}을 순서대로 갚는 계산이에요:
        월급 ${won(sim.salary.amount)}${sim.salary.auto ? ` (최근 ${n}개월 상환 기록 평균)` : ''}
        + 부수입 ${won(sim.side)} (최근 ${n}개월 평균${state.plan.sideRatio < 100 ? `의 ${state.plan.sideRatio}%` : ''}).</p>`;
    }
    const list = res.map(({ d, f }, idx) => `<li>
        <div class="left"><div class="t">${idx + 1}. ${esc(d.name)}</div>
          <div class="d">${won(remainingFor(d))} · 연 ${d.rate || 0}%</div></div>
        <div class="right">${forecastText(f)}</div></li>`).join('');
    box.innerHTML = head + `<ul class="list forecast-list">${list}</ul>`;
  }

  function forecastText(f) {
    if (!f || f.status === 'done') return '<span class="amt-good">완납</span>';
    if (f.status === 'nopay') return '<span class="warn">상환 계획 필요</span>';
    if (f.status === 'stuck') return `<span class="warn">이자(월 ${won(f.monthlyInterest)})를<br>못 따라가요</span>`;
    if (f.status === 'interestOnly') return `<span>이자만 내는 중<br><small>월 약 ${won(f.monthlyInterest)}${f.dueDate ? ` · 만기 ${fmtDate(f.dueDate)}` : ''}</small></span>`;
    const end = new Date();
    end.setMonth(end.getMonth() + f.months);
    const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
    const late = f.dueDate && endKey > monthKey(f.dueDate)
      ? `<br><small class="warn">만기(${fmtDate(f.dueDate).slice(0, 7)})보다 늦어요</small>` : '';
    return `<span>${monthLabel(f.months)}<br><small>이자 ${won(f.interest)}</small>${late}</span>`;
  }

  function debtChart() {
    if (!state.debts.length) return '<p class="empty">빚을 추가하면 그래프가 나타나요</p>';
    const events = [
      ...state.debts.map((d) => ({ date: d.startDate, delta: d.principal - (d.paidBefore || 0) })),
      ...state.payments.map((p) => ({ date: p.date, delta: -p.amount })),
      ...state.adjustments.map((a) => ({ date: a.date, delta: a.amount })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    // 날짜별로 합쳐서 누적 잔액
    const points = [];
    let bal = 0;
    for (const e of events) {
      bal += e.delta;
      const last = points[points.length - 1];
      if (last && last.date === e.date) last.v = Math.max(0, bal);
      else points.push({ date: e.date, v: Math.max(0, bal) });
    }
    const today = todayStr();
    if (points[points.length - 1].date < today) points.push({ date: today, v: points[points.length - 1].v });

    const W = 640, H = 260, L = 64, R = 12, T = 14, B = 34;
    const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date);
    const span = Math.max(1, t1 - t0);
    const maxV = Math.max(...points.map((p) => p.v), 1);
    const x = (d) => L + ((Date.parse(d) - t0) / span) * (W - L - R);
    const y = (v) => T + (1 - v / maxV) * (H - T - B);

    // 계단형 선 (상환은 그날 한 번에 줄어드니까)
    let path = `M${x(points[0].date)},${y(points[0].v)}`;
    for (let i = 1; i < points.length; i++) {
      path += ` H${x(points[i].date)} V${y(points[i].v)}`;
    }
    const area = `${path} V${y(0)} H${x(points[0].date)} Z`;

    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const v = (maxV * i) / 4;
      grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      grid += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${shortWon(v)}</text>`;
    }
    const labels = `<text x="${L}" y="${H - 8}">${fmtDate(points[0].date)}</text>
      <text x="${W - R}" y="${H - 8}" text-anchor="end">${fmtDate(points[points.length - 1].date)}</text>`;

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="남은 빚 추이">
      ${grid}<path class="area-debt" d="${area}"/><path class="line-debt" d="${path}"/>${labels}</svg>`;
  }

  function incomeChart() {
    const months = monthsBack(12);
    const vals = months.map((m) => sum(state.incomes.filter((i) => monthKey(i.date) === m), (i) => i.amount));
    if (!vals.some((v) => v > 0)) return '<p class="empty">부수입을 기록하면 그래프가 나타나요</p>';

    const W = 640, H = 260, L = 8, R = 8, T = 28, B = 34;
    const maxV = Math.max(...vals, 1);
    const slot = (W - L - R) / months.length;
    const bw = slot * 0.62;
    let bars = '';
    months.forEach((m, i) => {
      const h = (vals[i] / maxV) * (H - T - B);
      const bx = L + i * slot + (slot - bw) / 2;
      const by = H - B - h;
      if (vals[i] > 0) {
        bars += `<rect class="bar-income" x="${bx}" y="${by}" width="${bw}" height="${Math.max(h, 1)}" rx="4"><title>${m} ${won(vals[i])}</title></rect>`;
        bars += `<text class="val" x="${bx + bw / 2}" y="${by - 6}" text-anchor="middle">${shortWon(vals[i])}</text>`;
      }
      bars += `<text x="${bx + bw / 2}" y="${H - 8}" text-anchor="middle">${Number(m.slice(5))}월</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 부수입">
      <line class="grid" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>${bars}</svg>`;
  }

  function renderDebts() {
    const sel = $('#form-payment select[name="debtId"]');
    const prev = sel.value;
    sel.innerHTML = state.debts.length
      ? state.debts.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')
      : '<option value="">먼저 빚을 추가하세요</option>';
    if (state.debts.some((d) => d.id === prev)) sel.value = prev;

    renderPlan();

    const list = $('#debt-list');
    if (!state.debts.length) {
      list.innerHTML = '<div class="card"><p class="empty">아직 등록된 빚이 없어요</p></div>';
      return;
    }
    const sim = simulatePlan();
    list.innerHTML = state.debts.map((d) => {
      const paid = paidTotalFor(d);
      const remain = remainingFor(d);
      const pct = d.principal ? Math.max(0, Math.min(100, ((d.principal - remain) / d.principal) * 100)) : 0;
      const f = sim.byId[d.id];
      const pays = [
        ...state.payments.filter((p) => p.debtId === d.id).map((p) => ({ ...p, kind: 'pay' })),
        ...state.adjustments.filter((a) => a.debtId === d.id).map((a) => ({ ...a, kind: 'adj' })),
      ].sort(byDateDesc);
      return `<div class="card debt-item ${remain <= 0 ? 'done' : ''}">
        <div class="top">
          <span class="name">${esc(d.name)}</span>
          <span class="remain">${remain <= 0 ? '완납 🎉' : won(remain)}</span>
        </div>
        <div class="progress small"><div class="bar" style="width:${pct}%"></div></div>
        <div class="meta">${won(d.principal)} 중 ${won(paid)} 상환 (${pct.toFixed(1)}%)${d.paidBefore ? ` · 기록 전 ${won(d.paidBefore)} 포함` : ''}
          · 연 ${d.rate || 0}%${d.dueDate ? ` · 만기 ${fmtDate(d.dueDate)}` : ''}${d.interestOnly ? ' · <b>이자만 내는 중</b>' : ''}</div>
        ${remain > 0 ? `<div class="debt-forecast">완납 예상: ${forecastText(f).replace(/<br>/g, ' ')}</div>` : ''}
        <details>
          <summary>상환 기록 ${pays.length}건</summary>
          ${pays.length ? `<ul class="list">${pays.map((p) => p.kind === 'pay' ? `
            <li>
              <div class="left"><div class="t">${fmtDate(p.date)}${p.source ? ` <span class="tag ${p.source}">${SOURCE_LABEL[p.source] || ''}</span>` : ''}</div>${p.memo ? `<div class="d">${esc(p.memo)}</div>` : ''}</div>
              <div class="right"><span class="amt-good">−${won(p.amount)}</span>
                <button class="ghost" data-del-payment="${esc(p.id)}">삭제</button></div>
            </li>` : `
            <li>
              <div class="left"><div class="t">${fmtDate(p.date)}</div><div class="d">잔액 맞추기 (이자 등)</div></div>
              <div class="right"><span class="${p.amount > 0 ? 'warn' : 'amt-good'}">${p.amount > 0 ? '+' : '−'}${won(Math.abs(p.amount))}</span>
                <button class="ghost" data-del-adjust="${esc(p.id)}">삭제</button></div>
            </li>`).join('')}</ul>` : '<p class="empty">기록 없음</p>'}
        </details>
        <details>
          <summary>이자율 · 만기 · 잔액 수정</summary>
          <form class="form debt-edit" data-debt-id="${esc(d.id)}">
            <label>연이율 (%)<input name="rate" inputmode="decimal" value="${d.rate || ''}" placeholder="4.5" /></label>
            <label>만기일<input name="dueDate" type="date" value="${esc(d.dueDate || '')}" /></label>
            <label>기록 전에 이미 갚은 돈<input name="paidBefore" inputmode="numeric" value="${d.paidBefore ? d.paidBefore.toLocaleString('ko-KR') : ''}" placeholder="0" /></label>
            <label>매달 고정 상환액 <small>(원리금 자동이체 등)</small><input name="monthly" inputmode="numeric" value="${d.monthly ? d.monthly.toLocaleString('ko-KR') : ''}" placeholder="없으면 비워두기" /></label>
            <label class="check full"><input type="checkbox" name="interestOnly" ${d.interestOnly ? 'checked' : ''} /> 지금은 이자만 내는 중 (원금은 만기에 갚거나 순서가 오면 갚기)</label>
            <label class="full">실제 남은 잔액 <small>(은행 앱에 나온 금액. 이자가 붙어 차이가 나면 입력)</small>
              <input name="balance" inputmode="numeric" placeholder="${remain.toLocaleString('ko-KR')}" /></label>
            <button type="submit">저장</button>
          </form>
          <div class="row" style="margin-top:10px"><button class="ghost" data-del-debt="${esc(d.id)}">이 빚 삭제</button></div>
        </details>
      </div>`;
    }).join('');
  }

  const SOURCE_LABEL = { salary: '월급', side: '부수입', other: '기타' };

  function renderPlan() {
    const form = $('#form-plan');
    if (document.activeElement?.form !== form) {
      form.salary.value = state.plan.salary ? state.plan.salary.toLocaleString('ko-KR') : '';
      form.sideRatio.value = state.plan.sideRatio ?? 100;
    }
    const n = recentMonths().length;
    $('#plan-side-hint').textContent = `최근 ${n}개월 평균 — 월급으로 갚은 돈: 월 ${won(salaryPaymentAvg())} · 부수입: 월 ${won(sideIncomeAvg())}`;
    const debts = orderedDebts();
    $('#plan-order').innerHTML = debts.length
      ? debts.map((d, i) => `<li>
          <div class="left"><div class="t">${i + 1}. ${esc(d.name)}</div>
            <div class="d">${remainingFor(d) > 0 ? won(remainingFor(d)) : '완납'} · 연 ${d.rate || 0}%</div></div>
          <div class="right">
            <button type="button" class="ghost" data-move="${esc(d.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="위로">▲</button>
            <button type="button" class="ghost" data-move="${esc(d.id)}" data-dir="1" ${i === debts.length - 1 ? 'disabled' : ''} aria-label="아래로">▼</button>
          </div></li>`).join('')
      : '<li class="empty">빚을 추가하면 여기서 순서를 정할 수 있어요</li>';
  }

  function renderIncome() {
    const sources = [...new Set(state.incomes.map((i) => i.source))];
    $('#source-list').innerHTML = sources.map((s) => `<option value="${esc(s)}"></option>`).join('');

    const total = sum(state.incomes, (i) => i.amount);
    const bySource = sources
      .map((s) => ({ s, v: sum(state.incomes.filter((i) => i.source === s), (i) => i.amount) }))
      .sort((a, b) => b.v - a.v);
    $('#income-by-source').innerHTML = bySource.length
      ? bySource.map(({ s, v }) => `<div class="source-row">
          <div class="top"><span>${esc(s)}</span><span class="amt-accent">${won(v)}</span></div>
          <div class="progress small"><div class="bar" style="width:${total ? (v / total) * 100 : 0}%"></div></div>
        </div>`).join('')
      : '<p class="empty">아직 기록이 없어요</p>';

    const items = [...state.incomes].sort(byDateDesc);
    $('#income-list').innerHTML = items.length
      ? `<ul class="list">${items.map((i) => `
          <li>
            <div class="left"><div class="t">${esc(i.source)}</div><div class="d">${fmtDate(i.date)}${i.memo ? ' · ' + esc(i.memo) : ''}</div></div>
            <div class="right"><span class="amt-accent">+${won(i.amount)}</span>
              <button class="ghost" data-del-income="${esc(i.id)}">삭제</button></div>
          </li>`).join('')}</ul>`
      : '<p class="empty">아직 기록이 없어요</p>';
  }

  // ---------- 이벤트 ----------
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
    });
  });

  function resetDates() {
    document.querySelectorAll('input[type="date"]').forEach((el) => { if (!el.value) el.value = todayStr(); });
  }

  $('#form-debt').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const principal = parseAmount(f.get('principal'));
    if (principal <= 0) return toast('금액을 확인해 주세요');
    state.debts.push({
      id: uid(), name: f.get('name').trim(), principal, startDate: f.get('startDate'),
      paidBefore: parseAmount(f.get('paidBefore')), rate: parseRate(f.get('rate')),
      monthly: 0, interestOnly: f.get('interestOnly') === 'on', dueDate: '',
    });
    e.target.reset(); resetDates(); save();
    toast('빚을 추가했어요');
  });

  $('#form-payment').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const debtId = f.get('debtId');
    const amount = parseAmount(f.get('amount'));
    if (!debtId) return toast('먼저 빚을 추가해 주세요');
    if (amount <= 0) return toast('금액을 확인해 주세요');
    state.payments.push({ id: uid(), debtId, amount, date: f.get('date'), memo: f.get('memo').trim(), source: f.get('source') });
    e.target.amount.value = ''; e.target.memo.value = ''; save();
    toast(`${won(amount)} 상환 기록 완료 💪`);
  });

  $('#form-income').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = parseAmount(f.get('amount'));
    if (amount <= 0) return toast('금액을 확인해 주세요');
    state.incomes.push({ id: uid(), source: f.get('source').trim(), amount, date: f.get('date'), memo: f.get('memo').trim() });
    e.target.amount.value = ''; e.target.memo.value = ''; save();
    toast(`+${won(amount)} 기록 완료`);
  });

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.delPayment && confirm('이 상환 기록을 삭제할까요?')) {
      state.payments = state.payments.filter((p) => p.id !== t.dataset.delPayment); save();
    } else if (t.dataset.delIncome && confirm('이 부수입 기록을 삭제할까요?')) {
      state.incomes = state.incomes.filter((i) => i.id !== t.dataset.delIncome); save();
    } else if (t.dataset.delDebt && confirm('이 빚과 상환 기록을 모두 삭제할까요?')) {
      state.debts = state.debts.filter((d) => d.id !== t.dataset.delDebt);
      state.payments = state.payments.filter((p) => p.debtId !== t.dataset.delDebt);
      state.adjustments = state.adjustments.filter((a) => a.debtId !== t.dataset.delDebt); save();
    } else if (t.dataset.delAdjust && confirm('이 잔액 조정 기록을 삭제할까요?')) {
      state.adjustments = state.adjustments.filter((a) => a.id !== t.dataset.delAdjust); save();
    } else if (t.dataset.move) {
      const ids = orderedDebts().map((d) => d.id);
      const i = ids.indexOf(t.dataset.move), j = i + Number(t.dataset.dir);
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      state.plan.order = ids; save();
    }
  });

  // 빚별 이자율/월 상환액/실제 잔액 수정
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('.debt-edit');
    if (!form) return;
    e.preventDefault();
    const d = state.debts.find((x) => x.id === form.dataset.debtId);
    if (!d) return;
    d.rate = parseRate(form.rate.value);
    d.monthly = parseAmount(form.monthly.value);
    d.dueDate = form.dueDate.value;
    d.interestOnly = form.interestOnly.checked;
    d.paidBefore = parseAmount(form.paidBefore.value);
    if (form.balance.value.trim() !== '') {
      const diff = parseAmount(form.balance.value) - remainingFor(d);
      if (Math.round(diff) !== 0) state.adjustments.push({ id: uid(), debtId: d.id, amount: diff, date: todayStr() });
    }
    save();
    toast('저장했어요');
  });

  $('#form-plan').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    state.plan.salary = parseAmount(f.salary.value);
    state.plan.sideRatio = Math.min(100, Math.max(0, parseRate(f.sideRatio.value)));
    state.plan.order = orderedDebts().map((d) => d.id);
    save();
    toast('상환 계획을 저장했어요');
  });

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `memyma-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });

  function importText(text, from) {
    const status = $('#import-status');
    let data;
    try {
      data = normalize(JSON.parse(text.trim()));
    } catch {
      status.textContent = `❌ ${from} 내용을 읽지 못했어요. memyma 백업 파일이 맞는지 확인해 주세요.`;
      return false;
    }
    if (!confirm(`빚 ${data.debts.length}개, 상환 ${data.payments.length}건, 부수입 ${data.incomes.length}건이 들어 있어요.\n지금 데이터를 이 내용으로 바꿀까요?`)) {
      status.textContent = '불러오기를 취소했어요.';
      return false;
    }
    state = data; save();
    status.textContent = `✅ 불러오기 완료! 빚 ${data.debts.length}개를 불러왔어요. 요약 탭을 확인해 보세요.`;
    toast('불러오기 완료');
    return true;
  }

  // 버튼으로 파일 선택 창 열기 (숨긴 input을 label로 여는 방식은 일부 폰에서 안 열려서)
  $('#btn-import').addEventListener('click', () => {
    $('#import-status').textContent = '';
    $('#file-import').click();
  });

  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('#import-status').textContent = `"${file.name}" 읽는 중…`;
    try {
      importText(await file.text(), '파일');
    } catch {
      $('#import-status').textContent = '❌ 파일을 열지 못했어요. 아래 붙여넣기 방법을 써 보세요.';
    } finally {
      e.target.value = '';
    }
  });

  $('#btn-paste-import').addEventListener('click', () => {
    const box = $('#paste-import');
    if (!box.value.trim()) return toast('먼저 백업 내용을 붙여넣어 주세요');
    if (importText(box.value, '붙여넣은')) box.value = '';
  });

  $('#btn-copy-export').addEventListener('click', async () => {
    const text = JSON.stringify(state);
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했어요. 다른 기기에 붙여넣으세요');
    } catch {
      const box = $('#paste-import');
      box.value = text; box.select();
      toast('칸에 넣어 뒀어요. 길게 눌러 복사하세요');
    }
  });

  $('#btn-reset').addEventListener('click', () => {
    if (confirm('정말 모든 데이터를 삭제할까요? 되돌릴 수 없어요.')) {
      state = emptyState(); save(); toast('초기화했어요');
    }
  });

  resetDates();
  render();
})();
