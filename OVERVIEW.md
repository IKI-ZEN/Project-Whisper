# Project Aether-Lite — Overview

## What is it?

Aether-Lite is a platform for building and deploying AI-powered apps without writing backend code. You describe what you want your app to do in plain English, and the platform designs, configures, and launches it in seconds.

Every app you create lives on Cloudflare's global network — no servers to provision, no infrastructure to manage. The platform has zero npm runtime dependencies; every HTTP request, streaming response, and data store interaction uses native Web Platform APIs.

---

## What can you build with it?

### Chat assistants

Conversational AI apps you can share as a link or embed anywhere:

- A customer support bot that answers questions about your product
- A writing helper tuned to your brand's tone and style
- A coding assistant pre-loaded with your team's conventions
- A document Q&A tool that explains complex content in plain language
- A creative writing partner or roleplay character

### Full multi-file web apps

The **App Builder** generates complete, working web applications from a description — not just a single chat window, but a structured project with HTML, JavaScript, CSS, and any additional files the app needs. You can build:

- Data dashboards with charts and live state
- To-do lists and task managers with persistent data
- Leaderboards and scoreboards that store entries between visits
- Settings panels or preference stores
- Contact forms and notification tools that send email
- Apps with image upload and display (photos, avatars, user content)

These apps are served immediately at their own URL — no deployment step required.

### Apps with persistent data

Generated apps have access to a built-in key-value store (backed by **AppStateDO**). Any value the app saves — a score, a setting, a list item — persists between visits and is accessible to every user on the same app. No database setup, no backend code.

### Apps with images

Generated apps can accept image uploads directly. Files are stored in R2 and served back at a stable URL — useful for photo galleries, avatar pickers, or anything that involves user-uploaded content.

### Apps that send email

Generated apps can send email through Cloudflare Email Routing — contact form submissions, notification alerts, summaries. Rate-limited automatically so apps can't be used as spam relays.

You can create as many sandboxes and built apps as you like. Each one is independent — its own persona, its own instructions, its own data.

---

## How does it work?

### 1. Describe your app (Vibe Builder)

Open the Playground and describe your app in a sentence or two. The platform uses AI to turn that description into a full configuration: a system prompt, a suitable AI model, the right creativity level, and a name.

You can review and tweak the generated config, then launch your app with one click.

### 2. Your app is live instantly

The moment you create a sandbox, it gets:

- **A shareable URL** — `/app/your-id` — a clean, full-screen chat interface anyone can open in a browser
- **An embed snippet** — a one-line `<iframe>` you can drop into any website or internal tool
- **A public API** — stable endpoints at `/s/your-id/run` and `/s/your-id/stream` that developers can call from their own apps
- **A short link** — `/s/your-id` redirects to the app page

### 3. The app remembers its conversation

Each sandbox keeps a rolling conversation history (up to 100 turns). Users can have a natural back-and-forth, and the AI remembers what was said earlier in the session. Multiple named sessions let different users maintain independent conversation threads within the same sandbox.

### 4. Apps gallery

The `/apps` page lists all your sandboxes in one place — name, description, model, and creation date. One click opens any app.

### 5. Building a multi-file app (App Builder)

The App Builder takes a description and generates an entire working web application through a two-phase pipeline.

**Blueprint phase** — the AI reads your description and produces a plan: which tech stack to use (vanilla HTML, Alpine.js, React, Vue, Svelte, or a Cloudflare Worker), which CDN libraries to include, and which files to create. You can watch this plan stream in as it's generated.

**File generation phase** — the AI generates each file one at a time, with content streaming in real time over a WebSocket. As each file is written, it is immediately saved and ready to serve.

Once all files are written, the app is live at `/build/:id` — no deploy step, no compilation, no waiting.

**`__BUILD_ID__` injection** — generated apps never need to hardcode their own ID. Every HTML file has the literal `__BUILD_ID__` replaced with the real build UUID at serve time. This means generated apps can read and write their own persistent state, upload images, and send email — all without knowing their ID at write time.

**Optional server-side logic** — if the app description calls for it, the App Builder can include a `worker.js` companion file in Cloudflare Worker format for any server-side logic the app needs.

**Thumbnail** — once the build is complete, a thumbnail SVG is automatically generated showing the app name, tech stack, and file list. It appears in build listings without needing a screenshot.

**One-click deploy** — a completed build can be deployed to Cloudflare Pages with a single API call, turning it from a hosted file into a full Pages project.

---

## Choosing an AI model

Aether-Lite supports several AI models out of the box:

| Model | Best for |
|-------|---------|
| Llama 3.1 8B | Fast, everyday tasks — default for most apps |
| Llama 3.3 70B | Complex reasoning, detailed analysis |
| GPT-4o | High-quality general purpose (requires OpenAI key) |
| GPT-4o Mini | Fast and cost-efficient OpenAI option |
| Claude Sonnet | Excellent writing and nuanced reasoning |
| Claude Opus | Most capable, best for hard problems |
| Gemini Flash | Fast Google model |

The Vibe Builder picks the most suitable model automatically based on your description. You can always change it.

---

## Sharing apps between instances

Any sandbox can be exported as a portable JSON config and imported into a completely separate deployment of Aether-Lite. This creates an independent copy with a new ID — the two sandboxes are unlinked after the import.

**To share a sandbox:**
- From the standalone app page (`/app/:id`), click **Share config** — the JSON is copied to your clipboard
- From the Playground Vibe Builder, the **Export config** field is populated automatically after creating an app

**To receive a shared sandbox:**
- In the Playground Vibe Builder sidebar, paste the JSON into the **Import sandbox** box and click **Import →**
- Programmatically: `POST /api/sandbox/import` with the JSON body, or `client.sandbox.import(config)` via the SDK

The export includes the name, description, system prompt, model, temperature, and token limit — but not conversation history.

---

## Embedding apps anywhere

The `<aether-lite-chat>` widget lets you embed any sandbox as a chat box on any webpage — no backend changes needed, just a single line of HTML:

```html
<aether-lite-chat sandbox-id="your-sandbox-id"></aether-lite-chat>
```

The widget streams AI responses and renders them as formatted Markdown — headings, bold text, code blocks, lists, and links all display correctly. It works in light or dark mode and is fully self-contained — it won't interfere with the rest of your page.

---

## For developers

If you want to integrate a sandbox or built app into your own application, the **vibe-sdk** (`/vibe-sdk.js`) is a JavaScript library that wraps the entire platform in a clean, fluent API:

```javascript
import { AetherLiteClient } from '/vibe-sdk.js'
const client = new AetherLiteClient()

// Create a new AI app from a description
const app = await client.vibes.create('A friendly cooking assistant')

// Chat with it
for await (const word of app.sandbox().stream('What should I make for dinner?')) {
  display(word)  // tokens arrive in real time as the AI types
}
```

### Building a full app

```javascript
// Build a complete multi-file app from a description
const session = client.builder.session('A to-do list app with local storage')
  .onBlueprintReady(bp => console.log('Tech stack:', bp.techStack))
  .onFileComplete(f => console.log('Generated:', f.filename))
  .onComplete(r => window.open(r.appUrl))

await session.start()
```

Once the build completes, you get an `AppHandle` for working with the result:

```javascript
// Open a handle to an existing build
const handle = await client.builder.get(buildId)

// Read and write persistent state
await handle.state.set('count', '42')
const { value } = await handle.state.get('count')

// Deploy to Cloudflare Pages
await handle.deploy()
```

### Charts with no dependencies

Generated apps (and your own apps) can import a zero-dependency SVG chart library:

```javascript
import { chart } from '/chart.js'

// Returns an SVG string — assign directly to innerHTML
container.innerHTML = chart(data, { type: 'bar' })
```

`chart.js` supports bar, line, and pie charts and produces inline SVG — no canvas, no external dependencies.

The SDK handles authentication, streaming, error handling, and retry logic automatically.

---

## For AI Whisperers

Aether-Lite is designed to get out of the way when you need to study how models actually behave. The following features are built specifically for researchers who probe attractor basins, test entropy, and explore activation patterns.

### Guard mode

Every sandbox has a `guardMode` setting that controls the prompt injection scanner:

| Mode | What it does |
|------|-------------|
| `strict` | Default. Blocks prompts that match injection patterns. |
| `audit` | Logs detected patterns to the audit trail but never blocks. Useful when you want a record of what triggered the scanner without interference. |
| `off` | Disables the scanner entirely. No restrictions, no logging overhead. |

Set it when creating a sandbox or patch it at any time:
```javascript
const sandbox = await client.sandbox.create({ ..., guardMode: 'off' })
// or later:
await sandbox.update({ guardMode: 'audit' })
```

### Model comparison

Run the same prompt across multiple models simultaneously and see the results side by side with per-model latency:

```javascript
const { data } = await client.ai.compare(
  ['@cf/meta/llama-3.1-8b-instruct', 'openai:gpt-4o', 'anthropic:claude-sonnet-4-6', 'google:gemini-2.0-flash'],
  'Describe consciousness in three words',
  { temperature: 1.2 }
)
data.results.forEach(r => console.log(`${r.model}: "${r.response}" (${r.latencyMs}ms)`))
```

### Temperature sweep

Run the same prompt at multiple temperatures and collect multiple samples per temperature. This maps the attractor basin structure of the model's learned distribution — where responses converge (low T) and where they diverge into high-entropy territory (high T):

```javascript
const { data } = await client.ai.sweep(
  'What is the meaning of life?',
  [0, 0.3, 0.7, 1.0, 1.5, 2.0],
  { model: 'anthropic:claude-sonnet-4-6', samples: 3 }
)
// data.results: [{ temperature, responses: string[], latencyMs }]
```

The **Whisperer** tab in the Playground provides a UI for all of these tools — a checkbox grid for model selection, a temperature table with configurable sampling depth, and dedicated panels for each analysis type.

### Prompt sensitivity analysis

Generate paraphrases of a prompt and measure how much the model's responses vary. Returns a similarity matrix across all variant pairs — useful for finding prompts that are stable (low variance) or fragile (high variance):

```javascript
const result = await client.ai.sensitivity('Explain recursion simply', { variants: 5 })
// result.variants: [{ prompt, response }]
// result.similarityMatrix: number[][] (cosine similarities)
```

### Semantic clustering

Embed a set of texts and group them with k-means clustering. Useful for categorising model outputs or finding natural groupings in a response set:

```javascript
const result = await client.ai.cluster(responses, { k: 3 })
// result.clusters: [{ label, items: string[] }]
```

### Chain-of-thought probing

Run the same prompt through four different reasoning styles in parallel (`plain`, `step-by-step`, `xml-structured`, `self-consistency`) and compare the outputs:

```javascript
const { results } = await client.ai.cot('Is it ever ethical to break a promise?')
results.forEach(r => console.log(r.style, r.response))
```

### Token entropy / attractor stability

Sample the model multiple times at a given temperature and measure response diversity (entropy + average cosine similarity). Low entropy = strong attractor. High entropy = diffuse distribution:

```javascript
const result = await client.ai.entropy('Name a colour', { samples: 10, temperature: 1.5 })
// result.entropy: number (bits), result.avgCosineSimilarity: number
```

### Prompt archaeology

Given a target response, reverse-engineer candidate system prompts that could have produced it. Useful for understanding the implicit prior a model is reasoning from:

```javascript
const { candidates } = await client.ai.archaeology(targetResponse, { candidates: 5 })
candidates.forEach(c => console.log(c.similarity, c.candidate))
```

### Pipeline executor

Build a declarative node graph of AI steps — each node can classify, complete, guard, transform, or fan out to parallel branches. Output routes to the next node based on content:

```javascript
const result = await client.ai.pipeline(userInput, nodes, 'entry-node-id')
// result.output: final string, result.trace: per-node execution log
```

### Extended thinking

Request an explicit reasoning trace before the final answer. Uses Anthropic's native extended thinking for `anthropic:*` models, and XML-structured chain-of-thought for others:

```javascript
const { thinking, response } = await client.ai.think('Solve this step by step: …', {
  model: 'anthropic:claude-sonnet-4-6',
  budgetTokens: 4000,
})
```

### Markdown rendering in the chat widget

The `<aether-lite-chat>` web component renders AI responses as formatted Markdown — useful when probing a model's structured output or comparing formatting consistency across models and temperatures.

### Integrity verification

Every sandbox config has a SHA-256 fingerprint that includes the current message count as a thread-length salt. The Playground's Chat sidebar shows the live hash and raises a tamper warning if the stored fingerprint doesn't match — useful for verifying that a sandbox config hasn't been modified between sessions. You can also poll `GET /api/sandbox/:id/fingerprint` from a monitoring script without exposing the system prompt.

### Signed config sharing

When `SIGNING_SECRET` is configured on the server, exported configs carry an HMAC-SHA256 signature. Recipients can verify the signature on import — if the JSON was modified in transit, the import is rejected with a 422. This is useful for sharing carefully crafted system prompts or research configurations between instances with provenance guarantees.

---

## What it runs on

Aether-Lite is built entirely on Cloudflare's global network. This means:

- **Fast everywhere** — apps run at the edge, close to your users worldwide
- **No servers to manage** — the infrastructure scales automatically
- **Always on** — no cold starts or downtime windows

The platform uses these Cloudflare primitives:

| What | How |
|------|-----|
| Worker entry point | Routes every request; zero npm runtime dependencies |
| SandboxDO | One Durable Object per sandbox — stores config, memory, and rate-limit state |
| AppBuilderDO | Multi-file app generation pipeline, WebSocket-driven, one instance per build |
| AppStateDO | Persistent key-value store for generated apps (to-do lists, leaderboards, settings) |
| Workers KV | Sandbox registry and sliding-window rate limits |
| R2 | Documents, generated app files, images, and build thumbnails |
| D1 (SQLite) | Audit log and usage metrics |
| Vectorize | 768-dimension vector index for document RAG |
| Queues | Background document processing and embedding jobs |
| Workers AI | On-network inference for `@cf/*` models |
| Cloudflare AI Gateway | Proxy for OpenAI, Anthropic, and Google models |
| Email Routing | Outbound email from generated apps (`SEND_EMAIL` binding) |
| Cloudflare Pages | Deploy target for finished App Builder projects |

---

## Playground

The Playground (`/playground.html`) is an in-browser developer interface with four tabs:

| Tab | Purpose |
|-----|---------|
| **Vibe Builder** | Two modes: **Quick Sandbox** (describe an AI assistant, launch instantly) and **App Builder** (generate a full multi-file web app). Also handles export/import of sandbox configs. |
| **Sandbox Chat** | Load any sandbox by ID, chat, edit config (including `guardMode`), view integrity badge |
| **AI Workbench** | Test raw AI capabilities: text generation, streaming, embeddings, image generation, audio transcription |
| **Whisperer** | Full AI analysis suite: model comparison, temperature sweep, sensitivity analysis, semantic clustering, chain-of-thought probing, entropy measurement, prompt archaeology, pipeline executor, and extended thinking |
