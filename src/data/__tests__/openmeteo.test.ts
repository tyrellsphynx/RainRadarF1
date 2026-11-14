import { describe, expect, it } from 'vitest'
import { JsonCache, memoryStore } from '../cache'
import {
  FORECAST_TTL_MS,
  loadForecast,
  loadHourlyBatch,
  parseHourly,
  parseMinutely,
} from '../openmeteo/client'

const COORDS = { lat: 50.4372, lon: 5.9714 }
const NOW = Date.parse('2026-08-30T12:00:00Z')

const body = {
  hourly: {
    time: ['2026-08-30T13:00', '2026-08-30T14:00'],
    precipitation: [0.4, null],
    precipitation_probability: [60, 20],
  },
  minutely_15: {
    time: ['2026-08-30T13:15', '2026-08-30T13:30'],
    precipitation: [0.1, 0.2],
  },
}

function okFetch(payload: unknown = body): typeof fetch {
  return (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch
}

const failingFetch: typeof fetch = async () => {
  throw new TypeError('network down')
}

describe('timestamp semantics', () => {
  it('shifts hourly points back to the START of their hour (API stamps the end)', () => {
    const [first, second] = parseHourly(body.hourly)
    expect(first?.timeUtc).toBe(Date.parse('2026-08-30T12:00:00Z'))
    expect(first).toMatchObject({ mm: 0.4, probPct: 60 })
    expect(second).toMatchObject({ timeUtc: Date.parse('2026-08-30T13:00:00Z'), mm: 0 })
  })

  it('shifts 15-minute points back to the start of their step', () => {
    const points = parseMinutely(body.minutely_15)
    expect(points?.[0]?.timeUtc).toBe(Date.parse('2026-08-30T13:00:00Z'))
    expect(points?.[1]?.timeUtc).toBe(Date.parse('2026-08-30T13:15:00Z'))
  })

  it('tolerates missing sections', () => {
    expect(parseHourly(undefined)).toEqual([])
    expect(parseMinutely(undefined)).toBeNull()
  })
})

describe('loadForecast', () => {
  it('parses and caches a successful response', async () => {
    const cache = new JsonCache(memoryStore())
    const forecast = await loadForecast(COORDS, { fetchFn: okFetch(), cache, nowMs: NOW })
    expect(forecast.hourly).toHaveLength(2)
    expect(forecast.fetchedAt).toBe(NOW)

    // a second call inside the TTL must not hit the network
    const again = await loadForecast(COORDS, { fetchFn: failingFetch, cache, nowMs: NOW + 1000 })
    expect(again).toEqual(forecast)
  })

  it('serves last-known data when the network fails after the TTL', async () => {
    const cache = new JsonCache(memoryStore())
    const first = await loadForecast(COORDS, { fetchFn: okFetch(), cache, nowMs: NOW })
    const later = await loadForecast(COORDS, {
      fetchFn: failingFetch,
      cache,
      nowMs: NOW + FORECAST_TTL_MS + 1,
    })
    expect(later).toEqual(first)
  })

  it('throws when there is neither network nor cache', async () => {
    await expect(
      loadForecast(COORDS, { fetchFn: failingFetch, cache: new JsonCache(memoryStore()), nowMs: NOW }),
    ).rejects.toThrow('network down')
  })

  it('reports HTTP errors with the status', async () => {
    const fetchFn = (async () => new Response('{}', { status: 429 })) as typeof fetch
    await expect(
      loadForecast(COORDS, { fetchFn, cache: new JsonCache(memoryStore()), nowMs: NOW }),
    ).rejects.toThrow('429')
  })

  it('force skips a fresh cache entry', async () => {
    const cache = new JsonCache(memoryStore())
    await loadForecast(COORDS, { fetchFn: okFetch(), cache, nowMs: NOW })
    const updated = { ...body, hourly: { ...body.hourly, precipitation: [9, 9] } }
    const forced = await loadForecast(COORDS, {
      fetchFn: okFetch(updated),
      cache,
      nowMs: NOW + 1000,
      force: true,
    })
    expect(forced.hourly[0]?.mm).toBe(9)
  })
})

describe('loadHourlyBatch', () => {
  it('handles the list response shape and falls back to cache on failure', async () => {
    const cache = new JsonCache(memoryStore())
    const coords = [COORDS, { lat: 1, lon: 2 }]
    const rows = await loadHourlyBatch(coords, {
      fetchFn: okFetch([body, body]),
      cache,
      nowMs: NOW,
    })
    expect(rows).toHaveLength(2)

    const stale = await loadHourlyBatch(coords, {
      fetchFn: failingFetch,
      cache,
      nowMs: NOW + FORECAST_TTL_MS + 1,
    })
    expect(stale).toEqual(rows)
  })
})
