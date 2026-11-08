/** A practice/qualifying/race session type as used by the F1 calendar. */
export type SessionKind =
  | 'FP1'
  | 'FP2'
  | 'FP3'
  | 'SprintQualifying'
  | 'Sprint'
  | 'Qualifying'
  | 'Race'

export interface Session {
  kind: SessionKind
  /** Session start, Unix ms (UTC). */
  startUtc: number
  /** Planned end of the session window, Unix ms (UTC). */
  endUtc: number
}

export interface Circuit {
  circuitId: string
  circuitName: string
  locality: string
  country: string
  lat: number
  lon: number
}

export interface RaceWeekend {
  season: number
  round: number
  raceName: string
  circuit: Circuit
  /** Race start, Unix ms (UTC). */
  raceStartUtc: number
  /** All sessions of the weekend, sorted by start time. */
  sessions: Session[]
}

/**
 * Verdict vocabulary (deliberately meteorological, not tyre-call language).
 * - `unknown`:  outside forecast horizon / no data yet
 * - `dry`:      no meaningful precipitation expected
 * - `isolated`: mostly dry, but a stray shower can't be ruled out
 * - `showers`:  intermittent rain expected
 * - `rain`:     sustained rain expected
 */
export type Verdict = 'unknown' | 'dry' | 'isolated' | 'showers' | 'rain'

export interface WindowStats {
  /** True when at least one forecast hour overlaps the window. */
  hasData: boolean
  /** Expected precipitation accumulation across the window, mm. */
  mm: number
  /** Max hourly precipitation probability across the window, 0-100 (null when model has no probability). */
  probPct: number | null
}

export interface SessionVerdict extends WindowStats {
  verdict: Verdict
}

export interface HourlyPoint {
  /** Start of the hour, Unix ms (UTC). */
  timeUtc: number
  /** Precipitation sum for the hour, mm. */
  mm: number
  /** Precipitation probability for the hour, 0-100, or null when unavailable. */
  probPct: number | null
  /** Rain portion, mm. */
  rainMm: number
  /** Showers portion, mm. */
  showersMm: number
}

export interface MinutePoint {
  /** Start of the 15-minute step, Unix ms (UTC). */
  timeUtc: number
  /** Precipitation sum for the 15-minute step, mm. */
  mm: number
}

export interface Forecast {
  hourly: HourlyPoint[]
  minutely15: MinutePoint[] | null
  fetchedAt: number
}
