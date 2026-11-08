import tzLookup from '@photostructure/tz-lookup'

/**
 * IANA timezone for a coordinate (DST-correct, resolved via the bundled
 * tz-lookup database). Falls back to UTC for unknown coordinates.
 */
export function tzAt(lat: number, lon: number): string {
  try {
    return tzLookup(lat, lon) ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

export interface ZonedTime {
  /** e.g. "15:00" */
  time: string
  /** e.g. "Sun 6 Dec" */
  dateLabel: string
  /** full IANA zone used */
  tz: string
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>()
const dateFormatters = new Map<string, Intl.DateTimeFormat>()

function timeFormatter(tz: string): Intl.DateTimeFormat {
  let f = timeFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    timeFormatters.set(tz, f)
  }
  return f
}

function dateFormatter(tz: string): Intl.DateTimeFormat {
  let f = dateFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    dateFormatters.set(tz, f)
  }
  return f
}

/** Format an instant in a given IANA timezone. */
export function formatInTz(ms: number, tz: string): ZonedTime {
  return {
    time: timeFormatter(tz).format(ms),
    dateLabel: dateFormatter(tz).format(ms),
    tz,
  }
}

/** The browser's own IANA timezone. */
export function userTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export interface CountdownParts {
  days: number
  hours: number
  minutes: number
  seconds: number
  totalMs: number
}

export function countdownParts(targetMs: number, nowMs: number): CountdownParts {
  const totalMs = Math.max(0, targetMs - nowMs)
  const totalSeconds = Math.floor(totalMs / 1000)
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalMs,
  }
}

/** e.g. "3d 04h 12m" / "04h 12m 09s" (seconds shown under one hour). */
export function formatCountdown(parts: CountdownParts): string {
  if (parts.days > 0) {
    return `${parts.days}d ${pad(parts.hours)}h ${pad(parts.minutes)}m`
  }
  return `${pad(parts.hours)}h ${pad(parts.minutes)}m ${pad(parts.seconds)}s`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Minutes until a timestamp (can be negative); rounds away from zero. */
export function minutesUntil(targetMs: number, nowMs: number): number {
  const minutes = (targetMs - nowMs) / 60_000
  return minutes >= 0 ? Math.round(minutes) : -Math.round(-minutes)
}
