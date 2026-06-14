import type { Env } from '../../types/env'
import { issueAppToken } from '../../lib/appToken'

// ── Shared nav ────────────────────────────────────────────────────────────────

export type NavActive = 'chat' | 'vibe' | 'apps' | 'environments' | 'lab' | 'builds' | 'tools' | 'dashboard'

export function navHtml(active: NavActive, extra = '', afterBrand = ''): string {
  const lnk = (href: string, label: string, key: NavActive): string =>
    `  <a href="${href}" class="navlink${active === key ? ' active' : ''}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`
  return [
    '<nav class="topnav" role="navigation" aria-label="Main">',
    `  <a href="/" class="brand"><span class="brand-mark" aria-hidden="true">✦</span>Whisper</a>`,
    ...(afterBrand ? [afterBrand] : []),
    lnk('/', 'Chat', 'chat'),
    lnk('/vibe.html', 'Vibe', 'vibe'),
    lnk('/apps', 'Apps', 'apps'),
    lnk('/environments', 'Environments', 'environments'),
    lnk('/lab', 'Lab', 'lab'),
    lnk('/builds', 'Builds', 'builds'),
    lnk('/tools.html', 'Tools', 'tools'),
    lnk('/dashboard', 'Dashboard', 'dashboard'),
    ...(extra ? [extra] : []),
    '</nav>',
  ].join('\n')
}

export const escJs = `function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}`

// Injects the app token as a meta tag before </head> (fallback: before </body>)
export async function injectAppToken(html: string, appId: string, env: Env): Promise<string> {
  if (!env.SIGNING_SECRET) return html
  const token = await issueAppToken(appId, env.SIGNING_SECRET)
  const tag = `<meta name="whisper-token" content="${token}">`
  if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`)
  if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`)
  return html
}

export function genNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
}

export function sharedCss(): string {
  return `<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#080c14;--surface:#0e1521;--border:#1c2a40;--muted:#4d6480;--text:#cdd9e5;--accent:#6366f1;--accent2:#818cf8;--teal:#14b8a6;--green:#10b981;--red:#f87171;--radius:6px;--mono:"JetBrains Mono","Fira Code",ui-monospace,monospace}
.topnav{display:flex;align-items:center;gap:4px;padding:0 16px;height:48px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch}
.brand{font-size:14px;font-weight:600;color:var(--accent2);text-decoration:none;letter-spacing:.02em;border-right:1px solid var(--border);padding-right:16px;margin-right:4px;white-space:nowrap}
.brand:hover{color:#fff}
.brand-mark{color:var(--accent);font-size:11px;margin-right:2px}
.navlink{font-size:12px;padding:5px 12px;border-radius:var(--radius);text-decoration:none;color:var(--muted);transition:color .15s,background .15s;white-space:nowrap;align-self:stretch;display:flex;align-items:center}
.navlink:hover{color:var(--text)}
.navlink.active{color:var(--accent2);position:relative}
.navlink.active::after{content:'';position:absolute;bottom:0;left:8px;right:8px;height:2px;background:var(--accent2);border-radius:2px 2px 0 0}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:99px}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.8}}
@keyframes msgIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
@keyframes cardIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.badge{font-size:10px;padding:2px 7px;border-radius:99px;background:#6366f122;color:var(--accent2);font-family:var(--mono)}
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px 20px;color:var(--muted)}
.empty h3{font-size:18px;margin-bottom:8px;color:var(--text)}
.empty-cta{display:inline-block;margin-top:16px;padding:10px 20px;background:var(--accent);color:#fff;border-radius:var(--radius);text-decoration:none;font-size:13px;font-weight:500}
.empty-cta:hover{background:#4f46e5}
.sk{background:var(--border);border-radius:4px;animation:pulse 1.4s ease-in-out infinite}
.sk-line{height:12px;background:var(--border);border-radius:4px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>`
}

// Shared modal CSS — overlay + slide-in box pattern used across all workspace pages
export function modalCss(): string {
  return `.modal-overlay{position:fixed;inset:0;background:#00000088;z-index:100;display:flex;align-items:center;justify-content:center;visibility:hidden;opacity:0;transition:opacity .2s,visibility .2s}.modal-overlay.open{visibility:visible;opacity:1}.modal-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:480px;max-width:90vw;display:flex;flex-direction:column;gap:12px;transform:translateY(10px);transition:transform .2s}.modal-overlay.open .modal-box{transform:translateY(0)}.modal-title{font-size:14px;font-weight:600;color:var(--accent2)}.modal-row{display:flex;gap:8px;flex-wrap:wrap}.modal-row button{flex:1;min-width:80px;padding:8px;border-radius:var(--radius);background:var(--accent);color:#fff;border:none;font-size:13px;cursor:pointer;font-family:inherit}.modal-row button.outline{background:none;border:1px solid var(--border);color:var(--text)}.modal-row button.danger{background:#b91c1c}.form-group{display:flex;flex-direction:column;gap:4px}.form-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.form-input{padding:7px 9px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);font-size:12px;font-family:inherit;outline:none}.form-input:focus{border-color:var(--accent)}.form-textarea{resize:vertical;min-height:70px;max-height:200px}.stat-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px}.stat-row:last-child{border-bottom:none}.stat-val{font-family:var(--mono);color:var(--accent2)}.modal-wide{width:520px}.act-btn{font-size:12px;padding:6px 12px;min-height:32px;border-radius:var(--radius);background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;flex-shrink:0;transition:all .15s;font-family:inherit;white-space:nowrap}.act-btn:hover{border-color:var(--accent2);color:var(--accent2)}.act-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.act-del{color:#f87171;border-color:#f8717144}.act-del:hover{border-color:#f87171;color:#f87171}`
}

// Shared modal open/close JS — inlined into each workspace page's script block.
// Close controls are wired via delegation (data-close="modal-id" on a button, or a
// click on the .modal-overlay backdrop) so pages need no inline onclick handlers —
// inline event-handler attributes are blocked by the page CSP (script-src 'nonce-…').
// Tab is trapped inside the open modal (WCAG 2.1.2): focus cycles between the first
// and last focusable control and cannot escape to the page behind the overlay.
export const modalJs = `function openModal(id){var m=document.getElementById(id);if(m){m.classList.add('open');var f=m.querySelector('button,input,textarea,select');if(f)f.focus()}}function closeModal(id){var m=document.getElementById(id);if(m)m.classList.remove('open')}function modalFocusables(m){return Array.prototype.slice.call(m.querySelectorAll('button,input,textarea,select,a[href]')).filter(function(el){return !el.disabled&&el.offsetParent!==null})}document.addEventListener('keydown',function(e){if(e.key==='Escape'){document.querySelectorAll('.modal-overlay.open').forEach(function(m){m.classList.remove('open')});return}if(e.key==='Tab'){var open=document.querySelector('.modal-overlay.open');if(!open)return;var f=modalFocusables(open);if(!f.length){e.preventDefault();return}var first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}else if(!open.contains(document.activeElement)){e.preventDefault();first.focus()}}});document.addEventListener('click',function(e){var c=e.target.closest&&e.target.closest('[data-close]');if(c){closeModal(c.getAttribute('data-close'));return}if(e.target.classList&&e.target.classList.contains('modal-overlay')){e.target.classList.remove('open')}})`

export function htmlHeaders(nonce: string, allowFrame = false): Record<string, string> {
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
