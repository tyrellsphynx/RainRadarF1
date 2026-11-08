import type { HourlyPoint, MinutePoint } from './types'
import { aggregateWindow } from './aggregate'

/**
 * Tyre-call mode (strategy lens): a derived layer over the forecast series
 * that translates rainfall into the language of a pit wall —
 * Slicks / Inters / Wets — with explicit uncertainty. A model on top of a
 * model: every call is a distribution, never a flat verdict.
 */

export type Compound = 'unknown' | 'slicks' | 'inters' | 'wets'
export type DryCompound = Exclude<Compound, 'unknown'>

/** Probability shares, always summing to 1 (except for the unknown call). */
export interface TyreDistribution {
  slicks: number
  inters: number
  wets: number
}

export interface TyreCall {
  hasData: boolean
  /** Compound with the largest share of the distribution. */
  compound: Compound
  distribution: TyreDistribution
  /** Peak rainfall rate inside the session window, mm/h. */
  peakRateMmH: number
  /** Rain probability over the window, 0-100 (null when the model has none). */
  rainProbPct: number | null
}

export interface TyreStep {
  timeUtc: number
  /** Length of this step, ms (15 min for minutely_15, 1 h for hourly). */
  stepMs: number
  compound: Compound
  distribution: TyreDistribution
  rateMmH: number
}

export interface Crossover {
  timeUtc: number
  /** Minutes from the session window start. */
  minute: number
  from: Compound
  to: Compound
}

export interface TyreTimeline {
  steps: TyreStep[]
  crossovers: Crossover[]
  windowStartMs: number
}

/** Slicks → inters crossover rate (heuristic, tunable). */
export const SLICKS_INTERS_MMH = 1.5
/** Inters → wets crossover rate (heuristic, tunable). */
export const INTERS_WETS_MMH = 5.0
/** Half-width of the soft band around each crossover. */
export const CROSSOVER_FUZZ_MMH = 0.75
/** Share of window steps that must be wet for "sustained rain". */
export const SUSTAINED_FRACTION = 0.34

const MINUTELY_STEP_MS = 15 * 60_000
const HOURLY_STEP_MS = 3_600_000

export const COMPOUND_META: Record<Compound, { label: string; color: string; hint: string }> = {
  unknown: {
    label: 'Too early to call',
    color: '#64748b',
    hint: 'No forecast data for this window yet.',
  },
  slicks: {
    label: 'Slicks',
    color: '#22c55e',
    hint: 'Dry enough for slick tyres.',
  },
  inters: {
    label: 'Inters',
    color: '#f59e0b',
    hint: 'Intermediate tyres the safe call.',
  },
  wets: {
    label: 'Wets',
    color: '#3b82f6',
    hint: 'Full wet tyres.',
  },
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/** Classic smoothstep between two edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * Distribution over compounds for a rainfall rate + rain probability.
 * P(slicks) includes "no rain at all" plus "rain light enough for slicks";
 * the rain share is split across bands with soft (fuzzy) thresholds so a
 * rate of 1.6 mm/h is a mix, not a hard flip.
 */
export function tyreDistribution(rateMmH: number, rainProbPct: number | null): TyreDistribution {
  const pRain =
    rainProbPct !== null ? clamp01(rainProbPct / 100) : rateMmH > 0 ? 1 : 0

  const slicksGivenRain =
    1 - smoothstep(SLICKS_INTERS_MMH - CROSSOVER_FUZZ_MMH, SLICKS_INTERS_MMH + CROSSOVER_FUZZ_MMH, rateMmH)
  const wetsGivenRain = smoothstep(
    INTERS_WETS_MMH - CROSSOVER_FUZZ_MMH,
    INTERS_WETS_MMH + CROSSOVER_FUZZ_MMH,
    rateMmH,
  )
  const intersGivenRain = 1 - slicksGivenRain - wetsGivenRain

  return {
    slicks: (1 - pRain) + pRain * slicksGivenRain,
    inters: pRain * intersGivenRain,
    wets: pRain * wetsGivenRain,
  }
}

export function argmaxCompound(distribution: TyreDistribution): DryCompound {
  const { slicks, inters, wets } = distribution
  if (inters >= slicks && inters >= wets) return 'inters'
  if (wets >= slicks) return 'wets'
  return 'slicks'
}

/** Peak rainfall rate inside [startMs, endMs), mm/h. Minutely wins when present. */
export function peakRateMmH(
  hourly: HourlyPoint[],
  minutely15: MinutePoint[] | null,
  startMs: number,
  endMs: number,
): number {
  let peak = 0
  if (minutely15) {
    for (const p of minutely15) {
      if (p.timeUtc >= startMs && p.timeUtc < endMs) peak = Math.max(peak, p.mm * 4)
    }
    if (peak > 0) return peak
  }
  for (const p of hourly) {
    const overlap = Math.min(p.timeUtc + HOURLY_STEP_MS, endMs) - Math.max(p.timeUtc, startMs)
    if (overlap > 0) peak = Math.max(peak, p.mm)
  }
  return peak
}

/** The tyre call for one session window. */
export function tyreCallForWindow(
  hourly: HourlyPoint[],
  minutely15: MinutePoint[] | null,
  startMs: number,
  endMs: number,
): TyreCall {
  const stats = aggregateWindow(hourly, startMs, endMs)
  const peak = peakRateMmH(hourly, minutely15, startMs, endMs)
  const distribution = tyreDistribution(peak, stats.probPct)
  return {
    hasData: stats.hasData,
    compound: stats.hasData ? argmaxCompound(distribution) : 'unknown',
    distribution,
    peakRateMmH: peak,
    rainProbPct: stats.probPct,
  }
}

/**
 * Per-step tyre call across a session window. Uses minutely_15 steps where
 * the model provides them (finer resolution), hourly steps elsewhere.
 */
export function tyreTimeline(
  hourly: HourlyPoint[],
  minutely15: MinutePoint[] | null,
  startMs: number,
  endMs: number,
): TyreTimeline {
  const steps = buildSteps(hourly, minutely15, startMs, endMs)
  const crossovers: Crossover[] = []
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]
    const cur = steps[i]
    if (prev && cur && prev.compound !== cur.compound) {
      crossovers.push({
        timeUtc: cur.timeUtc,
        minute: Math.round((cur.timeUtc - startMs) / 60_000),
        from: prev.compound,
        to: cur.compound,
      })
    }
  }
  return { steps, crossovers, windowStartMs: startMs }
}

function buildSteps(
  hourly: HourlyPoint[],
  minutely15: MinutePoint[] | null,
  startMs: number,
  endMs: number,
): TyreStep[] {
  const minutelyOverlaps =
    minutely15?.filter((p) => p.timeUtc >= startMs && p.timeUtc < endMs).length ?? 0

  if (minutely15 && minutelyOverlaps >= 2) {
    return minutely15
      .filter((p) => p.timeUtc >= startMs && p.timeUtc < endMs)
      .map((p) => {
        // probability lives on the hourly series; borrow the containing hour's
        const hour = hourly.find((h) => p.timeUtc >= h.timeUtc && p.timeUtc < h.timeUtc + HOURLY_STEP_MS)
        const rateMmH = round2(p.mm * 4)
        const distribution = tyreDistribution(rateMmH, hour?.probPct ?? null)
        return {
          timeUtc: p.timeUtc,
          stepMs: MINUTELY_STEP_MS,
          rateMmH,
          distribution,
          compound: argmaxCompound(distribution),
        }
      })
  }

  return hourly
    .filter((p) => Math.min(p.timeUtc + HOURLY_STEP_MS, endMs) - Math.max(p.timeUtc, startMs) > 0)
    .map((p) => {
      const distribution = tyreDistribution(p.mm, p.probPct)
      return {
        timeUtc: p.timeUtc,
        stepMs: HOURLY_STEP_MS,
        rateMmH: round2(p.mm),
        distribution,
        compound: argmaxCompound(distribution),
      }
    })
}

/** First switch from `from` to `to`, in minutes from the window start. */
export function minutesToCrossover(
  timeline: TyreTimeline,
  from: Compound,
  to: Compound,
): number | null {
  const hit = timeline.crossovers.find((c) => c.from === from && c.to === to)
  return hit ? hit.minute : null
}

/**
 * Street circuits — safety-car likelihood is weighted up here when rain
 * arrives (walls, no runoff, recovery takes laps).
 */
export const STREET_CIRCUIT_IDS: ReadonlySet<string> = new Set([
  'monaco',
  'baku',
  'jeddah',
  'marina_bay',
  'vegas',
  'miami',
  'albert_park',
  'villeneuve',
  'madring',
])

export function isStreetCircuit(circuitId: string): boolean {
  return STREET_CIRCUIT_IDS.has(circuitId)
}

export type RaceFlagKind = 'safety-car' | 'time-limit'

export interface RaceFlag {
  kind: RaceFlagKind
  level: 'elevated' | 'high'
  text: string
}

/**
 * Strategy-shape flags for a race window. Wording is deliberately
 * probabilistic ("elevated", "likely") — never "will".
 */
export function raceShapeFlags(
  circuitId: string,
  hourly: HourlyPoint[],
  minutely15: MinutePoint[] | null,
  startMs: number,
  endMs: number,
): RaceFlag[] {
  const steps = buildSteps(hourly, minutely15, startMs, endMs)
  if (steps.length === 0) return []

  const flags: RaceFlag[] = []
  const rates = steps.map((s) => s.rateMmH)
  const peak = Math.max(...rates)
  const above = rates.filter((r) => r >= SLICKS_INTERS_MMH).length
  const sustained = above / rates.length >= SUSTAINED_FRACTION

  if (peak >= SLICKS_INTERS_MMH) {
    const street = isStreetCircuit(circuitId)
    const rateWord = peak >= INTERS_WETS_MMH ? 'heavy rain expected' : 'rain at intermediate rate'
    flags.push({
      kind: 'safety-car',
      level: street ? 'high' : 'elevated',
      text: `Safety-car likelihood ${street ? 'high' : 'elevated'}: ${rateWord}${street ? ' on a street circuit' : ''}.`,
    })
  }
  if (sustained) {
    flags.push({
      kind: 'time-limit',
      level: 'elevated',
      text: '2-hour race limit likely to be a factor (sustained rain expected).',
    })
  }
  return flags
}

export interface CompoundPercentage {
  compound: DryCompound
  pct: number
}

/**
 * Whole-number percentages for display (largest-remainder, summing to 100),
 * sorted descending, dropping zero shares.
 */
export function toPercentages(distribution: TyreDistribution): CompoundPercentage[] {
  const raw: Array<{ compound: DryCompound; exact: number }> = [
    { compound: 'slicks', exact: distribution.slicks * 100 },
    { compound: 'inters', exact: distribution.inters * 100 },
    { compound: 'wets', exact: distribution.wets * 100 },
  ]
  const result = raw.map((r) => ({ compound: r.compound, pct: Math.floor(r.exact) }))
  let remainder = 100 - result.reduce((sum, r) => sum + r.pct, 0)
  const order = [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1))
  for (const r of order) {
    if (remainder <= 0) break
    const target = result.find((x) => x.compound === r.compound)
    if (target) {
      target.pct += 1
      remainder -= 1
    }
  }
  return result.filter((r) => r.pct > 0).sort((a, b) => b.pct - a.pct)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
