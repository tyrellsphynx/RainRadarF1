import { describe, expect, it } from 'vitest'
import {
  activeSession,
  isWeekendDone,
  isWeekendStarted,
  makeSession,
  nextSessionAfter,
  parseUtcDateTime,
  rawRaceToWeekend,
  SESSION_DURATION_MIN,
  type RawRace,
} from '../sessionWindows'

const CONVENTIONAL: RawRace = {
  season: '2026',
  round: '1',
  raceName: 'Australian Grand Prix',
  Circuit: {
    circuitId: 'albert_park',
    circuitName: 'Albert Park Grand Prix Circuit',
    Location: { lat: '-37.8497', long: '144.968', locality: 'Melbourne', country: 'Australia' },
  },
  date: '2026-03-08',
  time: '04:00:00Z',
  FirstPractice: { date: '2026-03-06', time: '01:30:00Z' },
  SecondPractice: { date: '2026-03-06', time: '05:00:00Z' },
  ThirdPractice: { date: '2026-03-07', time: '01:30:00Z' },
  Qualifying: { date: '2026-03-07', time: '05:00:00Z' },
}

const SPRINT: RawRace = {
  season: '2026',
  round: '5',
  raceName: 'Miami Grand Prix',
  Circuit: {
    circuitId: 'miami',
    circuitName: 'Miami International Autodrome',
    Location: { lat: '25.9581', long: '-80.2389', locality: 'Miami', country: 'USA' },
  },
  date: '2026-05-03',
  time: '20:00:00Z',
  FirstPractice: { date: '2026-05-01', time: '17:30:00Z' },
  SprintQualifying: { date: '2026-05-01', time: '21:30:00Z' },
  Sprint: { date: '2026-05-02', time: '17:00:00Z' },
  Qualifying: { date: '2026-05-02', time: '21:00:00Z' },
}

describe('parseUtcDateTime', () => {
  it('parses Jolpica date+time pairs as UTC', () => {
    expect(parseUtcDateTime('2026-03-08', '04:00:00Z')).toBe(Date.parse('2026-03-08T04:00:00Z'))
  })

  it('tolerates a missing seconds part', () => {
    expect(parseUtcDateTime('2026-03-08', '04:00Z')).toBe(Date.parse('2026-03-08T04:00:00Z'))
  })

  it('throws on garbage', () => {
    expect(() => parseUtcDateTime('not-a-date', '04:00:00Z')).toThrow()
  })
})

describe('makeSession', () => {
  it('applies planned window lengths', () => {
    const start = Date.parse('2026-03-08T04:00:00Z')
    expect(makeSession('Race', start).endUtc).toBe(start + 120 * 60_000)
    expect(makeSession('SprintQualifying', start).endUtc).toBe(start + 44 * 60_000)
    expect(SESSION_DURATION_MIN.FP1).toBe(60)
  })
})

describe('rawRaceToWeekend', () => {
  it('builds a conventional weekend in chronological order', () => {
    const weekend = rawRaceToWeekend(CONVENTIONAL)
    expect(weekend.sessions.map((s) => s.kind)).toEqual([
      'FP1',
      'FP2',
      'FP3',
      'Qualifying',
      'Race',
    ])
    expect(weekend.raceStartUtc).toBe(Date.parse('2026-03-08T04:00:00Z'))
    expect(weekend.round).toBe(1)
    expect(weekend.circuit.lat).toBeCloseTo(-37.8497)
  })

  it('builds a sprint weekend without FP2/FP3', () => {
    const weekend = rawRaceToWeekend(SPRINT)
    expect(weekend.sessions.map((s) => s.kind)).toEqual([
      'FP1',
      'SprintQualifying',
      'Sprint',
      'Qualifying',
      'Race',
    ])
    // sorted by start time
    for (let i = 1; i < weekend.sessions.length; i++) {
      const prev = weekend.sessions[i - 1]
      const cur = weekend.sessions[i]
      if (prev && cur) expect(cur.startUtc).toBeGreaterThan(prev.startUtc)
    }
  })
})

describe('session lookup', () => {
  const weekend = rawRaceToWeekend(CONVENTIONAL)
  const race = weekend.sessions[weekend.sessions.length - 1]

  it('finds the active session inside its window', () => {
    expect(race).toBeDefined()
    if (!race) return
    expect(activeSession(weekend, race.startUtc + 5 * 60_000)?.kind).toBe('Race')
    expect(activeSession(weekend, race.endUtc + 1)).toBeNull()
  })

  it('finds the next session after now', () => {
    const fp1 = weekend.sessions[0]
    if (!fp1) return
    expect(nextSessionAfter(weekend, fp1.startUtc - 1)?.kind).toBe('FP1')
    expect(nextSessionAfter(weekend, race.endUtc)).toBeNull()
  })

  it('knows when the weekend has started / finished', () => {
    const fp1 = weekend.sessions[0]
    if (!fp1 || !race) return
    expect(isWeekendStarted(weekend, fp1.startUtc - 1)).toBe(false)
    expect(isWeekendStarted(weekend, fp1.startUtc)).toBe(true)
    expect(isWeekendDone(weekend, race.endUtc)).toBe(false)
    expect(isWeekendDone(weekend, race.endUtc + 1)).toBe(true)
  })
})
