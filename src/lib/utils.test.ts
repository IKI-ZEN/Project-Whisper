import { describe, it, expect } from 'vitest'
import { isUUID } from './utils'

describe('isUUID', () => {
  it('accepts a valid lowercase UUID', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('accepts a valid uppercase UUID', () => {
    expect(isUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('accepts a mixed-case UUID', () => {
    expect(isUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isUUID('')).toBe(false)
  })

  it('rejects a string that is too short', () => {
    expect(isUUID('550e8400-e29b-41d4-a716')).toBe(false)
  })

  it('rejects a UUID with wrong separators', () => {
    expect(isUUID('550e8400_e29b_41d4_a716_446655440000')).toBe(false)
  })

  it('rejects a UUID with curly braces', () => {
    expect(isUUID('{550e8400-e29b-41d4-a716-446655440000}')).toBe(false)
  })

  it('rejects a non-UUID string of similar length', () => {
    expect(isUUID('not-a-uuid-at-all-xxxxxxxxxxxxxxxxxx')).toBe(false)
  })

  it('rejects a UUID with extra characters', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false)
  })
})
