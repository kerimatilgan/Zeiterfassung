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

// ==================== ABWESENHEITSTYPEN ====================

// Abwesenheitstypen abrufen
router.get('/absence-types', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const absenceTypes = await prisma.absenceType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    res.json(absenceTypes);
  } catch (error) {
    console.error('Get absence types error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Abwesenheitstypen' });
  }
});

// Alle Abwesenheitstypen abrufen (inkl. inaktive, für Admin)
router.get('/absence-types/all', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const absenceTypes = await prisma.absenceType.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    res.json(absenceTypes);
  } catch (error) {
    console.error('Get all absence types error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Abwesenheitstypen' });
  }
});

// Abwesenheitstyp erstellen (Admin)
router.post('/absence-types', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      shortName: z.string().min(1).max(10),
      requiredHours: z.number().min(0).max(24),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const data = schema.parse(req.body);

    const absenceType = await prisma.absenceType.create({
      data: {
        name: data.name,
        shortName: data.shortName,
        requiredHours: data.requiredHours,
        color: data.color,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    res.status(201).json(absenceType);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create absence type error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Abwesenheitstyps' });
  }
});

// Abwesenheitstyp aktualisieren (Admin)
router.put('/absence-types/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      name: z.string().min(1).optional(),
      shortName: z.string().min(1).max(10).optional(),
      requiredHours: z.number().min(0).max(24).optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const data = schema.parse(req.body);

    const absenceType = await prisma.absenceType.update({
      where: { id },
      data,
    });

    res.json(absenceType);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update absence type error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Abwesenheitstyps' });
  }
});

// Abwesenheitstyp löschen (Admin)
router.delete('/absence-types/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Prüfen ob noch Abwesenheiten mit diesem Typ existieren
    const existingAbsences = await prisma.employeeAbsence.count({
      where: { absenceTypeId: id },
    });

    if (existingAbsences > 0) {
      return res.status(400).json({
        error: `Kann nicht löschen: ${existingAbsences} Abwesenheiten verwenden diesen Typ. Bitte erst deaktivieren statt löschen.`,
      });
    }

    await prisma.absenceType.delete({ where: { id } });

    res.json({ message: 'Abwesenheitstyp gelöscht' });
  } catch (error) {
    console.error('Delete absence type error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Abwesenheitstyps' });
  }
});

// ==================== MITARBEITER-ABWESENHEITEN ====================

// Abwesenheiten für einen Mitarbeiter abrufen
router.get('/absences', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, from, to } = req.query;

    const where: any = {};

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (from || to) {
      where.date = {};
      if (from) {
        where.date.gte = new Date(from as string);
      }
      if (to) {
        where.date.lte = new Date(to as string);
      }
    }

    const absences = await prisma.employeeAbsence.findMany({
      where,
      include: {
        absenceType: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    res.json(absences);
  } catch (error) {
    console.error('Get absences error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Abwesenheiten' });
  }
});

// Abwesenheit erstellen (Admin)
router.post('/absences', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      employeeId: z.string().uuid(),
      absenceTypeId: z.string().uuid(),
      date: z.string(),
      note: z.string().optional().nullable(),
    });

    const data = schema.parse(req.body);

    // Prüfen ob an diesem Tag bereits eine Abwesenheit existiert
    const existingAbsence = await prisma.employeeAbsence.findUnique({
      where: {
        employeeId_date: {
          employeeId: data.employeeId,
          date: new Date(data.date),
        },
      },
    });

    if (existingAbsence) {
      return res.status(400).json({ error: 'Für diesen Tag existiert bereits eine Abwesenheit' });
    }

    const absence = await prisma.employeeAbsence.create({
      data: {
        employeeId: data.employeeId,
        absenceTypeId: data.absenceTypeId,
        date: new Date(data.date),
        note: data.note || null,
      },
      include: {
        absenceType: true,
      },
    });

    res.status(201).json(absence);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create absence error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Abwesenheit' });
  }
});

// Abwesenheit aktualisieren (Admin)
router.put('/absences/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      absenceTypeId: z.string().uuid().optional(),
      note: z.string().optional().nullable(),
    });

    const data = schema.parse(req.body);

    const absence = await prisma.employeeAbsence.update({
      where: { id },
      data,
      include: {
        absenceType: true,
      },
    });

    res.json(absence);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update absence error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Abwesenheit' });
  }
});

// Abwesenheit löschen (Admin)
router.delete('/absences/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.employeeAbsence.delete({ where: { id } });

    res.json({ message: 'Abwesenheit gelöscht' });
  } catch (error) {
    console.error('Delete absence error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Abwesenheit' });
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
