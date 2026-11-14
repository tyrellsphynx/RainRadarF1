import { describe, expect, it } from 'vitest'
import { parseHash, trackHash } from '../useHashRoute'

describe('parseHash', () => {
  it('defaults to home', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
    expect(parseHash('#/nonsense')).toEqual({ name: 'home' })
  })

  it('parses the map route', () => {
    expect(parseHash('#/map')).toEqual({ name: 'map' })
  })

  it('parses a track route and round-trips with trackHash', () => {
    expect(parseHash('#/track/2026-5')).toEqual({ name: 'track', season: 2026, round: 5 })
    expect(parseHash(trackHash(2027, 12))).toEqual({ name: 'track', season: 2027, round: 12 })
  })

  it('falls back to home for malformed track ids', () => {
    expect(parseHash('#/track')).toEqual({ name: 'home' })
    expect(parseHash('#/track/abc-def')).toEqual({ name: 'home' })
  })
})
