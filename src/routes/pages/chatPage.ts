import type { Handler } from '../../lib/http'
import { genNonce, htmlHeaders, sharedCss } from './shared'

// ── Chat page (root) ──────────────────────────────────────────────────────────

export function chatPageHtml(nonce: string): string { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Whisper — Chat</title>
${sharedCss()}
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.layout{display:flex;flex:1;overflow:hidden}
.sidebar{width:240px;display:flex;flex-direction:column;border-right:1px solid var(--border);overflow:hidden;flex-shrink:0}
.sidebar-top{padding:12px}
.new-thread-btn{width:100%;padding:8px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer;transition:background .15s}
.new-thread-btn:hover{background:#4f46e5}
.thread-list{flex:1;overflow-y:auto;padding:4px 8px}
.thread-item{padding:8px 10px;border-radius:6px;font-size:12px;cursor:pointer;color:var(--muted);transition:background .1s,color .1s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:1px 0;user-select:none}
.thread-item:hover{background:var(--surface);color:var(--text)}
.thread-item.active{background:#6366f122;color:var(--accent2)}
.config-section{padding:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px}
.cfg-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.cfg-select{width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:11px;outline:none;cursor:pointer}
.cfg-select:focus{border-color:var(--accent)}
.slider-row{display:flex;align-items:center;gap:8px}
.cfg-slider{flex:1;accent-color:var(--accent)}
.cfg-val{font-size:11px;color:var(--muted);font-family:var(--mono);width:28px;text-align:right}
.cfg-textarea{width:100%;resize:none;padding:6px 8px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:11px;font-family:inherit;outline:none;line-height:1.5}
.cfg-textarea:focus{border-color:var(--accent)}
.save-btn{width:100%;padding:7px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--text);font-size:11px;cursor:pointer;transition:all .15s;opacity:.7}
.save-btn:hover{border-color:var(--accent2);color:var(--accent2);opacity:1}
.chat-main{flex:1;display:flex;flex-direction:column;overflow:hidden}
#messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:80%;padding:10px 14px;border-radius:var(--radius);font-size:13.5px;line-height:1.55;animation:msgIn .15s ease-out both}
.msg.user{align-self:flex-end;background:#6366f128;border:1px solid #6366f144}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border)}
.msg.system{align-self:center;color:var(--muted);font-size:12px;font-style:italic}
.msg.error{align-self:center;color:#f87171;font-size:12px}
.msg.assistant code{background:#ffffff10;padding:2px 5px;border-radius:4px;font-family:var(--mono);font-size:.88em}
.msg.assistant pre{background:#ffffff0d;padding:10px 12px;border-radius:6px;overflow-x:auto;margin:6px 0}
.msg.assistant pre code{background:none;padding:0}
.msg.assistant h1{font-size:1.1em;font-weight:700;margin:10px 0 4px}
.msg.assistant h2{font-size:1.05em;font-weight:600;margin:8px 0 3px}
.msg.assistant h3{font-size:1em;font-weight:600;margin:6px 0 3px}
.msg.assistant ul,.msg.assistant ol{padding-left:20px;margin:4px 0}
.msg.assistant li{margin:2px 0}
.msg.assistant blockquote{border-left:3px solid var(--border);padding-left:10px;color:var(--muted);margin:4px 0}
.msg.assistant p{margin:4px 0}
.msg.assistant a{color:var(--accent2);text-decoration:underline;text-underline-offset:2px}
.chat-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--muted);text-align:center;padding:40px}
.chat-empty .ce-icon{font-size:28px;opacity:.3}
.chat-empty h3{font-size:15px;font-weight:600;color:var(--text);opacity:.55;margin:0}
.chat-empty p{font-size:12px;line-height:1.6;max-width:300px;margin:0}
.thread-empty{font-size:11px;color:var(--muted);padding:16px 12px;text-align:center;opacity:.6}
.typing{opacity:.5}
.input-row{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--border);flex-shrink:0}
.input-row textarea{flex:1;resize:none;padding:8px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.input-row textarea:focus{border-color:var(--accent)}
.input-row button{padding:10px 18px;min-height:40px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
.input-row button:hover:not(:disabled){background:#4f46e5}
.input-row button:disabled{opacity:.45;cursor:not-allowed}
.menu-btn{display:none;background:none;border:none;color:var(--text);font-size:20px;cursor:pointer;padding:2px 8px;line-height:1}
#sidebar-backdrop{display:none;position:fixed;inset:0;top:48px;background:#00000055;z-index:19}
@media(max-width:768px){
  .menu-btn{display:flex;align-items:center;align-self:center}
  .sidebar{position:fixed;left:0;top:48px;bottom:0;z-index:20;transform:translateX(-100%);transition:transform .2s ease;background:var(--bg);box-shadow:4px 0 24px #00000044}
  .sidebar.open{transform:translateX(0)}
  #sidebar-backdrop.open{display:block}
}
.guard-seg{display:flex;background:var(--bg);border:1px solid var(--border);border-radius:calc(var(--radius)+2px);padding:2px;gap:2px}
.guard-btn{flex:1;padding:4px;border-radius:var(--radius);border:none;background:none;color:var(--muted);font-size:11px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s,color .15s;text-align:center}
.guard-btn.g-strict{background:var(--accent);color:#fff}
.guard-btn.g-audit{background:#f59e0b22;color:#f59e0b}
.guard-btn.g-off{background:#f8717122;color:#f87171}
.kb-section{border-top:1px solid var(--border)}
.kb-section.kb-collapsed .kb-body{display:none}
.kb-section.kb-collapsed .kb-arrow{transform:rotate(-90deg)}
.kb-head{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;cursor:pointer;user-select:none}
.kb-head>span:first-child{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.kb-arrow{font-size:9px;color:var(--muted);transition:transform .15s;flex-shrink:0}
.kb-body{padding:0 12px 10px;display:flex;flex-direction:column;gap:7px}
.kb-drop{border:1px dashed var(--border);border-radius:var(--radius);padding:9px;text-align:center;font-size:11px;color:var(--muted);cursor:pointer;transition:border-color .15s,color .15s}
.kb-drop:hover,.kb-drop.drag-over{border-color:var(--accent2);color:var(--accent2)}
.doc-list{display:flex;flex-direction:column;gap:3px;max-height:88px;overflow-y:auto}
.doc-item{display:flex;align-items:center;gap:5px;padding:3px 6px;background:var(--surface);border-radius:4px}
.doc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text)}
.doc-st{font-size:11px;padding:1px 5px;border-radius:99px;flex-shrink:0}
.doc-st.processing{background:#f59e0b22;color:#f59e0b}
.doc-st.indexed{background:#34d39922;color:#34d399}
.doc-st.error,.doc-st.blocked{background:#f8717122;color:#f87171}
.doc-del{background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;padding:0 1px;flex-shrink:0}
.doc-del:hover{color:#f87171}
.rag-row{display:flex;align-items:center;justify-content:space-between}
.rag-lbl{font-size:11px;color:var(--muted)}
.rag-sw{position:relative;display:inline-block;width:32px;height:18px;flex-shrink:0}
.rag-sw input{opacity:0;width:0;height:0;position:absolute}
.rag-track{position:absolute;inset:0;background:var(--border);border-radius:99px;transition:background .15s;cursor:pointer}
.rag-sw input:checked+.rag-track{background:var(--accent)}
.rag-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;border-radius:99px;transition:transform .15s;pointer-events:none}
.rag-sw input:checked+.rag-track .rag-thumb{transform:translateX(14px)}
.ctx-menu{position:fixed;z-index:200;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:4px;min-width:144px;display:none;box-shadow:0 4px 24px #00000077}
.ctx-menu.open{display:block}
.ctx-item{padding:6px 12px;font-size:12px;color:var(--text);cursor:pointer;border-radius:4px;white-space:nowrap}
.ctx-item:hover{background:#6366f122;color:var(--accent2)}
.ctx-item.danger{color:var(--muted)}
.ctx-item.danger:hover{background:#f8717122;color:#f87171}
</style>
</head>
<body>
<nav class="topnav" role="navigation" aria-label="Main">
  <a href="/" class="brand"><span class="brand-mark" aria-hidden="true">✦</span>Whisper</a>
  <button id="sidebar-toggle" class="menu-btn" aria-label="Open sidebar" aria-expanded="false">☰</button>
  <a href="/" class="navlink active" aria-current="page">Chat</a>
  <a href="/vibe.html" class="navlink">Vibe</a>
  <a href="/apps" class="navlink">Apps</a>
  <a href="/environments" class="navlink">Environments</a>
  <a href="/tools.html" class="navlink">Tools</a>
  <a href="/dashboard" class="navlink">Dashboard</a>
  <a id="nav-whisper-this" href="/tools.html" class="navlink" style="margin-left:auto;color:var(--accent2)">Whisper this →</a>
</nav>
<div id="sidebar-backdrop" aria-hidden="true"></div>
<div class="layout">
  <aside class="sidebar" aria-label="Sidebar">
    <div class="sidebar-top">
      <button class="new-thread-btn" id="new-thread-btn">+ New Thread</button>
    </div>
    <div id="thread-list" class="thread-list" role="list" aria-label="Threads"></div>
    <div class="kb-section kb-collapsed" id="kb-section">
      <div class="kb-head" id="kb-head" role="button" tabindex="0" aria-expanded="false" aria-label="Knowledge Base">
        <span>Knowledge Base</span>
        <button id="kb-reindex-btn" style="font-size:10px;padding:2px 6px;border-radius:4px;background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;line-height:1.4" aria-label="Reindex documents">↺</button>
        <span class="kb-arrow">▾</span>
      </div>
      <div class="kb-body">
        <div class="kb-drop" id="kb-drop" role="button" tabindex="0" aria-label="Drop file or click to upload document">Drop or click to upload</div>
        <input type="file" id="kb-file" accept=".txt,.md,.csv,.html,.json,.pdf" style="display:none" aria-hidden="true"/>
        <div id="doc-list" class="doc-list" role="list" aria-label="Documents"></div>
        <div class="rag-row">
          <span class="rag-lbl">Use in chat</span>
          <label class="rag-sw" aria-label="Enable knowledge retrieval">
            <input type="checkbox" id="rag-toggle" role="switch"/>
            <span class="rag-track"><span class="rag-thumb"></span></span>
          </label>
        </div>
      </div>
    </div>
    <div class="config-section">
      <span class="cfg-label">Model</span>
      <select id="model-select" class="cfg-select" aria-label="AI model">
        <option value="@cf/meta/llama-3.1-8b-instruct">Llama 3.1 8B</option>
        <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B</option>
        <option value="@cf/google/gemma-3-12b-it">Gemma 3 12B</option>
        <option value="@cf/mistral/mistral-7b-instruct-v0.1">Mistral 7B</option>
        <option value="openai:gpt-4o-mini">GPT-4o mini</option>
        <option value="openai:gpt-4o">GPT-4o</option>
        <option value="anthropic:claude-haiku-4-5-20251001">Claude Haiku</option>
        <option value="anthropic:claude-sonnet-4-6">Claude Sonnet</option>
      </select>
      <span class="cfg-label">Temperature</span>
      <div class="slider-row">
        <input type="range" id="temp-slider" class="cfg-slider" min="0" max="20" value="7" step="1" aria-label="Temperature (0–2)"/>
        <span id="temp-val" class="cfg-val">0.7</span>
      </div>
      <span class="cfg-label">System Prompt</span>
      <textarea id="sys-prompt" class="cfg-textarea" rows="3" placeholder="Optional system prompt…" aria-label="System prompt"></textarea>
      <button id="save-btn" class="save-btn">Save config</button>
      <span id="integrity-badge" style="font-size:10px;display:none;text-align:center"></span>
      <span class="cfg-label">Guard Mode</span>
      <div class="guard-seg" role="group" aria-label="Guard mode">
        <button id="guard-strict-btn" class="guard-btn" aria-pressed="true">Strict</button>
        <button id="guard-audit-btn" class="guard-btn" aria-pressed="false">Audit</button>
        <button id="guard-off-btn" class="guard-btn" aria-pressed="false">Off</button>
      </div>
      <button id="delete-sandbox-btn" style="width:100%;padding:7px;border-radius:var(--radius);background:none;border:1px solid #f8717144;color:#f87171;font-size:11px;cursor:pointer;margin-top:4px;transition:all .15s" aria-label="Delete sandbox">Delete sandbox</button>
    </div>
  </aside>
  <div class="chat-main">
    <div id="messages" role="log" aria-live="polite" aria-label="Conversation">
      <div class="chat-empty" id="empty-chat">
        <div class="ce-icon">✦</div>
        <h3>Whisper Chat</h3>
        <p>Ask anything. Adjust model and temperature in the sidebar, then press Enter.</p>
      </div>
    </div>
    <div class="input-row">
      <textarea id="user-input" placeholder="Type a message… (Enter to send, Shift+Enter for new line)" rows="2" aria-label="Message input"></textarea>
      <button id="send-btn">Send</button>
    </div>
  </div>
</div>
<div id="ctx-menu" class="ctx-menu" role="menu" aria-label="Thread actions">
  <div id="ctx-rename" class="ctx-item" role="menuitem" tabindex="-1">Rename</div>
  <div id="ctx-export" class="ctx-item" role="menuitem" tabindex="-1">Export JSON</div>
  <div id="ctx-delete" class="ctx-item danger" role="menuitem" tabindex="-1">Delete</div>
</div>
<script type="module" nonce="${nonce}" src="/md.js"></script>
<script nonce="${nonce}">
function _esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
// Markdown rendering is provided by /md.js as window.renderMd (mirrors src/lib/markdown.ts).

const LS_SID='whisper:sandboxId'
const LS_SESS='whisper:sessions'
const LS_ACTIVE='whisper:activeSession'
const LS_TOKENS='whisper:tokens'
let sandboxId=localStorage.getItem(LS_SID)
function updateWhisperLink(){const el=document.getElementById('nav-whisper-this');if(el&&sandboxId)el.href='/tools.html?sandbox='+encodeURIComponent(sandboxId)}
updateWhisperLink()
let sessions=JSON.parse(localStorage.getItem(LS_SESS)||'[]')
let activeSession=localStorage.getItem(LS_ACTIVE)||'default'
let sessionTokens=JSON.parse(localStorage.getItem(LS_TOKENS)||'{}')
let guardMode='strict'
let docs=[]
let ctxSession=null
let ctxTarget=null

function addMsg(role,text){
  const ce=document.getElementById('empty-chat');if(ce)ce.remove()
  const el=document.createElement('div')
  el.className='msg '+role
  if(role==='assistant'){el.innerHTML=window.renderMd(text)}else{el.textContent=text}
  document.getElementById('messages').appendChild(el)
  scroll()
  return el
}

function scroll(){const m=document.getElementById('messages');m.scrollTop=m.scrollHeight}

function renderThreadList(){
  const list=document.getElementById('thread-list')
  list.innerHTML=''
  if(!sessions.length){list.innerHTML='<div class="thread-empty">No threads yet</div>';return}
  sessions.forEach(function(s){
    const div=document.createElement('div')
    div.className='thread-item'+(s.id===activeSession?' active':'')
    div.setAttribute('role','listitem')
    div.setAttribute('tabindex','0')
    div.textContent=s.name
    div.onclick=function(){if(div.contentEditable!=='true')switchSession(s.id)}
    div.ondblclick=function(e){e.preventDefault();startRename(div,s)}
    div.oncontextmenu=function(e){openCtxMenu(e,s,div)}
    div.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();switchSession(s.id)}}
    list.appendChild(div)
  })
}

async function switchSession(id){
  activeSession=id
  localStorage.setItem(LS_ACTIVE,activeSession)
  document.getElementById('messages').innerHTML=''
  renderThreadList()
  await loadHistory()
}

async function issueSessionToken(sessId){
  if(!sandboxId)return
  try{
    const r=await fetch('/api/sandbox/'+sandboxId+'/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:sessId})})
    const d=await r.json()
    if(d.ok&&d.data.token){sessionTokens[sessId]=d.data.token;localStorage.setItem(LS_TOKENS,JSON.stringify(sessionTokens))}
  }catch{}
}

// Build request headers carrying the current session token (header, never URL).
function sessHeaders(base){
  const h=Object.assign({},base||{})
  const tok=sessionTokens[activeSession]
  if(tok)h['X-Session-Token']=tok
  return h
}

async function newThread(){
  const id='sess-'+Date.now()
  const name='Thread '+(sessions.length+1)
  sessions.push({id,name,createdAt:Date.now()})
  localStorage.setItem(LS_SESS,JSON.stringify(sessions))
  activeSession=id
  localStorage.setItem(LS_ACTIVE,activeSession)
  document.getElementById('messages').innerHTML=''
  renderThreadList()
  await issueSessionToken(id)
}

async function loadHistory(){
  if(!sandboxId)return
  try{
    const histUrl='/api/sandbox/'+sandboxId+'/history?sessionId='+encodeURIComponent(activeSession)
    let r=await fetch(histUrl,{headers:sessHeaders()})
    if(r.status===401){await issueSessionToken(activeSession);r=await fetch(histUrl,{headers:sessHeaders()})}
    const d=await r.json()
    if(!d.ok)return
    const msgs=document.getElementById('messages')
    msgs.innerHTML=''
    for(const m of(d.data.messages||[])){
      if(m.role!=='user'&&m.role!=='assistant')continue
      const el=document.createElement('div')
      el.className='msg '+m.role
      const content=typeof m.content==='string'?m.content:''
      if(m.role==='assistant'){el.innerHTML=window.renderMd(content)}else{el.textContent=content}
      msgs.appendChild(el)
    }
    scroll()
  }catch{}
}

async function saveConfig(){
  if(!sandboxId)return
  const model=document.getElementById('model-select').value
  const temperature=parseFloat(document.getElementById('temp-slider').value)/10
  const systemPrompt=document.getElementById('sys-prompt').value
  try{
    await fetch('/api/sandbox/'+sandboxId,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model,temperature,systemPrompt})
    })
    const btn=document.getElementById('save-btn')
    btn.textContent='Saved!'
    setTimeout(function(){btn.textContent='Save config'},1500)
  }catch{}
}

async function send(){
  const input=document.getElementById('user-input')
  const text=input.value.trim()
  if(!text||!sandboxId)return
  input.value=''
  document.getElementById('send-btn').disabled=true
  addMsg('user',text)
  const el=addMsg('assistant','')
  el.classList.add('typing')
  try{
    const streamUrl='/api/sandbox/'+sandboxId+'/stream'
    const doStream=function(){return fetch(streamUrl,{method:'POST',headers:sessHeaders({'Content-Type':'application/json'}),body:JSON.stringify({message:text,sessionId:activeSession})})}
    let res=await doStream()
    if(res.status===401){await issueSessionToken(activeSession);res=await doStream()}
    const reader=res.body.getReader()
    const dec=new TextDecoder()
    let buf=''
    while(true){
      const{done,value}=await reader.read()
      if(done)break
      buf+=dec.decode(value,{stream:true})
      const parts=buf.split('\\n\\n')
      buf=parts.pop()??''
      for(const part of parts){
        for(const line of part.split('\\n')){
          if(!line.startsWith('data:'))continue
          const raw=line.slice(5).trim()
          if(raw==='[DONE]')continue
          try{
            const ev=JSON.parse(raw)
            if(ev.done)continue
            if(ev.error){el.textContent+='[Error: '+ev.error+']';break}
            if(typeof ev.response==='string'){
              el._buf=(el._buf||'')+ev.response
              el.innerHTML=window.renderMd(el._buf)
              el.classList.remove('typing')
              scroll()
            }
          }catch{}
        }
      }
    }
    if(!el.innerHTML)el.textContent='(no response)'
  }catch(e){
    el.textContent='Error: '+e
    el.className='msg error'
  }finally{
    document.getElementById('send-btn').disabled=false
    input.focus()
  }
}

async function init(){
  if(!sandboxId){
    try{
      const r=await fetch('/api/sandbox',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:'Chat',description:'',model:'@cf/meta/llama-3.1-8b-instruct',temperature:0.7})
      })
      const d=await r.json()
      if(d.ok){sandboxId=d.data.id;localStorage.setItem(LS_SID,sandboxId);updateWhisperLink()}
    }catch{}
  }
  if(sandboxId&&!sessionTokens[activeSession]){
    await issueSessionToken(activeSession)
  }
  if(sandboxId){
    try{
      const r=await fetch('/api/sandbox/'+sandboxId)
      const d=await r.json()
      if(d.ok){
        const cfg=d.data
        const sel=document.getElementById('model-select')
        if([...sel.options].some(function(o){return o.value===cfg.model}))sel.value=cfg.model
        const temp=typeof cfg.temperature==='number'?cfg.temperature:0.7
        const sl=document.getElementById('temp-slider')
        sl.value=String(Math.round(temp*10))
        document.getElementById('temp-val').textContent=(parseFloat(sl.value)/10).toFixed(1)
        document.getElementById('sys-prompt').value=cfg.systemPrompt||''
        initGuardMode(cfg.guardMode||'strict')
        document.getElementById('rag-toggle').checked=!!(cfg.ragEnabled)
        loadDocs()
        const ib=document.getElementById('integrity-badge');if(ib){ib.style.display='';ib.textContent=cfg.tampered?'⚠ Tampered':'✓ Verified';ib.style.color=cfg.tampered?'#f59e0b':'#34d399'}
      }
    }catch{}
  }
  if(!sessions.length){
    sessions=[{id:'default',name:'Thread 1',createdAt:Date.now()}]
    localStorage.setItem(LS_SESS,JSON.stringify(sessions))
    activeSession='default'
    localStorage.setItem(LS_ACTIVE,activeSession)
  }
  renderThreadList()
  await loadHistory()
  document.getElementById('user-input').focus()
}

// ── Guard mode ────────────────────────────────────────────────────────────────
function initGuardMode(mode){
  guardMode=mode||'strict'
  updateGuardUI()
}
function updateGuardUI(){
  const pairs=[['guard-strict-btn','g-strict'],['guard-audit-btn','g-audit'],['guard-off-btn','g-off']]
  const modes=['strict','audit','off']
  pairs.forEach(function(pair,i){
    const btn=document.getElementById(pair[0])
    btn.className='guard-btn'
    btn.setAttribute('aria-pressed',modes[i]===guardMode?'true':'false')
    if(modes[i]===guardMode)btn.classList.add(pair[1])
  })
}
async function setGuardMode(mode){
  guardMode=mode
  updateGuardUI()
  if(!sandboxId)return
  try{await fetch('/api/sandbox/'+sandboxId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({guardMode:mode})})}catch{}
}

// ── Knowledge base ────────────────────────────────────────────────────────────
async function loadDocs(){
  if(!sandboxId)return
  try{
    const r=await fetch('/api/sandbox/'+sandboxId+'/documents')
    const d=await r.json()
    if(d.ok){docs=d.data.docs||[];renderDocList()}
  }catch{}
}
function renderDocList(){
  const list=document.getElementById('doc-list')
  if(!docs.length){list.innerHTML='<div style="font-size:10px;color:var(--muted);text-align:center;padding:3px 0">No documents</div>';return}
  list.innerHTML=''
  docs.forEach(function(doc){
    const item=document.createElement('div')
    item.className='doc-item'
    item.setAttribute('role','listitem')
    const name=doc.name||'Document'
    const st=doc.status||'processing'
    item.innerHTML='<span class="doc-name">'+_esc(name)+'</span><span class="doc-st '+_esc(st)+'">'+_esc(st)+'</span><button class="doc-del" aria-label="Remove '+_esc(name)+'">×</button>'
    item.querySelector('.doc-del').onclick=function(e){e.stopPropagation();deleteDoc(doc.id)}
    list.appendChild(item)
  })
}
async function deleteDoc(docId){
  if(!sandboxId)return
  try{
    await fetch('/api/sandbox/'+sandboxId+'/documents/'+docId,{method:'DELETE'})
    docs=docs.filter(function(d){return d.id!==docId})
    renderDocList()
  }catch{}
}
async function uploadDoc(file){
  if(!sandboxId||!file)return
  const kbSec=document.getElementById('kb-section')
  if(kbSec.classList.contains('kb-collapsed'))toggleKb()
  const fd=new FormData()
  fd.append('file',file)
  const tempId='_tmp_'+Date.now()
  docs.push({id:tempId,name:file.name,status:'processing'})
  renderDocList()
  try{
    const r=await fetch('/api/sandbox/'+sandboxId+'/documents',{method:'POST',body:fd})
    const d=await r.json()
    docs=docs.filter(function(x){return x.id!==tempId})
    if(d.ok&&d.data)docs.push({id:d.data.docId,name:d.data.name,status:d.data.status||'processing'})
    renderDocList()
  }catch{docs=docs.filter(function(x){return x.id!==tempId});renderDocList()}
}
async function setRag(val){
  if(!sandboxId)return
  try{await fetch('/api/sandbox/'+sandboxId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ragEnabled:val})})}catch{}
}
function toggleKb(){
  const sec=document.getElementById('kb-section')
  const head=document.getElementById('kb-head')
  const isCollapsed=sec.classList.toggle('kb-collapsed')
  head.setAttribute('aria-expanded',isCollapsed?'false':'true')
}

// ── Thread rename & context menu ──────────────────────────────────────────────
function startRename(div,s){
  div.contentEditable='true'
  div.focus()
  const range=document.createRange()
  range.selectNodeContents(div)
  const sel=window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  div.onblur=function(){
    div.contentEditable='false'
    const newName=div.textContent.trim()||s.name
    div.textContent=newName
    s.name=newName
    localStorage.setItem(LS_SESS,JSON.stringify(sessions))
    div.onblur=null
    div.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();switchSession(s.id)}}
  }
  div.onkeydown=function(e){
    if(e.key==='Enter'){e.preventDefault();div.blur()}
    else if(e.key==='Escape'){div.textContent=s.name;div.onblur=null;div.contentEditable='false';div.onkeydown=function(e2){if(e2.key==='Enter'||e2.key===' '){e2.preventDefault();switchSession(s.id)}}}
  }
}
function openCtxMenu(e,s,div){
  e.preventDefault()
  ctxSession=s
  ctxTarget=div
  const menu=document.getElementById('ctx-menu')
  menu.classList.add('open')
  const x=Math.min(e.clientX,window.innerWidth-160)
  const y=Math.min(e.clientY,window.innerHeight-120)
  menu.style.left=x+'px'
  menu.style.top=y+'px'
  document.getElementById('ctx-rename').focus()
}
function closeCtxMenu(){
  const s=ctxSession
  ctxSession=null
  ctxTarget=null
  document.getElementById('ctx-menu').classList.remove('open')
  return s
}

document.getElementById('temp-slider').oninput=function(){
  document.getElementById('temp-val').textContent=(this.value/10).toFixed(1)
}
document.getElementById('send-btn').onclick=send
document.getElementById('new-thread-btn').onclick=newThread
document.getElementById('save-btn').onclick=saveConfig
document.getElementById('guard-strict-btn').onclick=function(){setGuardMode('strict')}
document.getElementById('guard-audit-btn').onclick=function(){setGuardMode('audit')}
document.getElementById('guard-off-btn').onclick=function(){setGuardMode('off')}
document.getElementById('kb-head').onclick=toggleKb
document.getElementById('kb-head').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleKb()}}
document.getElementById('kb-drop').onclick=function(){document.getElementById('kb-file').click()}
document.getElementById('kb-drop').onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();document.getElementById('kb-file').click()}}
document.getElementById('kb-drop').addEventListener('dragover',function(e){e.preventDefault();this.classList.add('drag-over')})
document.getElementById('kb-drop').addEventListener('dragleave',function(){this.classList.remove('drag-over')})
document.getElementById('kb-drop').addEventListener('drop',function(e){e.preventDefault();this.classList.remove('drag-over');const f=e.dataTransfer.files[0];if(f)uploadDoc(f)})
document.getElementById('kb-file').onchange=function(){if(this.files[0])uploadDoc(this.files[0]);this.value=''}
document.getElementById('rag-toggle').onchange=function(){setRag(this.checked)}
document.getElementById('ctx-rename').onclick=function(){const s=ctxSession,div=ctxTarget;closeCtxMenu();if(s&&div)startRename(div,s)}
document.getElementById('ctx-export').onclick=async function(){
  const s=closeCtxMenu()
  if(!s||!sandboxId)return
  try{
    const r=await fetch('/api/sandbox/'+sandboxId+'/export-session?sessionId='+encodeURIComponent(s.id))
    const d=await r.json()
    if(!d.ok)return
    const blob=new Blob([JSON.stringify(d.data,null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a')
    a.href=url
    a.download=(s.name||'thread').replace(/[^a-zA-Z0-9_-]/g,'_')+'.json'
    document.body.appendChild(a);a.click();document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }catch{}
}
document.getElementById('ctx-delete').onclick=function(){
  const s=closeCtxMenu()
  if(!s)return
  sessions=sessions.filter(function(x){return x.id!==s.id})
  localStorage.setItem(LS_SESS,JSON.stringify(sessions))
  if(activeSession===s.id){
    activeSession=sessions.length?sessions[0].id:'default'
    localStorage.setItem(LS_ACTIVE,activeSession)
    document.getElementById('messages').innerHTML=''
    if(sessions.length)loadHistory()
  }
  renderThreadList()
}
document.addEventListener('click',function(e){if(!document.getElementById('ctx-menu').contains(e.target))closeCtxMenu()})
document.getElementById('sidebar-toggle').onclick=function(){
  const open=document.querySelector('.sidebar').classList.toggle('open')
  document.getElementById('sidebar-backdrop').classList.toggle('open',open)
  this.setAttribute('aria-expanded',String(open))
}
document.getElementById('sidebar-backdrop').onclick=function(){
  document.querySelector('.sidebar').classList.remove('open')
  this.classList.remove('open')
  document.getElementById('sidebar-toggle').setAttribute('aria-expanded','false')
}
document.getElementById('user-input').onkeydown=function(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
}
document.getElementById('kb-reindex-btn').onclick=async function(e){
  e.stopPropagation()
  if(!sandboxId)return
  const btn=this,prev=btn.textContent
  btn.textContent='Reindexing…'
  try{await fetch('/api/sandbox/'+sandboxId+'/documents/reindex',{method:'POST'});btn.textContent='Done'}catch{btn.textContent='Error'}
  setTimeout(function(){btn.textContent=prev},2000)
}
document.getElementById('delete-sandbox-btn').onclick=async function(){
  if(!sandboxId)return
  if(!confirm('Delete this sandbox and all its data?'))return
  try{
    await fetch('/api/sandbox/'+sandboxId,{method:'DELETE'})
    localStorage.removeItem(LS_SID);localStorage.removeItem(LS_SESS);localStorage.removeItem(LS_ACTIVE);localStorage.removeItem(LS_TOKENS)
    location.reload()
  }catch{}
}
init()
</script>
</body>
</html>` }

export const chat: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(chatPageHtml(nonce), { headers: htmlHeaders(nonce) }))
}
