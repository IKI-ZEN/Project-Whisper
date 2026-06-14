import type { Handler } from '../../lib/http'
import { genNonce, htmlHeaders, sharedCss, navHtml, escJs } from './shared'

// ── Environments gallery page (/environments) — agentic workspaces ────────────

export function envsGalleryHtml(nonce: string): string { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Whisper — Environments</title>
${sharedCss()}
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh}
.topnav{position:sticky;top:0;z-index:10}
main{max-width:1100px;margin:0 auto;padding:32px 24px;min-height:calc(100dvh - 48px);display:flex;flex-direction:column}
h2{font-size:22px;font-weight:700;margin-bottom:6px}
.sub{color:var(--muted);font-size:13px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card-name{font-size:14px;font-weight:600}
.card-desc{font-size:12px;color:var(--muted);flex:1;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.env-badge{font-size:10px;padding:2px 8px;border-radius:99px;background:#6366f122;color:var(--accent2);font-family:var(--mono)}
.card-model{font-size:11px;color:var(--muted);font-family:var(--mono)}
.card-date{font-size:11px;color:var(--muted);margin-left:auto}
.open-btn{padding:8px 16px;min-height:36px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
.open-btn:hover{background:#4f46e5}
.open-btn:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
.act-btn{padding:7px 12px;min-height:36px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--muted);font-size:11px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:border-color .15s,color .15s;font-family:inherit}
.act-btn:hover{border-color:var(--accent2);color:var(--text)}
.act-btn:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
.act-btn:disabled{opacity:.5;cursor:not-allowed}
.act-del:hover{border-color:var(--red);color:var(--red)}
.skeleton{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;animation:pulse 1.4s ease-in-out infinite}
@media(max-width:480px){.card{padding:14px}}
</style>
</head>
<body>
${navHtml('environments')}
<main>
  <h2>Your Environments</h2>
  <p class="sub">Agentic workspaces tuned for specific domains — cybersecurity, sales, research, creative writing, and more. Create one with the Vibe coder.</p>
  <div id="grid" class="grid" role="list"></div>
</main>
<script nonce="${nonce}">
async function load(){
  const grid = document.getElementById('grid')
  grid.innerHTML = [1,2,3].map(() => \`<div class="skeleton" role="listitem" aria-hidden="true"><div class="sk-line" style="width:60%"></div><div class="sk-line" style="width:90%"></div><div class="sk-line" style="width:40%"></div></div>\`).join('')
  try{
    const r = await fetch('/api/sandbox?only=envs')
    const d = await r.json()
    if(!d.ok || !d.data.apps.length){
      grid.style.cssText='flex:1;display:flex;align-items:center;justify-content:center'
      grid.innerHTML='<div class="empty"><h3>No environments yet</h3><p>Describe your domain and the Vibe coder will build a specialised agentic workspace.</p><a href="/vibe.html" class="empty-cta">Open Vibe Coder →</a></div>'
      return
    }
    grid.innerHTML=''
    d.data.apps.forEach(function(env, i){
      const date=new Date(env.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})
      const model = env.model ? (env.model.split('/').pop()||env.model) : ''
      const delay=Math.min(i,10)*50
      grid.insertAdjacentHTML('beforeend',\`
        <div class="card" role="listitem" style="animation:cardIn .2s ease-out both;animation-delay:\${delay}ms" data-id="\${esc(env.id)}" data-name="\${esc(env.name)}">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="card-name">\${esc(env.name)}</span>
            <span class="env-badge">ENV</span>
          </div>
          <p class="card-desc">\${esc(env.description||'No description')}</p>
          <div class="card-foot">
            <span class="card-model">\${esc(model)}</span>
            <span class="card-date">\${date}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <a href="/env/\${esc(env.id)}" class="open-btn">Open <span aria-hidden="true">→</span></a>
            <button class="act-btn fork-btn" data-id="\${esc(env.id)}" data-name="\${esc(env.name)}">Fork</button>
            <button class="act-btn export-btn" data-id="\${esc(env.id)}" data-name="\${esc(env.name)}">Export</button>
            <button class="act-btn act-del delete-btn" data-id="\${esc(env.id)}" data-name="\${esc(env.name)}">Delete</button>
          </div>
        </div>
      \`)
    })
    document.getElementById('grid').addEventListener('click', handleCardAction)
  }catch(e){
    grid.style.cssText='flex:1;display:flex;align-items:center;justify-content:center'
    grid.innerHTML='<div class="empty"><h3>Failed to load environments</h3><p>'+esc(String(e))+'</p></div>'
  }
}

async function handleCardAction(e){
  const fork = e.target.closest('.fork-btn')
  const expt = e.target.closest('.export-btn')
  const del  = e.target.closest('.delete-btn')
  if(fork) await doFork(fork.dataset.id, fork.dataset.name, fork)
  if(expt) await doExport(expt.dataset.id, expt.dataset.name, expt)
  if(del)  await doDelete(del.dataset.id, del.dataset.name, del)
}

async function doFork(id, name, btn){
  btn.disabled=true; btn.textContent='Forking…'
  try{
    const r=await fetch('/api/sandbox/'+id+'/fork',{method:'POST'})
    const d=await r.json()
    if(!d.ok)throw new Error(d.error||'Fork failed')
    window.location.href=d.data.appUrl
  }catch(e){ btn.disabled=false; btn.textContent='Fork'; alert('Fork failed: '+String(e)) }
}

async function doExport(id, name, btn){
  btn.disabled=true; btn.textContent='Exporting…'
  try{
    const r=await fetch('/api/sandbox/'+id+'/export')
    const d=await r.json()
    if(!d.ok)throw new Error(d.error||'Export failed')
    const blob=new Blob([JSON.stringify(d.data,null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob);const a=document.createElement('a')
    a.href=url;a.download=(name||'env').replace(/[^a-zA-Z0-9_-]/g,'_')+'.json'
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url)
  }catch(e){alert('Export failed: '+String(e))}
  finally{btn.disabled=false;btn.textContent='Export'}
}

async function doDelete(id, name, btn){
  if(!confirm('Delete "'+name+'"? This cannot be undone.')) return
  btn.disabled=true;btn.textContent='Deleting…'
  try{
    const r=await fetch('/api/sandbox/'+id,{method:'DELETE'})
    const d=await r.json()
    if(!d.ok)throw new Error(d.error||'Delete failed')
    btn.closest('.card').remove()
  }catch(e){btn.disabled=false;btn.textContent='Delete';alert('Delete failed: '+String(e))}
}

${escJs}

load()
</script>
</body>
</html>` }

export const envsGallery: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(envsGalleryHtml(nonce), { headers: htmlHeaders(nonce) }))
}
