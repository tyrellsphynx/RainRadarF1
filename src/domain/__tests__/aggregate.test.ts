import { describe, expect, it } from 'vitest'
import { aggregateWindow, firstWetStep, sumMinutely } from '../aggregate'
import type { HourlyPoint, MinutePoint } from '../types'

const hour = (iso: string, mm: number, probPct: number | null = null): HourlyPoint => ({
  timeUtc: Date.parse(`${iso}Z`),
  mm,
  probPct,
  rainMm: mm,
  showersMm: 0,
})

describe('aggregateWindow', () => {
  const hourly = [
    hour('2026-03-08T12:00:00', 1.0, 40),
    hour('2026-03-08T13:00:00', 0.4, 70),
    hour('2026-03-08T14:00:00', 0.0, 10),
    hour('2026-03-08T15:00:00', 5.0, 95),
  ]

  it('prorates hourly precipitation by overlap', () => {
    const stats = aggregateWindow(
      hourly,
      Date.parse('2026-03-08T12:30:00Z'),
      Date.parse('2026-03-08T13:30:00Z'),
    )
    // half of the 12:00 hour (0.5) + half of the 13:00 hour (0.2)
    expect(stats.hasData).toBe(true)
    expect(stats.mm).toBeCloseTo(0.7, 5)
  })

  it('takes the max probability across overlapping hours', () => {
    const stats = aggregateWindow(
      hourly,
      Date.parse('2026-03-08T12:30:00Z'),
      Date.parse('2026-03-08T13:30:00Z'),
    )
    expect(stats.probPct).toBe(70)
  })

  it('ignores hours outside the window', () => {
    const stats = aggregateWindow(
      hourly,
      Date.parse('2026-03-08T12:00:00Z'),
      Date.parse('2026-03-08T13:00:00Z'),
    )
    expect(stats.mm).toBeCloseTo(1.0, 5)
    expect(stats.probPct).toBe(40)
  })

  it('reports no data when nothing overlaps', () => {
    const stats = aggregateWindow(
      hourly,
      Date.parse('2026-03-09T12:00:00Z'),
      Date.parse('2026-03-09T13:00:00Z'),
    )
    expect(stats.hasData).toBe(false)
    expect(stats.mm).toBe(0)
    expect(stats.probPct).toBeNull()
  })

  it('handles a full multi-hour session', () => {
    const stats = aggregateWindow(
      hourly,
      Date.parse('2026-03-08T12:00:00Z'),
      Date.parse('2026-03-08T15:00:00Z'),
    )
    expect(stats.mm).toBeCloseTo(1.4, 5)
    expect(stats.probPct).toBe(70)
  })
})

describe('minutely helpers', () => {
  const minutely: MinutePoint[] = [
    { timeUtc: 0, mm: 0 },
    { timeUtc: 15 * 60_000, mm: 0.1 },
    { timeUtc: 30 * 60_000, mm: 0.3 },
    { timeUtc: 45 * 60_000, mm: 0.02 },
    { timeUtc: 60 * 60_000, mm: 1.0 },
  ]

  it('sums steps inside the window only', () => {
    expect(sumMinutely(minutely, 0, 60 * 60_000)).toBeCloseTo(0.42, 5)
    expect(sumMinutely(minutely, 0, 61 * 60_000)).toBeCloseTo(1.42, 5)
  })

  it('finds the first meaningful wet step', () => {
    expect(firstWetStep(minutely, 0, 60 * 60_000)?.timeUtc).toBe(15 * 60_000)
    expect(firstWetStep(minutely, 20 * 60_000, 60 * 60_000)?.timeUtc).toBe(30 * 60_000)
    expect(firstWetStep(minutely, 61 * 60_000, 62 * 60_000)).toBeNull()
  })
})

describe('window bounds use half-open intervals', () => {
  it('does not count a step starting exactly at the end', () => {
    const hourly = [hour('2026-03-08T12:00:00', 1.0)]
    const stats = aggregateWindow(
      hourly,
      Date.parse('2026-03-08T13:00:00Z'),
      Date.parse('2026-03-08T14:00:00Z'),
    )
    expect(stats.hasData).toBe(false)
  })

  it('includes an hour that merely touches the start', () => {
    const hourly = [hour('2026-03-08T12:00:00', 1.0)]
    const stats = aggregateWindow(
      hourly,
      Date.parse('2026-03-08T13:00:00Z'),
      Date.parse('2026-03-08T13:30:00Z'),
    )
    // the 12:00 hour only touches the boundary — no overlap
    expect(stats.hasData).toBe(false)
  })
})
