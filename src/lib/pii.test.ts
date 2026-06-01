import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { scanPII, redactPII, PII_TYPES } from './pii'

describe('scanPII — email', () => {
  it('detects an email address', () => {
    const m = scanPII('contact me at jane.doe@example.com please')
    assert.equal(m.length, 1)
    assert.equal(m[0].type, 'email')
    assert.equal(m[0].preview, 'jane.doe@example.com')
  })
})

describe('scanPII — credit card (Luhn)', () => {
  it('accepts a Luhn-valid card number', () => {
    // 4242 4242 4242 4242 is a well-known Luhn-valid test number
    const m = scanPII('card 4242 4242 4242 4242 on file')
    assert.ok(m.some(x => x.type === 'credit_card'))
  })

  it('rejects a random 16-digit string that fails Luhn', () => {
    const m = scanPII('order number 1234 5678 9012 3456 shipped')
    assert.ok(!m.some(x => x.type === 'credit_card'))
  })
})

describe('scanPII — SSN', () => {
  it('detects a US SSN pattern', () => {
    const m = scanPII('SSN 123-45-6789 on form')
    assert.ok(m.some(x => x.type === 'ssn'))
  })
})

describe('scanPII — phone', () => {
  it('detects a formatted phone number', () => {
    const m = scanPII('call (555) 123-4567 today')
    assert.ok(m.some(x => x.type === 'phone'))
  })
})

describe('scanPII — ipv4', () => {
  it('detects a valid IPv4 address', () => {
    const m = scanPII('server at 192.168.10.5 responded')
    assert.ok(m.some(x => x.type === 'ipv4'))
  })

  it('does not match an out-of-range octet', () => {
    const m = scanPII('version 999.999.999.999 here')
    assert.ok(!m.some(x => x.type === 'ipv4'))
  })
})

describe('scanPII — clean text', () => {
  it('returns no matches for ordinary prose', () => {
    const m = scanPII('The quick brown fox jumps over the lazy dog.')
    assert.equal(m.length, 0)
  })
})

describe('scanPII — type filter', () => {
  it('only returns requested types', () => {
    const text = 'email a@b.com and ip 10.0.0.1'
    const m = scanPII(text, ['ipv4'])
    assert.ok(m.every(x => x.type === 'ipv4'))
    assert.ok(m.some(x => x.type === 'ipv4'))
  })
})

describe('redactPII', () => {
  it('replaces matches with typed placeholders and counts them', () => {
    const { redacted, counts } = redactPII('mail a@b.com and a@b.com again')
    assert.ok(!redacted.includes('a@b.com'))
    assert.ok(redacted.includes('[REDACTED:email]'))
    assert.equal(counts.email, 2)
  })

  it('leaves clean text unchanged', () => {
    const { redacted, counts } = redactPII('nothing to see here')
    assert.equal(redacted, 'nothing to see here')
    assert.equal(Object.keys(counts).length, 0)
  })
})

describe('PII_TYPES', () => {
  it('exposes the supported type list', () => {
    assert.ok(PII_TYPES.includes('email'))
    assert.ok(PII_TYPES.includes('credit_card'))
    assert.ok(PII_TYPES.includes('ssn'))
  })
})
