(() => {
  'use strict';

  const STORAGE_KEY = 'memyma:v1';
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- 데이터 ----------
  const emptyState = () => ({ debts: [], payments: [], incomes: [] });

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

  function totals() {
    const principal = sum(state.debts, (d) => d.principal);
    const paid = sum(state.payments, (p) => p.amount);
    const remaining = sum(state.debts, (d) => Math.max(0, d.principal - paidFor(d.id)));
    return { principal, paid, remaining };
  }

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

    $('#s-remaining').textContent = won(t.remaining);
    $('#s-remaining-sub').textContent = t.principal ? `처음 ${won(t.principal)}` : '빚 탭에서 추가해 보세요';
    $('#s-paid').textContent = won(t.paid);
    $('#s-paid-sub').textContent = `이번 달 ${won(monthPaid)}`;
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

    // 최근 3개월 평균 상환액으로 완납 예상
    const last3 = monthsBack(3);
    const avg = sum(state.payments.filter((p) => last3.includes(monthKey(p.date))), (p) => p.amount) / 3;
    const f = $('#s-forecast');
    if (!state.debts.length) f.textContent = '';
    else if (t.remaining <= 0) f.textContent = '🎉 모든 빚을 다 갚았어요!';
    else if (avg > 0) {
      const months = Math.ceil(t.remaining / avg);
      const end = new Date();
      end.setMonth(end.getMonth() + months);
      f.textContent = `최근 3개월 평균 월 ${won(avg)}씩 갚고 있어요. 이대로면 약 ${months}개월 뒤 (${end.getFullYear()}년 ${end.getMonth() + 1}월) 완납!`;
    } else f.textContent = '최근 3개월 상환 기록이 없어서 완납 시점을 예상할 수 없어요.';

    $('#chart-debt').innerHTML = debtChart();
    $('#chart-income').innerHTML = incomeChart();
  }

  function debtChart() {
    if (!state.debts.length) return '<p class="empty">빚을 추가하면 그래프가 나타나요</p>';
    const events = [
      ...state.debts.map((d) => ({ date: d.startDate, delta: d.principal })),
      ...state.payments.map((p) => ({ date: p.date, delta: -p.amount })),
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

    const list = $('#debt-list');
    if (!state.debts.length) {
      list.innerHTML = '<div class="card"><p class="empty">아직 등록된 빚이 없어요</p></div>';
      return;
    }
    list.innerHTML = state.debts.map((d) => {
      const paid = paidFor(d.id);
      const remain = Math.max(0, d.principal - paid);
      const pct = d.principal ? Math.min(100, (paid / d.principal) * 100) : 0;
      const pays = state.payments.filter((p) => p.debtId === d.id).sort(byDateDesc);
      return `<div class="card debt-item ${remain <= 0 ? 'done' : ''}">
        <div class="top">
          <span class="name">${esc(d.name)}</span>
          <span class="remain">${remain <= 0 ? '완납 🎉' : won(remain)}</span>
        </div>
        <div class="progress small"><div class="bar" style="width:${pct}%"></div></div>
        <div class="meta">${won(d.principal)} 중 ${won(paid)} 상환 (${pct.toFixed(1)}%) · ${fmtDate(d.startDate)} 시작</div>
        <details>
          <summary>상환 기록 ${pays.length}건</summary>
          ${pays.length ? `<ul class="list">${pays.map((p) => `
            <li>
              <div class="left"><div class="t">${fmtDate(p.date)}</div>${p.memo ? `<div class="d">${esc(p.memo)}</div>` : ''}</div>
              <div class="right"><span class="amt-good">−${won(p.amount)}</span>
                <button class="ghost" data-del-payment="${esc(p.id)}">삭제</button></div>
            </li>`).join('')}</ul>` : '<p class="empty">기록 없음</p>'}
          <div class="row" style="margin-top:10px"><button class="ghost" data-del-debt="${esc(d.id)}">이 빚 삭제</button></div>
        </details>
      </div>`;
    }).join('');
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
    state.debts.push({ id: uid(), name: f.get('name').trim(), principal, startDate: f.get('startDate') });
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
    state.payments.push({ id: uid(), debtId, amount, date: f.get('date'), memo: f.get('memo').trim() });
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
      state.payments = state.payments.filter((p) => p.debtId !== t.dataset.delDebt); save();
    }
  });

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `memyma-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = normalize(JSON.parse(await file.text()));
      if (!confirm('지금 데이터를 백업 파일 내용으로 바꿀까요?')) return;
      state = data; save(); toast('불러오기 완료');
    } catch {
      toast('백업 파일을 읽지 못했어요');
    } finally {
      e.target.value = '';
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
