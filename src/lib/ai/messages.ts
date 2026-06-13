// ── Shared message builder ────────────────────────────────────────────────────

import type { Message, Tool, ContentBlock } from '../schema'
import { decodeToolResult, isToolCallReply, decodeToolCalls } from './tools'

export interface CompletionOpts {
  model?: string
  prompt?: string
  messages?: Message[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  // Advanced features
  tools?: Tool[]                              // tool definitions — wired to all providers
  toolChoice?: 'auto' | 'required' | 'none'  // OpenAI/Anthropic tool_choice
  responseFormat?: 'json' | 'text'           // 'json' → JSON mode (OpenAI / Workers AI)
  jsonSchema?: Record<string, unknown>        // OpenAI: json_schema strict mode (overrides responseFormat)
  thinking?: number                          // Anthropic: budget_tokens; >0 enables extended thinking
  reasoningEffort?: 'low' | 'medium' | 'high' // OpenAI o-series reasoning effort
  sandboxId?: string                         // passed as cf-aig-metadata for observability
  groundingEnabled?: boolean                 // Google: enable google_search_retrieval
  // AI Gateway extended controls
  byokAlias?:        string   // cf-aig-byok-alias — named credential in Cloudflare Secrets Store
  zdr?:              boolean  // cf-aig-zdr: true — Zero Data Retention (Unified Billing)
  collectLogPayload?: boolean // false → cf-aig-collect-log-payload: false
  fallbackModel?:    string   // tried once if primary model throws
}

// Extract plain text from a message content value (strips images for text-only paths)
export function contentToText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('\n')
}

// Map ContentBlock[] to Anthropic content block array format
export function toAnthropicContent(blocks: ContentBlock[]): Record<string, unknown>[] {
  return blocks.map(b =>
    b.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } }
      : { type: 'text', text: b.text },
  )
}

// Map ContentBlock[] to OpenAI content block array format
export function toOpenAIContent(blocks: ContentBlock[]): Record<string, unknown>[] {
  return blocks.map(b =>
    b.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${b.mediaType};base64,${b.data}` } }
      : { type: 'text', text: b.text },
  )
}

// Map ContentBlock[] to Gemini parts format
export function toGeminiParts(blocks: ContentBlock[]): Record<string, unknown>[] {
  return blocks.map(b =>
    b.type === 'image'
      ? { inlineData: { mimeType: b.mediaType, data: b.data } }
      : { text: b.text },
  )
}

// Build plain text messages for streaming and Workers AI (no tool history or multimodal support)
export function buildMessages(opts: CompletionOpts): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = []
  if (opts.systemPrompt) out.push({ role: 'system', content: opts.systemPrompt })
  if (opts.messages?.length) {
    for (const m of opts.messages) out.push({ role: m.role, content: contentToText(m.content) })
  } else if (opts.prompt) {
    out.push({ role: 'user', content: opts.prompt })
  }
  return out
}

// Build Anthropic-format messages, converting tool call/result encoding and ContentBlock[] in history
export function buildAnthropicMessages(opts: CompletionOpts): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const msgList = opts.messages?.length
    ? opts.messages.filter(m => m.role !== 'system')
    : opts.prompt ? [{ role: 'user' as const, content: opts.prompt, timestamp: 0 }] : []

  for (const m of msgList) {
    if (Array.isArray(m.content)) {
      // ContentBlock[] — map to Anthropic vision/text content blocks
      out.push({ role: m.role, content: toAnthropicContent(m.content) })
      continue
    }
    // String content — check for tool call encoding
    const tr = decodeToolResult(m.content)
    if (tr && m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tr.toolUseId, content: tr.content }] })
      continue
    }
    if (isToolCallReply(m.content) && m.role === 'assistant') {
      const calls = decodeToolCalls(m.content)
      out.push({ role: 'assistant', content: calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

// Build OpenAI-format messages, converting tool call/result encoding and ContentBlock[] in history
export function buildOpenAIMessages(opts: CompletionOpts): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const msgList = opts.messages?.length
    ? opts.messages
    : opts.prompt ? [{ role: 'user' as const, content: opts.prompt, timestamp: 0 }] : []

  for (const m of msgList) {
    if (Array.isArray(m.content)) {
      // ContentBlock[] — map to OpenAI vision/text content blocks
      out.push({ role: m.role, content: toOpenAIContent(m.content) })
      continue
    }
    // String content — check for tool call encoding
    const tr = decodeToolResult(m.content)
    if (tr && m.role === 'user') {
      out.push({ role: 'tool', tool_call_id: tr.toolUseId, content: tr.content })
      continue
    }
    if (isToolCallReply(m.content) && m.role === 'assistant') {
      const calls = decodeToolCalls(m.content)
      out.push({
        role: 'assistant',
        content: null,
        tool_calls: calls.map(c => ({
          id: c.id, type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        })),
      })
      continue
    }
    out.push({ role: m.role, content: m.content })
  }

  // Prepend system message if present (OpenAI supports system role in messages array)
  if (opts.systemPrompt) out.unshift({ role: 'system', content: opts.systemPrompt })
  return out
}
