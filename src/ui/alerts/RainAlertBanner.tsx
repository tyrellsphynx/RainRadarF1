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
  const [rainAlert, setRainAlert] = useState<RainAlert | null>(null)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  const circuitId = circuit?.circuitId ?? null

  useEffect(() => {
    if (circuit === null) return
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

        if (alive) setRainAlert(result)
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
  }, [circuit, lensOn])

  const key = circuitId !== null ? `${circuitId}:${new Date().toDateString()}` : ''
  if (rainAlert === null || dismissedKey === key) return null

  return (
    <div className="alert-banner" role="status">
      <span className="alert-icon" aria-hidden>
        🌧️
      </span>
      <div>
        <div className="alert-title">{rainAlert.title}</div>
        <div className="alert-detail">
          {circuit ? `${circuit.locality}: ` : ''}
          {rainAlert.detail}
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
