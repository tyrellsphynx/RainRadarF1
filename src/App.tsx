import { Suspense, lazy } from 'react'
import { Attribution } from './ui/shell/Attribution'
import { RainAlertBanner } from './ui/alerts/RainAlertBanner'
import { navigate, useHashRoute } from './ui/shell/useHashRoute'

// maplibre-gl is heavy — both map-bearing pages are lazy-loaded.
const HomePage = lazy(() => import('./ui/home/HomePage'))
const TrackPage = lazy(() => import('./ui/track/TrackPage'))
const MapPage = lazy(() => import('./ui/map/MapPage'))

function PageLoader() {
  return <div className="page-loader">Loading…</div>
}

export default function App() {
  const route = useHashRoute()

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          RainRadar<span>F1</span>
        </a>
        <nav>
          <a
            href="#/"
            className={route.name === 'home' ? 'active' : ''}
            onClick={() => navigate('#/')}
          >
            Next race
          </a>
          <a
            href="#/map"
            className={route.name === 'map' ? 'active' : ''}
            onClick={() => navigate('#/map')}
          >
            Map
          </a>
        </nav>
      </header>

      <main>
        <Suspense fallback={<PageLoader />}>
          {route.name === 'map' && <MapPage />}
          {route.name === 'track' &&
            route.season !== undefined &&
            route.round !== undefined && (
              <TrackPage key={`${route.season}-${route.round}`} season={route.season} round={route.round} />
            )}
          {route.name === 'home' && <HomePage />}
        </Suspense>
      </main>

      <RainAlertBanner />
      <Attribution />
    </div>
  )
}
