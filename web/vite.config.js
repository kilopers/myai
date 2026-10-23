import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8000';
const appVersion = (() => {
  try {
    return readFileSync(fileURLToPath(new URL('../VERSION', import.meta.url)), 'utf8').trim();
  } catch {
    return 'dev';
  }
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
    },
  },
});
