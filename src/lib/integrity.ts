// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 IKI-ZEN

import type { SandboxConfig } from './schema'

/**
 * Compute a SHA-256 fingerprint of the sandbox config + conversation length.
 * The message count acts as a thread-length salt — the hash changes with
 * every conversation turn, so users can verify nothing changed out-of-band
 * between sessions.
 *
 * Algorithm is hardcoded to SHA-256 via the Web Crypto API and cannot be
 * overridden by userland code.
 */
export async function computeConfigHash(config: SandboxConfig): Promise<string> {
  const payload = JSON.stringify({
    id:           config.id,
    name:         config.name,
    systemPrompt: config.systemPrompt,
    model:        config.model,
    temperature:  config.temperature,
    maxTokens:    config.maxTokens,
    messageCount: config.memory.length,
  })
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
