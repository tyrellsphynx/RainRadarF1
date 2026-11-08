import type { HourlyPoint, MinutePoint, WindowStats } from './types'

const HOUR_MS = 3_600_000

/**
 * Aggregate hourly forecast points over a session window [startMs, endMs).
 * Hourly precipitation is prorated by overlap so a session starting at :30
 * only counts half of the :00 hour, etc. Probability is the max over all
 * overlapping hours — the "will it rain at some point" reading.
 */
export function aggregateWindow(hourly: HourlyPoint[], startMs: number, endMs: number): WindowStats {
  let mm = 0
  let probPct: number | null = null
  let hasData = false

  for (const point of hourly) {
    const overlapMs = Math.min(point.timeUtc + HOUR_MS, endMs) - Math.max(point.timeUtc, startMs)
    if (overlapMs <= 0) continue

    hasData = true
    mm += point.mm * (overlapMs / HOUR_MS)
    if (point.probPct !== null) {
      probPct = Math.max(probPct ?? 0, point.probPct)
    }
  }

  return { hasData, mm: round1(mm), probPct }
}

/**
 * Sum minutely_15 precipitation over [startMs, endMs). Used for the
 * "rain arriving in ~N minutes" alert window.
 */
export function sumMinutely(minutely: MinutePoint[], startMs: number, endMs: number): number {
  let mm = 0
  for (const point of minutely) {
    if (point.timeUtc >= startMs && point.timeUtc < endMs) mm += point.mm
  }
  return round2(mm)
}

/** First minutely step within the window with meaningful precipitation, or null. */
export function firstWetStep(
  minutely: MinutePoint[],
  startMs: number,
  endMs: number,
  thresholdMm = 0.02,
): MinutePoint | null {
  for (const point of minutely) {
    if (point.timeUtc >= startMs && point.timeUtc < endMs && point.mm >= thresholdMm) return point
  }
  return null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
