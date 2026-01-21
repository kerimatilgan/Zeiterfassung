import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['clock.svg'],
      manifest: {
        name: 'Handy-Insel Zeiterfassung Terminal',
        short_name: 'Stempeluhr',
        description: 'QR-Code basierte Zeiterfassung',
        theme_color: '#2563eb',
        background_color: '#1e3a8a',
        display: 'fullscreen',
        orientation: 'portrait',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5176,
    host: '0.0.0.0',
    allowedHosts: ['terminal.zeit.kerimatilgan.de'],
    proxy: {
      '/api': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
    },
  },
});
