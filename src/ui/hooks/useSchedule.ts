import { useCallback, useEffect, useState } from 'react'
import type { RaceWeekend } from '../../domain/types'
import { loadRelevantSeasons } from '../../data/jolpica/client'

/** Module-level in-flight cache: several pages need the same schedule. */
let inflight: Promise<RaceWeekend[]> | null = null

function loadAll(): Promise<RaceWeekend[]> {
  if (inflight === null) {
    inflight = loadRelevantSeasons()
      .then((weekends) => [...weekends].sort((a, b) => a.raceStartUtc - b.raceStartUtc))
      .catch((err: unknown) => {
        inflight = null
        throw err
      })
  }
  return inflight
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
    loadAll()
      .then((w) => {
        if (!alive) return
        setWeekends(w)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      alive = false
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
