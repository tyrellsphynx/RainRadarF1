import { describe, expect, it } from 'vitest'
import { classify, ISOLATED_PROB_PCT, RAIN_MM, SHOWERS_MM } from '../verdict'
import type { WindowStats } from '../types'

const stats = (mm: number, probPct: number | null, hasData = true): WindowStats => ({
  hasData,
  mm,
  probPct,
})

describe('classify', () => {
  it('is unknown without data', () => {
    expect(classify(stats(0, null, false))).toBe('unknown')
  })

  it('classifies sustained rain at and above the rain threshold', () => {
    expect(classify(stats(RAIN_MM - 0.01, 100))).toBe('showers')
    expect(classify(stats(RAIN_MM, 100))).toBe('rain')
    expect(classify(stats(12, 100))).toBe('rain')
  })

  it('classifies showers at and above the shower threshold', () => {
    expect(classify(stats(SHOWERS_MM - 0.01, 0))).toBe('dry')
    expect(classify(stats(SHOWERS_MM, 0))).toBe('showers')
    expect(classify(stats(1.2, 0))).toBe('showers')
  })

  it('flags isolated showers risk on probability alone', () => {
    expect(classify(stats(0.1, ISOLATED_PROB_PCT - 1))).toBe('dry')
    expect(classify(stats(0.1, ISOLATED_PROB_PCT))).toBe('isolated')
    expect(classify(stats(0, 80))).toBe('isolated')
  })

  it('treats a missing probability as no risk', () => {
    expect(classify(stats(0.1, null))).toBe('dry')
  })
})
