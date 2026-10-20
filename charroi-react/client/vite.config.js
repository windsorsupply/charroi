import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// En développement, l’API Node (port 3000) est jointe via le proxy de Vite.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:3000',
      '/files': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: { outDir: 'dist', target: 'es2020' },
});
