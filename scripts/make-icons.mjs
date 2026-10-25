// Draws the Workout Log app icons: the barbell from the masthead on a dark
// tile. The SVG is written as-is, and the PNG sizes phones need are rendered
// from it with the Chromium that Playwright drives.
//
// Playwright is not a dependency of this repo. It is pre-installed in Claude
// Code cloud sessions, which is where this is meant to run:
//
//   node scripts/make-icons.mjs
//
// The PNGs are committed, so nothing runs this at build or test time.

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const outDir = new URL('../workout/icons/', import.meta.url);
const COLORS = { tile: '#141c28', bar: '#aab4c4', red: '#e0545d', blue: '#6f8cf2' };

/**
 * The icon as SVG text. `rounded` gives the tile rounded corners for icons a
 * phone shows as-is. Maskable and Apple icons are square and shrink the
 * barbell (`scale`) so the launcher's own crop never clips it.
 */
function iconSvg({ rounded = true, scale = 1, size = 512 } = {}) {
  const shift = (256 - 256 * scale).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${COLORS.tile}"/>
  <g transform="translate(${shift} ${shift}) scale(${scale})">
    <rect x="48" y="242" width="416" height="28" rx="14" fill="${COLORS.bar}"/>
    <rect x="108" y="168" width="46" height="176" rx="10" fill="${COLORS.red}"/>
    <rect x="160" y="190" width="36" height="132" rx="8" fill="${COLORS.blue}"/>
    <rect x="316" y="190" width="36" height="132" rx="8" fill="${COLORS.blue}"/>
    <rect x="358" y="168" width="46" height="176" rx="10" fill="${COLORS.red}"/>
  </g>
</svg>
`;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return createRequire(import.meta.url)('playwright');
  }
}

async function renderPng(browser, svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  const png = await page.screenshot({ type: 'png', omitBackground: true });
  await page.close();
  return png;
}

const PNGS = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-512.png', 512, { rounded: false, scale: 0.8 }],
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.9 }],
];

await mkdir(outDir, { recursive: true });
await writeFile(new URL('icon.svg', outDir), iconSvg());
console.log('Wrote workout/icons/icon.svg');

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  for (const [name, size, options] of PNGS) {
    await writeFile(new URL(name, outDir), await renderPng(browser, iconSvg({ ...options, size }), size));
    console.log(`Wrote workout/icons/${name}`);
  }
} finally {
  await browser.close();
}
