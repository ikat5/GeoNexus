// After `vite build`: render the landing page to HTML on the server side and put it into dist/index.html.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'vite';

const out = new URL('../.cache/ssr/', import.meta.url);
await build({ logLevel: 'warn', build: { ssr: 'src/landing/ssr.tsx', outDir: out.pathname, emptyOutDir: true, rollupOptions: { input: 'src/landing/ssr.tsx' } } });
const { render } = await import(new URL('ssr.js', out).href);
const file = new URL('../dist/index.html', import.meta.url), html = readFileSync(file, 'utf8');
if (!html.includes('<div id="root"></div>')) throw new Error('dist/index.html: empty #root not found');
const body = render();
writeFileSync(file, html.replace('<div id="root"></div>', `<div id="root">${body}</div>`));
rmSync(out, { recursive: true, force: true });
console.log(`prerendered dist/index.html (${(body.length / 1024).toFixed(1)} kB of markup)`);
