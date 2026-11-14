import { memoryStore, type KeyValueStore } from '../cache'

/**
 * Client-side request governor for RainViewer tiles.
 *
 * RainViewer rate-limits to 100 requests/IP/minute. Over the limit it answers
 * 429 WITHOUT CORS headers, which browsers surface as an opaque
 * `net::ERR_FAILED` / CORS error — one per tile, flooding the console and
 * blanking the radar. Every tile therefore goes through here:
 *
 *  - a sliding-window budget (persisted, so reloads and other tabs count too)
 *  - bounded concurrency
 *  - de-duplication of identical in-flight requests plus a small memory cache
 *  - a cool-down after consecutive failures (a throttled or offline network
 *    must not be hammered)
 */
export interface TileSchedulerOptions {
  /** Max network requests per window. Stay well under RainViewer's 100/min. */
  maxPerWindow?: number
  windowMs?: number
  maxConcurrent?: number
  /** Time limit for the network part of one request (queue time excluded). */
  requestTimeoutMs?: number
  /** Memory cache size, in tiles. */
  cacheEntries?: number
  /** Consecutive failures before the cool-down starts. */
  failuresBeforePause?: number
  pauseBaseMs?: number
  pauseMaxMs?: number
  fetchFn?: typeof fetch
  /** Where the sliding window lives (shared across tabs when localStorage). */
  store?: KeyValueStore
  storeKey?: string
  /** Persistent tile cache; hits skip the budget and the network. */
  blobCache?: TileBlobCache | null
}

export interface TileFetchOptions {
  signal?: AbortSignal
  /** Jump the queue (e.g. the rain-alert probe). */
  priority?: boolean
}

/**
 * Persistent tile cache (CacheStorage). Hits bypass the request budget
 * entirely: only real network requests count against RainViewer's rate limit,
 * so repeat loops and revisited zoom levels cost nothing.
 */
export interface TileBlobCache {
  match(url: string): Promise<ArrayBuffer | undefined>
  put(url: string, data: ArrayBuffer): Promise<void>
}

/**
 * CacheStorage-backed tile cache. Only clean 200s ever reach `put`, so a
 * throttled RainViewer's opaque failures can't poison it (one poisoned entry
 * keeps failing the WebGL CORS check for hours). Best-effort throughout.
 */
export function cacheStorageTileCache(cacheName: string, maxEntries = 1_200): TileBlobCache | null {
  if (typeof caches === 'undefined') return null
  let puts = 0
  const open = () => caches.open(cacheName)
  return {
    async match(url) {
      try {
        const res = await (await open()).match(url)
        return res === undefined ? undefined : await res.arrayBuffer()
      } catch {
        return undefined
      }
    },
    async put(url, data) {
      try {
        const cache = await open()
        await cache.put(url, new Response(data, { headers: { 'Content-Type': 'image/png' } }))
        // Entries are ephemeral (radar frame paths die within hours); trim the
        // oldest occasionally so long-lived installs don't grow unbounded.
        if (++puts % 128 === 0) {
          const keys = await cache.keys()
          for (const key of keys.slice(0, Math.max(0, keys.length - maxEntries))) {
            await cache.delete(key)
          }
        }
      } catch {
        // caching is best-effort
      }
    },
  }
}

interface Job {
  url: string
  waiters: number
  started: boolean
  promise: Promise<ArrayBuffer>
  resolve: (data: ArrayBuffer) => void
  reject: (err: unknown) => void
}

class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('RainViewer rate limit reached (429)')
  }
}

function abortError(): Error {
  return new DOMException('Tile request aborted', 'AbortError')
}

/**
 * How often the shared sliding window is persisted at most. Sharing with
 * other tabs and future reloads is a courtesy — approximate is fine — while
 * synchronous localStorage writes on every request are not: a write that
 * throws mid-scheduling dequeues jobs that then never run.
 */
const PERSIST_INTERVAL_MS = 1_000

/** Retry-After header in ms, when the (CORS-exposed) response carries one. */
function retryAfterMs(res: Response, fallbackMs: number): number {
  const seconds = Number(res.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs
}

export class TileScheduler {
  private readonly maxPerWindow: number
  private readonly windowMs: number
  private readonly maxConcurrent: number
  private readonly requestTimeoutMs: number
  private readonly cacheEntries: number
  private readonly failuresBeforePause: number
  private readonly pauseBaseMs: number
  private readonly pauseMaxMs: number
  private readonly fetchFn: typeof fetch
  private readonly store: KeyValueStore
  private readonly storeKey: string
  private readonly blobCache: TileBlobCache | null

  private readonly queue: Job[] = []
  private readonly jobs = new Map<string, Job>()
  private readonly cache = new Map<string, ArrayBuffer>()
  private active = 0
  private pausedUntil = 0
  private consecutiveFailures = 0
  private pumpTimer: ReturnType<typeof setTimeout> | null = null
  /** Own starts not yet persisted (persistence is throttled and best-effort). */
  private unpersisted: number[] = []
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: TileSchedulerOptions = {}) {
    this.maxPerWindow = opts.maxPerWindow ?? 80
    this.windowMs = opts.windowMs ?? 60_000
    this.maxConcurrent = opts.maxConcurrent ?? 4
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 8_000
    this.cacheEntries = opts.cacheEntries ?? 400
    this.failuresBeforePause = opts.failuresBeforePause ?? 3
    this.pauseBaseMs = opts.pauseBaseMs ?? 15_000
    this.pauseMaxMs = opts.pauseMaxMs ?? 60_000
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init))
    this.store = opts.store ?? memoryStore()
    this.storeKey = opts.storeKey ?? 'rrf1:tile-budget'
    this.blobCache = opts.blobCache ?? null
  }

  /**
   * Fetch one tile through the budget. Rejects with an AbortError when
   * `signal` fires. Persistent-cache hits skip the budget and the network.
   */
  async fetch(url: string, opts: TileFetchOptions = {}): Promise<ArrayBuffer> {
    const { signal, priority = false } = opts
    if (signal?.aborted) throw abortError()

    const hit = this.cache.get(url)
    if (hit) {
      this.cache.delete(url) // refresh LRU position
      this.cache.set(url, hit)
      return hit.slice(0)
    }

    if (this.blobCache !== null) {
      const blob = await this.blobCache.match(url)
      if (signal?.aborted) throw abortError()
      if (blob !== undefined) {
        this.remember(url, blob)
        return blob.slice(0)
      }
    }

    let job = this.jobs.get(url)
    if (!job) {
      job = this.enqueue(url, priority)
    } else if (priority && !job.started) {
      const at = this.queue.indexOf(job)
      if (at > 0) {
        this.queue.splice(at, 1)
        this.queue.unshift(job)
      }
    }
    job.waiters++
    const shared = job

    return new Promise<ArrayBuffer>((resolve, reject) => {
      let settled = false
      const onAbort = () => {
        if (settled) return
        settled = true
        this.release(shared)
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      shared.promise.then(
        (data) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          resolve(data.slice(0))
        },
        (err: unknown) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          reject(err)
        },
      )
    })
  }

  private enqueue(url: string, priority: boolean): Job {
    let resolve!: (data: ArrayBuffer) => void
    let reject!: (err: unknown) => void
    const promise = new Promise<ArrayBuffer>((res, rej) => {
      resolve = res
      reject = rej
    })
    const job: Job = { url, waiters: 0, started: false, promise, resolve, reject }
    this.jobs.set(url, job)
    if (priority) this.queue.unshift(job)
    else this.queue.push(job)
    this.pump()
    return job
  }

  /** A waiter gave up: drop the job when nobody wants it and it hasn't started. */
  private release(job: Job): void {
    job.waiters--
    if (job.waiters > 0 || job.started) return
    const at = this.queue.indexOf(job)
    if (at >= 0) this.queue.splice(at, 1)
    this.jobs.delete(job.url)
  }

  private pump(): void {
    if (this.pumpTimer !== null) {
      clearTimeout(this.pumpTimer)
      this.pumpTimer = null
    }
    while (this.active < this.maxConcurrent) {
      const next = this.queue[0]
      if (next === undefined) return

      const now = Date.now()
      if (now < this.pausedUntil) return this.pumpAgainIn(this.pausedUntil - now)

      const starts = this.recentStarts(now)
      const oldest = starts[0]
      if (starts.length >= this.maxPerWindow && oldest !== undefined) {
        return this.pumpAgainIn(oldest + this.windowMs - now + 1)
      }

      this.queue.shift()
      this.recordStart(now)
      void this.run(next)
    }
  }

  /** Note a started request: in memory immediately, persisted at most ~1×/s. */
  private recordStart(now: number): void {
    this.unpersisted = this.unpersisted.filter((t) => t > now - this.windowMs)
    this.unpersisted.push(now)
    if (this.persistTimer === null) this.schedulePersist()
  }

  private schedulePersist(): void {
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistWindow()
    }, PERSIST_INTERVAL_MS)
  }

  /**
   * Merge the unpersisted starts into the shared window. Best-effort: a throw
   * here (quota, storage unavailable) must never break scheduling — that wedge
   * dequeued jobs that then never ran, hanging every tile request behind them.
   */
  private persistWindow(): void {
    if (this.unpersisted.length === 0) return
    try {
      const now = Date.now()
      const merged = [...this.recentFromStore(now), ...this.unpersisted].sort((a, b) => a - b)
      this.store.setItem(this.storeKey, JSON.stringify(merged))
      this.unpersisted = []
    } catch {
      // keep the starts in memory; they still count and are retried later
    }
    if (this.unpersisted.length > 0 && this.persistTimer === null) this.schedulePersist()
  }

  /** The persisted part of the window: other tabs and earlier page loads. */
  private recentFromStore(now: number): number[] {
    try {
      const raw = this.store.getItem(this.storeKey)
      const parsed: unknown = raw === null ? [] : JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((t): t is number => typeof t === 'number' && t > now - this.windowMs && t <= now)
    } catch {
      return []
    }
  }

  private pumpAgainIn(ms: number): void {
    this.pumpTimer = setTimeout(() => this.pump(), Math.max(1, ms))
  }

  /** Starts inside the window: our own (in memory) plus the persisted ones (other tabs, reloads). */
  private recentStarts(now: number): number[] {
    return [
      ...this.recentFromStore(now),
      ...this.unpersisted.filter((t) => t > now - this.windowMs && t <= now),
    ].sort((a, b) => a - b)
  }

  private async run(job: Job): Promise<void> {
    job.started = true
    this.active++
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    try {
      const res = await this.fetchFn(job.url, { signal: controller.signal })
      if (res.status === 429) throw new RateLimitedError(retryAfterMs(res, this.pauseMaxMs))
      if (!res.ok) throw new Error(`RainViewer tile responded ${res.status}`)
      const data = await res.arrayBuffer()
      this.consecutiveFailures = 0
      this.remember(job.url, data)
      // Only clean responses reach this point, so only clean ones are cached.
      if (this.blobCache !== null) void this.blobCache.put(job.url, data)
      job.resolve(data)
    } catch (err) {
      if (err instanceof RateLimitedError) {
        this.pausedUntil = Date.now() + err.retryAfterMs
      } else {
        this.noteFailure()
      }
      job.reject(err)
    } finally {
      clearTimeout(timer)
      this.active--
      this.jobs.delete(job.url)
      this.pump()
    }
  }

  /**
   * Throttled responses arrive as opaque network errors (no CORS headers), so
   * a streak of failures is treated as "back off", whatever the real cause.
   */
  private noteFailure(): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures < this.failuresBeforePause) return
    const step = this.consecutiveFailures - this.failuresBeforePause
    this.pausedUntil = Date.now() + Math.min(this.pauseBaseMs * 2 ** step, this.pauseMaxMs)
  }

  private remember(url: string, data: ArrayBuffer): void {
    this.cache.set(url, data)
    while (this.cache.size > this.cacheEntries) {
      const oldest = this.cache.keys().next()
      if (oldest.done) break
      this.cache.delete(oldest.value)
    }
  }
}
