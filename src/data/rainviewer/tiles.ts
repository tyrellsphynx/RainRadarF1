import { defaultStore } from '../cache'
import { cacheStorageTileCache, TileScheduler } from './tileScheduler'

/**
 * The one budget for all RainViewer tile traffic (map layers, frame probes,
 * the rain-alert radar probe). The window is persisted in localStorage so a
 * reload or a second tab can't double the request rate, and the persistent
 * tile cache lets repeat loops and revisited zoom levels skip the budget
 * entirely.
 */
export const radarTiles = new TileScheduler({
  store: defaultStore(),
  blobCache: cacheStorageTileCache('radar-tiles-v1'),
})
