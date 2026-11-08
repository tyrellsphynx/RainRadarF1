/**
 * Refresh bundled, offline-safe data:
 *
 *   node scripts/fetch-snapshot.mjs [year ...]     (default: current year)
 *
 * 1. Fetches the Jolpica F1 calendar for each year and writes a trimmed
 *    snapshot to src/data/jolpica/snapshot-{year}.json (the app's offline /
 *    rate-limit fallback). Jolpica data is CC BY-NC-SA — non-commercial use.
 *
 * 2. Fetches bacinger/f1-circuits (MIT) and writes the track outlines for
 *    the circuits listed in src/data/circuits/outlineIds.ts to
 *    src/data/circuits/track-outlines.json.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { CIRCUIT_OUTLINE_IDS } from '../src/data/circuits/outlineIds.ts'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const JOLPICA = 'https://api.jolpi.ca/ergast/f1'
const BACINGER = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson'

const SESSION_KEYS = [
  'FirstPractice',
  'SecondPractice',
  'ThirdPractice',
  'Qualifying',
  'SprintQualifying',
  'Sprint',
]

function trimRace(race) {
  const out = {
    season: race.season,
    round: race.round,
    raceName: race.raceName,
    Circuit: {
      circuitId: race.Circuit.circuitId,
      circuitName: race.Circuit.circuitName,
      Location: {
        lat: race.Circuit.Location.lat,
        long: race.Circuit.Location.long,
        locality: race.Circuit.Location.locality,
        country: race.Circuit.Location.country,
      },
    },
    date: race.date,
    time: race.time,
  }
  for (const key of SESSION_KEYS) {
    if (race[key]) out[key] = { date: race[key].date, time: race[key].time }
  }
  return out
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

async function snapshotSchedule(year) {
  const json = await fetchJson(`${JOLPICA}/${year}.json?limit=100`)
  const races = json?.MRData?.RaceTable?.Races
  if (!Array.isArray(races) || races.length === 0) {
    throw new Error(`Jolpica returned no races for ${year}`)
  }
  const file = path.join(ROOT, 'src/data/jolpica', `snapshot-${year}.json`)
  await writeFile(file, JSON.stringify({ season: String(year), races: races.map(trimRace) }) + '\n')
  console.log(`schedule: ${races.length} rounds -> ${path.relative(ROOT, file)}`)
}

async function snapshotOutlines() {
  const wanted = new Set(Object.values(CIRCUIT_OUTLINE_IDS))
  const geojson = await fetchJson(BACINGER)
  const features = []
  for (const f of geojson.features ?? []) {
    if (!wanted.has(f.properties?.id)) continue
    features.push({
      type: 'Feature',
      properties: {
        id: f.properties.id,
        Name: f.properties.Name,
        Location: f.properties.Location,
      },
      geometry: {
        type: 'LineString',
        coordinates: f.geometry.coordinates.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]),
      },
    })
  }
  const missing = [...wanted].filter((id) => !features.some((f) => f.properties.id === id))
  if (missing.length > 0) console.warn(`outlines: MISSING ids: ${missing.join(', ')}`)
  const file = path.join(ROOT, 'src/data/circuits/track-outlines.json')
  await writeFile(file, JSON.stringify({ type: 'FeatureCollection', features }) + '\n')
  console.log(`outlines: ${features.length} tracks -> ${path.relative(ROOT, file)}`)
}

const years = process.argv.slice(2).map(Number).filter(Number.isFinite)
const list = years.length > 0 ? years : [new Date().getUTCFullYear()]

for (const year of list) {
  await snapshotSchedule(year)
}
await snapshotOutlines()
