import type { Handler, Params } from '../../lib/http'
import { stub, doFetch } from '../../lib/do'
import { genNonce, htmlHeaders, sharedCss, navHtml, escJs, modalCss, modalJs } from './shared'

// ── Lab page (/lab/:id) — multi-model comparison workspace ────────────────────

export function labPageHtml(
  id: string, envType: string, envModels: string[], systemPrompt: string, ragEnabled: boolean, nonce: string,
): string {
  const safeId      = JSON.stringify(id).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\//g, '\\u002f')
  const safeType    = JSON.stringify(envType).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const safeModels  = JSON.stringify(envModels).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const safeSys     = JSON.stringify(systemPrompt).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\//g, '\\u002f')
  const safeRag     = ragEnabled ? 'true' : 'false'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Whisper — Lab</title>
${sharedCss()}
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);height:100dvh;display:flex;flex-direction:column;overflow:hidden}
#lab-name{font-size:13px;font-weight:600;color:var(--accent2);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.type-badge{font-size:10px;padding:2px 8px;border-radius:99px;background:#6366f122;color:var(--accent2);font-family:var(--mono);flex-shrink:0;white-space:nowrap}
.model-strip{display:flex;align-items:center;gap:6px;padding:8px 18px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;overflow-x:auto;position:relative}
.model-strip::after{content:'';position:absolute;right:0;top:0;bottom:0;width:32px;background:linear-gradient(to right,transparent,var(--surface));pointer-events:none}
.model-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 10px;border-radius:99px;background:#6366f122;border:1px solid #6366f144;color:var(--accent2);white-space:nowrap;flex-shrink:0}
.model-pill .rm{background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;padding:0 0 0 2px;display:inline-flex;align-items:center}
.model-pill .rm:hover{color:var(--red)}
.add-model-btn{font-size:11px;padding:3px 10px;border-radius:99px;background:none;border:1px dashed var(--border);color:var(--muted);cursor:pointer;white-space:nowrap;flex-shrink:0;transition:border-color .15s,color .15s}
.add-model-btn:hover{border-color:var(--accent2);color:var(--accent2)}
.strip-sep{flex:1}
.options-btn{font-size:11px;padding:4px 10px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;flex-shrink:0;transition:all .15s}
.options-btn:hover{border-color:var(--accent2);color:var(--accent2)}
.compare-grid{display:grid;flex:1;overflow:hidden;gap:0}
.compare-grid.cols-1{grid-template-columns:1fr}
.compare-grid.cols-2{grid-template-columns:repeat(2,1fr)}
.compare-grid.cols-3{grid-template-columns:repeat(3,1fr)}
.compare-grid.cols-4{grid-template-columns:repeat(4,1fr)}
@media(max-width:900px){.compare-grid.cols-3,.compare-grid.cols-4{grid-template-columns:repeat(2,1fr)!important}}
@media(max-width:600px){.compare-grid.cols-2,.compare-grid.cols-3,.compare-grid.cols-4{grid-template-columns:1fr!important}.model-strip{flex-wrap:wrap}}
.col-panel{display:flex;flex-direction:column;border-right:1px solid var(--border);overflow:hidden}
.col-panel:last-child{border-right:none}
.col-header{display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}
.col-model-label{font-size:11px;font-family:var(--mono);color:var(--accent2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.col-latency{font-size:11px;color:var(--teal);font-family:var(--mono);flex-shrink:0}
.col-messages{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;min-height:60px}
.msg{padding:8px 12px;border-radius:var(--radius);font-size:13px;line-height:1.55;animation:msgIn .15s ease-out both}
.msg.user{align-self:flex-end;background:#6366f128;border:1px solid #6366f144;max-width:85%}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border);width:100%}
.msg.system{align-self:center;color:var(--muted);font-size:11px;font-style:italic}
.msg.error{align-self:flex-start;color:var(--red);font-size:12px}
.msg.assistant code{background:#ffffff10;padding:2px 5px;border-radius:4px;font-family:var(--mono);font-size:.88em}
.msg.assistant pre{background:#ffffff0d;padding:10px 12px;border-radius:6px;overflow-x:auto;margin:6px 0}
.msg.assistant pre code{background:none;padding:0}
.msg.assistant h1{font-size:1.1em;font-weight:700;margin:10px 0 4px}
.msg.assistant h2{font-size:1.05em;font-weight:600;margin:8px 0 3px}
.msg.assistant h3{font-size:1em;font-weight:600;margin:6px 0 3px}
.msg.assistant ul,.msg.assistant ol{padding-left:18px;margin:4px 0}
.msg.assistant li{margin:2px 0}
.msg.assistant blockquote{border-left:3px solid var(--border);padding-left:10px;color:var(--muted);margin:4px 0}
.msg.assistant p{margin:4px 0}
.msg.assistant a{color:var(--accent2);text-decoration:underline;text-underline-offset:2px}
.typing{opacity:.5}
.input-area{border-top:1px solid var(--border);flex-shrink:0;background:var(--surface)}
.input-row{display:flex;gap:8px;padding:10px 18px}
.input-row textarea{flex:1;resize:none;padding:8px 10px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.input-row textarea.mono-input{font-family:var(--mono)}
.input-row textarea:focus{border-color:var(--accent)}
.send-btn{padding:10px 18px;min-height:40px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s;flex-shrink:0}
.send-btn:hover:not(:disabled){background:#4f46e5}
.send-btn:disabled{opacity:.45;cursor:not-allowed}
.options-panel{border-top:1px solid var(--border);padding:10px 18px;display:none;grid-template-columns:1fr 1fr;gap:10px 24px;align-items:start}
.options-panel.open{display:grid}
.opt-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);display:block;margin-bottom:4px}
.opt-input{width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:11px;font-family:inherit;outline:none}
.opt-input:focus{border-color:var(--accent)}
.opt-full{grid-column:1/-1}
.opt-textarea{resize:none;height:56px}
.slider-row{display:flex;align-items:center;gap:8px}
.opt-slider{flex:1;accent-color:var(--accent)}
.opt-val{font-size:11px;color:var(--muted);font-family:var(--mono);width:28px;text-align:right}
.hist-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--muted);user-select:none}
.hist-toggle input{accent-color:var(--accent)}
.hist-badge{font-size:11px;padding:2px 7px;border-radius:99px;background:#10b98122;color:var(--green);font-family:var(--mono)}
.consensus-bar{display:flex;align-items:center;gap:8px;padding:4px 12px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;font-size:11px;color:var(--muted);min-height:24px}
.consensus-score{font-family:var(--mono);color:var(--teal)}
.col-cost{font-size:11px;color:var(--muted);font-family:var(--mono)}
.star-btn{background:none;border:none;cursor:pointer;font-size:14px;opacity:.4;padding:0;line-height:1;transition:opacity .15s}
.star-btn:hover,.star-btn.active{opacity:1}
.model-picker{position:relative}
.model-picker input{padding:4px 8px;border-radius:var(--radius);background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:11px;font-family:var(--mono);width:200px;outline:none}
.model-picker input:focus{border-color:var(--accent)}
.modal-code{width:100%;height:80px;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-family:var(--mono);font-size:12px;resize:none}
${modalCss()}
</style>
</head>
<body>
${navHtml('lab', '  <span id="lab-name">Loading…</span>\n  <span id="lab-type-badge" class="type-badge"></span>')}

<div class="model-strip" id="model-strip" role="toolbar" aria-label="Active models"></div>
<div class="consensus-bar" id="consensus-bar" style="display:none"></div>

<div class="compare-grid cols-1" id="compare-grid"></div>

<div class="input-area">
  <div class="options-panel" id="options-panel">
    <div>
      <label class="opt-label" for="opt-temp">Temperature</label>
      <div class="slider-row">
        <input type="range" id="opt-temp" class="opt-slider" min="0" max="20" value="7" step="1" aria-label="Temperature"/>
        <span id="opt-temp-val" class="opt-val">0.7</span>
      </div>
    </div>
    <div>
      <label class="opt-label" for="opt-maxtok">Max tokens</label>
      <input type="number" id="opt-maxtok" class="opt-input" min="64" max="8192" value="1024" style="width:80px"/>
    </div>
    <div class="opt-full">
      <label class="opt-label" for="opt-sys">System prompt</label>
      <textarea id="opt-sys" class="opt-input opt-textarea" placeholder="System prompt…" aria-label="System prompt"></textarea>
    </div>
    <div>
      <label class="opt-label">History</label>
      <label class="hist-toggle"><input type="checkbox" id="opt-hist"/> Include conversation history</label>
    </div>
    <div>
      <button class="opt-input" id="clear-hist-btn" style="cursor:pointer;background:none;border:1px solid var(--border);color:var(--muted);width:auto;padding:4px 10px" title="Clear stored history">Clear history</button>
    </div>
    <div class="opt-full">
      <button class="opt-input" id="export-compare-btn" style="cursor:pointer;background:none;border:1px solid var(--border);color:var(--muted);width:auto;padding:4px 10px">Export comparison as JSONL</button>
    </div>
  </div>
  <div class="input-row">
    <textarea id="user-input" placeholder="Type a message… (Enter to send, Shift+Enter for new line)" rows="2" aria-label="Message input"></textarea>
    <button class="send-btn" id="send-btn">Send</button>
    <button class="options-btn" id="options-toggle" aria-expanded="false" title="Toggle options">⚙</button>
  </div>
</div>

<!-- Metrics modal -->
<div id="metrics-modal" class="modal-overlay" role="dialog" aria-modal="true">
  <div class="modal-box">
    <div class="modal-title">Usage Metrics</div>
    <div id="metrics-body"><div style="color:var(--muted);font-size:12px">Loading…</div></div>
    <div class="modal-row"><button class="outline" data-close="metrics-modal">Close</button></div>
  </div>
</div>
<!-- Edit modal -->
<div id="edit-modal" class="modal-overlay" role="dialog" aria-modal="true">
  <div class="modal-box" style="width:520px">
    <div class="modal-title">Edit Lab</div>
    <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="edit-name" type="text" maxlength="128"/></div>
    <div class="form-group"><label class="form-label">Description</label><input class="form-input" id="edit-desc" type="text" maxlength="512"/></div>
    <div class="form-group"><label class="form-label">System Prompt</label><textarea class="form-input form-textarea" id="edit-prompt" maxlength="16384"></textarea></div>
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
<div id="delete-modal" class="modal-overlay" role="dialog" aria-modal="true">
  <div class="modal-box">
    <div class="modal-title">Delete Lab?</div>
    <p style="font-size:13px;color:var(--muted)">This permanently deletes this lab. The conversation history will be lost. This action cannot be undone.</p>
    <div class="modal-row">
      <button class="danger" id="delete-confirm-btn">Yes, delete</button>
      <button class="outline" data-close="delete-modal">Cancel</button>
    </div>
  </div>
</div>

<datalist id="lab-models-list">
  <option value="@cf/meta/llama-3.1-8b-instruct"/>
  <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast"/>
  <option value="@cf/google/gemma-3-12b-it"/>
  <option value="openai:gpt-4o-mini"/>
  <option value="openai:gpt-4o"/>
  <option value="anthropic:claude-haiku-4-5-20251001"/>
  <option value="anthropic:claude-sonnet-4-6"/>
  <option value="google:gemini-2.0-flash"/>
  <option value="google:gemini-1.5-pro"/>
</datalist>

<script type="module" nonce="${nonce}" src="/md.js"></script>
<script nonce="${nonce}">
const LAB_ID     = ${safeId}
const LAB_TYPE   = ${safeType}
const LAB_MODELS = ${safeModels}
const LAB_SYS    = ${safeSys}
const LAB_RAG    = ${safeRag}

const MAX_MODELS = 4
const LS_KEY     = 'lab:' + LAB_ID + ':models'
const LS_HIST_KEY = 'lab:' + LAB_ID + ':hist'

const COST_TABLE = {
  'llama-3.1-8b-instruct':           {i:0.0001, o:0.0001},
  'llama-3.3-70b-instruct-fp8-fast': {i:0.0003, o:0.0005},
  'gpt-4o-mini':                     {i:0.00015,o:0.0006},
  'gpt-4o':                          {i:0.0025, o:0.01},
  'claude-haiku-4-5-20251001':       {i:0.0008, o:0.004},
  'claude-sonnet-4-6':               {i:0.003,  o:0.015},
  'claude-opus-4-7':                 {i:0.015,  o:0.075},
  'gemini-2.0-flash':                {i:0.0001, o:0.0004},
  'gemini-1.5-pro':                  {i:0.00125,o:0.005},
}
function estimateCost(model, inputChars, outputChars){
  const bare = model.includes(':') ? model.split(':').slice(1).join(':') : model
  const key = Object.keys(COST_TABLE).find(function(k){ return bare.includes(k) })
  const p = COST_TABLE[key] || {i:0.0001, o:0.0001}
  const tokIn  = inputChars  / 4
  const tokOut = outputChars / 4
  return (tokIn/1000)*p.i + (tokOut/1000)*p.o
}
function fmtCost(usd){ return usd < 0.0001 ? '<$0.0001' : '$'+(usd).toFixed(4) }

let models      = JSON.parse(localStorage.getItem(LS_KEY) || 'null') || LAB_MODELS.slice()
let temperature = 0.7
let maxTokens   = 1024
let systemPrompt = LAB_SYS
let history = []
let histEnabled = false
let lastComparison = null

${escJs}

function renderModelStrip(){
  const strip = document.getElementById('model-strip')
  strip.innerHTML = ''
  models.forEach(function(m){
    const pill = document.createElement('div')
    pill.className = 'model-pill'
    pill.setAttribute('role','listitem')
    const label = m.split('/').pop() || m
    pill.innerHTML = '<span title="'+esc(m)+'">'+esc(label)+'</span>'
    if(models.length > 1){
      const rm = document.createElement('button')
      rm.className = 'rm'
      rm.setAttribute('aria-label','Remove '+label)
      rm.textContent = '\xd7'
      rm.onclick = function(){ removeModel(m) }
      pill.appendChild(rm)
    }
    strip.appendChild(pill)
  })
  if(models.length < MAX_MODELS){
    const sep = document.createElement('span'); sep.className='strip-sep'; strip.appendChild(sep)
    const addPicker = document.createElement('div'); addPicker.className='model-picker'
    const addInput = document.createElement('input')
    addInput.type = 'text'
    addInput.placeholder = '+ Add model'
    addInput.setAttribute('list','lab-models-list')
    addInput.setAttribute('aria-label','Add model')
    addInput.onkeydown = function(e){
      if(e.key==='Enter'&&addInput.value.trim()){addModel(addInput.value.trim());addInput.value=''}
    }
    addInput.onchange = function(){
      const v=addInput.value.trim()
      if(v&&!models.includes(v)&&models.length<MAX_MODELS){addModel(v);addInput.value=''}
    }
    addPicker.appendChild(addInput); strip.appendChild(addPicker)
  } else {
    const sep = document.createElement('span'); sep.className='strip-sep'; strip.appendChild(sep)
  }
  const optBtn = document.createElement('button')
  optBtn.id = 'options-toggle'
  optBtn.className = 'options-btn'
  optBtn.setAttribute('aria-expanded', document.getElementById('options-panel').classList.contains('open') ? 'true' : 'false')
  optBtn.title = 'Toggle options'
  optBtn.textContent = '⚙'
  optBtn.onclick = toggleOptions
  strip.appendChild(optBtn)
  const histBadge = document.createElement('span')
  histBadge.id = 'hist-badge'
  histBadge.className = 'hist-badge'
  histBadge.style.display = 'none'
  strip.appendChild(histBadge)

  // Action buttons — right side of strip
  ;['Fork','Metrics','Edit','Export','Delete'].forEach(function(label){
    var btn = document.createElement('button')
    btn.className = 'act-btn' + (label==='Delete'?' act-del':'')
    btn.textContent = label
    btn.title = {Fork:'Create a copy',Metrics:'View usage metrics',Edit:'Edit lab config',Export:'Export lab config',Delete:'Delete this lab'}[label]
    btn.id = 'lab-'+label.toLowerCase()+'-btn'
    strip.appendChild(btn)
  })

  updateHistBadge()
  updateGrid()
  wireLabActions()
}

function addModel(m){
  if(!models.includes(m)&&models.length<MAX_MODELS){
    models.push(m)
    localStorage.setItem(LS_KEY, JSON.stringify(models))
    renderModelStrip()
    ensureColumns()
  }
}
function removeModel(m){
  if(models.length<=1)return
  models = models.filter(function(x){return x!==m})
  localStorage.setItem(LS_KEY, JSON.stringify(models))
  const col = document.getElementById('col-'+CSS.escape(m))
  if(col)col.remove()
  renderModelStrip()
  updateGrid()
}

function updateGrid(){
  const grid = document.getElementById('compare-grid')
  const n = models.length
  grid.className = 'compare-grid cols-'+n
}

function ensureColumns(){
  const grid = document.getElementById('compare-grid')
  models.forEach(function(m){
    const eid = 'col-'+CSS.escape(m)
    if(!document.getElementById(eid)){
      const col = document.createElement('div')
      col.className = 'col-panel'
      col.id = eid
      const label = m.split('/').pop() || m
      col.innerHTML = '<div class="col-header" id="hdr-'+esc(eid)+'">'
                    + '<button class="star-btn" id="star-'+esc(eid)+'" title="Mark as best" aria-label="Mark as best response">★</button>'
                    + '<span class="col-model-label" title="'+esc(m)+'">'+esc(label)+'</span>'
                    + '<span class="col-cost" id="cost-'+esc(eid)+'"></span>'
                    + '<span class="col-latency" id="lat-'+esc(eid)+'"></span>'
                    + '</div>'
                    + '<div class="col-messages" id="msgs-'+esc(eid)+'"></div>'
      grid.appendChild(col)
      document.getElementById('star-'+esc(eid)).onclick = function(){
        document.querySelectorAll('.star-btn').forEach(function(b){b.classList.remove('active')})
        this.classList.add('active')
      }
    }
  })
  updateGrid()
}

function typeOpts(){
  if(LAB_TYPE==='structured') return {responseFormat:'json'}
  if(LAB_TYPE==='creative')   return {temperature: Math.max(temperature, 1.0)}
  return {}
}

function isResearch(){ return LAB_RAG === true }

async function streamColumn(model, messages){
  const eid   = 'col-'+CSS.escape(model)
  const msgsEl = document.getElementById('msgs-'+eid)
  const latEl  = document.getElementById('lat-'+eid)
  if(!msgsEl)return
  const t0 = Date.now()
  if(latEl) latEl.textContent = '…'
  const el = document.createElement('div')
  el.className = 'msg assistant typing'
  msgsEl.appendChild(el)
  msgsEl.scrollTop = msgsEl.scrollHeight

  const endpoint = isResearch() ? '/api/sandbox/'+LAB_ID+'/stream' : '/api/ai/stream'
  const body = isResearch()
    ? JSON.stringify({message: messages[messages.length-1].content})
    : JSON.stringify({messages, model, systemPrompt, temperature, maxTokens, ...typeOpts()})

  let full = ''
  try{
    const res = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body})
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf=''
    while(true){
      const{done,value}=await reader.read()
      if(done)break
      buf+=dec.decode(value,{stream:true})
      const parts=buf.split('\\n\\n');buf=parts.pop()??''
      for(const part of parts){
        for(const line of part.split('\\n')){
          if(!line.startsWith('data:'))continue
          const raw=line.slice(5).trim()
          if(raw==='[DONE]')continue
          try{
            const ev=JSON.parse(raw)
            if(ev.done){if(latEl)latEl.textContent=(Date.now()-t0)+'ms';continue}
            if(ev.error){el.textContent='Error: '+ev.error;el.className='msg error';continue}
            if(typeof ev.response==='string'){
              full+=ev.response
              el.classList.remove('typing')
              if(LAB_TYPE==='structured'){
                try{el.innerHTML='<pre>'+esc(JSON.stringify(JSON.parse(full),null,2))+'</pre>'}
                catch{el.textContent=full}
              } else {
                el.innerHTML=window.renderMd(full)
              }
              msgsEl.scrollTop=msgsEl.scrollHeight
            }
          }catch{}
        }
      }
    }
    if(!full){el.textContent='(no response)';el.classList.remove('typing')}
    if(latEl&&latEl.textContent==='…')latEl.textContent=(Date.now()-t0)+'ms'
    const costEl = document.getElementById('cost-'+eid)
    if(costEl && full){
      const inputLen = messages ? messages.reduce(function(s,m){return s+(typeof m.content==='string'?m.content.length:0)},0) : 0
      costEl.textContent = fmtCost(estimateCost(model, inputLen, full.length))
    }
  }catch(e){
    el.textContent='Error: '+e
    el.className='msg error'
    el.classList.remove('typing')
    if(latEl)latEl.textContent='err'
  }
  return full
}

async function send(){
  const input = document.getElementById('user-input')
  const text = input.value.trim()
  if(!text)return
  input.value=''
  document.getElementById('send-btn').disabled=true

  models.forEach(function(m){
    const eid='col-'+CSS.escape(m)
    const msgsEl=document.getElementById('msgs-'+eid)
    if(!msgsEl)return
    const el=document.createElement('div')
    el.className='msg user'
    el.textContent=text
    msgsEl.appendChild(el)
    msgsEl.scrollTop=msgsEl.scrollHeight
  })

  const msgs = histEnabled
    ? [...history, {role:'user', content:text}]
    : [{role:'user', content:text}]

  const results = await Promise.allSettled(models.map(function(m){
    return streamColumn(m, msgs)
  }))

  if(histEnabled){
    const firstResp = results.find(function(r){return r.status==='fulfilled'&&r.value})
    const respText = firstResp && firstResp.status==='fulfilled' ? firstResp.value : ''
    history.push({role:'user', content:text})
    if(respText) history.push({role:'assistant', content:respText})
    try{ localStorage.setItem(LS_HIST_KEY, JSON.stringify(history)) }catch{}
    updateHistBadge()
  }

  if(models.length > 1){
    const responses = results
      .filter(function(r){return r.status==='fulfilled'&&r.value})
      .map(function(r){return r.status==='fulfilled'?r.value:''})
    if(responses.length >= 2) showConsensus(responses)
  }

  lastComparison = {
    userMessage: text,
    responses: models.map(function(m, i){
      const r = results[i]
      return { model: m, response: r.status==='fulfilled' ? r.value : '', latencyMs: 0 }
    })
  }

  document.getElementById('send-btn').disabled=false
  input.focus()
}

function toggleOptions(){
  const panel=document.getElementById('options-panel')
  const isOpen=panel.classList.toggle('open')
  document.querySelectorAll('[id="options-toggle"],[data-opts-toggle]').forEach(function(b){
    b.setAttribute('aria-expanded',isOpen?'true':'false')
  })
}

function updateHistBadge(){
  const badge = document.getElementById('hist-badge')
  if(!badge) return
  const turns = Math.floor(history.length / 2)
  badge.textContent = turns > 0 ? turns+' turn'+(turns!==1?'s':'') : ''
  badge.style.display = turns > 0 ? '' : 'none'
}

function tokenSet(text){
  const words = (text||'').toLowerCase().replace(/[^a-z0-9\\s]/g,' ').split(/\\s+/).filter(Boolean)
  return new Set(words)
}
function jaccard(a, b){
  if(!a.size && !b.size) return 1
  let inter = 0
  a.forEach(function(w){ if(b.has(w)) inter++ })
  return inter / (a.size + b.size - inter)
}
function showConsensus(responses){
  const bar = document.getElementById('consensus-bar')
  if(!bar) return
  const sets = responses.map(tokenSet)
  let total = 0, count = 0
  for(let i=0;i<sets.length;i++){
    for(let j=i+1;j<sets.length;j++){
      total += jaccard(sets[i], sets[j])
      count++
    }
  }
  const score = count > 0 ? total/count : 0
  const pct = Math.round(score * 100)
  const label = pct >= 75 ? 'High' : pct >= 45 ? 'Moderate' : 'Low'
  bar.innerHTML = '<span>Consensus:</span> <span class="consensus-score">'+pct+'% ('+label+')</span>'
                + '<span style="margin-left:auto;color:var(--muted)">'+(responses.length)+' of '+(models.length)+' models responded</span>'
  bar.style.display = ''
}

${modalJs}

function wireLabActions(){
  var forkBtn    = document.getElementById('lab-fork-btn')
  var metricsBtn = document.getElementById('lab-metrics-btn')
  var editBtn    = document.getElementById('lab-edit-btn')
  var exportBtn  = document.getElementById('lab-export-btn')
  var deleteBtn  = document.getElementById('lab-delete-btn')

  if(forkBtn) forkBtn.onclick = async function(){
    this.disabled=true;this.textContent='Forking…'
    try{
      var r=await fetch('/api/lab/'+LAB_ID+'/fork',{method:'POST'})
      var d=await r.json()
      if(!d.ok)throw new Error(d.error||'Fork failed')
      window.location.href=d.data.labUrl||'/lab/'+d.data.id
    }catch(e){alert('Fork failed: '+String(e));this.disabled=false;this.textContent='Fork'}
  }

  if(metricsBtn) metricsBtn.onclick = async function(){
    openModal('metrics-modal')
    var body=document.getElementById('metrics-body')
    body.innerHTML='<div style="color:var(--muted);font-size:12px">Loading…</div>'
    try{
      var r=await fetch('/api/sandbox/'+LAB_ID+'/metrics')
      var d=await r.json()
      if(!d.ok)throw new Error(d.error)
      var m=d.data
      body.innerHTML=[['Total Runs',m.totalRuns??0],['Tokens In',(m.totalTokensIn??0).toLocaleString()],['Tokens Out',(m.totalTokensOut??0).toLocaleString()],['Avg Latency',Math.round(m.avgLatencyMs??0)+' ms']]
        .map(function(row){return '<div class="stat-row"><span>'+row[0]+'</span><span class="stat-val">'+row[1]+'</span></div>'}).join('')
    }catch(e){body.innerHTML='<div style="color:var(--red);font-size:12px">Failed: '+esc(String(e))+'</div>'}
  }

  if(editBtn) editBtn.onclick = async function(){
    try{
      var r=await fetch('/api/sandbox/'+LAB_ID)
      var d=await r.json()
      if(d.ok){var a=d.data;document.getElementById('edit-name').value=a.name||'';document.getElementById('edit-desc').value=a.description||'';document.getElementById('edit-temp').value=String(a.temperature??0.7);document.getElementById('edit-maxtok').value=String(a.maxTokens??1024);document.getElementById('edit-prompt').value='';document.getElementById('edit-status').textContent='System prompt hidden for security.';document.getElementById('edit-status').style.color='var(--muted)'}
    }catch{}
    openModal('edit-modal')
  }

  var saveBtn=document.getElementById('edit-save-btn')
  if(saveBtn) saveBtn.onclick = async function(){
    var btn=this,status=document.getElementById('edit-status')
    btn.disabled=true;btn.textContent='Saving…'
    var patch={},name=document.getElementById('edit-name').value.trim(),desc=document.getElementById('edit-desc').value.trim(),temp=parseFloat(document.getElementById('edit-temp').value),maxtok=parseInt(document.getElementById('edit-maxtok').value),prompt=document.getElementById('edit-prompt').value.trim()
    if(name)patch.name=name;if(desc)patch.description=desc;if(!isNaN(temp))patch.temperature=temp;if(!isNaN(maxtok))patch.maxTokens=maxtok;if(prompt)patch.systemPrompt=prompt
    try{
      var r=await fetch('/api/sandbox/'+LAB_ID,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)})
      var d=await r.json()
      if(!d.ok)throw new Error(d.error||'Save failed')
      status.textContent='Saved.';status.style.color='var(--green)'
      if(name)document.getElementById('lab-name').textContent=name
      setTimeout(function(){closeModal('edit-modal')},800)
    }catch(e){status.textContent='Error: '+String(e);status.style.color='var(--red)'}
    finally{btn.disabled=false;btn.textContent='Save Changes'}
  }

  if(exportBtn) exportBtn.onclick = async function(){
    var btn=this;btn.disabled=true;btn.textContent='Exporting…'
    try{
      var r=await fetch('/api/lab/'+LAB_ID+'/export')
      var d=await r.json()
      if(!d.ok)throw new Error(d.error||'Export failed')
      var name=d.data.name||'lab'
      var blob=new Blob([JSON.stringify(d.data,null,2)],{type:'application/json'})
      var url=URL.createObjectURL(blob);var a=document.createElement('a')
      a.href=url;a.download=name.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json'
      document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url)
    }catch(e){alert('Export failed: '+String(e))}
    finally{btn.disabled=false;btn.textContent='Export'}
  }

  if(deleteBtn) deleteBtn.onclick = function(){ openModal('delete-modal') }

  var delConfirm=document.getElementById('delete-confirm-btn')
  if(delConfirm) delConfirm.onclick = async function(){
    var btn=this;btn.disabled=true;btn.textContent='Deleting…'
    try{
      var r=await fetch('/api/sandbox/'+LAB_ID,{method:'DELETE'})
      var d=await r.json()
      if(!d.ok)throw new Error(d.error||'Delete failed')
      window.location.href='/lab'
    }catch(e){alert('Delete failed: '+String(e));btn.disabled=false;btn.textContent='Yes, delete'}
  }
}

async function init(){
  try{
    const r=await fetch('/api/sandbox/'+LAB_ID)
    const d=await r.json()
    if(d.ok){
      const cfg=d.data
      document.title='Whisper — Lab: '+(cfg.name||'Lab')
      document.getElementById('lab-name').textContent=cfg.name||'Lab'
      document.getElementById('lab-type-badge').textContent=LAB_TYPE
      const t=typeof cfg.temperature==='number'?cfg.temperature:0.7
      temperature=t
      document.getElementById('opt-temp').value=String(Math.round(t*10))
      document.getElementById('opt-temp-val').textContent=t.toFixed(1)
      maxTokens=typeof cfg.maxTokens==='number'?cfg.maxTokens:1024
      document.getElementById('opt-maxtok').value=String(maxTokens)
      systemPrompt=cfg.systemPrompt||LAB_SYS
      document.getElementById('opt-sys').value=systemPrompt
    }
  }catch{}

  if(LAB_TYPE==='coding'||LAB_TYPE==='agent'){
    document.getElementById('user-input').classList.add('mono-input')
  }
  const typeBadge = document.getElementById('lab-type-badge')
  if(typeBadge){
    const TYPE_COLORS = {coding:'#6366f1',research:'#14b8a6',structured:'#f59e0b',creative:'#ec4899',agent:'#8b5cf6',debate:'#f97316',general:''}
    typeBadge.style.color = TYPE_COLORS[LAB_TYPE] || ''
    typeBadge.style.background = (TYPE_COLORS[LAB_TYPE]||'') ? TYPE_COLORS[LAB_TYPE]+'22' : ''
  }

  renderModelStrip()
  ensureColumns()
  histEnabled = false
  try{ history = JSON.parse(localStorage.getItem(LS_HIST_KEY)||'[]') }catch{}
  document.getElementById('user-input').focus()
}

document.getElementById('opt-temp').oninput=function(){
  temperature=parseFloat(this.value)/10
  document.getElementById('opt-temp-val').textContent=temperature.toFixed(1)
}
document.getElementById('opt-maxtok').oninput=function(){
  maxTokens=parseInt(this.value)||1024
}
document.getElementById('opt-sys').oninput=function(){
  systemPrompt=this.value
}
document.getElementById('opt-hist').onchange = function(){
  histEnabled = this.checked
  history = []
  try{ history = JSON.parse(localStorage.getItem(LS_HIST_KEY)||'[]') }catch{}
  updateHistBadge()
}
document.getElementById('clear-hist-btn').onclick = function(){
  history = []
  try{ localStorage.removeItem(LS_HIST_KEY) }catch{}
  updateHistBadge()
}
document.getElementById('export-compare-btn').onclick = function(){
  if(!lastComparison) return
  const line = JSON.stringify(lastComparison)
  const blob = new Blob([line+'\\n'], {type:'application/x-ndjson'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href=url; a.download='lab-comparison.jsonl'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
document.getElementById('send-btn').onclick=send
document.getElementById('user-input').onkeydown=function(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
}

init()
</script>
</body>
</html>`
}

export const labPage: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!id) return new Response('<h1>Not found</h1>', { status: 404 })

  const { value, metadata } = await env.SANDBOX_REGISTRY.getWithMetadata<{ name?: string; envType?: string; envModels?: string[]; fromLab?: boolean }>(`sandbox:${id}`)
  if (!value || !metadata?.fromLab) {
    const nonce = genNonce()
    return new Response('<h1>Lab not found</h1>', { status: 404, headers: htmlHeaders(nonce) })
  }

  let envType      = metadata.envType ?? 'general'
  let envModels    = metadata.envModels ?? []
  let systemPrompt = ''
  let ragEnabled   = false

  try {
    const res = await doFetch(stub(env, id), 'config', 'GET')
    const cfg = await res.json() as { ok: boolean; data: { systemPrompt?: string; envType?: string; envModels?: string[]; model?: string; ragEnabled?: boolean } }
    if (cfg.ok) {
      systemPrompt = cfg.data.systemPrompt ?? ''
      envType      = cfg.data.envType      ?? envType
      envModels    = cfg.data.envModels    ?? (cfg.data.model ? [cfg.data.model] : envModels)
      ragEnabled   = cfg.data.ragEnabled   === true
    }
  } catch { /* use metadata values */ }

  const nonce = genNonce()
  return new Response(labPageHtml(id, envType, envModels, systemPrompt, ragEnabled, nonce), { headers: htmlHeaders(nonce, true) })
}
