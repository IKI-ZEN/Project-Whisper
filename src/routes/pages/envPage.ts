import type { Handler, Params } from '../../lib/http'
import { stub, doFetch } from '../../lib/do'
import { genNonce, htmlHeaders, sharedCss, navHtml, escJs, injectAppToken } from './shared'

// ── Environment workspace page (/env/:id) — agentic specialised workspace ─────

export function envPageHtml(
  id: string, name: string, description: string, systemPrompt: string, model: string, nonce: string,
): string {
  const safeId   = JSON.stringify(id).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\//g, '\\u002f')
  const safeName = JSON.stringify(name).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const safeDesc = JSON.stringify(description).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const safeModel = JSON.stringify(model).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
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
.env-header{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}
.env-badge{font-size:10px;padding:2px 8px;border-radius:99px;background:#6366f122;color:var(--accent2);font-family:var(--mono)}
.env-name{font-size:14px;font-weight:600;color:var(--text)}
.env-desc{font-size:11px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.env-model{font-size:10px;color:var(--muted);font-family:var(--mono);flex-shrink:0}
.chat-area{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:10px}
.msg{padding:10px 14px;border-radius:var(--radius);font-size:13px;line-height:1.6;animation:msgIn .15s ease-out both}
.msg.user{align-self:flex-end;background:#6366f128;border:1px solid #6366f144;max-width:80%}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border);max-width:90%}
.msg.system{align-self:center;color:var(--muted);font-size:11px;font-style:italic;background:none;border:none;padding:4px 0}
.msg.error{align-self:flex-start;color:var(--red);font-size:12px;background:none;border:none}
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
.input-area{border-top:1px solid var(--border);flex-shrink:0;background:var(--surface);padding:10px 18px;display:flex;gap:8px;align-items:flex-end}
.input-area textarea{flex:1;resize:none;padding:8px 10px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s;max-height:160px}
.input-area textarea:focus{border-color:var(--accent)}
.send-btn{padding:10px 18px;min-height:40px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s;flex-shrink:0}
.send-btn:hover:not(:disabled){background:#4f46e5}
.send-btn:disabled{opacity:.45;cursor:not-allowed}
</style>
</head>
<body>
${navHtml('environments')}
<div class="env-header">
  <span class="env-badge">ENV</span>
  <span class="env-name" id="env-name">Loading…</span>
  <span class="env-desc" id="env-desc"></span>
  <span class="env-model" id="env-model"></span>
</div>
<div class="chat-area" id="chat" role="log" aria-live="polite"></div>
<div class="input-area">
  <textarea id="user-input" placeholder="Message this environment…" rows="2" aria-label="Message input"></textarea>
  <button class="send-btn" id="send-btn">Send</button>
</div>

<script type="module" nonce="${nonce}" src="/md.js"></script>
<script nonce="${nonce}">
const ENV_ID    = ${safeId}
const ENV_NAME  = ${safeName}
const ENV_DESC  = ${safeDesc}
const ENV_MODEL = ${safeModel}

${escJs}

let sending = false

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

  sending = false
  document.getElementById('send-btn').disabled = false
  input.focus()
}

document.getElementById('send-btn').onclick = send
document.getElementById('user-input').onkeydown = function(e){
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send() }
}

async function init(){
  try{
    const r = await fetch('/api/sandbox/'+ENV_ID)
    const d = await r.json()
    if(d.ok){
      const cfg = d.data
      document.title = 'Whisper — '+(cfg.name||'Environment')
      document.getElementById('env-name').textContent = cfg.name || ENV_NAME
      document.getElementById('env-desc').textContent = cfg.description || ENV_DESC
      const m = cfg.model || ENV_MODEL
      document.getElementById('env-model').textContent = m ? m.split('/').pop() || m : ''
    }
  }catch{}
  document.getElementById('env-name').textContent = ENV_NAME
  document.getElementById('env-desc').textContent = ENV_DESC
  const m = ENV_MODEL
  document.getElementById('env-model').textContent = m ? m.split('/').pop() || m : ''
  document.getElementById('user-input').focus()
}

init()
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

  let name        = metadata.name        ?? 'Environment'
  let description = metadata.description ?? ''
  let model       = metadata.model       ?? ''

  try {
    const res = await doFetch(stub(env, id), 'config', 'GET')
    const cfg = await res.json() as { ok: boolean; data: { name?: string; description?: string; model?: string } }
    if (cfg.ok) {
      name        = cfg.data.name        ?? name
      description = cfg.data.description ?? description
      model       = cfg.data.model       ?? model
    }
  } catch { /* use metadata values */ }

  const nonce = genNonce()
  let html = envPageHtml(id, name, description, '', model, nonce)
  html = await injectAppToken(html, id, env)
  return new Response(html, { headers: htmlHeaders(nonce, true) })
}
