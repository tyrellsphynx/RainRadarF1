import { useCallback, useEffect, useState } from 'react'
import type { RaceWeekend } from '../../domain/types'
import { loadRelevantSeasons, SCHEDULE_TTL_MS } from '../../data/jolpica/client'

/** Module-level in-flight cache: several pages need the same schedule. */
let inflight: Promise<RaceWeekend[]> | null = null
/** When the schedule last loaded successfully (0 = never). */
let loadedAt = 0
/** A request is running; nobody else should start another. */
let pending = false

/** How often a mounted page checks whether the schedule has gone stale. */
const STALE_CHECK_MS = 10 * 60_000

function loadAll(): Promise<RaceWeekend[]> {
  if (inflight === null) {
    pending = true
    inflight = loadRelevantSeasons()
      .then((weekends) => {
        loadedAt = Date.now()
        return [...weekends].sort((a, b) => a.raceStartUtc - b.raceStartUtc)
      })
      .catch((err: unknown) => {
        inflight = null
        throw err
      })
      .finally(() => {
        pending = false
      })
  }
  return inflight
}

function isStale(): boolean {
  return !pending && loadedAt > 0 && Date.now() - loadedAt >= SCHEDULE_TTL_MS
}

/** Start a refresh (shared by all hook instances: the first caller wins). */
function refresh(): Promise<RaceWeekend[]> {
  inflight = null
  return loadAll()
}

export interface ScheduleState {
  weekends: RaceWeekend[]
  loading: boolean
  error: string | null
  reload: () => void
}

export function useSchedule(): ScheduleState {
  const [weekends, setWeekends] = useState<RaceWeekend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true

    // Stale-while-revalidate: render what we have, refresh behind the scenes
    // so long-lived sessions pick up calendar changes. Failures keep the old data.
    const revalidate = () => {
      refresh()
        .then((fresh) => {
          if (alive) setWeekends(fresh)
        })
        .catch(() => {})
    }

    loadAll()
      .then((w) => {
        if (!alive) return
        setWeekends(w)
        setError(null)
        setLoading(false)
        if (isStale()) revalidate()
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    const timer = window.setInterval(() => {
      if (isStale()) revalidate()
    }, STALE_CHECK_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [attempt])

  const reload = useCallback(() => {
    inflight = null
    setLoading(true)
    setError(null)
    setAttempt((a) => a + 1)
  }, [])

  return { weekends, loading, error, reload }
}
