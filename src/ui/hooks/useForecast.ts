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

/** How often a mounted page checks whether its forecast has gone stale. */
const STALE_CHECK_MS = 60_000
/** Minimum gap between background refresh attempts (also after failures). */
const REFRESH_RETRY_MS = 5 * 60_000

/**
 * Forecast for one coordinate pair. Stores data keyed by coordinates, so
 * switching circuits never shows the previous circuit's numbers.
 *
 * Stale-while-revalidate: a cached forecast renders immediately even past
 * its TTL, then a background fetch replaces it. While the page stays open
 * (a PWA left running on race day) it keeps refreshing: on a timer, and
 * when the tab becomes visible again.
 */
export function useForecast(lat: number | null, lon: number | null): ForecastState {
  const key = lat !== null && lon !== null ? keyOf(lat, lon) : null
  const [store, setStore] = useState<ForecastStore>({ key: null, forecast: null, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (lat === null || lon === null || key === null) return
    let alive = true
    let fetchedAt = 0
    let lastAttempt = 0

    const accept = (forecast: Forecast) => {
      if (!alive) return
      fetchedAt = forecast.fetchedAt
      setStore({ key, forecast, error: null })
    }

    // Serve stale, refresh behind the scenes; keep stale on failure.
    const revalidate = () => {
      lastAttempt = Date.now()
      load(lat, lon, true).then(accept).catch(() => {})
    }

    const refreshIfStale = () => {
      const now = Date.now()
      if (
        document.visibilityState === 'visible' &&
        fetchedAt > 0 &&
        now - fetchedAt >= FORECAST_TTL_MS &&
        now - lastAttempt >= REFRESH_RETRY_MS
      ) {
        revalidate()
      }
    }

    load(lat, lon)
      .then((forecast) => {
        accept(forecast)
        if (alive && Date.now() - forecast.fetchedAt >= FORECAST_TTL_MS) revalidate()
      })
      .catch((err: unknown) => {
        if (!alive) return
        setStore({
          key,
          forecast: null,
          error: err instanceof Error ? err.message : String(err),
        })
      })

    const timer = window.setInterval(refreshIfStale, STALE_CHECK_MS)
    document.addEventListener('visibilitychange', refreshIfStale)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfStale)
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
