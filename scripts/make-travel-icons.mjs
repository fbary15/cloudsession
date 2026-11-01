// Draws the Merre jártam app icons: a night-blue globe with a coral pin on a
// dark tile. The SVG is written as-is and the PNG sizes phones need are
// rendered from it with the Chromium that Playwright drives (pre-installed in
// Claude Code cloud sessions, not a dependency of this repo):
//
//   node scripts/make-travel-icons.mjs
//
// The PNGs are committed, so nothing runs this at build or test time.

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const outDir = new URL('../travel/icons/', import.meta.url);

function iconSvg({ rounded = true, scale = 1, size = 512 } = {}) {
  const shift = (256 - 256 * scale).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs>
    <radialGradient id="g" cx="38%" cy="32%" r="75%">
      <stop offset="0" stop-color="#3a74e0"/>
      <stop offset=".55" stop-color="#173a7a"/>
      <stop offset="1" stop-color="#0a1830"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset=".78" stop-color="#4f8cff" stop-opacity=".45"/>
      <stop offset="1" stop-color="#4f8cff" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="c"><circle cx="246" cy="276" r="150"/></clipPath>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="#05070d"/>
  <g transform="translate(${shift} ${shift}) scale(${scale})">
    <circle cx="246" cy="276" r="176" fill="url(#glow)"/>
    <circle cx="246" cy="276" r="150" fill="url(#g)"/>
    <g clip-path="url(#c)" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="5">
      <ellipse cx="246" cy="276" rx="60" ry="150"/>
      <ellipse cx="246" cy="276" rx="118" ry="150"/>
      <path d="M96 276h300M110 206h272M110 346h272"/>
    </g>
    <path d="M216 230c22-14 52-12 66 6 10 14-2 30 14 42 18 14 10 40-12 46-20 6-30-10-48-10-22 0-36-18-30-40 4-16-8-30 10-44z" fill="#ff7a59"/>
    <g transform="translate(330 96)">
      <path d="M48 0C21.5 0 0 21 0 47c0 35 48 87 48 87s48-52 48-87C96 21 74.5 0 48 0z" fill="#ff7a59"/>
      <circle cx="48" cy="46" r="18" fill="#05070d"/>
    </g>
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
console.log('Wrote travel/icons/icon.svg');

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  for (const [name, size, options] of PNGS) {
    await writeFile(new URL(name, outDir), await renderPng(browser, iconSvg({ ...options, size }), size));
    console.log(`Wrote travel/icons/${name}`);
  }
} finally {
  await browser.close();
}
