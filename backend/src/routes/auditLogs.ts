import { Router, Response } from 'express';
import { prisma } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { formatAction, formatEntityType } from '../utils/auditLog.js';

const router = Router();

// Statistiken für Audit-Logs (nur Admin) - MUSS VOR /:id kommen!
router.get('/stats/summary', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);

    const [
      totalLogs,
      logsToday,
      logsThisWeek,
      loginsToday,
      failedLoginsToday,
    ] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.count({ where: { timestamp: { gte: startOfDay } } }),
      prisma.auditLog.count({ where: { timestamp: { gte: startOfWeek } } }),
      prisma.auditLog.count({
        where: {
          action: 'LOGIN',
          timestamp: { gte: startOfDay },
        },
      }),
      prisma.auditLog.count({
        where: {
          action: 'LOGIN_FAILED',
          timestamp: { gte: startOfDay },
        },
      }),
    ]);

    // Aktivität nach Aktion gruppieren (letzte 7 Tage)
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

    res.json({
      totalLogs,
      logsToday,
      logsThisWeek,
      loginsToday,
      failedLoginsToday,
      actionCounts,
    });
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Audit-Statistiken' });
  }
});

// Verfügbare Filter-Optionen (nur Admin) - MUSS VOR /:id kommen!
router.get('/filters/options', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    // Einzigartige Werte für Filter sammeln
    const [actions, entityTypes, users] = await Promise.all([
      prisma.auditLog.findMany({
        select: { action: true },
        distinct: ['action'],
      }),
      prisma.auditLog.findMany({
        select: { entityType: true },
        distinct: ['entityType'],
      }),
      prisma.auditLog.findMany({
        where: { userId: { not: null } },
        select: { userId: true, userName: true },
        distinct: ['userId'],
      }),
    ]);

    res.json({
      actions: actions.map((a) => ({
        value: a.action,
        label: formatAction(a.action),
      })),
      entityTypes: entityTypes.map((e) => ({
        value: e.entityType,
        label: formatEntityType(e.entityType),
      })),
      users: users
        .filter((u) => u.userId && u.userName)
        .map((u) => ({
          value: u.userId,
          label: u.userName,
        })),
    });
  } catch (error) {
    console.error('Get filter options error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Filter-Optionen' });
  }
});

// Alle Audit-Logs abrufen (nur Admin)
router.get('/', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = '1',
      limit = '50',
      action,
      entityType,
      userId,
      from,
      to,
      search,
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 100); // Max 100 pro Seite
    const skip = (pageNum - 1) * limitNum;

    // Filter aufbauen
    const where: any = {};

    if (action) {
      where.action = action;
    }

    if (entityType) {
      where.entityType = entityType;
    }

    if (userId) {
      where.userId = userId;
    }

    if (from || to) {
      where.timestamp = {};
      if (from) {
        where.timestamp.gte = new Date(from as string);
      }
      if (to) {
        where.timestamp.lte = new Date(to as string);
      }
    }

    if (search) {
      where.OR = [
        { userName: { contains: search as string } },
        { note: { contains: search as string } },
        { entityId: { contains: search as string } },
      ];
    }

    // Logs abrufen
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Logs formatieren
    const formattedLogs = logs.map((log) => ({
      ...log,
      actionFormatted: formatAction(log.action),
      entityTypeFormatted: formatEntityType(log.entityType),
      oldValues: log.oldValues ? JSON.parse(log.oldValues) : null,
      newValues: log.newValues ? JSON.parse(log.newValues) : null,
    }));

    res.json({
      logs: formattedLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Audit-Logs' });
  }
});

// Einzelnen Audit-Log abrufen (nur Admin) - MUSS NACH den spezifischen Routen kommen!
router.get('/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const log = await prisma.auditLog.findUnique({
      where: { id },
    });

    if (!log) {
      return res.status(404).json({ error: 'Audit-Log nicht gefunden' });
    }

    res.json({
      ...log,
      actionFormatted: formatAction(log.action),
      entityTypeFormatted: formatEntityType(log.entityType),
      oldValues: log.oldValues ? JSON.parse(log.oldValues) : null,
      newValues: log.newValues ? JSON.parse(log.newValues) : null,
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Audit-Logs' });
  }
});

export default router;
