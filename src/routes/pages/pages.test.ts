import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { appPageHtml } from './appPage'
import { appsGalleryHtml } from './appsGallery'
import { chatPageHtml } from './chatPage'
import { dashboardHtml } from './dashboard'
import { envPageHtml } from './envPage'
import { envsGalleryHtml } from './envsGallery'

const NONCE = 'test-nonce-abc123'

describe('appPageHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = appPageHtml('test-sandbox-id', NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })
})

describe('appsGalleryHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = appsGalleryHtml(NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
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
})

describe('envsGalleryHtml', () => {
  it('returns non-empty HTML string containing DOCTYPE and nonce', () => {
    const html = envsGalleryHtml(NONCE)
    assert.ok(html.length > 0)
    assert.ok(html.includes('<!DOCTYPE html>'))
    assert.ok(html.includes(NONCE))
  })
})
