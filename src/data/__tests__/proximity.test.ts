import { describe, expect, it } from 'vitest'
import { RADAR_TILE_SIZE } from '../rainviewer/client'
import { kmPerPx, tileAt } from '../rainviewer/proximity'

describe('tileAt', () => {
  it('puts the origin of the world in tile 0/0 at zoom 0', () => {
    const t = tileAt(0, 0, 0)
    expect(t).toMatchObject({ z: 0, x: 0, y: 0 })
  })

  it('maps Greenwich/equator to the centre of the 4-tile grid at zoom 1', () => {
    const t = tileAt(0, 0, 1)
    expect(t.x).toBe(1)
    expect(t.y).toBe(1)
    expect(t.px).toBe(0)
    expect(t.py).toBe(0)
  })

  it('finds the known slippy tile for Spa-Francorchamps at z7', () => {
    // x = floor((5.9714+180)/360*128) = 66; y = floor((1 - asinh(tan(50.4372°))/π)/2*128) = 43
    const t = tileAt(50.4372, 5.9714, 7)
    expect(t.x).toBe(66)
    expect(t.y).toBe(43)
    expect(t.px).toBeGreaterThanOrEqual(0)
    expect(t.px).toBeLessThan(RADAR_TILE_SIZE)
    expect(t.py).toBeGreaterThanOrEqual(0)
    expect(t.py).toBeLessThan(RADAR_TILE_SIZE)
  })

  it('clamps coordinates at the antimeridian into the grid', () => {
    expect(tileAt(0, 180, 3).x).toBe(7)
  })
})

describe('kmPerPx', () => {
  it('is about 1 km/px near the equator at z7', () => {
    expect(kmPerPx(0, 7)).toBeCloseTo(111.32 / ((128 * RADAR_TILE_SIZE) / 360), 5)
  })

  it('shrinks with latitude and zoom', () => {
    expect(kmPerPx(60, 7)).toBeLessThan(kmPerPx(0, 7))
    expect(kmPerPx(0, 8)).toBeCloseTo(kmPerPx(0, 7) / 2, 5)
  })
})
