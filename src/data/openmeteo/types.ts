/** Wire types for the Open-Meteo forecast API. */

export interface OpenMeteoHourly {
  time: string[]
  precipitation: (number | null)[]
  precipitation_probability?: (number | null)[]
  rain?: (number | null)[]
  showers?: (number | null)[]
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
