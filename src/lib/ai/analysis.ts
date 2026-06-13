// ── Whisperer analysis helpers ────────────────────────────────────────────────

import type { Env } from '../../types/env'
import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS } from '../constants'
import { now } from '../utils'
import { MODELS } from './models'
import { complete, embed } from './complete'

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function computeSimilarityMatrix(embeddings: Float32Array[]): number[][] {
  return embeddings.map(a => embeddings.map(b => cosineSimilarity(a, b)))
}

export function kMeansClusters(
  embeddings: Float32Array[],
  k: number,
  maxIter = 20,
): { labels: number[]; centroids: Float32Array[] } {
  const n = embeddings.length
  const dim = embeddings[0]?.length ?? 0
  k = Math.min(k, n)

  // Seeded-deterministic pick: evenly spaced indices
  const step = Math.max(1, Math.floor(n / k))
  const centroids = Array.from({ length: k }, (_, i) => new Float32Array(embeddings[i * step] ?? embeddings[0]))

  let labels = new Array<number>(n).fill(0)

  for (let iter = 0; iter < maxIter; iter++) {
    const newLabels = embeddings.map(e => {
      let best = 0, bestSim = -Infinity
      for (let ci = 0; ci < k; ci++) {
        const sim = cosineSimilarity(e, centroids[ci])
        if (sim > bestSim) { bestSim = sim; best = ci }
      }
      return best
    })
    if (newLabels.every((l, i) => l === labels[i])) break
    labels = newLabels
    for (let ci = 0; ci < k; ci++) {
      const members = embeddings.filter((_, i) => labels[i] === ci)
      if (members.length === 0) continue
      for (let d = 0; d < dim; d++) {
        centroids[ci][d] = members.reduce((s, e) => s + e[d], 0) / members.length
      }
    }
  }
  return { labels, centroids }
}

function shannonEntropy(texts: string[]): number {
  const combined = texts.join(' ')
  if (combined.length === 0) return 0
  const freq: Record<string, number> = {}
  for (const c of combined) freq[c] = (freq[c] ?? 0) + 1
  const total = combined.length
  let h = 0
  for (const count of Object.values(freq)) {
    const p = count / total
    h -= p * Math.log2(p)
  }
  return h
}

export async function generatePromptVariants(
  ai: Ai, env: Env, prompt: string, n: number,
): Promise<string[]> {
  const raw = await complete(ai, env, {
    model: MODELS.text,
    prompt: `Generate ${n - 1} semantically equivalent but syntactically diverse paraphrases of the following prompt. Output ONLY a JSON array of strings with no explanation.\n\nPrompt: "${prompt}"`,
    temperature: 0.9,
    maxTokens: 1024,
  })
  try {
    const stripped = raw.replace(/```(?:json)?\n?/g, '').trim()
    const match = stripped.match(/\[[\s\S]*\]/)
    if (match) {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) return [prompt, ...arr.slice(0, n - 1).map(String)]
    }
  } catch { /* fall through */ }
  return [prompt]
}

export interface CoTResult {
  style: 'plain' | 'step-by-step' | 'xml-structured' | 'self-consistency'
  response: string
  latencyMs: number
}

export async function runCoTProbe(
  ai: Ai, env: Env,
  opts: { prompt: string; model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number },
  samples: number,
): Promise<CoTResult[]> {
  const styles: Array<{ style: CoTResult['style']; prompt: string }> = [
    { style: 'plain',            prompt: opts.prompt },
    { style: 'step-by-step',     prompt: `${opts.prompt}\n\nThink step by step before answering.` },
    { style: 'xml-structured',   prompt: `${opts.prompt}\n\nStructure your answer as:\n<thinking>...</thinking>\n<answer>...</answer>` },
    { style: 'self-consistency', prompt: `${opts.prompt}\n\nProvide ${samples} independent answers then state your final consensus answer.` },
  ]
  return Promise.all(styles.map(async ({ style, prompt }) => {
    const t0 = now()
    const response = await complete(ai, env, {
      model: opts.model, prompt,
      systemPrompt: opts.systemPrompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
    })
    return { style, response, latencyMs: now() - t0 }
  }))
}

export interface EntropyResult {
  samples: string[]
  entropy: number
  avgCosineSimilarity: number
  latencyMs: number
}

export async function estimateEntropy(
  ai: Ai, env: Env,
  opts: { prompt: string; model?: string; systemPrompt?: string; temperature?: number; maxTokens?: number },
  sampleCount: number,
): Promise<EntropyResult> {
  const t0 = now()
  const samples = await Promise.all(
    Array.from({ length: sampleCount }, () =>
      complete(ai, env, {
        model: opts.model,
        prompt: opts.prompt,
        systemPrompt: opts.systemPrompt,
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      }),
    ),
  )
  const entropy = shannonEntropy(samples)
  const embeddings = await embed(ai, samples, undefined, env)
  let simSum = 0, simCount = 0
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      simSum += cosineSimilarity(embeddings[i], embeddings[j])
      simCount++
    }
  }
  const avgCosineSimilarity = simCount > 0 ? simSum / simCount : 1
  return { samples, entropy, avgCosineSimilarity, latencyMs: now() - t0 }
}

export interface ArchaeologyCandidate {
  candidate: string
  similarity: number
}

export async function reverseEngineerPrompts(
  ai: Ai, env: Env,
  targetResponse: string,
  probe: string,
  model: string | undefined,
  n: number,
  maxTokens: number,
): Promise<ArchaeologyCandidate[]> {
  const raw = await complete(ai, env, {
    model: model ?? MODELS.textLarge,
    prompt: `You are a prompt archaeologist. Given an AI response and the user message that generated it, reverse-engineer ${n} candidate system prompts that could have produced this response.

User message: "${probe}"
AI response: "${targetResponse}"

Output ONLY a JSON array of ${n} strings (the candidate system prompts), no explanation.`,
    temperature: 0.8,
    maxTokens,
  })
  let candidates: string[] = []
  try {
    const match = raw.replace(/```(?:json)?\n?/g, '').trim().match(/\[[\s\S]*\]/)
    if (match) {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) candidates = arr.slice(0, n).map(String)
    }
  } catch { /* fall through */ }
  if (candidates.length === 0) return []
  const allEmbeds = await embed(ai, [targetResponse, ...candidates], undefined, env)
  const targetEmbed = allEmbeds[0]
  return candidates
    .map((candidate, i) => ({ candidate, similarity: cosineSimilarity(targetEmbed, allEmbeds[i + 1]) }))
    .sort((a, b) => b.similarity - a.similarity)
}
