import { useEffect, useState } from 'react'

export interface Route {
  name: 'home' | 'map' | 'track'
  season?: number
  round?: number
}

/** Hash routes work from any host path (GitHub Pages) with no server config. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'map') return { name: 'map' }
  if (parts[0] === 'track' && parts[1]) {
    const [season, round] = parts[1].split('-').map(Number)
    if (Number.isFinite(season) && Number.isFinite(round)) {
      return { name: 'track', season, round }
    }
  }
  return { name: 'home' }
}

export function navigate(hash: string): void {
  if (window.location.hash === hash) return
  window.location.hash = hash
}

export function trackHash(season: number, round: number): string {
  return `#/track/${season}-${round}`
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}
