import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8000';
const wsTarget = process.env.VITE_WS_TARGET || 'ws://localhost:8080';
const appVersion = (() => {
  for (const p of ['../VERSION', './VERSION']) {
    try {
      return readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').trim();
    } catch { /* следующий кандидат */ }
  }
  return 'dev';
})();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/i': { target: apiTarget, changeOrigin: true },
      // Reverb WebSocket (php artisan reverb:start, порт 8080)
      '/app': { target: wsTarget, ws: true, changeOrigin: true },
    },
  },
});
