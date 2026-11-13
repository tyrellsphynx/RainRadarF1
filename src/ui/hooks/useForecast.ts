import { useCallback, useEffect, useState } from 'react'
import type { Forecast } from '../../domain/types'
import { FORECAST_TTL_MS, loadForecast } from '../../data/openmeteo/client'

/** In-flight promise per coordinate pair (home + track pages share). */
const inflight = new Map<string, Promise<Forecast>>()

function keyOf(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function load(lat: number, lon: number, force = false): Promise<Forecast> {
  const key = keyOf(lat, lon)
  let promise = inflight.get(key)
  if (promise === undefined || force) {
    promise = loadForecast({ lat, lon }, { force }).catch((err: unknown) => {
      inflight.delete(key)
      throw err
    })
    inflight.set(key, promise)
  }
  return promise
}

export interface ForecastState {
  forecast: Forecast | null
  loading: boolean
  error: string | null
  reload: () => void
}

interface ForecastStore {
  key: string | null
  forecast: Forecast | null
  error: string | null
}

/**
 * Forecast for one coordinate pair. Stores data keyed by coordinates, so
 * switching circuits never shows the previous circuit's numbers.
 *
 * Stale-while-revalidate: a cached forecast renders immediately even past
 * its TTL, then a background fetch replaces it. Without this, a long-lived
 * PWA session froze at the first fetch forever (the module-level inflight
 * map keeps resolved promises).
 */
export function useForecast(lat: number | null, lon: number | null): ForecastState {
  const key = lat !== null && lon !== null ? keyOf(lat, lon) : null
  const [store, setStore] = useState<ForecastStore>({ key: null, forecast: null, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (lat === null || lon === null || key === null) return
    let alive = true
    load(lat, lon)
      .then((f) => {
        if (!alive) return
        setStore({ key, forecast: f, error: null })
        if (Date.now() - f.fetchedAt >= FORECAST_TTL_MS) {
          // Serve stale, refresh behind the scenes; keep stale on failure.
          load(lat, lon, true)
            .then((fresh) => {
              if (alive) setStore({ key, forecast: fresh, error: null })
            })
            .catch(() => {})
        }
      })
      .catch((err: unknown) => {
        if (!alive) return
        setStore({
          key,
          forecast: null,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return () => {
      alive = false
    }
  }, [lat, lon, key, attempt])

  const reload = useCallback(() => {
    if (key !== null) inflight.delete(key)
    setAttempt((a) => a + 1)
  }, [key])

  const hasCurrent = store.key === key
  return {
    forecast: hasCurrent ? store.forecast : null,
    loading: key !== null && (!hasCurrent || (store.forecast === null && store.error === null)),
    error: hasCurrent ? store.error : null,
    reload,
  }
}
