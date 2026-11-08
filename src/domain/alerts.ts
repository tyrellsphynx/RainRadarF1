import type { HourlyPoint, MinutePoint } from './types'
import { firstWetStep, sumMinutely } from './aggregate'

export interface RainAlert {
  kind: 'forecast' | 'radar'
  title: string
  detail: string
}

/** Weather voice vs pit-wall voice (strategy lens). */
export type AlertPhrasing = 'weather' | 'strategy'

/** Alert look-ahead for the high-resolution forecast, ms. */
export const ALERT_WINDOW_MS = 60 * 60_000
/** Minimum accumulation inside the alert window to raise an alert, mm. */
export const ALERT_MM = 0.2

/**
 * In-app alert: rain is expected within the next hour at the watched circuit.
 * Prefers minutely_15 data (where the model provides it); falls back to a
 * coarser "within ~2 h" hourly reading.
 */
export function forecastRainAlert(
  nowMs: number,
  minutely15: MinutePoint[] | null,
  hourly: HourlyPoint[],
  phrasing: AlertPhrasing = 'weather',
): RainAlert | null {
  const strategy = phrasing === 'strategy'
  const windowEnd = nowMs + ALERT_WINDOW_MS

  if (minutely15 && minutely15.length > 0) {
    const mm = sumMinutely(minutely15, nowMs, windowEnd)
    if (mm >= ALERT_MM) {
      const first = firstWetStep(minutely15, nowMs, windowEnd)
      const minutes = first ? Math.max(1, Math.round((first.timeUtc - nowMs) / 60_000)) : null
      return {
        kind: 'forecast',
        title: strategy
          ? minutes !== null
            ? `Rain in ~${minutes} min — cars on slicks will need to box`
            : 'Rain within the hour — cars on slicks will need to box'
          : minutes !== null
            ? `Rain expected in ~${minutes} min`
            : 'Rain expected within the hour',
        detail: `About ${mm.toFixed(1)} mm of rain forecast in the next 60 minutes${strategy ? ' — expect a tyre change' : ''}.`,
      }
    }
    return null
  }

  // Coarse fallback: hourly forecast over the next 2 hours.
  const coarseEnd = nowMs + 2 * ALERT_WINDOW_MS
  let mm = 0
  for (const point of hourly) {
    const overlap = Math.min(point.timeUtc + 3_600_000, coarseEnd) - Math.max(point.timeUtc, nowMs)
    if (overlap > 0) mm += point.mm * (overlap / 3_600_000)
  }
  if (mm >= ALERT_MM) {
    return {
      kind: 'forecast',
      title: strategy ? 'Rain within ~2 h — plan for a tyre change' : 'Rain expected within ~2 h',
      detail: `About ${mm.toFixed(1)} mm of rain forecast in the next 2 hours (hourly model).`,
    }
  }
  return null
}

/** In-app alert: rain echoes on radar within `radiusKm` of the watched circuit. */
export function radarRainAlert(coverage: number, radiusKm: number): RainAlert | null {
  if (coverage <= 0.1) return null
  return {
    kind: 'radar',
    title: `Rain on radar within ${radiusKm} km`,
    detail: 'Radar shows precipitation approaching the circuit right now.',
  }
}
