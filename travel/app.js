// Merre jártam: the globe, the bottom sheet and saving. The rules live in
// logic.js; this file draws them and listens to taps.
/* global maplibregl */
import {
  emptyData, fold, flag, setCountry, clearCountry, setCity, countryStatus, countryStatuses,
  citiesIn, summarize, countryGroups, markedCities, buildIndex, search, cityAt, minPopulation,
  normalizeData, formatPopulation, restoreData, CONTINENTS,
} from './logic.js';
import { ALIASES } from './aliases.js';
import { createSync, syncConfigured, syncMessage } from './sync.js';

const STORE = 'travel-map-v1';
const COLORS = {
  ocean: '#0a1424',
  land: '#1b2639',
  border: '#3a4b66',
  visited: '#ff7a59',
  wish: '#24766f',
  city: '#c9d4e6',
};
const byId = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// --- State ------------------------------------------------------------------

let data = load();
let countryInfo = {}; // id -> { n, en, c, lx, ly, bbox }
let index = null; // search index, once the city list has loaded
let map = null;
let mapReady = false; // the style has loaded and layers can be changed
const pins = new Map(); // city key -> { marker, el }
let focusMarker = null;
let selectedPin = null;

/** The sheet shows one view at a time; back returns to the previous one. */
const stack = [{ mode: 'home' }];
let snap = 'peek';
let homeTab = 'visited';

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? normalizeData(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
  }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch {
    toast('Nem sikerült menteni. Tele van a tárhely?');
  }
}

// --- Sync --------------------------------------------------------------------

let syncState = { state: 'off', email: null, error: null };
let announceSync = false; // say "synced" once after signing in

const sync = createSync({
  getData: () => data,
  setData: (merged) => {
    data = merged;
    save();
    refresh();
  },
  onStatus: (status) => {
    const wasSignedIn = Boolean(syncState.email);
    syncState = status;
    if (status.email && !wasSignedIn) announceSync = true;
    if (status.state === 'synced' && announceSync) {
      announceSync = false;
      const n = Object.keys(data.countries).length + Object.keys(data.cities).length;
      toast(`Szinkronizálva · ${n} jelölés`, { tone: 'wish' });
    }
    renderSync();
  },
});

const SYNC_TEXT = {
  loading: 'Kapcsolódás…',
  'signed-out': '',
  syncing: 'Szinkronizálás…',
  synced: 'Minden eszközöd naprakész',
  error: 'Nem sikerült szinkronizálni',
  off: '',
};

function renderSync() {
  const { state, email, error } = syncState;
  byId('sync-section').hidden = !syncConfigured;
  byId('sync-out').hidden = Boolean(email) || state === 'loading';
  byId('sync-in').hidden = !email;
  byId('sync-email-label').textContent = email ?? '';
  byId('sync-state').textContent = navigator.onLine === false && email ? 'Nincs internet – később szinkronizál' : SYNC_TEXT[state] ?? '';
  byId('sync-dot').className = `sync-dot ${state}`;
  byId('sync-error').hidden = !error;
  byId('sync-error').textContent = error ?? '';
  let badge = byId('menu-btn').querySelector('.badge');
  if (!badge) {
    badge = document.createElement('i');
    byId('menu-btn').append(badge);
  }
  badge.className = `badge ${email ? state : ''}`;
  badge.hidden = !email;
}

function setupSyncForm() {
  const email = byId('sync-email');
  const password = byId('sync-password');
  const showError = (message) => {
    byId('sync-error').hidden = !message;
    byId('sync-error').textContent = message ?? '';
  };
  const run = async (button, action) => {
    showError(null);
    if (!email.value.trim()) { email.focus(); return showError('Add meg az e-mail-címed.'); }
    button.disabled = true;
    try {
      await action(email.value.trim(), password.value);
      password.value = '';
    } catch (err) {
      showError(syncMessage(err));
    } finally {
      button.disabled = false;
    }
  };
  byId('sync-signin').addEventListener('click', (e) => run(e.currentTarget, sync.signIn));
  byId('sync-signup').addEventListener('click', (e) => run(e.currentTarget, sync.signUp));
  byId('sync-reset').addEventListener('click', (e) => run(e.currentTarget, async (address) => {
    await sync.resetPassword(address);
    toast('Elküldtük a jelszó-visszaállító levelet.');
  }));
  byId('sync-google').addEventListener('click', async () => {
    showError(null);
    try {
      await sync.signInWithGoogle();
    } catch (err) {
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') showError(syncMessage(err));
    }
  });
  // Popups do not work from an app added to an iPhone's home screen.
  if (isIos() && isStandalone()) byId('sync-google').hidden = true;
  for (const input of [email, password]) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); // the settings form would close
      if (input === email) password.focus();
      else byId('sync-signin').click();
    });
  }
  byId('sync-signout').addEventListener('click', async () => {
    await sync.signOut();
    toast('Kijelentkeztél. A jelölések ezen az eszközön maradnak.');
  });
  window.addEventListener('online', renderSync);
  window.addEventListener('offline', renderSync);
  renderSync();
}

// --- Installing ---------------------------------------------------------------

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installPrompt = null;

function installDismissed() {
  try {
    return localStorage.getItem('travel-install-dismissed') === '1';
  } catch {
    return false;
  }
}

/** A card on the home view that explains how to install the app, when it can be. */
function installCard() {
  if (isStandalone() || installDismissed() || (!installPrompt && !isIos())) return '';
  const share = '<svg class="share-icon" viewBox="0 0 24 24" aria-label="Megosztás"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const text = installPrompt
    ? 'Saját ikonnal, külön ablakban nyílik meg, net nélkül is.'
    : `Koppints a ${share} Megosztás gombra, majd a <b>Főképernyőhöz adás</b> pontra.`;
  return `<div class="install-card">
    <img src="icons/icon-192.png" alt="">
    <div><b>${installPrompt ? 'Telepítsd appként' : 'Tedd ki a kezdőképernyőre'}</b><p>${text}</p>${installPrompt ? '<button type="button" class="btn primary" data-act="install">Telepítés</button>' : ''}</div>
    <button type="button" class="icon-btn" data-act="install-close" aria-label="Most nem">${ICONS.close}</button>
  </div>`;
}

async function promptInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  byId('install-btn').hidden = true;
  if (current().mode === 'home') render();
}

/** Applies a change, saves it, redraws, and offers to undo it. */
function commit(next, message, { undo = true, tone = null } = {}) {
  const before = data;
  data = next;
  save();
  refresh();
  sync.changed();
  navigator.vibrate?.(12);
  if (message) {
    toast(message, {
      tone,
      // Undo is a new change of its own, so syncing does not bring back what it undid.
      action: undo ? ['Visszavonás', () => { data = restoreData(data, before); save(); refresh(); sync.changed(); }] : null,
    });
  }
}

/** Computers get a side panel instead of a bottom sheet. */
const isDesktop = () => innerWidth >= 900;

function countryName(id) {
  if (countryInfo[id]) return countryInfo[id].n;
  try {
    return new Intl.DisplayNames(['hu'], { type: 'region' }).of(id) ?? id;
  } catch {
    return id;
  }
}

function placeLine(city) {
  const parts = [];
  if (city.sub && city.cc === 'US') parts.push(city.sub);
  parts.push(countryName(city.cc));
  return parts.join(', ');
}

// --- Icons ----------------------------------------------------------------------

const ICONS = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 2.5 5.2 5.7.7-4.2 3.9 1.1 5.6L12 16.4l-5.1 2.8L8 13.6 3.8 9.7l5.7-.7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v5.5M12 7.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5M12 3.5C9.4 5.9 8.2 8.7 8.2 12s1.2 6.1 3.8 8.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};

// --- Toasts -------------------------------------------------------------------

function toast(message, { tone = null, action = null, ms = 3200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${tone ? `<i class="dot ${tone}"></i>` : ''}<span>${esc(message)}</span>`;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action[0];
    btn.addEventListener('click', () => { action[1](); dismiss(); });
    el.append(btn);
  }
  const box = byId('toasts');
  while (box.children.length >= 2) box.firstElementChild.remove();
  box.append(el);
  const timer = setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }
}

// --- Map ------------------------------------------------------------------------

function fillColor() {
  const { visited, wish } = countryStatuses(data);
  return [
    'case',
    ['in', ['get', 'id'], ['literal', visited]], COLORS.visited,
    ['in', ['get', 'id'], ['literal', wish]], COLORS.wish,
    'rgba(0,0,0,0)',
  ];
}

/** circle-opacity that hides small towns until you zoom in (see minPopulation). */
function cityOpacity() {
  const shown = (pop) => ['case', ['>=', ['get', 'p'], pop], 0.6, 0];
  return ['step', ['zoom'], shown(1_000_000), 4, shown(300_000), 5, shown(100_000), 6, shown(40_000), 7, shown(15_000), 8, 0.6];
}

/** The zoom at which the whole globe fits the screen above the sheet. */
function worldZoom() {
  const room = isDesktop()
    ? Math.min(innerWidth - 460, innerHeight - 140)
    : Math.min(innerWidth, innerHeight - sheetHeight('peek') - 80);
  return Math.max(0.3, Math.log2((room * 0.92) / 163));
}

/**
 * The part of the screen the sheet and top bar leave free, as padding. The
 * map itself never gets padding (MapLibre adds it to every fit), so it is
 * passed to each camera move instead.
 */
function mapPadding(snapName = snap) {
  // On a computer the map itself is padded for the side panel (see
  // fitDesktop), so only a margin is added here.
  const pad = isDesktop()
    ? { left: 30, right: 30, top: 90, bottom: 30 }
    : { left: 24, right: 24, top: 90, bottom: sheetHeight(snapName) + 20 };
  const spare = innerHeight - 120 - pad.top - pad.bottom;
  if (spare < 0) pad.bottom = Math.max(20, pad.bottom + spare);
  return pad;
}

/** How far to shift a centred place so it sits in the middle of the free area. */
function freeOffset(snapName = snap) {
  if (isDesktop()) return [0, 0];
  const p = mapPadding(snapName);
  return [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
}

function initMap(countries, regions) {
  const start = startView();
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      projection: { type: 'globe' },
      sky: {
        'sky-color': '#0d1a33',
        'horizon-color': '#3b6bd1',
        'fog-color': '#0d1a33',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.9,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 1, 7, 0],
      },
      sources: {
        countries: { type: 'geojson', data: countries, tolerance: 0.25 },
        regions: { type: 'geojson', data: regions },
        cities: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': COLORS.ocean } },
        { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': COLORS.land } },
        // Marked countries: bold on the globe, a wash once you zoom in so the
        // cities on top stay readable.
        { id: 'marked', type: 'fill', source: 'countries', paint: { 'fill-color': fillColor(), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.92, 4, 0.5, 7, 0.32] } },
        { id: 'regions', type: 'line', source: 'regions', minzoom: 2.6, paint: { 'line-color': 'rgba(255,255,255,0.12)', 'line-width': 0.7, 'line-dasharray': [3, 2] } },
        { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': COLORS.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.4] } },
        { id: 'selected', type: 'line', source: 'countries', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#ffffff', 'line-width': 2.2 } },
        {
          id: 'cities',
          type: 'circle',
          source: 'cities',
          minzoom: 2.8,
          paint: {
            'circle-color': COLORS.city,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 9, 3.6],
            'circle-opacity': cityOpacity(),
            'circle-stroke-color': COLORS.ocean,
            'circle-stroke-width': 1,
            'circle-stroke-opacity': cityOpacity(),
          },
        },
      ],
    },
    center: start.center,
    zoom: start.zoom,
    minZoom: 0.3,
    maxZoom: 13,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    fadeDuration: 0,
  });
  window.travelMap = map; // handy from the console
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  map.on('load', () => {
    mapReady = true;
    fitDesktop();
    byId('loading').classList.add('done');
    syncPins();
    startSpin();
  });
  map.on('zoom', updateFar);
  map.on('click', onMapClick);
  map.on('contextmenu', (e) => openNewPlace(e.lngLat, e.point));
  setupLongPress();

  for (const type of ['mousedown', 'touchstart', 'wheel']) map.on(type, stopSpin);
  map.on('moveend', scheduleSpin);
}

/** Starts over the countries you have been to, or over Europe. */
function startView() {
  const cities = Object.values(data.cities).filter((c) => c.status === 'visited');
  let center = [19, 35];
  if (cities.length) {
    // Average on the unit sphere so places on both sides of 180° work.
    let x = 0; let y = 0; let z = 0;
    for (const c of cities) {
      const lon = (c.lon * Math.PI) / 180;
      const lat = (c.lat * Math.PI) / 180;
      x += Math.cos(lat) * Math.cos(lon); y += Math.cos(lat) * Math.sin(lon); z += Math.sin(lat);
    }
    center = [(Math.atan2(y, x) * 180) / Math.PI, Math.max(-50, Math.min(55, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI))];
  }
  return { center, zoom: worldZoom() };
}

function updateFar() {
  byId('map').classList.toggle('far', map.getZoom() < 3);
}

function refreshMap() {
  if (!mapReady) return;
  map.setPaintProperty('marked', 'fill-color', fillColor());
  syncPins();
}

function loadCityDots() {
  const features = index.rows.map((r, i) => ({
    type: 'Feature',
    properties: { i, p: r[5] },
    geometry: { type: 'Point', coordinates: [r[3], r[4]] },
  }));
  const apply = () => map.getSource('cities').setData({ type: 'FeatureCollection', features });
  if (mapReady) apply();
  else map.once('load', apply);
}

// Pins for marked cities: DOM markers, so they glow and carry a label, and
// MapLibre hides them on the far side of the globe.
function syncPins() {
  if (!map) return;
  if (focusMarker && selectedPin && data.cities[selectedPin]) {
    focusMarker.remove();
    focusMarker = null;
  }
  const keys = new Set(Object.keys(data.cities));
  for (const [key, pin] of pins) {
    if (!keys.has(key)) { pin.marker.remove(); pins.delete(key); }
  }
  for (const [key, city] of Object.entries(data.cities)) {
    let pin = pins.get(key);
    if (!pin) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin';
      el.innerHTML = '<span class="pin-dot"></span><span class="pin-label"></span>';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = data.cities[key];
        if (c) openCity({ key, ...c }, { fly: false });
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [-6, 0], opacityWhenCovered: '0' })
        .setLngLat([city.lon, city.lat])
        .addTo(map);
      pin = { marker, el };
      pins.set(key, pin);
    }
    pin.el.classList.toggle('wish', city.status === 'wish');
    pin.el.classList.toggle('selected', key === selectedPin);
    pin.el.querySelector('.pin-label').textContent = city.name;
    pin.el.setAttribute('aria-label', `${city.name}, ${countryName(city.cc)}`);
    pin.el.style.zIndex = city.status === 'visited' ? '2' : '1';
  }
}

function setSelection({ country = null, cityKey = null, lngLat = null } = {}) {
  if (!mapReady) return;
  map.setFilter('selected', ['==', ['get', 'id'], country ?? '']);
  selectedPin = cityKey;
  for (const [key, pin] of pins) pin.el.classList.toggle('selected', key === cityKey);
  focusMarker?.remove();
  focusMarker = null;
  if (lngLat && !(cityKey && pins.has(cityKey))) {
    // MapLibre positions the marker with a transform, so the animated ring
    // goes inside it.
    const el = document.createElement('div');
    el.innerHTML = '<div class="focus-ring"></div>';
    focusMarker = new maplibregl.Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(lngLat).addTo(map);
  }
}

function flyToCountry(id) {
  const info = countryInfo[id];
  if (!info || !map) return;
  stopSpin();
  const [w, s, e, n] = info.bbox;
  const camera = map.cameraForBounds([[w, s], [e, n]], { padding: mapPadding(), maxZoom: 6 });
  if (camera) map.flyTo({ ...camera, duration: 1600, essential: true });
  else map.flyTo({ center: [info.lx, info.ly], zoom: 4, offset: freeOffset(), duration: 1600, essential: true });
}

function flyToCity(city) {
  if (!map) return;
  stopSpin();
  map.flyTo({ center: [city.lon, city.lat], zoom: Math.max(map.getZoom(), 6), offset: freeOffset(), duration: 1600, essential: true });
}

function flyToWorld() {
  if (!map) return;
  map.flyTo({ zoom: worldZoom(), duration: 1400, essential: true });
  map.once('moveend', startSpin);
}

/** The visible built-in city nearest to a tap, if any is close enough. */
function cityDotAt(point) {
  if (!index || map.getZoom() < 2.8) return null;
  const r = 14;
  const hits = map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers: ['cities'] });
  const min = minPopulation(map.getZoom());
  let best = null;
  let bestD = Infinity;
  for (const f of hits) {
    if (f.properties.p < min) continue;
    const p = map.project(f.geometry.coordinates);
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d < bestD) { best = f; bestD = d; }
  }
  return best ? cityAt(index, best.properties.i) : null;
}

function onMapClick(e) {
  if (e.originalEvent?.target?.closest?.('.pin')) return;
  const city = cityDotAt(e.point);
  if (city) {
    openCity(data.cities[city.key] ? { key: city.key, ...data.cities[city.key] } : city, { fly: false });
    return;
  }
  const country = map.queryRenderedFeatures(e.point, { layers: ['land'] })[0];
  if (country) {
    openCountry(country.properties.id, { fly: map.getZoom() < 3 });
  } else if (current().mode !== 'home') {
    goHome();
  }
}

/** A long press on the map adds a place of your own (desktop: right click). */
function setupLongPress() {
  let timer = 0;
  let start = null;
  const cancel = () => { clearTimeout(timer); start = null; };
  map.on('touchstart', (e) => {
    cancel();
    if (e.points.length !== 1) return;
    start = e.point;
    const { lngLat, point } = e;
    timer = setTimeout(() => { start = null; openNewPlace(lngLat, point); }, 600);
  });
  map.on('touchmove', (e) => {
    if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 8) cancel();
  });
  map.on('touchend', cancel);
  map.on('touchcancel', cancel);
  map.on('movestart', (e) => { if (e.originalEvent) cancel(); });
}

// Slow spin while the whole globe is in view and nothing else is going on.
let spinning = false;
let spinFrame = 0;
let spinLast = 0;
let spinTimer = 0;

function startSpin() {
  if (spinning || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!map || map.getZoom() > 2.6) return;
  spinning = true;
  spinLast = 0;
  spinFrame = requestAnimationFrame(spin);
}

function spin(ts) {
  if (!spinning) return;
  const dt = spinLast ? Math.min(0.05, (ts - spinLast) / 1000) : 0;
  spinLast = ts;
  if (!map.isMoving() && !document.hidden) {
    const c = map.getCenter();
    map.setCenter([c.lng - dt * 5, c.lat]);
  }
  spinFrame = requestAnimationFrame(spin);
}

function stopSpin() {
  spinning = false;
  cancelAnimationFrame(spinFrame);
  clearTimeout(spinTimer);
}

function scheduleSpin(e) {
  if (!e?.originalEvent) return; // only resume after the person moved the map
  clearTimeout(spinTimer);
  spinTimer = setTimeout(() => {
    if (map.getZoom() <= 2.2 && current().mode === 'home' && snap === 'peek') startSpin();
  }, 9000);
}

// --- Sheet: sizes and dragging -------------------------------------------------

const safeBottom = (() => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.append(probe);
  const value = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return value;
})();

function fullHeight() {
  return byId('sheet').getBoundingClientRect().height || innerHeight * 0.9;
}

function sheetHeight(name) {
  const full = fullHeight();
  const head = 22 + byId('sheet-head').offsetHeight;
  if (name === 'full') return full;
  if (name === 'half') return Math.min(full, Math.max(innerHeight * 0.5, head + 160));
  const extra = { home: 84, country: 78, city: 78, place: 0, search: 0 }[current().mode] ?? 0;
  return Math.min(full, head + extra + safeBottom + 8);
}

/** Keeps the globe centred in the space next to the side panel on a computer. */
function fitDesktop() {
  if (!map) return;
  const left = isDesktop() ? 420 : 0;
  if (map.getPadding().left !== left) map.setPadding({ top: 0, bottom: 0, right: 0, left });
}

function setSnap(name) {
  if (isDesktop()) name = 'full';
  snap = name;
  const sheet = byId('sheet');
  const visible = sheetHeight(name);
  sheet.style.setProperty('--sheet-visible', `${visible}px`);
  sheet.style.setProperty('--sheet-hidden', `${Math.max(0, fullHeight() - visible)}px`);
  sheet.dataset.snap = name;
  byId('sheet-body').style.overflowY = name === 'full' ? 'auto' : 'hidden';
}

function setupSheetDrag() {
  const sheet = byId('sheet');
  const body = byId('sheet-body');
  let drag = null;
  let suppressClick = false;

  sheet.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || isDesktop()) return;
    if (e.target.closest('input, textarea')) return;
    const inBody = body.contains(e.target);
    if (inBody && snap === 'full') return; // the list scrolls instead
    drag = { y: e.clientY, start: sheetHeight(snap), moved: false, id: e.pointerId, t: performance.now(), lastY: e.clientY, lastT: performance.now(), v: 0 };
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) < 7) return;
      drag.moved = true;
      sheet.setPointerCapture(e.pointerId);
      sheet.classList.add('dragging');
    }
    const now = performance.now();
    drag.v = (e.clientY - drag.lastY) / Math.max(1, now - drag.lastT);
    drag.lastY = e.clientY;
    drag.lastT = now;
    const visible = Math.max(sheetHeight('peek') * 0.6, Math.min(fullHeight(), drag.start - dy));
    sheet.style.setProperty('--sheet-visible', `${visible}px`);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasDrag = drag.moved;
    const v = drag.v;
    drag = null;
    sheet.classList.remove('dragging');
    if (!wasDrag) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 50);
    const visible = parseFloat(sheet.style.getPropertyValue('--sheet-visible'));
    const options = ['peek', 'half', 'full'].map((name) => [name, sheetHeight(name)]);
    let target;
    if (Math.abs(v) > 0.5) {
      const order = options.map(([n]) => n);
      const nearest = options.reduce((a, b) => (Math.abs(b[1] - visible) < Math.abs(a[1] - visible) ? b : a))[0];
      let i = order.indexOf(nearest);
      if (v < 0 && options[i][1] < visible) i += 1;
      if (v > 0 && options[i][1] > visible) i -= 1;
      target = order[Math.max(0, Math.min(order.length - 1, i))];
    } else {
      target = options.reduce((a, b) => (Math.abs(b[1] - visible) < Math.abs(a[1] - visible) ? b : a))[0];
    }
    if (current().mode === 'search' && target !== 'full') {
      document.activeElement?.blur?.();
    }
    setSnap(target);
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
  sheet.addEventListener('click', (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  sheet.addEventListener('wheel', (e) => {
    if (isDesktop()) return;
    if (snap !== 'full' && e.deltaY > 0) setSnap(snap === 'peek' ? 'half' : 'full');
    else if (snap === 'full' && e.deltaY < 0 && body.scrollTop <= 0) setSnap('half');
  }, { passive: true });
}

// --- Sheet: views ---------------------------------------------------------------

function current() {
  return stack[stack.length - 1];
}

function push(view, snapTo) {
  if (current().mode === view.mode && view.mode !== 'home') stack[stack.length - 1] = view;
  else {
    stack.push(view);
    history.pushState({ depth: stack.length }, '');
  }
  render();
  setSnap(snapTo);
}

function back() {
  if (stack.length > 1) history.back();
}

let skipPops = 0;

window.addEventListener('popstate', (e) => {
  if (skipPops) { skipPops -= 1; return; }
  stack.length = Math.max(1, Math.min(stack.length, e.state?.depth ?? 1));
  render();
  const mode = current().mode;
  setSnap(mode === 'home' ? 'peek' : mode === 'search' ? 'full' : 'half');
});

/** Back to the home view right away; the browser history catches up after. */
function goHome() {
  const depth = stack.length - 1;
  if (!depth) return;
  stack.length = 1;
  skipPops += 1;
  history.go(-depth);
  render();
  setSnap('peek');
}

function render() {
  const view = current();
  const head = byId('sheet-head');
  const body = byId('sheet-body');
  if (view.mode !== 'search') body.scrollTop = 0;
  ({ home: renderHome, search: renderSearch, country: renderCountry, city: renderCity, place: renderPlace })[view.mode](view, head, body);
  if (view.mode === 'home') setSelection();
}

function refresh() {
  renderHud();
  refreshMap();
  const view = current();
  if (view.mode === 'search') renderResults();
  else render();
}

function renderHud() {
  const s = summarize(data, countryInfo);
  byId('hud-countries').textContent = s.countries;
  byId('hud-cities').textContent = s.cities;
  byId('hud-percent').textContent = `${s.percent}%`;
}

function searchButton(label = 'Hová utaztál?') {
  return `<button type="button" class="search" data-act="search">${ICONS.search}<span>${esc(label)}</span></button>`;
}

function backHead(title) {
  return `<div class="search-row"><button type="button" class="icon-btn" data-act="back" aria-label="Vissza">${ICONS.back}</button>${title}</div>`;
}

function renderHome(view, head, body) {
  head.innerHTML = searchButton();
  const s = summarize(data, countryInfo);
  const tiles = `
    <div class="tiles">
      <div class="tile hot"><b>${s.countries}</b><small>ország</small></div>
      <div class="tile hot"><b>${s.cities}</b><small>város</small></div>
      <div class="tile"><b>${s.continents}<small>/6</small></b><small>kontinens</small></div>
      <div class="tile cool"><b>${s.wishCountries + s.wishCities}</b><small>bakancslista</small></div>
    </div>`;
  const max = Math.max(1, ...Object.values(s.byContinent));
  const continents = s.countries ? `
    <h3 class="group-title continents-title">Kontinensek</h3>
    <div class="continents">${CONTINENTS.map((name) => {
      const n = s.byContinent[name];
      return `<div class="continent${n ? ' on' : ''}"><span>${name}</span><span class="bar"><i style="width:${(n / max) * 100}%"></i></span><b>${n}</b></div>`;
    }).join('')}</div>` : '';
  const tabs = [['visited', 'Országok'], ['cities', 'Városok'], ['wish', 'Bakancslista']];
  const segments = `<div class="segments" role="group" aria-label="Lista">${tabs.map(([id, label]) => `<button type="button" data-tab="${id}" aria-pressed="${homeTab === id}">${label}</button>`).join('')}</div>`;
  body.innerHTML = installCard() + tiles + segments + homeList() + continents;
}

function countryRow(row, status) {
  const counts = [];
  if (row.visitedCities) counts.push(`${row.visitedCities} város`);
  if (row.wishCities) counts.push(`${row.wishCities} tervezett`);
  const sub = counts.join(' · ') || (status === 'wish' ? 'Ide mennél' : 'Még nincs város jelölve');
  return `<li><button type="button" class="row" data-country="${row.id}"><span class="row-flag">${flag(row.id)}</span><span class="row-main"><span class="row-title">${esc(row.name)}</span><span class="row-sub">${esc(sub)}</span></span><span class="row-end">${ICONS.chev}</span></button></li>`;
}

function cityRow(city, { showCountry = true, highlight = '' } = {}) {
  const status = data.cities[city.key]?.status ?? null;
  const subParts = [];
  if (showCountry) subParts.push(`${flag(city.cc)} ${esc(placeLine(city))}`);
  else if (city.sub && city.cc === 'US') subParts.push(esc(city.sub));
  if (city.local) subParts.push(esc(city.local));
  if (!showCountry && city.pop) subParts.push(formatPopulation(city.pop));
  const icon = status === 'visited' ? ICONS.check : status === 'wish' ? ICONS.star : ICONS.pin;
  return `<li><button type="button" class="row" data-city="${esc(city.key)}"><span class="row-icon ${status ?? ''}">${icon}</span><span class="row-main"><span class="row-title">${mark(city.name, highlight)}</span><span class="row-sub">${subParts.join(' · ')}</span></span><span class="row-end">${ICONS.chev}</span></button></li>`;
}

function mark(text, query) {
  const q = fold(query);
  if (!q) return esc(text);
  const folded = fold(text);
  const at = folded.indexOf(q);
  // Folding can change the length (ß → ss); only highlight when it did not.
  if (at < 0 || folded.length !== text.length) return esc(text);
  return `${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + q.length))}</mark>${esc(text.slice(at + q.length))}`;
}

function homeList() {
  if (homeTab === 'cities') {
    const cities = markedCities(data, 'visited');
    if (!cities.length) return emptyState('🏙️', 'Még nincs város', 'Keress rá egy városra, vagy nagyíts rá a földgömbre, és koppints egy pontra.');
    const groups = new Map();
    for (const c of cities) {
      if (!groups.has(c.cc)) groups.set(c.cc, []);
      groups.get(c.cc).push(c);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => countryName(a).localeCompare(countryName(b), 'hu'))
      .map(([cc, list]) => `<h3 class="group-title">${flag(cc)} ${esc(countryName(cc))}</h3><ul class="list">${list.sort((a, b) => a.name.localeCompare(b.name, 'hu')).map((c) => cityRow(c, { showCountry: false })).join('')}</ul>`)
      .join('');
  }
  if (homeTab === 'wish') {
    const groups = countryGroups(data, countryInfo, 'wish');
    const cities = markedCities(data, 'wish');
    if (!groups.length && !cities.length) return emptyState('⭐', 'Üres a bakancslista', 'Jelölj meg egy országot vagy várost a Bakancslista gombbal, és itt gyűlnek.');
    let html = '';
    if (cities.length) html += `<h3 class="group-title">Városok</h3><ul class="list">${cities.map((c) => cityRow(c)).join('')}</ul>`;
    for (const g of groups) html += `<h3 class="group-title">${esc(g.continent)}</h3><ul class="list">${g.rows.map((r) => countryRow(r, 'wish')).join('')}</ul>`;
    return html;
  }
  const groups = countryGroups(data, countryInfo, 'visited');
  if (!groups.length) return emptyState('🌍', 'Hol jártál már?', 'Koppints egy országra a földgömbön, vagy keress rá egy városra – például Chicago, Bécs, Japán.');
  return groups.map((g) => `<h3 class="group-title">${esc(g.continent)} · ${g.rows.length}</h3><ul class="list">${g.rows.map((r) => countryRow(r, 'visited')).join('')}</ul>`).join('');
}

function emptyState(icon, title, text) {
  return `<div class="empty"><div class="big">${icon}</div><b>${esc(title)}</b>${esc(text)}</div>`;
}

// Search ----------------------------------------------------------------------

let online = { query: '', state: 'idle', results: [] };
let onlineTimer = 0;
let onlineAbort = null;

function openSearch(scope = null) {
  stopSpin();
  push({ mode: 'search', scope, query: '' }, 'full');
  const input = byId('search-input');
  input.focus();
}

function renderSearch(view, head, body) {
  const scope = view.scope ? `<div class="scope">Csak itt: ${flag(view.scope)} ${esc(countryName(view.scope))}<button type="button" data-act="unscope" aria-label="Keresés mindenhol">${ICONS.close}</button></div>` : '';
  head.innerHTML = `${backHead(`<label class="search">${ICONS.search}<input id="search-input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${view.scope ? 'Város keresése…' : 'Város vagy ország…'}" value="${esc(view.query)}" aria-label="Keresés"></label>`)}${scope}`;
  const input = byId('search-input');
  input.addEventListener('input', () => {
    view.query = input.value;
    renderResults();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      body.querySelector('.row')?.click();
    }
  });
  renderResults();
}

function renderResults() {
  const view = current();
  const body = byId('sheet-body');
  const q = view.query.trim();
  if (!index) {
    body.innerHTML = '<div class="online-status"><span class="spinner"></span>A városok betöltése…</div>';
    return;
  }
  if (!q) {
    if (view.scope) {
      const top = [];
      for (let i = 0; i < index.rows.length && top.length < 25; i += 1) if (index.rows[i][2] === view.scope) top.push(cityAt(index, i));
      body.innerHTML = `<h3 class="group-title">Legnagyobb városok</h3><ul class="list">${top.map((c) => cityRow(c, { showCountry: false })).join('')}</ul>`;
    } else {
      body.innerHTML = `<div class="hint">${ICONS.info}<span>Írj be egy várost vagy országot. Magyar nevekkel is megy: Bécs, Kolozsvár, Egyesült Államok. Ha egy kis falu nincs a listában, rákereshetsz a teljes térképen is.</span></div>`;
    }
    return;
  }
  const { countries, cities } = search(index, q, { cc: view.scope, limit: 30 });
  let html = '';
  if (countries.length) {
    html += `<h3 class="group-title">Országok</h3><ul class="list">${countries.map((c) => {
      const status = countryStatus(data, c.id);
      return `<li><button type="button" class="row" data-country="${c.id}"><span class="row-flag">${flag(c.id)}</span><span class="row-main"><span class="row-title">${mark(c.n, q)}</span><span class="row-sub">${esc(c.c)}</span></span><span class="row-end">${status ? `<i class="dot ${status}"></i>` : ''}${ICONS.chev}</span></button></li>`;
    }).join('')}</ul>`;
  }
  if (cities.length) {
    html += `<h3 class="group-title">Városok</h3><ul class="list">${cities.map((c) => cityRow(c, { highlight: q, showCountry: !view.scope })).join('')}</ul>`;
  }
  if (!countries.length && !cities.length) html += '<div class="empty"><b>Nincs találat a beépített listában</b>A kisebb helyeket a teljes térképen keresheted.</div>';
  html += onlineBlock(q, view.scope);
  body.innerHTML = html;
  if (!countries.length && !cities.length) queueOnline(q, view.scope);
}

function onlineBlock(q, scope) {
  const key = `${scope ?? ''}|${q}`;
  if (online.query !== key || online.state === 'idle') {
    return `<button type="button" class="add-city" data-act="online"><span class="row-icon">${ICONS.globe}</span>Keresés a teljes térképen: „${esc(q)}”</button>`;
  }
  if (online.state === 'loading') return '<div class="online-status"><span class="spinner"></span>Keresés a térképen…</div>';
  if (online.state === 'error') return '<div class="online-status">A teljes térképes kereséshez internet kell.</div>';
  const seen = new Set();
  const list = online.results.filter((c) => {
    const id = `${c.name}|${c.cc}|${c.sub ?? ''}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (!list.length) return '<div class="online-status">A térképen sincs ilyen hely. Tartsd hosszan nyomva a földgömböt, és add hozzá kézzel.</div>';
  return `<h3 class="group-title">A teljes térképről</h3><ul class="list">${list.map((c) => cityRow(c)).join('')}</ul>`;
}

function queueOnline(q, scope) {
  clearTimeout(onlineTimer);
  onlineTimer = setTimeout(() => runOnline(q, scope), 450);
}

async function runOnline(q, scope) {
  const key = `${scope ?? ''}|${q}`;
  if (online.query === key && online.state !== 'idle') return;
  onlineAbort?.abort();
  onlineAbort = new AbortController();
  online = { query: key, state: 'loading', results: [] };
  if (current().mode === 'search') renderResults();
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '15');
    url.searchParams.set('osm_tag', 'place');
    const res = await fetch(url, { signal: onlineAbort.signal });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const results = [];
    for (const f of json.features ?? []) {
      const p = f.properties ?? {};
      const cc = (p.countrycode ?? '').toUpperCase();
      if (!p.name || !/^[A-Z]{2}$/.test(cc) || (scope && cc !== scope)) continue;
      if (!['city', 'town', 'village', 'hamlet', 'suburb', 'locality', 'island', 'municipality', 'quarter', 'neighbourhood', 'borough', 'isolated_dwelling'].includes(p.osm_value)) continue;
      const [lon, lat] = f.geometry.coordinates;
      const city = { key: `o${(p.osm_type ?? 'X')[0]}${p.osm_id}`, name: p.name, cc, lon: Math.round(lon * 1000) / 1000, lat: Math.round(lat * 1000) / 1000 };
      if (cc === 'US' && p.state) city.sub = p.state;
      results.push(city);
    }
    online = { query: key, state: 'done', results };
  } catch (err) {
    if (err.name === 'AbortError') return;
    online = { query: key, state: 'error', results: [] };
  }
  if (current().mode === 'search') renderResults();
}

/** Cities opened before, so going back to one finds it again. */
const shownCities = new Map();

function findCity(key) {
  if (data.cities[key]) return { key, ...data.cities[key] };
  if (shownCities.has(key)) return shownCities.get(key);
  if (key.startsWith('g') && index) {
    const id = Number(key.slice(1));
    const i = index.rows.findIndex((r) => r[0] === id);
    if (i >= 0) return cityAt(index, i);
  }
  return online.results.find((c) => c.key === key) ?? null;
}

// Country ----------------------------------------------------------------------

function openCountry(id, { fly = true } = {}) {
  stopSpin();
  push({ mode: 'country', id }, 'half');
  setSelection({ country: id });
  if (fly) flyToCountry(id);
}

function markButtons(status) {
  return `<div class="marks">
    <button type="button" class="mark-btn visited" data-mark="visited" aria-pressed="${status === 'visited'}">${ICONS.check}Voltam itt</button>
    <button type="button" class="mark-btn wish" data-mark="wish" aria-pressed="${status === 'wish'}">${ICONS.star}Bakancslista</button>
  </div>`;
}

function renderCountry(view, head, body) {
  const id = view.id;
  const info = countryInfo[id];
  const status = countryStatus(data, id);
  const cities = citiesIn(data, id);
  head.innerHTML = backHead(`<div class="detail-head"><span class="detail-flag">${flag(id)}</span><div class="detail-title"><h2>${esc(countryName(id))}</h2><p>${esc(info?.c ?? '')}</p></div></div>`);
  let html = markButtons(status);
  const own = data.countries[id]?.status ?? null;
  if (status === 'visited' && own !== 'visited') html += '<p class="mark-note">A megjelölt városaid miatt számít meglátogatottnak.</p>';
  if (cities.length) html += `<h3 class="group-title">Városaid itt · ${cities.length}</h3><ul class="list">${cities.map((c) => cityRow(c, { showCountry: false })).join('')}</ul>`;
  html += `<button type="button" class="add-city" data-act="add-city"><span class="row-icon">${ICONS.plus}</span>Város hozzáadása</button>`;
  html += `<div class="hint">${ICONS.info}<span>Nagyíts rá a térképre, és koppints egy pontra a városok közül. Ha valami hiányzik, tartsd hosszan nyomva a helyét.</span></div>`;
  body.innerHTML = html;
}

function markCountry(id, status) {
  const now = countryStatus(data, id);
  const name = countryName(id);
  if (now === status) {
    // Tapping the active button clears it.
    const cities = citiesIn(data, id);
    if (cities.length && !confirm(`${name} összes jelölt városát is törlöd? (${cities.map((c) => c.name).join(', ')})`)) return;
    commit(clearCountry(data, id), `${name} jelölése törölve`);
    return;
  }
  if (status === 'wish') {
    // Moving a visited country to the bucket list only makes sense without visited cities.
    const visitedHere = citiesIn(data, id).filter((c) => c.status === 'visited');
    if (visitedHere.length) {
      toast(`Előbb vedd le a meglátogatott városokat (${visitedHere.map((c) => c.name).join(', ')}).`);
      return;
    }
  }
  commit(setCountry(data, id, status), status === 'visited' ? `${flag(id)} ${name}: jártál itt` : `${flag(id)} ${name} a bakancslistán`, { tone: status });
}

// City -------------------------------------------------------------------------

function openCity(city, { fly = true } = {}) {
  stopSpin();
  shownCities.set(city.key, city);
  push({ mode: 'city', city }, 'peek');
  setSelection({ country: city.cc, cityKey: city.key, lngLat: [city.lon, city.lat] });
  if (fly) flyToCity(city);
}

function renderCity(view, head, body) {
  const city = data.cities[view.city.key] ? { key: view.city.key, ...data.cities[view.city.key], local: view.city.local } : view.city;
  const status = data.cities[city.key]?.status ?? null;
  const sub = [city.cc === 'US' && city.sub ? city.sub : null, city.local].filter(Boolean).join(' · ');
  head.innerHTML = backHead(`<div class="detail-head"><div class="detail-title"><h2>${esc(city.name)}</h2><p><button type="button" data-country="${city.cc}">${flag(city.cc)} ${esc(countryName(city.cc))}</button>${sub ? ` · ${esc(sub)}` : ''}</p></div></div>`);
  let html = markButtons(status);
  const facts = [];
  if (city.pop) facts.push(formatPopulation(city.pop));
  facts.push(`${Math.abs(city.lat).toFixed(2)}° ${city.lat >= 0 ? 'É' : 'D'}, ${Math.abs(city.lon).toFixed(2)}° ${city.lon >= 0 ? 'K' : 'Ny'}`);
  html += `<p class="mark-note">${esc(facts.join(' · '))}</p>`;
  if (status) html += `<button type="button" class="btn remove-btn" data-act="remove-city">Jelölés törlése</button>`;
  body.innerHTML = html;
}

function markCity(city, status) {
  const now = data.cities[city.key]?.status ?? null;
  if (now === status) {
    commit(setCity(data, city, null), `${city.name} jelölése törölve`);
    return;
  }
  commit(setCity(data, city, status), status === 'visited' ? `${city.name}: jártál itt` : `${city.name} a bakancslistán`, { tone: status });
}

// New place (long press) -------------------------------------------------------------

let lastLongPress = 0;

function openNewPlace(lngLat, point) {
  // Android fires both the long-press timer and a contextmenu event.
  if (performance.now() - lastLongPress < 800) return;
  lastLongPress = performance.now();
  stopSpin();
  navigator.vibrate?.(20);
  const country = map.queryRenderedFeatures(point, { layers: ['land'] })[0]?.properties.id ?? null;
  if (!country) {
    toast('Ide nem tudsz helyet tenni – a tengeren vagy.');
    return;
  }
  const near = cityDotAt(point);
  push({ mode: 'place', lngLat: { lon: Math.round(lngLat.lng * 1000) / 1000, lat: Math.round(lngLat.lat * 1000) / 1000 }, cc: country, name: near?.name ?? '' }, 'half');
  setSelection({ country, lngLat: [lngLat.lng, lngLat.lat] });
}

function renderPlace(view, head, body) {
  head.innerHTML = backHead(`<div class="detail-head"><span class="detail-flag">${flag(view.cc)}</span><div class="detail-title"><h2>Új hely</h2><p>${esc(countryName(view.cc))}</p></div></div>`);
  body.innerHTML = `
    <label class="field"><span>Hogy hívják?</span><input id="place-name" maxlength="80" autocomplete="off" placeholder="Pl. Tihany" value="${esc(view.name)}"></label>
    <div class="marks">
      <button type="button" class="mark-btn visited" data-place="visited" aria-pressed="false">${ICONS.check}Voltam itt</button>
      <button type="button" class="mark-btn wish" data-place="wish" aria-pressed="false">${ICONS.star}Bakancslista</button>
    </div>`;
  const input = byId('place-name');
  input.addEventListener('input', () => { view.name = input.value; });
}

function savePlace(status) {
  const view = current();
  const name = byId('place-name').value.trim();
  if (!name) {
    byId('place-name').focus();
    toast('Adj nevet a helynek.');
    return;
  }
  const city = { key: `u${Date.now().toString(36)}`, name, cc: view.cc, lon: view.lngLat.lon, lat: view.lngLat.lat };
  commit(setCity(data, city, status), status === 'visited' ? `${name}: jártál itt` : `${name} a bakancslistán`, { tone: status });
  stack[stack.length - 1] = { mode: 'city', city };
  render();
  setSnap('peek');
  setSelection({ country: city.cc, cityKey: city.key, lngLat: [city.lon, city.lat] });
}

// --- Taps inside the sheet -----------------------------------------------------------

function setupSheetClicks() {
  byId('sheet').addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    const view = current();
    if (el.dataset.act === 'search') return openSearch();
    if (el.dataset.act === 'install') return promptInstall();
    if (el.dataset.act === 'install-close') {
      try { localStorage.setItem('travel-install-dismissed', '1'); } catch { /* fine */ }
      return render();
    }
    if (el.dataset.act === 'back') return back();
    if (el.dataset.act === 'unscope') { view.scope = null; render(); byId('search-input').focus(); return; }
    if (el.dataset.act === 'online') { const q = view.query.trim(); online = { query: '', state: 'idle', results: [] }; runOnline(q, view.scope); return; }
    if (el.dataset.act === 'add-city') return openSearch(view.id);
    if (el.dataset.act === 'remove-city') { markCity(view.city, data.cities[view.city.key].status); return; }
    if (el.dataset.tab) {
      homeTab = el.dataset.tab;
      render();
      if (snap === 'peek') setSnap('half');
      return;
    }
    if (el.dataset.country) {
      document.activeElement?.blur?.();
      return openCountry(el.dataset.country);
    }
    if (el.dataset.city) {
      const city = findCity(el.dataset.city);
      document.activeElement?.blur?.();
      if (city) openCity(city);
      return;
    }
    if (el.dataset.mark && view.mode === 'country') return markCountry(view.id, el.dataset.mark);
    if (el.dataset.mark && view.mode === 'city') return markCity(view.city, el.dataset.mark);
    if (el.dataset.place) return savePlace(el.dataset.place);
  });
}

// --- Settings ----------------------------------------------------------------------

function setupSettings() {
  const dialog = byId('settings');
  byId('menu-btn').addEventListener('click', () => dialog.showModal());
  byId('hud-stats').addEventListener('click', () => {
    goHome();
    homeTab = 'visited';
    render();
    setSnap('half');
  });
  byId('globe-btn').addEventListener('click', () => {
    goHome();
    setSnap('peek');
    flyToWorld();
  });

  byId('export-btn').addEventListener('click', async () => {
    const text = JSON.stringify({ app: 'merre-jartam', exported: new Date().toISOString(), ...data }, null, 1);
    const name = `merre-jartam-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Merre jártam – mentés' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  byId('import-btn').addEventListener('click', () => byId('import-file').click());
  byId('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = normalizeData(JSON.parse(await file.text()));
      const n = Object.keys(next.countries).length + Object.keys(next.cities).length;
      if (!confirm(`Visszaállítod a mentést? ${n} jelölés lesz benne, a mostaniak helyett.`)) return;
      dialog.close();
      commit(restoreData(data, next), 'Mentés visszaállítva');
    } catch (err) {
      toast(err.message.startsWith('Ez nem') ? err.message : 'Ezt a fájlt nem sikerült beolvasni.');
    }
  });
  byId('reset-btn').addEventListener('click', () => {
    if (!confirm('Biztosan törlöd az összes jelölést?')) return;
    dialog.close();
    commit(restoreData(data, emptyData()), 'Minden jelölés törölve');
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  if (isStandalone()) byId('install-section').hidden = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    byId('install-btn').hidden = false;
    byId('install-text').textContent = 'Telepítsd, és saját ikonnal, külön ablakban, internet nélkül is megnyílik – telefonon és gépen is.';
    if (current().mode === 'home') render();
  });
  byId('install-btn').addEventListener('click', promptInstall);
  window.addEventListener('appinstalled', () => {
    byId('install-section').hidden = true;
    installPrompt = null;
    if (current().mode === 'home') render();
  });
  setupSyncForm();
}

// --- Updates ----------------------------------------------------------------------

let updateTimer = 0;
function offerUpdate() {
  clearTimeout(updateTimer);
  // Files update one by one, so wait a moment and a reload gets all of them.
  updateTimer = setTimeout(() => { byId('update').hidden = false; }, 1500);
}
byId('update-btn').addEventListener('click', () => location.reload());
byId('update-close').addEventListener('click', () => { byId('update').hidden = true; });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Without a worker the app still works; it just needs a connection.
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'updated') offerUpdate();
  });
}

// --- Start ---------------------------------------------------------------------------

/** Bounding box of a country's biggest piece, so the US fits without Alaska's tail. */
function mainBbox(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = null;
  for (const poly of polys) {
    let w = 180; let s = 90; let e = -180; let n = -90;
    for (const [x, y] of poly[0]) {
      if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
    }
    const area = (e - w) * (n - s);
    if (!best || area > best.area) best = { area, bbox: [w, s, e, n] };
  }
  return best;
}

async function start() {
  setupSheetDrag();
  setupSheetClicks();
  setupSettings();
  render();
  renderHud();
  setSnap('peek');

  const getJson = (path) => fetch(path).then((r) => {
    if (!r.ok) throw new Error(path);
    return r.json();
  });
  let countries; let regions;
  try {
    [countries, regions] = await Promise.all([getJson('data/countries.json'), getJson('data/regions.json')]);
  } catch {
    byId('loading').querySelector('p').textContent = 'Nem sikerült betölteni a térképet. Ellenőrizd a netet, és töltsd újra.';
    return;
  }

  const best = {};
  for (const f of countries.features) {
    const p = f.properties;
    const box = mainBbox(f.geometry);
    if (!best[p.id] || box.area > best[p.id].area) {
      best[p.id] = box;
      countryInfo[p.id] = { n: p.n, en: p.en, c: p.c, lx: p.lx, ly: p.ly, bbox: box.bbox };
    }
  }
  render();
  renderHud();

  if (typeof maplibregl === 'undefined') {
    byId('loading').querySelector('p').textContent = 'A térkép nem indult el ezen a böngészőn.';
    return;
  }
  initMap(countries, regions);

  try {
    const rows = await getJson('data/cities.json');
    const list = Object.entries(countryInfo).map(([id, c]) => ({ id, n: c.n, en: c.en, c: c.c }));
    index = buildIndex(list, rows, ALIASES);
    loadCityDots();
    if (current().mode === 'search') renderResults();
  } catch {
    toast('A városlista nem töltődött be. A keresés a teljes térképen így is megy.');
  }
}

window.addEventListener('resize', () => {
  setSnap(snap);
  fitDesktop();
});

// Keyboard on a computer: / searches, Escape goes back.
document.addEventListener('keydown', (e) => {
  if (byId('settings').open) return;
  const typing = e.target.closest?.('input, textarea');
  if (e.key === '/' && !typing) {
    e.preventDefault();
    if (current().mode === 'search') byId('search-input').focus();
    else openSearch();
  } else if (e.key === 'Escape') {
    if (typing) e.target.blur();
    if (stack.length > 1) back();
  }
});

start();
sync.start();
