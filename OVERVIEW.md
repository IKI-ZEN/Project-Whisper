# Project Aether-Lite — Overview

## What is it?

Aether-Lite is a platform for building and deploying AI-powered chat apps without writing backend code. You describe what you want your app to do in plain English, and the platform designs, configures, and launches a live AI assistant in seconds.

Every app you create — called a **sandbox** — is immediately usable as a standalone web page, an embeddable widget, or a programmable API endpoint.

---

## What can you build with it?

Anything that benefits from a conversational AI assistant:

- A customer support bot that answers questions about your product
- A writing helper tuned to your brand's tone and style
- A coding assistant pre-loaded with your team's conventions
- A document Q&A tool that explains complex content in plain language
- A creative writing partner or roleplay character
- A data explainer that surfaces insights from reports

You can create as many sandboxes as you like. Each one is independent — its own persona, its own instructions, its own conversation history.

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

Each sandbox keeps a rolling conversation history (up to 100 turns). Users can have a natural back-and-forth, and the AI remembers what was said earlier in the session.

### 4. Apps gallery

The `/apps` page lists all your sandboxes in one place — name, description, model, and creation date. One click opens any app.

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

The `<vibe-chat>` widget lets you embed any sandbox as a chat box on any webpage — no backend changes needed, just a single line of HTML:

```html
<vibe-chat sandbox-id="your-sandbox-id"></vibe-chat>
```

It works in light or dark mode and is fully self-contained — it won't interfere with the rest of your page.

---

## For developers

If you want to integrate a sandbox into your own application, the **vibeSDK** (`/vibe-sdk.js`) is a JavaScript library that wraps the entire platform in a clean, fluent API:

```javascript
import { VibeClient } from '/vibe-sdk.js'
const client = new VibeClient()

// Create a new AI app from a description
const app = await client.vibes.create('A friendly cooking assistant')

// Chat with it
for await (const word of app.sandbox().stream('What should I make for dinner?')) {
  display(word)  // tokens arrive in real time as the AI types
}
```

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

The **Whisperer** tab in the Playground provides a UI for both of these — a checkbox grid for model selection and a temperature table with configurable sampling depth.

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

---

## Playground

The Playground (`/playground.html`) is an in-browser developer interface with four tabs:

| Tab | Purpose |
|-----|---------|
| **Vibe Builder** | Create a new AI app from a description, export/import configs |
| **Sandbox Chat** | Load any sandbox by ID, chat, edit config (including `guardMode`), view integrity badge |
| **AI Workbench** | Test raw AI capabilities: text generation, streaming, embeddings, image generation, audio transcription |
| **Whisperer** | Model comparison (checkbox grid, parallel results with latency) and temperature sweep (gradient table with multi-sample support) |
