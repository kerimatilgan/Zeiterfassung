// OIDC/SSO-Helper (z.B. Authentik). Holt die Provider-Konfiguration aus den
// Settings (DB), führt OIDC-Discovery durch und cached die Configuration.
import * as oidc from 'openid-client';
import { prisma } from '../index.js';
import { decryptString } from './encryption.js';

// Basis-URL der öffentlichen Instanz — daraus leiten wir die Redirect-URI ab.
// FRONTEND_URL kann komma-getrennt sein; wir nehmen den ersten Eintrag.
export function getPublicBaseUrl(): string {
  return (process.env.FRONTEND_URL || '')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
}

export function getRedirectUri(): string {
  const base = getPublicBaseUrl();
  return base ? `${base}/api/auth/sso/callback` : '';
}

interface OidcSettings {
  oidcEnabled: boolean;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  oidcClientSecret: string | null; // encrypted
  oidcButtonLabel: string | null;
}

let _cache: { key: string; config: oidc.Configuration; ts: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export function clearOidcCache() {
  _cache = null;
}

async function loadOidcSettings(): Promise<OidcSettings | null> {
  const s = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: {
      oidcEnabled: true,
      oidcIssuer: true,
      oidcClientId: true,
      oidcClientSecret: true,
      oidcButtonLabel: true,
    },
  });
  return s ?? null;
}

export function isOidcConfigured(s: OidcSettings | null): s is OidcSettings {
  return !!s && s.oidcEnabled && !!s.oidcIssuer && !!s.oidcClientId && !!s.oidcClientSecret;
}

export async function getOidcPublicInfo(): Promise<{ enabled: boolean; buttonLabel: string }> {
  const s = await loadOidcSettings();
  return {
    enabled: isOidcConfigured(s) && !!getRedirectUri(),
    buttonLabel: (s?.oidcButtonLabel || '').trim() || 'Mit Authentik anmelden',
  };
}

// Liefert die einsatzbereite OIDC-Configuration (mit Discovery) oder wirft.
export async function getOidcConfig(): Promise<oidc.Configuration> {
  const s = await loadOidcSettings();
  if (!isOidcConfigured(s)) {
    throw new Error('SSO ist nicht konfiguriert.');
  }
  if (!getRedirectUri()) {
    throw new Error('FRONTEND_URL ist nicht gesetzt — Redirect-URI kann nicht gebildet werden.');
  }
  let clientSecret: string;
  try {
    clientSecret = decryptString(s.oidcClientSecret!);
  } catch {
    throw new Error('OIDC-Client-Secret konnte nicht entschlüsselt werden.');
  }
  const cacheKey = `${s.oidcIssuer}|${s.oidcClientId}|${clientSecret.length}`;
  if (_cache && _cache.key === cacheKey && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.config;
  }
  const config = await oidc.discovery(
    new URL(s.oidcIssuer!),
    s.oidcClientId!,
    clientSecret,
  );
  _cache = { key: cacheKey, config, ts: Date.now() };
  return config;
}

export { oidc };
