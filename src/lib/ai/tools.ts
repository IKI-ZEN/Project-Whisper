// ── Tool call encoding (provider-agnostic wire format) ────────────────────────

import type { Tool } from '../schema'

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

// Messages whose content starts with this prefix are tool results sent by the client
const TOOL_RESULT_PREFIX = '__TOOL_RESULT__:'

export function encodeToolResult(toolUseId: string, toolName: string, content: string): string {
  return TOOL_RESULT_PREFIX + JSON.stringify({ toolUseId, toolName, content })
}

export function decodeToolResult(s: string): { toolUseId: string; toolName: string; content: string } | null {
  if (!s.startsWith(TOOL_RESULT_PREFIX)) return null
  try { return JSON.parse(s.slice(TOOL_RESULT_PREFIX.length)) } catch { return null }
}

export function encodeToolCalls(calls: ToolCall[]): string {
  return JSON.stringify({ __tool_calls__: calls })
}

export function isToolCallReply(reply: string): boolean {
  try { const o = JSON.parse(reply); return Array.isArray((o as Record<string, unknown>).__tool_calls__) } catch { return false }
}

export function decodeToolCalls(reply: string): ToolCall[] {
  try {
    const o = JSON.parse(reply) as { __tool_calls__?: ToolCall[] }
    return Array.isArray(o.__tool_calls__) ? o.__tool_calls__ : []
  } catch { return [] }
}

// ── Provider-specific tool converters ─────────────────────────────────────────

export function toAnthropicTool(t: Tool): Record<string, unknown> {
  const required = Object.entries(t.parameters).filter(([, p]) => p.required).map(([k]) => k)
  return {
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, p]) => [k, { type: p.type, description: p.description }]),
      ),
      required,
    },
  }
}

export function toOpenAITool(t: Tool): Record<string, unknown> {
  const required = Object.entries(t.parameters).filter(([, p]) => p.required).map(([k]) => k)
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, p]) => [k, { type: p.type, description: p.description }]),
        ),
        required,
      },
    },
  }
}

export function toGoogleFunctionDeclaration(t: Tool): Record<string, unknown> {
  return {
    name: t.name,
    description: t.description,
    parameters: {
      type: 'OBJECT',
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, p]) => [k, { type: p.type.toUpperCase(), description: p.description }]),
      ),
      required: Object.entries(t.parameters).filter(([, p]) => p.required).map(([k]) => k),
    },
  }
}
