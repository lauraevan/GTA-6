import { defineConfig } from 'vite';

// base './' so the production build also works from file:// inside Electron.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8177',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
