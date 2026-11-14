/** Failed-frame retry backoff: base delay and cap. */
export const BACKOFF_BASE_MS = 15_000
export const BACKOFF_MAX_MS = 600_000

export interface FrameBackoff {
  fails: number
  retryAt: number
}

/**
 * Backoff state after one more failed probe of a frame. Never permanent:
 * a frame is skipped while backed off but always comes back within the cap
 * — and a recovered neighbour brings it back right away (see RadarMap).
 */
export function nextBackoff(prev: FrameBackoff | undefined, nowMs: number): FrameBackoff {
  const fails = (prev?.fails ?? 0) + 1
  return {
    fails,
    retryAt: nowMs + Math.min(BACKOFF_BASE_MS * 2 ** (fails - 1), BACKOFF_MAX_MS),
  }
}

/** True while a frame should be skipped entirely (no probe, no tile burst). */
export function isBackedOff(backoff: FrameBackoff | undefined, nowMs: number): boolean {
  return backoff !== undefined && nowMs < backoff.retryAt
}
