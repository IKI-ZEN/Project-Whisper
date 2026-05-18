export function newId(): string {
  return crypto.randomUUID()
}

export function now(): number {
  return Date.now()
}

// Converts a Uint8Array to a base64 string without stack-size issues.
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
