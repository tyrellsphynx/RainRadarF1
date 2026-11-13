import { useEffect, useMemo, useState } from 'react'
import type { HourlyPoint } from '../../domain/types'
import { aggregateWindow } from '../../domain/aggregate'
import { classify, VERDICT_META } from '../../domain/verdict'
import { loadHourlyBatch } from '../../data/openmeteo/client'
import { useSchedule } from '../hooks/useSchedule'
import { useTick } from '../hooks/useTick'
import { navigate, trackHash } from '../shell/useHashRoute'
import { RadarMap, type PinSpec } from './RadarMap'

const STATUS_WINDOW_MS = 2 * 3_600_000

interface MapCircuit {
  key: string
  circuitId: string
  lat: number
  lon: number
  title: string
  season: number
  round: number
}

/**
 * The world map: every circuit on the calendar as a pin colored by
 * "will it rain here in the next 2 hours", over the live radar layer.
 */
export default function MapPage() {
  const { weekends, loading, error, reload } = useSchedule()
  const now = useTick(10 * 60_000)
  const [batch, setBatch] = useState<HourlyPoint[][] | null>(null)
  const [batchError, setBatchError] = useState<string | null>(null)

  const circuits = useMemo((): MapCircuit[] => {
    const seen = new Map<string, MapCircuit>()
    for (const w of weekends) {
      const c = w.circuit
      if (!seen.has(c.circuitId)) {
        seen.set(c.circuitId, {
          key: `${w.season}-${w.round}`,
          circuitId: c.circuitId,
          lat: c.lat,
          lon: c.lon,
          title: w.raceName.replace(/ Grand Prix$/, ''),
          season: w.season,
          round: w.round,
        })
      }
    }
    return [...seen.values()]
  }, [weekends])

  useEffect(() => {
    if (circuits.length === 0) return
    let alive = true
    loadHourlyBatch(
      circuits.map((c) => ({ lat: c.lat, lon: c.lon })),
      { force: true },
    )
      .then((rows) => {
        if (!alive) return
        setBatch(rows)
        setBatchError(null)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setBatchError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [circuits, now])

  const pins = useMemo(
    (): PinSpec[] =>
      circuits.map((c, i) => {
        const stats = batch?.[i]
        const verdict = stats
          ? classify(aggregateWindow(stats, now, now + STATUS_WINDOW_MS))
          : 'unknown'
        return {
          id: c.key,
          lon: c.lon,
          lat: c.lat,
          color: VERDICT_META[verdict].color,
          title: c.title,
          status: VERDICT_META[verdict].label,
        }
      }),
    [circuits, batch, now],
  )

  if (loading) return <div className="page-loader">Loading the calendar…</div>

  if (error && circuits.length === 0) {
    return (
      <div className="error-box">
        <p>Could not load the F1 calendar: {error}</p>
        <button className="btn" onClick={reload}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="map-page">
      <RadarMap
        lat={20}
        lon={10}
        zoom={1.5}
        pins={pins}
        fitBoundsToPins
        onPinClick={(id) => {
          const [season, round] = id.split('-').map(Number)
          if (Number.isFinite(season) && Number.isFinite(round)) navigate(trackHash(season, round))
        }}
      />

      <div className="map-legend">
        <strong>Next 2 hours</strong>
        {(['rain', 'showers', 'isolated', 'dry', 'unknown'] as const).map((v) => (
          <div className="row" key={v}>
            <span className="swatch" style={{ background: VERDICT_META[v].color }} />
            {VERDICT_META[v].label}
          </div>
        ))}
        {batchError && <div className="muted">status unavailable: {batchError}</div>}
      </div>

      {/* Keyboard/screen-reader-accessible twin of the map pins. */}
      <details className="circuit-list">
        <summary>All circuits</summary>
        <ul>
          {pins.map((p) => (
            <li key={p.id}>
              <a href={`#/track/${p.id}`}>
                <span className="swatch" style={{ background: p.color }} aria-hidden="true" />
                {p.title}
                {p.status !== undefined && <span className="sr-only"> — {p.status}</span>}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
