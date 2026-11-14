import { defaultStore } from '../cache'
import { TileScheduler } from './tileScheduler'

/**
 * The one budget for all RainViewer tile traffic (map layers, frame probes,
 * the rain-alert radar probe). The window is persisted in localStorage so a
 * reload or a second tab can't double the request rate.
 */
export const radarTiles = new TileScheduler({ store: defaultStore() })
