/** Failed-frame retry backoff: base delay and cap. */
export const BACKOFF_BASE_MS = 15_000
export const BACKOFF_MAX_MS = 600_000
/** After this many failed probes a frame is done for the session. */
export const MAX_FRAME_FAILURES = 5

export interface FrameBackoff {
  fails: number
  retryAt: number
}

/** Backoff state after one more failed probe of a frame. */
export function nextBackoff(prev: FrameBackoff | undefined, nowMs: number): FrameBackoff {
  const fails = (prev?.fails ?? 0) + 1
  return {
    fails,
    retryAt:
      fails >= MAX_FRAME_FAILURES
        ? Number.POSITIVE_INFINITY
        : nowMs + Math.min(BACKOFF_BASE_MS * 2 ** (fails - 1), BACKOFF_MAX_MS),
  }
}

/** True while a frame should be skipped entirely (no probe, no tile burst). */
export function isBackedOff(backoff: FrameBackoff | undefined, nowMs: number): boolean {
  return backoff !== undefined && nowMs < backoff.retryAt
}
