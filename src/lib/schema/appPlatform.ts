import type { AppStateValueRequest, EmailRequest, BuildRequest } from './types'
import { isObj, str } from './helpers'
import {
  MAX_APP_STATE_VALUE_LEN, MAX_APP_STATE_KEY_LEN, APP_STATE_KEY_RE,
  MAX_EMAIL_SUBJECT_LEN, MAX_EMAIL_TEXT_LEN,
  MAX_BUILD_DESCRIPTION_LEN, MAX_NAME_LEN,
} from '../constants'

export function parseAppStateValueRequest(body: unknown, key: string): AppStateValueRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const value = str(body.value, 'value')
  if (value.length > MAX_APP_STATE_VALUE_LEN)
    throw new Error(`value must be <= ${MAX_APP_STATE_VALUE_LEN} characters`)
  if (key.length > MAX_APP_STATE_KEY_LEN)
    throw new Error(`key must be <= ${MAX_APP_STATE_KEY_LEN} characters`)
  if (!APP_STATE_KEY_RE.test(key))
    throw new Error('key may only contain alphanumeric, dot, underscore, hyphen, or slash')
  return { key, value }
}

export function parseEmailRequest(body: unknown): EmailRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const to = str(body.to, 'to')
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(to))
    throw new Error('to must be a valid email address')
  const subject = str(body.subject, 'subject')
  if (/[\r\n]/.test(subject)) throw new Error('subject must not contain line breaks')
  if (subject.length === 0 || subject.length > MAX_EMAIL_SUBJECT_LEN)
    throw new Error(`subject must be a non-empty string <= ${MAX_EMAIL_SUBJECT_LEN} characters`)
  const text = str(body.text, 'text')
  if (text.length === 0 || text.length > MAX_EMAIL_TEXT_LEN)
    throw new Error(`text must be a non-empty string <= ${MAX_EMAIL_TEXT_LEN} characters`)
  return {
    to: to.trim().toLowerCase(),
    subject,
    text,
    html: body.html !== undefined ? str(body.html, 'html') : undefined,
  }
}

export function parseBuildRequest(body: unknown): BuildRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const description = str(body.description, 'description')
  if (!description.trim())                           throw new Error('description must not be empty')
  if (description.length > MAX_BUILD_DESCRIPTION_LEN) throw new Error(`description must be <= ${MAX_BUILD_DESCRIPTION_LEN} characters`)
  const name      = body.name      !== undefined ? str(body.name,      'name')      : undefined
  const sandboxId = body.sandboxId !== undefined ? str(body.sandboxId, 'sandboxId') : undefined
  const model     = body.model     !== undefined ? str(body.model,     'model')     : undefined
  if (name      && name.length      > MAX_NAME_LEN) throw new Error(`name must be <= ${MAX_NAME_LEN} characters`)
  if (sandboxId && sandboxId.length > 64)           throw new Error('sandboxId must be <= 64 characters')
  if (model     && model.length     > 128)          throw new Error('model must be <= 128 characters')
  return { description: description.trim(), name, sandboxId, model }
}
