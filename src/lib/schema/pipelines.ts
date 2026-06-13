import type { CreatePipelineRequest, PatchPipelineRequest, PipelineRunRequest } from './types'
import { isObj, str } from './helpers'
import { MAX_NAME_LEN, MAX_DESCRIPTION_LEN } from '../constants'
import { parsePipelineRequest } from './whisperer'

export function parseCreatePipeline(body: unknown): CreatePipelineRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const name = str(body.name, 'name')
  if (name.length > MAX_NAME_LEN) throw new Error(`name must be <= ${MAX_NAME_LEN} characters`)
  const description = body.description !== undefined ? str(body.description, 'description', '') : ''
  if (description.length > MAX_DESCRIPTION_LEN) throw new Error(`description must be <= ${MAX_DESCRIPTION_LEN} characters`)
  // Reuse parsePipelineRequest for node validation; inject a dummy input so it satisfies the schema
  const { nodes, entryId } = parsePipelineRequest({ ...body, input: body.input ?? '' })
  return { name, description, nodes, entryId }
}

export function parsePatchPipeline(body: unknown): PatchPipelineRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  const out: PatchPipelineRequest = {}
  if (body.name !== undefined) {
    const name = str(body.name, 'name')
    if (name.length > MAX_NAME_LEN) throw new Error(`name must be <= ${MAX_NAME_LEN} characters`)
    out.name = name
  }
  if (body.description !== undefined) {
    out.description = str(body.description, 'description', '')
    if (out.description.length > MAX_DESCRIPTION_LEN)
      throw new Error(`description must be <= ${MAX_DESCRIPTION_LEN} characters`)
  }
  if (body.nodes !== undefined || body.entryId !== undefined) {
    if (body.nodes === undefined || body.entryId === undefined)
      throw new Error('nodes and entryId must be provided together')
    const { nodes, entryId } = parsePipelineRequest({ nodes: body.nodes, entryId: body.entryId, input: '' })
    out.nodes   = nodes
    out.entryId = entryId
  }
  return out
}

export function parsePipelineRunRequest(body: unknown): PipelineRunRequest {
  if (!isObj(body)) throw new Error('Request body must be a JSON object')
  return { input: str(body.input, 'input') }
}
