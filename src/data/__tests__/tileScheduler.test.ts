import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStore } from '../cache'
import { TileScheduler } from '../rainviewer/tileScheduler'

const bytes = (n: number) => new Uint8Array([n]).buffer

function okFetch() {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(bytes(1)))
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TileScheduler', () => {
  it('serves repeat requests from memory without touching the network', async () => {
    const fetchFn = okFetch()
    const s = new TileScheduler({ fetchFn })
    const first = s.fetch('a')
    await flush()
    await first
    await s.fetch('a')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('hands out copies, so callers cannot corrupt the cache', async () => {
    const s = new TileScheduler({ fetchFn: okFetch() })
    const p = s.fetch('a')
    await flush()
    const first = new Uint8Array(await p)
    first[0] = 99
    expect(new Uint8Array(await s.fetch('a'))[0]).toBe(1)
  })

  it('shares one request between concurrent callers of the same URL', async () => {
    const fetchFn = okFetch()
    const s = new TileScheduler({ fetchFn })
    const both = Promise.all([s.fetch('a'), s.fetch('a')])
    await flush()
    await both
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('never starts more than maxPerWindow requests per window', async () => {
    const fetchFn = okFetch()
    const s = new TileScheduler({ fetchFn, maxPerWindow: 3, windowMs: 1000, maxConcurrent: 10 })
    for (let i = 0; i < 7; i++) void s.fetch(`t${i}`)
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(2)
    expect(fetchFn).toHaveBeenCalledTimes(6)
    await vi.advanceTimersByTimeAsync(1100)
    expect(fetchFn).toHaveBeenCalledTimes(7)
  })

  it('shares the window across instances using the same store (reloads, other tabs)', async () => {
    const store = memoryStore()
    const a = okFetch()
    const b = okFetch()
    const one = new TileScheduler({ fetchFn: a, store, maxPerWindow: 2, windowMs: 60_000 })
    const two = new TileScheduler({ fetchFn: b, store, maxPerWindow: 2, windowMs: 60_000 })
    void one.fetch('x1')
    void one.fetch('x2')
    await flush()
    await vi.advanceTimersByTimeAsync(1_100) // persistence is throttled to ~1×/s
    void two.fetch('y1')
    await flush()
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('persists the window at most about once a second instead of per request', async () => {
    const store = memoryStore()
    const setItem = store.setItem.bind(store)
    let writes = 0
    store.setItem = (key, value) => {
      writes++
      setItem(key, value)
    }
    const s = new TileScheduler({ fetchFn: okFetch(), store, maxPerWindow: 100, maxConcurrent: 1 })
    for (let i = 0; i < 5; i++) {
      void s.fetch(`t${i}`)
      await flush()
    }
    expect(writes).toBe(0) // a burst does not hit the store synchronously
    await vi.advanceTimersByTimeAsync(1_100)
    expect(writes).toBe(1) // one merged write for the burst
  })

  it('keeps scheduling when persistence throws (the localStorage wedge)', async () => {
    const store = memoryStore()
    store.setItem = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    }
    const fetchFn = okFetch()
    const s = new TileScheduler({ fetchFn, store, maxPerWindow: 2, windowMs: 1000, maxConcurrent: 1 })
    void s.fetch('a')
    void s.fetch('b')
    void s.fetch('c')
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1_100) // persist attempt (throws) + window slide
    // c must still run: a throwing store write may never strand a dequeued job.
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('limits concurrency', async () => {
    const releases: Array<() => void> = []
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(new Response(bytes(1))))
        }),
    )
    const s = new TileScheduler({ fetchFn, maxConcurrent: 2 })
    for (let i = 0; i < 5; i++) void s.fetch(`t${i}`)
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    releases[0]?.()
    await flush()
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('drops queued requests whose callers all aborted', async () => {
    const fetchFn = okFetch()
    const s = new TileScheduler({ fetchFn, maxPerWindow: 1, windowMs: 1000 })
    void s.fetch('first')
    const controller = new AbortController()
    const queued = s.fetch('second', { signal: controller.signal })
    const caught = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await flush()
    controller.abort()
    await caught
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('rejects immediately for an already-aborted signal', async () => {
    const s = new TileScheduler({ fetchFn: okFetch() })
    const controller = new AbortController()
    controller.abort()
    await expect(s.fetch('a', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('lets priority requests jump the queue', async () => {
    const fetchFn = okFetch()
    const s = new TileScheduler({ fetchFn, maxConcurrent: 1, maxPerWindow: 100 })
    void s.fetch('a')
    void s.fetch('b')
    void s.fetch('urgent', { priority: true })
    await vi.advanceTimersByTimeAsync(10)
    const order = fetchFn.mock.calls.map((c) => String(c[0]))
    expect(order).toEqual(['a', 'urgent', 'b'])
  })

  it('cools down after a streak of failures, then resumes', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL) => {
      throw new TypeError('Failed to fetch')
    })
    const s = new TileScheduler({
      fetchFn,
      maxConcurrent: 1,
      failuresBeforePause: 3,
      pauseBaseMs: 10_000,
    })
    const results = Array.from({ length: 6 }, (_, i) => s.fetch(`t${i}`).catch((e: unknown) => e))
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchFn).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(9_000)
    expect(fetchFn).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(fetchFn).toHaveBeenCalledTimes(4)
    void results
  })

  it('does not cool down for isolated failures', async () => {
    let n = 0
    const fetchFn = vi.fn(async (_url: RequestInfo | URL) => {
      n++
      if (n % 2 === 1) throw new TypeError('Failed to fetch')
      return new Response(bytes(1))
    })
    const s = new TileScheduler({ fetchFn, maxConcurrent: 1, failuresBeforePause: 3 })
    for (let i = 0; i < 6; i++) void s.fetch(`t${i}`).catch(() => {})
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchFn).toHaveBeenCalledTimes(6)
  })

  it('honours a visible 429 with Retry-After', async () => {
    const fetchFn = vi
      .fn<(url: RequestInfo | URL) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '30' } }))
      .mockResolvedValue(new Response(bytes(1)))
    const s = new TileScheduler({ fetchFn, maxConcurrent: 1 })
    const first = s.fetch('a').catch((e: unknown) => e)
    void s.fetch('b')
    await vi.advanceTimersByTimeAsync(100)
    expect(await first).toBeInstanceOf(Error)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('times out a hanging request without blocking the queue forever', async () => {
    const fetchFn = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
        }),
    )
    const s = new TileScheduler({ fetchFn, requestTimeoutMs: 1000 })
    const p = s.fetch('a').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1100)
    expect(await p).toBeInstanceOf(DOMException)
  })
})
