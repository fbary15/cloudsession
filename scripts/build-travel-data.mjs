// Builds the offline map data for the Travel Map (travel/data/) from the
// public datasets it is derived from. The results are committed, so this only
// needs to run when the data should be refreshed.
//
//   1. Download Natural Earth's 1:50m countries and state/province lines:
//        https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//        https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson
//   2. Install the GeoNames city list somewhere outside the repo:
//        npm install --prefix <dir> all-the-cities
//   3. node scripts/build-travel-data.mjs <countries.geojson> <lines.geojson> <dir>/node_modules/all-the-cities
//
// Countries keep only their ISO code, Hungarian and English names, continent
// and label point, with coordinates rounded to 0.01° (about a kilometre).
// Cities keep the places with at least 5,000 people, plus every Hungarian
// town with at least 1,000.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const [countriesPath, linesPath, citiesPkg] = process.argv.slice(2);
if (!countriesPath || !linesPath || !citiesPkg) {
  console.error('Usage: node scripts/build-travel-data.mjs <countries.geojson> <lines.geojson> <all-the-cities dir>');
  process.exit(1);
}

const outDir = new URL('../travel/data/', import.meta.url);
await mkdir(outDir, { recursive: true });

const CONTINENTS = {
  Europe: 'Európa',
  Asia: 'Ázsia',
  Africa: 'Afrika',
  'North America': 'Észak-Amerika',
  'South America': 'Dél-Amerika',
  Oceania: 'Óceánia',
  Antarctica: 'Antarktisz',
  'Seven seas (open ocean)': 'Óceánia',
};

const round = (n) => Math.round(n * 100) / 100;

/** Rounds a ring and drops points that collapse onto the previous one. */
function ring(points) {
  const out = [];
  for (const [x, y] of points) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}

function polygon(rings) {
  const kept = rings.map(ring);
  return kept[0] ? kept.filter(Boolean) : null;
}

function geometry(geom) {
  if (geom.type === 'Polygon') {
    const p = polygon(geom.coordinates);
    return p && { type: 'Polygon', coordinates: p };
  }
  const polys = geom.coordinates.map(polygon).filter(Boolean);
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
}

// --- Countries ------------------------------------------------------------
const countries = JSON.parse(await readFile(countriesPath, 'utf8'));
const features = [];
for (const f of countries.features) {
  const p = f.properties;
  let id = p.ISO_A2_EH;
  if (!id || id === '-99') id = p.ADM0_A3; // Somaliland, N. Cyprus, ...
  const geom = geometry(f.geometry);
  if (!geom) continue;
  features.push({
    type: 'Feature',
    properties: {
      id,
      n: p.NAME_HU || p.NAME,
      en: p.NAME_EN || p.NAME,
      c: CONTINENTS[p.CONTINENT] ?? 'Egyéb',
      lx: round(p.LABEL_X),
      ly: round(p.LABEL_Y),
    },
    geometry: geom,
  });
}
await writeFile(new URL('countries.json', outDir), JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`countries.json: ${features.length} shapes`);

// --- State and province lines -------------------------------------------
const lines = JSON.parse(await readFile(linesPath, 'utf8'));
const lineFeatures = [];
for (const f of lines.features) {
  const g = f.geometry;
  const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  const rounded = parts.map((part) => {
    const out = [];
    for (const [x, y] of part) {
      const pt = [round(x), round(y)];
      const last = out[out.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) out.push(pt);
    }
    return out;
  }).filter((part) => part.length >= 2);
  if (rounded.length) lineFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: rounded } });
}
await writeFile(new URL('regions.json', outDir), JSON.stringify({ type: 'FeatureCollection', features: lineFeatures }));
console.log(`regions.json: ${lineFeatures.length} lines`);

// --- Cities ---------------------------------------------------------------
// Rows: [geonames id, name, country, lon, lat, population, US state]
const require = createRequire(import.meta.url);
const cities = require(path.resolve(citiesPkg));
const rows = cities
  .filter((c) => c.population >= 5000 || (c.country === 'HU' && c.population >= 1000))
  .sort((a, b) => b.population - a.population)
  .map((c) => {
    const [lon, lat] = c.loc.coordinates;
    const row = [c.cityId, c.name, c.country, Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000, c.population];
    if (c.country === 'US' && c.adminCode) row.push(c.adminCode);
    return row;
  });
await writeFile(new URL('cities.json', outDir), JSON.stringify(rows));
console.log(`cities.json: ${rows.length} cities`);
