# Cloudflare Sandbox SDK — Reference

The Sandbox SDK enables secure, isolated code execution environments powered by Cloudflare Workers and Containers. Sandboxes run in isolated Linux containers with a full filesystem, network, and process model.

> **Availability**: Workers Paid plan. Built on Cloudflare Containers.

---

## Table of Contents

1. [What It Is](#1-what-it-is)
2. [Core Features](#2-core-features)
3. [Key API Surface](#3-key-api-surface)
4. [How It Relates to Project Whisper](#4-how-it-relates-to-project-whisper)
5. [Integration Pattern](#5-integration-pattern)
6. [Security Model](#6-security-model)
7. [Limits and Pricing](#7-limits-and-pricing)
8. [Further Reading](#8-further-reading)

---

## 1. What It Is

The Cloudflare Sandbox SDK (`@cloudflare/sandbox`) wraps Cloudflare Containers to give Workers a simple TypeScript API for running untrusted code. You get a full Linux environment with:

- Command execution with streaming output
- File read/write/mkdir/watch
- Background process management
- HTTP service exposure via preview URLs
- Terminal (WebSocket) access
- S3-compatible bucket mounting (R2, AWS S3, GCS)

Each call to `getSandbox(env.Sandbox, 'some-id')` returns a handle to a container scoped to that ID. The ID controls isolation: same ID = same container; different ID = different container.

---

## 2. Core Features

| Feature | Description |
|---------|-------------|
| **Command execution** | `sandbox.exec(cmd)` — run shell commands, Python scripts, Node.js apps. Returns `{ stdout, stderr, exitCode, success }`. Supports streaming output. |
| **Code interpreter** | `sandbox.createCodeContext({ language: 'python' \| 'javascript' })` + `sandbox.runCode(src, { context })` — execute code with rich outputs (charts, tables, images). State persists between calls in the same context. |
| **File operations** | `readFile`, `writeFile`, `mkdir`, `listDir`, `deleteFile`. Standard path-based access to the container filesystem. |
| **File watching** | `sandbox.watch(path, { include, onEvent, onError })` — real-time filesystem change events for hot reloading, build automation. |
| **Background processes** | Start processes, monitor stdout/stderr, send signals. |
| **Preview URLs** | Expose an HTTP server running inside the container via an automatically generated public URL. |
| **Browser terminal** | `sandbox.terminal(request, { cols, rows })` — WebSocket terminal — connects a browser's xterm.js directly to the container shell. |
| **WebSocket proxy** | `sandbox.wsConnect(request, port)` — forward WebSocket connections to a service inside the container. |
| **Bucket mounting** | Mount R2 or any S3-compatible bucket as a local filesystem path. Persists across container lifecycles. Requires production deployment. |
| **Request proxying** | Keep credentials in the Worker; sandbox calls a proxy endpoint that injects real secrets. Uses short-lived JWT tokens scoped to each sandbox. |

---

## 3. Key API Surface

```typescript
import { getSandbox } from '@cloudflare/sandbox'
export { Sandbox } from '@cloudflare/sandbox'

// In wrangler.toml:
// [[durable_objects.bindings]]
// name = "Sandbox"
// class_name = "Sandbox"

const sandbox = getSandbox(env.Sandbox, 'user-123')

// Execute a command
const { stdout, exitCode } = await sandbox.exec('python3 -c "print(1+1)"')

// Run Python with rich output
const ctx = await sandbox.createCodeContext({ language: 'python' })
const result = await sandbox.runCode('import pandas as pd; pd.DataFrame({"a": [1,2]}).sum()', { context: ctx })

// File operations
await sandbox.writeFile('/workspace/main.py', 'print("hello")')
const content = await sandbox.readFile('/workspace/main.py')

// Expose an HTTP server running inside the container
const { url } = await sandbox.exposeService(3000)

// WebSocket terminal
return sandbox.terminal(request, { cols: 80, rows: 24 })
```

---

## 4. How It Relates to Project Whisper

Project Whisper already has a concept of **Sandboxes** (Durable Objects that hold AI conversation state, system prompts, and tool definitions). The Cloudflare Sandbox SDK is a different, complementary primitive: it provides actual **code execution** within an isolated Linux container.

The two can be combined:

| Project Whisper Sandbox | Cloudflare Sandbox SDK |
|------------------------|----------------------|
| AI conversation context | Code execution environment |
| System prompt + memory | Full Linux filesystem |
| Tool definitions (JSON Schema) | Real executables (Python, Node, bash) |
| Model routing | Untrusted code isolation |
| Persistent via Durable Object | Persistent via container ID |

### High-value integration scenarios

**1. Code execution tool for AI agents**

A Whisper sandbox with a `code_interpreter` tool definition could route `tool_call` responses to a Cloudflare Sandbox SDK container, execute the generated code, and return the result as the tool response — giving AI agents a real code execution environment without managing infrastructure.

**2. Generative app builder execution**

The existing `AppBuilderDO` generates HTML/CSS/JS apps (`/api/v2/build/`). If the builder generates server-side code (Python scripts, data analysis), Sandbox SDK containers could run that code on demand. The container is addressable by app ID, providing per-app isolation.

**3. Probe execution in isolated environments**

The Probes subsystem (`src/routes/probes.ts`) runs analysis tools on a schedule. A `'sandbox-exec'` probe type could run a script in an isolated container and record its output/exit code as a metric — useful for testing external integrations or running data pipelines.

**4. Interactive terminal in the dashboard**

`sandbox.terminal(request, { cols, rows })` returns a Response that directly bridges a WebSocket connection to the container shell. Combined with the existing WebSocket upgrade infrastructure in `src/index.ts`, this could power an in-browser terminal for development sandboxes.

---

## 5. Integration Pattern

### wrangler.toml additions

```toml
[[durable_objects.bindings]]
name = "SandboxExec"       # distinct from existing SANDBOX binding
class_name = "Sandbox"

[[migrations]]
tag = "v2"
new_sqlite_classes = ["Sandbox"]
```

### env.d.ts addition

```typescript
SandboxExec: DurableObjectNamespace  // Cloudflare Sandbox SDK DO
```

### Worker usage

```typescript
import { getSandbox } from '@cloudflare/sandbox'

// Inside a route handler:
const container = getSandbox(env.SandboxExec, `exec-${sandboxId}`)
const { stdout, exitCode } = await container.exec('python3 script.py')
```

### Dependency note

The Sandbox SDK is an **npm dependency** (`@cloudflare/sandbox`). Project Whisper's CLAUDE.md rule — "Zero runtime npm dependencies" — would need a deliberate exception for this integration. The SDK is a thin wrapper around the Containers Durable Object binding, not a heavy runtime library, but the rule would still technically be broken. Discuss before adopting.

---

## 6. Security Model

- Each container is isolated at the OS level (Cloudflare's gVisor-based container runtime).
- Code inside the container cannot access the Worker's `env` object, secrets, or KV/D1 bindings directly — only via the request-proxying pattern (Worker validates a short-lived JWT the container presents, then adds real credentials).
- File operations are confined to the container's filesystem; containers do not share filesystems.
- Container lifetime: containers hibernate when idle and resume on the next request. Persistent data requires either mounted R2 buckets or re-initializing from the Worker on resume.

---

## 7. Limits and Pricing

Pricing is based on the underlying Containers platform:
- `https://developers.cloudflare.com/sandbox/platform/pricing/`

Limits (container resources, max execution time, concurrency):
- `https://developers.cloudflare.com/sandbox/platform/limits/`

---

## 8. Further Reading

- **Get started**: `https://developers.cloudflare.com/sandbox/get-started/`
- **API reference**: `https://developers.cloudflare.com/sandbox/api/`
- **Code execution guide**: `https://developers.cloudflare.com/sandbox/guides/code-execution/`
- **Browser terminals**: `https://developers.cloudflare.com/sandbox/guides/browser-terminals/`
- **Request proxying (credential injection)**: `https://developers.cloudflare.com/sandbox/guides/proxy-requests/`
- **Bucket mounting (R2)**: `https://developers.cloudflare.com/sandbox/guides/mount-buckets/`
- **GitHub repository**: `https://github.com/cloudflare/sandbox-sdk`
- **Related**: Cloudflare Containers (underlying runtime), Durable Objects (coordination layer), Workers AI (LLM integration)
