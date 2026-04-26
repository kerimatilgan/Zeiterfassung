import { useAuthStore } from '../store/authStore';
import { getServerPath, isNativeApp } from './serverConfig';

/**
 * Hängt den JWT-Token als Query-Parameter an Foto-URLs an und macht den Pfad
 * absolut, wenn die App in einem nativen Wrapper läuft.
 * Browser können bei <img src> keinen Authorization-Header senden, deshalb
 * akzeptiert der Backend-Foto-Endpoint alternativ ?token=<jwt>.
 */
export function photoSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;

  // In nativen Apps muss der Pfad absolut sein
  let fullUrl = url;
  if (isNativeApp() && url.startsWith('/')) {
    fullUrl = getServerPath(url);
  }

  const token = useAuthStore.getState().token;
  if (!token) return fullUrl;
  const sep = fullUrl.includes('?') ? '&' : '?';
  return `${fullUrl}${sep}token=${encodeURIComponent(token)}`;
}
