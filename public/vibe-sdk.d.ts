/**
 * vibeSDK TypeScript declarations
 * Project Aether-Lite
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
  compare(models: string[], prompt: string, opts?: CompareOpts): Promise<{ ok: boolean; data: { results: CompareResult[] } }>
  /** Run the same prompt at multiple temperatures to map attractor basin behavior. */
  sweep(prompt: string, temperatures: number[], opts?: SweepOpts): Promise<{ ok: boolean; data: { results: SweepResult[]; model: string } }>
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

  run(message: string): Promise<string>
  stream(message: string): AsyncGenerator<string>
  history(): Promise<Message[]>
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

// ── VibeResult ────────────────────────────────────────────────────────────────

export class VibeResult {
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

// ── VibesClient ───────────────────────────────────────────────────────────────

export class VibesClient {
  templates(): Promise<VibeTemplate[]>
  create(description: string, name?: string): Promise<VibeResult>
}

// ── VibeClient ────────────────────────────────────────────────────────────────

export class VibeClient {
  /**
   * @param baseUrl Base URL of the Aether-Lite Worker. Defaults to same origin ('').
   */
  constructor(baseUrl?: string)
  readonly ai: AiClient
  readonly sandbox: SandboxClient
  readonly vibes: VibesClient
}

// ── <vibe-chat> web component ─────────────────────────────────────────────────

/**
 * Drop-in chat widget. Renders in Shadow DOM.
 *
 * @example
 * <vibe-chat sandbox-id="abc123"></vibe-chat>
 * <vibe-chat sandbox-id="xyz" theme="dark" placeholder="Ask me..."></vibe-chat>
 */
export interface VibeChatAttributes {
  /** Required. ID of the sandbox to connect to. */
  'sandbox-id': string
  /** Base URL of the Worker. Defaults to same origin. */
  'base-url'?: string
  /** Input placeholder text. */
  placeholder?: string
  /** Color theme. */
  theme?: 'light' | 'dark'
}

declare global {
  interface HTMLElementTagNameMap {
    'vibe-chat': HTMLElement & VibeChatAttributes
  }
}
