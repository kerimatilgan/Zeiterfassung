import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5175,
    host: '0.0.0.0',
    allowedHosts: ['zeit.kerimatilgan.de'],
    proxy: {
      '/api': {
        target: mode === 'cloudflare'
          ? 'https://zeiterfassung-api.<your-subdomain>.workers.dev'
          : 'http://localhost:3004',
        changeOrigin: true,
      },
      '/uploads': {
        target: mode === 'cloudflare'
          ? 'https://zeiterfassung-api.<your-subdomain>.workers.dev'
          : 'http://localhost:3004',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3004',
        changeOrigin: true,
        ws: true,
      },
    },
  },
}));
