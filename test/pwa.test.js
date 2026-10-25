// Checks that the Workout Log stays installable and works offline: the
// manifest, its icons, and the list of files the service worker caches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { EXERCISES, exerciseImages } from '../workout/exercises.js';

const root = new URL('../workout/', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const exists = (path) => access(new URL(path, root)).then(() => true, () => false);

/** "WxH" from a PNG's header. */
function pngSize(buffer) {
  assert.equal(buffer.toString('latin1', 1, 4), 'PNG');
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

function shellList(sw) {
  const match = sw.match(/const SHELL = \[([^\]]*)\]/);
  assert.ok(match, 'sw.js lists the files to cache in SHELL');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('the manifest is complete and every icon exists at its stated size', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Workout Log');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png'), 'a 512px PNG for splash screens');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon for Android');
  for (const icon of manifest.icons) {
    assert.ok(await exists(icon.src), `${icon.src} exists`);
    if (icon.type === 'image/png') {
      assert.equal(pngSize(await readFile(new URL(icon.src, root))), icon.sizes, `${icon.src} is ${icon.sizes}`);
    }
  }
});

test('the service worker caches every file the app loads', async () => {
  const shell = shellList(await read('sw.js'));
  assert.ok(shell.includes('./') && shell.includes('./index.html'), 'the page is cached under both names');
  for (const path of shell) {
    assert.ok(await exists(path === './' ? 'index.html' : path), `${path} exists`);
  }

  const html = await read('index.html');
  const pageRefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((url) => !/^(?:https?:)?\/\//.test(url));
  const imports = [...(await read('app.js')).matchAll(/from '\.\/([^']+)'/g)].map((m) => `./${m[1]}`);
  const icons = JSON.parse(await read('manifest.webmanifest')).icons.map((i) => i.src);
  const pictures = EXERCISES.flatMap(exerciseImages);
  for (const picture of pictures) assert.ok(await exists(picture), `${picture} exists`);
  for (const ref of [...pageRefs, ...imports, ...icons, ...pictures]) {
    const path = ref.startsWith('./') ? ref : `./${ref}`;
    assert.ok(shell.includes(path), `${ref} is in the cache list`);
  }
});

test('the page declares the manifest, icons and the service worker', async () => {
  const html = await read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="theme-color"/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(await read('app.js'), /serviceWorker\.register\('\.\/sw\.js'\)/);
});
