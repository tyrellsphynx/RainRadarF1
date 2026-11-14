import { describe, expect, it } from 'vitest'
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
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

  it('never waits longer than the cap, however often it failed', () => {
    let b: FrameBackoff | undefined
    for (let i = 0; i < 10; i++) b = nextBackoff(b, 0)
    expect(b?.retryAt).toBe(BACKOFF_MAX_MS)
  })

  it('always comes back eventually — a frame is never dead for good', () => {
    let b: FrameBackoff | undefined
    for (let i = 0; i < 25; i++) b = nextBackoff(b, 5_000)
    // The retry time is finite, so the frame is tried again one day.
    expect(Number.isFinite(b?.retryAt)).toBe(true)
    expect(isBackedOff(b, Number.MAX_SAFE_INTEGER)).toBe(false)
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
