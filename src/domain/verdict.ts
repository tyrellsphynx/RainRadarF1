import type { SessionVerdict, Verdict, WindowStats } from './types'

/** mm (prorated, across the session window) at or above which rain is "sustained". */
export const RAIN_MM = 2.0
/** mm at or above which the session counts as showery. */
export const SHOWERS_MM = 0.2
/** probability (%) at or above which a nominally dry session still counts as "isolated showers" risk. */
export const ISOLATED_PROB_PCT = 25

/**
 * Classify a session window. Thresholds are deliberately simple and
 * deterministic — they are the app's truth-telling core and unit-tested.
 */
export function classify(stats: WindowStats): Verdict {
  if (!stats.hasData) return 'unknown'
  if (stats.mm >= RAIN_MM) return 'rain'
  if (stats.mm >= SHOWERS_MM) return 'showers'
  if ((stats.probPct ?? 0) >= ISOLATED_PROB_PCT) return 'isolated'
  return 'dry'
}

export function sessionVerdict(stats: WindowStats): SessionVerdict {
  return { ...stats, verdict: classify(stats) }
}

export interface VerdictMeta {
  label: string
  color: string
  hint: string
}

export const VERDICT_META: Record<Verdict, VerdictMeta> = {
  unknown: {
    label: 'Too early to call',
    color: '#64748b',
    hint: 'Outside the forecast horizon — check back closer to the weekend.',
  },
  dry: {
    label: 'Dry',
    color: '#22c55e',
    hint: 'No meaningful rain expected during this session.',
  },
  isolated: {
    label: 'Isolated showers',
    color: '#eab308',
    hint: 'Mostly dry, but a stray shower cannot be ruled out.',
  },
  showers: {
    label: 'Showers',
    color: '#f97316',
    hint: 'Intermittent rain expected during this session.',
  },
  rain: {
    label: 'Rain',
    color: '#ef4444',
    hint: 'Sustained rain expected during this session.',
  },
}
