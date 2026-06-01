import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseCompleteRequest, parseCreateSandboxRequest, parsePatchSandboxRequest, parsePatchEnvironmentRequest, parsePipelineRequest, parseWebhookUrl, parsePiiScanRequest } from './schema.ts'

// bool() is private — tested indirectly via parsers that use it (zdr, groundingEnabled,
// collectLogPayload, ragEnabled).

describe('parseCompleteRequest — valid input', () => {
  it('accepts prompt-only body', () => {
    const r = parseCompleteRequest({ prompt: 'hello' })
    assert.strictEqual(r.prompt, 'hello')
    assert.strictEqual(r.zdr, false)
    assert.strictEqual(r.groundingEnabled, false)
  })

  it('accepts boolean true for zdr', () => {
    const r = parseCompleteRequest({ prompt: 'x', zdr: true })
    assert.strictEqual(r.zdr, true)
  })

  it('accepts boolean false for zdr', () => {
    const r = parseCompleteRequest({ prompt: 'x', zdr: false })
    assert.strictEqual(r.zdr, false)
  })

  it('defaults zdr to false when absent', () => {
    const r = parseCompleteRequest({ prompt: 'x' })
    assert.strictEqual(r.zdr, false)
  })

  it('accepts boolean true for groundingEnabled', () => {
    const r = parseCompleteRequest({ prompt: 'x', groundingEnabled: true })
    assert.strictEqual(r.groundingEnabled, true)
  })

  it('collectLogPayload true is preserved', () => {
    const r = parseCompleteRequest({ prompt: 'x', collectLogPayload: true })
    assert.strictEqual(r.collectLogPayload, true)
  })

  it('collectLogPayload false is preserved', () => {
    const r = parseCompleteRequest({ prompt: 'x', collectLogPayload: false })
    assert.strictEqual(r.collectLogPayload, false)
  })

  it('collectLogPayload absent → undefined (not false)', () => {
    const r = parseCompleteRequest({ prompt: 'x' })
    assert.strictEqual(r.collectLogPayload, undefined)
  })
})

describe('parseCompleteRequest — bool() type validation', () => {
  it('throws 422-worthy error when zdr is a string', () => {
    assert.throws(
      () => parseCompleteRequest({ prompt: 'x', zdr: 'yes' }),
      /zdr must be a boolean/,
    )
  })

  it('throws when zdr is a number', () => {
    assert.throws(
      () => parseCompleteRequest({ prompt: 'x', zdr: 1 }),
      /zdr must be a boolean/,
    )
  })

  it('throws when groundingEnabled is a string', () => {
    assert.throws(
      () => parseCompleteRequest({ prompt: 'x', groundingEnabled: 'true' }),
      /groundingEnabled must be a boolean/,
    )
  })

  it('throws when collectLogPayload is a number', () => {
    assert.throws(
      () => parseCompleteRequest({ prompt: 'x', collectLogPayload: 0 }),
      /collectLogPayload must be a boolean/,
    )
  })
})

describe('parseCompleteRequest — missing required fields', () => {
  it('throws when neither prompt nor messages provided', () => {
    assert.throws(
      () => parseCompleteRequest({ model: '@cf/meta/llama-3.1-8b-instruct' }),
      /prompt or messages is required/,
    )
  })

  it('throws when body is not an object', () => {
    assert.throws(() => parseCompleteRequest('hello'), /must be a JSON object/)
    assert.throws(() => parseCompleteRequest(null),    /must be a JSON object/)
    assert.throws(() => parseCompleteRequest(42),      /must be a JSON object/)
  })
})

describe('parseCreateSandboxRequest — bool() on ragEnabled', () => {
  const base = {
    name: 'Test', description: 'desc', systemPrompt: 'sp',
    tools: [], model: '@cf/meta/llama-3.1-8b-instruct',
    temperature: 0.7, maxTokens: 1024,
  }

  it('accepts ragEnabled: true', () => {
    const r = parseCreateSandboxRequest({ ...base, ragEnabled: true })
    assert.strictEqual(r.ragEnabled, true)
  })

  it('defaults ragEnabled to false when absent', () => {
    const r = parseCreateSandboxRequest(base)
    assert.strictEqual(r.ragEnabled, false)
  })

  it('throws when ragEnabled is a number', () => {
    assert.throws(
      () => parseCreateSandboxRequest({ ...base, ragEnabled: 1 }),
      /ragEnabled must be a boolean/,
    )
  })

  it('throws when ragEnabled is a string', () => {
    assert.throws(
      () => parseCreateSandboxRequest({ ...base, ragEnabled: 'yes' }),
      /ragEnabled must be a boolean/,
    )
  })
})

describe('parseCreateSandboxRequest — guardOutput / redactPiiOutput', () => {
  const base = {
    name: 'Test', description: 'desc', systemPrompt: 'sp',
    tools: [], model: '@cf/meta/llama-3.1-8b-instruct',
    temperature: 0.7, maxTokens: 1024,
  }

  it('defaults guardOutput to audit and redactPiiOutput to false', () => {
    const r = parseCreateSandboxRequest(base)
    assert.strictEqual(r.guardOutput, 'audit')
    assert.strictEqual(r.redactPiiOutput, false)
  })

  it('accepts a valid guardOutput value', () => {
    const r = parseCreateSandboxRequest({ ...base, guardOutput: 'block' })
    assert.strictEqual(r.guardOutput, 'block')
  })

  it('falls back to audit for an unknown guardOutput value', () => {
    const r = parseCreateSandboxRequest({ ...base, guardOutput: 'nonsense' })
    assert.strictEqual(r.guardOutput, 'audit')
  })
})

describe('parsePatchSandboxRequest — guardOutput validation', () => {
  it('accepts a valid guardOutput', () => {
    const r = parsePatchSandboxRequest({ guardOutput: 'redact' })
    assert.strictEqual(r.guardOutput, 'redact')
  })

  it('throws on an invalid guardOutput', () => {
    assert.throws(
      () => parsePatchSandboxRequest({ guardOutput: 'loud' }),
      /guardOutput must be/,
    )
  })

  it('accepts redactPiiOutput boolean', () => {
    const r = parsePatchSandboxRequest({ redactPiiOutput: true })
    assert.strictEqual(r.redactPiiOutput, true)
  })
})

describe('parsePiiScanRequest', () => {
  it('parses text with default redact=false', () => {
    const r = parsePiiScanRequest({ text: 'hello' })
    assert.strictEqual(r.text, 'hello')
    assert.strictEqual(r.redact, false)
    assert.strictEqual(r.types, undefined)
  })

  it('accepts a valid types filter and redact flag', () => {
    const r = parsePiiScanRequest({ text: 'hi', redact: true, types: ['email', 'ssn'] })
    assert.deepStrictEqual(r.types, ['email', 'ssn'])
    assert.strictEqual(r.redact, true)
  })

  it('throws on an unknown PII type', () => {
    assert.throws(() => parsePiiScanRequest({ text: 'hi', types: ['passport'] }), /unknown PII types/)
  })

  it('throws on empty text', () => {
    assert.throws(() => parsePiiScanRequest({ text: '' }), /non-empty/)
  })
})

describe('parsePatchEnvironmentRequest — valid input', () => {
  it('returns empty object when no fields provided', () => {
    const r = parsePatchEnvironmentRequest({})
    assert.deepStrictEqual(r, {})
  })

  it('accepts systemPrompt', () => {
    const r = parsePatchEnvironmentRequest({ systemPrompt: 'You are helpful.' })
    assert.strictEqual(r.systemPrompt, 'You are helpful.')
  })

  it('accepts temperature within range', () => {
    const r = parsePatchEnvironmentRequest({ temperature: 1.0 })
    assert.strictEqual(r.temperature, 1.0)
  })

  it('accepts maxTokens within range', () => {
    const r = parsePatchEnvironmentRequest({ maxTokens: 2048 })
    assert.strictEqual(r.maxTokens, 2048)
  })

  it('accepts envModels array of strings', () => {
    const r = parsePatchEnvironmentRequest({ envModels: ['openai:gpt-4o', 'anthropic:claude-sonnet-4-6'] })
    assert.deepStrictEqual(r.envModels, ['openai:gpt-4o', 'anthropic:claude-sonnet-4-6'])
  })

  it('accepts all fields together', () => {
    const r = parsePatchEnvironmentRequest({
      systemPrompt: 'Be precise.',
      temperature: 0.3,
      maxTokens: 512,
      envModels: ['openai:gpt-4o'],
    })
    assert.strictEqual(r.systemPrompt, 'Be precise.')
    assert.strictEqual(r.temperature, 0.3)
    assert.strictEqual(r.maxTokens, 512)
    assert.deepStrictEqual(r.envModels, ['openai:gpt-4o'])
  })

  it('omits undefined fields from output', () => {
    const r = parsePatchEnvironmentRequest({ systemPrompt: 'x' })
    assert.strictEqual(r.temperature, undefined)
    assert.strictEqual(r.maxTokens, undefined)
    assert.strictEqual(r.envModels, undefined)
  })
})

describe('parsePatchEnvironmentRequest — invalid input', () => {
  it('throws when body is not an object', () => {
    assert.throws(() => parsePatchEnvironmentRequest(null),    /must be a JSON object/)
    assert.throws(() => parsePatchEnvironmentRequest('hello'), /must be a JSON object/)
    assert.throws(() => parsePatchEnvironmentRequest(42),      /must be a JSON object/)
  })

  it('throws when temperature exceeds maximum (2)', () => {
    assert.throws(() => parsePatchEnvironmentRequest({ temperature: 3 }), /temperature/)
  })

  it('throws when temperature is below minimum (0)', () => {
    assert.throws(() => parsePatchEnvironmentRequest({ temperature: -0.1 }), /temperature/)
  })

  it('throws when maxTokens is below minimum (64)', () => {
    assert.throws(() => parsePatchEnvironmentRequest({ maxTokens: 10 }), /maxTokens/)
  })

  it('throws when maxTokens exceeds maximum (8192)', () => {
    assert.throws(() => parsePatchEnvironmentRequest({ maxTokens: 9000 }), /maxTokens/)
  })

  it('throws when envModels is an empty array', () => {
    assert.throws(
      () => parsePatchEnvironmentRequest({ envModels: [] }),
      /envModels must be an array/,
    )
  })

  it('throws when envModels exceeds MAX_ENV_MODELS (4)', () => {
    assert.throws(
      () => parsePatchEnvironmentRequest({ envModels: ['a', 'b', 'c', 'd', 'e'] }),
      /envModels must be an array/,
    )
  })

  it('throws when envModels contains non-string entries', () => {
    assert.throws(
      () => parsePatchEnvironmentRequest({ envModels: ['valid', 42] }),
      /All envModels entries must be strings/,
    )
  })

  it('throws when envModels is not an array', () => {
    assert.throws(
      () => parsePatchEnvironmentRequest({ envModels: 'single-model' }),
      /envModels must be an array/,
    )
  })
})

describe('parsePipelineRequest — env_resolve node type', () => {
  it('accepts env_resolve as a valid node type', () => {
    const r = parsePipelineRequest({
      input: 'test',
      nodes: [{ id: 'n1', type: 'env_resolve', envId: '11111111-1111-1111-1111-111111111111' }],
      entryId: 'n1',
    })
    assert.strictEqual(r.nodes[0].type, 'env_resolve')
    assert.strictEqual(r.nodes[0].envId, '11111111-1111-1111-1111-111111111111')
  })

  it('accepts env_resolve without envId (optional field)', () => {
    const r = parsePipelineRequest({
      input: 'test',
      nodes: [{ id: 'n1', type: 'env_resolve' }],
      entryId: 'n1',
    })
    assert.strictEqual(r.nodes[0].type, 'env_resolve')
    assert.strictEqual(r.nodes[0].envId, undefined)
  })

  it('rejects unknown node type', () => {
    assert.throws(
      () => parsePipelineRequest({
        input: 'test',
        nodes: [{ id: 'n1', type: 'unknown_type', prompt: 'do something' }],
        entryId: 'n1',
      }),
      /must be one of/,
    )
  })

  it('accepts all six valid node types', () => {
    for (const type of ['complete', 'classify', 'guard', 'transform', 'parallel', 'env_resolve']) {
      const r = parsePipelineRequest({
        input: 'test',
        nodes: [{ id: 'n1', type, prompt: type === 'env_resolve' ? undefined : 'do something' }],
        entryId: 'n1',
      })
      assert.strictEqual(r.nodes[0].type, type)
    }
  })
})

// parseWebhookUrl exercises the SSRF guard (isPrivateIp / isPrivateIpv4) indirectly.
describe('parseWebhookUrl — valid public URLs', () => {
  it('accepts a public https URL', () => {
    assert.strictEqual(parseWebhookUrl('https://hooks.example.com/abc'), 'https://hooks.example.com/abc')
  })

  it('accepts a public IPv4 literal', () => {
    assert.strictEqual(parseWebhookUrl('https://8.8.8.8/notify'), 'https://8.8.8.8/notify')
  })

  it('accepts a public IPv6 literal', () => {
    assert.strictEqual(parseWebhookUrl('https://[2606:4700::1111]/notify'), 'https://[2606:4700::1111]/notify')
  })

  it('returns undefined for empty / null / undefined', () => {
    assert.strictEqual(parseWebhookUrl(''), undefined)
    assert.strictEqual(parseWebhookUrl(null), undefined)
    assert.strictEqual(parseWebhookUrl(undefined), undefined)
  })
})

describe('parseWebhookUrl — rejected (SSRF / scheme)', () => {
  const rejects = (v: unknown) => assert.throws(() => parseWebhookUrl(v))

  it('rejects non-https schemes', () => {
    rejects('http://example.com')
    rejects('ftp://example.com')
  })

  it('rejects localhost and loopback hostnames', () => {
    rejects('https://localhost/x')
    rejects('https://127.0.0.1/x')
    rejects('https://[::1]/x')
  })

  it('rejects internal hostname suffixes', () => {
    rejects('https://db.internal/x')
    rejects('https://svc.local/x')
  })

  it('rejects private IPv4 ranges', () => {
    rejects('https://10.0.0.5/x')
    rejects('https://172.16.4.4/x')
    rejects('https://192.168.1.1/x')
    rejects('https://169.254.169.254/x')   // link-local / cloud metadata
  })

  it('rejects private IPv6 ranges', () => {
    rejects('https://[fc00::1]/x')   // unique-local
    rejects('https://[fd12:3456::1]/x')
    rejects('https://[fe80::1]/x')   // link-local
  })

  it('rejects IPv4-mapped IPv6 pointing at a private address', () => {
    rejects('https://[::ffff:192.168.1.1]/x')
  })

  it('rejects a non-string value', () => {
    rejects(42)
    rejects({})
  })
})
