import { describe, expect, it } from 'vitest'
import {
  argmaxCompound,
  CROSSOVER_FUZZ_MMH,
  INTERS_WETS_MMH,
  isStreetCircuit,
  minutesToCrossover,
  peakRateMmH,
  raceShapeFlags,
  SLICKS_INTERS_MMH,
  smoothstep,
  toPercentages,
  tyreCallForWindow,
  tyreDistribution,
  tyreTimeline,
} from '../tyreCall'
import type { HourlyPoint, MinutePoint } from '../types'

const H = 3_600_000
const M15 = 15 * 60_000
const T0 = Date.parse('2026-11-08T12:00:00Z')

const hour = (index: number, mm: number, probPct: number | null = null): HourlyPoint => ({
  timeUtc: T0 + index * H,
  mm,
  probPct,
  rainMm: mm,
  showersMm: 0,
})

const min = (index: number, mm: number): MinutePoint => ({
  timeUtc: T0 + index * M15,
  mm,
})

describe('smoothstep', () => {
  it('clamps outside the edges and is 0.5 at the midpoint', () => {
    expect(smoothstep(0, 1, -5)).toBe(0)
    expect(smoothstep(0, 1, 5)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 5)
  })
})

describe('tyreDistribution', () => {
  it('is all slicks when there is no rain risk', () => {
    expect(tyreDistribution(0, 0)).toEqual({ slicks: 1, inters: 0, wets: 0 })
    expect(tyreDistribution(0, null)).toEqual({ slicks: 1, inters: 0, wets: 0 })
  })

  it('is all wets for heavy rain', () => {
    const d = tyreDistribution(12, 100)
    expect(d.wets).toBeCloseTo(1, 5)
  })

  it('splits ~50/50 exactly at the slicks-inters crossover', () => {
    const d = tyreDistribution(SLICKS_INTERS_MMH, 100)
    expect(d.slicks).toBeCloseTo(0.5, 5)
    expect(d.inters).toBeCloseTo(0.5, 5)
    expect(d.wets).toBeCloseTo(0, 5)
  })

  it('splits ~50/50 exactly at the inters-wets crossover', () => {
    const d = tyreDistribution(INTERS_WETS_MMH, 100)
    expect(d.wets).toBeCloseTo(0.5, 5)
    expect(d.inters).toBeCloseTo(0.5, 5)
    expect(d.slicks).toBeCloseTo(0, 5)
  })

  it('mixes rather than flips just past the crossover', () => {
    const d = tyreDistribution(1.6, 100)
    expect(d.inters).toBeGreaterThan(0.5)
    expect(d.inters).toBeLessThan(0.7)
    expect(d.slicks).toBeGreaterThan(0.25)
  })

  it('always sums to 1', () => {
    for (const rate of [0, 0.2, 1.5, 1.6, 3, 4.9, 5, 5.2, 20]) {
      for (const prob of [null, 0, 40, 88, 100]) {
        const d = tyreDistribution(rate, prob)
        expect(d.slicks + d.inters + d.wets).toBeCloseTo(1, 5)
      }
    }
  })

  it('treats a null probability with rain present as certain rain', () => {
    const d = tyreDistribution(3, null)
    expect(d.slicks).toBeCloseTo(0, 5)
    expect(d.inters).toBeCloseTo(1, 5)
  })

  it('is fuzzy over a CROSSOVER_FUZZ_MMH-wide band', () => {
    const lo = tyreDistribution(SLICKS_INTERS_MMH - CROSSOVER_FUZZ_MMH, 100)
    const hi = tyreDistribution(SLICKS_INTERS_MMH + CROSSOVER_FUZZ_MMH, 100)
    expect(lo.inters).toBeCloseTo(0, 5)
    expect(hi.inters).toBeCloseTo(1, 5)
  })
})

describe('argmaxCompound', () => {
  it('picks the largest share', () => {
    expect(argmaxCompound({ slicks: 0.7, inters: 0.2, wets: 0.1 })).toBe('slicks')
    expect(argmaxCompound({ slicks: 0.2, inters: 0.7, wets: 0.1 })).toBe('inters')
    expect(argmaxCompound({ slicks: 0.1, inters: 0.2, wets: 0.7 })).toBe('wets')
  })
})

describe('peakRateMmH', () => {
  it('uses hourly mm/h when there is no minutely data', () => {
    expect(peakRateMmH([hour(0, 0.2), hour(1, 2.4), hour(2, 0)], null, T0, T0 + 3 * H)).toBe(2.4)
  })

  it('prefers minutely resolution (mm per 15 min → mm/h)', () => {
    const minutely = [min(0, 0.1), min(1, 0.5), min(2, 0.2)]
    expect(peakRateMmH([hour(0, 1.0)], minutely, T0, T0 + H)).toBe(2.0)
  })

  it('only considers steps inside the window', () => {
    const minutely = [min(0, 0.1), min(10, 2.0)]
    expect(peakRateMmH([], minutely, T0, T0 + H)).toBe(0.4)
  })
})

describe('tyreCallForWindow', () => {
  it('is unknown without forecast data', () => {
    const call = tyreCallForWindow([], null, T0, T0 + H)
    expect(call.hasData).toBe(false)
    expect(call.compound).toBe('unknown')
  })

  it('calls inters for a wet session and reports the peak rate', () => {
    const call = tyreCallForWindow([hour(0, 2.4, 90), hour(1, 2.0, 85)], null, T0, T0 + 2 * H)
    expect(call.hasData).toBe(true)
    expect(call.compound).toBe('inters')
    expect(call.peakRateMmH).toBe(2.4)
    expect(call.rainProbPct).toBe(90)
  })

  it('calls wets for heavy rain', () => {
    expect(tyreCallForWindow([hour(0, 8, 100)], null, T0, T0 + H).compound).toBe('wets')
  })
})

describe('tyreTimeline', () => {
  it('falls back to hourly steps when minutely is unavailable', () => {
    const timeline = tyreTimeline([hour(0, 0, 10), hour(1, 3, 90)], null, T0, T0 + 2 * H)
    expect(timeline.steps).toHaveLength(2)
    expect(timeline.steps[0]?.stepMs).toBe(H)
    expect(timeline.steps[0]?.compound).toBe('slicks')
    expect(timeline.steps[1]?.compound).toBe('inters')
  })

  it('prefers minutely steps where available', () => {
    const minutely = [min(0, 0), min(1, 0.2), min(2, 0), min(3, 0)]
    const timeline = tyreTimeline([hour(0, 0.2, 50)], minutely, T0, T0 + H)
    expect(timeline.steps).toHaveLength(4)
    expect(timeline.steps[0]?.stepMs).toBe(M15)
  })

  it('detects crossovers with minutes from the window start', () => {
    // hour 0: inters rate; hour 1: drying to slicks rate
    const timeline = tyreTimeline([hour(0, 3, 100), hour(1, 0.2, 30)], null, T0, T0 + 2 * H)
    expect(timeline.crossovers).toHaveLength(1)
    expect(timeline.crossovers[0]).toMatchObject({ minute: 60, from: 'inters', to: 'slicks' })
  })

  it('minutesToCrossover finds the requested flip only', () => {
    const timeline = tyreTimeline([hour(0, 3, 100), hour(1, 0.2, 30)], null, T0, T0 + 2 * H)
    expect(minutesToCrossover(timeline, 'inters', 'slicks')).toBe(60)
    expect(minutesToCrossover(timeline, 'slicks', 'inters')).toBeNull()
    expect(minutesToCrossover(timeline, 'inters', 'wets')).toBeNull()
  })

  it('is empty without data', () => {
    const timeline = tyreTimeline([], null, T0, T0 + H)
    expect(timeline.steps).toEqual([])
    expect(timeline.crossovers).toEqual([])
  })
})

describe('raceShapeFlags', () => {
  const wetWindow = (mm: number, count: number) =>
    Array.from({ length: count }, (_, i) => hour(i, mm, 100))

  it('is empty for a dry race', () => {
    expect(raceShapeFlags('monza', wetWindow(0, 5), null, T0, T0 + 5 * H)).toEqual([])
  })

  it('flags safety-car likelihood above the inters rate', () => {
    const flags = raceShapeFlags('monza', wetWindow(2, 5), null, T0, T0 + 5 * H)
    const sc = flags.find((f) => f.kind === 'safety-car')
    expect(sc?.level).toBe('elevated')
    expect(sc?.text).toContain('Safety-car likelihood elevated')
    expect(sc?.text).not.toContain('street')
  })

  it('weights street circuits up to high', () => {
    const flags = raceShapeFlags('monaco', wetWindow(2, 5), null, T0, T0 + 5 * H)
    expect(flags.find((f) => f.kind === 'safety-car')?.level).toBe('high')
  })

  it('flags time-limit risk only when rain is sustained', () => {
    const sustained = raceShapeFlags('monza', wetWindow(2, 5), null, T0, T0 + 5 * H)
    expect(sustained.find((f) => f.kind === 'time-limit')).toBeDefined()

    // one wet hour out of five is a shower, not sustained rain
    const passing = raceShapeFlags('monza', [hour(0, 2, 100), ...wetWindow(0, 4)], null, T0, T0 + 5 * H)
    expect(passing.find((f) => f.kind === 'time-limit')).toBeUndefined()
  })

  it('is empty without data', () => {
    expect(raceShapeFlags('monza', [], null, T0, T0 + H)).toEqual([])
  })

  it('knows the street circuits', () => {
    expect(isStreetCircuit('monaco')).toBe(true)
    expect(isStreetCircuit('jeddah')).toBe(true)
    expect(isStreetCircuit('monza')).toBe(false)
  })
})

describe('toPercentages', () => {
  it('rounds to whole numbers summing to 100', () => {
    const pcts = toPercentages({ slicks: 1 / 3, inters: 1 / 3, wets: 1 / 3 })
    expect(pcts.reduce((s, p) => s + p.pct, 0)).toBe(100)
  })

  it('sorts descending and drops zero shares', () => {
    const pcts = toPercentages({ slicks: 0.05, inters: 0.72, wets: 0.23 })
    expect(pcts.map((p) => p.compound)).toEqual(['inters', 'wets', 'slicks'])
    const zero = toPercentages({ slicks: 1, inters: 0, wets: 0 })
    expect(zero).toEqual([{ compound: 'slicks', pct: 100 }])
  })
})
