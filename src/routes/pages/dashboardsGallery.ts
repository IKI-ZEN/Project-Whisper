import type { Handler } from '../../lib/http'
import { genNonce, htmlHeaders, sharedCss, navHtml, escJs } from './shared'

// ── Dashboards gallery page ───────────────────────────────────────────────────

export function dashboardsGalleryHtml(nonce: string): string { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Whisper — Dashboards</title>
${sharedCss()}
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh}
.topnav{position:sticky;top:0;z-index:10}
.newbtn{margin-left:auto;padding:4px 10px;border:1px solid var(--border);border-radius:var(--radius);color:var(--accent2);font-size:11px;text-decoration:none;transition:border-color .15s,color .15s}
.newbtn:hover{border-color:var(--accent2)}
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
.from-dash{font-size:10px;padding:1px 6px;border-radius:99px;background:#6366f122;color:var(--accent2)}
</style>
</head>
<body>
${navHtml('dashboards', '  <a href="#new" id="new-btn" class="navlink newbtn" style="margin-left:auto">+ New Dashboard</a>')}
<main>
  <h2>Your Dashboards</h2>
  <p class="sub">Custom data dashboards with live platform metrics. Built by the AI vibe coder.</p>
  <div id="grid" class="grid" role="list"></div>
</main>

<div id="new-modal" style="display:none;position:fixed;inset:0;background:#00000088;z-index:100;align-items:center;justify-content:center">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px;width:480px;max-width:90vw;display:flex;flex-direction:column;gap:14px">
    <h3 style="font-size:15px;font-weight:700">New Dashboard</h3>
    <label style="font-size:12px;color:var(--muted)">Describe what data and layout you want</label>
    <textarea id="desc-input" rows="4" placeholder="e.g. Show me app usage stats, recent events, and a model cost breakdown in a dark grid layout" style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;font-family:inherit;resize:vertical;outline:none"></textarea>
    <input id="name-input" type="text" placeholder="Dashboard name (optional)" style="padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:13px;font-family:inherit;outline:none"/>
    <div style="display:flex;gap:8px">
      <button id="create-btn" style="flex:1;padding:10px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:500;cursor:pointer">Generate Dashboard</button>
      <button id="cancel-btn" style="padding:10px 16px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--text);font-size:13px;cursor:pointer">Cancel</button>
    </div>
    <div id="create-status" style="font-size:12px;color:var(--muted);min-height:18px"></div>
  </div>
</div>

<script nonce="${nonce}">
async function load() {
  const grid = document.getElementById('grid')
  grid.innerHTML = [1,2,3].map(() => \`<div class="skeleton" role="listitem" aria-hidden="true"><div class="sk-line" style="width:60%"></div><div class="sk-line" style="width:90%"></div><div class="sk-line" style="width:40%"></div></div>\`).join('')
  try {
    const r = await fetch('/api/sandbox?only=dashboards')
    const d = await r.json()
    if (!d.ok || !d.data.apps.length) {
      grid.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center'
      grid.innerHTML = '<div class="empty"><h3>No dashboards yet</h3><p>Click "+ New Dashboard" to generate one.</p></div>'
      return
    }
    grid.innerHTML = ''
    d.data.apps.forEach((app, i) => {
      const date = new Date(app.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      const delay = Math.min(i, 10) * 50
      grid.insertAdjacentHTML('beforeend', \`
        <div class="card" role="listitem" style="animation:cardIn .2s ease-out both;animation-delay:\${delay}ms">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="card-name">\${esc(app.name)}</span>
            <span class="from-dash">dashboard</span>
          </div>
          <p class="card-desc">\${esc(app.description || 'No description')}</p>
          <div class="card-foot">
            <span class="card-date">\${date}</span>
          </div>
          <a href="/app/\${esc(app.id)}" class="open-btn">Open Dashboard <span aria-hidden="true">→</span></a>
        </div>
      \`)
    })
  } catch(e) {
    grid.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center'
    grid.innerHTML = '<div class="empty"><h3>Failed to load dashboards</h3><p>' + esc(String(e)) + '</p></div>'
  }
}

${escJs}

function openModal() {
  const m = document.getElementById('new-modal')
  m.style.display = 'flex'
  document.getElementById('desc-input').focus()
}
function closeModal() {
  document.getElementById('new-modal').style.display = 'none'
  document.getElementById('create-status').textContent = ''
}

async function createDashboard() {
  const desc = document.getElementById('desc-input').value.trim()
  const name = document.getElementById('name-input').value.trim()
  if (desc.length < 10) { document.getElementById('create-status').textContent = 'Description must be at least 10 characters.'; return }
  const btn = document.getElementById('create-btn')
  btn.disabled = true
  btn.textContent = 'Generating…'
  document.getElementById('create-status').textContent = 'Building your dashboard with AI…'
  try {
    const r = await fetch('/api/vibes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc, mode: 'dashboard', ...(name ? { name } : {}) }),
    })
    const d = await r.json()
    if (!d.ok) { document.getElementById('create-status').textContent = 'Error: ' + esc(d.error || 'Unknown error'); return }
    location.href = d.data.appUrl
  } catch(e) {
    document.getElementById('create-status').textContent = 'Error: ' + esc(String(e))
  } finally {
    btn.disabled = false
    btn.textContent = 'Generate Dashboard'
  }
}

document.getElementById('new-btn').addEventListener('click', e => { e.preventDefault(); openModal() })
document.getElementById('cancel-btn').addEventListener('click', closeModal)
document.getElementById('new-modal').addEventListener('click', e => { if (e.target === document.getElementById('new-modal')) closeModal() })
document.getElementById('create-btn').addEventListener('click', createDashboard)
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })

load()
</script>
</body>
</html>` }

export const dashboardsGallery: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(dashboardsGalleryHtml(nonce), { headers: htmlHeaders(nonce) }))
}
