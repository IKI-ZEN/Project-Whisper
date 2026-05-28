import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody } from '../lib/http'
import {
  parseSensitivityRequest, parseClusterRequest, parseCotRequest,
  parseEntropyRequest, parseArchaeologyRequest, parsePipelineRequest, parseThinkRequest,
  parseGuardProbeRequest, parseConsistencyRequest, parseAblationRequest, parseDriftRequest,
  parseContextStressRequest,
} from '../lib/schema'
import {
  embed, complete, computeSimilarityMatrix, kMeansClusters,
  generatePromptVariants, runCoTProbe, estimateEntropy, reverseEngineerPrompts, think,
  cosineSimilarity, parsePromptClauses,
} from '../lib/ai'
import { executePipeline } from '../lib/pipeline'
import { scanVerbose, PATTERN_DESCRIPTIONS } from '../lib/guard'

const sensitivity: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseSensitivityRequest)
  if (!p.ok) return p.response
  const { prompt, variants, model, systemPrompt, temperature, maxTokens } = p.data
  try {
    const variantPrompts = await generatePromptVariants(env.AI, env, prompt, variants)
    const t0 = Date.now()
    const responses = await Promise.all(
      variantPrompts.map(vp => complete(env.AI, env, { model, prompt: vp, systemPrompt, temperature, maxTokens })),
    )
    const embeddings = await embed(env.AI, responses)
    const similarityMatrix = computeSimilarityMatrix(embeddings)
    return json(ok({
      variants: variantPrompts.map((vp, i) => ({ prompt: vp, response: responses[i] })),
      similarityMatrix,
      latencyMs: Date.now() - t0,
    }))
  } catch (e) {
    return json(err('Sensitivity analysis failed', String(e)), 500)
  }
}

const cluster: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseClusterRequest)
  if (!p.ok) return p.response
  const { texts, k, model } = p.data
  try {
    const t0 = Date.now()
    const embeddings = await embed(env.AI, texts, model)
    const kk = Math.min(k, texts.length)
    const { labels } = kMeansClusters(embeddings, kk)
    const similarityMatrix = computeSimilarityMatrix(embeddings)
    const grouped: Record<number, string[]> = {}
    for (let i = 0; i < texts.length; i++) {
      const l = labels[i]
      if (!grouped[l]) grouped[l] = []
      grouped[l].push(texts[i])
    }
    return json(ok({
      k: kk,
      labels,
      clusters: Object.entries(grouped).map(([label, items]) => ({ label: parseInt(label, 10), items })),
      similarityMatrix,
      latencyMs: Date.now() - t0,
    }))
  } catch (e) {
    return json(err('Clustering failed', String(e)), 500)
  }
}

const cot: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseCotRequest)
  if (!p.ok) return p.response
  const { prompt, model, systemPrompt, temperature, maxTokens, samples } = p.data
  try {
    const results = await runCoTProbe(env.AI, env, { prompt, model, systemPrompt, temperature, maxTokens }, samples)
    return json(ok({ results }))
  } catch (e) {
    return json(err('CoT probe failed', String(e)), 500)
  }
}

const entropy: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseEntropyRequest)
  if (!p.ok) return p.response
  const { prompt, model, systemPrompt, temperature, maxTokens, samples } = p.data
  try {
    const result = await estimateEntropy(env.AI, env, { prompt, model, systemPrompt, temperature, maxTokens }, samples)
    return json(ok(result))
  } catch (e) {
    return json(err('Entropy estimation failed', String(e)), 500)
  }
}

const archaeology: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseArchaeologyRequest)
  if (!p.ok) return p.response
  const { targetResponse, probe, model, candidates, maxTokens } = p.data
  try {
    const results = await reverseEngineerPrompts(
      env.AI, env, targetResponse, probe, model, candidates, maxTokens ?? 2048,
    )
    return json(ok({ candidates: results }))
  } catch (e) {
    return json(err('Archaeology failed', String(e)), 500)
  }
}

const pipeline: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parsePipelineRequest)
  if (!p.ok) return p.response
  const { input, nodes, entryId, maxDepth } = p.data
  try {
    const result = await executePipeline(env.AI, env, input, nodes, entryId, maxDepth)
    return json(ok(result))
  } catch (e) {
    return json(err('Pipeline execution failed', String(e)), 500)
  }
}

const thinkHandler: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseThinkRequest)
  if (!p.ok) return p.response
  const { prompt, model, systemPrompt, maxTokens, budgetTokens } = p.data
  try {
    const result = await think(env.AI, env, { prompt, model, systemPrompt, maxTokens, budgetTokens })
    return json(ok(result))
  } catch (e) {
    return json(err('Extended thinking failed', String(e)), 500)
  }
}

const STRESS_PADDING_PHRASE = 'The following is background context provided for reference purposes only. '

const contextStress: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseContextStressRequest)
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
      const t0 = Date.now()
      const response = await complete(env.AI, env, { model, prompt: paddedPrompt, systemPrompt, maxTokens })
      results.push({ tokens, response, latencyMs: Date.now() - t0 })
    }
    // Embed all responses and compute cosine similarity against baseline (level 0)
    const responses = results.map(r => r.response)
    const embeddings = await embed(env.AI, responses)
    const baseEmbed = embeddings[0]
    const levels2 = results.map((r, i) => ({
      ...r,
      similarity: cosineSimilarity(baseEmbed, embeddings[i]),
    }))
    return json(ok({ levels: levels2 }))
  } catch (e) {
    return json(err('Context stress test failed', String(e)), 500)
  }
}

const drift: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseDriftRequest)
  if (!p.ok) return p.response
  const { messages, model, systemPrompt, temperature, maxTokens } = p.data
  try {
    const t0 = Date.now()
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
    const embeddings = await embed(env.AI, responses)
    const turns = responses.map((response, i) => ({
      index: i,
      userMessage: messages[i].content,
      response,
      fromAnchor: i === 0 ? 0 : 1 - cosineSimilarity(embeddings[0], embeddings[i]),
      fromPrior:  i === 0 ? 0 : 1 - cosineSimilarity(embeddings[i - 1], embeddings[i]),
    }))
    return json(ok({ turns, latencyMs: Date.now() - t0 }))
  } catch (e) {
    return json(err('Drift analysis failed', String(e)), 500)
  }
}

const ablation: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseAblationRequest)
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
    const embeddings = await embed(env.AI, allResponses)
    const baseEmbed = embeddings[0]
    const results = limited.map((clause, i) => ({
      clause,
      ablatedResponse: ablatedResponses[i],
      impact: 1 - cosineSimilarity(baseEmbed, embeddings[i + 1]),
    }))
    results.sort((a, b) => b.impact - a.impact)
    return json(ok({ baseResponse, clauses: results }))
  } catch (e) {
    return json(err('Ablation analysis failed', String(e)), 500)
  }
}

const consistency: Handler = async (req: Request, env: Env) => {
  const p = await parseBody(req, parseConsistencyRequest)
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
    const embeddings = await embed(env.AI, result.samples)
    const matrix = computeSimilarityMatrix(embeddings)
    let nearPairs = 0
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (matrix[i][j] >= 0.99) nearPairs++
    const nearMatchRate = totalPairs > 0 ? nearPairs / totalPairs : 1
    return json(ok({ ...result, exactMatchRate, nearMatchRate }))
  } catch (e) {
    return json(err('Consistency probe failed', String(e)), 500)
  }
}

const guardLab: Handler = async (req: Request, _env: Env) => {
  const p = await parseBody(req, parseGuardProbeRequest)
  if (!p.ok) return p.response
  try {
    const result = scanVerbose(p.data.text)
    // Attach plain-English descriptions to each matched pattern
    const annotated = result.patterns.map(name => ({
      name,
      description: PATTERN_DESCRIPTIONS[name.replace(/^base64x?\d*:/, '')] ?? 'Pattern detected',
    }))
    return json(ok({ ...result, annotated }))
  } catch (e) {
    return json(err('Guard scan failed', String(e)), 500)
  }
}

export const whispererRoutes: Array<[string, string, Handler]> = [
  ['POST', '/api/ai/think',        thinkHandler],
  ['POST', '/api/ai/sensitivity',  sensitivity],
  ['POST', '/api/ai/cluster',      cluster],
  ['POST', '/api/ai/cot',          cot],
  ['POST', '/api/ai/entropy',      entropy],
  ['POST', '/api/ai/archaeology',  archaeology],
  ['POST', '/api/ai/pipeline',     pipeline],
  ['POST', '/api/ai/context-stress', contextStress],
  ['POST', '/api/ai/drift',        drift],
  ['POST', '/api/ai/ablation',     ablation],
  ['POST', '/api/ai/consistency',  consistency],
  ['POST', '/api/ai/guard-probe',  guardLab],
]
