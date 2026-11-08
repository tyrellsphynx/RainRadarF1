import { describe, expect, it } from 'vitest'
import { featuredWeekend, upcomingWeekends } from '../featured'
import { rawRaceToWeekend, type RawRace } from '../sessionWindows'

const race = (
  round: number,
  date: string,
  time: string,
  firstPractice: { date: string; time: string },
): RawRace => ({
  season: '2026',
  round: String(round),
  raceName: `Race ${round}`,
  Circuit: {
    circuitId: `circuit_${round}`,
    circuitName: `Circuit ${round}`,
    Location: { lat: '0', long: '0', locality: 'Town', country: 'Land' },
  },
  date,
  time,
  FirstPractice: firstPractice,
})

const W1 = rawRaceToWeekend({
  ...race(1, '2026-03-08', '04:00:00Z', { date: '2026-03-06', time: '01:30:00Z' }),
  ThirdPractice: { date: '2026-03-07', time: '01:30:00Z' },
})
const W2 = rawRaceToWeekend(race(2, '2026-03-22', '07:00:00Z', { date: '2026-03-20', time: '03:30:00Z' }))
const W3 = rawRaceToWeekend(race(3, '2026-04-05', '05:00:00Z', { date: '2026-04-03', time: '01:30:00Z' }))
const WEEKENDS = [W3, W1, W2] // deliberately unsorted

const at = (iso: string) => Date.parse(iso)

describe('featuredWeekend', () => {
  it('picks the live weekend', () => {
    // inside W1's race window (04:00-06:00 UTC)
    const f = featuredWeekend(WEEKENDS, at('2026-03-08T04:30:00Z'))
    expect(f?.weekend.round).toBe(1)
    expect(f?.state).toBe('live')
    expect(f?.session?.kind).toBe('Race')
  })

  it('reports "weekend" state between sessions', () => {
    // Saturday between FP1 and Qualifying (both on Mar 6-7)
    const f = featuredWeekend(WEEKENDS, at('2026-03-07T00:00:00Z'))
    expect(f?.weekend.round).toBe(1)
    expect(f?.state).toBe('weekend')
    expect(f?.session?.kind).toBe('FP3')
  })

  it('picks the next upcoming weekend well before it starts', () => {
    const f = featuredWeekend(WEEKENDS, at('2026-03-15T12:00:00Z'))
    expect(f?.weekend.round).toBe(2)
    expect(f?.state).toBe('next')
  })

  it('falls back to the final round after the season', () => {
    const f = featuredWeekend(WEEKENDS, at('2027-01-01T00:00:00Z'))
    expect(f?.weekend.round).toBe(3)
    expect(f?.state).toBe('offseason')
    expect(f?.session).toBeNull()
  })

  it('returns null without data', () => {
    expect(featuredWeekend([], at('2026-03-08T04:30:00Z'))).toBeNull()
  })
})

describe('upcomingWeekends', () => {
  it('lists unfinished weekends sorted by race time', () => {
    const list = upcomingWeekends(WEEKENDS, at('2026-03-15T12:00:00Z'))
    expect(list.map((w) => w.round)).toEqual([2, 3])
  })

  it('is empty after the season', () => {
    expect(upcomingWeekends(WEEKENDS, at('2027-01-01T00:00:00Z'))).toEqual([])
  })
})
