import type { RaceWeekend, Session, SessionKind } from './types'

/**
 * Structural view of a raw calendar record (Jolpica/Ergast schema).
 * The data layer passes its parsed JSON straight in — domain stays
 * decoupled from the wire format.
 */
export interface RawSessionTime {
  date: string
  time: string
}

export interface RawRace {
  season: string
  round: string
  raceName: string
  Circuit: {
    circuitId: string
    circuitName: string
    Location: {
      lat: string
      long: string
      locality: string
      country: string
    }
  }
  date: string
  time: string
  FirstPractice?: RawSessionTime
  SecondPractice?: RawSessionTime
  ThirdPractice?: RawSessionTime
  Qualifying?: RawSessionTime
  SprintQualifying?: RawSessionTime
  Sprint?: RawSessionTime
}

/**
 * Planned window lengths (minutes) used to align forecasts to sessions.
 * These are display windows, not exact green-flag-to-chequered-flag times.
 */
export const SESSION_DURATION_MIN: Record<SessionKind, number> = {
  FP1: 60,
  FP2: 60,
  FP3: 60,
  SprintQualifying: 44,
  Sprint: 60,
  Qualifying: 60,
  Race: 120,
}

/**
 * Parse a Jolpica date + time pair ("2026-03-06", "01:30:00Z") into Unix ms.
 * Times are always UTC; tolerate a missing seconds part or missing Z.
 */
export function parseUtcDateTime(date: string, time: string): number {
  const iso = /^\d{2}:\d{2}:\d{2}$/.test(time) ? `${time}Z` : time.endsWith('Z') ? time : `${time}Z`
  const ms = Date.parse(`${date}T${iso}`)
  if (Number.isNaN(ms)) throw new Error(`Invalid date/time: ${date} ${time}`)
  return ms
}

/** Build a session with its planned end window. */
export function makeSession(kind: SessionKind, startUtc: number): Session {
  return {
    kind,
    startUtc,
    endUtc: startUtc + SESSION_DURATION_MIN[kind] * 60_000,
  }
}

const SESSION_ORDER: Array<[keyof RawRace, SessionKind]> = [
  ['FirstPractice', 'FP1'],
  ['SecondPractice', 'FP2'],
  ['ThirdPractice', 'FP3'],
  ['SprintQualifying', 'SprintQualifying'],
  ['Sprint', 'Sprint'],
  ['Qualifying', 'Qualifying'],
]

/** Normalize a raw calendar record into a RaceWeekend. */
export function rawRaceToWeekend(race: RawRace): RaceWeekend {
  const sessions: Session[] = SESSION_ORDER.flatMap(([key, kind]) => {
    const raw = race[key] as RawSessionTime | undefined
    return raw ? [makeSession(kind, parseUtcDateTime(raw.date, raw.time))] : []
  })

  const raceStartUtc = parseUtcDateTime(race.date, race.time)
  sessions.push(makeSession('Race', raceStartUtc))
  sessions.sort((a, b) => a.startUtc - b.startUtc)

  return {
    season: Number(race.season),
    round: Number(race.round),
    raceName: race.raceName,
    circuit: {
      circuitId: race.Circuit.circuitId,
      circuitName: race.Circuit.circuitName,
      locality: race.Circuit.Location.locality,
      country: race.Circuit.Location.country,
      lat: Number(race.Circuit.Location.lat),
      lon: Number(race.Circuit.Location.long),
    },
    raceStartUtc,
    sessions,
  }
}

export function nextSessionAfter(weekend: RaceWeekend, nowMs: number): Session | null {
  for (const s of weekend.sessions) {
    if (s.startUtc > nowMs) return s
  }
  return null
}

export function activeSession(weekend: RaceWeekend, nowMs: number): Session | null {
  for (const s of weekend.sessions) {
    if (s.startUtc <= nowMs && nowMs <= s.endUtc) return s
  }
  return null
}

export function isWeekendDone(weekend: RaceWeekend, nowMs: number): boolean {
  const last = weekend.sessions[weekend.sessions.length - 1]
  return last !== undefined && last.endUtc < nowMs
}

export function isWeekendStarted(weekend: RaceWeekend, nowMs: number): boolean {
  const first = weekend.sessions[0]
  return first !== undefined && first.startUtc <= nowMs
}
