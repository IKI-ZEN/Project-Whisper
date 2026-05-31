import type { Message, ContentBlock, ImageBlock } from './types'
import { MAX_IMAGE_BASE64_BYTES, MAX_IMAGES_PER_MESSAGE } from '../constants'

export type Obj = Record<string, unknown>

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export const ALLOWED_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function parseContentBlock(v: unknown, idx: number): ContentBlock {
  if (!isObj(v)) throw new Error(`content[${idx}] must be an object`)
  const { type } = v
  if (type === 'text') {
    if (typeof v.text !== 'string') throw new Error(`content[${idx}].text must be a string`)
    return { type: 'text', text: v.text }
  }
  if (type === 'image') {
    if (!ALLOWED_IMAGE_MEDIA_TYPES.has(v.mediaType as string))
      throw new Error(`content[${idx}].mediaType must be image/jpeg, image/png, image/gif, or image/webp`)
    if (typeof v.data !== 'string' || v.data.length === 0)
      throw new Error(`content[${idx}].data must be a non-empty base64 string`)
    if (v.data.length > MAX_IMAGE_BASE64_BYTES)
      throw new Error(`content[${idx}].data exceeds maximum allowed size`)
    return { type: 'image', mediaType: v.mediaType as ImageBlock['mediaType'], data: v.data as string }
  }
  throw new Error(`content[${idx}].type must be "text" or "image"`)
}

export function parseMessageContent(v: unknown): string | ContentBlock[] {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    if (v.length > MAX_IMAGES_PER_MESSAGE + 20)
      throw new Error(`content array exceeds maximum length`)
    const imageCount = v.filter(b => isObj(b) && (b as Obj).type === 'image').length
    if (imageCount > MAX_IMAGES_PER_MESSAGE)
      throw new Error(`messages may contain at most ${MAX_IMAGES_PER_MESSAGE} images`)
    return v.map((b, i) => parseContentBlock(b, i))
  }
  throw new Error('message content must be a string or array of content blocks')
}

export function parseMessage(v: unknown, idx: number): Message {
  if (!isObj(v)) throw new Error(`messages[${idx}] must be an object`)
  const role = v.role
  if (role !== 'system' && role !== 'user' && role !== 'assistant')
    throw new Error(`messages[${idx}].role must be "system", "user", or "assistant"`)
  if (v.content === undefined) throw new Error(`messages[${idx}].content is required`)
  const content = parseMessageContent(v.content)
  const timestamp = typeof v.timestamp === 'number' ? v.timestamp : 0
  return { role: role as Message['role'], content, timestamp }
}

export function str(v: unknown, field: string): string
export function str(v: unknown, field: string, fallback: string): string
export function str(v: unknown, field: string, fallback?: string): string {
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback
    throw new Error(`${field} is required`)
  }
  if (typeof v !== 'string') throw new Error(`${field} must be a string`)
  return v
}

export function num(v: unknown, field: string, fallback: number, min?: number, max?: number): number {
  if (v === undefined || v === null) return fallback
  if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${field} must be a finite number`)
  if (min !== undefined && v < min) throw new Error(`${field} must be >= ${min}`)
  if (max !== undefined && v > max) throw new Error(`${field} must be <= ${max}`)
  return v
}

export function bool(v: unknown, field: string, fallback: boolean): boolean {
  if (!isObj(v)) return fallback
  const val = (v as Record<string, unknown>)[field]
  if (val === undefined || val === null) return fallback
  if (typeof val !== 'boolean') throw new Error(`${field} must be a boolean`)
  return val
}
