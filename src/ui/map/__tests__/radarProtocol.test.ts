import { afterEach, describe, expect, it, vi } from 'vitest'

const addProtocol = vi.hoisted(() => vi.fn())
vi.mock('maplibre-gl', () => ({ addProtocol }))

import { radarTiles } from '../../../data/rainviewer/tiles'
import { ensureRadarProtocol, setFrontRadarLayer } from '../radarProtocol'

type Handler = (params: { url: string }, ac: AbortController) => Promise<unknown>

// Registration is one-shot; capture the handlers once for all tests below.
ensureRadarProtocol()
const handlers = new Map(addProtocol.mock.calls as Array<[string, Handler]>)

describe('radar protocol', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setFrontRadarLayer(null)
  })

  it('decodes the per-layer schemes to one shared https URL', async () => {
    const fetchSpy = vi.spyOn(radarTiles, 'fetch').mockResolvedValue(new ArrayBuffer(1))

    const ac = new AbortController()
    await handlers.get('rvtile-a')!({ url: 'rvtile-a://host/t/512/1/2/3/2/1_1.png' }, ac)
    await handlers.get('rvtile-b')!({ url: 'rvtile-b://host/t/512/1/2/3/2/1_1.png' }, ac)

    // Same cache key for both layers, so the tile cache is shared across the swap.
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://host/t/512/1/2/3/2/1_1.png')
    expect(fetchSpy.mock.calls[1]![0]).toBe('https://host/t/512/1/2/3/2/1_1.png')
  })

  it('gives the visible layer priority over the animation preload, and flips on swap', async () => {
    const fetchSpy = vi.spyOn(radarTiles, 'fetch').mockResolvedValue(new ArrayBuffer(1))
    const call = (scheme: string) =>
      handlers.get(scheme)!({ url: `${scheme}://host/t/512/1/2/3/2/1_1.png` }, new AbortController())

    setFrontRadarLayer('radar-a')
    await call('rvtile-a')
    await call('rvtile-b')
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ priority: true })
    expect(fetchSpy.mock.calls[1]![1]).toMatchObject({ priority: false })

    // After the crossfade the other layer becomes visible: its tiles win now.
    setFrontRadarLayer('radar-b')
    await call('rvtile-a')
    await call('rvtile-b')
    expect(fetchSpy.mock.calls[2]![1]).toMatchObject({ priority: false })
    expect(fetchSpy.mock.calls[3]![1]).toMatchObject({ priority: true })
  })
})
