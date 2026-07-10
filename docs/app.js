const ANONYMOUS_MODE = false;

const AUTHORS = 'Jonathan Salfity, Robert Blake Anderson, and Mitch Pryor';
const AFFIL   = 'Nuclear and Applied Robotics Group · The University of Texas at Austin';

const DATA_URL = 'data/catalog.json';

const state = {
  catalog: null,
  batches: [],
  currentEnv:    null,
  currentModel:  null,
  currentMethod: null,
  currentSuite:  null,
  currentBatch:  null,
  currentTask:   null,
};

const els = {
  authorLine:        document.getElementById('authorLine'),
  affilLine:         document.getElementById('affilLine'),
  envSelect:         document.getElementById('envSelect'),
  modelSelect:       document.getElementById('modelSelect'),
  methodSelect:      document.getElementById('methodSelect'),
  suiteSelect:       document.getElementById('suiteSelect'),
  batchSummary:      document.getElementById('batchSummary'),
  taskList:          document.getElementById('taskList'),
  taskListMeta:      document.getElementById('taskListMeta'),
  taskBadgeRow:      document.getElementById('taskBadgeRow'),
  taskPrompt:        document.getElementById('taskPrompt'),
  btTreeView:        document.getElementById('btTreeView'),
  btFormatMeta:      document.getElementById('btFormatMeta'),
  btRawView:         document.getElementById('btRawView'),
  taskSpecSection:   document.getElementById('taskSpecSection'),
  taskSpecView:      document.getElementById('taskSpecView'),
  taskSpecRawView:   document.getElementById('taskSpecRawView'),
  resultSummaryView: document.getElementById('resultSummaryView'),
  resultView:        document.getElementById('resultView'),
  rootstocksPanel:   document.getElementById('rootstocksPanel'),
  rootstocksView:    document.getElementById('rootstocksView'),
  explorerBody:      document.getElementById('explorerBody'),
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(v) {
  return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function pretty(v) { return JSON.stringify(v ?? {}, null, 2); }

function formatRate(v) {
  if (typeof v !== 'number') return 'n/a';
  return `${Math.round(v * 100)}%`;
}

function badge(label, tone = '') {
  return `<span class="badge${tone ? ' badge--' + tone : ''}">${escapeHtml(label)}</span>`;
}

function tile(label, value, note = '') {
  return `<div class="stat-tile">
    <div class="stat-tile__label">${escapeHtml(label)}</div>
    <div class="stat-tile__value">${escapeHtml(String(value))}</div>
    ${note ? `<div class="stat-tile__note">${escapeHtml(note)}</div>` : ''}
  </div>`;
}

function setOptions(select, items, selected) {
  select.innerHTML = '';
  items.forEach(({value, label}) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    if (value === selected) o.selected = true;
    select.appendChild(o);
  });
}

// ─── Author visibility ─────────────────────────────────────────────────────────

function applyAnonymousMode() {
  if (!ANONYMOUS_MODE) {
    els.authorLine.textContent = AUTHORS;
    els.affilLine.textContent  = AFFIL;
  }
  // anonymous defaults already set in HTML
}

// ─── Filtering & selection ────────────────────────────────────────────────────

function allBatchEnvs() {
  return [...new Set(state.batches.map(b => b.environment))].sort();
}

function allModels() {
  return state.catalog?.models ?? [];
}

function allSelected() {
  return state.currentEnv && state.currentModel && state.currentMethod && state.currentSuite;
}

function filteredBatches() {
  return state.batches.filter(b => {
    if (state.currentEnv    && b.environment !== state.currentEnv)    return false;
    if (state.currentModel  && b.model       !== state.currentModel)  return false;
    if (state.currentMethod && b.method      !== state.currentMethod) return false;
    if (state.currentSuite  && b.suite_id    !== state.currentSuite)  return false;
    return true;
  });
}

function currentBatchRecord() {
  return state.batches.find(b => b.name === state.currentBatch) ?? null;
}

function tasksForCurrentBatch() {
  return state.catalog?.tasks_by_batch?.[state.currentBatch] ?? [];
}

function currentTaskRecord() {
  return tasksForCurrentBatch().find(t => t.id === state.currentTask) ?? null;
}

// ─── Render selectors ─────────────────────────────────────────────────────────

function renderSelectors() {
  const envs = allBatchEnvs();
  setOptions(els.envSelect, [
    {value:'', label:'— Select —'},
    ...envs.map(e => ({value:e, label: e === 'panther' ? 'Panther (hardware)' : 'PyRoboSim (simulation)'})),
  ], state.currentEnv ?? '');

  const models = allModels();
  setOptions(els.modelSelect, [
    {value:'', label:'— Select —'},
    ...models.map(m => ({value:m, label:m})),
  ], state.currentModel ?? '');

  const methods = state.catalog?.methods ?? [];
  setOptions(els.methodSelect, [
    {value:'', label:'— Select —'},
    ...methods.map(m => ({value:m, label:m})),
  ], state.currentMethod ?? '');

  // Suite options are filtered by whatever env/model/method are already selected
  const partialFiltered = state.batches.filter(b => {
    if (state.currentEnv    && b.environment !== state.currentEnv)    return false;
    if (state.currentModel  && b.model       !== state.currentModel)  return false;
    if (state.currentMethod && b.method      !== state.currentMethod) return false;
    return true;
  });
  const visible = filteredBatches();
  const suiteIds = [...new Set(partialFiltered.map(b => b.suite_id))];
  const suiteMap = state.catalog?.suites ?? {};
  setOptions(els.suiteSelect, [
    {value:'', label:'— Select —'},
    ...suiteIds.map(id => ({value:id, label: suiteMap[id]?.label ?? id})),
  ], state.currentSuite ?? '');

  // Resolve current batch only if all selected
  if (allSelected()) {
    if (!visible.some(b => b.name === state.currentBatch)) {
      state.currentBatch = visible[0]?.name ?? null;
      state.currentTask  = null;
    }
    const tasks = tasksForCurrentBatch();
    if (!tasks.some(t => t.id === state.currentTask)) {
      state.currentTask = tasks[0]?.id ?? null;
    }
  }

  // Show/hide body
  if (els.explorerBody) els.explorerBody.hidden = !allSelected();
}

// ─── Batch summary ────────────────────────────────────────────────────────────

function renderBatchSummary() {
  const visible = filteredBatches();
  if (!visible.length) {
    els.batchSummary.innerHTML = '<p class="muted-note">No batches match the current filters.</p>';
    return;
  }

  const batch = currentBatchRecord() ?? visible[0];
  const summary = batch.summary ?? {};
  const isPanther = batch.environment === 'panther';

  const tiles = [
    tile('Environment', isPanther ? 'Panther (hardware)' : 'PyRoboSim (simulation)'),
    tile('Model', batch.model ?? '—'),
    tile('Method', batch.method),
    tile('Suite', batch.suite_label),
    tile('Tasks', summary.count ?? batch.count ?? '—'),
    tile('Valid@1', formatRate(summary.valid_rate)),
  ];
  if (!isPanther) {
    tiles.push(tile('Success', formatRate(summary.success_rate)));
  }

  els.batchSummary.innerHTML = `<div class="batch-stat-row">${tiles.join('')}</div>`;
}

// ─── Rootstocks ───────────────────────────────────────────────────────────────

function renderRootstocks() {
  const batch = currentBatchRecord();
  const show = batch?.method === 'M-Core' && batch?.environment !== 'panther';
  els.rootstocksPanel.hidden = !show;
  if (!show) { els.rootstocksView.innerHTML = ''; return; }

  const rootstocks = state.catalog?.rootstocks ?? [];
  els.rootstocksView.innerHTML = rootstocks.map(r => `
    <article class="rootstock-card">
      <div class="rootstock-card__head">
        <h4>${escapeHtml(r.name)}</h4>
        ${badge('Template')}
      </div>
      ${r.bt_svg ? `<div class="rootstock-card__svg">${r.bt_svg}</div>` : '<div class="bt-tree-empty">No diagram.</div>'}
      <p class="rootstock-card__desc">${escapeHtml(r.description ?? '')}</p>
    </article>
  `).join('');
}

// ─── Task list ────────────────────────────────────────────────────────────────

function renderTaskList() {
  const tasks = tasksForCurrentBatch();
  const batch = currentBatchRecord();
  els.taskListMeta.textContent = batch
    ? `${batch.model} · ${batch.method} · ${batch.suite_label} · ${tasks.length} tasks`
    : 'No batch selected.';

  if (!tasks.length) {
    els.taskList.innerHTML = '<div class="task-list-empty">No tasks available.</div>';
    return;
  }

  els.taskList.innerHTML = tasks.map((task, idx) => {
    const selected = task.id === state.currentTask;
    const isPanther = batch?.environment === 'panther';

    let statusBadge = '';
    if (isPanther) {
      const validTone = task.valid ? 'good' : 'bad';
      statusBadge = badge(task.valid ? 'Valid' : 'Invalid', validTone);
    } else {
      const execTone = task.exec_status === 'SUCCESS' ? 'good'
        : task.exec_status === 'FAILURE' ? 'bad' : 'warn';
      const goalTone = task.success ? 'good' : 'bad';
      statusBadge = badge(task.exec_status ?? 'Unknown', execTone)
        + badge(task.success ? 'Goal Met' : 'Goal Missed', goalTone);
    }

    return `
      <button type="button"
        class="task-item${selected ? ' is-selected' : ''}"
        data-task-id="${escapeHtml(task.id)}"
        role="option" aria-selected="${selected}">
        <span class="task-item__num">${idx + 1}</span>
        <span class="task-item__body">
          <span class="task-item__prompt">${escapeHtml(task.prompt ?? task.id)}</span>
          <span class="task-item__tags">
            ${badge(task.archetype_label ?? 'Unknown')}
            ${statusBadge}
          </span>
        </span>
      </button>`;
  }).join('');
}

// ─── Task detail ──────────────────────────────────────────────────────────────

function renderBtTree(task) {
  if (task?.bt_svg) {
    els.btTreeView.innerHTML = `<div class="bt-svg-wrap">${task.bt_svg}</div>`;
  } else {
    els.btTreeView.innerHTML = '<div class="bt-tree-empty">No BT available for this task.</div>';
  }
}

function renderBtRaw(task) {
  const batch = currentBatchRecord();
  const isPanther = batch?.environment === 'panther';
  if (isPanther && task?.bt_xml) {
    els.btFormatMeta.textContent = 'BT.CPP XML';
    els.btRawView.textContent = task.bt_xml;
  } else if (task?.bt_json) {
    els.btFormatMeta.textContent = 'PyTrees JSON';
    els.btRawView.textContent = pretty(task.bt_json);
  } else {
    els.btFormatMeta.textContent = '';
    els.btRawView.textContent = '(none)';
  }
}

function renderSpecView(task) {
  const view = task?.task_spec_view;
  if (!view) {
    els.taskSpecSection.hidden = true;
    return;
  }
  els.taskSpecSection.hidden = false;
  els.taskSpecView.innerHTML = `
    <div class="spec-card spec-card--arch">${badge(view.archetype_label ?? 'Unknown')}</div>
  `;
  els.taskSpecRawView.textContent = pretty(task.task_spec);
}

function renderResultSummary(task) {
  const batch = currentBatchRecord();
  const isPanther = batch?.environment === 'panther';

  if (isPanther) {
    const cards = [
      ['Valid@1',         task?.valid   != null ? (task.valid ? 'Yes' : 'No') : 'n/a'],
      ['Attempt #',       task?.attempt_number ?? 'n/a'],
      ['Issues',          task?.issues?.length ? task.issues.join('; ') : 'None'],
    ];
    els.resultSummaryView.innerHTML = cards.map(([l, v]) => `
      <div class="result-card">
        <div class="result-card__label">${escapeHtml(l)}</div>
        <div class="result-card__value">${escapeHtml(String(v))}</div>
      </div>`).join('');
    els.resultView.textContent = pretty(task?.result ?? {valid: task?.valid, issues: task?.issues});
    return;
  }

  const r = task?.result ?? {};
  const cards = [
    ['Execution',   r.exec_status   ?? 'Unknown'],
    ['Goal met',    r.success       != null ? (r.success ? 'Yes' : 'No') : 'n/a'],
    ['Valid',       r.valid         != null ? (r.valid   ? 'Yes' : 'No') : 'n/a'],
    ['Grounded',    r.grounded      != null ? (r.grounded ? 'Yes' : 'No') : 'n/a'],
    ['Runtime ms',  r.runtime_ms    ?? 'n/a'],
    ['Tick count',  r.tick_count    ?? 'n/a'],
    ['Failure',     r.failure_cause ?? 'None'],
  ];
  els.resultSummaryView.innerHTML = cards.map(([l, v]) => `
    <div class="result-card">
      <div class="result-card__label">${escapeHtml(l)}</div>
      <div class="result-card__value">${escapeHtml(String(v))}</div>
    </div>`).join('');
  els.resultView.textContent = pretty(r);
}

function renderTask() {
  const task = currentTaskRecord();
  if (!task) {
    els.taskPrompt.textContent  = 'Select a task from the list.';
    els.taskBadgeRow.innerHTML  = '';
    els.btTreeView.innerHTML    = '<div class="bt-tree-empty">Select a task.</div>';
    els.btRawView.textContent   = '';
    els.btFormatMeta.textContent = '';
    els.taskSpecView.innerHTML  = '';
    els.taskSpecRawView.textContent = '{}';
    els.resultSummaryView.innerHTML = '';
    els.resultView.textContent  = '{}';
    return;
  }

  els.taskPrompt.textContent = task.prompt ?? 'No prompt available.';

  const batch = currentBatchRecord();
  const isPanther = batch?.environment === 'panther';
  const validTone = task.valid ? 'good' : 'bad';
  const execTone  = task.exec_status === 'SUCCESS' ? 'good'
    : task.exec_status === 'FAILURE' ? 'bad' : 'warn';

  els.taskBadgeRow.innerHTML = [
    badge(task.archetype_label ?? 'Unknown'),
    isPanther
      ? badge(task.valid ? 'Valid' : 'Invalid', validTone)
      : badge(task.exec_status ?? 'Unknown', execTone),
    !isPanther ? badge(task.success ? 'Goal Met' : 'Goal Missed', task.success ? 'good' : 'bad') : '',
    task.failure_cause ? badge(task.failure_cause, 'warn') : '',
  ].join('');

  renderBtTree(task);
  renderBtRaw(task);
  renderSpecView(task);
  renderResultSummary(task);
}

// ─── Full re-render ───────────────────────────────────────────────────────────

function render() {
  renderSelectors();
  renderBatchSummary();
  renderTaskList();
  renderRootstocks();
  renderTask();
}

// ─── Event listeners ──────────────────────────────────────────────────────────

els.envSelect.addEventListener('change', () => {
  state.currentEnv   = els.envSelect.value   || null;
  state.currentBatch = null; state.currentTask = null;
  render();
});
els.modelSelect.addEventListener('change', () => {
  state.currentModel = els.modelSelect.value || null;
  state.currentBatch = null; state.currentTask = null;
  render();
});
els.methodSelect.addEventListener('change', () => {
  state.currentMethod = els.methodSelect.value || null;
  state.currentBatch  = null; state.currentTask = null;
  render();
});
els.suiteSelect.addEventListener('change', () => {
  state.currentSuite = els.suiteSelect.value || null;
  state.currentBatch = null; state.currentTask = null;
  render();
});
els.taskList.addEventListener('click', e => {
  const btn = e.target.closest('[data-task-id]');
  if (!btn) return;
  state.currentTask = btn.getAttribute('data-task-id');
  renderTaskList();
  renderTask();
});

// ─── Contract tabs ────────────────────────────────────────────────────────────

document.querySelectorAll('.contract-tabs').forEach(tabBar => {
  tabBar.addEventListener('click', e => {
    const tab = e.target.closest('.contract-tab');
    if (!tab) return;
    tabBar.querySelectorAll('.contract-tab').forEach(t => {
      t.classList.toggle('is-active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    const paneId = tab.dataset.target;
    tabBar.closest('section').querySelectorAll('.contract-pane').forEach(p => {
      p.hidden = p.id !== paneId;
    });
  });
});

function renderContractRootstocks() {
  const simEl = document.getElementById('simRootstockCards');
  const hwEl  = document.getElementById('hwRootstockCards');

  const simRootstocks = state.catalog?.rootstocks ?? [];
  const hwRootstocks  = state.catalog?.panther_rootstocks ?? [];

  function cardHtml(r) {
    const name = escapeHtml(r.name ?? '');
    const desc = escapeHtml(r.description ?? '');
    const svg  = r.bt_svg ?? '';
    return `<div class="contract-rootstock">
      <div class="contract-rootstock__head">
        <span class="contract-rootstock__name">${name}</span>
        <span class="contract-rootstock__desc">${desc}</span>
      </div>
      ${svg ? `<div class="contract-rootstock__svg">${svg}</div>` : ''}
    </div>`;
  }

  if (simEl) {
    simEl.innerHTML = simRootstocks.length
      ? simRootstocks.map(cardHtml).join('')
      : '<div class="muted-note">No rootstocks found.</div>';
  }
  if (hwEl) {
    hwEl.innerHTML = hwRootstocks.length
      ? hwRootstocks.map(cardHtml).join('')
      : '<div class="muted-note">No rootstocks found.</div>';
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function loadCatalog() {
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  state.catalog = await res.json();
  state.batches = state.catalog.batches ?? [];
}

applyAnonymousMode();

function renderVideoBt() {
  const el = document.getElementById('videoBtTree');
  if (!el) return;
  const tasks = state.catalog?.tasks_by_batch?.['panther_gemma_mcore'] ?? [];
  const task = tasks.find(t => t.id === 'task13_multi_phase');
  if (task?.bt_svg) {
    el.innerHTML = task.bt_svg;
  } else {
    el.innerHTML = '<div class="bt-tree-empty">BT not found.</div>';
  }
}

loadCatalog()
  .then(() => { render(); renderContractRootstocks(); renderVideoBt(); })
  .catch(err => {
    els.taskListMeta.textContent = `Failed to load catalog: ${err.message}`;
  });
