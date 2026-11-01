// Tests for the Travel Map (travel/): the marking rules, totals, search,
// backups, and that the app stays installable and works offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  emptyData, fold, flag, setCountry, clearCountry, setCity, countryStatus, countryStatuses,
  citiesIn, summarize, countryGroups, markedCities, buildIndex, search, cityAt, minPopulation,
  normalizeData, formatPopulation,
} from '../travel/logic.js';
import { ALIASES } from '../travel/aliases.js';

const root = new URL('../travel/', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const exists = (path) => access(new URL(path, root)).then(() => true, () => false);

const chicago = { key: 'g4887398', name: 'Chicago', cc: 'US', lon: -87.65, lat: 41.85, sub: 'IL', pop: 2720546 };
const madison = { key: 'g5261457', name: 'Madison', cc: 'US', lon: -89.401, lat: 43.073, sub: 'WI' };
const vienna = { key: 'g2761369', name: 'Bécs', cc: 'AT', lon: 16.372, lat: 48.208 };
const INFO = {
  US: { n: 'Amerikai Egyesült Államok', c: 'Észak-Amerika' },
  AT: { n: 'Ausztria', c: 'Európa' },
  HU: { n: 'Magyarország', c: 'Európa' },
  JP: { n: 'Japán', c: 'Ázsia' },
};

// --- Marking ----------------------------------------------------------------

test('a visited city makes its country visited', () => {
  let data = setCity(emptyData(), chicago, 'visited', 1);
  data = setCity(data, madison, 'visited', 2);
  assert.equal(countryStatus(data, 'US'), 'visited');
  assert.equal(countryStatus(data, 'AT'), null);
  assert.deepEqual(countryStatuses(data), { visited: ['US'], wish: [] });
  assert.deepEqual(citiesIn(data, 'US').map((c) => c.name), ['Chicago', 'Madison']);
  assert.equal(data.cities.g4887398.sub, 'IL');
  assert.equal(data.cities.g4887398.pop, 2720546);
});

test('a bucket-list city puts its country on the bucket list unless it was visited', () => {
  let data = setCity(emptyData(), vienna, 'wish');
  assert.equal(countryStatus(data, 'AT'), 'wish');
  data = setCountry(data, 'AT', 'visited');
  assert.equal(countryStatus(data, 'AT'), 'visited');
  assert.deepEqual(countryStatuses(data), { visited: ['AT'], wish: [] });
});

test('marking and clearing a country', () => {
  let data = setCountry(emptyData(), 'JP', 'wish', 5);
  assert.deepEqual(data.countries.JP, { status: 'wish', at: 5 });
  data = setCountry(data, 'JP', 'wish', 9);
  assert.equal(data.countries.JP.at, 5, 'marking the same again keeps the date');
  data = setCountry(data, 'JP', null);
  assert.deepEqual(data.countries, {});
});

test('clearing a country also clears its cities, and nothing else', () => {
  let data = setCity(emptyData(), chicago, 'visited');
  data = setCity(data, vienna, 'visited');
  data = setCountry(data, 'US', 'visited');
  const before = structuredClone(data);
  data = clearCountry(data, 'US');
  assert.equal(countryStatus(data, 'US'), null);
  assert.deepEqual(Object.keys(data.cities), ['g2761369']);
  assert.deepEqual(before.cities.g4887398.name, 'Chicago', 'the old state is untouched, so undo works');
});

test('clearing a city', () => {
  let data = setCity(emptyData(), chicago, 'visited');
  data = setCity(data, chicago, null);
  assert.deepEqual(data.cities, {});
  assert.equal(countryStatus(data, 'US'), null);
});

// --- Totals -----------------------------------------------------------------

test('summary counts countries, cities, continents and the share of the world', () => {
  let data = setCity(emptyData(), chicago, 'visited');
  data = setCity(data, madison, 'visited');
  data = setCity(data, vienna, 'visited');
  data = setCountry(data, 'HU', 'visited');
  data = setCountry(data, 'JP', 'wish');
  const s = summarize(data, INFO);
  assert.equal(s.countries, 3);
  assert.equal(s.cities, 3);
  assert.equal(s.continents, 2);
  assert.equal(s.byContinent['Európa'], 2);
  assert.equal(s.byContinent['Észak-Amerika'], 1);
  assert.equal(s.wishCountries, 1);
  assert.equal(s.percent, 2);
});

test('country list groups by continent with city counts', () => {
  let data = setCity(emptyData(), chicago, 'visited');
  data = setCity(data, madison, 'wish');
  data = setCountry(data, 'HU', 'visited');
  data = setCity(data, vienna, 'visited');
  const groups = countryGroups(data, INFO, 'visited');
  assert.deepEqual(groups.map((g) => g.continent), ['Európa', 'Észak-Amerika']);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['AT', 'HU']);
  assert.deepEqual(groups[1].rows[0], { id: 'US', name: 'Amerikai Egyesült Államok', visitedCities: 1, wishCities: 1 });
  assert.deepEqual(markedCities(data, 'wish').map((c) => c.name), ['Madison']);
});

// --- Search -------------------------------------------------------------------

const rows = [
  [4887398, 'Chicago', 'US', -87.65, 41.85, 2720546, 'IL'],
  [2761369, 'Vienna', 'AT', 16.372, 48.208, 1691468],
  [5263045, 'Milwaukee', 'US', -87.906, 43.039, 600155, 'WI'],
  [5261457, 'Madison', 'US', -89.401, 43.073, 248951, 'WI'],
  [4073383, 'Madison', 'US', -86.748, 34.699, 46962, 'AL'],
  [3054643, 'Budapest', 'HU', 19.04, 47.498, 1741041],
  [5263058, 'South Milwaukee', 'US', -87.86, 42.911, 21156, 'WI'],
  [3046525, 'Pécs', 'HU', 18.233, 46.083, 145347],
];
const countries = [
  { id: 'US', n: 'Amerikai Egyesült Államok', en: 'United States of America', c: 'Észak-Amerika' },
  { id: 'AT', n: 'Ausztria', en: 'Austria', c: 'Európa' },
  { id: 'HU', n: 'Magyarország', en: 'Hungary', c: 'Európa' },
];
const index = buildIndex(countries, rows, [['Bécs', 'AT', 'Vienna'], ['Nincs', 'XX', 'Sehol']]);

test('fold ignores case and accents', () => {
  assert.equal(fold('  Pécs '), 'pecs');
  assert.equal(fold('São Paulo'), 'sao paulo');
  assert.equal(fold('Łódź'), 'lodz');
  assert.equal(fold('Straße'), 'strasse');
});

test('flag turns a country code into an emoji flag', () => {
  assert.equal(flag('HU'), '🇭🇺');
  assert.equal(flag('SOL'), '🏳️');
});

test('search finds cities by the start of their name, biggest first', () => {
  const { cities } = search(index, 'mad');
  assert.deepEqual(cities.map((c) => `${c.name} ${c.sub}`), ['Madison WI', 'Madison AL']);
  assert.deepEqual(cities[0], { key: 'g5261457', name: 'Madison', cc: 'US', lon: -89.401, lat: 43.073, pop: 248951, sub: 'WI' });
});

test('names that start with the query come before ones with a later word', () => {
  assert.deepEqual(search(index, 'milw').cities.map((c) => c.name), ['Milwaukee', 'South Milwaukee']);
  assert.deepEqual(search(index, 'waukee').cities, [], 'not from the middle of a word');
});

test('search ignores accents and finds Hungarian names', () => {
  assert.deepEqual(search(index, 'pecs').cities.map((c) => c.name), ['Pécs']);
  const [vienna2] = search(index, 'Bécs').cities;
  assert.equal(vienna2.name, 'Bécs');
  assert.equal(vienna2.local, 'Vienna');
  assert.equal(search(index, 'vienna').cities[0].name, 'Bécs', 'the Hungarian name is used either way');
});

test('search finds countries by Hungarian or English name', () => {
  assert.deepEqual(search(index, 'egyesult').countries.map((c) => c.id), ['US']);
  assert.deepEqual(search(index, 'hung').countries.map((c) => c.id), ['HU']);
  assert.deepEqual(search(index, 'aus').countries.map((c) => c.id), ['AT']);
});

test('search can be limited to one country', () => {
  const result = search(index, 'm', { cc: 'HU' });
  assert.deepEqual(result, { countries: [], cities: [] });
  assert.deepEqual(search(index, 'b', { cc: 'HU' }).cities.map((c) => c.name), ['Budapest']);
});

test('cityAt builds a city from a row', () => {
  assert.deepEqual(cityAt(index, 5), { key: 'g3054643', name: 'Budapest', cc: 'HU', lon: 19.04, lat: 47.498, pop: 1741041 });
});

test('city dots appear from big to small as you zoom in', () => {
  assert.equal(minPopulation(1), Infinity);
  assert.ok(minPopulation(3) > minPopulation(5));
  assert.ok(minPopulation(5) > minPopulation(7));
  assert.equal(minPopulation(9), 0);
});

test('every Hungarian alias points at a city in the built-in list', async () => {
  const all = JSON.parse(await read('data/cities.json'));
  const full = buildIndex([], all, ALIASES);
  const missing = ALIASES.filter(([hu]) => ![...full.hungarian.values()].includes(hu));
  assert.deepEqual(missing, []);
  for (const [hu] of [['Bécs'], ['Kolozsvár'], ['Kassa'], ['Prága']]) {
    assert.equal(search(full, hu).cities[0].name, hu);
  }
  const madisons = search(full, 'Madison').cities.filter((c) => c.cc === 'US');
  assert.equal(madisons[0].sub, 'WI', 'the biggest Madison comes first');
  assert.ok(search(full, 'Milwaukee').cities.length >= 1);
});

// --- Backups --------------------------------------------------------------------

test('normalizeData keeps valid marks and drops broken ones', () => {
  const data = normalizeData({
    countries: { US: { status: 'visited', at: 3 }, xx: { status: 'visited' }, JP: { status: 'maybe' }, SOL: { status: 'wish' } },
    cities: {
      a: { name: ' Chicago ', cc: 'US', lon: -87.65, lat: 41.85, status: 'visited', at: 1, sub: 'IL' },
      b: { name: '', cc: 'US', lon: 0, lat: 0, status: 'visited' },
      c: { name: 'Nowhere', cc: 'US', lon: 500, lat: 0, status: 'visited' },
      d: { name: 'Pécs', cc: 'HU', lon: 18.2, lat: 46.1, status: 'gone' },
    },
  });
  assert.deepEqual(data, {
    version: 1,
    countries: { US: { status: 'visited', at: 3 }, SOL: { status: 'wish', at: 0 } },
    cities: { a: { name: 'Chicago', cc: 'US', lon: -87.65, lat: 41.85, status: 'visited', at: 1, sub: 'IL' } },
  });
  assert.throws(() => normalizeData({ hello: 1 }), /nem a Merre jártam/);
  assert.throws(() => normalizeData(null));
});

test('a backup survives a round trip', () => {
  let data = setCity(emptyData(), chicago, 'visited', 7);
  data = setCountry(data, 'JP', 'wish', 8);
  assert.deepEqual(normalizeData(JSON.parse(JSON.stringify(data))), data);
});

test('population reads naturally in Hungarian', () => {
  assert.equal(formatPopulation(2720546).replace(/\s/g, ' '), '2,7 millió lakos');
  assert.equal(formatPopulation(48211), '48 ezer lakos');
  assert.equal(formatPopulation(0), '');
});

// --- Installable and offline ------------------------------------------------------

function pngSize(buffer) {
  assert.equal(buffer.toString('latin1', 1, 4), 'PNG');
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

test('the manifest is complete and every icon exists at its stated size', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Merre jártam');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.ok(await exists(icon.src), `${icon.src} exists`);
    if (icon.type === 'image/png') assert.equal(pngSize(await readFile(new URL(icon.src, root))), icon.sizes);
  }
});

test('the service worker caches every file the app loads', async () => {
  const sw = await read('sw.js');
  const shell = [...sw.match(/const SHELL = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const path of shell) assert.ok(await exists(path === './' ? 'index.html' : path), `${path} exists`);

  const html = await read('index.html');
  const app = await read('app.js');
  const refs = [
    ...[...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(?:https?:)?\/\//.test(u)),
    ...[...app.matchAll(/from '\.\/([^']+)'/g)].map((m) => m[1]),
    ...[...app.matchAll(/getJson\('([^']+)'\)/g)].map((m) => m[1]),
    ...JSON.parse(await read('manifest.webmanifest')).icons.map((i) => i.src),
  ];
  assert.ok(refs.includes('data/cities.json'), 'the map data is found');
  for (const ref of refs) assert.ok(shell.includes(`./${ref}`), `${ref} is in the cache list`);
});

test('the page declares the manifest, icons and the service worker', async () => {
  const html = await read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(await read('app.js'), /serviceWorker\.register\('\.\/sw\.js'\)/);
});
