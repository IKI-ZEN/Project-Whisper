import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, checkRateLimit } from '../lib/http'
import { complete, embed, cosineSimilarity } from '../lib/ai'
import { scan } from '../lib/guard'
import { newId, isUUID } from '../lib/utils'
import { resolveAnalysisContext } from '../lib/analysis'
import { RATE_LIMIT_WINDOW_MS, SUITE_RUN_RATE_LIMIT_MAX, MAX_ASSERTION_REGEX_INPUT } from '../lib/constants'

// ── Types ─────────────────────────────────────────────────────────────────────

type Assertion =
  | { type: 'contains'; value: string }
  | { type: 'not-contains'; value: string }
  | { type: 'matches'; pattern: string }
  | { type: 'similarity-gte'; threshold: number; reference: string }
  | { type: 'judge'; criteria: string }
  | { type: 'latency-lte'; maxMs: number }
  | { type: 'guard-clean' }

interface TestCase {
  prompt: string
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  assertions: Assertion[]
}

interface Suite {
  id: string
  name: string
  description: string
  cases: TestCase[]
  created_at: number
  updated_at: number
}

interface AssertionResult {
  type: string
  passed: boolean
  detail?: string
}

interface CaseRunResult {
  caseIndex: number
  prompt: string
  response: string
  latencyMs: number
  assertions: AssertionResult[]
  passed: boolean
}

// ── D1 row type ───────────────────────────────────────────────────────────────

interface SuiteRow {
  id: string
  name: string
  description: string
  cases: string
  sandbox_id: string | null
  created_at: number
  updated_at: number
}

// ── Validation ────────────────────────────────────────────────────────────────

function parseAssertion(a: unknown): Assertion {
  if (typeof a !== 'object' || a === null) throw new Error('Assertion must be an object')
  const obj = a as Record<string, unknown>
  const type = obj.type
  if (type === 'contains') {
    if (typeof obj.value !== 'string') throw new Error('contains assertion requires string value')
    return { type: 'contains', value: obj.value }
  }
  if (type === 'not-contains') {
    if (typeof obj.value !== 'string') throw new Error('not-contains assertion requires string value')
    return { type: 'not-contains', value: obj.value }
  }
  if (type === 'matches') {
    if (typeof obj.pattern !== 'string') throw new Error('matches assertion requires string pattern')
    return { type: 'matches', pattern: obj.pattern }
  }
  if (type === 'similarity-gte') {
    if (typeof obj.threshold !== 'number') throw new Error('similarity-gte assertion requires numeric threshold')
    if (typeof obj.reference !== 'string') throw new Error('similarity-gte assertion requires string reference')
    return { type: 'similarity-gte', threshold: obj.threshold, reference: obj.reference }
  }
  if (type === 'judge') {
    if (typeof obj.criteria !== 'string') throw new Error('judge assertion requires string criteria')
    return { type: 'judge', criteria: obj.criteria }
  }
  if (type === 'latency-lte') {
    if (typeof obj.maxMs !== 'number') throw new Error('latency-lte assertion requires numeric maxMs')
    return { type: 'latency-lte', maxMs: obj.maxMs }
  }
  if (type === 'guard-clean') {
    return { type: 'guard-clean' }
  }
  throw new Error(`Unknown assertion type: ${String(type)}`)
}

function parseTestCase(c: unknown): TestCase {
  if (typeof c !== 'object' || c === null) throw new Error('Test case must be an object')
  const obj = c as Record<string, unknown>
  if (typeof obj.prompt !== 'string' || !obj.prompt) throw new Error('Test case requires string prompt')
  if (!Array.isArray(obj.assertions)) throw new Error('Test case requires assertions array')
  if (obj.assertions.length > 10) throw new Error('Test case may have at most 10 assertions')
  return {
    prompt:       typeof obj.prompt === 'string' ? obj.prompt : '',
    model:        typeof obj.model === 'string' ? obj.model : undefined,
    systemPrompt: typeof obj.systemPrompt === 'string' ? obj.systemPrompt : undefined,
    temperature:  typeof obj.temperature === 'number' ? obj.temperature : undefined,
    maxTokens:    typeof obj.maxTokens === 'number' ? obj.maxTokens : undefined,
    assertions:   obj.assertions.map(parseAssertion),
  }
}

function parseSuiteBody(body: unknown): { name: string; description: string; cases: TestCase[]; sandboxId: string | null } {
  if (typeof body !== 'object' || body === null) throw new Error('Request body must be an object')
  const b = body as Record<string, unknown>
  if (typeof b.name !== 'string' || !b.name) throw new Error('name is required')
  if (b.name.length > 128) throw new Error('name must be at most 128 characters')
  const description = typeof b.description === 'string' ? b.description : ''
  if (description.length > 512) throw new Error('description must be at most 512 characters')
  if (!Array.isArray(b.cases)) throw new Error('cases must be an array')
  if (b.cases.length > 50) throw new Error('cases may have at most 50 items')
  const sandboxId = typeof b.sandboxId === 'string' && isUUID(b.sandboxId)
    ? b.sandboxId : null
  return {
    name: b.name,
    description,
    cases: b.cases.map(parseTestCase),
    sandboxId,
  }
}

function parsePatchBody(body: unknown): { name?: string; description?: string; cases?: TestCase[] } {
  if (typeof body !== 'object' || body === null) throw new Error('Request body must be an object')
  const b = body as Record<string, unknown>
  const patch: { name?: string; description?: string; cases?: TestCase[] } = {}
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name) throw new Error('name must be a non-empty string')
    if (b.name.length > 128) throw new Error('name must be at most 128 characters')
    patch.name = b.name
  }
  if (b.description !== undefined) {
    if (typeof b.description !== 'string') throw new Error('description must be a string')
    if (b.description.length > 512) throw new Error('description must be at most 512 characters')
    patch.description = b.description
  }
  if (b.cases !== undefined) {
    if (!Array.isArray(b.cases)) throw new Error('cases must be an array')
    if (b.cases.length > 50) throw new Error('cases may have at most 50 items')
    patch.cases = b.cases.map(parseTestCase)
  }
  return patch
}

// ── Assertion evaluation ──────────────────────────────────────────────────────

async function evaluateAssertion(
  assertion: Assertion,
  response: string,
  latencyMs: number,
  env: Parameters<Handler>[1],
): Promise<AssertionResult> {
  switch (assertion.type) {
    case 'contains': {
      const passed = response.includes(assertion.value)
      return {
        type: 'contains',
        passed,
        detail: passed ? `Found "${assertion.value}"` : `"${assertion.value}" not found in response`,
      }
    }

    case 'not-contains': {
      const passed = !response.includes(assertion.value)
      return {
        type: 'not-contains',
        passed,
        detail: passed ? `"${assertion.value}" correctly absent` : `"${assertion.value}" found in response`,
      }
    }

    case 'matches': {
      try {
        const re = new RegExp(assertion.pattern)
        const passed = re.test(response.slice(0, MAX_ASSERTION_REGEX_INPUT))
        return {
          type: 'matches',
          passed,
          detail: passed ? `Pattern /${assertion.pattern}/ matched` : `Pattern /${assertion.pattern}/ did not match`,
        }
      } catch (e) {
        return { type: 'matches', passed: false, detail: `Invalid regex: ${String(e)}` }
      }
    }

    case 'similarity-gte': {
      try {
        const embeddings = await embed(env.AI, [response, assertion.reference])
        if (!embeddings[0] || !embeddings[1]) {
          return { type: 'similarity-gte', passed: false, detail: 'Could not compute embeddings' }
        }
        const sim = cosineSimilarity(embeddings[0], embeddings[1])
        const passed = sim >= assertion.threshold
        return {
          type: 'similarity-gte',
          passed,
          detail: `Similarity ${sim.toFixed(4)} ${passed ? '>=' : '<'} threshold ${assertion.threshold}`,
        }
      } catch (e) {
        return { type: 'similarity-gte', passed: false, detail: `Embedding error: ${String(e)}` }
      }
    }

    case 'judge': {
      try {
        const judgeResponse = await complete(env.AI, env, {
          model: '@cf/meta/llama-3.1-8b-instruct',
          prompt: `Does the following AI response satisfy the criterion?\nCriterion: ${assertion.criteria}\nResponse: ${response}\nAnswer PASS or FAIL only (first word).`,
          maxTokens: 10,
        })
        const firstWord = judgeResponse.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
        const passed = firstWord === 'PASS'
        return {
          type: 'judge',
          passed,
          detail: `Judge answered: ${judgeResponse.trim()}`,
        }
      } catch (e) {
        return { type: 'judge', passed: false, detail: `Judge error: ${String(e)}` }
      }
    }

    case 'latency-lte': {
      const passed = latencyMs <= assertion.maxMs
      return {
        type: 'latency-lte',
        passed,
        detail: `Latency ${latencyMs}ms ${passed ? '<=' : '>'} max ${assertion.maxMs}ms`,
      }
    }

    case 'guard-clean': {
      const { riskLevel } = scan(response)
      const passed = riskLevel === 'clean'
      return {
        type: 'guard-clean',
        passed,
        detail: `Guard risk level: ${riskLevel}`,
      }
    }
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

const createSuite: Handler = async (req, env) => {
  const p = await parseBody(req, parseSuiteBody)
  if (!p.ok) return p.response

  try {
    const { name, description, cases, sandboxId } = p.data
    const id = newId()
    const now = Date.now()

    await env.DB.prepare(
      'INSERT INTO assertion_suites (id, name, description, cases, sandbox_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, name, description, JSON.stringify(cases), sandboxId ?? null, now, now).run()

    const suite: Suite & { sandbox_id: string | null } = { id, name, description, cases, sandbox_id: sandboxId ?? null, created_at: now, updated_at: now }
    return json(ok(suite))
  } catch (e) {
    return json(err('Failed to create assertion suite', String(e)), 500)
  }
}

const listSuites: Handler = async (req, env) => {
  const url       = new URL(req.url)
  const sandboxId = url.searchParams.get('sandboxId') ?? null
  try {
    const base = 'SELECT id, name, description, sandbox_id, json_array_length(cases) as case_count, created_at, updated_at FROM assertion_suites'
    const result = sandboxId
      ? await env.DB.prepare(`${base} WHERE sandbox_id = ? ORDER BY created_at DESC LIMIT 100`).bind(sandboxId).all()
      : await env.DB.prepare(`${base} ORDER BY created_at DESC LIMIT 100`).all()
    return json(ok(result.results ?? []))
  } catch (e) {
    return json(err('Failed to list assertion suites', String(e)), 500)
  }
}

const getSuite: Handler = async (_req, env, params) => {
  try {
    const row = await env.DB.prepare(
      'SELECT id, name, description, cases, created_at, updated_at FROM assertion_suites WHERE id = ?',
    ).bind(params.id).first<SuiteRow>()

    if (!row) return json(err('Suite not found'), 404)

    let cases: TestCase[]
    try { cases = JSON.parse(row.cases) as TestCase[] } catch { return json(err('Suite data corrupted'), 500) }

    const suite: Suite = {
      id: row.id,
      name: row.name,
      description: row.description,
      cases,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
    return json(ok(suite))
  } catch (e) {
    return json(err('Failed to get assertion suite', String(e)), 500)
  }
}

const patchSuite: Handler = async (req, env, params) => {
  const p = await parseBody(req, parsePatchBody)
  if (!p.ok) return p.response

  try {
    const existing = await env.DB.prepare(
      'SELECT id, name, description, cases, created_at, updated_at FROM assertion_suites WHERE id = ?',
    ).bind(params.id).first<SuiteRow>()

    if (!existing) return json(err('Suite not found'), 404)

    const patch = p.data
    const now = Date.now()
    const newName = patch.name ?? existing.name
    const newDescription = patch.description ?? existing.description
    const newCases = patch.cases !== undefined ? JSON.stringify(patch.cases) : existing.cases

    await env.DB.prepare(
      'UPDATE assertion_suites SET name = ?, description = ?, cases = ?, updated_at = ? WHERE id = ?',
    ).bind(newName, newDescription, newCases, now, params.id).run()

    let patchedCases: TestCase[]
    try { patchedCases = JSON.parse(newCases) as TestCase[] } catch { return json(err('Suite data corrupted'), 500) }

    const suite: Suite = {
      id: existing.id,
      name: newName,
      description: newDescription,
      cases: patchedCases,
      created_at: existing.created_at,
      updated_at: now,
    }
    return json(ok(suite))
  } catch (e) {
    return json(err('Failed to update assertion suite', String(e)), 500)
  }
}

const deleteSuite: Handler = async (_req, env, params) => {
  try {
    const existing = await env.DB.prepare(
      'SELECT id FROM assertion_suites WHERE id = ?',
    ).bind(params.id).first<{ id: string }>()

    if (!existing) return json(err('Suite not found'), 404)

    await env.DB.prepare('DELETE FROM assertion_suites WHERE id = ?').bind(params.id).run()
    return json(ok({ deleted: true }))
  } catch (e) {
    return json(err('Failed to delete assertion suite', String(e)), 500)
  }
}

const runSuite: Handler = async (req, env: Env, params) => {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  const rl = await checkRateLimit(`rl:suite-run:${ip}`, SUITE_RUN_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS, env)
  if (rl) return rl
  try {
    const row = await env.DB.prepare(
      'SELECT id, name, description, cases, sandbox_id, created_at, updated_at FROM assertion_suites WHERE id = ?',
    ).bind(params.id).first<SuiteRow>()

    if (!row) return json(err('Suite not found'), 404)

    // Resolve sandbox defaults: test cases that don't specify their own model/systemPrompt
    // will use the sandbox's config, making this suite a contract test for a specific app.
    let sandboxModel: string | undefined
    let sandboxSystemPrompt: string | undefined
    if (row.sandbox_id) {
      const ctx = await resolveAnalysisContext(row.sandbox_id, env)
      if (ctx.model)        sandboxModel        = ctx.model
      if (ctx.systemPrompt) sandboxSystemPrompt = ctx.systemPrompt
    }

    let cases: TestCase[]
    try { cases = JSON.parse(row.cases) as TestCase[] } catch { return json(err('Suite data corrupted'), 500) }
    const runResults: CaseRunResult[] = []

    for (let i = 0; i < cases.length; i++) {
      const tc = cases[i]
      const turnStart = Date.now()

      const response = await complete(env.AI, env, {
        model:        tc.model        ?? sandboxModel,
        prompt:       tc.prompt,
        systemPrompt: tc.systemPrompt ?? sandboxSystemPrompt,
        temperature:  tc.temperature,
        maxTokens:    tc.maxTokens,
      })

      const latencyMs = Date.now() - turnStart

      const assertionResults: AssertionResult[] = []
      for (const assertion of tc.assertions) {
        const result = await evaluateAssertion(assertion, response, latencyMs, env)
        assertionResults.push(result)
      }

      const allPassed = assertionResults.every(a => a.passed)
      runResults.push({
        caseIndex: i,
        prompt: tc.prompt,
        response,
        latencyMs,
        assertions: assertionResults,
        passed: allPassed,
      })
    }

    const totalCases = runResults.length
    const passed = runResults.filter(r => r.passed).length
    const failed = totalCases - passed
    const runId = newId()

    await env.DB.prepare(
      'INSERT INTO assertion_runs (id, suite_id, ran_at, total_cases, passed, failed, results) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(runId, row.id, Date.now(), totalCases, passed, failed, JSON.stringify(runResults)).run()

    return json(ok({
      runId,
      total_cases: totalCases,
      passed,
      failed,
      passRate: totalCases > 0 ? passed / totalCases : 0,
      results: runResults,
    }))
  } catch (e) {
    return json(err('Failed to run assertion suite', String(e)), 500)
  }
}

const getSuiteHistory: Handler = async (_req, env, params) => {
  try {
    const result = await env.DB.prepare(
      'SELECT id, ran_at, total_cases, passed, failed FROM assertion_runs WHERE suite_id = ? ORDER BY ran_at DESC LIMIT 20',
    ).bind(params.id).all<{ id: string; ran_at: number; total_cases: number; passed: number; failed: number }>()

    const runs = (result.results ?? []).map(r => ({
      ...r,
      pass_rate: r.total_cases > 0 ? r.passed / r.total_cases : 0,
    }))

    return json(ok(runs))
  } catch (e) {
    return json(err('Failed to get suite history', String(e)), 500)
  }
}

// ── Route table ───────────────────────────────────────────────────────────────

export const assertionRoutes: Array<[string, string, Handler]> = [
  ['POST',   '/api/assertions',          createSuite],
  ['GET',    '/api/assertions',          listSuites],
  ['GET',    '/api/assertions/:id',      getSuite],
  ['PATCH',  '/api/assertions/:id',      patchSuite],
  ['DELETE', '/api/assertions/:id',      deleteSuite],
  ['POST',   '/api/assertions/:id/run',  runSuite],
  ['GET',    '/api/assertions/:id/history', getSuiteHistory],
]
