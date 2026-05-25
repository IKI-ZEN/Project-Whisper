import type { Env } from '../types/env'
import type { Handler, Params } from '../lib/http'
import type { SandboxConfig } from '../lib/schema'
import { json, err } from '../lib/http'
import { sandboxExists, stub, doFetch } from './sandbox'

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
:root{--bg:#0c0c0f;--surface:#141418;--border:#252530;--muted:#4a4a60;--text:#d8d8e8;--accent:#7c3aed;--accent2:#a78bfa;--radius:8px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);height:100dvh;display:flex;flex-direction:column;overflow:hidden}
header{display:flex;align-items:center;gap:12px;padding:0 18px;height:54px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
#app-name{font-size:15px;font-weight:600;color:var(--accent2)}
#app-desc{font-size:12px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:10px;padding:2px 8px;border-radius:99px;background:#7c3aed22;color:var(--accent2);font-family:var(--mono);flex-shrink:0}
.hbtn{font-size:12px;padding:5px 12px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;flex-shrink:0;transition:all .15s}
.hbtn:hover{border-color:var(--accent2);color:var(--accent2)}
#messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:80%;padding:10px 14px;border-radius:var(--radius);font-size:13.5px;line-height:1.55}
.msg.user{align-self:flex-end;background:#7c3aed28;border:1px solid #7c3aed44}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border)}
.msg.system{align-self:center;color:var(--muted);font-size:12px;font-style:italic}
.msg.error{align-self:center;color:#f87171;font-size:12px}
.typing{opacity:.5}
.input-row{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--border);flex-shrink:0}
.input-row textarea{flex:1;resize:none;padding:8px 10px;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.input-row textarea:focus{border-color:var(--accent)}
.input-row button{padding:8px 18px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
.input-row button:hover:not(:disabled){background:#6d28d9}
.input-row button:disabled{opacity:.45;cursor:not-allowed}
footer{text-align:center;font-size:11px;color:var(--muted);padding:6px;border-top:1px solid var(--border);flex-shrink:0}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--accent2)}
.embed-panel{display:none;position:fixed;inset:0;background:#00000088;z-index:100;align-items:center;justify-content:center}
.embed-panel.open{display:flex}
.embed-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:480px;max-width:90vw;display:flex;flex-direction:column;gap:12px}
.embed-box h3{font-size:14px;color:var(--accent2)}
.embed-box textarea{width:100%;height:80px;padding:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-family:var(--mono);font-size:12px;resize:none}
.embed-box .row{display:flex;gap:8px}
.embed-box button{flex:1;padding:8px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;cursor:pointer}
.embed-box button.outline{background:none;border:1px solid var(--border);color:var(--text)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
</style>
</head>
<body>
<header>
  <span id="app-name">Loading…</span>
  <span id="app-desc"></span>
  <span id="model-badge" class="badge" style="display:none"></span>
  <button class="hbtn" onclick="document.getElementById('embed-panel').classList.add('open')">Embed ↗</button>
  <button class="hbtn" onclick="shareConfig(this)">Share config</button>
  <a href="/apps" style="text-decoration:none"><button class="hbtn">All Apps</button></a>
</header>
<div id="messages">
  <div class="msg system" id="init-msg">Connecting…</div>
</div>
<div class="input-row">
  <textarea id="user-input" placeholder="Type a message… (Enter to send)" rows="2" disabled></textarea>
  <button id="send-btn" disabled>Send</button>
</div>
<footer>Powered by <a href="/playground.html">Aether-Lite</a></footer>

<div id="embed-panel" class="embed-panel" onclick="if(event.target===this)this.classList.remove('open')">
  <div class="embed-box">
    <h3>Embed this app</h3>
    <textarea id="embed-code" readonly></textarea>
    <div class="row">
      <button onclick="copyEmbed()">Copy code</button>
      <button class="outline" onclick="document.getElementById('embed-panel').classList.remove('open')">Close</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
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
      '<iframe src="' + location.origin + '/app/' + SANDBOX_ID + '" width="420" height="640" frameborder="0" allow="microphone"></iframe>'
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
              el.textContent += ev.response
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
<title>Aether-Lite — Apps</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0c0c0f;--surface:#141418;--border:#252530;--muted:#4a4a60;--text:#d8d8e8;--accent:#7c3aed;--accent2:#a78bfa;--radius:8px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh}
header{display:flex;align-items:center;gap:12px;padding:0 24px;height:54px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
header h1{font-size:15px;font-weight:600;color:var(--accent2)}
.pill{font-size:10px;padding:2px 8px;border-radius:99px;background:#7c3aed22;color:var(--accent2)}
header a{margin-left:auto;text-decoration:none}
header button{padding:6px 14px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer}
header button:hover{background:#6d28d9}
main{max-width:1100px;margin:0 auto;padding:32px 24px}
h2{font-size:22px;font-weight:700;margin-bottom:6px}
.sub{color:var(--muted);font-size:13px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card-name{font-size:14px;font-weight:600}
.card-desc{font-size:12px;color:var(--muted);flex:1;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;align-items:center;gap:8px}
.badge{font-size:10px;padding:2px 7px;border-radius:99px;background:#22234a;color:var(--accent2);font-family:var(--mono);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-date{font-size:10px;color:var(--muted)}
.open-btn{padding:6px 14px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-block}
.open-btn:hover{background:#6d28d9}
.empty{text-align:center;padding:80px 20px;color:var(--muted)}
.empty h3{font-size:18px;margin-bottom:8px;color:var(--text)}
.empty a{color:var(--accent2)}
.from-vibe{font-size:10px;padding:1px 6px;border-radius:99px;background:#34d39922;color:#34d399}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
</style>
</head>
<body>
<header>
  <h1>Aether-Lite</h1>
  <span class="pill">Apps</span>
  <a href="/playground.html"><button>+ New App</button></a>
</header>
<main>
  <h2>Your Apps</h2>
  <p class="sub">AI-powered apps built with the Vibe Builder or API. Click any card to open the app.</p>
  <div id="grid" class="grid"></div>
</main>
<script nonce="${nonce}">
async function load() {
  const grid = document.getElementById('grid')
  try {
    const r = await fetch('/api/sandbox')
    const d = await r.json()
    if (!d.ok || !d.data.apps.length) {
      grid.innerHTML = '<div class="empty"><h3>No apps yet</h3><p>Head to the <a href="/playground.html">Playground</a> to build your first AI app with the Vibe Builder.</p></div>'
      return
    }
    grid.innerHTML = ''
    for (const app of d.data.apps) {
      const date = new Date(app.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      const modelShort = (app.model || '').split('/').pop() || app.model
      grid.insertAdjacentHTML('beforeend', \`
        <div class="card">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="card-name">\${esc(app.name)}</span>
            \${app.fromVibe ? '<span class="from-vibe">vibe</span>' : ''}
          </div>
          <p class="card-desc">\${esc(app.description || 'No description')}</p>
          <div class="card-foot">
            <span class="badge" title="\${esc(app.model)}">\${esc(modelShort)}</span>
            <span class="card-date">\${date}</span>
          </div>
          <a href="/app/\${esc(app.id)}" class="open-btn">Open App →</a>
        </div>
      \`)
    }
  } catch(e) {
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
    'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:`,
  }
}

export const appPageRoute: Handler = async (_req, env, params: Params) => {
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
      const html = cfg.data.appHtml.replace(/__SANDBOX_ID__/g, JSON.stringify(id).slice(1, -1))
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
  return new Response(appPageHtml(id, nonce), { headers: htmlHeaders(nonce, true) })
}

export const appsGalleryRoute: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(appsGalleryHtml(nonce), { headers: htmlHeaders(nonce) }))
}

// ── Landing page ──────────────────────────────────────────────────────────────

const landingHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Project Aether-Lite</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0c0c0f;--surface:#141418;--border:#252530;--muted:#4a4a60;--text:#d8d8e8;--accent:#7c3aed;--accent2:#a78bfa;--green:#34d399;--radius:8px;--mono:"JetBrains Mono",ui-monospace,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:10px;padding:0 32px;height:54px;background:var(--surface);border-bottom:1px solid var(--border)}
header h1{font-size:15px;font-weight:600;color:var(--accent2)}
.pill{font-size:10px;padding:2px 8px;border-radius:99px;background:#7c3aed22;color:var(--accent2)}
header nav{margin-left:auto;display:flex;gap:8px}
header nav a{font-size:12px;color:var(--muted);text-decoration:none;padding:5px 12px;border-radius:var(--radius);border:1px solid transparent;transition:all .15s}
header nav a:hover{border-color:var(--border);color:var(--text)}
header nav a.cta{background:var(--accent);color:#fff;border-color:var(--accent)}
header nav a.cta:hover{background:#6d28d9;border-color:#6d28d9}
main{flex:1;max-width:960px;margin:0 auto;padding:72px 24px 48px;width:100%}
.hero{text-align:center;margin-bottom:64px}
.hero h2{font-size:42px;font-weight:800;line-height:1.15;letter-spacing:-0.02em;background:linear-gradient(135deg,var(--accent2) 0%,#c4b5fd 50%,var(--accent2) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:16px}
.hero p{font-size:17px;color:var(--muted);max-width:520px;margin:0 auto 32px;line-height:1.6}
.hero-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btn{display:inline-block;padding:11px 28px;border-radius:var(--radius);font-size:14px;font-weight:600;text-decoration:none;transition:all .15s;cursor:pointer;border:none}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:#6d28d9}
.btn-outline{background:none;border:1px solid var(--border);color:var(--text)}
.btn-outline:hover{border-color:var(--accent2);color:var(--accent2)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:56px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:22px;display:flex;flex-direction:column;gap:10px}
.card-icon{font-size:24px;width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#7c3aed18;flex-shrink:0}
.card h3{font-size:14px;font-weight:600}
.card p{font-size:12px;color:var(--muted);line-height:1.55;flex:1}
.code-block{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;font-family:var(--mono);font-size:12px;line-height:1.7;color:var(--text);overflow-x:auto;margin-bottom:56px}
.code-block .c{color:var(--muted)}
.code-block .s{color:#86efac}
.code-block .k{color:var(--accent2)}
.section-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:16px}
footer{text-align:center;padding:24px;border-top:1px solid var(--border);font-size:11px;color:var(--muted)}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--accent2)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
</style>
</head>
<body>
<header>
  <h1>Aether-Lite</h1>
  <span class="pill">v0.2.0</span>
  <nav>
    <a href="/apps">Apps Gallery</a>
    <a href="/playground.html" class="cta">Open Playground →</a>
  </nav>
</header>
<main>
  <div class="hero">
    <h2>Build AI apps<br>in plain English</h2>
    <p>Describe your app, and Aether-Lite designs, configures, and launches a live AI assistant — instantly, with no backend required.</p>
    <div class="hero-btns">
      <a href="/playground.html" class="btn btn-primary">Open Playground →</a>
      <a href="/apps" class="btn btn-outline">Browse Apps</a>
    </div>
  </div>

  <p class="section-label">What you can do</p>
  <div class="cards">
    <div class="card">
      <div class="card-icon">✦</div>
      <h3>Vibe Builder</h3>
      <p>Describe your app in a sentence. The platform designs a complete AI assistant — system prompt, model, and settings — and launches it instantly.</p>
    </div>
    <div class="card">
      <div class="card-icon">◈</div>
      <h3>Apps Gallery</h3>
      <p>Every sandbox gets a shareable URL, an embeddable iframe widget, and a stable short API. Browse and open all your apps from one place.</p>
    </div>
    <div class="card">
      <div class="card-icon">⬡</div>
      <h3>Aether-Lite SDK</h3>
      <p>A zero-dependency browser SDK with <code style="font-size:11px;color:var(--accent2)">&lt;aether-lite-chat&gt;</code> web component, <code style="font-size:11px;color:var(--accent2)">AppBuilder</code>, and full multi-file app generation.</p>
    </div>
    <div class="card">
      <div class="card-icon">⊕</div>
      <h3>Multi-provider AI</h3>
      <p>Use free Workers AI models out of the box, or route to GPT-4o, Claude, and Gemini via Cloudflare AI Gateway with your own API keys.</p>
    </div>
  </div>

  <p class="section-label">Quick start</p>
  <div class="code-block"><span class="c">// Embed a sandbox anywhere with the SDK</span>
<span class="k">import</span> { AetherLiteClient } <span class="k">from</span> <span class="s">'/vibe-sdk.js'</span>
<span class="k">const</span> client = <span class="k">new</span> AetherLiteClient()

<span class="c">// Create a quick AI assistant from a description</span>
<span class="k">const</span> vibe = <span class="k">await</span> client.vibes.create(<span class="s">'A friendly cooking assistant'</span>)
document.body.innerHTML = vibe.embedCode   <span class="c">// instant &lt;iframe&gt; embed</span>

<span class="c">// Or build a full multi-file app</span>
<span class="k">const</span> session = client.builder.session(<span class="s">'A to-do list with local storage'</span>)
  .onComplete(<span class="k">r</span> =&gt; window.open(<span class="k">r</span>.appUrl))
<span class="k">await</span> session.start()

<span class="c">// Or drop in the web component</span>
<span class="c">// &lt;aether-lite-chat sandbox-id="abc123"&gt;&lt;/aether-lite-chat&gt;</span></div>
</main>
<footer>
  <a href="/playground.html">Playground</a> · <a href="/apps">Apps</a> · <a href="/api">API</a>
</footer>
</body>
</html>`

export const landingRoute: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(landingHtml, { headers: htmlHeaders(nonce) }))
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
  const key = `apps/${buildId}/${filename}`
  const obj = await env.FILES.get(key)
  if (!obj) return new Response('Not found', { status: 404 })
  return new Response(obj.body, {
    headers: {
      'Content-Type':           buildMimeType(filename),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': BUILD_CSP,
    },
  })
}

export const buildIndexRoute: Handler = (_req, env, params) =>
  serveBuildFile(env, params.id ?? '', 'index.html')

export const buildFileRoute: Handler = (_req, env, params) =>
  serveBuildFile(env, params.id ?? '', params.filename ?? 'index.html')

export const pageRoutes: Array<[string, string, Handler]> = [
  ['GET', '/',                   landingRoute],
  ['GET', '/app/:id',            appPageRoute],
  ['GET', '/apps',               appsGalleryRoute],
  ['GET', '/build/:id/:filename', buildFileRoute],
  ['GET', '/build/:id',          buildIndexRoute],
]
