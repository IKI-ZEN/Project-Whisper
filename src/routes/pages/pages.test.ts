import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { appPageHtml } from './appPage'
import { appsGalleryHtml } from './appsGallery'
import { buildsGalleryHtml } from './buildsGallery'
import { chatPageHtml } from './chatPage'
import { dashboardHtml } from './dashboard'
import { envPageHtml } from './envPage'
import { envsGalleryHtml } from './envsGallery'
import { labPageHtml } from './labPage'
import { labsGalleryHtml } from './labsGallery'
import { modalJs } from './shared'

const NONCE = 'test-nonce-abc123'

// Modals must label themselves for screen readers (WCAG 4.1.2): every role="dialog"
// needs an aria-labelledby pointing at its title. This catches dialogs added without one.
function assertDialogsLabelled(html: string, label: string): void {
  const dialogRe = /<div[^>]*role="dialog"[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = dialogRe.exec(html)) !== null) {
    assert.ok(/aria-labelledby="/.test(m[0]), `${label}: every role="dialog" needs aria-labelledby (found ${m[0]})`)
  }
}

// Every workspace/gallery page renders with CSP `script-src 'nonce-…'` and no
// `unsafe-inline`. Inline HTML event-handler attributes (onclick=, onerror=, …)
// are therefore silently blocked by the browser. This regex catches them in any
// generated page so the no-inline-handler rule can't regress.
const INLINE_HANDLER_RE = /\s(on[a-z]+)\s*=\s*"/i

function assertNoInlineHandlers(html: string, label: string): void {
  const m = html.match(INLINE_HANDLER_RE)
  assert.ok(!m, `${label} must not use inline HTML event handlers (found ${m?.[1]}=) — blocked by CSP`)
}

describe('appPageHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = appPageHtml('test-sandbox-id', NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('exposes the full lifecycle action set', () => {
    const html = appPageHtml('test-sandbox-id', NONCE)
    for (const id of ['fork-btn', 'metrics-btn', 'edit-btn', 'export-btn', 'embed-btn', 'delete-btn']) {
      assert.ok(html.includes(`id="${id}"`), `app page must render #${id}`)
    }
  })

  it('wires fork/delete/export to the sandbox API and lands the fork via appUrl', () => {
    const html = appPageHtml('test-sandbox-id', NONCE)
    assert.ok(html.includes("'/fork'") || html.includes('/fork'), 'fork must POST to the fork endpoint')
    assert.ok(html.includes('/export-session'), 'export must hit the signed session export')
    assert.ok(html.includes('d.data.appUrl'), 'fork must navigate to the returned appUrl')
  })

  it('uses no inline event handlers (CSP-safe)', () => {
    assertNoInlineHandlers(appPageHtml('test-sandbox-id', NONCE), 'app page')
  })

  it('labels every dialog for screen readers', () => {
    assertDialogsLabelled(appPageHtml('test-sandbox-id', NONCE), 'app page')
  })
})

describe('modalJs (shared)', () => {
  it('traps Tab focus inside the open modal (WCAG 2.1.2)', () => {
    // The keydown handler must intercept Tab and cycle focus between the first and
    // last focusable control rather than letting it escape behind the overlay.
    assert.ok(modalJs.includes("e.key==='Tab'"), 'modalJs must handle the Tab key')
    assert.ok(modalJs.includes('modalFocusables'), 'modalJs must enumerate focusable controls')
    assert.ok(modalJs.includes('e.preventDefault()'), 'modalJs must preventDefault to cycle focus')
  })

  it('still closes on Escape and on backdrop click', () => {
    assert.ok(modalJs.includes("e.key==='Escape'"))
    assert.ok(modalJs.includes("contains('modal-overlay')"))
  })
})

describe('appsGalleryHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = appsGalleryHtml(NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('lists only apps and offers fork/export/delete per card', () => {
    const html = appsGalleryHtml(NONCE)
    assert.ok(html.includes('/api/sandbox?only=apps'), 'gallery must filter to apps only')
    assert.ok(html.includes('fork-btn'))
    assert.ok(html.includes('export-btn'))
    assert.ok(html.includes('delete-btn'))
  })

  it('uses no inline event handlers (CSP-safe)', () => {
    assertNoInlineHandlers(appsGalleryHtml(NONCE), 'apps gallery')
  })
})

describe('buildsGalleryHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = buildsGalleryHtml(NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('reads from the v2 build registry and renders deploy/delete actions', () => {
    const html = buildsGalleryHtml(NONCE)
    assert.ok(html.includes('/api/v2/build'), 'builds gallery must read the build list endpoint')
    assert.ok(html.includes('deploy-btn'), 'completed builds must offer Deploy')
    assert.ok(html.includes('delete-btn'), 'builds must offer Delete')
    assert.ok(html.includes('/thumbnail'), 'cards must reference the thumbnail endpoint')
  })

  it('uses no inline event handlers (CSP-safe)', () => {
    // Regression guard: the thumbnail fallback was originally an inline onerror=.
    assertNoInlineHandlers(buildsGalleryHtml(NONCE), 'builds gallery')
  })
})

describe('chatPageHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = chatPageHtml(NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('never puts the session token in a URL query string (CWE-598)', () => {
    // Session tokens must travel in the X-Session-Token header, not the URL,
    // so they cannot leak into browser history or access logs.
    const html = chatPageHtml(NONCE)
    assert.ok(!html.includes("'&token='"), 'token must not be appended to any URL')
    assert.ok(!html.includes('&token='),   'token must not appear in a query string')
    assert.ok(html.includes('X-Session-Token'), 'token must be sent as a request header')
  })

  it('sends sessionId in the stream request body, not the URL', () => {
    // run/stream read sessionId from the request body (parseRunSandboxRequest).
    // Putting it in the URL both leaks it into logs and silently routes every
    // streamed message to the default thread (the query param is ignored).
    const html = chatPageHtml(NONCE)
    assert.ok(!html.includes("/stream?sessionId="), 'sessionId must not be in the stream URL')
    assert.ok(html.includes('sessionId:activeSession'), 'sessionId must be sent in the POST body')
  })
})

describe('dashboardHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = dashboardHtml(NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('reads the run count from modelBreakdown[].runs (matches /metrics shape)', () => {
    // The /api/sandbox/:id/metrics endpoint returns modelBreakdown rows shaped
    // { model, runs, tokensIn, tokensOut } (SELECT COUNT(*) AS runs). The "Runs
    // by model" chart must read `.runs`; reading `.count` silently yields 0 bars.
    const html = dashboardHtml(NONCE)
    assert.ok(html.includes('b.runs'), 'model chart must accumulate b.runs')
    assert.ok(!html.includes('b.count'), 'b.count does not exist on the metrics response')
  })
})

describe('envPageHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = envPageHtml('test-env-id', 'Test Environment', 'A helpful assistant.', 'anthropic:claude-sonnet-4-6', ['sensitivity', 'consistency'], NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('renders the requested Whisperer features and the lifecycle action set', () => {
    const html = envPageHtml('test-env-id', 'Test Env', 'desc', 'openai:gpt-4o', ['sensitivity', 'entropy'], NONCE)
    assert.ok(html.includes('feat-sensitivity'), 'requested feature button must render')
    assert.ok(html.includes('feat-entropy'))
    assert.ok(!html.includes('feat-cluster'), 'unrequested features must not render')
    for (const id of ['fork-btn', 'embed-btn', 'metrics-btn', 'edit-btn', 'export-btn', 'delete-btn']) {
      assert.ok(html.includes(`id="${id}"`), `env page must render #${id}`)
    }
  })

  it('forks via the sandbox endpoint and returns to /environments on delete', () => {
    const html = envPageHtml('test-env-id', 'Test Env', 'desc', 'm', ['sensitivity'], NONCE)
    assert.ok(html.includes("'/fork'") || html.includes('/fork'))
    assert.ok(html.includes("'/environments'"), 'delete must redirect to the environments gallery')
  })

  it('uses no inline event handlers (CSP-safe)', () => {
    assertNoInlineHandlers(envPageHtml('test-env-id', 'n', 'd', 'm', ['sensitivity'], NONCE), 'env page')
  })

  it('renders with an empty feature list (no Whisperer panel)', () => {
    const html = envPageHtml('test-env-id', 'n', 'd', 'm', [], NONCE)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(!html.includes('Whisperer Analysis'), 'panel must be omitted when no features selected')
  })

  it('labels every dialog and lets the header wrap on mobile', () => {
    const html = envPageHtml('test-env-id', 'n', 'd', 'm', ['sensitivity'], NONCE)
    assertDialogsLabelled(html, 'env page')
    assert.ok(/\.env-header\{[^}]*flex-wrap:wrap/.test(html), 'env-header must wrap so the action bar stays visible on narrow viewports')
  })
})

describe('envsGalleryHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = envsGalleryHtml(NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('lists only environments and offers fork/export/delete per card', () => {
    const html = envsGalleryHtml(NONCE)
    assert.ok(html.includes('/api/sandbox?only=envs'), 'gallery must filter to envs only')
    assert.ok(html.includes('fork-btn'))
    assert.ok(html.includes('export-btn'))
    assert.ok(html.includes('delete-btn'))
  })

  it('uses no inline event handlers (CSP-safe)', () => {
    assertNoInlineHandlers(envsGalleryHtml(NONCE), 'envs gallery')
  })
})

describe('labPageHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = labPageHtml('test-lab-id', 'general', ['openai:gpt-4o'], 'sys', false, NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('forks via the lab endpoint (preserves fromLab) and exports lab config', () => {
    const html = labPageHtml('test-lab-id', 'coding', ['openai:gpt-4o', 'anthropic:claude-sonnet-4-6'], 'sys', false, NONCE)
    assert.ok(html.includes('/api/lab/'), 'lab fork/export must use the lab API, not the generic sandbox API')
    assert.ok(html.includes('/fork'))
    assert.ok(html.includes('/export'))
  })

  it('uses no inline event handlers (CSP-safe)', () => {
    assertNoInlineHandlers(labPageHtml('test-lab-id', 'general', ['m'], 's', false, NONCE), 'lab page')
  })

  it('labels every dialog for screen readers', () => {
    assertDialogsLabelled(labPageHtml('test-lab-id', 'general', ['m'], 's', false, NONCE), 'lab page')
  })
})

describe('labsGalleryHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = labsGalleryHtml(NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })

  it('uses no inline event handlers (CSP-safe)', () => {
    assertNoInlineHandlers(labsGalleryHtml(NONCE), 'labs gallery')
  })
})
