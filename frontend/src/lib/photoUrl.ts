import { useAuthStore } from '../store/authStore';

/**
 * Hängt den JWT-Token als Query-Parameter an Foto-URLs an.
 * Browser können bei <img src> keinen Authorization-Header senden, deshalb
 * akzeptiert der Backend-Foto-Endpoint alternativ ?token=<jwt>.
 */
export function photoSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const token = useAuthStore.getState().token;
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
