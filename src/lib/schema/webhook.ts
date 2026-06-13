import { MAX_WEBHOOK_URL_LEN } from '../constants'

const BLOCKED_WEBHOOK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => !Number.isFinite(p) || p < 0 || p > 255)) return false
  const [a, b] = parts
  if (a === 0)                           return true   // 0.0.0.0/8 "this network"
  if (a === 10)                          return true   // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return true   // 100.64.0.0/10 CGNAT (RFC 6598)
  if (a === 127)                         return true   // 127.0.0.0/8 loopback
  if (a === 169 && b === 254)            return true   // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31)  return true   // 172.16.0.0/12 private
  if (a === 192 && b === 168)            return true   // 192.168.0.0/16 private
  return false
}

export function isPrivateIp(host: string): boolean {
  // Strip brackets from IPv6 literals (URL.hostname returns e.g. "[fc00::1]")
  const h = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()

  // IPv4-mapped IPv6, dotted form: ::ffff:192.168.1.1
  const v4mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (v4mapped) return isPrivateIpv4(v4mapped[1])
  // IPv4-mapped IPv6, hex form (WHATWG URL canonicalizes ::ffff:192.168.1.1 → ::ffff:c0a8:101)
  const v4mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (v4mappedHex) {
    const hi = parseInt(v4mappedHex[1], 16)
    const lo = parseInt(v4mappedHex[2], 16)
    return isPrivateIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`)
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPrivateIpv4(h)

  // IPv6 literals contain colons; only then apply IPv6 range checks
  if (h.includes(':')) {
    if (h === '::1') return true            // loopback ::1/128
    if (/^fe[89ab]/.test(h)) return true    // link-local fe80::/10
    if (/^f[cd]/.test(h)) return true       // unique-local fc00::/7
  }
  return false
}

export function parseWebhookUrl(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new Error('webhookUrl must be a string')
  if (v.length === 0) return undefined
  if (!v.startsWith('https://')) throw new Error('webhookUrl must start with https://')
  if (v.length > MAX_WEBHOOK_URL_LEN) throw new Error(`webhookUrl must be <= ${MAX_WEBHOOK_URL_LEN} characters`)
  let parsed: URL
  try { parsed = new URL(v) } catch { throw new Error('webhookUrl must be a valid URL') }
  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_WEBHOOK_HOSTNAMES.has(host)) throw new Error('webhookUrl must not target localhost')
  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost'))
    throw new Error('webhookUrl must not target internal hostnames')
  if (isPrivateIp(host)) throw new Error('webhookUrl must not target private IP ranges')
  return v
}
