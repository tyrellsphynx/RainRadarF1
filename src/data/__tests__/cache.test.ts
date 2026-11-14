import { describe, expect, it } from 'vitest'
import { JsonCache, isFresh, memoryStore } from '../cache'

describe('JsonCache', () => {
  it('round-trips values', () => {
    const cache = new JsonCache(memoryStore(), () => 1000)
    cache.set('a', { hello: 'world' })
    expect(cache.get('a')).toEqual({ value: { hello: 'world' }, storedAt: 1000 })
  })

  it('returns null for missing keys', () => {
    expect(new JsonCache(memoryStore()).get('nope')).toBeNull()
  })

  it('returns null for corrupt payloads', () => {
    const store = memoryStore()
    store.setItem('bad', 'not-json{')
    expect(new JsonCache(store).get('bad')).toBeNull()
  })

  it('returns null for wrong-shaped payloads', () => {
    const store = memoryStore()
    store.setItem('wrong', '{"noStoredAt":true}')
    expect(new JsonCache(store).get('wrong')).toBeNull()
  })

  it('overwrites stale values on set', () => {
    const cache = new JsonCache(memoryStore(), () => 1)
    cache.set('k', 1)
    cache.set('k', 2)
    expect(cache.get('k')).toEqual({ value: 2, storedAt: 1 })
  })
})

describe('JsonCache.prune', () => {
  it('removes old and unreadable entries under the prefix only', () => {
    const store = memoryStore()
    let now = 0
    const cache = new JsonCache(store, () => now)
    cache.set('rrf1:forecast:old', 1)
    now = 9_000
    cache.set('rrf1:forecast:new', 2)
    cache.set('rrf1:schedule:old-prefix-elsewhere', 3)
    store.setItem('rrf1:forecast:junk', 'not-json{')
    store.setItem('rrf1:strategy-lens', '1')

    cache.prune('rrf1:forecast:', 5_000)

    expect(cache.get('rrf1:forecast:old')).toBeNull()
    expect(cache.get('rrf1:forecast:junk')).toBeNull()
    expect(cache.get('rrf1:forecast:new')).not.toBeNull()
    expect(cache.get('rrf1:schedule:old-prefix-elsewhere')).not.toBeNull()
    expect(store.getItem('rrf1:strategy-lens')).toBe('1')
  })
})

describe('isFresh', () => {
  it('honors the TTL boundary (fresh strictly inside)', () => {
    const entry = { value: 1, storedAt: 1000 }
    expect(isFresh(entry, 500, 1499)).toBe(true)
    expect(isFresh(entry, 500, 1500)).toBe(false)
    expect(isFresh(null, 500, 1500)).toBe(false)
  })
})
