// Two pages: the landing page (index.html) and the mission console (sim.html). serve.py serves dist/ in production,
// plus /data/* and /api/analog; in dev, /data and /js come from the project root and /api is proxied to serve.py.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// dev and `vite preview`: /sim/* is the console (serve.py does the same in production)
const simRoutes = (s: { middlewares: { use(f: (req: { url?: string }, res: unknown, next: () => void) => void): void } }) => {
  s.middlewares.use((req, _res, next) => { if (/^\/sim(\/[a-z]*)?\/?(\?|$)/.test(req.url ?? '')) req.url = `/sim.html${req.url!.includes('?') ? req.url!.slice(req.url!.indexOf('?')) : ''}`; next(); });
};

export default defineConfig({
  plugins: [react(), tailwindcss(), { name: 'sim-routes', configureServer: simRoutes, configurePreviewServer: simRoutes }],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { rollupOptions: { input: { index: 'index.html', sim: 'sim.html' } } },
  server: { proxy: { '/api': 'http://127.0.0.1:8642' } },
});
