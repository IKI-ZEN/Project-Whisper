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
      description: 'Multi-tenant AI sandbox platform with completions, pipelines, probes, vault, atlas, and environments.',
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
            name:          { type: 'string', maxLength: 128 },
            sandboxId:     { type: 'string', format: 'uuid' },
            environmentId: { type: 'string', format: 'uuid', description: 'Scope probe to an environment' },
            tool:          { type: 'string', enum: ['entropy', 'sweep', 'sensitivity', 'cot', 'pipeline', 'guard-rate'] },
            params:        { type: 'object' },
            schedule:      { type: 'string', enum: ['hourly', 'daily', 'weekly'] },
            threshold:     { type: 'number' },
            webhookUrl:    { type: 'string', maxLength: 512 },
          },
        },
        CreateEnvironmentRequest: {
          type: 'object',
          required: ['description', 'envType'],
          properties: {
            description: { type: 'string', minLength: 10, maxLength: 5000 },
            envType:     { type: 'string', enum: ['general', 'coding', 'research', 'structured', 'creative', 'agent', 'debate'] },
            envModels:   { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Ordered model list for compare mode' },
            name:        { type: 'string', maxLength: 128 },
          },
        },
        PatchEnvironmentRequest: {
          type: 'object',
          properties: {
            systemPrompt: { type: 'string', maxLength: 16384 },
            temperature:  { type: 'number', minimum: 0, maximum: 2 },
            maxTokens:    { type: 'integer', minimum: 64, maximum: 8192 },
            envModels:    { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
          },
        },
        ReplayRequest: {
          type: 'object',
          required: ['messages', 'targetConfig'],
          properties: {
            messages:        { type: 'array', items: { '$ref': '#/components/schemas/Message' }, minItems: 1, maxItems: 200 },
            targetConfig:    { type: 'object', description: 'Primary replay config (model, systemPrompt, temperature, maxTokens)' },
            batchConfigs:    { type: 'array', items: { type: 'object' }, maxItems: 5, description: 'Additional configs to replay in parallel' },
            batchEnvIds:     { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 5, description: 'Environment IDs — configs resolved at request time' },
            batchSandboxIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 5, description: 'Sandbox IDs — configs resolved at request time' },
          },
        },
        CreateAssertionSuiteRequest: {
          type: 'object',
          required: ['name', 'cases'],
          properties: {
            name:          { type: 'string', maxLength: 128 },
            description:   { type: 'string', maxLength: 512 },
            cases:         { type: 'array', maxItems: 50 },
            sandboxId:     { type: 'string', format: 'uuid' },
            environmentId: { type: 'string', format: 'uuid', description: 'Scope suite to an environment' },
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
      '/sandbox/{id}/security': {
        get: {
          summary: 'Security posture report (integrity, guard config, encryption, recent events)',
          tags: ['Sandbox'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Security posture summary' } },
        },
      },
      '/ai/pii-scan': {
        post: {
          summary: 'Detect (and optionally redact) PII in text',
          tags: ['AI'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, redact: { type: 'boolean' }, types: { type: 'array', items: { type: 'string', enum: ['email', 'credit_card', 'ssn', 'phone', 'ipv4'] } } } } } } },
          responses: { '200': { description: 'PII matches and optional redacted text' } },
        },
      },
      '/environments': {
        post: {
          summary: 'Create AI-configured chat environment',
          tags: ['Environments'],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreateEnvironmentRequest' } } } },
          responses: {
            '201': { description: 'Created environment with generated config and API URLs' },
            '422': { description: 'Generated config invalid — try a more detailed description' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
      '/environments/import': {
        post: {
          summary: 'Import a previously exported environment config',
          tags: ['Environments'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: 'Exported environment JSON (with optional HMAC signature)' } } } },
          responses: {
            '201': { description: 'Imported environment' },
            '422': { description: 'Invalid or tampered export payload' },
          },
        },
      },
      '/environments/{id}/export': {
        get: {
          summary: 'Export environment config as signed JSON',
          tags: ['Environments'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: 'Signed environment config JSON suitable for import' },
            '404': { description: 'Environment not found' },
          },
        },
      },
      '/environments/{id}/fork': {
        post: {
          summary: 'Fork an environment (copy config, empty memory, new ID)',
          tags: ['Environments'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '201': { description: 'New forked environment' },
            '404': { description: 'Source environment not found' },
          },
        },
      },
      '/environments/{id}': {
        patch: {
          summary: 'Update environment systemPrompt, temperature, maxTokens, or envModels',
          tags: ['Environments'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/PatchEnvironmentRequest' } } } },
          responses: {
            '200': { description: 'Updated environment config' },
            '404': { description: 'Environment not found' },
          },
        },
      },
      '/vault': {
        get: {
          summary: 'List vault records',
          tags: ['Vault'],
          parameters: [
            { name: 'q',              in: 'query', schema: { type: 'string' }, description: 'SQL LIKE text filter' },
            { name: 'tool',           in: 'query', schema: { type: 'string' } },
            { name: 'model',          in: 'query', schema: { type: 'string' } },
            { name: 'environment_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by environment' },
            { name: 'limit',          in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset',         in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'Paginated vault records' } },
        },
        post: {
          summary: 'Create vault record',
          tags: ['Vault'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, response: { type: 'string' }, model: { type: 'string' }, tool: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, environmentId: { type: 'string', format: 'uuid' } } } } } },
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
        get: {
          summary: 'List probes',
          tags: ['Probes'],
          parameters: [
            { name: 'sandboxId',     in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'environmentId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by environment' },
          ],
          responses: { '200': { description: 'Array of probes' } },
        },
        post: { summary: 'Create probe', tags: ['Probes'], requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreateProbeRequest' } } } }, responses: { '200': { description: 'Created probe' } } },
      },
      '/probes/{id}/run': {
        post: {
          summary: 'Manually trigger a probe run',
          tags: ['Probes'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Probe run result. data.passed is false when the threshold was breached.', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'object', properties: { passed: { type: 'boolean', description: 'false when the probe threshold was breached' }, metrics: { type: 'object' }, threshold: { type: 'object' } } } } } } } } },
        },
      },
      '/assertions': {
        get: {
          summary: 'List assertion suites',
          tags: ['Assertions'],
          parameters: [
            { name: 'sandboxId',     in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'environmentId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by environment' },
          ],
          responses: { '200': { description: 'Array of assertion suites' } },
        },
        post: {
          summary: 'Create assertion suite',
          tags: ['Assertions'],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/CreateAssertionSuiteRequest' } } } },
          responses: { '200': { description: 'Created suite' } },
        },
      },
      '/assertions/{id}/run': {
        post: {
          summary: 'Run an assertion suite',
          tags: ['Assertions'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Suite run results with pass/fail per case' } },
        },
      },
      '/replay': {
        post: {
          summary: 'Replay a conversation against one or more configs',
          tags: ['Replay'],
          requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/ReplayRequest' } } } },
          responses: { '200': { description: 'Replay result with per-turn similarity scores' } },
        },
      },
      '/replay/{id}': {
        get: {
          summary: 'Retrieve a previously stored replay result',
          tags: ['Replay'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'Replay result' } },
        },
      },
      '/atlas/library': {
        get: {
          summary: 'List prompt library entries',
          tags: ['Atlas'],
          parameters: [
            { name: 'q',             in: 'query', schema: { type: 'string' }, description: 'Text search' },
            { name: 'tag',           in: 'query', schema: { type: 'string' } },
            { name: 'environmentId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by environment' },
            { name: 'limit',         in: 'query', schema: { type: 'integer', default: 200 } },
          ],
          responses: { '200': { description: 'Prompt entries' } },
        },
        post: {
          summary: 'Add prompt to library',
          tags: ['Atlas'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, label: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, environmentId: { type: 'string', format: 'uuid' } } } } } },
          responses: { '200': { description: 'Created prompt entry' } },
        },
      },
      '/atlas/nearest': {
        post: {
          summary: 'Nearest-neighbour semantic search in prompt library',
          tags: ['Atlas'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, n: { type: 'integer', default: 5 } } } } } },
          responses: { '200': { description: 'Ranked prompt entries with cosine similarity scores' } },
        },
      },
      '/monitor/stream': {
        get: {
          summary: 'SSE stream of sandbox events',
          tags: ['Monitor'],
          parameters: [
            { name: 'since',          in: 'query', schema: { type: 'integer' }, description: 'Unix ms lower bound (default: now - 60s)' },
            { name: 'sandbox_id',     in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'environment_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by environment (resolves to sandbox_id)' },
          ],
          responses: { '200': { description: 'SSE stream', content: { 'text/event-stream': {} } } },
        },
      },
      '/monitor/audit': {
        get: {
          summary: 'Paginated audit log',
          tags: ['Monitor'],
          parameters: [
            { name: 'sandbox_id',     in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'environment_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by environment (resolves to sandbox_id)' },
            { name: 'event_type',     in: 'query', schema: { type: 'string' } },
            { name: 'since',          in: 'query', schema: { type: 'integer' } },
            { name: 'until',          in: 'query', schema: { type: 'integer' } },
            { name: 'limit',          in: 'query', schema: { type: 'integer', default: 50, maximum: 500 } },
            { name: 'offset',         in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { '200': { description: 'Paginated audit events' } },
        },
      },
      '/monitor/errors': {
        get: {
          summary: 'Paginated structured error log (CF Access required)',
          tags: ['Monitor'],
          parameters: [
            { name: 'context', in: 'query', schema: { type: 'string' }, description: 'Prefix filter on the context field (e.g. "queue", "scheduled")' },
            { name: 'limit',   in: 'query', schema: { type: 'integer', default: 50, maximum: 500 } },
            { name: 'offset',  in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': { description: 'Paginated error log entries', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'object', properties: { errors: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, context: { type: 'string' }, message: { type: 'string' }, stack: { type: 'string' }, created_at: { type: 'integer' } } } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } } } },
            '403': { description: 'CF Access authentication required', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
          },
        },
      },
      '/health/live': {
        get: {
          summary: 'Liveness check — always 200 if the Worker is running',
          tags: ['Health'],
          responses: { '200': { description: 'Worker is alive', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } } } } } } } } },
        },
      },
      '/health/ready': {
        get: {
          summary: 'Readiness check — probes D1, KV, and R2',
          tags: ['Health'],
          responses: {
            '200': { description: 'All bindings reachable', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] }, checks: { type: 'object', properties: { db: { type: 'string' }, kv: { type: 'string' }, r2: { type: 'string' } } } } } } } } } },
            '503': { description: 'One or more bindings degraded — same shape with status: "degraded"' },
          },
        },
      },
      '/vault/export.jsonl': {
        get: {
          summary: 'Export vault records as JSONL for fine-tuning',
          tags: ['Vault'],
          parameters: [
            { name: 'format', in: 'query', schema: { type: 'string', enum: ['openai', 'anthropic', 'hf'], default: 'openai' }, description: 'Output format. openai: {messages:[…]}, anthropic: {system,model,messages:[…]}, hf: {text:"USER:…\\nASSISTANT:…"}' },
            { name: 'tool',   in: 'query', schema: { type: 'string' }, description: 'Filter by tool' },
            { name: 'model',  in: 'query', schema: { type: 'string' }, description: 'Filter by model' },
            { name: 'since',  in: 'query', schema: { type: 'integer' }, description: 'Unix ms lower bound' },
            { name: 'limit',  in: 'query', schema: { type: 'integer', default: 500 } },
          ],
          responses: {
            '200': { description: 'JSONL stream — one JSON object per line', content: { 'application/x-ndjson': {} } },
            '422': { description: 'Unknown format value', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
          },
        },
      },
      '/ai/image': {
        post: {
          summary: 'Generate an image from a text prompt',
          tags: ['AI'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, model: { type: 'string' }, width: { type: 'integer', default: 1024 }, height: { type: 'integer', default: 1024 } } } } } },
          responses: {
            '200': { description: 'Generated image bytes', content: { 'image/png': {} } },
            '422': { description: 'Validation error', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
          },
        },
      },
      '/ai/transcribe': {
        post: {
          summary: 'Transcribe audio to text (Whisper)',
          tags: ['AI'],
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['audio'], properties: { audio: { type: 'string', format: 'binary' }, model: { type: 'string' } } } } } },
          responses: {
            '200': { description: 'Transcription result', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'object', properties: { text: { type: 'string' } } } } } } } },
            '422': { description: 'Validation error', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
          },
        },
      },
      '/ai/tts': {
        post: {
          summary: 'Text-to-speech synthesis',
          tags: ['AI'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, voice: { type: 'string' }, model: { type: 'string' } } } } } },
          responses: {
            '200': { description: 'Synthesised audio bytes', content: { 'audio/mpeg': {} } },
            '422': { description: 'Validation error', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
          },
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
