export type CallType = 'complete' | 'stream' | 'embed' | 'image' | 'transcribe'

interface Price {
  inputPer1k:  number   // USD per 1000 input tokens (approximate)
  outputPer1k: number   // USD per 1000 output tokens (approximate)
}

// Approximate prices — Workers AI is billed by neurons (not tokens), gateway providers
// bill by token. All figures are estimates; mark as "~" in UI.
const PRICES: Record<string, Price> = {
  // Workers AI
  '@cf/meta/llama-3.1-8b-instruct':           { inputPer1k: 0.0001,  outputPer1k: 0.0001  },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { inputPer1k: 0.0003,  outputPer1k: 0.0005  },
  '@cf/baai/bge-base-en-v1.5':                { inputPer1k: 0.00001, outputPer1k: 0        },
  '@cf/black-forest-labs/flux-1-schnell':     { inputPer1k: 0,       outputPer1k: 0.00008  },
  '@cf/openai/whisper':                        { inputPer1k: 0.0001,  outputPer1k: 0        },
  // OpenAI
  'gpt-4o':                                    { inputPer1k: 0.0025,  outputPer1k: 0.01     },
  'gpt-4o-mini':                               { inputPer1k: 0.00015, outputPer1k: 0.0006   },
  // Anthropic
  'claude-sonnet-4-6':                         { inputPer1k: 0.003,   outputPer1k: 0.015    },
  'claude-opus-4-7':                           { inputPer1k: 0.015,   outputPer1k: 0.075    },
  // Google
  'gemini-2.0-flash':                          { inputPer1k: 0.0001,  outputPer1k: 0.0004   },
}

const FALLBACK: Price = { inputPer1k: 0.0001, outputPer1k: 0.0001 }

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  // Strip provider prefix (e.g. "openai:gpt-4o" → "gpt-4o")
  const bareModel = model.includes(':') ? model.slice(model.indexOf(':') + 1) : model
  const p = PRICES[bareModel] ?? PRICES[model] ?? FALLBACK
  return (tokensIn / 1000) * p.inputPer1k + (tokensOut / 1000) * p.outputPer1k
}
