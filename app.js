(() => {
  'use strict';

  const KEY = 'memyma.tasks.v1';
  const STATUS = ['todo', 'doing', 'done'];
  const STATUS_LABEL = { todo: '대기', doing: '진행 중', done: '완료' };
  const PRIORITY_LABEL = { 1: '낮음', 2: '보통', 3: '높음' };

  const $ = (s) => document.querySelector(s);
  const els = {
    form: $('#add-form'), title: $('#title'), priority: $('#priority'), due: $('#due'), tag: $('#tag'),
    tagList: $('#tag-list'), tabs: $('#tabs'), search: $('#search'), tagFilter: $('#tag-filter'),
    sort: $('#sort'), list: $('#list'), empty: $('#empty'), stats: $('#stats'), today: $('#today'),
    tpl: $('#item-tpl'), toast: $('#toast'), clearDone: $('#clear-done'), exportBtn: $('#export'), importInput: $('#import'),
  };

  const state = { view: 'all', query: '', tag: '', sort: 'smart' };
  let tasks = load();

  // ---------- storage ----------
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(data) ? data.filter(isTask) : [];
    } catch { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(tasks)); } catch { /* storage full or blocked */ }
  }
  function isTask(t) {
    return t && typeof t.id === 'string' && typeof t.title === 'string' && STATUS.includes(t.status);
  }

  // ---------- helpers ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function dueInfo(due) {
    if (!due) return null;
    const t = todayStr();
    const days = Math.round((new Date(due) - new Date(t)) / 86400000);
    if (days < 0) return { text: `${-days}일 지남`, cls: 'overdue' };
    if (days === 0) return { text: '오늘 마감', cls: 'due-today' };
    if (days === 1) return { text: '내일 마감', cls: '' };
    return { text: `${due.slice(5).replace('-', '/')} 마감 (D-${days})`, cls: '' };
  }

  // ---------- mutations ----------
  function add(title, priority, due, tag) {
    tasks.unshift({
      id: uid(), title, status: 'todo', priority: Number(priority) || 2,
      due: due || '', tag: tag.trim(), note: '', createdAt: Date.now(), doneAt: null,
    });
    commit();
  }
  function update(id, patch) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if ('status' in patch) t.doneAt = patch.status === 'done' ? Date.now() : null;
    commit();
  }
  function remove(id) {
    tasks = tasks.filter((t) => t.id !== id);
    commit();
  }
  function commit() { save(); render(); }

  // ---------- filtering / sorting ----------
  function matchesView(t, view) {
    if (view === 'all') return true;
    if (view === 'today') return t.status !== 'done' && t.due && t.due <= todayStr();
    return t.status === view;
  }
  function visible() {
    const q = state.query.toLowerCase();
    const list = tasks.filter((t) =>
      matchesView(t, state.view) &&
      (!state.tag || t.tag === state.tag) &&
      (!q || t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q) || t.tag.toLowerCase().includes(q))
    );
    const statusRank = { doing: 0, todo: 1, done: 2 };
    const dueKey = (t) => t.due || '9999-12-31';
    const sorters = {
      smart: (a, b) => statusRank[a.status] - statusRank[b.status] || dueKey(a).localeCompare(dueKey(b)) || b.priority - a.priority || b.createdAt - a.createdAt,
      due: (a, b) => dueKey(a).localeCompare(dueKey(b)) || b.priority - a.priority,
      priority: (a, b) => b.priority - a.priority || dueKey(a).localeCompare(dueKey(b)),
      created: (a, b) => b.createdAt - a.createdAt,
    };
    return list.sort(sorters[state.sort] || sorters.smart);
  }

  // ---------- render ----------
  function render() {
    const items = visible();
    els.list.replaceChildren(...items.map(renderItem));
    els.empty.hidden = items.length > 0;
    renderCounts();
    renderTags();
  }

  function renderItem(t) {
    const li = els.tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = t.id;
    li.classList.add(`s-${t.status}`, `p${t.priority}`);
    if (t.note) li.classList.add('has-note');
    li.querySelector('.status').textContent = STATUS_LABEL[t.status];
    li.querySelector('.title').textContent = t.title;

    const meta = li.querySelector('.meta');
    if (t.tag) meta.append(span(`#${t.tag}`, 'badge'));
    if (t.priority !== 2) meta.append(span(`우선순위 ${PRIORITY_LABEL[t.priority]}`));
    const d = t.status !== 'done' && dueInfo(t.due);
    if (d) meta.append(span(d.text, d.cls));
    if (t.status === 'done' && t.doneAt) meta.append(span(`완료 ${new Date(t.doneAt).toLocaleDateString('ko-KR')}`));

    const note = li.querySelector('.note');
    note.value = t.note;
    return li;
  }
  function span(text, cls = '') {
    const s = document.createElement('span');
    s.textContent = text;
    if (cls) s.className = cls;
    return s;
  }

  function renderCounts() {
    for (const btn of els.tabs.querySelectorAll('button')) {
      const n = tasks.filter((t) => matchesView(t, btn.dataset.view)).length;
      let c = btn.querySelector('.count');
      if (!c) { c = span('', 'count'); btn.append(c); }
      c.textContent = n;
    }
    const done = tasks.filter((t) => t.status === 'done').length;
    const doneToday = tasks.filter((t) => t.doneAt && new Date(t.doneAt).toDateString() === new Date().toDateString()).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    els.stats.innerHTML = '';
    els.stats.append(statEl('오늘 완료', doneToday), statEl('진행률', `${pct}%`));
  }
  function statEl(label, value) {
    const s = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = value;
    s.append(`${label} `, b);
    return s;
  }

  function renderTags() {
    const tags = [...new Set(tasks.map((t) => t.tag).filter(Boolean))].sort();
    els.tagList.replaceChildren(...tags.map((t) => Object.assign(document.createElement('option'), { value: t })));
    const cur = state.tag;
    els.tagFilter.replaceChildren(
      Object.assign(document.createElement('option'), { value: '', textContent: '모든 태그' }),
      ...tags.map((t) => Object.assign(document.createElement('option'), { value: t, textContent: `#${t}` }))
    );
    if (cur && !tags.includes(cur)) state.tag = '';
    els.tagFilter.value = state.tag;
  }

  // ---------- toast (with optional undo) ----------
  let toastTimer;
  function toast(msg, undo) {
    els.toast.replaceChildren(span(msg));
    if (undo) {
      const b = document.createElement('button');
      b.textContent = '되돌리기';
      b.addEventListener('click', () => { undo(); els.toast.hidden = true; });
      els.toast.append(b);
    }
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6000);
  }

  // ---------- inline title editing ----------
  function startEdit(titleEl, id) {
    titleEl.contentEditable = 'true';
    titleEl.focus();
    document.getSelection().selectAllChildren(titleEl);
    const finish = (commitEdit) => {
      titleEl.contentEditable = 'false';
      titleEl.removeEventListener('blur', onBlur);
      titleEl.removeEventListener('keydown', onKey);
      const text = titleEl.textContent.trim();
      if (commitEdit && text) update(id, { title: text });
      else render();
    };
    const onBlur = () => finish(true);
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') finish(false);
    };
    titleEl.addEventListener('blur', onBlur);
    titleEl.addEventListener('keydown', onKey);
  }

  // ---------- events ----------
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = els.title.value.trim();
    if (!title) return;
    add(title, els.priority.value, els.due.value, els.tag.value);
    els.title.value = '';
    els.priority.value = '2';
    els.due.value = '';
    els.title.focus();
  });

  els.list.addEventListener('click', (e) => {
    const li = e.target.closest('.item');
    if (!li) return;
    const id = li.dataset.id;
    const t = tasks.find((x) => x.id === id);
    if (e.target.closest('.status')) {
      update(id, { status: STATUS[(STATUS.indexOf(t.status) + 1) % STATUS.length] });
    } else if (e.target.closest('.del')) {
      const snapshot = tasks.slice();
      remove(id);
      toast(`"${t.title}" 삭제됨`, () => { tasks = snapshot; commit(); });
    } else if (e.target.closest('.note-btn')) {
      const note = li.querySelector('.note');
      note.hidden = !note.hidden;
      if (!note.hidden) note.focus();
    }
  });

  els.list.addEventListener('dblclick', (e) => {
    const titleEl = e.target.closest('.title');
    if (titleEl) startEdit(titleEl, titleEl.closest('.item').dataset.id);
  });

  // save notes without re-rendering (keeps focus while typing)
  els.list.addEventListener('input', (e) => {
    if (!e.target.classList.contains('note')) return;
    const li = e.target.closest('.item');
    const t = tasks.find((x) => x.id === li.dataset.id);
    if (!t) return;
    t.note = e.target.value;
    li.classList.toggle('has-note', !!t.note);
    save();
  });

  els.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    state.view = btn.dataset.view;
    els.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    render();
  });
  els.search.addEventListener('input', () => { state.query = els.search.value.trim(); render(); });
  els.tagFilter.addEventListener('change', () => { state.tag = els.tagFilter.value; render(); });
  els.sort.addEventListener('change', () => { state.sort = els.sort.value; render(); });

  els.clearDone.addEventListener('click', () => {
    const n = tasks.filter((t) => t.status === 'done').length;
    if (!n) return;
    const snapshot = tasks.slice();
    tasks = tasks.filter((t) => t.status !== 'done');
    commit();
    toast(`완료 항목 ${n}개를 지웠어요`, () => { tasks = snapshot; commit(); });
  });

  els.exportBtn.addEventListener('click', () => {
    const json = JSON.stringify(tasks, null, 2);
    navigator.clipboard?.writeText(json).then(
      () => toast('백업 데이터를 클립보드에 복사했어요'),
      () => toast('클립보드 복사가 막혀 있어요. 파일로 저장을 시도했어요')
    );
    const blob = new Blob([json], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `memyma-${todayStr()}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });

  els.importInput.addEventListener('change', async () => {
    const file = els.importInput.files[0];
    els.importInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('형식 오류');
      const valid = data.filter(isTask);
      const ids = new Set(tasks.map((t) => t.id));
      const added = valid.filter((t) => !ids.has(t.id));
      tasks = [...added, ...tasks];
      commit();
      toast(`${added.length}개 항목을 가져왔어요`);
    } catch {
      toast('파일을 읽을 수 없어요. memyma에서 내보낸 JSON 파일인지 확인해 주세요');
    }
  });

  // keyboard: "/" focuses search, "n" focuses new task
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select, [contenteditable=true]')) return;
    if (e.key === '/') { e.preventDefault(); els.search.focus(); }
    if (e.key === 'n') { e.preventDefault(); els.title.focus(); }
  });

  els.today.textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  render();
})();
