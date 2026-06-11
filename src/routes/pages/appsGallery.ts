import type { Handler } from '../../lib/http'
import { genNonce, htmlHeaders, sharedCss } from './shared'

// ── Apps gallery page ─────────────────────────────────────────────────────────

export function appsGalleryHtml(nonce: string): string { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Whisper — Apps</title>
${sharedCss()}
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh}
.topnav{position:sticky;top:0;z-index:10}
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
.badge{background:#1e2558;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-date{font-size:11px;color:var(--muted)}
.open-btn{padding:8px 16px;min-height:36px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
.open-btn:hover{background:#4f46e5}
.open-btn:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
.skeleton{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;animation:pulse 1.4s ease-in-out infinite}
@media(max-width:480px){.card{padding:14px}}
.from-vibe{font-size:10px;padding:1px 6px;border-radius:99px;background:#34d39922;color:#34d399}
</style>
</head>
<body>
<nav class="topnav" role="navigation" aria-label="Main">
  <a href="/" class="brand">Whisper</a>
  <a href="/" class="navlink">Chat</a>
  <a href="/vibe.html" class="navlink">Vibe</a>
  <a href="/apps" class="navlink active" aria-current="page">Apps</a>
  <a href="/environments" class="navlink">Environments</a>
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

export const appsGallery: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(appsGalleryHtml(nonce), { headers: htmlHeaders(nonce) }))
}
