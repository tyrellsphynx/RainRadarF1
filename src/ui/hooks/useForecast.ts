import { useCallback, useEffect, useState } from 'react'
import type { Forecast } from '../../domain/types'
import { loadForecast } from '../../data/openmeteo/client'

/** In-flight promise per coordinate pair (home + track pages share). */
const inflight = new Map<string, Promise<Forecast>>()

function keyOf(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function load(lat: number, lon: number): Promise<Forecast> {
  const key = keyOf(lat, lon)
  let promise = inflight.get(key)
  if (promise === undefined) {
    promise = loadForecast({ lat, lon }).catch((err: unknown) => {
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
 * switching circuits never shows the previous circuit's numbers (stale-
 * while-revalidate within one circuit).
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
        if (alive) setStore({ key, forecast: f, error: null })
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
