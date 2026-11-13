import { useEffect, useState } from 'react'
import { forecastRainAlert, radarRainAlert, type RainAlert } from '../../domain/alerts'
import { featuredWeekend } from '../../domain/featured'
import { loadForecast } from '../../data/openmeteo/client'
import {
  loadRadarFrames,
  radarTileUrl,
  RADAR_MAX_ZOOM,
} from '../../data/rainviewer/client'
import { radarCoverageNear, tileAt } from '../../data/rainviewer/proximity'
import { useSchedule } from '../hooks/useSchedule'
import { useStrategyLens } from '../hooks/useStrategyLens'
import { useTick } from '../hooks/useTick'

const POLL_MS = 5 * 60_000
const RADAR_RADIUS_KM = 25
/** Alerts older than this are hidden (the poller keeps them fresh while active). */
const ALERT_FRESH_MS = 3 * POLL_MS
/** Only poll for rain alerts when a session starts within this horizon. */
const ALERT_POLL_HORIZON_MS = 48 * 3_600_000

/**
 * In-app rain alert for the featured circuit: forecast trigger
 * (rain within the hour) or radar echoes within 25 km. No push —
 * visible only while the app is open.
 */
export function RainAlertBanner() {
  const { weekends } = useSchedule()
  const now = useTick(60_000)
  const [lensOn] = useStrategyLens()
  const featured = featuredWeekend(weekends, now)
  const circuit = featured?.weekend.circuit ?? null
  const [rainAlert, setRainAlert] = useState<{ alert: RainAlert; issuedAt: number } | null>(null)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  const circuitId = circuit?.circuitId ?? null

  // Poll only near a session (live, or starting within the horizon) — quiet
  // and API-friendly between race weekends.
  const nextSession = featured?.session ?? null
  const nearSession =
    nextSession !== null &&
    (nextSession.startUtc <= now || nextSession.startUtc - now <= ALERT_POLL_HORIZON_MS)

  useEffect(() => {
    if (circuit === null || !nearSession) return
    let alive = true

    const check = async () => {
      try {
        const forecast = await loadForecast(
          { lat: circuit.lat, lon: circuit.lon },
          { force: true },
        )
        let result = forecastRainAlert(
          Date.now(),
          forecast.minutely15,
          forecast.hourly,
          lensOn ? 'strategy' : 'weather',
        )

        if (result === null) {
          // Radar probe is best-effort evidence — never let it break the alert.
          try {
            const frames = await loadRadarFrames({ force: true })
            const latest = frames.past[frames.past.length - 1]
            if (latest) {
              const tile = tileAt(circuit.lat, circuit.lon, RADAR_MAX_ZOOM)
              const url = radarTileUrl(frames, latest, tile.z, tile.x, tile.y)
              const coverage = await radarCoverageNear(url, circuit.lat, circuit.lon, RADAR_RADIUS_KM)
              result = radarRainAlert(coverage, RADAR_RADIUS_KM)
            }
          } catch {
            result = null
          }
        }

        if (alive) setRainAlert(result ? { alert: result, issuedAt: Date.now() } : null)
      } catch {
        if (alive) setRainAlert(null)
      }
    }

    void check()
    const id = window.setInterval(check, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [circuit, lensOn, nearSession])

  const key = circuitId !== null ? `${circuitId}:${new Date(now).toDateString()}` : ''
  const stale = rainAlert !== null && now - rainAlert.issuedAt > ALERT_FRESH_MS
  if (rainAlert === null || stale || !nearSession || dismissedKey === key) return null

  return (
    <div className="alert-banner" role="status">
      <span className="alert-icon" aria-hidden>
        🌧️
      </span>
      <div>
        <div className="alert-title">{rainAlert.alert.title}</div>
        <div className="alert-detail">
          {circuit ? `${circuit.locality}: ` : ''}
          {rainAlert.alert.detail}
        </div>
      </div>
      <button
        className="alert-close"
        onClick={() => setDismissedKey(key)}
        aria-label="Dismiss rain alert"
      >
        ×
      </button>
    </div>
  )
}
