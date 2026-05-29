export function makeExportBtn(key, filename) {
  const btn = document.createElement('button')
  btn.className = 'outline'
  btn.style.cssText = 'margin-top:10px;font-size:11px;padding:4px 10px'
  btn.textContent = 'Export JSON'
  btn.onclick = () => {
    const blob = new Blob([JSON.stringify(lastResult[key], null, 2)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${filename}-${Date.now()}.json` })
    a.click(); URL.revokeObjectURL(a.href)
  }
  return btn
}

export const TOOL_PANES = {
  complete:'pane-complete', stream:'pane-stream', embed:'pane-embed',
  image:'pane-image', transcribe:'pane-transcribe',
  compare:'pane-compare', sweep:'pane-sweep', sensitivity:'pane-sensitivity',
  cluster:'pane-cluster', cot:'pane-cot', entropy:'pane-entropy',
  archaeology:'pane-archaeology', pipeline:'pane-pipeline', think:'pane-think',
  evaluate:'pane-evaluate', 'context-stress':'pane-context-stress', drift:'pane-drift', ablation:'pane-ablation', 'guard-lab':'pane-guard-lab',
  monitor:'pane-monitor', vault:'pane-vault', replay:'pane-replay',
  assertions:'pane-assertions', atlas:'pane-atlas', probes:'pane-probes',
}

export function switchTool(name, btn) {
  const paneId = TOOL_PANES[name]
  document.querySelectorAll('.tool-pane').forEach(p => p.classList.toggle('active', p.id === paneId))
  document.querySelectorAll('.tool-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === name))
}

export function setLoading(btn, label = 'Loading…') {
  if (!btn) return
  btn._originalHTML = btn.innerHTML
  btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> ' + label
  btn.disabled = true
  btn.setAttribute('aria-busy', 'true')
}
export function clearLoading(btn, label) {
  if (!btn) return
  btn.innerHTML = label !== undefined ? label : (btn._originalHTML ?? btn.textContent)
  btn.disabled = false
  btn.removeAttribute('aria-busy')
}

export function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Heatmap helper ────────────────────────────────────────────────────────────
export function renderHeatmap(matrix, labels) {
  const n = matrix.length
  const rows = matrix.map((row, i) =>
    `<tr><td style="font-size:9px;padding:0 4px;opacity:.6;white-space:nowrap;font-family:var(--mono)">${escHtml(labels[i] ?? String(i))}</td>${row.map((v, j) => {
      const pct = Math.round(v * 100)
      const bg = `rgba(99,102,241,${(v * 0.8).toFixed(2)})`
      return `<td class="hm-cell" title="${escHtml(String(labels[i] ?? i))} vs ${escHtml(String(labels[j] ?? j))}: ${pct}%" style="width:${Math.floor(300/n)}px;height:${Math.floor(300/n)}px;background:${bg};text-align:center;font-size:${n <= 6 ? 10 : 8}px;font-family:var(--mono);color:#fff;opacity:.9;border:1px solid var(--bg);cursor:default">${pct}</td>`
    }).join('')}</tr>`
  ).join('')
  const headers = labels.map(l => `<th style="font-size:9px;padding:0 2px;opacity:.6;font-family:var(--mono);font-weight:normal">${escHtml(String(l).slice(0,6))}</th>`).join('')
  return `<table style="border-collapse:collapse"><thead><tr><th></th>${headers}</tr></thead><tbody>${rows}</tbody></table>`
}

// ── Per-pane result history ───────────────────────────────────────────────────
export const HIST_SS_KEY = 'whisper:tool-history'
export const HIST_RESULT_IDS = {
  compare:'wc-results', sweep:'ws-results', sensitivity:'wsn-results', entropy:'wen-results',
  cot:'wct-results', cluster:'wcl-results', archaeology:'war-results', pipeline:'wpl-results', think:'wth-results',
}

export function pushToolHistory(toolName, inputSummary, html) {
  let hist
  try { hist = JSON.parse(localStorage.getItem(HIST_SS_KEY) || '{}') } catch { hist = {} }
  if (!hist[toolName]) hist[toolName] = []
  hist[toolName].unshift({ ts: Date.now(), summary: inputSummary, html })
  if (hist[toolName].length > 10) hist[toolName] = hist[toolName].slice(0, 10)
  localStorage.setItem(HIST_SS_KEY, JSON.stringify(hist))
  const btn = document.getElementById('hist-btn-' + toolName)
  if (btn) { btn.style.display = 'inline-block'; btn.textContent = '↩ ' + hist[toolName].length }
  const total = Object.values(hist).reduce((s, arr) => s + arr.length, 0)
  const label = document.getElementById('exp-log-label')
  if (label) label.textContent = `Experiment Log (${total})`
}

export function toggleHist(toolName) {
  const panel = document.getElementById('hist-panel-' + toolName)
  if (!panel) return
  const open = panel.style.display === 'none' || !panel.style.display
  panel.style.display = open ? 'block' : 'none'
  if (open) renderHist(toolName, panel)
}

function renderHist(toolName, panel) {
  let hist
  try { hist = JSON.parse(localStorage.getItem(HIST_SS_KEY) || '{}') } catch { hist = {} }
  const entries = hist[toolName] || []
  const resId = HIST_RESULT_IDS[toolName]
  if (!entries.length) { panel.innerHTML = '<div class="hist-summary" style="padding:6px 0">No history yet</div>'; return }
  panel.innerHTML = ''
  entries.forEach(function(e) {
    const item = document.createElement('div')
    item.className = 'hist-item'
    item.innerHTML = '<span class="hist-time">' + new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + '</span><span class="hist-summary">' + escHtml(e.summary) + '</span>'
    item.onclick = function() {
      if (resId) document.getElementById(resId).innerHTML = e.html
      panel.style.display = 'none'
    }
    panel.appendChild(item)
  })
}

// ── Experiment Log ────────────────────────────────────────────────────────────
export function toggleExpLog() {
  const panel = document.getElementById('exp-log-panel')
  const open = panel.style.display === 'none' || !panel.style.display
  panel.style.display = open ? 'block' : 'none'
  if (open) renderExpLog(panel)
}

function renderExpLog(panel) {
  let hist
  try { hist = JSON.parse(localStorage.getItem(HIST_SS_KEY) || '{}') } catch { hist = {} }
  const entries = Object.keys(HIST_RESULT_IDS).flatMap(tool =>
    (hist[tool] || []).map(e => ({ ...e, tool }))
  ).sort((a, b) => b.ts - a.ts)
  if (!entries.length) { panel.innerHTML = '<div style="padding:8px 0;opacity:.5;font-size:11px">No experiments yet — run a tool to record your first result.</div>'; return }
  panel.innerHTML = entries.map(e =>
    `<div class="hist-item" onclick="restoreExpEntry('${escHtml(e.tool)}',${e.ts})">
      <span class="hist-time">${new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
      <span style="font-size:10px;color:var(--accent2);margin:0 6px;flex-shrink:0">${escHtml(e.tool)}</span>
      <span class="hist-summary">${escHtml(e.summary)}</span>
    </div>`
  ).join('')
}

export function restoreExpEntry(tool, ts) {
  let hist
  try { hist = JSON.parse(localStorage.getItem(HIST_SS_KEY) || '{}') } catch { hist = {} }
  const entry = (hist[tool] || []).find(e => e.ts === ts)
  if (!entry) return
  const resId = HIST_RESULT_IDS[tool]
  if (resId) document.getElementById(resId).innerHTML = entry.html
  switchTool(tool, document.querySelector(`[data-tool="${tool}"]`))
  document.getElementById('exp-log-panel').style.display = 'none'
}

export function exportExpLog(e) {
  e.stopPropagation()
  let hist
  try { hist = JSON.parse(localStorage.getItem(HIST_SS_KEY) || '{}') } catch { hist = {} }
  const exportData = Object.keys(HIST_RESULT_IDS).flatMap(tool =>
    (hist[tool] || []).map(({ ts, summary }) => ({ tool, ts, summary, date: new Date(ts).toISOString() }))
  ).sort((a, b) => b.ts - a.ts)
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `whisper-experiments-${Date.now()}.json` })
  a.click(); URL.revokeObjectURL(a.href)
}

// ── Sandbox Picker ────────────────────────────────────────────────────────────
export const SB_SS_KEY = 'whisper:activeSandbox'
export const SB_MODEL_FIELDS = ['bc-model','bs-model','ws-model','wsn-model','wct-model','wen-model','war-model','wth-model','rpl-model','prb-model','abl-model','dft-model','cst-model','ev-model']
export const SB_SYS_FIELDS   = ['bc-sys','bs-sys','wc-sys','ws-sys','wsn-sys','wct-sys','wen-sys','wth-sys','rpl-sys','dft-sys','cst-sys','ev-sys']
export const SB_SYSPROMPT_FIELDS = ['abl-prompt'] // fields that receive the system prompt as content (not system prompt override)
export let activeSandboxCfg = null

export function applySandboxToFields(cfg) {
  if (cfg.model) SB_MODEL_FIELDS.forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = cfg.model })
  if (cfg.systemPrompt) {
    SB_SYS_FIELDS.forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = cfg.systemPrompt })
    SB_SYSPROMPT_FIELDS.forEach(id => { const el = document.getElementById(id); if (el && !el.value) el.value = cfg.systemPrompt })
  }
}

export async function loadSandbox(id) {
  const status = document.getElementById('sb-status')
  if (!id) return
  status.textContent = 'Loading…'; status.style.color = 'var(--muted)'
  try {
    const r = await fetch('/api/sandbox/' + encodeURIComponent(id))
    const d = await r.json()
    if (!d.ok) throw new Error(d.error || 'Not found')
    const cfg = d.data
    activeSandboxCfg = cfg
    localStorage.setItem(SB_SS_KEY, id)
    document.getElementById('sb-id-input').value = id
    document.getElementById('sb-active-name').textContent = cfg.name || id
    document.getElementById('sb-active-info').style.display = ''
    status.textContent = ''
    const glBtn = document.getElementById('btn-gl-load-sandbox')
    if (glBtn) glBtn.style.display = cfg.systemPrompt ? '' : 'none'
    applySandboxToFields(cfg)
    const sbLabel = cfg.name || id.slice(0, 8)
    const prbBadge = document.getElementById('prb-sandbox-badge')
    if (prbBadge) prbBadge.textContent = sbLabel
    const astBadge = document.getElementById('ast-sandbox-badge')
    if (astBadge) astBadge.textContent = sbLabel
  } catch (e) {
    status.textContent = String(e); status.style.color = 'var(--red)'
  }
}

export function clearSandbox() {
  activeSandboxCfg = null
  localStorage.removeItem(SB_SS_KEY)
  document.getElementById('sb-id-input').value = ''
  document.getElementById('sb-active-info').style.display = 'none'
  document.getElementById('sb-status').textContent = ''
  const glBtn = document.getElementById('btn-gl-load-sandbox')
  if (glBtn) glBtn.style.display = 'none'
}

export function initSandboxPicker() {
  const params = new URLSearchParams(location.search)
  const fromUrl = params.get('sandbox')
  const fromSS  = localStorage.getItem(SB_SS_KEY)
  const startId = fromUrl || fromSS
  if (startId) { document.getElementById('sb-id-input').value = startId; loadSandbox(startId) }
  document.getElementById('sb-load-btn').onclick = () => {
    const id = document.getElementById('sb-id-input').value.trim(); if (id) loadSandbox(id)
  }
  document.getElementById('sb-id-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const id = e.target.value.trim(); if (id) loadSandbox(id) }
  })
  document.getElementById('sb-clear-btn').onclick = clearSandbox
  document.getElementById('btn-gl-load-sandbox').onclick = () => {
    if (activeSandboxCfg?.systemPrompt) document.getElementById('gl-text').value = activeSandboxCfg.systemPrompt
  }
}
