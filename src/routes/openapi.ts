import type { Env } from '../types/env'
import type { Handler } from '../lib/http'
import { API_VERSION } from '../lib/constants'

// ── OpenAPI 3.1 specification ─────────────────────────────────────────────────
// Hand-authored spec covering the primary API surface. Used for:
//   - Cloudflare API Shield schema validation (upload via dashboard)
//   - Client codegen
//   - API documentation tooling
// GET /api/openapi.json

const getSpec: Handler = async (_req: Request, _env: Env) => {
  const spec = {
    openapi: '3.1.0',
    info: {
      title:   'Project Whisper API',
      version: API_VERSION,
      description: 'Multi-tenant AI sandbox platform with completions, pipelines, probes, vault, and atlas.',
    },
    servers: [{ url: '/api', description: 'Current deployment' }],

    components: {
      schemas: {
        Ok: {
          type: 'object',
          required: ['ok', 'data'],
          properties: {
            ok:   { type: 'boolean', enum: [true] },
            data: { description: 'Response payload (shape varies by endpoint)' },
          },
        },
        Err: {
          type: 'object',
          required: ['ok', 'error'],
          properties: {
            ok:     { type: 'boolean', enum: [false] },
            error:  { type: 'string' },
            detail: { description: 'Optional extra context' },
          },
        },
        TextBlock: {
          type: 'object',
          required: ['type', 'text'],
          properties: {
            type: { type: 'string', enum: ['text'] },
            text: { type: 'string' },
          },
        },
        ImageBlock: {
          type: 'object',
          required: ['type', 'mediaType', 'data'],
          properties: {
            type:      { type: 'string', enum: ['image'] },
            mediaType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] },
            data:      { type: 'string', description: 'Base64-encoded image, no data: URI prefix' },
          },
        },
        ContentBlock: {
          oneOf: [
            { '$ref': '#/components/schemas/TextBlock' },
            { '$ref': '#/components/schemas/ImageBlock' },
          ],
        },
        Message: {
          type: 'object',
          required: ['role', 'content', 'timestamp'],
          properties: {
            role:      { type: 'string', enum: ['system', 'user', 'assistant'] },
            content: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { '$ref': '#/components/schemas/ContentBlock' } },
              ],
            },
            timestamp: { type: 'integer', description: 'Unix ms' },
          },
        },
        ToolParam: {
          type: 'object',
          required: ['type', 'description'],
          properties: {
            type:        { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'] },
            description: { type: 'string' },
            required:    { type: 'boolean' },
          },
        },
        Tool: {
          type: 'object',
          required: ['name', 'description', 'parameters'],
          properties: {
            name:        { type: 'string' },
            description: { type: 'string' },
            parameters:  { type: 'object', additionalProperties: { '$ref': '#/components/schemas/ToolParam' } },
          },
        },
        CompletionRequest: {
          type: 'object',
          properties: {
            prompt:           { type: 'string' },
            messages:         { type: 'array', items: { '$ref': '#/components/schemas/Message' } },
            systemPrompt:     { type: 'string' },
            model:            { type: 'string', example: 'openai:gpt-4o' },
            temperature:      { type: 'number', minimum: 0, maximum: 2 },
            maxTokens:        { type: 'integer', minimum: 1, maximum: 8192 },
            tools:            { type: 'array', items: { '$ref': '#/components/schemas/Tool' } },
            toolChoice:       { type: 'string', enum: ['auto', 'required', 'none'] },
            responseFormat:   { type: 'string', enum: ['json', 'text'] },
            jsonSchema:       { type: 'object', description: 'OpenAI json_schema strict mode schema' },
            reasoningEffort:  { type: 'string', enum: ['low', 'medium', 'high'] },
            thinking:         { type: 'integer', description: 'Anthropic budget_tokens for extended thinking' },
            groundingEnabled: { type: 'boolean', description: 'Google: enable google_search_retrieval' },
            byokAlias:        { type: 'string', description: 'cf-aig-byok-alias — named credential alias' },
            zdr:              { type: 'boolean', description: 'cf-aig-zdr — Zero Data Retention routing' },
            collectLogPayload: { type: 'boolean', description: 'false suppresses gateway body logging' },
            fallbackModel:    { type: 'string', description: 'Secondary model tried if primary throws' },
          },
        },
        CreateSandboxRequest: {
          type: 'object',
          required: ['name', 'description', 'systemPrompt', 'tools', 'model'],
          properties: {
            name:         { type: 'string', maxLength: 128 },
            description:  { type: 'string', maxLength: 512 },
            systemPrompt: { type: 'string', maxLength: 16384 },
            tools:        { type: 'array', items: { '$ref': '#/components/schemas/Tool' } },
            model:        { type: 'string' },
            temperature:  { type: 'number', minimum: 0, maximum: 2 },
            maxTokens:    { type: 'integer', minimum: 1, maximum: 8192 },
          },
        },
        CreatePipelineRequest: {
          type: 'object',
          required: ['name', 'nodes', 'entryId'],
          properties: {
            name:        { type: 'string', maxLength: 128 },
            description: { type: 'string', maxLength: 512 },
            nodes:       { type: 'array', description: 'PipelineNode[] DAG definition' },
            entryId:     { type: 'string', description: 'ID of the entry node' },
          },
        },
        CreateProbeRequest: {
          type: 'object',
          required: ['name', 'sandboxId', 'tool', 'params', 'schedule'],
          properties: {
            name:       { type: 'string', maxLength: 128 },
            sandboxId:  { type: 'string', format: 'uuid' },
            tool:       { type: 'string', enum: ['entropy', 'sweep', 'sensitivity', 'cot', 'pipeline'] },
            params:     { type: 'object' },
            schedule:   { type: 'string', enum: ['hourly', 'daily', 'weekly'] },
            threshold:  { type: 'number' },
            webhookUrl: { type: 'string', maxLength: 512 },
          },
        },
      },
    },

    paths: {
      '/ai/complete': {
        post: {
          summary: 'Non-streaming completion',
          tags: ['AI'],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CompletionRequest' } } } },
          responses: { '200': { description: 'Completion result', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Ok' } } } } },
        },
      },
      '/ai/stream': {
        post: {
          summary: 'Streaming SSE completion',
          tags: ['AI'],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CompletionRequest' } } } },
          responses: { '200': { description: 'SSE stream of text/event-stream chunks', content: { 'text/event-stream': {} } } },
        },
      },
      '/ai/embed': {
        post: {
          summary: 'Compute text embeddings',
          tags: ['AI'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, model: { type: 'string' } } } } } },
          responses: { '200': { description: 'Embedding vectors' } },
        },
      },
      '/sandbox': {
        get: {
          summary: 'List sandboxes',
          tags: ['Sandbox'],
          responses: { '200': { description: 'Array of sandbox configs' } },
        },
        post: {
          summary: 'Create sandbox',
          tags: ['Sandbox'],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreateSandboxRequest' } } } },
          responses: { '200': { description: 'Created sandbox config' } },
        },
      },
      '/sandbox/{id}': {
        get:    { summary: 'Get sandbox config',    tags: ['Sandbox'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Sandbox config' } } },
        patch:  { summary: 'Update sandbox config', tags: ['Sandbox'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Updated config' } } },
        delete: { summary: 'Delete sandbox',        tags: ['Sandbox'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Deletion confirmation' } } },
      },
      '/sandbox/{id}/run': {
        post: {
          summary: 'Run a prompt in a sandbox',
          tags: ['Sandbox'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, sessionId: { type: 'string' } } } } } },
          responses: { '200': { description: 'Completion result' } },
        },
      },
      '/sandbox/{id}/fork': {
        post: {
          summary: 'Fork a sandbox (copy config, empty memory)',
          tags: ['Sandbox'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'New sandbox config' } },
        },
      },
      '/vault': {
        get: {
          summary: 'List vault records',
          tags: ['Vault'],
          parameters: [
            { name: 'q',      in: 'query', schema: { type: 'string' }, description: 'SQL LIKE text filter' },
            { name: 'tool',   in: 'query', schema: { type: 'string' } },
            { name: 'model',  in: 'query', schema: { type: 'string' } },
            { name: 'limit',  in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'Paginated vault records' } },
        },
        post: {
          summary: 'Create vault record',
          tags: ['Vault'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, response: { type: 'string' }, model: { type: 'string' }, tool: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } } },
          responses: { '200': { description: 'Created vault record' } },
        },
      },
      '/vault/search': {
        get: {
          summary: 'Semantic search over vault records (requires AI Search binding)',
          tags: ['Vault'],
          parameters: [
            { name: 'q',     in: 'query', required: true, schema: { type: 'string' }, description: 'Natural language query' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 50 } },
            { name: 'tool',  in: 'query', schema: { type: 'string' }, description: 'Filter by tool name' },
          ],
          responses: {
            '200': { description: 'Ranked vault records' },
            '503': { description: 'AI Search binding not configured' },
          },
        },
      },
      '/vault/analyze': {
        post: {
          summary: 'K-means cluster analysis of vault prompts',
          tags: ['Vault'],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { k: { type: 'integer', minimum: 2, maximum: 20, default: 5 }, limit: { type: 'integer', minimum: 10, maximum: 500, default: 200 }, tool: { type: 'string' }, since: { type: 'integer' } } } } } },
          responses: { '200': { description: 'Cluster assignments and representatives' } },
        },
      },
      '/pipelines': {
        get:  { summary: 'List pipelines',   tags: ['Pipelines'], responses: { '200': { description: 'Array of pipelines' } } },
        post: { summary: 'Create pipeline',  tags: ['Pipelines'], requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreatePipelineRequest' } } } }, responses: { '200': { description: 'Created pipeline' } } },
      },
      '/pipelines/{id}': {
        get:    { summary: 'Get pipeline',    tags: ['Pipelines'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Pipeline' } } },
        patch:  { summary: 'Update pipeline', tags: ['Pipelines'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Updated pipeline' } } },
        delete: { summary: 'Delete pipeline', tags: ['Pipelines'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Deletion confirmation' } } },
      },
      '/pipelines/{id}/run': {
        post: {
          summary: 'Execute a saved pipeline',
          tags: ['Pipelines'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['input'], properties: { input: { type: 'string' } } } } } },
          responses: { '200': { description: 'Pipeline execution result with trace' } },
        },
      },
      '/probes': {
        get:  { summary: 'List probes',  tags: ['Probes'], responses: { '200': { description: 'Array of probes' } } },
        post: { summary: 'Create probe', tags: ['Probes'], requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreateProbeRequest' } } } }, responses: { '200': { description: 'Created probe' } } },
      },
      '/probes/{id}/run': {
        post: {
          summary: 'Manually trigger a probe run',
          tags: ['Probes'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Probe run result and metrics' } },
        },
      },
      '/atlas/library': {
        get:  { summary: 'List prompt library entries', tags: ['Atlas'], responses: { '200': { description: 'Prompt entries' } } },
        post: { summary: 'Add prompt to library',       tags: ['Atlas'], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, label: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } } } }, responses: { '200': { description: 'Created prompt entry' } } },
      },
      '/atlas/nearest': {
        post: {
          summary: 'Nearest-neighbour semantic search in prompt library',
          tags: ['Atlas'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, n: { type: 'integer', default: 5 } } } } } },
          responses: { '200': { description: 'Ranked prompt entries with cosine similarity scores' } },
        },
      },
    },
  }

  return new Response(JSON.stringify(spec, null, 2), {
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export const openApiRoutes: Array<[string, string, Handler]> = [
  ['GET', '/api/openapi.json', getSpec],
]
