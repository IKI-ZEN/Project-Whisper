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

## What it runs on

Aether-Lite is built entirely on Cloudflare's global network. This means:

- **Fast everywhere** — apps run at the edge, close to your users worldwide
- **No servers to manage** — the infrastructure scales automatically
- **Always on** — no cold starts or downtime windows

---

## Playground

The Playground (`/playground.html`) is an in-browser developer interface with three tabs:

| Tab | Purpose |
|-----|---------|
| **Vibe Builder** | Create a new AI app from a description |
| **Sandbox Chat** | Load any sandbox by ID and chat with it directly |
| **AI Workbench** | Test raw AI capabilities: text generation, streaming, embeddings, image generation, and audio transcription |
