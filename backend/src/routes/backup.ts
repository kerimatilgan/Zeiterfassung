import { Router, Response, Request } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../index.js';
import { createAuditLog } from '../utils/auditLog.js';
import {
  runBackup,
  cleanupOldBackups,
  testTarget,
  testProviderConfig,
  getBackupStatus,
  encryptConfig,
  decryptConfig,
} from '../services/backup/index.js';
import { reloadBackupScheduler } from '../services/backup/scheduler.js';

const router = Router();
const BACKUP_DIR = '/opt/Zeiterfassung/backups';

// ==================== OAUTH FLOWS ====================

// Temporärer Token-Store (state → { provider, tokens, expiresAt })
const oauthPending = new Map<string, { provider: string; clientId: string; clientSecret: string; tenantId?: string; redirectUri: string; expiresAt: number }>();
const oauthResults = new Map<string, { tokens: any; expiresAt: number }>();

// Cleanup alte Einträge alle 5 Minuten
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthPending) { if (val.expiresAt < now) oauthPending.delete(key); }
  for (const [key, val] of oauthResults) { if (val.expiresAt < now) oauthResults.delete(key); }
}, 300000);

// OAuth starten - Frontend sendet clientId/clientSecret, Backend generiert Auth-URL
router.post('/oauth/start', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { provider, clientId, clientSecret, tenantId } = req.body;
    if (!provider || !clientId || !clientSecret) {
      return res.status(400).json({ error: 'Provider, Client ID und Client Secret erforderlich' });
    }

    const state = crypto.randomBytes(32).toString('hex');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/api/backup/oauth/${provider}/callback`;

    oauthPending.set(state, {
      provider, clientId, clientSecret, tenantId,
      redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 Minuten
    });

    let authUrl: string;

    switch (provider) {
      case 'onedrive': {
        const tenant = tenantId || 'common';
        const scopes = encodeURIComponent('Files.ReadWrite.All offline_access User.Read');
        authUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}&response_mode=query`;
        break;
      }
      case 'gdrive': {
        const scopes = encodeURIComponent('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email');
        authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}&access_type=offline&prompt=consent`;
        break;
      }
      case 'dropbox': {
        authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&token_access_type=offline`;
        break;
      }
      default:
        return res.status(400).json({ error: `OAuth nicht unterstützt für Provider: ${provider}` });
    }

    res.json({ authUrl, state });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// OAuth Callback - von Provider aufgerufen (kein Auth-Header, daher öffentlich)
router.get('/oauth/:provider/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError || !code || !state) {
    return res.send(renderOAuthResult({ error: (oauthError as string) || 'Autorisierung fehlgeschlagen' }));
  }

  const pending = oauthPending.get(state as string);
  if (!pending) {
    return res.send(renderOAuthResult({ error: 'Ungültiger oder abgelaufener State-Parameter' }));
  }
  oauthPending.delete(state as string);

  try {
    let tokens: any;

    switch (pending.provider) {
      case 'onedrive': {
        const tenant = pending.tenantId || 'common';
        const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: pending.clientId,
            client_secret: pending.clientSecret,
            code: code as string,
            redirect_uri: pending.redirectUri,
            grant_type: 'authorization_code',
            scope: 'Files.ReadWrite.All offline_access User.Read',
          }),
        });
        const data: any = await tokenRes.json();
        if (data.error) throw new Error(data.error_description || data.error);
        tokens = { refreshToken: data.refresh_token, accessToken: data.access_token };
        break;
      }
      case 'gdrive': {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: pending.clientId,
            client_secret: pending.clientSecret,
            code: code as string,
            redirect_uri: pending.redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        const data: any = await tokenRes.json();
        if (data.error) throw new Error(data.error_description || data.error);
        tokens = { refreshToken: data.refresh_token };
        break;
      }
      case 'dropbox': {
        const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: pending.clientId,
            client_secret: pending.clientSecret,
            code: code as string,
            redirect_uri: pending.redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        const data: any = await tokenRes.json();
        if (data.error) throw new Error(data.error_description || data.error);
        tokens = { accessToken: data.access_token, refreshToken: data.refresh_token };
        break;
      }
    }

    // Store result for frontend polling
    oauthResults.set(state as string, { tokens, expiresAt: Date.now() + 5 * 60 * 1000 });

    res.send(renderOAuthResult({ success: true, state: state as string }));
  } catch (error: any) {
    res.send(renderOAuthResult({ error: error.message }));
  }
});

// OAuth Ergebnis abrufen (Frontend pollt nach Popup-Schließung)
router.get('/oauth/result/:state', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  const result = oauthResults.get(req.params.state);
  if (!result) return res.status(404).json({ error: 'Kein Ergebnis gefunden' });
  oauthResults.delete(req.params.state);
  res.json(result.tokens);
});

function renderOAuthResult(data: { success?: boolean; state?: string; error?: string }): string {
  const message = data.error
    ? `<p style="color: #dc2626;">Fehler: ${data.error}</p>`
    : `<p style="color: #16a34a;">Anmeldung erfolgreich! Dieses Fenster wird geschlossen...</p>`;

  return `<!DOCTYPE html>
<html><head><title>OAuth</title><style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f9fafb; }
.card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
</style></head><body>
<div class="card">
  <h2>${data.error ? 'Fehler' : 'Erfolgreich'}</h2>
  ${message}
</div>
<script>
  ${data.success ? `
    if (window.opener) {
      window.opener.postMessage({ type: 'oauth-success', state: '${data.state}' }, '*');
      setTimeout(() => window.close(), 1500);
    }
  ` : `
    setTimeout(() => window.close(), 5000);
  `}
</script>
</body></html>`;
}

// ==================== BACKUP-EINSTELLUNGEN ====================

// Backup-Einstellungen abrufen
router.get('/settings', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    res.json({
      backupFrequency: (settings as any)?.backupFrequency || 'daily',
      backupTime: (settings as any)?.backupTime || '02:00',
      backupWeekday: (settings as any)?.backupWeekday ?? 1,
      backupRetentionDays: (settings as any)?.backupRetentionDays ?? 30,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Backup-Einstellungen speichern
router.put('/settings', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { backupFrequency, backupTime, backupWeekday, backupRetentionDays } = req.body;
    await prisma.settings.update({
      where: { id: 'default' },
      data: {
        ...(backupFrequency !== undefined && { backupFrequency }),
        ...(backupTime !== undefined && { backupTime }),
        ...(backupWeekday !== undefined && { backupWeekday }),
        ...(backupRetentionDays !== undefined && { backupRetentionDays }),
      },
    });

    // Scheduler neu laden
    await reloadBackupScheduler();

    await createAuditLog({
      req: req as any,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'UPDATE',
      entityType: 'Settings',
      note: `Backup-Einstellungen geändert: ${backupFrequency}, ${backupTime}, Aufbewahrung: ${backupRetentionDays} Tage`,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BACKUP-ZIELE ====================

// Alle Backup-Ziele abrufen
router.get('/targets', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const targets = await prisma.backupTarget.findMany({
      orderBy: { createdAt: 'asc' },
    });
    // Config nicht im Klartext zurückgeben, nur Typ-Info
    const safeTargets = targets.map(t => ({
      ...t,
      config: undefined,
      hasConfig: !!t.config,
    }));
    res.json(safeTargets);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Einzelnes Backup-Ziel mit Config abrufen (für Edit-Formular)
router.get('/targets/:id/config', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const target = await prisma.backupTarget.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Nicht gefunden' });
    const config = decryptConfig(target.config);
    // Passwörter maskieren
    const safeConfig = { ...config };
    for (const key of ['password', 'secretAccessKey', 'clientSecret', 'privateKey']) {
      if (safeConfig[key]) safeConfig[key] = '••••••••';
    }
    res.json({ ...target, config: safeConfig, type: target.type });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Neues Backup-Ziel erstellen
router.post('/targets', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, config, isActive } = req.body;
    if (!name || !type || !config) {
      return res.status(400).json({ error: 'Name, Typ und Konfiguration erforderlich' });
    }
    const encrypted = encryptConfig(config);
    const target = await prisma.backupTarget.create({
      data: { name, type, config: encrypted, isActive: isActive !== false },
    });

    await createAuditLog({
      req: req as any,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'CREATE',
      entityType: 'BackupTarget',
      entityId: target.id,
      newValues: { name, type },
    });

    res.status(201).json({ ...target, config: undefined });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Backup-Ziel aktualisieren
router.put('/targets/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, config, isActive } = req.body;
    const existing = await prisma.backupTarget.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Nicht gefunden' });

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (type !== undefined) data.type = type;
    if (isActive !== undefined) data.isActive = isActive;
    if (config) {
      // Merge: if password fields are masked, keep old values
      const oldConfig = decryptConfig(existing.config);
      const mergedConfig = { ...config };
      for (const key of ['password', 'secretAccessKey', 'clientSecret', 'privateKey']) {
        if (mergedConfig[key] === '••••••••' || mergedConfig[key] === '') {
          mergedConfig[key] = oldConfig[key];
        }
      }
      data.config = encryptConfig(mergedConfig);
    }

    const updated = await prisma.backupTarget.update({ where: { id: req.params.id }, data });

    await createAuditLog({
      req: req as any,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'UPDATE',
      entityType: 'BackupTarget',
      entityId: updated.id,
      newValues: { name: updated.name, type: updated.type, isActive: updated.isActive },
    });

    res.json({ ...updated, config: undefined });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Backup-Ziel löschen
router.delete('/targets/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const target = await prisma.backupTarget.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'Nicht gefunden' });
    await prisma.backupTarget.delete({ where: { id: req.params.id } });

    await createAuditLog({
      req: req as any,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'DELETE',
      entityType: 'BackupTarget',
      entityId: target.id,
      oldValues: { name: target.name, type: target.type },
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Verbindung testen (gespeichertes Ziel)
router.post('/targets/:id/test', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await testTarget(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Verbindung testen (noch nicht gespeichert, Config direkt übergeben)
router.post('/test-config', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { type, config } = req.body;
    if (!type || !config) return res.status(400).json({ success: false, message: 'Typ und Config erforderlich' });
    const result = await testProviderConfig(type, config);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== BACKUP-OPERATIONEN ====================

// Manuelles Backup starten
router.post('/run', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const results = await runBackup('manual');

    await createAuditLog({
      req: req as any,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'CREATE',
      entityType: 'Backup',
      note: `Manuelles Backup: ${results.filter((r: any) => r?.status === 'success').length}/${results.length} erfolgreich`,
    });

    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Backup-Status
router.get('/status', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const status = getBackupStatus();
    const lastBackup = await prisma.backupRecord.findFirst({
      where: { status: 'success' },
      orderBy: { completedAt: 'desc' },
      include: { target: { select: { name: true, type: true } } },
    });
    const activeTargets = await prisma.backupTarget.count({ where: { isActive: true } });
    const totalTargets = await prisma.backupTarget.count();

    res.json({
      ...status,
      lastBackup: lastBackup ? {
        filename: lastBackup.filename,
        completedAt: lastBackup.completedAt,
        fileSize: lastBackup.fileSize,
        targetName: lastBackup.target?.name || 'Lokal',
      } : null,
      activeTargets,
      totalTargets,
      nextScheduled: '02:00 Uhr',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BACKUP-VERLAUF ====================

// History abrufen
router.get('/history', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const targetId = req.query.targetId as string;

    const where: any = {};
    if (targetId) where.targetId = targetId;

    const [records, total] = await Promise.all([
      prisma.backupRecord.findMany({
        where,
        include: { target: { select: { name: true, type: true } } },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.backupRecord.count({ where }),
    ]);

    res.json({ records, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Backup herunterladen
router.get('/download/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const record = await prisma.backupRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: 'Nicht gefunden' });

    const filePath = path.join(BACKUP_DIR, record.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup-Datei nicht gefunden' });
    }

    await createAuditLog({
      req: req as any,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'DOWNLOAD',
      entityType: 'Backup',
      entityId: record.id,
      note: `Backup heruntergeladen: ${record.filename}`,
    });

    res.download(filePath, record.filename);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Backup-Record löschen
router.delete('/history/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const record = await prisma.backupRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: 'Nicht gefunden' });

    // Local file löschen
    const filePath = path.join(BACKUP_DIR, record.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.backupRecord.delete({ where: { id: req.params.id } });

    await createAuditLog({
      req: req as any,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'DELETE',
      entityType: 'Backup',
      entityId: record.id,
      note: `Backup gelöscht: ${record.filename}`,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Alte Backups manuell bereinigen
router.post('/cleanup', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await cleanupOldBackups();
    res.json({ success: true, message: 'Alte Backups bereinigt' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
