import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isUUID } from './utils.ts'

describe('isUUID', () => {
  it('accepts a valid lowercase UUID', () => {
    assert.strictEqual(isUUID('550e8400-e29b-41d4-a716-446655440000'), true)
  })

  it('accepts a valid uppercase UUID', () => {
    assert.strictEqual(isUUID('550E8400-E29B-41D4-A716-446655440000'), true)
  })

  it('accepts a mixed-case UUID', () => {
    assert.strictEqual(isUUID('550e8400-E29B-41d4-A716-446655440000'), true)
  })

  it('rejects an empty string', () => {
    assert.strictEqual(isUUID(''), false)
  })

  it('rejects a string that is too short', () => {
    assert.strictEqual(isUUID('550e8400-e29b-41d4-a716'), false)
  })

  it('rejects a UUID with wrong separators', () => {
    assert.strictEqual(isUUID('550e8400_e29b_41d4_a716_446655440000'), false)
  })

  it('rejects a UUID with curly braces', () => {
    assert.strictEqual(isUUID('{550e8400-e29b-41d4-a716-446655440000}'), false)
  })

  it('rejects a non-UUID string of similar length', () => {
    assert.strictEqual(isUUID('not-a-uuid-at-all-xxxxxxxxxxxxxxxxxx'), false)
  })

  it('rejects a UUID with extra characters', () => {
    assert.strictEqual(isUUID('550e8400-e29b-41d4-a716-446655440000-extra'), false)
  })
})
