import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import type { SandboxConfig } from '../lib/schema'
import { json, err } from '../lib/http'
import { sandboxExists, stub, doFetch } from './sandbox'
import { issueAppToken } from '../lib/appToken'

// Injects the app token as a meta tag before </head> (fallback: before </body>)
async function injectAppToken(html: string, appId: string, env: Env): Promise<string> {
  if (!env.SIGNING_SECRET) return html
  const token = await issueAppToken(appId, env.SIGNING_SECRET)
  const tag = `<meta name="whisper-token" content="${token}">`
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`)
  return html
}

// ── Standalone app page ───────────────────────────────────────────────────────

function appPageHtml(sandboxId: string, nonce: string): string {
  const id = JSON.stringify(sandboxId)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\//g, '\\u002f')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Loading…</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#080c14;--surface:#0e1521;--border:#1c2a40;--muted:#4d6480;--text:#cdd9e5;--accent:#6366f1;--accent2:#818cf8;--teal:#14b8a6;--radius:6px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.topnav{display:flex;align-items:center;gap:4px;padding:0 16px;height:48px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
.brand{font-size:14px;font-weight:600;color:var(--accent2);text-decoration:none;letter-spacing:.02em;border-right:1px solid var(--border);padding-right:16px;margin-right:4px}
.navlink{font-size:12px;padding:5px 12px;border-radius:var(--radius);text-decoration:none;color:var(--muted);transition:color .15s,background .15s;white-space:nowrap}
.navlink:hover{color:var(--text)}
.navlink.active{background:var(--accent);color:#fff}
#app-name{font-size:13px;font-weight:600;color:var(--accent2);margin-left:auto}
#app-desc{display:none}
.badge{font-size:10px;padding:2px 8px;border-radius:99px;background:#6366f122;color:var(--accent2);font-family:var(--mono);flex-shrink:0}
.hbtn{font-size:12px;padding:8px 14px;min-height:36px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;flex-shrink:0;transition:all .15s}
.hbtn:hover{border-color:var(--accent2);color:var(--accent2)}
.hbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@keyframes msgIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
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
.typing{opacity:.5}
.input-row{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--border);flex-shrink:0}
.input-row textarea{flex:1;resize:none;padding:8px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.input-row textarea:focus{border-color:var(--accent)}
.input-row textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.input-row button{padding:10px 18px;min-height:40px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
.input-row button:hover:not(:disabled){background:#4f46e5}
.input-row button:disabled{opacity:.45;cursor:not-allowed}
.input-row button:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
@media(max-width:600px){#messages{padding:12px}.input-row{padding:8px 12px}.input-row textarea{font-size:16px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
.embed-panel{position:fixed;inset:0;background:#00000088;z-index:100;display:flex;align-items:center;justify-content:center;visibility:hidden;opacity:0;transition:opacity .2s,visibility .2s}
.embed-panel.open{visibility:visible;opacity:1}
.embed-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:480px;max-width:90vw;display:flex;flex-direction:column;gap:12px;transform:translateY(10px);transition:transform .2s}
.embed-panel.open .embed-box{transform:translateY(0)}
.embed-box h3{font-size:14px;color:var(--accent2)}
.embed-box textarea{width:100%;height:80px;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-family:var(--mono);font-size:12px;resize:none}
.embed-box .row{display:flex;gap:8px}
.embed-box button{flex:1;padding:8px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;cursor:pointer}
.embed-box button.outline{background:none;border:1px solid var(--border);color:var(--text)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
</style>
</head>
<body>
<nav class="topnav" role="navigation" aria-label="Main">
  <a href="/" class="brand">Whisper</a>
  <a href="/" class="navlink">Chat</a>
  <a href="/vibe.html" class="navlink">Vibe</a>
  <a href="/apps" class="navlink active" aria-current="page">Apps</a>
  <a href="/tools.html" class="navlink">Tools</a>
  <a href="/dashboard" class="navlink">Dashboard</a>
  <span id="app-name" style="margin-left:auto">Loading…</span>
  <span id="app-desc" style="display:none"></span>
  <span id="model-badge" class="badge" style="display:none"></span>
  <button class="hbtn" id="embed-btn" aria-haspopup="dialog">Embed ↗</button>
  <button class="hbtn" id="share-btn">Share config</button>
</nav>
<div id="messages" role="log" aria-live="polite" aria-label="Conversation messages">
  <div class="msg system" id="init-msg">Connecting…</div>
</div>
<div class="input-row">
  <textarea id="user-input" placeholder="Type a message… (Enter to send)" rows="2" disabled aria-label="Message input (Enter to send, Shift+Enter for new line)"></textarea>
  <button id="send-btn" disabled aria-label="Send message">Send</button>
</div>
<div id="embed-panel" class="embed-panel" role="presentation">
  <div class="embed-box" role="dialog" aria-modal="true" aria-labelledby="embed-title">
    <h3 id="embed-title">Embed this app</h3>
    <textarea id="embed-code" readonly aria-label="Embed code (read-only)"></textarea>
    <div class="row">
      <button id="embed-copy-btn">Copy code</button>
      <button class="outline" id="embed-close-btn">Close</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
function _esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function _il(s){
  s=s.replace(/\`([^\`]+)\`/g,(_,c)=>'<code>'+c+'</code>')
  s=s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
  s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
  s=s.replace(/\*([^*\n]+?)\*/g,'<em>$1</em>')
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,t,u)=>'<a href="'+u+'" rel="noopener noreferrer" target="_blank">'+t+'</a>')
  return s
}
function _renderMd(text){
  const lines=text.split('\\n'),out=[];let i=0
  while(i<lines.length){
    const raw=lines[i]
    if(raw.startsWith('\`\`\`')){const code=[];i++;while(i<lines.length&&!lines[i].startsWith('\`\`\`')){code.push(_esc(lines[i]));i++}i++;out.push('<pre><code>'+code.join('\\n')+'</code></pre>');continue}
    const hm=raw.match(/^(#{1,3})\s+(.+)/);if(hm){out.push('<h'+hm[1].length+'>'+_il(_esc(hm[2]))+'</h'+hm[1].length+'>');i++;continue}
    if(raw.startsWith('> ')){out.push('<blockquote>'+_il(_esc(raw.slice(2)))+'</blockquote>');i++;continue}
    if(raw.startsWith('- ')||raw.startsWith('* ')){const it=[];while(i<lines.length&&(lines[i].startsWith('- ')||lines[i].startsWith('* '))){it.push('<li>'+_il(_esc(lines[i].slice(2)))+'</li>');i++}out.push('<ul>'+it.join('')+'</ul>');continue}
    if(/^\d+\.\s/.test(raw)){const it=[];while(i<lines.length&&/^\d+\.\s/.test(lines[i])){const m=lines[i].match(/^\d+\.\s+(.+)/);it.push('<li>'+_il(_esc(m?.[1]||''))+'</li>');i++}out.push('<ol>'+it.join('')+'</ol>');continue}
    if(raw.trim()===''){out.push('');i++;continue}
    out.push('<p>'+_il(_esc(raw))+'</p>');i++
  }
  return out.join('\\n')
}
const SANDBOX_ID = ${id}
const API = ''

async function init() {
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID)
    const d = await r.json()
    if (!d.ok) { setMsg('error', d.error); return }
    const app = d.data
    document.title = app.name
    document.getElementById('app-name').textContent = app.name
    document.getElementById('app-desc').textContent = app.description || ''
    const badge = document.getElementById('model-badge')
    badge.textContent = app.model.split('/').pop()
    badge.style.display = ''
    document.getElementById('embed-code').value =
      '<iframe src="' + location.origin + '/app/' + SANDBOX_ID + '" width="420" height="640" frameborder="0" allow="microphone" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>'
    setMsg('system', 'Hi! I am ' + app.name + (app.description ? ' — ' + app.description : '') + '. How can I help?')
    document.getElementById('user-input').disabled = false
    document.getElementById('send-btn').disabled = false
    document.getElementById('user-input').focus()
  } catch(e) { setMsg('error', 'Failed to load app: ' + e) }
}

function setMsg(role, text) {
  const el = document.getElementById('init-msg')
  if (el) { el.className = 'msg ' + role; el.textContent = text }
}

function addMsg(role, text) {
  const el = document.createElement('div')
  el.className = 'msg ' + role
  el.textContent = text
  document.getElementById('messages').appendChild(el)
  scroll()
  return el
}

function scroll() {
  const m = document.getElementById('messages')
  m.scrollTop = m.scrollHeight
}

async function send() {
  const input = document.getElementById('user-input')
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  document.getElementById('send-btn').disabled = true
  addMsg('user', text)

  const el = addMsg('assistant', '')
  el.classList.add('typing')

  try {
    const res = await fetch(API + '/s/' + SANDBOX_ID + '/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\\n\\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        for (const line of part.split('\\n')) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (raw === '[DONE]') continue
          try {
            const ev = JSON.parse(raw)
            if (ev.done) continue
            if (ev.error) { el.textContent += ' [Error: ' + ev.error + ']'; break }
            if (typeof ev.response === 'string') {
              el._buf = (el._buf || '') + ev.response
              el.innerHTML = _renderMd(el._buf)
              el.classList.remove('typing')
              scroll()
            }
          } catch {}
        }
      }
    }
    if (!el.textContent) el.textContent = '(no response)'
  } catch(e) {
    el.textContent = 'Error: ' + e
    el.className = 'msg error'
  } finally {
    document.getElementById('send-btn').disabled = false
    input.focus()
  }
}

function openEmbed() {
  document.getElementById('embed-panel').classList.add('open')
  document.getElementById('embed-close-btn').focus()
}
function closeEmbed() {
  document.getElementById('embed-panel').classList.remove('open')
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEmbed() })

function copyEmbed() {
  const t = document.getElementById('embed-code').value
  navigator.clipboard?.writeText(t).catch(() => {})
  const btn = event.target
  btn.textContent = 'Copied!'
  setTimeout(() => { btn.textContent = 'Copy code' }, 1500)
}

async function shareConfig(btn) {
  const prev = btn.textContent
  try {
    const r = await fetch(API + '/api/sandbox/' + SANDBOX_ID + '/export')
    const d = await r.json()
    if (!d.ok) return
    await navigator.clipboard?.writeText(JSON.stringify(d.data, null, 2)).catch(() => {})
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = prev }, 1500)
  } catch {}
}

document.getElementById('send-btn').addEventListener('click', send)
document.getElementById('user-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
})
document.getElementById('embed-btn').addEventListener('click', openEmbed)
document.getElementById('share-btn').addEventListener('click', () => shareConfig(document.getElementById('share-btn')))
document.getElementById('embed-panel').addEventListener('click', e => { if (e.target === document.getElementById('embed-panel')) closeEmbed() })
document.getElementById('embed-copy-btn').addEventListener('click', copyEmbed)
document.getElementById('embed-close-btn').addEventListener('click', closeEmbed)

init()
</script>
</body>
</html>`
}

// ── Apps gallery page ─────────────────────────────────────────────────────────

function appsGalleryHtml(nonce: string): string { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Whisper — Apps</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#080c14;--surface:#0e1521;--border:#1c2a40;--muted:#4d6480;--text:#cdd9e5;--accent:#6366f1;--accent2:#818cf8;--teal:#14b8a6;--radius:6px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh}
.topnav{display:flex;align-items:center;gap:4px;padding:0 16px;height:48px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10;flex-shrink:0}
.brand{font-size:14px;font-weight:600;color:var(--accent2);text-decoration:none;letter-spacing:.02em;border-right:1px solid var(--border);padding-right:16px;margin-right:4px}
.navlink{font-size:12px;padding:5px 12px;border-radius:var(--radius);text-decoration:none;color:var(--muted);transition:color .15s,background .15s;white-space:nowrap}
.navlink:hover{color:var(--text)}
.navlink.active{background:var(--accent);color:#fff}
.newapp{margin-left:auto}
main{max-width:1100px;margin:0 auto;padding:32px 24px;min-height:calc(100dvh - 48px);display:flex;flex-direction:column}
h2{font-size:22px;font-weight:700;margin-bottom:6px}
.sub{color:var(--muted);font-size:13px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card-name{font-size:14px;font-weight:600}
.card-desc{font-size:12px;color:var(--muted);flex:1;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;align-items:center;gap:8px}
.badge{font-size:10px;padding:2px 7px;border-radius:99px;background:#1e2558;color:var(--accent2);font-family:var(--mono);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-date{font-size:10px;color:var(--muted)}
.open-btn{padding:8px 16px;min-height:36px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
.open-btn:hover{background:#4f46e5}
.open-btn:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px 20px;color:var(--muted)}
.empty h3{font-size:18px;margin-bottom:8px;color:var(--text)}
.empty-cta{display:inline-block;margin-top:16px;padding:10px 20px;background:var(--accent);color:#fff;border-radius:var(--radius);text-decoration:none;font-size:13px;font-weight:500}
.empty-cta:hover{background:#4f46e5}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.8}}
@keyframes cardIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.skeleton{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;animation:pulse 1.4s ease-in-out infinite}
.sk-line{height:12px;background:var(--border);border-radius:4px}
@media(max-width:480px){.card{padding:14px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
.from-vibe{font-size:10px;padding:1px 6px;border-radius:99px;background:#34d39922;color:#34d399}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
</style>
</head>
<body>
<nav class="topnav" role="navigation" aria-label="Main">
  <a href="/" class="brand">Whisper</a>
  <a href="/" class="navlink">Chat</a>
  <a href="/vibe.html" class="navlink">Vibe</a>
  <a href="/apps" class="navlink active" aria-current="page">Apps</a>
  <a href="/tools.html" class="navlink">Tools</a>
  <a href="/dashboard" class="navlink">Dashboard</a>
  <a href="/vibe.html" class="navlink newapp">+ New App</a>
</nav>
<main>
  <h2>Your Apps</h2>
  <p class="sub">AI-powered apps built with Vibe or the API. Click any card to open the app.</p>
  <div id="grid" class="grid" role="list"></div>
</main>
<script nonce="${nonce}">
async function load() {
  const grid = document.getElementById('grid')
  grid.innerHTML = [1,2,3].map(() => \`<div class="skeleton" role="listitem" aria-hidden="true"><div class="sk-line" style="width:60%"></div><div class="sk-line" style="width:90%"></div><div class="sk-line" style="width:40%"></div></div>\`).join('')
  try {
    const r = await fetch('/api/sandbox')
    const d = await r.json()
    if (!d.ok || !d.data.apps.length) {
      grid.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center'
      grid.innerHTML = '<div class="empty"><h3>No apps yet</h3><p>Build your first AI app with Vibe.</p><a href="/vibe.html" class="empty-cta">Open Vibe →</a></div>'
      return
    }
    grid.innerHTML = ''
    d.data.apps.forEach((app, i) => {
      const date = new Date(app.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      const modelShort = (app.model || '').split('/').pop() || app.model
      const delay = Math.min(i, 10) * 50
      grid.insertAdjacentHTML('beforeend', \`
        <div class="card" role="listitem" style="animation:cardIn .2s ease-out both;animation-delay:\${delay}ms">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="card-name">\${esc(app.name)}</span>
            \${app.fromVibe ? '<span class="from-vibe">vibe</span>' : ''}
          </div>
          <p class="card-desc">\${esc(app.description || 'No description')}</p>
          <div class="card-foot">
            <span class="badge" title="\${esc(app.model)}">\${esc(modelShort)}</span>
            <span class="card-date">\${date}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <a href="/app/\${esc(app.id)}" class="open-btn">Open App <span aria-hidden="true">→</span></a>
            <a href="/tools.html?sandbox=\${esc(app.id)}" class="open-btn" style="background:none;border:1px solid var(--border);color:var(--muted);font-size:11px">Probe →</a>
          </div>
        </div>
      \`)
    })
  } catch(e) {
    grid.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center'
    grid.innerHTML = '<div class="empty"><h3>Failed to load apps</h3><p>' + esc(String(e)) + '</p></div>'
  }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

load()
</script>
</body>
</html>` }

// ── Route handlers ────────────────────────────────────────────────────────────

function genNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

function htmlHeaders(nonce: string, allowFrame = false): Record<string, string> {
  return {
    'Content-Type':            'text/html; charset=utf-8',
    'X-Content-Type-Options':  'nosniff',
    'Referrer-Policy':         'strict-origin',
    // app pages are designed to be embedded; all others deny framing
    ...(allowFrame ? {} : { 'X-Frame-Options': 'SAMEORIGIN' }),
    'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${allowFrame ? "'self' *" : "'self'"}`,
    'Content-Security-Policy-Report-Only': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors ${allowFrame ? "'self' *" : "'self'"}; report-uri /api/csp-report`,
  }
}

const appPage: Handler = async (_req, env, params: Params) => {
  const id = params.id ?? ''
  if (!await sandboxExists(env, id)) {
    const nonce = genNonce()
    return new Response('<h1>App not found</h1>', { status: 404, headers: htmlHeaders(nonce) })
  }

  // Serve custom Vibe Builder HTML if present, otherwise fall back to generic chat page
  try {
    const res = await doFetch(stub(env, id), 'config', 'GET')
    const cfg = await res.json() as { ok: boolean; data: Omit<SandboxConfig, 'memory'> }
    if (cfg.ok && cfg.data.appHtml) {
      let html = cfg.data.appHtml.replace(/__SANDBOX_ID__/g, JSON.stringify(id).slice(1, -1))
      html = await injectAppToken(html, id, env)
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin',
          // Custom app HTML uses 'self' + unsafe-inline; app pages allow framing
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:",
        },
      })
    }
  } catch { /* fall through to generic page */ }

  const nonce = genNonce()
  let html = appPageHtml(id, nonce)
  html = await injectAppToken(html, id, env)
  return new Response(html, { headers: htmlHeaders(nonce, true) })
}

const appsGallery: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(appsGalleryHtml(nonce), { headers: htmlHeaders(nonce) }))
}

// ── Chat page (root) ──────────────────────────────────────────────────────────

function chatPageHtml(nonce: string): string { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Whisper — Chat</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#080c14;--surface:#0e1521;--border:#1c2a40;--muted:#4d6480;--text:#cdd9e5;--accent:#6366f1;--accent2:#818cf8;--teal:#14b8a6;--radius:6px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.topnav{display:flex;align-items:center;gap:4px;padding:0 16px;height:48px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
.brand{font-size:14px;font-weight:600;color:var(--accent2);text-decoration:none;letter-spacing:.02em;border-right:1px solid var(--border);padding-right:16px;margin-right:4px}
.navlink{font-size:12px;padding:5px 12px;border-radius:var(--radius);text-decoration:none;color:var(--muted);transition:color .15s,background .15s;white-space:nowrap}
.navlink:hover{color:var(--text)}
.navlink.active{background:var(--accent);color:#fff}
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
.cfg-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
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
@keyframes msgIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
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
@media(max-width:768px){.sidebar{display:none}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
.guard-seg{display:flex;background:var(--bg);border:1px solid var(--border);border-radius:calc(var(--radius)+2px);padding:2px;gap:2px}
.guard-btn{flex:1;padding:4px 4px;border-radius:var(--radius);border:none;background:none;color:var(--muted);font-size:10px;font-weight:500;font-family:inherit;cursor:pointer;transition:background .15s,color .15s;text-align:center}
.guard-btn.g-strict{background:var(--accent);color:#fff}
.guard-btn.g-audit{background:#f59e0b22;color:#f59e0b}
.guard-btn.g-off{background:#f8717122;color:#f87171}
.kb-section{border-top:1px solid var(--border)}
.kb-section.kb-collapsed .kb-body{display:none}
.kb-section.kb-collapsed .kb-arrow{transform:rotate(-90deg)}
.kb-head{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;cursor:pointer;user-select:none}
.kb-head>span:first-child{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.kb-arrow{font-size:9px;color:var(--muted);transition:transform .15s;flex-shrink:0}
.kb-body{padding:0 12px 10px;display:flex;flex-direction:column;gap:7px}
.kb-drop{border:1px dashed var(--border);border-radius:var(--radius);padding:9px;text-align:center;font-size:11px;color:var(--muted);cursor:pointer;transition:border-color .15s,color .15s}
.kb-drop:hover,.kb-drop.drag-over{border-color:var(--accent2);color:var(--accent2)}
.doc-list{display:flex;flex-direction:column;gap:3px;max-height:88px;overflow-y:auto}
.doc-item{display:flex;align-items:center;gap:5px;padding:3px 6px;background:var(--surface);border-radius:4px}
.doc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--text)}
.doc-st{font-size:9px;padding:1px 5px;border-radius:99px;flex-shrink:0}
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
  <a href="/" class="brand">Whisper</a>
  <a href="/" class="navlink active" aria-current="page">Chat</a>
  <a href="/vibe.html" class="navlink">Vibe</a>
  <a href="/apps" class="navlink">Apps</a>
  <a href="/tools.html" class="navlink">Tools</a>
  <a href="/dashboard" class="navlink">Dashboard</a>
  <a id="nav-whisper-this" href="/tools.html" class="navlink" style="margin-left:auto;color:var(--accent2)">Whisper this →</a>
</nav>
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
<script nonce="${nonce}">
function _esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function _il(s){
  s=s.replace(/\`([^\`]+)\`/g,(_,c)=>'<code>'+c+'</code>')
  s=s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
  s=s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
  s=s.replace(/\*([^*\n]+?)\*/g,'<em>$1</em>')
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,t,u)=>'<a href="'+u+'" rel="noopener noreferrer" target="_blank">'+t+'</a>')
  return s
}
function _renderMd(text){
  const lines=text.split('\\n'),out=[];let i=0
  while(i<lines.length){
    const raw=lines[i]
    if(raw.startsWith('\`\`\`')){const code=[];i++;while(i<lines.length&&!lines[i].startsWith('\`\`\`')){code.push(_esc(lines[i]));i++}i++;out.push('<pre><code>'+code.join('\\n')+'</code></pre>');continue}
    const hm=raw.match(/^(#{1,3})\s+(.+)/);if(hm){out.push('<h'+hm[1].length+'>'+_il(_esc(hm[2]))+'</h'+hm[1].length+'>');i++;continue}
    if(raw.startsWith('> ')){out.push('<blockquote>'+_il(_esc(raw.slice(2)))+'</blockquote>');i++;continue}
    if(raw.startsWith('- ')||raw.startsWith('* ')){const it=[];while(i<lines.length&&(lines[i].startsWith('- ')||lines[i].startsWith('* '))){it.push('<li>'+_il(_esc(lines[i].slice(2)))+'</li>');i++}out.push('<ul>'+it.join('')+'</ul>');continue}
    if(/^\d+\.\s/.test(raw)){const it=[];while(i<lines.length&&/^\d+\.\s/.test(lines[i])){const m=lines[i].match(/^\d+\.\s+(.+)/);it.push('<li>'+_il(_esc(m?.[1]||''))+'</li>');i++}out.push('<ol>'+it.join('')+'</ol>');continue}
    if(raw.trim()===''){out.push('');i++;continue}
    out.push('<p>'+_il(_esc(raw))+'</p>');i++
  }
  return out.join('\\n')
}

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
  if(role==='assistant'){el.innerHTML=_renderMd(text)}else{el.textContent=text}
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
    const tok=sessionTokens[activeSession]
    const histUrl='/api/sandbox/'+sandboxId+'/history?sessionId='+encodeURIComponent(activeSession)+(tok?'&token='+encodeURIComponent(tok):'')
    const r=await fetch(histUrl)
    const d=await r.json()
    if(!d.ok)return
    const msgs=document.getElementById('messages')
    msgs.innerHTML=''
    for(const m of(d.data.messages||[])){
      if(m.role!=='user'&&m.role!=='assistant')continue
      const el=document.createElement('div')
      el.className='msg '+m.role
      const content=typeof m.content==='string'?m.content:''
      if(m.role==='assistant'){el.innerHTML=_renderMd(content)}else{el.textContent=content}
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
    const tok=sessionTokens[activeSession]
    const streamUrl='/api/sandbox/'+sandboxId+'/stream?sessionId='+encodeURIComponent(activeSession)+(tok?'&token='+encodeURIComponent(tok):'')
    const res=await fetch(streamUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:text})
    })
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
              el.innerHTML=_renderMd(el._buf)
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

const chat: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(chatPageHtml(nonce), { headers: htmlHeaders(nonce) }))
}

// ── Dashboard page ────────────────────────────────────────────────────────────

function dashboardHtml(nonce: string): string { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Whisper — Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#080c14;--surface:#0e1521;--border:#1c2a40;--muted:#4d6480;--text:#cdd9e5;--accent:#6366f1;--accent2:#818cf8;--teal:#14b8a6;--green:#10b981;--red:#f87171;--radius:6px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh}
.topnav{display:flex;align-items:center;gap:4px;padding:0 16px;height:48px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10;overflow-x:auto}
.brand{font-size:14px;font-weight:600;color:var(--accent2);text-decoration:none;letter-spacing:.02em;border-right:1px solid var(--border);padding-right:16px;margin-right:4px}
.navlink{font-size:12px;padding:5px 12px;border-radius:var(--radius);text-decoration:none;color:var(--muted);transition:color .15s,background .15s;white-space:nowrap}
.navlink:hover{color:var(--text)}
.navlink.active{background:var(--accent);color:#fff}
main{max-width:1200px;margin:0 auto;padding:32px 24px}
h2{font-size:20px;font-weight:700;margin-bottom:4px}
.sub{color:var(--muted);font-size:13px;margin-bottom:24px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.stat-label{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:6px}
.stat-value{font-size:26px;font-weight:700;color:var(--text);font-family:var(--mono);line-height:1}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px}
.section-title{font-size:11px;font-weight:600;color:var(--accent2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px}
.chart-wrap{overflow-x:auto}
.item-list{list-style:none}
.item-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #ffffff08;font-size:12px}
.item-row:last-child{border-bottom:none}
.item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item-meta{font-size:10px;color:var(--muted);flex-shrink:0;font-family:var(--mono)}
.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th{text-align:left;padding:5px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
.tbl td{padding:7px 8px;border-bottom:1px solid #ffffff08}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:#ffffff04}
.badge{font-size:10px;padding:2px 7px;border-radius:99px;background:#6366f122;color:var(--accent2);font-family:var(--mono)}
.empty-note{color:var(--muted);font-size:12px;font-style:italic;padding:8px 0}
.health-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.health-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px}
.health-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:3px}
.health-dot.green{background:var(--green)}.health-dot.yellow{background:#f59e0b}.health-dot.grey{background:var(--border)}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.8}}
.sk{background:var(--border);border-radius:4px;animation:pulse 1.4s ease-in-out infinite}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
@media(max-width:760px){.two-col{grid-template-columns:1fr}.stats-grid{grid-template-columns:1fr 1fr}main{padding:16px}}
</style>
</head>
<body>
<nav class="topnav" role="navigation" aria-label="Main">
  <a href="/" class="brand">Whisper</a>
  <a href="/" class="navlink">Chat</a>
  <a href="/vibe.html" class="navlink">Vibe</a>
  <a href="/apps" class="navlink">Apps</a>
  <a href="/tools.html" class="navlink">Tools</a>
  <a href="/dashboard" class="navlink active" aria-current="page">Dashboard</a>
</nav>
<main>
  <h2>Whisperer Command Centre</h2>
  <p class="sub">Research activity and application health at a glance.</p>
  <div class="section" style="margin-bottom:24px">
    <div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
      Per-App Health
      <span style="font-size:10px;color:var(--muted);font-weight:400">Apps with attached probes or assertion suites</span>
    </div>
    <div id="health-wrap"><div class="empty-note">Loading…</div></div>
  </div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-label">Apps</div><div class="stat-value sk" id="stat-sandboxes" style="height:32px;width:48px">&nbsp;</div></div>
    <div class="stat-card"><div class="stat-label">Total Runs</div><div class="stat-value sk" id="stat-runs" style="height:32px;width:64px">&nbsp;</div></div>
    <div class="stat-card"><div class="stat-label">Tokens In</div><div class="stat-value sk" id="stat-tin" style="height:32px;width:64px">&nbsp;</div></div>
    <div class="stat-card"><div class="stat-label">Tokens Out</div><div class="stat-value sk" id="stat-tout" style="height:32px;width:64px">&nbsp;</div></div>
    <div class="stat-card"><div class="stat-label">Avg Latency</div><div class="stat-value sk" id="stat-lat" style="height:32px;width:72px">&nbsp;</div></div>
    <div class="stat-card"><div class="stat-label">Vault Records</div><div class="stat-value sk" id="stat-vault" style="height:32px;width:48px">&nbsp;</div></div>
    <div class="stat-card"><div class="stat-label">~ Est. Cost (30d)</div><div class="stat-value sk" id="stat-cost" style="height:32px;width:80px">&nbsp;</div></div>
    <div class="stat-card"><div class="stat-label">Pipelines</div><div class="stat-value sk" id="stat-pipelines" style="height:32px;width:48px">&nbsp;</div></div>
  </div>
  <div class="section" style="margin-bottom:16px">
    <div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
      AI Usage by Model — last 30 days
      <span style="font-size:10px;color:var(--muted);font-weight:400">~ approximate costs based on public pricing</span>
    </div>
    <div id="cost-wrap"><div class="empty-note">Loading…</div></div>
  </div>
  <div class="two-col">
    <div>
      <div class="section">
        <div class="section-title">Recent Probe Runs</div>
        <div id="probes-wrap"><div class="empty-note">Loading…</div></div>
      </div>
      <div class="section">
        <div class="section-title">Assertion Suites</div>
        <div id="assertions-wrap"><div class="empty-note">Loading…</div></div>
      </div>
      <div class="section">
        <div class="section-title">Evidence Vault — Recent</div>
        <div id="vault-wrap"><div class="empty-note">Loading…</div></div>
      </div>
    </div>
    <div>
      <div class="section">
        <div class="section-title">Model Breakdown</div>
        <div id="model-chart" class="chart-wrap"><div class="empty-note">Loading…</div></div>
      </div>
      <div class="section">
        <div class="section-title">Recent Apps</div>
        <div id="sandboxes-wrap"><div class="empty-note">Loading…</div></div>
      </div>
    </div>
  </div>
  <div class="section" style="margin-top:24px">
    <div class="section-title">Platform Resources</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;padding:4px 0">
      <a href="/api/openapi.json" target="_blank" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);text-decoration:none">OpenAPI 3.1 spec</a>
      <a href="/tools.html" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);text-decoration:none">Tools workbench</a>
      <a href="/vibe.html" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);text-decoration:none">Vibe builder</a>
      <a href="/apps" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);text-decoration:none">Apps gallery</a>
    </div>
  </div>
</main>
<script nonce="${nonce}" type="module" src="/chart.js"></script>
<script nonce="${nonce}">
async function load(){
  const [sandboxRes,probeRes,assertRes,vaultRes,pipelineRes]=await Promise.allSettled([
    fetch('/api/sandbox').then(function(r){return r.json()}),
    fetch('/api/probes').then(function(r){return r.json()}),
    fetch('/api/assertions').then(function(r){return r.json()}),
    fetch('/api/vault?limit=5').then(function(r){return r.json()}),
    fetch('/api/pipelines?limit=1').then(function(r){return r.json()}),
  ])

  try{
    const d=sandboxRes.status==='fulfilled'?sandboxRes.value:null
    if(!d||!d.ok)throw new Error('unavailable')
    const apps=d.data.apps||[]
    document.getElementById('stat-sandboxes').textContent=apps.length
    document.getElementById('stat-sandboxes').className='stat-value'
    let totalRuns=0,totalTin=0,totalTout=0,latencies=[],modelMap={}
    await Promise.all(apps.slice(0,20).map(async function(app){
      try{
        const mr=await fetch('/api/sandbox/'+app.id+'/metrics')
        const md=await mr.json()
        if(!md.ok)return
        const m=md.data
        totalRuns+=m.totalRuns||0;totalTin+=m.totalTokensIn||0;totalTout+=m.totalTokensOut||0
        if(m.avgLatencyMs)latencies.push(m.avgLatencyMs)
        ;(m.modelBreakdown||[]).forEach(function(b){const k=b.model||'unknown';modelMap[k]=(modelMap[k]||0)+(b.count||0)})
      }catch{}
    }))
    document.getElementById('stat-runs').textContent=totalRuns.toLocaleString();document.getElementById('stat-runs').className='stat-value'
    document.getElementById('stat-tin').textContent=fmtTok(totalTin);document.getElementById('stat-tin').className='stat-value'
    document.getElementById('stat-tout').textContent=fmtTok(totalTout);document.getElementById('stat-tout').className='stat-value'
    const avgLat=latencies.length?Math.round(latencies.reduce(function(a,b){return a+b},0)/latencies.length):0
    document.getElementById('stat-lat').textContent=avgLat?avgLat+'ms':'—';document.getElementById('stat-lat').className='stat-value'
    const chartEl=document.getElementById('model-chart')
    const modelEntries=Object.entries(modelMap).map(function(e){return{label:e[0].split('/').pop()||e[0],value:e[1]}}).sort(function(a,b){return b.value-a.value}).slice(0,8)
    if(modelEntries.length&&window.chart){chartEl.innerHTML=window.chart(modelEntries,{type:'bar',width:480,height:160,label:'Runs by model'})}
    else{chartEl.innerHTML='<div class="empty-note">'+(totalRuns?'Chart unavailable':'No runs yet')+'</div>'}
    // Per-app health grid
    const healthWrap=document.getElementById('health-wrap')
    const topApps=apps.slice(0,8)
    const healthData=await Promise.allSettled(topApps.map(async function(app){
      const [pr,ar]=await Promise.allSettled([
        fetch('/api/probes?sandboxId='+encodeURIComponent(app.id)).then(function(r){return r.json()}),
        fetch('/api/assertions?sandboxId='+encodeURIComponent(app.id)).then(function(r){return r.json()}),
      ])
      const probes=(pr.status==='fulfilled'&&pr.value.ok)?pr.value.data:[]
      const suites=(ar.status==='fulfilled'&&ar.value.ok)?ar.value.data:[]
      if(!probes.length&&!suites.length)return null
      // Determine probe health: did the last probe run within 24h?
      const lastRun=probes.reduce(function(best,p){return(!best||(p.last_run_at||0)>(best.last_run_at||0))?p:best},null)
      const probeAge=lastRun&&lastRun.last_run_at?Date.now()-lastRun.last_run_at:null
      const probeStatus=probeAge===null?'grey':probeAge<86400000?'green':'yellow'
      return {app,probes,suites,probeStatus,lastRunAt:lastRun?.last_run_at||null}
    }))
    const healthItems=healthData.map(function(r){return r.status==='fulfilled'?r.value:null}).filter(Boolean)
    if(!healthItems.length){
      healthWrap.innerHTML='<div class="empty-note">No health checks yet — attach a probe or assertion suite to an app via <a href="/tools.html" style="color:var(--accent2)">Tools →</a></div>'
    }else{
      healthWrap.innerHTML='<div class="health-grid">'+healthItems.map(function(h){
        const dateStr=h.lastRunAt?new Date(h.lastRunAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'never'
        return '<div class="health-card"><div style="display:flex;align-items:flex-start;gap:8px">'
          +'<div class="health-dot '+h.probeStatus+'"></div>'
          +'<div style="flex:1;overflow:hidden"><div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(h.app.name||h.app.id)+'</div>'
          +'<div style="font-size:10px;color:var(--muted);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap">'
          +(h.probes.length?'<span>'+h.probes.length+' probe'+(h.probes.length!==1?'s':'')+'</span>':'')
          +(h.suites.length?'<span>'+h.suites.length+' suite'+(h.suites.length!==1?'s':'')+'</span>':'')
          +'<span>last: '+esc(dateStr)+'</span></div>'
          +'<a href="/tools.html?sandbox='+esc(h.app.id)+'" style="font-size:10px;color:var(--teal);text-decoration:none;display:inline-block;margin-top:6px">Open →</a>'
          +'</div></div></div>'
      }).join('')+'</div>'
    }

    const wrap=document.getElementById('sandboxes-wrap')
    if(!apps.length){wrap.innerHTML='<div class="empty-note">No apps yet. <a href="/vibe.html" style="color:var(--accent2)">Build one →</a></div>'}
    else{
      const rows=apps.slice(0,8).map(function(app){
        const date=new Date(app.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})
        const model=(app.model||'').split('/').pop()||app.model||'—'
        return '<tr><td><a href="/app/'+esc(app.id)+'" style="color:var(--accent2);text-decoration:none">'+esc(app.name)+'</a></td>'
          +'<td><span class="badge">'+esc(model)+'</span></td>'
          +'<td style="color:var(--muted)">'+esc(date)+'</td>'
          +'<td><a href="/tools.html?sandbox='+esc(app.id)+'" style="font-size:10px;color:var(--teal);text-decoration:none">Probe →</a></td></tr>'
      }).join('')
      wrap.innerHTML='<table class="tbl"><thead><tr><th>Name</th><th>Model</th><th>Created</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'
    }
  }catch(e){
    ['stat-sandboxes','stat-runs','stat-tin','stat-tout','stat-lat','stat-cost','stat-pipelines'].forEach(function(id){document.getElementById(id).textContent='—';document.getElementById(id).className='stat-value'})
    document.getElementById('sandboxes-wrap').innerHTML='<div class="empty-note">'+esc(String(e))+'</div>'
    document.getElementById('health-wrap').innerHTML='<div class="empty-note">Unable to load.</div>'
  }

  try{
    const d=probeRes.status==='fulfilled'?probeRes.value:null
    const probes=(d&&d.ok?d.data:[]).slice(0,6)
    const wrap=document.getElementById('probes-wrap')
    if(!probes.length){wrap.innerHTML='<div class="empty-note">No probes yet. <a href="/tools.html" style="color:var(--accent2)">Create one →</a></div>'}
    else{wrap.innerHTML='<ul class="item-list">'+probes.map(function(p){
      const runs=p.run_count||0
      const webhook=p.webhook_url?'<span class="item-meta" title="Webhook configured" style="color:var(--accent2)">⚡</span>':''
      return '<li class="item-row"><span class="item-name">'+esc(p.name||'Probe')+'</span>'
        +'<span class="item-meta" style="color:var(--teal)">'+runs+' run'+(runs!==1?'s':'')+'</span>'
        +'<span class="item-meta">'+esc(p.schedule||'manual')+'</span>'+webhook+'</li>'
    }).join('')+'</ul>'}
  }catch(e){document.getElementById('probes-wrap').innerHTML='<div class="empty-note">'+esc(String(e))+'</div>'}

  try{
    const d=assertRes.status==='fulfilled'?assertRes.value:null
    const suites=(d&&d.ok?d.data:[]).slice(0,6)
    const wrap=document.getElementById('assertions-wrap')
    if(!suites.length){wrap.innerHTML='<div class="empty-note">No assertion suites yet. <a href="/tools.html" style="color:var(--accent2)">Create one →</a></div>'}
    else{wrap.innerHTML='<ul class="item-list">'+suites.map(function(s){
      const cases=s.case_count||0
      return '<li class="item-row"><span class="item-name">'+esc(s.name||'Suite')+'</span>'
        +'<span class="item-meta">'+cases+' case'+(cases!==1?'s':'')+'</span></li>'
    }).join('')+'</ul>'}
  }catch(e){document.getElementById('assertions-wrap').innerHTML='<div class="empty-note">'+esc(String(e))+'</div>'}

  try{
    const d=vaultRes.status==='fulfilled'?vaultRes.value:null
    const entries=(d&&d.ok?d.data.entries||d.data:[]).slice(0,5)
    const total=d&&d.ok&&d.data.total!=null?d.data.total:entries.length
    document.getElementById('stat-vault').textContent=fmtTok(total)||String(entries.length)
    document.getElementById('stat-vault').className='stat-value'
    const wrap=document.getElementById('vault-wrap')
    if(!entries.length){wrap.innerHTML='<div class="empty-note">No vault entries yet.</div>'}
    else{wrap.innerHTML='<ul class="item-list">'+entries.map(function(e){
      const tool=e.tool||'—'
      const date=e.createdAt?new Date(e.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'—'
      return '<li class="item-row"><span class="item-name" title="'+esc(e.note||e.prompt||'')+'">'+esc((e.note||e.prompt||'Entry').slice(0,50))+'</span>'
        +'<span class="item-meta" style="color:var(--accent2)">'+esc(tool)+'</span>'
        +'<span class="item-meta">'+esc(date)+'</span></li>'
    }).join('')+'</ul>'}
  }catch(e){
    document.getElementById('stat-vault').textContent='—';document.getElementById('stat-vault').className='stat-value'
    document.getElementById('vault-wrap').innerHTML='<div class="empty-note">'+esc(String(e))+'</div>'
  }

  // Cost / usage widget
  try{
    const from30d=Date.now()-30*86400000
    const ur=await fetch('/api/usage?from='+from30d+'&groupBy=model').then(function(r){return r.json()})
    const costWrap=document.getElementById('cost-wrap')
    const statCost=document.getElementById('stat-cost')
    if(ur&&ur.ok){
      const rows=ur.data.rows||[]
      const total=ur.data.totalCostUsd||0
      statCost.textContent='$'+total.toFixed(4)
      statCost.className='stat-value'
      if(!rows.length){costWrap.innerHTML='<div class="empty-note">No usage data yet.</div>'}
      else{
        costWrap.innerHTML='<table class="tbl"><thead><tr><th>Model</th><th>Calls</th><th>Tokens In</th><th>Tokens Out</th><th>~ Cost</th></tr></thead><tbody>'
          +rows.map(function(r){
            const model=(r.period||'—').split('/').pop()||(r.period||'—')
            return '<tr><td style="font-family:var(--mono);font-size:11px">'+esc(model)+'</td>'
              +'<td>'+fmtTok(r.totalCalls||0)+'</td>'
              +'<td>'+fmtTok(r.totalTokensIn||0)+'</td>'
              +'<td>'+fmtTok(r.totalTokensOut||0)+'</td>'
              +'<td style="color:var(--teal);font-family:var(--mono)">$'+(r.totalCostUsd||0).toFixed(4)+'</td></tr>'
          }).join('')
          +'</tbody></table>'
      }
    } else {
      statCost.textContent='—';statCost.className='stat-value'
      costWrap.innerHTML='<div class="empty-note">Usage data unavailable.</div>'
    }
  }catch(e){
    document.getElementById('stat-cost').textContent='—';document.getElementById('stat-cost').className='stat-value'
    document.getElementById('cost-wrap').innerHTML='<div class="empty-note">'+esc(String(e))+'</div>'
  }

  try{
    const d=pipelineRes.status==='fulfilled'?pipelineRes.value:null
    const el=document.getElementById('stat-pipelines')
    el.textContent=d&&d.ok?String(d.data.total||0):'—'
    el.className='stat-value'
  }catch(e){
    const el=document.getElementById('stat-pipelines')
    el.textContent='—';el.className='stat-value'
  }
}

function fmtTok(n){if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(1)+'k';return String(n||'—')}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
window.addEventListener('load',load)
</script>
</body>
</html>` }

const dashboard: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(dashboardHtml(nonce), { headers: htmlHeaders(nonce) }))
}

// ── Built app serving (/build/:id) ───────────────────────────────────────────

function buildMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css:  'text/css; charset=utf-8',
    js:   'application/javascript; charset=utf-8',
    mjs:  'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg:  'image/svg+xml',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    ico:  'image/x-icon',
    txt:  'text/plain; charset=utf-8',
    md:   'text/markdown; charset=utf-8',
  }
  return map[ext] ?? 'application/octet-stream'
}

// Permissive CSP for AI-generated apps — they may load CDN ESM frameworks
const BUILD_CSP = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https:",
  "connect-src 'self' https: wss:",
  "img-src 'self' data: https: blob:",
  "font-src 'self' https:",
].join('; ')

async function serveBuildFile(env: Env, buildId: string, filename: string): Promise<Response> {
  if (filename.startsWith('.')) return new Response('Not found', { status: 404 })
  const key = `apps/${buildId}/${filename}`
  const obj = await env.FILES.get(key)
  if (!obj) return new Response('Not found', { status: 404 })

  const ct      = buildMimeType(filename)
  const headers = { 'Content-Type': ct, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': BUILD_CSP }

  // Inject __BUILD_ID__ placeholder and app token into HTML files at serve time
  if (filename.endsWith('.html')) {
    const text     = await obj.text()
    let   injected = text.replace(/__BUILD_ID__/g, buildId)
    injected = await injectAppToken(injected, buildId, env)
    return new Response(injected, { headers })
  }

  return new Response(obj.body, { headers })
}

const buildIndex: Handler = (_req, env, params) =>
  serveBuildFile(env, params.id ?? '', 'index.html')

const buildFile: Handler = (_req, env, params) =>
  serveBuildFile(env, params.id ?? '', params.filename ?? 'index.html')

export const pageRoutes: Array<[string, string, Handler]> = [
  ['GET', '/',                    chat],
  ['GET', '/dashboard',           dashboard],
  ['GET', '/vibe',                (_req, _env) => Promise.resolve(new Response(null, { status: 301, headers: { Location: '/vibe.html' } }))],
  ['GET', '/tools',               (_req, _env) => Promise.resolve(new Response(null, { status: 301, headers: { Location: '/tools.html' } }))],
  ['GET', '/app/:id',             appPage],
  ['GET', '/apps',                appsGallery],
  ['GET', '/build/:id/:filename', buildFile],
  ['GET', '/build/:id',           buildIndex],
]
