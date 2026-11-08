import { describe, expect, it } from 'vitest'
import { countdownParts, formatCountdown, formatInTz, minutesUntil, tzAt } from '../time'

describe('tzAt', () => {
  it('resolves IANA zones from coordinates', () => {
    expect(tzAt(-37.8497, 144.968)).toBe('Australia/Melbourne')
    expect(tzAt(43.7347, 7.42056)).toBe('Europe/Monaco')
    expect(tzAt(30.1328, -97.6411)).toBe('America/Chicago')
    expect(tzAt(24.4672, 54.6031)).toBe('Asia/Dubai')
  })

  it('falls back to UTC for nonsense coordinates', () => {
    expect(tzAt(Number.NaN, Number.NaN)).toBe('UTC')
  })
})

describe('formatInTz', () => {
  it('converts UTC instants to track-local time (Melbourne, AEDT)', () => {
    // 2026 Australian GP: 04:00 UTC = 15:00 Melbourne (UTC+11, DST active)
    const t = formatInTz(Date.parse('2026-03-08T04:00:00Z'), 'Australia/Melbourne')
    expect(t.time).toBe('15:00')
  })

  it('is correct on both sides of a European DST switch', () => {
    // EU spring-forward: 2026-03-29 01:00 UTC
    const before = formatInTz(Date.parse('2026-03-28T15:00:00Z'), 'Europe/Monaco')
    const after = formatInTz(Date.parse('2026-03-29T15:00:00Z'), 'Europe/Monaco')
    expect(before.time).toBe('16:00') // CET (UTC+1)
    expect(after.time).toBe('17:00') // CEST (UTC+2)
  })

  it('is correct on both sides of a US DST switch', () => {
    // US spring-forward: 2026-03-08 02:00 local
    const before = formatInTz(Date.parse('2026-03-08T04:00:00Z'), 'America/Chicago')
    const after = formatInTz(Date.parse('2026-03-09T04:00:00Z'), 'America/Chicago')
    expect(before.time).toBe('22:00') // CST (UTC-6), March 7 local
    expect(after.time).toBe('23:00') // CDT (UTC-5), March 8 local
  })

  it('formats a weekday+date label', () => {
    const t = formatInTz(Date.parse('2026-03-08T04:00:00Z'), 'Europe/Monaco')
    expect(t.dateLabel).toContain('8')
    expect(t.dateLabel).toMatch(/Mar/)
  })
})

describe('countdown', () => {
  const now = Date.parse('2026-03-05T12:00:00Z')

  it('counts days, hours, minutes', () => {
    const target = now + (3 * 86_400 + 4 * 3_600 + 12 * 60 + 30) * 1000
    const parts = countdownParts(target, now)
    expect(parts.days).toBe(3)
    expect(parts.hours).toBe(4)
    expect(parts.minutes).toBe(12)
    expect(parts.seconds).toBe(30)
    expect(formatCountdown(parts)).toBe('3d 04h 12m')
  })

  it('shows seconds under one hour and never goes negative', () => {
    const parts = countdownParts(now - 5_000, now)
    expect(parts.totalMs).toBe(0)
    expect(formatCountdown(parts)).toBe('00h 00m 00s')
  })

  it('formats sub-hour countdowns with seconds', () => {
    const parts = countdownParts(now + (59 * 60 + 5) * 1000, now)
    expect(formatCountdown(parts)).toBe('00h 59m 05s')
  })

  it('minutesUntil rounds to the nearest minute', () => {
    expect(minutesUntil(now + 89_000, now)).toBe(1)
    expect(minutesUntil(now + 30_000, now)).toBe(1)
    expect(minutesUntil(now - 30_000, now)).toBe(-1)
  })
})
