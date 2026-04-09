import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3101',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3101',
        ws: true,
      },
    },
  },
});
