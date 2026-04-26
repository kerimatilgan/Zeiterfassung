import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.handyinsel.zeiterfassung',
  appName: 'Zeiterfassung',
  // dist/ wird als Bootstrap-Bundle gepackt (für Offline-Splash-Screen),
  // tatsächlich lädt die App das Frontend remote von server.url —
  // damit Origin = zeit.handy-insel.de und Passkeys funktionieren.
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    url: 'https://zeit.handy-insel.de',
    androidScheme: 'https',
    cleartext: false,
  },
};

export default config;
