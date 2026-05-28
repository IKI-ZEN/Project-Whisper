/**
 * Cloudflare AI Gateway feature probe
 *
 * Empirically tests gateway capabilities by making real requests and
 * inspecting response headers, status codes, and body shapes.
 *
 * Run:
 *   node --experimental-strip-types scripts/probe-gateway.ts
 *
 * Prerequisites — set in .dev.vars or export before running:
 *   CLOUDFLARE_ACCOUNT_ID=
 *   AI_GATEWAY_ID=
 *   ANTHROPIC_API_KEY=      (used for most tests — cheapest model: claude-haiku)
 *   OPENAI_API_KEY=         (needed for universal-endpoint fallback test)
 */

// ── Config ────────────────────────────────────────────────────────────────────

const ACCOUNT_ID  = process.env.CLOUDFLARE_ACCOUNT_ID ?? ''
const GATEWAY_ID  = process.env.AI_GATEWAY_ID         ?? ''
const ANTHROPIC   = process.env.ANTHROPIC_API_KEY     ?? ''
const OPENAI      = process.env.OPENAI_API_KEY        ?? ''

if (!ACCOUNT_ID || !GATEWAY_ID || !ANTHROPIC) {
  console.error('Missing env vars. Set CLOUDFLARE_ACCOUNT_ID, AI_GATEWAY_ID, ANTHROPIC_API_KEY.')
  process.exit(1)
}

const GW_BASE = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`

// Tiny prompt — minimise token cost for every probe
const MINI_BODY = {
  model:      'claude-haiku-4-5-20251001',
  messages:   [{ role: 'user', content: 'Say "ok" and nothing else.' }],
  max_tokens: 8,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(label: string, detail = '') {
  console.log(`  ✓  ${label}${detail ? `  →  ${detail}` : ''}`)
}
function fail(label: string, detail = '') {
  console.log(`  ✗  ${label}${detail ? `  →  ${detail}` : ''}`)
}
function info(label: string, detail = '') {
  console.log(`  ·  ${label}${detail ? `  :  ${detail}` : ''}`)
}
function section(title: string) {
  console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`)
}

function hdrs(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type':      'application/json',
    'x-api-key':         ANTHROPIC,
    'anthropic-version': '2023-06-01',
    ...extra,
  }
}

async function anthropic(
  extra: Record<string, string> = {},
  bodyOverride?: Record<string, unknown>,
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${GW_BASE}/anthropic/v1/messages`, {
    method:  'POST',
    headers: hdrs(extra),
    body:    JSON.stringify(bodyOverride ?? MINI_BODY),
  })
  let body: unknown
  try { body = await res.json() } catch { body = await res.text() }
  return { status: res.status, headers: res.headers, body }
}

function dumpHeaders(headers: Headers, prefix: string[] = ['cf-', 'x-']) {
  for (const [k, v] of headers) {
    if (prefix.some(p => k.startsWith(p))) {
      info(`  ${k}`, v.length > 120 ? v.slice(0, 120) + '…' : v)
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function testBaseRequest() {
  section('1. Base request — discover response headers')
  const { status, headers, body } = await anthropic()
  if (status === 200) {
    pass('200 OK')
  } else {
    fail(`Unexpected status ${status}`, JSON.stringify(body).slice(0, 200))
    return
  }
  console.log('  All gateway/CF headers on a normal response:')
  dumpHeaders(headers, ['cf-', 'x-ratelimit', 'x-request-id'])
  // Check for known interesting headers
  const cacheStatus = headers.get('cf-aig-cache-status') ?? headers.get('cf-cache-status')
  const requestId   = headers.get('cf-aig-request-id') ?? headers.get('x-request-id')
  const logId       = headers.get('cf-aig-log-id')
  if (cacheStatus) info('cache-status header', cacheStatus)
  if (requestId)   info('request-id header',   requestId)
  if (logId)       info('log-id header',        logId)
}

async function testCaching() {
  section('2. Caching — cf-aig-cache-ttl / cf-aig-skip-cache / cf-aig-cache-key')

  // Deterministic prompt so cache can match
  const cached = {
    model:    'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: '__probe_cache_test_abc123__' }],
    max_tokens: 8,
    temperature: 0,
  }

  // First request — should MISS
  const r1 = await anthropic({ 'cf-aig-cache-ttl': '300', 'cf-aig-skip-cache': 'false' }, cached)
  const s1 = r1.headers.get('cf-aig-cache-status') ?? r1.headers.get('cf-cache-status') ?? 'none'
  info('1st request cache-status', s1)

  // Second request — should HIT if caching works
  const r2 = await anthropic({ 'cf-aig-cache-ttl': '300', 'cf-aig-skip-cache': 'false' }, cached)
  const s2 = r2.headers.get('cf-aig-cache-status') ?? r2.headers.get('cf-cache-status') ?? 'none'
  info('2nd request cache-status', s2)

  if (s2 === 'HIT' || s2 === 'hit') {
    pass('Cache HIT confirmed on second identical request')
  } else {
    info('No cache HIT detected — cache may need temperature=0 or exact body match', s2)
  }

  // Skip cache header
  const r3 = await anthropic({ 'cf-aig-cache-ttl': '300', 'cf-aig-skip-cache': 'true' }, cached)
  const s3 = r3.headers.get('cf-aig-cache-status') ?? r3.headers.get('cf-cache-status') ?? 'none'
  if (s3 === 'SKIP' || s3 === 'skip' || s3 === 'BYPASS') {
    pass('cf-aig-skip-cache:true → cache bypassed', s3)
  } else {
    info('cf-aig-skip-cache:true response cache-status', s3)
  }

  // Custom cache key
  const r4 = await anthropic({ 'cf-aig-cache-ttl': '60', 'cf-aig-cache-key': 'probe-custom-key-xyz' }, cached)
  const s4 = r4.headers.get('cf-aig-cache-status') ?? 'none'
  info('cf-aig-cache-key custom key result', s4)
  if (r4.status === 200) { pass('cf-aig-cache-key accepted (no error)') } else { fail('cf-aig-cache-key rejected', String(r4.status)) }
}

async function testMetadata() {
  section('3. Metadata — cf-aig-metadata')
  const meta = JSON.stringify({ sandboxId: 'probe-test', model: 'claude-haiku-4-5-20251001', env: 'probe' })
  const { status, headers } = await anthropic({ 'cf-aig-metadata': meta })
  if (status === 200) {
    pass('cf-aig-metadata accepted without error')
  } else {
    fail('cf-aig-metadata caused error', String(status))
  }
  // Check if gateway echoes metadata back in any header
  for (const [k, v] of headers) {
    if (k.includes('metadata')) info(`metadata echo header: ${k}`, v.slice(0, 120))
  }
}

async function testCollectLog() {
  section('4. Per-request logging — cf-aig-collect-log')
  const r1 = await anthropic({ 'cf-aig-collect-log': 'true' })
  if (r1.status === 200) {
    pass('cf-aig-collect-log:true accepted')
  } else {
    fail('cf-aig-collect-log:true rejected', String(r1.status))
  }
  const r2 = await anthropic({ 'cf-aig-collect-log': 'false' })
  if (r2.status === 200) {
    pass('cf-aig-collect-log:false accepted (log suppressed)')
  } else {
    fail('cf-aig-collect-log:false rejected', String(r2.status))
  }
}

async function testRateLimit() {
  section('5. Rate limit headers')
  const { headers } = await anthropic()
  const rlLimit     = headers.get('x-ratelimit-limit-requests') ?? headers.get('ratelimit-limit')
  const rlRemaining = headers.get('x-ratelimit-remaining-requests') ?? headers.get('ratelimit-remaining')
  const rlReset     = headers.get('x-ratelimit-reset-requests') ?? headers.get('ratelimit-reset')
  if (rlLimit)     info('rate limit header',     rlLimit)
  if (rlRemaining) info('remaining header',       rlRemaining)
  if (rlReset)     info('reset header',           rlReset)
  if (!rlLimit && !rlRemaining) info('No rate limit headers detected (may be dashboard-configured only)')
}

async function testUniversalEndpoint() {
  section('6. Universal Endpoint — multi-provider fallback routing')
  // Universal endpoint uses the gateway base URL directly (no provider suffix)
  // Body is an array of provider configs; gateway tries them in order
  const universalBody = [
    {
      provider: 'anthropic',
      endpoint: 'messages',
      headers: {
        'x-api-key':         ANTHROPIC,
        'anthropic-version': '2023-06-01',
      },
      query: MINI_BODY,
    },
    // Fallback: only reached if Anthropic fails
    ...(OPENAI ? [{
      provider: 'openai',
      endpoint: 'chat/completions',
      headers: { Authorization: `Bearer ${OPENAI}` },
      query: {
        model:    'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        max_tokens: 8,
      },
    }] : []),
  ]
  const res = await fetch(GW_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(universalBody),
  })
  let body: unknown
  try { body = await res.json() } catch { body = await res.text() }
  if (res.status === 200) {
    pass('Universal endpoint accepted array body')
    const providerUsed = res.headers.get('cf-aig-provider') ?? res.headers.get('cf-aig-used-provider')
    if (providerUsed) info('provider used', providerUsed)
    dumpHeaders(res.headers, ['cf-aig-'])
  } else {
    fail(`Universal endpoint returned ${res.status}`, JSON.stringify(body).slice(0, 300))
  }
}

async function testFallbackWithBadKey() {
  section('7. Universal Endpoint fallback — bad primary key forces fallback')
  if (!OPENAI) {
    info('OPENAI_API_KEY not set — skipping fallback test')
    return
  }
  const universalBody = [
    {
      provider: 'anthropic',
      endpoint: 'messages',
      headers: {
        'x-api-key':         'invalid-key-intentionally-wrong',
        'anthropic-version': '2023-06-01',
      },
      query: MINI_BODY,
    },
    {
      provider: 'openai',
      endpoint: 'chat/completions',
      headers: { Authorization: `Bearer ${OPENAI}` },
      query: {
        model:    'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        max_tokens: 8,
      },
    },
  ]
  const res = await fetch(GW_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(universalBody),
  })
  let body: unknown
  try { body = await res.json() } catch { body = await res.text() }
  if (res.status === 200) {
    pass('Gateway fell back to OpenAI when Anthropic key was invalid')
    const providerUsed = res.headers.get('cf-aig-provider') ?? res.headers.get('cf-aig-used-provider')
    if (providerUsed) info('fallback provider used', providerUsed)
  } else {
    fail(`No fallback — both providers failed or universal routing not working`, JSON.stringify(body).slice(0, 300))
  }
}

async function testPromptCaching() {
  section('8. Anthropic prompt caching — cache_control ephemeral')
  const body = {
    model:    'claude-haiku-4-5-20251001',
    system:   [{ type: 'text', text: 'You are a helpful assistant. ' + 'x'.repeat(1200), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'Say "ok".' }],
    max_tokens: 8,
  }
  const r1 = await fetch(`${GW_BASE}/anthropic/v1/messages`, {
    method:  'POST',
    headers: hdrs({ 'anthropic-beta': 'prompt-caching-2024-07-31' }),
    body:    JSON.stringify(body),
  })
  const d1 = await r1.json() as Record<string, unknown>
  if (r1.status === 200) {
    const usage = d1.usage as Record<string, number> | undefined
    if (usage?.cache_creation_input_tokens) {
      pass(`Prompt cache write confirmed: ${usage.cache_creation_input_tokens} tokens cached`)
    } else if (usage?.cache_read_input_tokens) {
      pass(`Prompt cache read confirmed: ${usage.cache_read_input_tokens} tokens from cache`)
    } else {
      info('Response OK but no cache_*_input_tokens in usage', JSON.stringify(usage))
    }
  } else {
    fail(`Status ${r1.status}`, JSON.stringify(d1).slice(0, 200))
  }

  // Second request — should read from cache
  const r2 = await fetch(`${GW_BASE}/anthropic/v1/messages`, {
    method:  'POST',
    headers: hdrs({ 'anthropic-beta': 'prompt-caching-2024-07-31' }),
    body:    JSON.stringify(body),
  })
  const d2 = await r2.json() as Record<string, unknown>
  if (r2.status === 200) {
    const usage = d2.usage as Record<string, number> | undefined
    if (usage?.cache_read_input_tokens) {
      pass(`2nd request: cache READ confirmed: ${usage.cache_read_input_tokens} tokens saved`)
    } else {
      info('2nd request: no cache_read_input_tokens', JSON.stringify(usage))
    }
  }
}

async function testGatewayLogsApi() {
  section('9. Gateway Logs REST API')
  // https://api.cloudflare.com/client/v4/accounts/{id}/ai-gateway/gateways/{gw}/logs
  const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? ''
  if (!CLOUDFLARE_API_TOKEN) {
    info('CLOUDFLARE_API_TOKEN not set — skipping logs API test')
    info('Set it to a token with AI Gateway:Read permission to probe the logs endpoint')
    return
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-gateway/gateways/${GATEWAY_ID}/logs?limit=5`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  })
  const data = await res.json() as Record<string, unknown>
  if (res.status === 200) {
    const logs = (data.result as unknown[]) ?? []
    pass(`Logs API works — ${logs.length} recent entries returned`)
    if (logs.length > 0) {
      const first = logs[0] as Record<string, unknown>
      info('Sample log fields', Object.keys(first).join(', '))
    }
  } else {
    fail(`Logs API returned ${res.status}`, JSON.stringify(data).slice(0, 200))
  }
}

async function testStreamingHeaders() {
  section('10. Streaming — SSE response headers')
  const body = { ...MINI_BODY, stream: true }
  const res = await fetch(`${GW_BASE}/anthropic/v1/messages`, {
    method:  'POST',
    headers: hdrs(),
    body:    JSON.stringify(body),
  })
  if (res.status === 200) {
    pass('Streaming (stream:true) accepted')
    const ct = res.headers.get('content-type') ?? ''
    info('Content-Type', ct)
    dumpHeaders(res.headers, ['cf-aig-'])
    // Read just the first chunk to confirm SSE format
    const reader = res.body?.getReader()
    if (reader) {
      const { value } = await reader.read()
      if (value) {
        const text = new TextDecoder().decode(value)
        info('First SSE chunk', text.slice(0, 120).replace(/\n/g, '↵'))
      }
      await reader.cancel()
    }
  } else {
    fail(`Stream request rejected with status ${res.status}`)
  }
}

async function testGatewayAuthToken() {
  section('11. Gateway authentication — cf-aig-token')
  // If the gateway has token auth enabled, requests without the token should fail.
  // If not configured, the header should be ignored harmlessly.
  const r1 = await anthropic({ 'cf-aig-token': 'probe-dummy-token-that-doesnt-exist' })
  if (r1.status === 401 || r1.status === 403) {
    info('Gateway has token auth configured — invalid token rejected', String(r1.status))
  } else if (r1.status === 200) {
    info('cf-aig-token header present but gateway auth not enforced (token ignored)')
  } else {
    info('Unexpected status with cf-aig-token', String(r1.status))
  }
}

// ── Run all probes ────────────────────────────────────────────────────────────

async function main() {
  console.log('Cloudflare AI Gateway Feature Probe')
  console.log(`Gateway: ${GW_BASE}`)
  console.log(`Date:    ${new Date().toISOString()}`)

  try { await testBaseRequest() }      catch (e) { console.error('probe 1 error:', e) }
  try { await testCaching() }          catch (e) { console.error('probe 2 error:', e) }
  try { await testMetadata() }         catch (e) { console.error('probe 3 error:', e) }
  try { await testCollectLog() }       catch (e) { console.error('probe 4 error:', e) }
  try { await testRateLimit() }        catch (e) { console.error('probe 5 error:', e) }
  try { await testUniversalEndpoint() } catch (e) { console.error('probe 6 error:', e) }
  try { await testFallbackWithBadKey() } catch (e) { console.error('probe 7 error:', e) }
  try { await testPromptCaching() }    catch (e) { console.error('probe 8 error:', e) }
  try { await testGatewayLogsApi() }   catch (e) { console.error('probe 9 error:', e) }
  try { await testStreamingHeaders() } catch (e) { console.error('probe 10 error:', e) }
  try { await testGatewayAuthToken() } catch (e) { console.error('probe 11 error:', e) }

  console.log('\nDone.\n')
}

main()
