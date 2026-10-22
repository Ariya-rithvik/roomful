import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const server = process.env.RC_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@roomcaption/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
  },
  build: { target: 'es2020' },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': server,
      '/audio': server,
      '/ws': { target: server, ws: true },
    },
  },
});
