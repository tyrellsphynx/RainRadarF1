import type { StyleSpecification } from 'maplibre-gl'

/**
 * Compact dark basemap for radar contrast, built on OpenFreeMap's
 * OpenMapTiles vector source (keyless, unlimited — openfreemap.org).
 * OpenFreeMap ships only light styles, so this is a curated dark restyle
 * of the same tiles.
 */
export const OPENFREEMAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org">OpenFreeMap</a>'

export const DARK_STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#0b1220' },
    },
    {
      id: 'landcover',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['in', 'class', 'wood', 'grass', 'forest', 'park', 'grassland'],
      paint: { 'fill-color': '#0e1c26', 'fill-opacity': 0.6 },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      paint: { 'fill-color': '#0d1726', 'fill-opacity': 0.5 },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': '#0f2029', 'fill-opacity': 0.5 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#0a1c33' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: {
        'line-color': '#12304e',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.2],
      },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: { 'fill-color': '#15202f', 'fill-outline-color': '#1b2838' },
    },
    {
      id: 'road-major',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#3d4f70',
        'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 5, 0.5, 12, 2.4, 18, 12],
      },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['match', ['get', 'class'], ['secondary', 'tertiary', 'minor', 'service'], true, false]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      minzoom: 9,
      paint: {
        'line-color': '#2b3952',
        'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 9, 0.4, 14, 1.4, 18, 7],
      },
    },
    {
      id: 'rail',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', 'class', 'rail', 'transit'],
      paint: {
        'line-color': '#232f44',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 1.6],
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'boundary',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['<=', 'admin_level', 4],
      paint: {
        'line-color': '#2c3c5c',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 10, 1.6],
      },
    },
    {
      id: 'label-country',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['==', 'class', 'country'],
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 11, 6, 15],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
      },
      paint: {
        'text-color': '#4d5f80',
        'text-halo-color': '#0b1220',
        'text-halo-width': 1,
      },
    },
    {
      id: 'label-city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 14],
        'text-anchor': 'bottom',
        'text-offset': [0, -0.2],
      },
      paint: {
        'text-color': '#8fa3c4',
        'text-halo-color': '#0b1220',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'label-water',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 12, 13],
      },
      paint: {
        'text-color': '#31507a',
        'text-halo-color': '#0a1c33',
        'text-halo-width': 1,
      },
    },
  ],
} as unknown as StyleSpecification
