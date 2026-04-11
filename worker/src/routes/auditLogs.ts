import { Hono } from 'hono';
import type { Env, Variables } from '../bindings.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function formatAction(action: string): string {
  const map: Record<string, string> = {
    LOGIN: 'Anmeldung', LOGOUT: 'Abmeldung', LOGIN_FAILED: 'Fehlgeschlagene Anmeldung',
    CLOCK_IN: 'Einstempeln', CLOCK_OUT: 'Ausstempeln', CREATE: 'Erstellt',
    UPDATE: 'Bearbeitet', DELETE: 'Gelöscht', FINALIZE: 'Abgeschlossen',
    PASSWORD_CHANGE: 'Passwort geändert', DB_BACKUP: 'Datenbank-Backup',
    COMPLAINT_CREATE: 'Reklamation erstellt', COMPLAINT_RESOLVE: 'Reklamation gelöst',
    PASSWORD_RESET_REQUESTED: 'Passwort-Reset angefordert', PASSWORD_RESET: 'Passwort zurückgesetzt',
    ADMIN_PASSWORD_RESET: 'Admin Passwort-Reset', UPLOAD: 'Hochgeladen', DOWNLOAD: 'Heruntergeladen',
  };
  return map[action] || action;
}

function formatEntityType(entityType: string): string {
  const map: Record<string, string> = {
    Employee: 'Mitarbeiter', TimeEntry: 'Zeiteintrag', MonthlyReport: 'Monatsabrechnung',
    Settings: 'Einstellungen', Holiday: 'Feiertag', AbsenceType: 'Abwesenheitstyp',
    EmployeeAbsence: 'Abwesenheit', Database: 'Datenbank', WorkCategory: 'Arbeitskategorie',
    Terminal: 'Terminal', Document: 'Dokument', DocumentType: 'Dokumenttyp',
  };
  return map[entityType] || entityType;
}

// Stats
app.get('/stats/summary', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);

    const [totalLogs, logsToday, logsThisWeek, loginsToday, failedLoginsToday] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.count({ where: { timestamp: { gte: startOfDay } } }),
      prisma.auditLog.count({ where: { timestamp: { gte: startOfWeek } } }),
      prisma.auditLog.count({ where: { action: 'LOGIN', timestamp: { gte: startOfDay } } }),
      prisma.auditLog.count({ where: { action: 'LOGIN_FAILED', timestamp: { gte: startOfDay } } }),
    ]);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);
    const recentLogs = await prisma.auditLog.findMany({
      where: { timestamp: { gte: sevenDaysAgo } },
      select: { action: true },
    });
    const actionCounts: Record<string, number> = {};
    for (const log of recentLogs) {
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
    }

    return c.json({ totalLogs, logsToday, logsThisWeek, loginsToday, failedLoginsToday, actionCounts });
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Audit-Statistiken' }, 500);
  }
});

// Filter options
app.get('/filters/options', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const [actions, entityTypes, users] = await Promise.all([
      prisma.auditLog.findMany({ select: { action: true }, distinct: ['action'] }),
      prisma.auditLog.findMany({ select: { entityType: true }, distinct: ['entityType'] }),
      prisma.auditLog.findMany({ where: { userId: { not: null } }, select: { userId: true, userName: true }, distinct: ['userId'] }),
    ]);

    return c.json({
      actions: actions.map((a) => ({ value: a.action, label: formatAction(a.action) })),
      entityTypes: entityTypes.map((e) => ({ value: e.entityType, label: formatEntityType(e.entityType) })),
      users: users.filter((u) => u.userId && u.userName).map((u) => ({ value: u.userId, label: u.userName })),
    });
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Filter-Optionen' }, 500);
  }
});

// List all
app.get('/', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const skip = (page - 1) * limit;
    const action = c.req.query('action');
    const entityType = c.req.query('entityType');
    const userId = c.req.query('userId');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const search = c.req.query('search');

    const where: any = {};
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (userId) where.userId = userId;
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to) where.timestamp.lte = new Date(to);
    }
    if (search) {
      where.OR = [
        { userName: { contains: search } },
        { note: { contains: search } },
        { entityId: { contains: search } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, skip, take: limit }),
      prisma.auditLog.count({ where }),
    ]);

    const formattedLogs = logs.map((log: any) => ({
      ...log,
      actionFormatted: formatAction(log.action),
      entityTypeFormatted: formatEntityType(log.entityType),
      oldValues: log.oldValues ? JSON.parse(log.oldValues) : null,
      newValues: log.newValues ? JSON.parse(log.newValues) : null,
    }));

    return c.json({
      logs: formattedLogs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Audit-Logs' }, 500);
  }
});

// Single log
app.get('/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');
  try {
    const log = await prisma.auditLog.findUnique({ where: { id } });
    if (!log) return c.json({ error: 'Audit-Log nicht gefunden' }, 404);
    return c.json({
      ...log,
      actionFormatted: formatAction(log.action),
      entityTypeFormatted: formatEntityType(log.entityType),
      oldValues: log.oldValues ? JSON.parse(log.oldValues) : null,
      newValues: log.newValues ? JSON.parse(log.newValues) : null,
    });
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden des Audit-Logs' }, 500);
  }
});

export default app;
