import { describe, expect, it } from 'vitest'
import {
  fromRadarProtocolUrl,
  radarTileTemplate,
  radarTileUrl,
  toRadarProtocolUrl,
  type RadarFrames,
} from '../rainviewer/client'

const frames: RadarFrames = {
  host: 'https://tilecache.rainviewer.com',
  past: [{ timeUtc: 0, path: '/v2/radar/abc123' }],
  fetchedAt: 0,
}
const frame = frames.past[0]!

describe('radar tile URLs', () => {
  it('round-trips between https and the budgeted protocol', () => {
    const https = 'https://tilecache.rainviewer.com/v2/radar/abc/512/3/2/1/2/1_1.png'
    expect(toRadarProtocolUrl(https)).toBe(
      'rvtile://tilecache.rainviewer.com/v2/radar/abc/512/3/2/1/2/1_1.png',
    )
    expect(fromRadarProtocolUrl(toRadarProtocolUrl(https))).toBe(https)
  })

  it('builds the MapLibre template in the protocol scheme, keeping the placeholders', () => {
    expect(radarTileTemplate(frames, frame)).toBe(
      'rvtile://tilecache.rainviewer.com/v2/radar/abc123/512/{z}/{x}/{y}/2/1_1.png',
    )
  })

  it('keeps concrete probe URLs on https', () => {
    expect(radarTileUrl(frames, frame, 3, 2, 1)).toBe(
      'https://tilecache.rainviewer.com/v2/radar/abc123/512/3/2/1/2/1_1.png',
    )
  })
})
