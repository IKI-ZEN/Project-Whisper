import { DEFAULT_TEMPERATURE } from '../../constants'
import type { CompletionOpts } from '../messages'

// ── Internal Workers AI run helper ────────────────────────────────────────────

// Workers AI's run() is overloaded for specific model/input pairs.
// We cast to a generic form to support dynamic model strings.
type AiRun = (model: string, inputs: Record<string, unknown>) => Promise<unknown>

export function run(ai: Ai): AiRun {
  return (ai.run as unknown as AiRun).bind(ai)
}

// ── Gateway header builder ────────────────────────────────────────────────────

// Constructs the standard set of headers for every AI Gateway request.
// All cache/metadata headers live here — never inline them in provider functions.
export function buildGatewayHeaders(
  key: string,
  authH: Record<string, string>,
  opts: CompletionOpts,
  modelLabel: string,
): Record<string, string> {
  const temp = opts.temperature ?? DEFAULT_TEMPERATURE
  const h: Record<string, string> = {
    'Content-Type':      'application/json',
    ...authH,
    'cf-aig-cache-ttl':  '3600',
    'cf-aig-skip-cache': temp !== 0 ? 'true' : 'false',
  }
  if (opts.sandboxId)                 h['cf-aig-metadata']          = JSON.stringify({ sandboxId: opts.sandboxId, model: modelLabel })
  if (opts.byokAlias)                 h['cf-aig-byok-alias']         = opts.byokAlias
  if (opts.zdr)                       h['cf-aig-zdr']                 = 'true'
  if (opts.collectLogPayload === false) h['cf-aig-collect-log-payload'] = 'false'
  return h
}
