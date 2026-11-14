import type { Forecast, HourlyPoint, MinutePoint } from '../../domain/types'
import { JsonCache, isFresh } from '../cache'
import { fetchJson } from '../http'
import type { OpenMeteoHourly, OpenMeteoMinutely15, OpenMeteoResponse } from './types'

/**
 * Forecast data source. Open-Meteo is free, keyless and CORS-open
 * (CC BY 4.0 — attribution rendered in the UI footer).
 *
 * Flow: fresh cache → network → stale cache (offline / rate-limited).
 */
export const FORECAST_TTL_MS = 60 * 60 * 1000
const API_BASE = 'https://api.open-meteo.com/v1/forecast'

/** Cache key prefixes. The `v2` segment marks the interval-start timestamp format. */
export const FORECAST_KEY_PREFIX = 'rrf1:forecast:'
export const BATCH_KEY_PREFIX = 'rrf1:batch:'

const HOUR_MS = 3_600_000
const QUARTER_MS = 15 * 60_000

export interface ForecastCoords {
  lat: number
  lon: number
}

export interface LoadForecastOptions {
  fetchFn?: typeof fetch
  cache?: JsonCache
  nowMs?: number
  /** Skip the cache read (still writes) — used by the alert poller. */
  force?: boolean
}

/** Full forecast (hourly + 15-minute) for one circuit. */
export async function loadForecast(
  coords: ForecastCoords,
  opts: LoadForecastOptions = {},
): Promise<Forecast> {
  const fetchFn = opts.fetchFn ?? fetch
  const cache = opts.cache ?? new JsonCache()
  const nowMs = opts.nowMs ?? Date.now()
  const key = `${FORECAST_KEY_PREFIX}v2:${coords.lat.toFixed(3)},${coords.lon.toFixed(3)}`

  const cached = cache.get<Forecast>(key)
  if (!opts.force && cached && isFresh(cached, FORECAST_TTL_MS, nowMs)) return cached.value

  const params = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    hourly: 'precipitation,precipitation_probability',
    minutely_15: 'precipitation',
    timezone: 'UTC',
    past_days: '2',
    forecast_days: '16',
  })

  try {
    const json = await fetchJson<OpenMeteoResponse>(`${API_BASE}?${params}`, fetchFn, 'Open-Meteo')
    const forecast: Forecast = {
      hourly: parseHourly(json.hourly),
      minutely15: parseMinutely(json.minutely_15),
      fetchedAt: nowMs,
    }
    cache.set(key, forecast)
    return forecast
  } catch (err) {
    // Offline / rate-limited: last-known data beats an error page.
    if (cached) return cached.value
    throw err
  }
}

/**
 * Lightweight hourly-only forecasts for many circuits in ONE request
 * (Open-Meteo accepts comma-separated coordinates) — powers the map tab's
 * wet/dry pin status.
 */
export async function loadHourlyBatch(
  coordsList: ForecastCoords[],
  opts: LoadForecastOptions = {},
): Promise<HourlyPoint[][]> {
  if (coordsList.length === 0) return []
  const fetchFn = opts.fetchFn ?? fetch
  const cache = opts.cache ?? new JsonCache()
  const nowMs = opts.nowMs ?? Date.now()
  const key = `${BATCH_KEY_PREFIX}v2:${coordsList.map((c) => `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`).join(';')}`

  const cached = cache.get<HourlyPoint[][]>(key)
  if (!opts.force && cached && isFresh(cached, FORECAST_TTL_MS, nowMs)) return cached.value

  const params = new URLSearchParams({
    latitude: coordsList.map((c) => c.lat).join(','),
    longitude: coordsList.map((c) => c.lon).join(','),
    hourly: 'precipitation,precipitation_probability',
    timezone: 'UTC',
    past_days: '0',
    forecast_days: '2',
  })

  try {
    const json = await fetchJson<OpenMeteoResponse | OpenMeteoResponse[]>(
      `${API_BASE}?${params}`,
      fetchFn,
      'Open-Meteo',
    )
    const list = Array.isArray(json) ? json : [json]
    const result = list.map((entry) => parseHourly(entry.hourly))
    cache.set(key, result)
    return result
  } catch (err) {
    if (cached) return cached.value
    throw err
  }
}

/** ISO time without timezone ("2026-11-08T00:00") → Unix ms; we request UTC. */
export function parseUtcIso(iso: string): number {
  return Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)
}

/**
 * Open-Meteo stamps precipitation with the END of its interval; the domain
 * works with interval STARTS, so every timestamp is shifted back one step.
 */
export function parseHourly(hourly: OpenMeteoHourly | undefined): HourlyPoint[] {
  if (!hourly?.time) return []
  return hourly.time.map((time, i) => ({
    timeUtc: parseUtcIso(time) - HOUR_MS,
    mm: hourly.precipitation[i] ?? 0,
    probPct: hourly.precipitation_probability?.[i] ?? null,
  }))
}

export function parseMinutely(minutely: OpenMeteoMinutely15 | undefined): MinutePoint[] | null {
  if (!minutely?.time?.length) return null
  return minutely.time.map((time, i) => ({
    timeUtc: parseUtcIso(time) - QUARTER_MS,
    mm: minutely.precipitation[i] ?? 0,
  }))
}
