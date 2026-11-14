import { describe, expect, it } from 'vitest'
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  MAX_FRAME_FAILURES,
  isBackedOff,
  nextBackoff,
  type FrameBackoff,
} from '../frameBackoff'

describe('nextBackoff', () => {
  it('starts at the base delay and doubles per failure', () => {
    const first = nextBackoff(undefined, 1000)
    expect(first).toEqual({ fails: 1, retryAt: 1000 + BACKOFF_BASE_MS })
    const second = nextBackoff(first, 2000)
    expect(second).toEqual({ fails: 2, retryAt: 2000 + BACKOFF_BASE_MS * 2 })
  })

  it('never waits longer than the cap', () => {
    const prev: FrameBackoff = { fails: MAX_FRAME_FAILURES - 2, retryAt: 0 }
    const next = nextBackoff(prev, 0)
    expect(next.retryAt).toBeLessThanOrEqual(BACKOFF_MAX_MS)
  })

  it('gives up for good after the maximum number of failures', () => {
    const prev: FrameBackoff = { fails: MAX_FRAME_FAILURES - 1, retryAt: 0 }
    const next = nextBackoff(prev, 5000)
    expect(next.fails).toBe(MAX_FRAME_FAILURES)
    expect(next.retryAt).toBe(Number.POSITIVE_INFINITY)
    expect(isBackedOff(next, Number.MAX_SAFE_INTEGER)).toBe(true)
  })
})

describe('isBackedOff', () => {
  it('is false for frames that never failed', () => {
    expect(isBackedOff(undefined, 0)).toBe(false)
  })

  it('is true until the retry time, false from then on', () => {
    const b = { fails: 1, retryAt: 1000 }
    expect(isBackedOff(b, 999)).toBe(true)
    expect(isBackedOff(b, 1000)).toBe(false)
  })
})
