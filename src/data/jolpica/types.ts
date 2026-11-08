/** Wire types for the Jolpica (Ergast-compatible) F1 API. */

export interface JolpicaSessionTime {
  date: string
  time: string
}

export interface JolpicaRace {
  season: string
  round: string
  raceName: string
  url?: string
  Circuit: {
    circuitId: string
    circuitName: string
    Location: {
      lat: string
      long: string
      locality: string
      country: string
    }
  }
  date: string
  time: string
  FirstPractice?: JolpicaSessionTime
  SecondPractice?: JolpicaSessionTime
  ThirdPractice?: JolpicaSessionTime
  Qualifying?: JolpicaSessionTime
  SprintQualifying?: JolpicaSessionTime
  Sprint?: JolpicaSessionTime
}

export interface JolpicaSeasonResponse {
  MRData: {
    RaceTable: {
      season: string
      Races: JolpicaRace[]
    }
  }
}

export interface ScheduleSnapshot {
  season: string
  races: JolpicaRace[]
}
