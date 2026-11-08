/** Data attribution — required by the licenses of every source used. */
export function Attribution() {
  return (
    <footer className="attribution">
      <p>
        Schedule data © <a href="https://jolpi.ca/">Jolpica F1 API</a> (CC BY-NC-SA, based on
        Ergast) · Weather forecast by <a href="https://open-meteo.com/">Open-Meteo</a> (CC BY 4.0)
        · Radar by <a href="https://www.rainviewer.com/">RainViewer</a> · Map data ©{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ·{' '}
        <a href="https://openfreemap.org">OpenFreeMap</a> · Track outlines from{' '}
        <a href="https://github.com/bacinger/f1-circuits">bacinger/f1-circuits</a> (MIT)
      </p>
      <p className="attribution-disclaimer">
        Forecasts are model output, not guarantees — always judge the sky with your own eyes.
        Unofficial fan project; not affiliated with Formula 1.
      </p>
    </footer>
  )
}
