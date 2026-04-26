import { Router, Response } from 'express';
import { prisma } from '../index.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { getVapidPublicKey } from '../utils/pushService.js';

const router = Router();

// Public-Key für die Subscribe-Anfrage des Browsers
router.get('/vapid-public-key', (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ error: 'Push nicht konfiguriert' });
  res.json({ publicKey: key });
});

// Subscription speichern (vom Service Worker registriert)
router.post('/subscribe', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      endpoint: z.string().url(),
      keys: z.object({
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      }),
    });
    const { endpoint, keys } = schema.parse(req.body);

    // Upsert: gleicher Endpoint → aktualisieren (z.B. Nutzer wechselt das Gerät)
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        employeeId: req.employee!.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: req.headers['user-agent'] || null,
      },
      update: {
        employeeId: req.employee!.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        lastUsedAt: new Date(),
      },
    });

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Push subscribe error:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Subscription' });
  }
});

// Subscription entfernen (User dreht Notifs ab)
router.post('/unsubscribe', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({ endpoint: z.string().url() });
    const { endpoint } = schema.parse(req.body);
    await prisma.pushSubscription.deleteMany({
      where: { endpoint, employeeId: req.employee!.id },
    });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Push unsubscribe error:', error);
    res.status(500).json({ error: 'Fehler beim Entfernen der Subscription' });
  }
});

export default router;
