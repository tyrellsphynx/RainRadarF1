import { describe, expect, it } from 'vitest'
import { JsonCache, memoryStore } from '../cache'
import { loadRelevantSeasons, loadSeason, SCHEDULE_TTL_MS } from '../jolpica/client'
import snapshot2026 from '../jolpica/snapshot-2026.json'

const down: typeof fetch = async () => {
  throw new TypeError('offline')
}

const races = snapshot2026.races

function calendarFetch(byYear: Record<number, unknown[]>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const year = Number(String(input).match(/f1\/(\d{4})\.json/)?.[1])
    const list = byYear[year]
    if (!list) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify({ MRData: { RaceTable: { Races: list } } }), { status: 200 })
  }) as typeof fetch
}

const T = (iso: string) => Date.parse(iso)
const newCache = () => new JsonCache(memoryStore())

describe('loadSeason', () => {
  it('falls back to the committed snapshot when offline with no cache', async () => {
    const weekends = await loadSeason(2026, { fetchFn: down, cache: newCache() })
    expect(weekends).toHaveLength(races.length)
  })

  it('prefers a stale cache over the snapshot when offline', async () => {
    const cache = newCache()
    const one = [races[0]]
    await loadSeason(2026, { fetchFn: calendarFetch({ 2026: one }), cache, nowMs: 1000 })
    const weekends = await loadSeason(2026, {
      fetchFn: down,
      cache,
      nowMs: 1000 + SCHEDULE_TTL_MS + 1,
    })
    expect(weekends).toHaveLength(1)
  })

  it('throws for a year without cache or snapshot while offline', async () => {
    await expect(loadSeason(2031, { fetchFn: down, cache: newCache() })).rejects.toThrow()
  })
})

describe('loadRelevantSeasons', () => {
  it('returns only the current season mid-year', async () => {
    const weekends = await loadRelevantSeasons(T('2026-06-01T00:00:00Z'), {
      fetchFn: down,
      cache: newCache(),
    })
    expect(new Set(weekends.map((w) => w.season))).toEqual(new Set([2026]))
  })

  it('appends next season once the current one is over and published', async () => {
    const early = races.slice(0, 3) // season that ended in spring
    const next = races.map((r) => ({ ...r, season: '2027' }))
    const weekends = await loadRelevantSeasons(T('2026-12-31T00:00:00Z'), {
      fetchFn: calendarFetch({ 2026: early, 2027: next }),
      cache: newCache(),
    })
    expect(new Set(weekends.map((w) => w.season))).toEqual(new Set([2026, 2027]))
  })

  it('keeps showing last season in January while the new calendar is unpublished', async () => {
    const weekends = await loadRelevantSeasons(T('2027-01-05T00:00:00Z'), {
      fetchFn: down,
      cache: newCache(),
    })
    expect(weekends.length).toBeGreaterThan(0)
    expect(new Set(weekends.map((w) => w.season))).toEqual(new Set([2026]))
  })

  it('rethrows when neither the new nor the previous season can be loaded', async () => {
    await expect(
      loadRelevantSeasons(T('2040-01-05T00:00:00Z'), { fetchFn: down, cache: newCache() }),
    ).rejects.toThrow()
  })
})
