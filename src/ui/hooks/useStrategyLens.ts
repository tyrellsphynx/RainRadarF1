import { useCallback, useSyncExternalStore } from 'react'

/**
 * Global "strategy lens" preference (persisted, shared across pages).
 * Default off — the meteorological verdict stays the primary answer.
 */
const STORAGE_KEY = 'rrf1:strategy-lens'

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let lensOn = readStored()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function getSnapshot(): boolean {
  return lensOn
}

export function useStrategyLens(): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const toggle = useCallback(() => {
    lensOn = !lensOn
    try {
      window.localStorage.setItem(STORAGE_KEY, lensOn ? '1' : '0')
    } catch {
      // storage unavailable — the toggle still works for this session
    }
    for (const listener of listeners) listener()
  }, [])

  return [on, toggle]
}
