import { pushApi } from './api';

const SW_PATH = '/sw.js';

export function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  // updateViaCache: 'none' — der Browser cached den SW selbst NICHT, immer frisch laden.
  return navigator.serviceWorker.register(SW_PATH, { updateViaCache: 'none' });
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Std = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Aktiviert Push-Notifications:
 * 1. Service Worker registrieren
 * 2. Permission anfragen falls noch nicht erteilt
 * 3. Subscription erstellen + an Backend senden
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) {
    return { ok: false, reason: 'Push wird vom Browser nicht unterstützt' };
  }

  const reg = await registerServiceWorker();

  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      return { ok: false, reason: 'Berechtigung abgelehnt' };
    }
  } else if (Notification.permission === 'denied') {
    return { ok: false, reason: 'Berechtigung wurde dauerhaft abgelehnt — bitte in den Browser-Einstellungen freigeben' };
  }

  // VAPID Public Key holen
  const { data } = await pushApi.getVapidPublicKey();
  const applicationServerKey = urlBase64ToUint8Array(data.publicKey);

  // Bestehende Subscription wiederverwenden, sonst neu erstellen
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // TS-Strict-Mode mag Uint8Array hier nicht direkt — applicationServerKey
      // erwartet BufferSource. Wir geben den ArrayBuffer-Slice rein.
      applicationServerKey: applicationServerKey.buffer.slice(
        applicationServerKey.byteOffset,
        applicationServerKey.byteOffset + applicationServerKey.byteLength,
      ) as ArrayBuffer,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'Subscription ungültig' };
  }

  await pushApi.subscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return { ok: true };
}

/**
 * Deaktiviert Push: Subscription am Browser entfernen + Backend informieren.
 */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await pushApi.unsubscribe(endpoint).catch(() => { /* still gone client-side */ });
}

/** Liefert true, wenn auf diesem Gerät bereits eine Subscription existiert. */
export async function hasActiveSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return Boolean(sub);
}
