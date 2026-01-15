import { Router, Response } from 'express';
import { prisma } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

// Einstellungen abrufen
router.get('/', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Einstellungen' });
  }
});

// Einstellungen aktualisieren (Admin)
router.put('/', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      companyName: z.string().min(1).optional(),
      companyAddress: z.string().optional().nullable(),
      companyPhone: z.string().optional().nullable(),
      companyEmail: z.string().email().optional().nullable(),
      defaultBreakMinutes: z.number().min(0).max(120).optional(),
      overtimeThreshold: z.number().min(0).max(168).optional(),
    });

    const data = schema.parse(req.body);

    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      update: data,
      create: {
        id: 'default',
        ...data,
      },
    });

    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Einstellungen' });
  }
});

// Feiertage abrufen
router.get('/holidays', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { year } = req.query;

    const where: any = {};
    if (year) {
      const startOfYear = new Date(parseInt(year as string), 0, 1);
      const endOfYear = new Date(parseInt(year as string), 11, 31, 23, 59, 59);
      where.date = { gte: startOfYear, lte: endOfYear };
    }

    const holidays = await prisma.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
    });

    res.json(holidays);
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Feiertage' });
  }
});

// Feiertag hinzufügen (Admin)
router.post('/holidays', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      date: z.string().datetime(),
      name: z.string().min(1),
      isRecurring: z.boolean().optional(),
    });

    const data = schema.parse(req.body);

    const holiday = await prisma.holiday.create({
      data: {
        date: new Date(data.date),
        name: data.name,
        isRecurring: data.isRecurring ?? false,
      },
    });

    res.status(201).json(holiday);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create holiday error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Feiertags' });
  }
});

// Feiertag löschen (Admin)
router.delete('/holidays/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.holiday.delete({ where: { id } });

    res.json({ message: 'Feiertag gelöscht' });
  } catch (error) {
    console.error('Delete holiday error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Feiertags' });
  }
});

// Dashboard-Statistiken (Admin)
router.get('/dashboard-stats', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Aktive Mitarbeiter
    const activeEmployees = await prisma.employee.count({
      where: { isActive: true },
    });

    // Aktuell eingestempelt
    const currentlyClockedIn = await prisma.timeEntry.count({
      where: { clockOut: null },
    });

    // Einträge heute
    const entriesToday = await prisma.timeEntry.count({
      where: { clockIn: { gte: startOfDay } },
    });

    // Einträge diesen Monat
    const entriesThisMonth = await prisma.timeEntry.count({
      where: { clockIn: { gte: startOfMonth } },
    });

    // Offene Abrechnungen (Drafts)
    const pendingReports = await prisma.monthlyReport.count({
      where: { status: 'draft' },
    });

    res.json({
      activeEmployees,
      currentlyClockedIn,
      entriesToday,
      entriesThisMonth,
      pendingReports,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

export default router;
