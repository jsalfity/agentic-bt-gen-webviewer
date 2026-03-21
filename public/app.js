const state = {
  catalog: null,
  batches: [],
  currentMethod: 'M-Core',
  currentSuite: 'core60',
  currentBatch: null,
  currentTask: null,
  currentRunId: null,
  runtimeAvailable: false,
  pollTimer: null,
};

const DATA_URL = 'data/catalog.json';
const RUN_POLL_MS = 1200;

const els = {
  heroStats: document.getElementById('heroStats'),
  methodSelect: document.getElementById('methodSelect'),
  suiteSelect: document.getElementById('suiteSelect'),
  batchSelect: document.getElementById('batchSelect'),
  taskList: document.getElementById('taskList'),
  taskListMeta: document.getElementById('taskListMeta'),
  controlUrl: document.getElementById('controlUrl'),
  realtimeFactor: document.getElementById('realtimeFactor'),
  refreshRuntime: document.getElementById('refreshRuntime'),
  resetWorld: document.getElementById('resetWorld'),
  runBt: document.getElementById('runBt'),
  runtimeStatus: document.getElementById('runtimeStatus'),
  runtimeStatusInline: document.getElementById('runtimeStatusInline'),
  runIdInline: document.getElementById('runIdInline'),
  batchSummary: document.getElementById('batchSummary'),
  taskBadgeRow: document.getElementById('taskBadgeRow'),
  taskPrompt: document.getElementById('taskPrompt'),
  taskSpecView: document.getElementById('taskSpecView'),
  taskSpecRawView: document.getElementById('taskSpecRawView'),
  resultSummaryView: document.getElementById('resultSummaryView'),
  resultView: document.getElementById('resultView'),
  btView: document.getElementById('btView'),
  btTreeView: document.getElementById('btTreeView'),
  runStatusView: document.getElementById('runStatusView'),
  worldStateView: document.getElementById('worldStateView'),
};

function pretty(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatRate(value) {
  if (typeof value !== 'number') return 'n/a';
  return `${Math.round(value * 100)}%`;
}

function setOptions(select, items, selectedValue) {
  select.innerHTML = '';
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    if (selectedValue !== undefined && item.value === selectedValue) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function setRuntimeButtonsEnabled(enabled) {
  els.runBt.disabled = !enabled || !currentTaskRecord()?.bt_json;
  els.resetWorld.disabled = !enabled;
}

function setRuntimeStatus(message, tone = 'muted') {
  els.runtimeStatus.textContent = message;
  els.runtimeStatusInline.textContent = message;
  els.runtimeStatus.className = tone === 'muted' ? 'status-block muted' : 'status-block';
}

function explainRuntimeError(error) {
  const message = error?.message || String(error || 'Unknown runtime error');
  return `Connected, but runtime refresh failed: ${message}`;
}

function normalizeRobotName(value) {
  const trimmed = (value || '').trim();
  return trimmed ? trimmed : null;
}

function selectedRobotName() {
  return normalizeRobotName(document.getElementById('robotName')?.value);
}

function tile(label, value) {
  return `<div class="stat-tile"><div class="stat-k">${label}</div><div class="stat-v">${value}</div></div>`;
}

function badge(label, tone = '') {
  return `<span class="badge ${tone}">${label}</span>`;
}

function humanizeValue(value) {
  if (value === null || value === undefined || value === '') return 'n/a';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function btNodeTone(type) {
  const lowered = String(type || '').toLowerCase();
  if (lowered.includes('sequence')) return 'sequence';
  if (lowered.includes('selector') || lowered.includes('fallback')) return 'selector';
  if (lowered.includes('condition')) return 'condition';
  return 'action';
}

function summarizeBtNode(node) {
  if (!node || typeof node !== 'object') return 'Unknown node';
  if (node.action) return String(node.action);
  if (node.condition) return String(node.condition);
  return String(node.type || node.name || 'node');
}

function summarizeBtMeta(node) {
  if (!node || typeof node !== 'object') return '';
  const parts = [];
  if (node.memory !== undefined) parts.push(`memory=${node.memory}`);
  const params = node.params && typeof node.params === 'object'
    ? Object.entries(node.params).map(([key, value]) => `${key}=${value}`).join(', ')
    : '';
  if (params) parts.push(params);
  return parts.join(' | ');
}

function renderBtTree(task) {
  if (!task?.bt_svg) {
    els.btTreeView.innerHTML = '<div class="bt-tree-empty">No BT available for this task.</div>';
    return;
  }
  els.btTreeView.innerHTML = `<div class="bt-tree-svg">${task.bt_svg}</div>`;
}

function currentBatchRecord() {
  return state.batches.find((batch) => batch.name === state.currentBatch) || null;
}

function currentTaskRecord() {
  const tasks = state.catalog.tasks_by_batch?.[state.currentBatch] || [];
  return tasks.find((task) => task.id === state.currentTask) || null;
}

function tasksForCurrentBatch() {
  return state.catalog.tasks_by_batch?.[state.currentBatch] || [];
}

function renderHeroStats() {
  const totalTasks = Object.values(state.catalog.tasks_by_batch || {}).reduce((sum, tasks) => sum + tasks.length, 0);
  const successRates = state.batches.map((batch) => batch.summary?.success_rate).filter((value) => typeof value === 'number');
  const meanSuccess = successRates.length
    ? `${Math.round((successRates.reduce((a, b) => a + b, 0) / successRates.length) * 100)}%`
    : 'n/a';

  els.heroStats.innerHTML = [
    tile('Batches', state.batches.length),
    tile('Tasks', totalTasks),
    tile('Suites', Object.keys(state.catalog.suites || {}).length),
    tile('Mean success', meanSuccess),
  ].join('');
}

function filteredBatches() {
  return state.batches.filter((batch) => {
    const methodOk = state.currentMethod === 'all' || batch.method === state.currentMethod;
    const suiteOk = state.currentSuite === 'all' || batch.suite_id === state.currentSuite;
    return methodOk && suiteOk;
  });
}

function renderSelectors() {
  setOptions(els.methodSelect, [
    { value: 'all', label: 'All methods' },
    ...(state.catalog.methods || []).map((method) => ({ value: method, label: method })),
  ], state.currentMethod);

  setOptions(els.suiteSelect, [
    { value: 'all', label: 'All suites' },
    ...Object.values(state.catalog.suites || {}).map((suite) => ({ value: suite.suite_id, label: suite.label })),
  ], state.currentSuite);

  const batchOptions = filteredBatches().map((batch) => ({
    value: batch.name,
    label: `${batch.name}  [${batch.method}, ${batch.suite_label}]`,
  }));
  if (!batchOptions.length) {
    batchOptions.push({ value: '', label: 'No batch available' });
  }
  if (!batchOptions.some((option) => option.value === state.currentBatch)) {
    state.currentBatch = batchOptions[0].value;
  }
  setOptions(els.batchSelect, batchOptions, state.currentBatch);
  const tasks = tasksForCurrentBatch();
  if (!tasks.some((task) => task.id === state.currentTask)) {
    state.currentTask = tasks[0]?.id || null;
  }
}

function renderTaskList() {
  const tasks = tasksForCurrentBatch();
  els.taskListMeta.textContent = tasks.length
    ? `${tasks.length} prompts in ${state.currentBatch}`
    : 'No prompts available for the current filters.';

  if (!tasks.length) {
    els.taskList.innerHTML = '<div class="task-list-empty">No task prompts available.</div>';
    return;
  }

  els.taskList.innerHTML = tasks.map((task, index) => {
    const selected = task.id === state.currentTask;
    const execTone = task.exec_status === 'SUCCESS'
      ? 'good'
      : (task.exec_status === 'FAILURE' ? 'bad' : 'warn');
    const goalTone = task.success ? 'good' : 'bad';
    return `
      <button
        type="button"
        class="task-list-item${selected ? ' is-selected' : ''}"
        data-task-id="${escapeHtml(task.id)}"
        role="option"
        aria-selected="${selected ? 'true' : 'false'}"
      >
        <span class="task-list-item__index">${index + 1}</span>
        <span class="task-list-item__body">
          <span class="task-list-item__prompt">${escapeHtml(task.prompt || task.id)}</span>
          <span class="task-list-item__tags">
            <span class="badge">${escapeHtml(task.archetype_label || 'Unknown')}</span>
            <span class="badge ${execTone}">Execution: ${escapeHtml(task.exec_status || 'Unknown')}</span>
            <span class="badge ${goalTone}">${task.success ? 'Goal Met' : 'Goal Missed'}</span>
          </span>
          <span class="task-list-item__meta">${escapeHtml(task.id)}</span>
        </span>
      </button>
    `;
  }).join('');
}

function renderBatchSummary() {
  const batch = currentBatchRecord();
  if (!batch) {
    els.batchSummary.innerHTML = '<div class="status-block muted">No batch selected.</div>';
    return;
  }

  const summary = batch.summary || {};
  const rows = [
    tile('Method', batch.method),
    tile('Suite', batch.suite_label),
    tile('Tasks', summary.count ?? batch.count ?? 'n/a'),
    tile('Success', formatRate(summary.success_rate)),
    tile('Structure', formatRate(summary.struct_comp_rate)),
    tile('Grounded', formatRate(summary.grounded_rate)),
  ];
  els.batchSummary.innerHTML = rows.join('');
}

function renderSpecView(task) {
  const view = task.task_spec_view || {};
  const sections = [
    { title: 'Archetype', items: [view.archetype_label || 'Unknown'] },
    { title: 'Required actions', items: view.required_actions || [] },
    { title: 'Required locations', items: view.required_locations || [] },
    { title: 'Control flow expectations', items: view.control_flow || [] },
    { title: 'Success conditions', items: view.success_conditions || [] },
  ];
  els.taskSpecView.innerHTML = sections.map((section) => `
    <div class="spec-card">
      <h3>${section.title}</h3>
      ${section.items.length ? `<ul>${section.items.map((item) => `<li>${item}</li>`).join('')}</ul>` : '<div class="muted">None listed.</div>'}
    </div>
  `).join('');
}

function renderResultSummary(task) {
  const result = task?.result || {};
  const cards = [
    ['Execution', result.exec_status || 'Unknown'],
    ['Goal satisfied', result.success],
    ['Structure compliant', result.struct_comp],
    ['Grounded', result.grounded],
    ['Runtime (ms)', result.runtime_ms ?? 'n/a'],
    ['Tick count', result.tick_count ?? 'n/a'],
    ['Failure cause', result.failure_cause || 'None'],
    ['Failure notes', result.failure_notes || 'None'],
  ];
  els.resultSummaryView.innerHTML = cards.map(([label, value]) => `
    <div class="result-card">
      <div class="result-card__label">${escapeHtml(label)}</div>
      <div class="result-card__value">${escapeHtml(humanizeValue(value))}</div>
    </div>
  `).join('');
}

function renderTask() {
  const task = currentTaskRecord();
  if (!task) {
    els.taskPrompt.textContent = 'Select a batch and task.';
    els.taskBadgeRow.innerHTML = '';
    els.taskSpecView.innerHTML = '';
    els.taskSpecRawView.textContent = '{}';
    els.resultSummaryView.innerHTML = '';
    els.resultView.textContent = '{}';
    els.btView.textContent = '{}';
    els.btTreeView.innerHTML = '<div class="bt-tree-empty">Select a task.</div>';
    els.runBt.disabled = true;
    return;
  }

  els.taskPrompt.textContent = task.prompt || 'No prompt available.';
  els.taskBadgeRow.innerHTML = [
    badge(task.archetype_label),
    badge(task.exec_status || 'Unknown', task.exec_status === 'SUCCESS' ? 'good' : (task.exec_status === 'FAILURE' ? 'bad' : 'warn')),
    badge(task.success ? 'Goal satisfied' : 'Not satisfied', task.success ? 'good' : 'bad'),
    task.failure_cause ? badge(task.failure_cause, 'warn') : '',
  ].join('');
  renderSpecView(task);
  renderResultSummary(task);
  els.taskSpecRawView.textContent = pretty(task.task_spec);
  els.resultView.textContent = pretty(task.result);
  els.btView.textContent = pretty(task.bt_json);
  renderBtTree(task);
  els.runBt.disabled = !state.runtimeAvailable || !task.bt_json;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

async function checkRuntime() {
  const controlUrl = els.controlUrl.value.trim();
  try {
    const payload = await fetchJson(`/api/runtime/health?control_url=${encodeURIComponent(controlUrl)}`);
    state.runtimeAvailable = true;
    setRuntimeStatus(`Connected to ${payload.control_url}`, 'ok');
    setRuntimeButtonsEnabled(true);
    await refreshWorldState();
  } catch (error) {
    state.runtimeAvailable = false;
    setRuntimeStatus(`Runtime unavailable: ${error.message}`, 'muted');
    setRuntimeButtonsEnabled(false);
    els.runIdInline.textContent = 'None';
    els.worldStateView.textContent = pretty({ error: error.message });
  }
}

async function refreshWorldState() {
  if (!state.runtimeAvailable) return;
  const controlUrl = els.controlUrl.value.trim();
  const robot = selectedRobotName();
  try {
    const runtimeUrl = new URL('/api/runtime/world-state', window.location.origin);
    runtimeUrl.searchParams.set('control_url', controlUrl);
    if (robot) runtimeUrl.searchParams.set('robot', robot);
    const payload = await fetchJson(runtimeUrl.toString());
    els.worldStateView.textContent = pretty(payload);
  } catch (error) {
    els.worldStateView.textContent = pretty({ error: error.message });
    setRuntimeStatus(explainRuntimeError(error), 'muted');
  }
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function pollRunStatus() {
  if (!state.currentRunId) return;
  const controlUrl = els.controlUrl.value.trim();
  try {
    const payload = await fetchJson(`/api/runtime/status?control_url=${encodeURIComponent(controlUrl)}&run_id=${encodeURIComponent(state.currentRunId)}`);
    els.runStatusView.textContent = pretty(payload);
    els.runIdInline.textContent = state.currentRunId;
    await refreshWorldState();
    if (['SUCCESS', 'FAILURE', 'CANCELED'].includes(payload.status)) {
      await refreshWorldState();
      setRuntimeStatus(`Run finished with status ${payload.status}`, 'ok');
      stopPolling();
    }
  } catch (error) {
    els.runStatusView.textContent = pretty({ error: error.message });
    setRuntimeStatus(`Run polling failed: ${error.message}`, 'muted');
    stopPolling();
  }
}

async function runSelectedBt() {
  const task = currentTaskRecord();
  if (!task || !task.bt_json) return;
  const controlUrl = els.controlUrl.value.trim();
  const robot = selectedRobotName();
  els.runBt.disabled = true;
  setRuntimeStatus('Starting BT run...', 'ok');
  try {
    const payload = await fetchJson('/api/runtime/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        control_url: controlUrl,
        robot,
        realtime_factor: Number(els.realtimeFactor.value || 1),
        bt_json: task.bt_json,
      }),
    });
    state.currentRunId = payload.run_id;
    els.runStatusView.textContent = pretty(payload);
    els.runIdInline.textContent = payload.run_id || 'None';
    setRuntimeStatus(`Run started: ${payload.run_id}`, 'ok');
    stopPolling();
    state.pollTimer = setInterval(pollRunStatus, RUN_POLL_MS);
    await pollRunStatus();
  } catch (error) {
    els.runStatusView.textContent = pretty({ error: error.message });
    setRuntimeStatus(`Run failed to start: ${error.message}`, 'muted');
  } finally {
    els.runBt.disabled = false;
  }
}

async function resetWorld() {
  const controlUrl = els.controlUrl.value.trim();
  try {
    const payload = await fetchJson('/api/runtime/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ control_url: controlUrl }),
    });
    setRuntimeStatus(payload.reset ? 'World reset.' : pretty(payload), payload.reset ? 'ok' : 'muted');
    await refreshWorldState();
  } catch (error) {
    setRuntimeStatus(`Reset failed: ${error.message}`, 'muted');
  }
}

async function loadCatalog() {
  state.catalog = await fetchJson(DATA_URL);
  state.batches = state.catalog.batches || [];
  renderHeroStats();
  renderSelectors();
  renderBatchSummary();
  renderTaskList();
  renderTask();
  setRuntimeButtonsEnabled(false);
  els.runIdInline.textContent = 'None';
}

els.methodSelect.addEventListener('change', () => {
  state.currentMethod = els.methodSelect.value;
  state.currentBatch = null;
  state.currentTask = null;
  renderSelectors();
  renderBatchSummary();
  renderTaskList();
  renderTask();
});

els.suiteSelect.addEventListener('change', () => {
  state.currentSuite = els.suiteSelect.value;
  state.currentBatch = null;
  state.currentTask = null;
  renderSelectors();
  renderBatchSummary();
  renderTaskList();
  renderTask();
});

els.batchSelect.addEventListener('change', () => {
  state.currentBatch = els.batchSelect.value;
  state.currentTask = null;
  renderSelectors();
  renderBatchSummary();
  renderTaskList();
  renderTask();
});

els.taskList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-task-id]');
  if (!button) return;
  state.currentTask = button.getAttribute('data-task-id');
  renderTaskList();
  renderTask();
});

els.refreshRuntime.addEventListener('click', checkRuntime);
els.runBt.addEventListener('click', runSelectedBt);
els.resetWorld.addEventListener('click', resetWorld);

loadCatalog()
  .then(checkRuntime)
  .catch((error) => {
    els.taskPrompt.textContent = `Failed to load catalog: ${error.message}`;
  });
