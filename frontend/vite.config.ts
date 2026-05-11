import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    host: '0.0.0.0',
    allowedHosts: ['zeit.kerimatilgan.de'],
    // Infra-/Geheimnis-Dateien NICHT über den Dev-Server ausliefern. Sonst
    // versucht Vite z.B. ein versehentlich angefragtes /Dockerfile durch die
    // JS-Transform-Pipeline zu jagen → "invalid JS syntax"-Fehler-Overlay.
    fs: {
      deny: ['.env', '.env.*', '**/.env', '**/.env.*', '*.{crt,pem,key}', 'Dockerfile', '.dockerignore', 'docker-compose*.yml'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3004',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
