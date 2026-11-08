import type { RaceWeekend } from '../../domain/types'
import { rawRaceToWeekend } from '../../domain/sessionWindows'
import { JsonCache, isFresh } from '../cache'
import type { JolpicaRace, JolpicaSeasonResponse, ScheduleSnapshot } from './types'
import snapshot2026 from './snapshot-2026.json'

/**
 * Schedule data source. Jolpica is CC BY-NC-SA (non-commercial) — this module
 * is the single seam to swap if a licensed source is ever needed.
 *
 * Flow: fresh cache → network → stale cache → committed snapshot.
 */
export const SCHEDULE_TTL_MS = 24 * 60 * 60 * 1000
const API_BASE = 'https://api.jolpi.ca/ergast/f1'

const snapshots = new Map<number, ScheduleSnapshot>([
  [2026, snapshot2026 as unknown as ScheduleSnapshot],
])

export interface LoadScheduleOptions {
  fetchFn?: typeof fetch
  cache?: JsonCache
  nowMs?: number
}

export async function loadSeason(
  year: number,
  opts: LoadScheduleOptions = {},
): Promise<RaceWeekend[]> {
  const fetchFn = opts.fetchFn ?? fetch
  const cache = opts.cache ?? new JsonCache()
  const nowMs = opts.nowMs ?? Date.now()
  const key = `rrf1:schedule:${year}`

  const cached = cache.get<JolpicaRace[]>(key)
  if (cached && isFresh(cached, SCHEDULE_TTL_MS, nowMs)) {
    return cached.value.map(rawRaceToWeekend)
  }

  try {
    const races = await fetchSeasonRaces(year, fetchFn)
    cache.set(key, races)
    return races.map(rawRaceToWeekend)
  } catch (err) {
    // Offline / rate-limited: stale cache beats the snapshot, snapshot beats nothing.
    if (cached) return cached.value.map(rawRaceToWeekend)
    const snapshot = snapshots.get(year)
    if (snapshot && snapshot.races.length > 0) {
      return snapshot.races.map(rawRaceToWeekend)
    }
    throw err
  }
}

/**
 * Load the seasons relevant to "now": the current year, and — once the
 * current season is over — next year's calendar if Jolpica has published it.
 * Season rollover needs no code change.
 */
export async function loadRelevantSeasons(
  nowMs: number = Date.now(),
  opts: LoadScheduleOptions = {},
): Promise<RaceWeekend[]> {
  const year = new Date(nowMs).getUTCFullYear()
  const current = await loadSeason(year, opts)

  const lastRace = Math.max(...current.map((w) => w.raceStartUtc))
  if (nowMs <= lastRace + 30 * 86_400_000) return current

  try {
    const next = await loadSeason(year + 1, opts)
    return [...current, ...next]
  } catch {
    // Next season's calendar not published yet — that's normal.
    return current
  }
}

async function fetchSeasonRaces(year: number, fetchFn: typeof fetch): Promise<JolpicaRace[]> {
  const res = await fetchFn(`${API_BASE}/${year}.json?limit=100`)
  if (!res.ok) throw new Error(`Jolpica responded ${res.status} for ${year}`)
  const json = (await res.json()) as JolpicaSeasonResponse
  const races = json.MRData?.RaceTable?.Races
  if (!Array.isArray(races) || races.length === 0) {
    throw new Error(`Jolpica returned an empty calendar for ${year}`)
  }
  return races
}
