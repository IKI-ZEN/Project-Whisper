// ── Model registry ────────────────────────────────────────────────────────────

export const MODELS = {
  // Workers AI (no API key needed)
  text:         '@cf/meta/llama-3.1-8b-instruct',
  textLarge:    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  embed:        '@cf/baai/bge-base-en-v1.5',
  image:        '@cf/black-forest-labs/flux-1-schnell',
  transcribe:   '@cf/openai/whisper',
  // OpenAI via AI Gateway
  gpt4o:        'openai:gpt-4o',
  gpt4oMini:    'openai:gpt-4o-mini',
  // Anthropic via AI Gateway
  claude:       'anthropic:claude-sonnet-4-6',
  claudeOpus:   'anthropic:claude-opus-4-7',
  // Google via AI Gateway
  gemini:       'google:gemini-2.0-flash',
  geminiPro:    'google:gemini-1.5-pro',
  // Groq — ultra-fast inference
  groqLlama:    'groq:llama-3.3-70b-versatile',
  groqFast:     'groq:llama-3.1-8b-instant',
  // Mistral AI
  mistral:      'mistral:mistral-large-latest',
  mistralSmall: 'mistral:mistral-small-latest',
  // DeepSeek
  deepseek:     'deepseek:deepseek-chat',
  deepseekR1:   'deepseek:deepseek-reasoner',
  // xAI (Grok)
  grok:         'xai:grok-2-latest',
  grok4:        'xai:grok-4',
  // Perplexity (online models with web search)
  sonar:        'perplexity:sonar-pro',
  // Amazon Bedrock via AI Gateway compat + BYOK (requires CF_AIG_TOKEN, BYOK configured in CF dashboard)
  bedrockHaiku: 'bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0',
  // Cerebras — ultra-fast Llama inference
  cerebras:     'cerebras:llama-3.3-70b',
  // OpenRouter — unified model router (access 200+ models with one API key)
  openrouter:   'openrouter:openai/gpt-4o',
  // Cohere — command-r series with native retrieval & web-search connectors
  cohere:       'cohere:command-r-plus',
  // HuggingFace — model org/name encoded in model string (e.g. huggingface:bigcode/starcoder)
  huggingface:  'huggingface:bigcode/starcoder',
  // Replicate — async predictions; model string is a version hash or owner/model format
  replicate:    'replicate:meta/llama-4-maverick-instruct-basic',
  // Parallel — specialised web research & structured extraction
  parallel:     'parallel:speed',
  // Google Vertex AI via compat endpoint + BYOK (requires CF_AIG_TOKEN with Vertex SA configured)
  vertex:       'vertex:google/gemini-2.5-pro',
  // Fal AI — 600+ generative media models (image/video/audio); returns image URL
  imageFal:     'fal:fal-ai/fast-sdxl',
  // Ideogram — high-quality image generation; returns image URL
  imageIdeogram: 'ideogram:V_3',
} as const
