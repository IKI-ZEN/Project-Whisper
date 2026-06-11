import type { Handler } from '../../lib/http'
import { genNonce, htmlHeaders, sharedCss } from './shared'

// ── Dashboard page ────────────────────────────────────────────────────────────

export function dashboardHtml(nonce: string): string { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Whisper — Dashboard</title>
${sharedCss()}
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100dvh}
.topnav{position:sticky;top:0;z-index:10}
main{max-width:1200px;margin:0 auto;padding:32px 24px}
h2{font-size:20px;font-weight:700;margin-bottom:4px}
.sub{color:var(--muted);font-size:13px;margin-bottom:24px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.stat-label{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:6px}
.stat-value{font-size:26px;font-weight:700;color:var(--text);font-family:var(--mono);line-height:1}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px}
.section-title{font-size:11px;font-weight:600;color:var(--accent2);text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px}
.chart-wrap{overflow-x:auto}
.item-list{list-style:none}
.item-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #ffffff08;font-size:12px}
.item-row:last-child{border-bottom:none}
.item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item-meta{font-size:11px;color:var(--muted);flex-shrink:0;font-family:var(--mono)}
.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th{text-align:left;padding:5px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.tbl td{padding:7px 8px;border-bottom:1px solid #ffffff08}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:#ffffff04}
.empty-note{color:var(--muted);font-size:12px;font-style:italic;padding:8px 0}
.health-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.health-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px}
.health-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;margin-top:3px}
.health-dot.green{background:var(--green)}.health-dot.yellow{background:#f59e0b}.health-dot.grey{background:var(--border)}
@media(max-width:900px){.two-col{grid-template-columns:1fr}.stats-grid{grid-template-columns:1fr 1fr}main{padding:16px}}
</style>
</head>
<body>
<nav class="topnav" role="navigation" aria-label="Main">
  <a href="/" class="brand">Whisper</a>
  <a href="/" class="navlink">Chat</a>
  <a href="/vibe.html" class="navlink">Vibe</a>
  <a href="/apps" class="navlink">Apps</a>
  <a href="/environments" class="navlink">Environments</a>
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
        ;(m.modelBreakdown||[]).forEach(function(b){const k=b.model||'unknown';modelMap[k]=(modelMap[k]||0)+(b.runs||0)})
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

export const dashboard: Handler = (_req, _env) => {
  const nonce = genNonce()
  return Promise.resolve(new Response(dashboardHtml(nonce), { headers: htmlHeaders(nonce) }))
}
