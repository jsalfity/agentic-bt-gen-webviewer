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
  batchCompareMeta: document.getElementById('batchCompareMeta'),
  batchCompareLegend: document.getElementById('batchCompareLegend'),
  batchCompareChart: document.getElementById('batchCompareChart'),
  rootstocksPanel: document.getElementById('rootstocksPanel'),
  rootstocksView: document.getElementById('rootstocksView'),
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

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return value.toLocaleString();
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

function tile(label, value, description = '') {
  return `
    <div class="stat-tile">
      <div class="stat-k">${label}${description ? ` <span class="stat-desc">${description}</span>` : ''}</div>
      <div class="stat-v">${value}</div>
    </div>
  `;
}

function badge(label, tone = '') {
  return `<span class="badge ${tone}">${label}</span>`;
}

function methodColor(method) {
  if (method === 'M-Core') return '#0b6e4f';
  if (method === 'B1') return '#b6502d';
  if (method === 'B0') return '#5a6472';
  return '#8a8378';
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
  const batch = currentBatchRecord();
  els.taskListMeta.textContent = tasks.length && batch
    ? `Method ${batch.method} · ${batch.suite_label} suite · ${tasks.length} prompts`
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
    els.batchCompareLegend.innerHTML = '';
    els.batchCompareChart.innerHTML = '<div class="status-block muted">No comparison available.</div>';
    els.batchCompareMeta.textContent = 'Grouped comparison across evaluation metrics.';
    return;
  }

  const summary = batch.summary || {};
  els.batchSummary.innerHTML = `
    <div class="batch-summary-meta">
      ${tile('Method', batch.method, 'synthesis condition used')}
      ${tile('Suite', batch.suite_label, 'benchmark under evaluation')}
      ${tile('Batch', batch.name, 'experiment grouping')}
      ${tile('Number of Tasks', summary.count ?? batch.count ?? 'n/a', 'total evaluated tasks')}
    </div>
    <div class="batch-summary-section">
      <div class="batch-summary-section__label">Pre-execution</div>
      <div class="batch-summary-section__grid">
        ${[
          tile('Valid', formatRate(summary.valid_rate), 'BT passes schema and construction checks'),
          tile('Grounded', formatRate(summary.grounded_rate), 'entities and skills map to known world vocabulary'),
          tile('Params', formatRate(summary.params_rate), 'skill parameters are present and type-compatible'),
          tile('Structure', formatRate(summary.struct_comp_rate), 'required control-flow pattern is present'),
        ].join('')}
      </div>
    </div>
    <div class="batch-summary-section">
      <div class="batch-summary-section__label">Post-execution</div>
      <div class="batch-summary-section__grid">
        ${[
          tile('Success', formatRate(summary.success_rate), 'BT ticking reaches runtime success'),
          tile('Goal satisfied', formatRate(summary.goal_satisfied_rate), 'post-run world state meets task conditions'),
        ].join('')}
      </div>
    </div>
  `;
  renderBatchComparison(batch);
}

function renderBatchComparison(activeBatch) {
  const suiteBatches = state.batches
    .filter((batch) => batch.suite_id === activeBatch.suite_id && batch.method !== 'Other')
    .sort((a, b) => {
      const order = (state.catalog.methods || []).indexOf(a.method) - (state.catalog.methods || []).indexOf(b.method);
      return order !== 0 ? order : a.name.localeCompare(b.name);
    });
  const metrics = [
    ['Valid', 'valid_rate'],
    ['Grounded', 'grounded_rate'],
    ['Params', 'params_rate'],
    ['StructComp', 'struct_comp_rate'],
    ['Success', 'success_rate'],
  ];

  els.batchCompareMeta.textContent = `${activeBatch.suite_label} grouped comparison across pre- and post-execution metrics.`;

  if (!suiteBatches.length) {
    els.batchCompareLegend.innerHTML = '';
    els.batchCompareChart.innerHTML = '<div class="status-block muted">No comparison available.</div>';
    return;
  }

  els.batchCompareLegend.innerHTML = suiteBatches.map((batch) => `
    <span class="batch-compare__legend-item${batch.name === activeBatch.name ? ' is-active' : ''}">
      <span class="batch-compare__swatch" style="background:${methodColor(batch.method)}"></span>
      ${escapeHtml(batch.method)}
    </span>
  `).join('');

  const width = 560;
  const height = 230;
  const margin = { top: 18, right: 10, bottom: 42, left: 42 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const groupWidth = plotWidth / metrics.length;
  const gap = 6;
  const barWidth = Math.max(12, Math.min(26, (groupWidth - gap * (suiteBatches.length - 1)) / Math.max(suiteBatches.length, 1)));
  const axisTicks = [0, 0.25, 0.5, 0.75, 1];

  const bars = [];
  const labels = [];
  metrics.forEach(([metricLabel, metricKey], metricIndex) => {
    const groupX = margin.left + metricIndex * groupWidth;
    const totalBarsWidth = suiteBatches.length * barWidth + (suiteBatches.length - 1) * gap;
    const startX = groupX + (groupWidth - totalBarsWidth) / 2;
    suiteBatches.forEach((batch, batchIndex) => {
      const value = Number(batch.summary?.[metricKey]);
      const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      const barHeight = clamped * plotHeight;
      const x = startX + batchIndex * (barWidth + gap);
      const y = margin.top + plotHeight - barHeight;
      bars.push(`
        <g>
          <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="4" ry="4"
            fill="${methodColor(batch.method)}" opacity="${batch.name === activeBatch.name ? '1' : '0.72'}"></rect>
          <text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle"
            font-family="Avenir Next, Segoe UI, sans-serif" font-size="9" fill="#5a544b">${Math.round(clamped * 100)}</text>
        </g>
      `);
    });
    labels.push(`
      <text x="${(groupX + groupWidth / 2).toFixed(1)}" y="${(height - 16).toFixed(1)}" text-anchor="middle"
        font-family="Avenir Next, Segoe UI, sans-serif" font-size="10" fill="#5a544b">${escapeHtml(metricLabel)}</text>
    `);
  });

  const grid = axisTicks.map((tick) => {
    const y = margin.top + plotHeight - tick * plotHeight;
    return `
      <line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(width - margin.right)}" y2="${y.toFixed(1)}" stroke="rgba(125,117,104,0.22)" stroke-width="1"></line>
      <text x="${(margin.left - 8)}" y="${(y + 3).toFixed(1)}" text-anchor="end"
        font-family="Avenir Next, Segoe UI, sans-serif" font-size="9" fill="#7a7369">${Math.round(tick * 100)}</text>
    `;
  }).join('');

  els.batchCompareChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="batch-compare__svg" aria-label="Method comparison chart">
      ${grid}
      <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" stroke="#9d9385" stroke-width="1.2"></line>
      ${bars.join('')}
      ${labels.join('')}
    </svg>
  `;
}

function renderRootstocks() {
  const batch = currentBatchRecord();
  const shouldShow = batch?.method === 'M-Core';
  els.rootstocksPanel.hidden = !shouldShow;
  if (!shouldShow) {
    els.rootstocksView.innerHTML = '';
    return;
  }

  const rootstocks = state.catalog.rootstocks || [];
  els.rootstocksView.innerHTML = rootstocks.map((rootstock) => `
    <article class="rootstock-card">
      <div class="rootstock-card__head">
        <h3>${escapeHtml(rootstock.name)}</h3>
        <span class="badge">Template</span>
      </div>
      <div class="rootstock-card__viz">
        ${rootstock.bt_svg ? `<div class="rootstock-card__svg">${rootstock.bt_svg}</div>` : '<div class="bt-tree-empty">No rootstock diagram available.</div>'}
      </div>
      <p class="rootstock-card__copy">${escapeHtml(rootstock.description || '')}</p>
      <div class="rootstock-card__section">
        <div class="rootstock-card__label">When to use</div>
        <div>${escapeHtml(rootstock.when_to_use || 'n/a')}</div>
      </div>
      <div class="rootstock-card__section">
        <div class="rootstock-card__label">Anti-pattern</div>
        <div>${escapeHtml(rootstock.anti_pattern || 'n/a')}</div>
      </div>
      <div class="rootstock-card__section">
        <div class="rootstock-card__label">Template shape</div>
        <div>${escapeHtml(rootstock.template_root_type || 'n/a')}${rootstock.template_memory === true ? ' · memory=true' : ''}</div>
      </div>
      <div class="rootstock-card__section">
        <div class="rootstock-card__label">Slots</div>
        <ul class="rootstock-slot-list">
          ${(rootstock.slots || []).map((slot) => `
            <li><span class="mono">${escapeHtml(slot.name)}</span> ${escapeHtml(slot.description || '')}</li>
          `).join('')}
        </ul>
      </div>
    </article>
  `).join('');
}

function renderSpecView(task) {
  const view = task.task_spec_view || {};
  const sections = [
    { title: 'Required actions', items: view.required_actions || [] },
    { title: 'Required locations', items: view.required_locations || [] },
    { title: 'Control flow expectations', items: view.control_flow || [] },
    { title: 'Success conditions', items: view.success_conditions || [] },
  ];
  const archetypeCard = `
    <div class="spec-card spec-card--archetype">
      <h3>Archetype</h3>
      <div>${badge(view.archetype_label || 'Unknown')}</div>
    </div>
  `;
  els.taskSpecView.innerHTML = [
    archetypeCard,
    ...sections.map((section) => `
    <div class="spec-card">
      <h3>${section.title}</h3>
      ${section.items.length ? `<ul>${section.items.map((item) => `<li>${item}</li>`).join('')}</ul>` : '<div class="muted">None listed.</div>'}
    </div>
  `),
  ].join('');
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
    els.taskPrompt.textContent = 'Select a task.';
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
    badge(task.success ? 'Goal Met' : 'Goal Missed', task.success ? 'good' : 'bad'),
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
  renderRootstocks();
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
  renderRootstocks();
  renderTask();
});

els.suiteSelect.addEventListener('change', () => {
  state.currentSuite = els.suiteSelect.value;
  state.currentBatch = null;
  state.currentTask = null;
  renderSelectors();
  renderBatchSummary();
  renderTaskList();
  renderRootstocks();
  renderTask();
});

els.batchSelect.addEventListener('change', () => {
  state.currentBatch = els.batchSelect.value;
  state.currentTask = null;
  renderSelectors();
  renderBatchSummary();
  renderTaskList();
  renderRootstocks();
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
    els.taskListMeta.textContent = `Failed to load catalog: ${error.message}`;
    els.taskPrompt.textContent = `Failed to load catalog: ${error.message}`;
  });
