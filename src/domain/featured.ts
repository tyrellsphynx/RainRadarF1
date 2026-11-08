import type { RaceWeekend, Session } from './types'
import { activeSession, isWeekendDone, isWeekendStarted, nextSessionAfter } from './sessionWindows'

export type FeaturedState =
  /** a session is happening right now */
  | 'live'
  /** race weekend is on (first session started, none live) */
  | 'weekend'
  /** before the weekend starts */
  | 'next'
  /** season over: featured round is the last one */
  | 'offseason'

export interface Featured {
  weekend: RaceWeekend
  state: FeaturedState
  /** the upcoming session (live session when state === 'live'), if any */
  session: Session | null
}

/**
 * Pick the weekend the home page should feature:
 * the one whose window contains "now", else the next upcoming one,
 * else (season over) the final round of the season.
 */
export function featuredWeekend(weekends: RaceWeekend[], nowMs: number): Featured | null {
  const sorted = [...weekends].sort((a, b) => a.raceStartUtc - b.raceStartUtc)
  if (sorted.length === 0) return null

  for (const weekend of sorted) {
    const live = activeSession(weekend, nowMs)
    if (live) return { weekend, state: 'live', session: live }

    const next = nextSessionAfter(weekend, nowMs)
    if (next) {
      const state: FeaturedState = isWeekendStarted(weekend, nowMs) ? 'weekend' : 'next'
      return { weekend, state, session: next }
    }
  }

  const last = sorted[sorted.length - 1]
  if (last === undefined) return null
  return { weekend: last, state: 'offseason', session: null }
}

/** Weekends that haven't finished yet (caller filters out the featured one). */
export function upcomingWeekends(weekends: RaceWeekend[], nowMs: number): RaceWeekend[] {
  return weekends
    .filter((w) => !isWeekendDone(w, nowMs))
    .sort((a, b) => a.raceStartUtc - b.raceStartUtc)
}
