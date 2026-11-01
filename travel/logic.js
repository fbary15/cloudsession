// The Travel Map's rules: what is marked, what that adds up to, searching the
// built-in places, and checking backups. Nothing here touches the page or the
// map, so all of it is tested.
//
// Saved data looks like this:
//   {
//     version: 1,
//     countries: { US: { status: 'visited', at: 1730000000000, u: 1730000000000 } },
//     cities: {
//       g4887398: { name: 'Chicago', cc: 'US', lon: -87.65, lat: 41.85,
//                   sub: 'IL', status: 'visited', at: 1730000000000, u: 1730000000000 },
//     },
//     deleted: { 'city:g5261457': 1730000000000 },
//   }
// A status is 'visited' (been there) or 'wish' (bucket list). A country also
// counts as visited when any of its cities is, so marking Chicago is enough
// to light up the United States.
//
// `at` is when a place got its current status, `u` when the entry last
// changed. `deleted` remembers when something was unmarked. Together they let
// two devices that changed things separately merge their data (mergeData):
// for every place, the most recent change wins.

export const STATUSES = ['visited', 'wish'];
export const WORLD_COUNTRIES = 195;
export const CONTINENTS = ['Európa', 'Ázsia', 'Afrika', 'Észak-Amerika', 'Dél-Amerika', 'Óceánia'];

export function emptyData() {
  return { version: 1, countries: {}, cities: {}, deleted: {} };
}

/** Lowercase with accents removed, so "Bécs" matches "becs" and "São" "sao". */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[łŁ]/g, 'l')
    .replace(/[øØ]/g, 'o')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

/** The emoji flag for a two-letter country code, or a white flag. */
export function flag(cc) {
  if (!/^[A-Z]{2}$/.test(cc ?? '')) return '🏳️';
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

// --- Marking ----------------------------------------------------------------

const countryKey = (id) => `country:${id}`;
const cityKey = (key) => `city:${key}`;

function withoutTombstone(deleted, key) {
  if (!(key in deleted)) return deleted;
  const next = { ...deleted };
  delete next[key];
  return next;
}

/** Marks a country (status 'visited' or 'wish') or clears it (null). */
export function setCountry(data, id, status, now = Date.now()) {
  const countries = { ...data.countries };
  let deleted = data.deleted;
  if (status) {
    countries[id] = { status, at: countries[id]?.status === status ? countries[id].at : now, u: now };
    deleted = withoutTombstone(deleted, countryKey(id));
  } else if (countries[id]) {
    delete countries[id];
    deleted = { ...deleted, [countryKey(id)]: now };
  }
  return { ...data, countries, deleted };
}

/**
 * Clears a country and every city marked in it. Used when someone unmarks a
 * country, since a visited city would otherwise keep it lit.
 */
export function clearCountry(data, id, now = Date.now()) {
  const cities = {};
  const deleted = { ...data.deleted };
  for (const [key, city] of Object.entries(data.cities)) {
    if (city.cc !== id) cities[key] = city;
    else deleted[cityKey(key)] = now;
  }
  const countries = { ...data.countries };
  if (countries[id]) deleted[countryKey(id)] = now;
  delete countries[id];
  return { ...data, countries, cities, deleted };
}

/** Marks a city or clears it (status null). `city` needs key, name, cc, lon, lat. */
export function setCity(data, city, status, now = Date.now()) {
  const cities = { ...data.cities };
  let deleted = data.deleted;
  if (status) {
    const old = cities[city.key];
    const entry = {
      name: city.name,
      cc: city.cc,
      lon: city.lon,
      lat: city.lat,
      status,
      at: old?.status === status ? old.at : now,
      u: now,
    };
    if (city.sub) entry.sub = city.sub;
    if (city.pop) entry.pop = city.pop;
    cities[city.key] = entry;
    deleted = withoutTombstone(deleted, cityKey(city.key));
  } else if (cities[city.key]) {
    delete cities[city.key];
    deleted = { ...deleted, [cityKey(city.key)]: now };
  }
  return { ...data, cities, deleted };
}

// --- Syncing ------------------------------------------------------------------

const changedAt = (entry) => entry.u ?? entry.at ?? 0;

/** Merges one kind of entry (countries or cities) from two copies. */
function mergeKind(a, b, prefix, deletedA, deletedB) {
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    let entry = x && y ? (changedAt(y) > changedAt(x) ? y : x) : (x ?? y);
    const gone = Math.max(deletedA[`${prefix}:${key}`] ?? -1, deletedB[`${prefix}:${key}`] ?? -1);
    if (gone >= changedAt(entry)) entry = null;
    if (entry) out[key] = entry;
  }
  return out;
}

/**
 * Combines two copies of the data, such as this device's and the one saved
 * online. For every place the latest change wins, whether that was marking
 * it, changing it or unmarking it.
 */
export function mergeData(a, b) {
  const deleted = { ...a.deleted };
  for (const [key, time] of Object.entries(b.deleted)) {
    if (!(key in deleted) || time > deleted[key]) deleted[key] = time;
  }
  const countries = mergeKind(a.countries, b.countries, 'country', a.deleted, b.deleted);
  const cities = mergeKind(a.cities, b.cities, 'city', a.deleted, b.deleted);
  // A tombstone is only needed while it is newer than the place it removed.
  for (const key of Object.keys(deleted)) {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    const live = kind === 'country' ? countries[id] : cities[id];
    if (live && changedAt(live) > deleted[key]) delete deleted[key];
  }
  return { version: 1, countries, cities, deleted };
}

/**
 * The data changed to look like `target`, as fresh changes made now. Undo,
 * restoring a backup and starting over use this, so that syncing treats them
 * as the newest change and does not bring back what they removed.
 */
export function restoreData(current, target, now = Date.now()) {
  const deleted = { ...current.deleted };
  const stamp = (entries, prefix, before) => {
    const out = {};
    for (const [key, entry] of Object.entries(entries)) {
      const same = before[key] && JSON.stringify({ ...before[key], u: 0 }) === JSON.stringify({ ...entry, u: 0 });
      out[key] = same ? before[key] : { ...entry, u: now };
      delete deleted[`${prefix}:${key}`];
    }
    for (const key of Object.keys(before)) if (!(key in entries)) deleted[`${prefix}:${key}`] = now;
    return out;
  };
  return {
    version: 1,
    countries: stamp(target.countries, 'country', current.countries),
    cities: stamp(target.cities, 'city', current.cities),
    deleted,
  };
}

/** Whether two copies hold the same marks (ignores key order). */
export function sameData(a, b) {
  const canon = (d) => JSON.stringify([d.countries, d.cities, d.deleted].map((o) => Object.keys(o).sort().map((k) => [k, o[k]])));
  return canon(a) === canon(b);
}

/** 'visited', 'wish' or null for a country, taking its cities into account. */
export function countryStatus(data, id) {
  const own = data.countries[id]?.status ?? null;
  if (own === 'visited') return 'visited';
  let wish = own === 'wish';
  for (const city of Object.values(data.cities)) {
    if (city.cc !== id) continue;
    if (city.status === 'visited') return 'visited';
    wish = true;
  }
  return wish ? 'wish' : null;
}

/** Every country id with its status, for colouring the map. */
export function countryStatuses(data) {
  const ids = new Set([...Object.keys(data.countries), ...Object.values(data.cities).map((c) => c.cc)]);
  const visited = [];
  const wish = [];
  for (const id of ids) {
    const status = countryStatus(data, id);
    if (status === 'visited') visited.push(id);
    else if (status === 'wish') wish.push(id);
  }
  return { visited: visited.sort(), wish: wish.sort() };
}

/** Marked cities in a country, visited first, then by name. */
export function citiesIn(data, cc) {
  return Object.entries(data.cities)
    .filter(([, c]) => c.cc === cc)
    .map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'hu') : a.status === 'visited' ? -1 : 1));
}

/**
 * Totals for the summary. `countryInfo` maps a country id to { n, c }
 * (Hungarian name and continent).
 */
export function summarize(data, countryInfo) {
  const { visited, wish } = countryStatuses(data);
  const cities = Object.values(data.cities);
  const continents = {};
  for (const name of CONTINENTS) continents[name] = 0;
  for (const id of visited) {
    const continent = countryInfo[id]?.c;
    if (continent in continents) continents[continent] += 1;
  }
  return {
    countries: visited.length,
    cities: cities.filter((c) => c.status === 'visited').length,
    wishCountries: wish.length,
    wishCities: cities.filter((c) => c.status === 'wish').length,
    continents: Object.values(continents).filter((n) => n > 0).length,
    byContinent: continents,
    percent: Math.min(100, Math.round((visited.length / WORLD_COUNTRIES) * 100)),
  };
}

/**
 * Countries for the list: every country with a status, with its city counts,
 * grouped by continent in the order of CONTINENTS. `filter` is 'visited' or
 * 'wish'.
 */
export function countryGroups(data, countryInfo, filter) {
  const ids = new Set([...Object.keys(data.countries), ...Object.values(data.cities).map((c) => c.cc)]);
  const groups = new Map();
  for (const id of ids) {
    const status = countryStatus(data, id);
    if (status !== filter) continue;
    const info = countryInfo[id] ?? { n: id, c: 'Egyéb' };
    const list = citiesIn(data, id);
    const row = {
      id,
      name: info.n,
      visitedCities: list.filter((c) => c.status === 'visited').length,
      wishCities: list.filter((c) => c.status === 'wish').length,
    };
    if (!groups.has(info.c)) groups.set(info.c, []);
    groups.get(info.c).push(row);
  }
  const order = [...CONTINENTS, 'Antarktisz', 'Egyéb'];
  return [...groups.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([continent, rows]) => ({ continent, rows: rows.sort((a, b) => a.name.localeCompare(b.name, 'hu')) }));
}

/** Marked cities with a given status, newest first. */
export function markedCities(data, filter) {
  return Object.entries(data.cities)
    .filter(([, c]) => c.status === filter)
    .map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => b.at - a.at || a.name.localeCompare(b.name, 'hu'));
}

// --- Searching ----------------------------------------------------------------

/**
 * A search index over the built-in places. `countries` is a list of
 * { id, n, en }, `cityRows` the rows of data/cities.json:
 * [geonames id, name, country, lon, lat, population, US state?].
 * `aliases` are [Hungarian name, country, name in the rows] (aliases.js).
 */
export function buildIndex(countries, cityRows, aliases = []) {
  const hungarian = new Map();
  for (const [hu, cc, name] of aliases) {
    const i = cityRows.findIndex((r) => r[2] === cc && r[1] === name);
    if (i >= 0 && !hungarian.has(i)) hungarian.set(i, hu);
  }
  return {
    countries: countries.map((c) => ({ ...c, keys: [fold(c.n), fold(c.en)] })),
    rows: cityRows,
    names: cityRows.map((r) => fold(r[1])),
    hungarian,
    alt: new Map([...hungarian].map(([i, hu]) => [i, fold(hu)])),
  };
}

/** A city object from row `i` of the index, under its Hungarian name if it has one. */
export function cityAt(index, i) {
  const [id, name, cc, lon, lat, pop, sub] = index.rows[i];
  const city = { key: `g${id}`, name: index.hungarian.get(i) ?? name, cc, lon, lat, pop };
  if (city.name !== name) city.local = name;
  if (sub) city.sub = sub;
  return city;
}

/** Where a query sits in a name: 0 at the start, 1 at a word start, else -1. */
function matchRank(name, q) {
  if (name.startsWith(q)) return 0;
  const at = name.indexOf(q);
  if (at > 0 && /[\s\-'(.]/.test(name[at - 1])) return 1;
  return -1;
}

/**
 * Countries and cities matching a query, best first: names that start with
 * it before names with a word that does, bigger cities first. `cc` limits
 * cities to one country (and leaves countries out).
 */
export function search(index, query, { cc = null, limit = 40 } = {}) {
  const q = fold(query);
  if (!q) return { countries: [], cities: [] };

  const countries = [];
  if (!cc) {
    for (const c of index.countries) {
      const ranks = c.keys.map((k) => matchRank(k, q)).filter((r) => r >= 0);
      if (ranks.length) countries.push({ c, rank: Math.min(...ranks) });
    }
    countries.sort((a, b) => a.rank - b.rank || a.c.n.localeCompare(b.c.n, 'hu'));
  }

  // Rows are sorted by population, so collecting in order keeps big cities
  // first within each rank.
  const exact = [];
  const starts = [];
  const words = [];
  for (let i = 0; i < index.rows.length; i += 1) {
    if (cc && index.rows[i][2] !== cc) continue;
    const name = index.names[i];
    let rank = matchRank(name, q);
    const alt = index.alt.get(i);
    if (alt !== undefined) {
      const altRank = matchRank(alt, q);
      if (altRank >= 0 && (rank < 0 || altRank < rank)) rank = altRank;
      if (alt === q) { exact.push(i); continue; }
    }
    if (rank === 0) (name.length === q.length ? exact : starts).push(i);
    else if (rank === 1) words.push(i);
    if (exact.length >= limit) break;
  }
  const cities = [...exact, ...starts, ...words].slice(0, limit).map((i) => cityAt(index, i));
  return { countries: countries.slice(0, 6).map((x) => x.c), cities };
}

/** The smallest population a city dot needs to be shown at a zoom level. */
export function minPopulation(zoom) {
  if (zoom < 2.8) return Infinity;
  if (zoom < 4) return 1_000_000;
  if (zoom < 5) return 300_000;
  if (zoom < 6) return 100_000;
  if (zoom < 7) return 40_000;
  if (zoom < 8) return 15_000;
  return 0;
}

// --- Backups ------------------------------------------------------------------

function isCoord(n, max) {
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
}

/**
 * Checks saved or imported data and keeps only what makes sense. Throws on
 * something that is not a Travel Map backup at all.
 */
export function normalizeData(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.countries !== 'object' || typeof raw.cities !== 'object' || !raw.countries || !raw.cities) {
    throw new Error('Ez nem a Merre jártam mentése.');
  }
  const data = emptyData();
  for (const [id, entry] of Object.entries(raw.countries)) {
    if (!/^[A-Z0-9]{2,3}$/.test(id) || !STATUSES.includes(entry?.status)) continue;
    data.countries[id] = { status: entry.status, at: Number.isFinite(entry.at) ? entry.at : 0 };
    if (Number.isFinite(entry.u)) data.countries[id].u = entry.u;
  }
  for (const [key, c] of Object.entries(raw.cities)) {
    if (!c || typeof c.name !== 'string' || !c.name.trim() || !STATUSES.includes(c.status)) continue;
    if (!isCoord(c.lon, 180) || !isCoord(c.lat, 90) || !/^[A-Z0-9]{2,3}$/.test(c.cc ?? '')) continue;
    const city = { name: c.name.trim().slice(0, 80), cc: c.cc, lon: c.lon, lat: c.lat, status: c.status, at: Number.isFinite(c.at) ? c.at : 0 };
    if (typeof c.sub === 'string' && c.sub) city.sub = c.sub.slice(0, 40);
    if (Number.isFinite(c.pop) && c.pop > 0) city.pop = c.pop;
    if (Number.isFinite(c.u)) city.u = c.u;
    data.cities[String(key).slice(0, 60)] = city;
  }
  if (raw.deleted && typeof raw.deleted === 'object') {
    for (const [key, time] of Object.entries(raw.deleted)) {
      if (/^(country|city):.{1,60}$/.test(key) && Number.isFinite(time)) data.deleted[key] = time;
    }
  }
  return data;
}

/** Population as Hungarian text: 2 720 546 → "2,7 millió", 48 000 → "48 ezer". */
export function formatPopulation(pop) {
  if (!pop) return '';
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} millió lakos`;
  if (pop >= 10_000) return `${Math.round(pop / 1000)} ezer lakos`;
  return `${pop.toLocaleString('hu-HU')} lakos`;
}
