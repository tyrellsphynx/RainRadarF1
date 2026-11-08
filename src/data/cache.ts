export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface CacheEntry<T> {
  value: T
  storedAt: number
}

/** In-memory store used in tests and when localStorage is unavailable. */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

function defaultStore(): KeyValueStore {
  try {
    const store = window.localStorage
    const probe = '__rrf1_probe__'
    store.setItem(probe, '1')
    store.removeItem(probe)
    return store
  } catch {
    return memoryStore()
  }
}

/**
 * Tiny JSON cache with explicit freshness checks at the call site
 * (so stale values remain readable as an offline fallback).
 */
export class JsonCache {
  constructor(
    private readonly store: KeyValueStore = defaultStore(),
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string): CacheEntry<T> | null {
    try {
      const raw = this.store.getItem(key)
      if (raw === null) return null
      const parsed = JSON.parse(raw) as CacheEntry<T>
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.storedAt !== 'number') {
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  set<T>(key: string, value: T): void {
    try {
      this.store.setItem(key, JSON.stringify({ value, storedAt: this.now() }))
    } catch {
      // Quota exceeded / storage unavailable — caching is best-effort.
    }
  }

  delete(key: string): void {
    try {
      this.store.removeItem(key)
    } catch {
      // ignore
    }
  }
}

export function isFresh(
  entry: CacheEntry<unknown> | null,
  ttlMs: number,
  nowMs: number = Date.now(),
): boolean {
  return entry !== null && nowMs - entry.storedAt < ttlMs
}
