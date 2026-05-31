import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody, readJson, rateLimitByIp } from '../lib/http'
import { saveToVault } from '../lib/analysis'
import { isUUID, now } from '../lib/utils'
import {
  parseSensitivityRequest, parseClusterRequest, parseCotRequest,
  parseEntropyRequest, parseArchaeologyRequest, parsePipelineRequest, parseThinkRequest,
  parseGuardProbeRequest, parseConsistencyRequest, parseAblationRequest, parseDriftRequest,
  parseContextStressRequest, parseEvaluateRequest,
} from '../lib/schema'
import {
  embed, complete, computeSimilarityMatrix, kMeansClusters,
  generatePromptVariants, runCoTProbe, estimateEntropy, reverseEngineerPrompts, think as thinkAi,
  cosineSimilarity, parsePromptClauses,
} from '../lib/ai'
import { executePipeline } from '../lib/pipeline'
import { scanVerbose, PATTERN_DESCRIPTIONS } from '../lib/guard'
import { WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW } from '../lib/constants'

const sensitivity: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseSensitivityRequest)
  if (!p.ok) return p.response
  const { prompt, variants, model, systemPrompt, temperature, maxTokens } = p.data
  try {
    const variantPrompts = await generatePromptVariants(env.AI, env, prompt, variants)
    const t0 = now()
    const responses = await Promise.all(
      variantPrompts.map(vp => complete(env.AI, env, { model, prompt: vp, systemPrompt, temperature, maxTokens })),
    )
    const embeddings = await embed(env.AI, responses, undefined, env)
    const similarityMatrix = computeSimilarityMatrix(embeddings)
    const result = {
      variants: variantPrompts.map((vp, i) => ({ prompt: vp, response: responses[i] })),
      similarityMatrix,
      latencyMs: now() - t0,
    }
    if (p.env.autoVault) void saveToVault(env, { prompt, response: result, model: model ?? '', systemPrompt, tool: 'sensitivity', sandboxId: p.env.sandboxId })
    return json(ok(result))
  } catch (e) {
    return json(err('Sensitivity analysis failed', String(e)), 500)
  }
}

const cluster: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseClusterRequest)
  if (!p.ok) return p.response
  const { texts, k, model } = p.data
  try {
    const t0 = now()
    const embeddings = await embed(env.AI, texts, model, env)
    const kk = Math.min(k, texts.length)
    const { labels } = kMeansClusters(embeddings, kk)
    const similarityMatrix = computeSimilarityMatrix(embeddings)
    const grouped: Record<number, string[]> = {}
    for (let i = 0; i < texts.length; i++) {
      const l = labels[i]
      if (!grouped[l]) grouped[l] = []
      grouped[l].push(texts[i])
    }
    const result = {
      k: kk,
      labels,
      clusters: Object.entries(grouped).map(([label, items]) => ({ label: parseInt(label, 10), items })),
      similarityMatrix,
      latencyMs: now() - t0,
    }
    if (p.env.autoVault) void saveToVault(env, { prompt: texts.join('\n'), response: result, model: model ?? '', tool: 'cluster', sandboxId: p.env.sandboxId })
    return json(ok(result))
  } catch (e) {
    return json(err('Clustering failed', String(e)), 500)
  }
}

const cot: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseCotRequest)
  if (!p.ok) return p.response
  const { prompt, model, systemPrompt, temperature, maxTokens, samples } = p.data
  try {
    const results = await runCoTProbe(env.AI, env, { prompt, model, systemPrompt, temperature, maxTokens }, samples)
    if (p.env.autoVault) void saveToVault(env, { prompt, response: { results }, model: model ?? '', systemPrompt, tool: 'cot', sandboxId: p.env.sandboxId })
    return json(ok({ results }))
  } catch (e) {
    return json(err('CoT probe failed', String(e)), 500)
  }
}

const entropy: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseEntropyRequest)
  if (!p.ok) return p.response
  const { prompt, model, systemPrompt, temperature, maxTokens, samples } = p.data
  try {
    const result = await estimateEntropy(env.AI, env, { prompt, model, systemPrompt, temperature, maxTokens }, samples)
    if (p.env.autoVault) void saveToVault(env, { prompt, response: result, model: model ?? '', systemPrompt, tool: 'entropy', sandboxId: p.env.sandboxId })
    return json(ok(result))
  } catch (e) {
    return json(err('Entropy estimation failed', String(e)), 500)
  }
}

const archaeology: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseArchaeologyRequest)
  if (!p.ok) return p.response
  const { targetResponse, probe, model, candidates, maxTokens } = p.data
  try {
    const results = await reverseEngineerPrompts(
      env.AI, env, targetResponse, probe, model, candidates, maxTokens ?? 2048,
    )
    const result = { candidates: results }
    if (p.env.autoVault) void saveToVault(env, { prompt: probe, response: result, model: model ?? '', tool: 'archaeology', sandboxId: p.env.sandboxId })
    return json(ok(result))
  } catch (e) {
    return json(err('Archaeology failed', String(e)), 500)
  }
}

const pipeline: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parsePipelineRequest)
  if (!p.ok) return p.response
  const { input, nodes, entryId, maxDepth } = p.data
  try {
    const result = await executePipeline(env.AI, env, input, nodes, entryId, maxDepth)
    if (p.env.autoVault) void saveToVault(env, { prompt: input, response: result, model: '', tool: 'pipeline', sandboxId: p.env.sandboxId })
    return json(ok(result))
  } catch (e) {
    return json(err('Pipeline execution failed', String(e)), 500)
  }
}

const think: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseThinkRequest)
  if (!p.ok) return p.response
  const { prompt, model, systemPrompt, maxTokens, budgetTokens } = p.data
  try {
    const result = await thinkAi(env.AI, env, { prompt, model, systemPrompt, maxTokens, budgetTokens })
    if (p.env.autoVault) void saveToVault(env, { prompt, response: result, model: model ?? '', systemPrompt, tool: 'think', sandboxId: p.env.sandboxId })
    return json(ok(result))
  } catch (e) {
    return json(err('Extended thinking failed', String(e)), 500)
  }
}

const evaluate: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseEvaluateRequest)
  if (!p.ok) return p.response
  const { prompt, systemPrompt, model, judgeModel, samples, criteria } = p.data
  try {
    // Run N completions in parallel
    const responses = await Promise.all(
      Array.from({ length: samples }, () =>
        complete(env.AI, env, { model, prompt, systemPrompt }),
      ),
    )
    // For each sample × criterion: judge call (serialised to avoid rate-limiting)
    type JudgeScore = { score: number; reasoning: string }
    const sampleResults: Array<Array<JudgeScore>> = []
    for (const response of responses) {
      const scores: JudgeScore[] = []
      for (const criterion of criteria) {
        try {
          const judgePrompt = `You are evaluating an AI response against a quality criterion.\n\nCriterion: ${criterion.name} — ${criterion.description}\n\nResponse to evaluate:\n${response}\n\nRate the response on a scale of 1 to 5 where:\n1 = Does not meet the criterion at all\n3 = Partially meets the criterion\n5 = Fully meets the criterion\n\nRespond with a JSON object: {"score": <integer 1-5>, "reasoning": "<1-2 sentence explanation>"}`
          const raw = await complete(env.AI, env, {
            model: judgeModel ?? model,
            prompt: judgePrompt,
            responseFormat: 'json',
          })
          let parsed: { score?: unknown; reasoning?: unknown }
          try { parsed = JSON.parse(raw) } catch { parsed = {} }
          const score = typeof parsed.score === 'number' && parsed.score >= 1 && parsed.score <= 5
            ? Math.round(parsed.score) : 3
          const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : raw.slice(0, 200)
          scores.push({ score, reasoning })
        } catch {
          scores.push({ score: 3, reasoning: 'Judge call failed' })
        }
      }
      sampleResults.push(scores)
    }
    // Aggregate per criterion
    const criteriaResults = criteria.map((criterion, ci) => {
      const scores = sampleResults.map(s => s[ci].score)
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length
      const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length
      const stddev = Math.sqrt(variance)
      return { ...criterion, mean, stddev, scores }
    })
    // Weighted total (sum of mean * weight / sum of weights)
    const totalWeight = criteria.reduce((a, c) => a + c.weight, 0)
    const weightedTotal = totalWeight > 0
      ? criteriaResults.reduce((a, c) => a + c.mean * c.weight, 0) / totalWeight : 0
    const result = {
      responses,
      sampleResults: sampleResults.map((ss, i) => ({ response: responses[i], scores: ss })),
      criteria: criteriaResults,
      weightedTotal,
    }
    if (p.env.autoVault) void saveToVault(env, { prompt, response: result, model: model ?? '', systemPrompt, tool: 'evaluate', sandboxId: p.env.sandboxId })
    return json(ok(result))
  } catch (e) {
    return json(err('Rubric evaluation failed', String(e)), 500)
  }
}

// ── Auto-vault helpers ────────────────────────────────────────────────────────

interface Envelope { autoVault: boolean; sandboxId: string | null }

function extractEnvelope(body: unknown): Envelope {
  if (typeof body !== 'object' || body === null) return { autoVault: false, sandboxId: null }
  const b = body as Record<string, unknown>
  const av = b.autoVault
  if (av !== undefined && av !== null && typeof av !== 'boolean') throw new Error('autoVault must be a boolean')
  return {
    autoVault: av === true,
    sandboxId: typeof b.sandboxId === 'string' && isUUID(b.sandboxId) ? b.sandboxId : null,
  }
}

async function parseWithEnvelope<T>(
  req: Request,
  parse: (body: unknown) => T,
): Promise<{ ok: true; data: T; env: Envelope } | { ok: false; response: Response }> {
  let raw: unknown
  try { raw = await readJson(req) } catch (e) { return { ok: false, response: json({ ok: false, error: String(e) }, 400) } }
  try {
    const data = parse(raw)
    return { ok: true, data, env: extractEnvelope(raw) }
  } catch (e) { return { ok: false, response: json({ ok: false, error: String(e) }, 422) } }
}

// ── Context stress ────────────────────────────────────────────────────────────

const STRESS_PADDING_PHRASE = 'The following is background context provided for reference purposes only. '

const contextStress: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseContextStressRequest)
  if (!p.ok) return p.response
  const { prompt, systemPrompt, model, paddingLevels, maxTokens } = p.data
  const levels = paddingLevels ?? [0, 100, 500, 1000, 2000, 4000]
  try {
    // Run baseline + each padded variant sequentially to avoid rate-limiting
    const results: Array<{ tokens: number; response: string; latencyMs: number }> = []
    for (const tokens of levels) {
      const paddingChars = tokens * 4  // STRESS_CHARS_PER_TOKEN
      const padding = paddingChars > 0
        ? STRESS_PADDING_PHRASE.repeat(Math.ceil(paddingChars / STRESS_PADDING_PHRASE.length)).slice(0, paddingChars)
        : ''
      const paddedPrompt = padding ? `${padding}\n\n${prompt}` : prompt
      const t0 = now()
      const response = await complete(env.AI, env, { model, prompt: paddedPrompt, systemPrompt, maxTokens })
      results.push({ tokens, response, latencyMs: now() - t0 })
    }
    // Embed all responses and compute cosine similarity against baseline (level 0)
    const responses = results.map(r => r.response)
    const embeddings = await embed(env.AI, responses, undefined, env)
    const baseEmbed = embeddings[0]
    const levels2 = results.map((r, i) => ({
      ...r,
      similarity: cosineSimilarity(baseEmbed, embeddings[i]),
    }))
    if (p.env.autoVault) void saveToVault(env, { prompt, response: { levels: levels2 }, model: model ?? '', systemPrompt, tool: 'context-stress', sandboxId: p.env.sandboxId })
    return json(ok({ levels: levels2 }))
  } catch (e) {
    return json(err('Context stress test failed', String(e)), 500)
  }
}

const drift: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseDriftRequest)
  if (!p.ok) return p.response
  const { messages, model, systemPrompt, temperature, maxTokens } = p.data
  try {
    const t0 = now()
    const context: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }> = []
    const responses: string[] = []
    for (const msg of messages) {
      context.push({ role: 'user', content: msg.content, timestamp: 0 })
      const response = await complete(env.AI, env, {
        model, systemPrompt, temperature, maxTokens,
        messages: context.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
      })
      responses.push(response)
      context.push({ role: 'assistant', content: response, timestamp: 0 })
    }
    const embeddings = await embed(env.AI, responses, undefined, env)
    const turns = responses.map((response, i) => ({
      index: i,
      userMessage: messages[i].content,
      response,
      fromAnchor: i === 0 ? 0 : 1 - cosineSimilarity(embeddings[0], embeddings[i]),
      fromPrior:  i === 0 ? 0 : 1 - cosineSimilarity(embeddings[i - 1], embeddings[i]),
    }))
    const driftResult = { turns, latencyMs: now() - t0 }
    if (p.env.autoVault) {
      const promptSummary = messages.map(m => m.content).join('\n')
      void saveToVault(env, { prompt: promptSummary, response: driftResult, model: model ?? '', systemPrompt, tool: 'drift', sandboxId: p.env.sandboxId })
    }
    return json(ok(driftResult))
  } catch (e) {
    return json(err('Drift analysis failed', String(e)), 500)
  }
}

const ablation: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseAblationRequest)
  if (!p.ok) return p.response
  const { prompt, model, systemPrompt, temperature, maxTokens } = p.data
  try {
    const clauses = parsePromptClauses(prompt)
    if (clauses.length < 2) return json(err('Prompt must contain at least 2 clauses for ablation', ''), 400)
    const limited = clauses.slice(0, 12) // MAX_ABLATION_CLAUSES
    const baseOpts = { model, prompt, systemPrompt, temperature, maxTokens }
    const baseResponse = await complete(env.AI, env, baseOpts)
    // For each clause, run completion with that clause removed
    const ablatedResponses = await Promise.all(
      limited.map((_, i) => {
        const ablated = limited.filter((__, j) => j !== i).join('\n')
        return complete(env.AI, env, { ...baseOpts, prompt: ablated })
      }),
    )
    // Embed base + all ablated responses together
    const allResponses = [baseResponse, ...ablatedResponses]
    const embeddings = await embed(env.AI, allResponses, undefined, env)
    const baseEmbed = embeddings[0]
    const results = limited.map((clause, i) => ({
      clause,
      ablatedResponse: ablatedResponses[i],
      impact: 1 - cosineSimilarity(baseEmbed, embeddings[i + 1]),
    }))
    results.sort((a, b) => b.impact - a.impact)
    const ablResult = { baseResponse, clauses: results }
    if (p.env.autoVault) void saveToVault(env, { prompt, response: ablResult, model: model ?? '', systemPrompt, tool: 'ablation', sandboxId: p.env.sandboxId })
    return json(ok(ablResult))
  } catch (e) {
    return json(err('Ablation analysis failed', String(e)), 500)
  }
}

const consistency: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseConsistencyRequest)
  if (!p.ok) return p.response
  const { prompt, model, systemPrompt, maxTokens, samples } = p.data
  try {
    const result = await estimateEntropy(env.AI, env, { prompt, model, systemPrompt, temperature: 0, maxTokens }, samples)
    const n = result.samples.length
    const totalPairs = (n * (n - 1)) / 2
    let exactPairs = 0
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (result.samples[i].trim() === result.samples[j].trim()) exactPairs++
    const exactMatchRate = totalPairs > 0 ? exactPairs / totalPairs : 1
    // Re-embed to get per-pair cosine similarities for nearMatchRate
    const embeddings = await embed(env.AI, result.samples, undefined, env)
    const matrix = computeSimilarityMatrix(embeddings)
    let nearPairs = 0
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (matrix[i][j] >= 0.99) nearPairs++
    const nearMatchRate = totalPairs > 0 ? nearPairs / totalPairs : 1
    const consResult = { ...result, exactMatchRate, nearMatchRate }
    if (p.env.autoVault) void saveToVault(env, { prompt, response: consResult, model: model ?? '', systemPrompt, tool: 'consistency', sandboxId: p.env.sandboxId })
    return json(ok(consResult))
  } catch (e) {
    return json(err('Consistency probe failed', String(e)), 500)
  }
}

const guardLab: Handler = async (req: Request, env: Env) => {
  const rl = await rateLimitByIp(req, env, 'rl:whisperer', WHISPERER_RATE_LIMIT_MAX, WHISPERER_RATE_LIMIT_WINDOW)
  if (rl) return rl
  const p = await parseWithEnvelope(req, parseGuardProbeRequest)
  if (!p.ok) return p.response
  try {
    const result = scanVerbose(p.data.text)
    const annotated = result.patterns.map(name => ({
      name,
      description: PATTERN_DESCRIPTIONS[name.replace(/^base64x?\d*:/, '')] ?? 'Pattern detected',
    }))
    const guardResult = { ...result, annotated }
    if (p.env.autoVault) void saveToVault(env, { prompt: p.data.text, response: guardResult, model: '', tool: 'guard-lab', sandboxId: p.env.sandboxId })
    return json(ok(guardResult))
  } catch (e) {
    return json(err('Guard scan failed', String(e)), 500)
  }
}

export const whispererRoutes: Array<[string, string, Handler]> = [
  ['POST', '/api/ai/think',        think],
  ['POST', '/api/ai/sensitivity',  sensitivity],
  ['POST', '/api/ai/cluster',      cluster],
  ['POST', '/api/ai/cot',          cot],
  ['POST', '/api/ai/entropy',      entropy],
  ['POST', '/api/ai/archaeology',  archaeology],
  ['POST', '/api/ai/pipeline',     pipeline],
  ['POST', '/api/ai/evaluate',      evaluate],
  ['POST', '/api/ai/context-stress', contextStress],
  ['POST', '/api/ai/drift',        drift],
  ['POST', '/api/ai/ablation',     ablation],
  ['POST', '/api/ai/consistency',  consistency],
  ['POST', '/api/ai/guard-probe',  guardLab],
]
