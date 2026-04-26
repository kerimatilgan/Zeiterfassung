/**
 * Verwaltet die Backend-Server-URL.
 *
 * Im Browser (gleiche Domain wie Backend): default leer string → relative URLs (`/api/...`).
 * In Capacitor/Tauri-Apps: muss eine absolute URL sein, sonst kein Backend erreichbar.
 *
 * Der User kann die URL in den App-Einstellungen überschreiben (LocalStorage).
 */

const STORAGE_KEY = 'zeiterfassung.serverUrl';
const DEFAULT_PROD_URL = 'https://zeit.handy-insel.de';

// True wenn die App in einem nativen Wrapper (Capacitor / Tauri) läuft
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  // Capacitor setzt window.Capacitor; Tauri setzt window.__TAURI__
  return Boolean((window as any).Capacitor) || Boolean((window as any).__TAURI__);
}

// Gibt die konfigurierte Server-URL zurück (ohne trailing slash)
export function getServerUrl(): string {
  const stored = typeof window !== 'undefined' ? window.localStorage?.getItem(STORAGE_KEY) : null;
  if (stored && stored.trim()) {
    return stored.trim().replace(/\/+$/, '');
  }
  // Im Browser auf gleicher Domain: kein Prefix nötig (relative URL)
  if (!isNativeApp()) return '';
  // Native App ohne Override: Default verwenden
  return DEFAULT_PROD_URL;
}

export function setServerUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed) {
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function getDefaultServerUrl(): string {
  return DEFAULT_PROD_URL;
}

// Baut den vollen API-Pfad: bei nativen Apps z.B. "https://zeit.handy-insel.de/api"
export function getApiBaseUrl(): string {
  return `${getServerUrl()}/api`;
}

// Baut einen vollen URL-Pfad relativ zum Server (für /uploads/...)
export function getServerPath(path: string): string {
  const base = getServerUrl();
  if (!path.startsWith('/')) path = '/' + path;
  return `${base}${path}`;
}
