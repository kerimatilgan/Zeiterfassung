import { Router, Response } from 'express';
import { prisma, io } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

// Zeiteinträge für aktuellen Benutzer
router.get('/my', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query;

    const where: any = { employeeId: req.employee!.id };

    if (from) {
      where.clockIn = { ...where.clockIn, gte: new Date(from as string) };
    }
    if (to) {
      where.clockIn = { ...where.clockIn, lte: new Date(to as string) };
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      orderBy: { clockIn: 'desc' },
      take: 100,
    });

    res.json(entries);
  } catch (error) {
    console.error('Get my time entries error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Zeiteinträge' });
  }
});

// Aktueller Status (eingestempelt?)
router.get('/my/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const activeEntry = await prisma.timeEntry.findFirst({
      where: {
        employeeId: req.employee!.id,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    res.json({
      isClockedIn: !!activeEntry,
      activeEntry,
    });
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Status' });
  }
});

// Alle Zeiteinträge (Admin)
router.get('/', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, from, to, limit = '100' } = req.query;

    const where: any = {};

    if (employeeId) {
      where.employeeId = employeeId;
    }
    if (from) {
      where.clockIn = { ...where.clockIn, gte: new Date(from as string) };
    }
    if (to) {
      where.clockIn = { ...where.clockIn, lte: new Date(to as string) };
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeNumber: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { clockIn: 'desc' },
      take: parseInt(limit as string),
    });

    res.json(entries);
  } catch (error) {
    console.error('Get time entries error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Zeiteinträge' });
  }
});

// Manuell einstempeln (Admin)
router.post('/manual', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      employeeId: z.string().uuid(),
      clockIn: z.string().datetime(),
      clockOut: z.string().datetime().nullable().optional(),
      breakMinutes: z.number().min(0).optional(),
      note: z.string().nullable().optional(),
    });

    const data = schema.parse(req.body);

    // Prüfen ob Mitarbeiter existiert
    const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    const entry = await prisma.timeEntry.create({
      data: {
        employeeId: data.employeeId,
        clockIn: new Date(data.clockIn),
        clockOut: data.clockOut ? new Date(data.clockOut) : null,
        breakMinutes: data.breakMinutes ?? 0,
        note: data.note,
        isManual: true,
        editedBy: `${req.employee!.firstName} ${req.employee!.lastName}`,
      },
    });

    // WebSocket Event für manuell erstellten Eintrag
    io.emit('time-entry-updated', {
      type: 'manual_create',
      employeeId: employee.id,
      entry,
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        employeeNumber: employee.employeeNumber,
      },
    });

    res.status(201).json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create manual entry error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Eintrags' });
  }
});

// Zeiteintrag bearbeiten (Admin)
router.put('/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      clockIn: z.string().datetime().optional(),
      clockOut: z.union([z.string().datetime(), z.null()]).optional(),
      breakMinutes: z.number().min(0).optional(),
      note: z.union([z.string(), z.null()]).optional(),
    });

    const data = schema.parse(req.body);

    const existing = await prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Zeiteintrag nicht gefunden' });
    }

    const entry = await prisma.timeEntry.update({
      where: { id },
      data: {
        ...(data.clockIn && { clockIn: new Date(data.clockIn) }),
        ...(data.clockOut !== undefined && { clockOut: data.clockOut ? new Date(data.clockOut) : null }),
        ...(data.breakMinutes !== undefined && { breakMinutes: data.breakMinutes }),
        ...(data.note !== undefined && { note: data.note }),
        editedBy: `${req.employee!.firstName} ${req.employee!.lastName}`,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
    });

    // WebSocket Event für aktualisierten Eintrag
    io.emit('time-entry-updated', {
      type: 'update',
      employeeId: entry.employeeId,
      entry,
      employee: {
        id: entry.employee.id,
        name: `${entry.employee.firstName} ${entry.employee.lastName}`,
        employeeNumber: entry.employee.employeeNumber,
      },
    });

    res.json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update entry error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Eintrags' });
  }
});

// Zeiteintrag löschen (Admin)
router.delete('/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Zeiteintrag nicht gefunden' });
    }

    await prisma.timeEntry.delete({ where: { id } });

    // WebSocket Event für gelöschten Eintrag
    io.emit('time-entry-updated', {
      type: 'delete',
      employeeId: existing.employeeId,
      entryId: id,
      employee: {
        id: existing.employee.id,
        name: `${existing.employee.firstName} ${existing.employee.lastName}`,
        employeeNumber: existing.employee.employeeNumber,
      },
    });

    res.json({ message: 'Zeiteintrag gelöscht' });
  } catch (error) {
    console.error('Delete entry error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Eintrags' });
  }
});

// Statistiken für aktuellen Monat
router.get('/my/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Montag
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { weeklyHours: true, vacationDaysPerYear: true },
    });

    // Alle Einträge diesen Monat
    const monthEntries = await prisma.timeEntry.findMany({
      where: {
        employeeId: req.employee!.id,
        clockIn: { gte: startOfMonth },
        clockOut: { not: null },
      },
    });

    // Alle Einträge diese Woche
    const weekEntries = await prisma.timeEntry.findMany({
      where: {
        employeeId: req.employee!.id,
        clockIn: { gte: startOfWeek },
        clockOut: { not: null },
      },
    });

    // Urlaubstage dieses Jahr zählen (nur Abwesenheiten mit "Urlaub" im Namen)
    const vacationAbsences = await prisma.employeeAbsence.count({
      where: {
        employeeId: req.employee!.id,
        date: {
          gte: startOfYear,
          lte: endOfYear,
        },
        absenceType: {
          name: {
            contains: 'Urlaub',
          },
        },
      },
    });

    // Stunden berechnen
    const calculateHours = (entries: typeof monthEntries) => {
      return entries.reduce((total, entry) => {
        if (!entry.clockOut) return total;
        const hours = (entry.clockOut.getTime() - entry.clockIn.getTime()) / (1000 * 60 * 60);
        const breakHours = entry.breakMinutes / 60;
        return total + hours - breakHours;
      }, 0);
    };

    const monthHours = calculateHours(monthEntries);
    const weekHours = calculateHours(weekEntries);

    // Überstunden diese Woche berechnen
    const weeklyTarget = employee?.weeklyHours ?? 40;
    const weekOvertime = Math.max(0, weekHours - weeklyTarget);

    // Urlaubstage berechnen
    const vacationDaysTotal = employee?.vacationDaysPerYear ?? 30;
    const vacationDaysUsed = vacationAbsences;
    const vacationDaysRemaining = vacationDaysTotal - vacationDaysUsed;

    res.json({
      monthHours: Math.round(monthHours * 100) / 100,
      weekHours: Math.round(weekHours * 100) / 100,
      weeklyTarget,
      weekOvertime: Math.round(weekOvertime * 100) / 100,
      entriesThisMonth: monthEntries.length,
      vacationDaysTotal,
      vacationDaysUsed,
      vacationDaysRemaining,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

export default router;
