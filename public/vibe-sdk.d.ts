/**
 * Whisper SDK TypeScript declarations
 * Project Whisper
 */

// ── Shared types ──────────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface CompleteOpts {
  model?: string
  prompt?: string
  messages?: Message[]
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: 'json' | string
  reasoningEffort?: 'low' | 'medium' | 'high'
  thinking?: number
  groundingEnabled?: boolean
  tools?: object[]
  fallbackModel?: string
  byokAlias?: string
  zdr?: boolean
  collectLogPayload?: boolean
}

export interface CompareResult {
  model: string
  response: string | null
  latencyMs: number
  error: string | null
}

export interface SweepResult {
  temperature: number
  responses: string[]
  latencyMs: number
}

export interface CompareOpts {
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

export interface SweepOpts {
  model?: string
  systemPrompt?: string
  maxTokens?: number
  samples?: number
}

export interface SensitivityOpts {
  variants?: number
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
}

export interface SensitivityResult {
  variants: Array<{ prompt: string; response: string }>
  similarityMatrix: number[][]
  latencyMs: number
}

export interface ClusterOpts {
  k?: number
  model?: string
}

export interface ClusterResult {
  k: number
  labels: number[]
  clusters: Array<{ label: number; items: string[] }>
  similarityMatrix: number[][]
  latencyMs: number
}

export interface CotOpts {
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  samples?: number
}

export interface CotProbeResult {
  style: 'plain' | 'step-by-step' | 'xml-structured' | 'self-consistency'
  response: string
  latencyMs: number
}

export interface EntropyOpts {
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  samples?: number
}

export interface EntropyResult {
  samples: string[]
  entropy: number
  avgCosineSimilarity: number
  latencyMs: number
}

export interface ArchaeologyOpts {
  probe?: string
  model?: string
  candidates?: number
  maxTokens?: number
}

export interface ArchaeologyCandidate {
  candidate: string
  similarity: number
}

export interface PipelineRoute {
  condition: string
  nextId: string
}

export interface PipelineNode {
  id: string
  type: 'complete' | 'classify' | 'guard' | 'transform' | 'parallel'
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  template?: string
  branches?: string[]
  select?: 'first' | 'best' | 'all'
  routes: PipelineRoute[]
}

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

export interface PipelineOpts {
  maxDepth?: number
}

export interface ThinkOpts {
  model?: string
  systemPrompt?: string
  maxTokens?: number
  budgetTokens?: number
}

export interface ThinkResult {
  thinking: string
  response: string
  latencyMs: number
}

export interface ToolCallDef {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ImageOpts {
  model?: string
  steps?: number
}

export interface DocumentMeta {
  docId: string
  name: string
  mimeType: string
  size: number
  uploadedAt: number
  status: 'processing' | 'indexed' | 'error'
}

export interface UsageMetrics {
  totalRuns: number
  totalTokensIn: number
  totalTokensOut: number
  avgLatencyMs: number
  modelBreakdown: Array<{ model: string; runs: number; tokensIn: number; tokensOut: number }>
}

export interface SandboxMeta {
  id: string
  name: string
  description: string
  model: string
  createdAt: number
  fromVibe?: boolean
}

// ── App Builder types ─────────────────────────────────────────────────────────

export type BuildStatus = 'idle' | 'blueprinting' | 'generating' | 'complete' | 'error'

export interface BlueprintFile {
  filename: string
  description: string
  role: 'entry' | 'logic' | 'styles' | 'component'
}

export interface Blueprint {
  name: string
  techStack: 'vanilla' | 'alpine' | 'react' | 'vue' | 'svelte'
  cdnDependencies: string[]
  files: BlueprintFile[]
  sandboxIntegration: boolean
}

export interface BuildState {
  id: string
  name: string
  description: string
  sandboxId?: string
  model: string
  status: BuildStatus
  blueprint?: Blueprint
  files: string[]
  errorMessage?: string
  createdAt: number
  completedAt?: number
}

export interface AppSessionOpts {
  name?: string
  sandboxId?: string
  model?: string
}

export interface BuildMeta {
  id: string
  name: string
  description: string
  model: string
  createdAt: number
}

// ── Sandbox types ─────────────────────────────────────────────────────────────

export interface SandboxExport {
  version: 1
  name: string
  description: string
  systemPrompt: string
  tools: object[]
  model: string
  temperature: number
  maxTokens: number
}

export interface CreateSandboxOpts {
  name: string
  description: string
  systemPrompt: string
  tools?: object[]
  model: string
  temperature: number
  maxTokens: number
  ragEnabled?: boolean
}

export interface VibeTemplate {
  id: string
  name: string
  tags: string[]
  description: string
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class VibeError extends Error {
  readonly status: number
  readonly detail: unknown
  constructor(message: string, status?: number, detail?: unknown)
}

// ── AiClient ──────────────────────────────────────────────────────────────────

export class AiClient {
  complete(opts: CompleteOpts): Promise<string>
  stream(opts: CompleteOpts): AsyncGenerator<string>
  embed(text: string | string[], model?: string): Promise<number[][]>
  image(prompt: string, opts?: ImageOpts): Promise<string>
  transcribe(audio: File | Blob, model?: string): Promise<string>
  /** Run the same prompt across multiple models in parallel. Returns results with latency. */
  compare(models: string[], prompt: string, opts?: CompareOpts): Promise<{ results: CompareResult[] }>
  /** Run the same prompt at multiple temperatures to map attractor basin behavior. */
  sweep(prompt: string, temperatures: number[], opts?: SweepOpts): Promise<{ results: SweepResult[]; model: string }>
  /** Prompt sensitivity analysis — generate paraphrases and measure response variance. */
  sensitivity(prompt: string, opts?: SensitivityOpts): Promise<SensitivityResult>
  /** Semantic clustering — embed texts and k-means cluster by cosine similarity. */
  cluster(texts: string[], opts?: ClusterOpts): Promise<ClusterResult>
  /** Chain-of-thought probing — run 4 reasoning styles in parallel and compare outputs. */
  cot(prompt: string, opts?: CotOpts): Promise<{ results: CotProbeResult[] }>
  /** Token entropy / attractor stability — sample the model and measure response diversity. */
  entropy(prompt: string, opts?: EntropyOpts): Promise<EntropyResult>
  /** Prompt archaeology — reverse-engineer candidate system prompts from a target response. */
  archaeology(targetResponse: string, opts?: ArchaeologyOpts): Promise<{ candidates: ArchaeologyCandidate[] }>
  /** Pipeline executor — declarative node graph with per-node model routing. */
  pipeline(input: string, nodes: PipelineNode[], entryId: string, opts?: PipelineOpts): Promise<PipelineResult>
  /** Extended thinking — explicit reasoning trace. Uses Anthropic thinking for anthropic:* models. */
  think(prompt: string, opts?: ThinkOpts): Promise<ThinkResult>
  /** Check if a SandboxHandle.run() reply contains a tool call rather than plain text. */
  static isToolCall(reply: string): boolean
  /** Parse tool calls from a run() reply. */
  static parseToolCalls(reply: string): ToolCallDef[]
  /** Encode a tool result to send back via run(). */
  static encodeToolResult(toolUseId: string, toolName: string, content: string): string
}

// ── SandboxConnection (WebSocket) ─────────────────────────────────────────────

export class SandboxConnection {
  constructor(ws: WebSocket)
  onToken(fn: (token: string) => void): this
  onToolCall(fn: (calls: ToolCallDef[]) => void): this
  onDone(fn: (reply: string) => void): this
  onError(fn: (err: VibeError) => void): this
  onClose(fn: () => void): this
  send(content: string): void
  submitToolResults(results: Array<{ toolUseId: string; toolName: string; content: string }>): void
  readonly readyState: 'connecting' | 'open' | 'closing' | 'closed'
  close(): void
}

// ── SandboxHandle ─────────────────────────────────────────────────────────────

export class SandboxHandle {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly model: string
  readonly systemPrompt: string
  readonly temperature: number
  readonly maxTokens: number
  readonly appUrl: string
  readonly shortLink: string
  /** SHA-256 fingerprint of config + conversation length. Null on legacy sandboxes. */
  readonly integrityHash: string | null
  /** True if stored hash doesn't match live config — indicates out-of-band tampering. */
  readonly tampered: boolean
  /** Guard mode for this sandbox: 'strict' blocks injections, 'audit' logs only, 'off' disables scanning. */
  readonly guardMode: 'strict' | 'audit' | 'off'
  /** Whether RAG is enabled — relevant document chunks are injected into prompts. */
  readonly ragEnabled: boolean
  /** Tool definitions available to the sandbox's model. */
  readonly tools: object[]
  /** Custom HTML page served at /app/:id; generated by Vibe Builder. Undefined for non-vibe sandboxes. */
  readonly appHtml: string | undefined

  run(message: string, sessionId?: string): Promise<string>
  stream(message: string, sessionId?: string): AsyncGenerator<string>
  history(sessionId?: string): Promise<Message[]>
  /** Open a WebSocket connection for bidirectional real-time conversation with tool call support. */
  connect(sessionId?: string): SandboxConnection
  update(patch: Partial<CreateSandboxOpts>): Promise<void>
  delete(): Promise<void>
  export(): Promise<SandboxExport>
  uploadDocument(file: File): Promise<{ docId: string; name: string; size: number; status: string }>
  listDocuments(): Promise<{ docs: DocumentMeta[]; total: number }>
  deleteDocument(docId: string): Promise<void>
  metrics(): Promise<UsageMetrics>
}

// ── SandboxClient ─────────────────────────────────────────────────────────────

export class SandboxClient {
  list(): Promise<SandboxMeta[]>
  create(opts: CreateSandboxOpts): Promise<SandboxHandle>
  get(id: string): Promise<SandboxHandle>
  delete(id: string): Promise<void>
  import(config: SandboxExport | CreateSandboxOpts): Promise<SandboxHandle>
}

// ── VibeBuilderResult ─────────────────────────────────────────────────────────

/** Result of a quick sandbox creation via VibesClient.create(). */
export class VibeBuilderResult {
  readonly sandboxId: string
  readonly name: string
  readonly description: string
  readonly model: string
  readonly appUrl: string
  readonly shortLink: string
  readonly embedCode: string
  readonly shortApi: { run: string; stream: string }
  readonly config: { systemPrompt: string; temperature: number; maxTokens: number }

  /** Return a SandboxHandle for this vibe's sandbox. */
  sandbox(): SandboxHandle
}

/** @deprecated Use VibeBuilderResult */
export const VibeResult: typeof VibeBuilderResult

// ── VibesClient ───────────────────────────────────────────────────────────────

/** Quick AI-assistant creator (single sandbox + custom HTML). */
export class VibesClient {
  templates(): Promise<VibeTemplate[]>
  create(description: string, name?: string, mode?: 'app' | 'environment' | 'dashboard'): Promise<VibeBuilderResult>
}

// ── AppStateHandle ────────────────────────────────────────────────────────────

/** Persistent key-value store for a generated app. Backed by a Durable Object. */
export class AppStateHandle {
  constructor(base: string, buildId: string)
  get(key: string): Promise<{ key: string; value: string } | null>
  set(key: string, value: string): Promise<void>
  list(): Promise<Array<{ key: string; value: string }>>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

// ── AppHandle ─────────────────────────────────────────────────────────────────

/** Handle to a completed (or in-progress) app build. */
export class AppHandle {
  readonly id: string
  readonly name: string
  readonly status: BuildStatus
  readonly errorMessage: string | undefined
  readonly files: string[]
  /** URL where the generated app is served. */
  readonly appUrl: string
  /** URL of the SVG metadata thumbnail for this build. */
  readonly thumbnailUrl: string
  /** Persistent key-value state store for this app. */
  readonly state: AppStateHandle

  getFile(filename: string): Promise<string>
  /** Deploy to Cloudflare Pages. Requires CLOUDFLARE_API_TOKEN server-side. */
  deploy(): Promise<{ deploymentUrl: string; deploymentId?: string; projectName: string }>
  delete(): Promise<void>
}

// ── AppSession ────────────────────────────────────────────────────────────────

/**
 * WebSocket-driven build session. Streams real-time progress events
 * from blueprint generation through file-by-file code generation.
 * Inspired by Cloudflare VibeSDK's BuildSession.
 */
export class AppSession {
  constructor(baseUrl: string, description: string, opts?: AppSessionOpts)

  onBlueprintStart(fn: () => void): this
  onBlueprintChunk(fn: (text: string) => void): this
  onBlueprintReady(fn: (blueprint: Blueprint) => void): this
  onFileStart(fn: (info: { filename: string; index: number; total: number }) => void): this
  onFileChunk(fn: (info: { filename: string; text: string }) => void): this
  onFileComplete(fn: (info: { filename: string; bytes: number }) => void): this
  onComplete(fn: (result: { buildId: string; appUrl: string; files: string[]; thumbnailUrl: string | undefined }) => void): this
  onError(fn: (err: VibeError) => void): this

  /** Start the build — creates the build record then opens WebSocket. Returns this for chaining. */
  start(): Promise<this>
  /** Stop the build (closes WebSocket). */
  stop(): void

  readonly buildId: string | null
  readonly status: BuildStatus | 'idle' | 'connecting'
  readonly appUrl: string | null
}

// ── AppBuilder ────────────────────────────────────────────────────────────────

/**
 * Client for the Whisper App Builder — generates multi-file web apps
 * from natural language descriptions, stored in R2 and served at /build/:id.
 * Inspired by Cloudflare VibeSDK's PhasicClient.
 */
export class AppBuilder {
  constructor(baseUrl?: string)
  /** List all builds (requires metadata stored at creation time). */
  list(): Promise<BuildMeta[]>
  /** Create a new build session (lazy — call .start() to begin). */
  session(description: string, opts?: AppSessionOpts): AppSession
  /** Load an existing build by ID. */
  get(buildId: string): Promise<AppHandle>
  /** Delete a build and its generated files. */
  delete(buildId: string): Promise<void>
}

// ── WhisperClient ──────────────────────────────────────────────────────────

/**
 * Main entry point for the Whisper SDK.
 * Provides access to AI inference, sandbox management, quick vibe creation,
 * and the full multi-file App Builder.
 */
export class WhisperClient {
  /**
   * @param baseUrl Base URL of the Whisper Worker. Defaults to same origin ('').
   */
  constructor(baseUrl?: string)
  readonly ai: AiClient
  readonly sandbox: SandboxClient
  readonly vibes: VibesClient
  readonly builder: AppBuilder
}

/** @deprecated Use WhisperClient */
export const VibeClient: typeof WhisperClient

// ── Web components ────────────────────────────────────────────────────────────

export interface WhisperChatAttributes {
  /** Required. ID of the sandbox to connect to. */
  'sandbox-id': string
  /** Base URL of the Worker. Defaults to same origin. */
  'base-url'?: string
  /** Input placeholder text. */
  placeholder?: string
  /** Color theme. */
  theme?: 'light' | 'dark'
}

/** @deprecated Use WhisperChatAttributes */
export interface VibeChatAttributes extends WhisperChatAttributes {}

declare global {
  interface HTMLElementTagNameMap {
    'whisper-chat': HTMLElement & WhisperChatAttributes
    'vibe-chat':    HTMLElement & VibeChatAttributes
  }
}
