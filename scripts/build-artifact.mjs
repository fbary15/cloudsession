// Builds a copy of the puzzle page for publishing as a claude.ai artifact.
// The artifact host supplies its own <html>, <head> and <body>, so this strips
// those and inlines the stylesheet. The JavaScript files are published as-is.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [html, css] = await Promise.all([read('puzzle/index.html'), read('puzzle/style.css')]);

const wrapperTags = [
  /<!doctype html>\s*/i,
  /<html[^>]*>\s*/i,
  /<\/html>\s*/i,
  /<head>\s*/i,
  /<\/head>\s*/i,
  /<body[^>]*>\s*/i,
  /<\/body>\s*/i,
  /<meta charset[^>]*>\s*/i,
  /<meta name="viewport"[^>]*>\s*/i,
];
let page = wrapperTags.reduce((text, pattern) => text.replace(pattern, ''), html);

const stylesheetLink = '<link rel="stylesheet" href="style.css">';
if (!page.includes(stylesheetLink)) {
  throw new Error('puzzle/index.html no longer links style.css the expected way.');
}
page = page.replace(stylesheetLink, () => `<style>\n${css}</style>`);

await mkdir(new URL('dist/artifact/', root), { recursive: true });
await writeFile(new URL('dist/artifact/index.html', root), page);
console.log('Wrote dist/artifact/index.html');
