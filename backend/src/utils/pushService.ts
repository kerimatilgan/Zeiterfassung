import webpush from 'web-push';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subj) {
    console.warn('⚠️  VAPID-Keys fehlen — Web-Push deaktiviert');
    return false;
  }
  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string; // Pfad oder absolute URL, der beim Klick geöffnet wird
  tag?: string; // Notif-Gruppe (gleiche Tags ersetzen einander)
}

/**
 * Sendet eine Web-Push-Notification an alle Subscriptions eines MA.
 * Best-effort — wirft nicht, sondern loggt nur.
 */
export async function sendPushToEmployee(employeeId: string, payload: PushPayload): Promise<void> {
  if (!configure()) return;

  const subs = await prisma.pushSubscription.findMany({ where: { employeeId } });
  if (subs.length === 0) return;

  const json = JSON.stringify(payload);
  const expiredEndpoints: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json,
        );
        // Erfolgreich → lastUsedAt aktualisieren
        prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => {});
      } catch (err: any) {
        // 404 oder 410 → Subscription wurde am Browser entfernt
        if (err.statusCode === 404 || err.statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
        } else {
          console.error('Push send failed:', err.message || err);
        }
      }
    }),
  );

  if (expiredEndpoints.length > 0) {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: { in: expiredEndpoints } },
    });
  }
}
