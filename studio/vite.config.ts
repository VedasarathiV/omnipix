import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset URLs so the bundle also runs from file:// inside Electron.
  base: './',
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/v1': 'http://127.0.0.1:3001',
    },
  },
});
