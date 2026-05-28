import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { json, ok, err, parseBody } from '../lib/http'
import {
  parseSensitivityRequest, parseClusterRequest, parseCotRequest,
  parseEntropyRequest, parseArchaeologyRequest, parsePipelineRequest, parseThinkRequest,
} from '../lib/schema'
import {
  embed, complete, computeSimilarityMatrix, kMeansClusters,
  generatePromptVariants, runCoTProbe, estimateEntropy, reverseEngineerPrompts, think,
} from '../lib/ai'
import { executePipeline } from '../lib/pipeline'

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

export const whispererRoutes: Array<[string, string, Handler]> = [
  ['POST', '/api/ai/think',       thinkHandler],
  ['POST', '/api/ai/sensitivity', sensitivity],
  ['POST', '/api/ai/cluster',     cluster],
  ['POST', '/api/ai/cot',         cot],
  ['POST', '/api/ai/entropy',     entropy],
  ['POST', '/api/ai/archaeology', archaeology],
  ['POST', '/api/ai/pipeline',    pipeline],
]
