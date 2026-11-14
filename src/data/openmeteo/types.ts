/** Wire types for the Open-Meteo forecast API. */

/**
 * Open-Meteo timestamps are the END of the interval for precipitation:
 * `precipitation` and `precipitation_probability` describe the preceding
 * hour, `minutely_15.precipitation` the preceding 15 minutes.
 */
export interface OpenMeteoHourly {
  time: string[]
  precipitation: (number | null)[]
  precipitation_probability?: (number | null)[]
}

export interface OpenMeteoMinutely15 {
  time: string[]
  precipitation: (number | null)[]
}

export interface OpenMeteoResponse {
  latitude?: number
  longitude?: number
  hourly?: OpenMeteoHourly
  minutely_15?: OpenMeteoMinutely15
}
