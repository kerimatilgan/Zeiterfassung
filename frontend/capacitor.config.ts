import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'de.handyinsel.zeiterfassung',
  appName: 'Zeiterfassung',
  // Vite-Build-Output dient als Web-Asset-Verzeichnis
  webDir: 'dist',
  android: {
    // Erlaubt Cleartext-Traffic im Dev-Modus für lokale Backend-Tests
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // Backend-URL wird zur Laufzeit aus LocalStorage gelesen — siehe lib/serverConfig.ts.
    // Hier KEIN url-Eintrag, sonst lädt die App das Frontend remote statt der lokal gepackten dist/.
  },
};

export default config;
