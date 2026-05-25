import type { Env } from '../types/env'
import { complete, embed, cosineSimilarity } from './ai'
import { scan } from './guard'
import { MAX_PIPELINE_DEPTH } from './constants'
import type { PipelineNode } from './schema'

export interface PipelineTrace {
  nodeId: string
  type: string
  input: string
  output: string
  conditionMet?: string
  latencyMs: number
}

export interface PipelineResult {
  output: string
  trace: PipelineTrace[]
}

function interpolate(template: string, input: string, original: string): string {
  return template
    .replace(/\{\{input\}\}/g, input)
    .replace(/\{\{original\}\}/g, original)
}

function evaluateCondition(condition: string, output: string): boolean {
  if (condition === 'else') return true
  if (condition.startsWith('contains:'))     return output.includes(condition.slice(9))
  if (condition.startsWith('not-contains:')) return !output.includes(condition.slice(13))
  if (condition.startsWith('label:'))        return output.trim().toLowerCase().startsWith(condition.slice(6).toLowerCase())
  if (condition.startsWith('guard:')) {
    const level = condition.slice(6)
    const result = scan(output)
    if (level === 'blocked')    return result.riskLevel === 'blocked'
    if (level === 'suspicious') return result.riskLevel === 'suspicious' || result.riskLevel === 'blocked'
    return result.riskLevel === 'clean'
  }
  if (condition.startsWith('length:>')) return output.length > parseInt(condition.slice(8), 10)
  if (condition.startsWith('length:<')) return output.length < parseInt(condition.slice(8), 10)
  return false
}

async function executeNode(
  ai: Ai, env: Env,
  node: PipelineNode, input: string, original: string,
): Promise<string> {
  switch (node.type) {
    case 'transform':
      return interpolate(node.template ?? '{{input}}', input, original)

    case 'guard': {
      const result = scan(input)
      if (result.riskLevel === 'blocked') return `[BLOCKED: ${result.patterns[0] ?? 'unknown'}]`
      return input
    }

    case 'classify': {
      const prompt = interpolate(node.template ?? 'Classify: {{input}}', input, original)
      return complete(ai, env, {
        model: node.model,
        prompt,
        systemPrompt: node.systemPrompt,
        temperature: node.temperature ?? 0,
        maxTokens: node.maxTokens ?? 64,
      })
    }

    case 'parallel': {
      const branches = node.branches ?? []
      const select   = node.select ?? 'first'
      const promptText = interpolate(node.template ?? '{{input}}', input, original)
      const results = await Promise.all(
        branches.map(branchModel =>
          complete(ai, env, {
            model: branchModel || node.model,
            prompt: promptText,
            systemPrompt: node.systemPrompt,
            temperature: node.temperature,
            maxTokens: node.maxTokens,
          }),
        ),
      )
      if (results.length === 0) return input
      if (select === 'all')   return results.join('\n\n---\n\n')
      if (select === 'best') {
        const embeds = await embed(ai, [input, ...results])
        const inputEmbed = embeds[0]
        let bestIdx = 0, bestSim = -Infinity
        for (let i = 0; i < results.length; i++) {
          const sim = cosineSimilarity(inputEmbed, embeds[i + 1])
          if (sim > bestSim) { bestSim = sim; bestIdx = i }
        }
        return results[bestIdx]
      }
      return results[0]
    }

    case 'complete':
    default: {
      const prompt = node.template
        ? interpolate(node.template, input, original)
        : input
      return complete(ai, env, {
        model: node.model,
        prompt,
        systemPrompt: node.systemPrompt,
        temperature: node.temperature,
        maxTokens: node.maxTokens,
      })
    }
  }
}

async function runFrom(
  ai: Ai, env: Env,
  nodeMap: Map<string, PipelineNode>,
  nodeId: string, input: string, original: string,
  trace: PipelineTrace[], depth: number, maxDepth: number,
): Promise<string> {
  if (depth >= maxDepth) return input
  const node = nodeMap.get(nodeId)
  if (!node) return input

  const t0 = Date.now()
  const output = await executeNode(ai, env, node, input, original)
  const latencyMs = Date.now() - t0

  let conditionMet: string | undefined
  let nextId: string | undefined
  for (const route of node.routes) {
    if (evaluateCondition(route.condition, output)) {
      conditionMet = route.condition
      nextId = route.nextId
      break
    }
  }

  trace.push({ nodeId, type: node.type, input, output, conditionMet, latencyMs })

  if (!nextId) return output
  return runFrom(ai, env, nodeMap, nextId, output, original, trace, depth + 1, maxDepth)
}

export async function executePipeline(
  ai: Ai, env: Env,
  input: string,
  nodes: PipelineNode[],
  entryId: string,
  maxDepth?: number,
): Promise<PipelineResult> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const trace: PipelineTrace[] = []
  const output = await runFrom(
    ai, env, nodeMap, entryId, input, input, trace, 0, maxDepth ?? MAX_PIPELINE_DEPTH,
  )
  return { output, trace }
}
