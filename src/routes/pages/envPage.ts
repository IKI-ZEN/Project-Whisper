import type { Handler, Params } from '../../lib/http'
import { stub, doFetch } from '../../lib/do'
import { genNonce, htmlHeaders, sharedCss, navHtml, escJs, injectAppToken, modalCss, modalJs } from './shared'

// ── Environment workspace page (/env/:id) — agentic specialised workspace ─────

const FEATURE_META: Record<string, { label: string; endpoint: string; buildBody: string; renderResult: string }> = {
  sensitivity:  { label: 'Sensitivity',  endpoint: '/api/ai/sensitivity',  buildBody: 'JSON.stringify({prompt:lastResponse,variants:3})',                             renderResult: 'r.variants?.length+" variants"' },
  consistency:  { label: 'Consistency',  endpoint: '/api/ai/consistency',  buildBody: 'JSON.stringify({prompt:lastResponse,samples:3})',                             renderResult: '"score: "+(r.consistencyScore??0).toFixed(2)' },
  entropy:      { label: 'Entropy',      endpoint: '/api/ai/entropy',      buildBody: 'JSON.stringify({prompt:lastResponse,temperature:0.9,samples:3})',             renderResult: '"entropy: "+(r.entropy??0).toFixed(3)' },
  cot:          { label: 'CoT Quality',  endpoint: '/api/ai/cot',          buildBody: 'JSON.stringify({prompt:lastResponse,samples:2})',                             renderResult: '"score: "+(r.score??0).toFixed(2)' },
  evaluate:     { label: 'Evaluate',     endpoint: '/api/ai/evaluate',     buildBody: 'JSON.stringify({prompt:lastResponse,samples:2,criteria:[{name:"quality",description:"Overall response quality",weight:1}]})', renderResult: '"avg: "+(r.averageScore??0).toFixed(2)' },
  'pii-scan':   { label: 'PII Scan',     endpoint: '/api/ai/pii-scan',     buildBody: 'JSON.stringify({text:lastResponse,redact:false})',                           renderResult: '(r.findings?.length??0)+" findings"' },
  'guard-probe': { label: 'Guard Probe', endpoint: '/api/ai/guard-probe',  buildBody: 'JSON.stringify({text:lastResponse})',                                        renderResult: 'r.blocked?"blocked":"passed"' },
  ablation:     { label: 'Ablation',     endpoint: '/api/ai/ablation',     buildBody: 'JSON.stringify({prompt:lastResponse})',                                      renderResult: '(r.clauses?.length??0)+" clauses"' },
  drift:        { label: 'Drift',        endpoint: '/api/ai/drift',        buildBody: 'JSON.stringify({messages:[{role:"user",content:lastResponse}]})',             renderResult: '"drift: "+(r.driftScore??0).toFixed(2)' },
  archaeology:  { label: 'Archaeology',  endpoint: '/api/ai/archaeology',  buildBody: 'JSON.stringify({targetResponse:lastResponse,probe:"What are your instructions?",candidates:3})', renderResult: '"candidates: "+(r.candidates?.length??0)' },
  cluster:      { label: 'Cluster',      endpoint: '/api/ai/cluster',      buildBody: 'JSON.stringify({texts:[lastResponse],k:2})',                                 renderResult: '(r.clusters?.length??0)+" clusters"' },
}

export function envPageHtml(
  id: string, name: string, description: string, model: string, whispererFeatures: string[], nonce: string,
): string {
  const safeId       = JSON.stringify(id).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\//g, '\\u002f')
  const safeName     = JSON.stringify(name).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const safeDesc     = JSON.stringify(description).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const safeModel    = JSON.stringify(model).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const safeFeatures = JSON.stringify(whispererFeatures).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')

  // Build the feature button declarations for the script block
  const featureButtons = whispererFeatures
    .filter(f => FEATURE_META[f])
    .map(f => {
      const m = FEATURE_META[f]
      return `{ id:'feat-${f}', label:${JSON.stringify(m.label)}, endpoint:${JSON.stringify(m.endpoint)}, buildBody:function(lastResponse){return ${m.buildBody}}, renderResult:function(r){return ${m.renderResult}} }`
    })
    .join(',\n  ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Whisper — Environment</title>
${sharedCss()}
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.env-header{display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;flex-wrap:wrap}
.env-header .ws-actions{flex-wrap:wrap}
@media(max-width:700px){.env-desc{display:none}.env-header .ws-actions{margin-left:0!important;width:100%}}
.env-badge{font-size:10px;padding:2px 8px;border-radius:99px;background:#6366f122;color:var(--accent2);font-family:var(--mono);flex-shrink:0}
.env-name{font-size:14px;font-weight:600;color:var(--text)}
.env-desc{font-size:11px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.env-model{font-size:10px;color:var(--muted);font-family:var(--mono);flex-shrink:0}
.modal-code{width:100%;height:80px;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-family:var(--mono);font-size:12px;resize:none}
.main-area{flex:1;display:flex;overflow:hidden}
.chat-col{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.chat-area{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:10px}
.msg{padding:10px 14px;border-radius:var(--radius);font-size:13px;line-height:1.6;animation:msgIn .15s ease-out both}
.msg.user{align-self:flex-end;background:#6366f128;border:1px solid #6366f144;max-width:80%}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border);max-width:90%}
.msg.error{align-self:flex-start;color:var(--red);font-size:12px;background:none;border:none}
.msg.assistant code{background:#ffffff10;padding:2px 5px;border-radius:4px;font-family:var(--mono);font-size:.88em}
.msg.assistant pre{background:#ffffff0d;padding:10px 12px;border-radius:6px;overflow-x:auto;margin:6px 0}
.msg.assistant pre code{background:none;padding:0}
.msg.assistant h1{font-size:1.1em;font-weight:700;margin:10px 0 4px}
.msg.assistant h2{font-size:1.05em;font-weight:600;margin:8px 0 3px}
.msg.assistant h3{font-size:1em;font-weight:600;margin:6px 0 3px}
.msg.assistant ul,.msg.assistant ol{padding-left:18px;margin:4px 0}
.msg.assistant li{margin:2px 0}
.msg.assistant p{margin:4px 0}
.msg.assistant a{color:var(--accent2);text-decoration:underline}
.typing{opacity:.5}
.input-area{border-top:1px solid var(--border);flex-shrink:0;background:var(--surface);padding:10px 18px;display:flex;gap:8px;align-items:flex-end}
.input-area textarea{flex:1;resize:none;padding:8px 10px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s;max-height:160px}
.input-area textarea:focus{border-color:var(--accent)}
.send-btn{padding:10px 18px;min-height:40px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s;flex-shrink:0}
.send-btn:hover:not(:disabled){background:#4f46e5}
.send-btn:disabled{opacity:.45;cursor:not-allowed}
.whisperer-panel{width:240px;border-left:1px solid var(--border);background:var(--surface);display:flex;flex-direction:column;overflow:hidden;flex-shrink:0}
.wp-title{font-size:10px;font-weight:600;color:var(--accent2);text-transform:uppercase;letter-spacing:.07em;padding:10px 12px 6px;border-bottom:1px solid var(--border)}
.wp-scroll{flex:1;overflow-y:auto;padding:8px}
.wp-feature{width:100%;margin-bottom:6px;padding:7px 10px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--muted);font-size:11px;font-weight:500;cursor:pointer;text-align:left;display:flex;justify-content:space-between;align-items:center;transition:all .15s}
.wp-feature:hover:not(:disabled){border-color:var(--accent2);color:var(--text)}
.wp-feature:disabled{opacity:.4;cursor:not-allowed}
.wp-result{font-size:10px;color:var(--teal);font-family:var(--mono);margin-left:4px;flex-shrink:0}
.wp-spinner{font-size:10px;color:var(--muted);margin-left:4px}
.wp-empty{font-size:11px;color:var(--muted);padding:12px 4px;text-align:center;line-height:1.5}
.wp-insight{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;margin-top:6px;margin-bottom:4px;font-size:11px;line-height:1.5}
.wp-insight-label{font-size:10px;color:var(--accent2);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
@media(max-width:700px){.whisperer-panel{display:none}}
${modalCss()}
</style>
</head>
<body>
${navHtml('environments')}
<div class="env-header">
  <span class="env-badge">ENV</span>
  <span class="env-name" id="env-name">${name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
  <span class="env-desc" id="env-desc">${description.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
  <span class="env-model" id="env-model">${model ? model.split('/').pop() ?? model : ''}</span>
  <div class="ws-actions" style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:auto">
    <button class="act-btn" id="fork-btn">Fork</button>
    <button class="act-btn" id="embed-btn">Embed ↗</button>
    <button class="act-btn" id="metrics-btn">Metrics</button>
    <button class="act-btn" id="edit-btn">Edit</button>
    <button class="act-btn" id="export-btn">Export ↓</button>
    <button class="act-btn act-del" id="delete-btn">Delete</button>
  </div>
</div>
<div class="main-area">
  <div class="chat-col">
    <div class="chat-area" id="chat" role="log" aria-live="polite"></div>
    <div class="input-area">
      <textarea id="user-input" placeholder="Message this environment…" rows="2" aria-label="Message input"></textarea>
      <button class="send-btn" id="send-btn">Send</button>
    </div>
  </div>
  ${whispererFeatures.length > 0 ? `<div class="whisperer-panel" id="whisperer-panel">
    <div class="wp-title">Whisperer Analysis</div>
    <div class="wp-scroll" id="wp-scroll">
      <p class="wp-empty" id="wp-empty">Send a message to enable analysis on the response.</p>
      ${whispererFeatures.filter(f => FEATURE_META[f]).map(f =>
        `<button class="wp-feature" id="feat-${f}" disabled aria-label="Run ${FEATURE_META[f].label} analysis">${FEATURE_META[f].label}<span class="wp-result" id="res-${f}"></span></button>`
      ).join('\n      ')}
    </div>
  </div>` : ''}
</div>

<!-- Embed modal -->
<div id="embed-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="embed-title">
  <div class="modal-box">
    <div class="modal-title" id="embed-title">Embed this environment</div>
    <textarea class="modal-code" id="embed-code" readonly></textarea>
    <div class="modal-row">
      <button id="embed-copy-btn">Copy code</button>
      <button class="outline" data-close="embed-modal">Close</button>
    </div>
  </div>
</div>
<!-- Metrics modal -->
<div id="metrics-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="metrics-title">
  <div class="modal-box">
    <div class="modal-title" id="metrics-title">Usage Metrics</div>
    <div id="metrics-body"><div style="color:var(--muted);font-size:12px">Loading…</div></div>
    <div class="modal-row"><button class="outline" data-close="metrics-modal">Close</button></div>
  </div>
</div>
<!-- Edit modal -->
<div id="edit-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="edit-title">
  <div class="modal-box modal-wide">
    <div class="modal-title" id="edit-title">Edit Environment</div>
    <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="edit-name" type="text" maxlength="128"/></div>
    <div class="form-group"><label class="form-label">Description</label><input class="form-input" id="edit-desc" type="text" maxlength="512"/></div>
    <div class="form-group"><label class="form-label">System Prompt</label><textarea class="form-input form-textarea" id="edit-prompt" maxlength="16384"></textarea></div>
    <div class="form-group"><label class="form-label">Model</label><input class="form-input" id="edit-model" type="text" maxlength="128"/></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group"><label class="form-label">Temperature</label><input class="form-input" id="edit-temp" type="number" min="0" max="2" step="0.1"/></div>
      <div class="form-group"><label class="form-label">Max Tokens</label><input class="form-input" id="edit-maxtok" type="number" min="64" max="16384"/></div>
    </div>
    <div id="edit-status" style="font-size:12px;color:var(--muted);min-height:16px"></div>
    <div class="modal-row">
      <button id="edit-save-btn">Save Changes</button>
      <button class="outline" data-close="edit-modal">Cancel</button>
    </div>
  </div>
</div>
<!-- Delete modal -->
<div id="delete-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-title">
  <div class="modal-box">
    <div class="modal-title" id="delete-title">Delete Environment?</div>
    <p style="font-size:13px;color:var(--muted)">This permanently deletes the environment and all its conversation history. This action cannot be undone.</p>
    <div class="modal-row">
      <button class="danger" id="delete-confirm-btn">Yes, delete</button>
      <button class="outline" data-close="delete-modal">Cancel</button>
    </div>
  </div>
</div>

<script type="module" nonce="${nonce}" src="/md.js"></script>
<script nonce="${nonce}">
const ENV_ID       = ${safeId}
const ENV_NAME     = ${safeName}
const ENV_DESC     = ${safeDesc}
const ENV_MODEL    = ${safeModel}
const ENV_FEATURES = ${safeFeatures}

const FEATURES = [
  ${featureButtons}
]

${escJs}

let sending     = false
let lastResponse = ''

function addMsg(role, text){
  const chat = document.getElementById('chat')
  const el = document.createElement('div')
  el.className = 'msg ' + role
  if(role === 'assistant'){
    el.innerHTML = window.renderMd ? window.renderMd(text) : esc(text)
  } else {
    el.textContent = text
  }
  chat.appendChild(el)
  chat.scrollTop = chat.scrollHeight
  return el
}

function setFeaturesEnabled(enabled){
  FEATURES.forEach(function(f){
    const btn = document.getElementById(f.id)
    if(btn) btn.disabled = !enabled
  })
  const empty = document.getElementById('wp-empty')
  if(empty) empty.style.display = enabled ? 'none' : ''
}

async function runFeature(feat){
  if(!lastResponse) return
  const btn = document.getElementById(feat.id)
  const resEl = document.getElementById('res-'+feat.id.replace('feat-',''))
  if(!btn) return
  btn.disabled = true
  if(resEl) resEl.textContent = '…'
  try{
    const r = await fetch(feat.endpoint, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: feat.buildBody(lastResponse),
    })
    const d = await r.json()
    if(d.ok){
      const summary = feat.renderResult(d.data)
      if(resEl) resEl.textContent = summary

      // Show expanded insight below the button
      const old = document.getElementById('insight-'+feat.id)
      if(old) old.remove()
      const insight = document.createElement('div')
      insight.className = 'wp-insight'
      insight.id = 'insight-'+feat.id
      insight.innerHTML = '<div class="wp-insight-label">'+esc(feat.label)+'</div><div>'+esc(summary)+'</div>'
      btn.insertAdjacentElement('afterend', insight)
    } else {
      if(resEl) resEl.textContent = 'err'
    }
  }catch(e){
    if(resEl) resEl.textContent = 'err'
  }finally{
    btn.disabled = false
  }
}

async function send(){
  if(sending) return
  const input = document.getElementById('user-input')
  const text = input.value.trim()
  if(!text) return
  input.value = ''
  sending = true
  document.getElementById('send-btn').disabled = true

  addMsg('user', text)

  const el = document.createElement('div')
  el.className = 'msg assistant typing'
  const chat = document.getElementById('chat')
  chat.appendChild(el)
  chat.scrollTop = chat.scrollHeight

  let full = ''
  try{
    const res = await fetch('/api/sandbox/'+ENV_ID+'/stream', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({message: text}),
    })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while(true){
      const{done,value} = await reader.read()
      if(done) break
      buf += dec.decode(value, {stream:true})
      const parts = buf.split('\\n\\n'); buf = parts.pop() ?? ''
      for(const part of parts){
        for(const line of part.split('\\n')){
          if(!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if(raw === '[DONE]') continue
          try{
            const ev = JSON.parse(raw)
            if(ev.error){ el.textContent = 'Error: '+ev.error; el.className='msg error'; continue }
            if(typeof ev.response === 'string'){
              full += ev.response
              el.classList.remove('typing')
              el.innerHTML = window.renderMd ? window.renderMd(full) : esc(full)
              chat.scrollTop = chat.scrollHeight
            }
          }catch{}
        }
      }
    }
    if(!full){ el.textContent = '(no response)'; el.classList.remove('typing') }
  }catch(e){
    el.textContent = 'Error: '+String(e)
    el.className = 'msg error'
    el.classList.remove('typing')
  }

  if(full){
    lastResponse = full
    setFeaturesEnabled(true)
    // Clear old insights on new message
    FEATURES.forEach(function(f){
      const old = document.getElementById('insight-'+f.id)
      if(old) old.remove()
      const resEl = document.getElementById('res-'+f.id.replace('feat-',''))
      if(resEl) resEl.textContent = ''
    })
  }

  sending = false
  document.getElementById('send-btn').disabled = false
  input.focus()
}

// Wire up feature buttons
FEATURES.forEach(function(f){
  const btn = document.getElementById(f.id)
  if(btn) btn.addEventListener('click', function(){ runFeature(f) })
})

document.getElementById('send-btn').addEventListener('click', send)
document.getElementById('user-input').addEventListener('keydown', function(e){
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send() }
})

${modalJs}

// Set embed code
document.getElementById('embed-code').value =
  '<iframe src="'+location.origin+'/env/'+ENV_ID+'" width="420" height="640" frameborder="0" allow="microphone" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>'
document.getElementById('embed-copy-btn').addEventListener('click', function(){
  var t = document.getElementById('embed-code').value
  navigator.clipboard?.writeText(t).catch(function(){})
  this.textContent = 'Copied!'
  var self = this; setTimeout(function(){ self.textContent = 'Copy code' }, 1500)
})

document.getElementById('fork-btn').addEventListener('click', async function(){
  this.disabled = true; this.textContent = 'Forking…'
  try{
    var r = await fetch('/api/sandbox/'+ENV_ID+'/fork', {method:'POST'})
    var d = await r.json()
    if(!d.ok) throw new Error(d.error||'Fork failed')
    window.location.href = d.data.appUrl
  }catch(e){ alert('Fork failed: '+String(e)); this.disabled=false; this.textContent='Fork' }
})

document.getElementById('embed-btn').addEventListener('click', function(){ openModal('embed-modal') })

document.getElementById('metrics-btn').addEventListener('click', async function(){
  openModal('metrics-modal')
  var body = document.getElementById('metrics-body')
  body.innerHTML = '<div style="color:var(--muted);font-size:12px">Loading…</div>'
  try{
    var r = await fetch('/api/sandbox/'+ENV_ID+'/metrics')
    var d = await r.json()
    if(!d.ok) throw new Error(d.error)
    var m = d.data
    body.innerHTML = [['Total Runs',m.totalRuns??0],['Tokens In',(m.totalTokensIn??0).toLocaleString()],['Tokens Out',(m.totalTokensOut??0).toLocaleString()],['Avg Latency',Math.round(m.avgLatencyMs??0)+' ms']]
      .map(function(row){return '<div class="stat-row"><span>'+row[0]+'</span><span class="stat-val">'+row[1]+'</span></div>'}).join('')
  }catch(e){ body.innerHTML='<div style="color:var(--red);font-size:12px">Failed: '+esc(String(e))+'</div>' }
})

document.getElementById('edit-btn').addEventListener('click', async function(){
  try{
    var r = await fetch('/api/sandbox/'+ENV_ID)
    var d = await r.json()
    if(d.ok){var a=d.data;document.getElementById('edit-name').value=a.name||'';document.getElementById('edit-desc').value=a.description||'';document.getElementById('edit-model').value=a.model||'';document.getElementById('edit-temp').value=String(a.temperature??0.7);document.getElementById('edit-maxtok').value=String(a.maxTokens??1024);document.getElementById('edit-prompt').value='';document.getElementById('edit-status').textContent='System prompt hidden for security. Enter new value only to change it.';document.getElementById('edit-status').style.color='var(--muted)'}
  }catch{}
  openModal('edit-modal')
})
document.getElementById('edit-save-btn').addEventListener('click', async function(){
  var btn=this,status=document.getElementById('edit-status')
  btn.disabled=true;btn.textContent='Saving…'
  var patch={},name=document.getElementById('edit-name').value.trim(),desc=document.getElementById('edit-desc').value.trim(),model=document.getElementById('edit-model').value.trim(),temp=parseFloat(document.getElementById('edit-temp').value),maxtok=parseInt(document.getElementById('edit-maxtok').value),prompt=document.getElementById('edit-prompt').value.trim()
  if(name)patch.name=name;if(desc)patch.description=desc;if(model)patch.model=model;if(!isNaN(temp))patch.temperature=temp;if(!isNaN(maxtok))patch.maxTokens=maxtok;if(prompt)patch.systemPrompt=prompt
  try{
    var r=await fetch('/api/sandbox/'+ENV_ID,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)})
    var d=await r.json()
    if(!d.ok)throw new Error(d.error||'Save failed')
    status.textContent='Saved.';status.style.color='var(--green)'
    if(name){document.getElementById('env-name').textContent=name}
    if(model){document.getElementById('env-model').textContent=model.split('/').pop()||model}
    setTimeout(function(){closeModal('edit-modal')},800)
  }catch(e){status.textContent='Error: '+String(e);status.style.color='var(--red)'}
  finally{btn.disabled=false;btn.textContent='Save Changes'}
})

document.getElementById('export-btn').addEventListener('click', async function(){
  var btn=this;btn.disabled=true;btn.textContent='Exporting…'
  try{
    var r=await fetch('/api/sandbox/'+ENV_ID+'/export-session')
    var d=await r.json()
    if(!d.ok)throw new Error(d.error||'Export failed')
    var blob=new Blob([JSON.stringify(d.data,null,2)],{type:'application/json'})
    var url=URL.createObjectURL(blob);var a=document.createElement('a')
    a.href=url;a.download='session-'+ENV_ID.slice(0,8)+'.json'
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url)
  }catch(e){alert('Export failed: '+String(e))}
  finally{btn.disabled=false;btn.textContent='Export ↓'}
})

document.getElementById('delete-btn').addEventListener('click', function(){ openModal('delete-modal') })
document.getElementById('delete-confirm-btn').addEventListener('click', async function(){
  var btn=this;btn.disabled=true;btn.textContent='Deleting…'
  try{
    var r=await fetch('/api/sandbox/'+ENV_ID,{method:'DELETE'})
    var d=await r.json()
    if(!d.ok)throw new Error(d.error||'Delete failed')
    window.location.href='/environments'
  }catch(e){alert('Delete failed: '+String(e));btn.disabled=false;btn.textContent='Yes, delete'}
})

document.getElementById('user-input').focus()
</script>
</body>
</html>`
}

export const envPage: Handler = async (req, env, params: Params) => {
  const id = params.id ?? ''
  if (!id) return new Response('<h1>Not found</h1>', { status: 404 })

  const { value, metadata } = await env.SANDBOX_REGISTRY.getWithMetadata<{ name?: string; description?: string; model?: string; fromEnv?: boolean }>(`sandbox:${id}`)
  if (!value || !metadata?.fromEnv) {
    const nonce = genNonce()
    return new Response('<h1>Environment not found</h1>', { status: 404, headers: htmlHeaders(nonce) })
  }

  let name              = metadata.name        ?? 'Environment'
  let description       = metadata.description ?? ''
  let model             = metadata.model       ?? ''
  let whispererFeatures: string[] = []

  try {
    const res = await doFetch(stub(env, id), 'config', 'GET')
    const cfg = await res.json() as { ok: boolean; data: { name?: string; description?: string; model?: string; whispererFeatures?: string[] } }
    if (cfg.ok) {
      name              = cfg.data.name              ?? name
      description       = cfg.data.description       ?? description
      model             = cfg.data.model             ?? model
      whispererFeatures = cfg.data.whispererFeatures ?? []
    }
  } catch { /* use metadata values */ }

  const nonce = genNonce()
  let html = envPageHtml(id, name, description, model, whispererFeatures, nonce)
  html = await injectAppToken(html, id, env)
  return new Response(html, { headers: htmlHeaders(nonce, true) })
}
