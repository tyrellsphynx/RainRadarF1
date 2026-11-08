import { describe, expect, it } from 'vitest'
import { ALERT_WINDOW_MS, forecastRainAlert, radarRainAlert } from '../alerts'
import type { HourlyPoint, MinutePoint } from '../types'

const NOW = Date.parse('2026-03-08T12:00:00Z')
const m = (minutesFromNow: number, mm: number): MinutePoint => ({
  timeUtc: NOW + minutesFromNow * 60_000,
  mm,
})
const hour = (hoursFromNow: number, mm: number): HourlyPoint => ({
  timeUtc: NOW + hoursFromNow * 3_600_000,
  mm,
  probPct: null,
  rainMm: mm,
  showersMm: 0,
})

describe('forecastRainAlert (minutely)', () => {
  it('raises an alert with minutes-to-rain', () => {
    const alert = forecastRainAlert(NOW, [m(0, 0), m(15, 0.1), m(30, 0.4)], [])
    expect(alert?.kind).toBe('forecast')
    expect(alert?.title).toBe('Rain expected in ~15 min')
  })

  it('stays silent below the accumulation threshold', () => {
    expect(forecastRainAlert(NOW, [m(0, 0), m(15, 0.01), m(30, 0.05)], [])).toBeNull()
  })

  it('ignores rain outside the alert window', () => {
    const alert = forecastRainAlert(
      NOW,
      [m(ALERT_WINDOW_MS / 60_000 + 10, 1.0), m(90, 2.0)],
      [],
    )
    expect(alert).toBeNull()
  })
})

describe('forecastRainAlert (hourly fallback)', () => {
  it('uses hourly data when minutely is unavailable', () => {
    const alert = forecastRainAlert(NOW, null, [hour(0, 0), hour(1, 0.6)])
    expect(alert?.title).toBe('Rain expected within ~2 h')
    expect(alert?.detail).toContain('0.6')
  })

  it('stays silent for dry hourly forecasts', () => {
    expect(forecastRainAlert(NOW, null, [hour(0, 0), hour(1, 0.1)])).toBeNull()
  })
})

describe('radarRainAlert', () => {
  it('raises on meaningful radar coverage', () => {
    const alert = radarRainAlert(0.35, 25)
    expect(alert?.kind).toBe('radar')
    expect(alert?.title).toContain('25 km')
  })

  it('ignores a couple of stray pixels', () => {
    expect(radarRainAlert(0.05, 25)).toBeNull()
    expect(radarRainAlert(0, 25)).toBeNull()
  })
})
