import { Router, Response } from 'express';
import { prisma, io } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { createAuditLog } from '../utils/auditLog.js';
import { sendComplaintNotification, sendComplaintResolvedNotification } from '../utils/emailService.js';

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

    // Audit Log
    await createAuditLog({
      req,
      action: 'CREATE',
      entityType: 'TimeEntry',
      entityId: entry.id,
      newValues: {
        employeeName: `${employee.firstName} ${employee.lastName}`,
        clockIn: entry.clockIn,
        clockOut: entry.clockOut,
        breakMinutes: entry.breakMinutes,
        note: entry.note,
        isManual: true,
      },
      note: 'Manuell erstellt',
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

    // Audit Log
    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'TimeEntry',
      entityId: entry.id,
      oldValues: {
        employeeName: `${entry.employee.firstName} ${entry.employee.lastName}`,
        clockIn: existing.clockIn,
        clockOut: existing.clockOut,
        breakMinutes: existing.breakMinutes,
        note: existing.note,
      },
      newValues: {
        clockIn: entry.clockIn,
        clockOut: entry.clockOut,
        breakMinutes: entry.breakMinutes,
        note: entry.note,
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

    // Audit Log
    await createAuditLog({
      req,
      action: 'DELETE',
      entityType: 'TimeEntry',
      entityId: id,
      oldValues: {
        employeeName: `${existing.employee.firstName} ${existing.employee.lastName}`,
        clockIn: existing.clockIn,
        clockOut: existing.clockOut,
        breakMinutes: existing.breakMinutes,
        note: existing.note,
      },
    });

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

// ==================== REKLAMATIONEN ====================

// Reklamation erstellen/aktualisieren (eigener Eintrag)
router.post('/:id/complaint', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      message: z.string().min(1, 'Bitte geben Sie eine Nachricht ein').max(1000),
    });

    const { message } = schema.parse(req.body);

    // Eintrag suchen
    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({ error: 'Zeiteintrag nicht gefunden' });
    }

    // Prüfen ob der Eintrag dem Benutzer gehört (außer Admin)
    if (entry.employeeId !== req.employee!.id && !req.employee!.isAdmin) {
      return res.status(403).json({ error: 'Keine Berechtigung für diesen Eintrag' });
    }

    // Prüfen ob bereits bearbeitet (dann kann nicht mehr geändert werden)
    if (entry.complaintResolvedAt && !req.employee!.isAdmin) {
      return res.status(400).json({ error: 'Diese Reklamation wurde bereits bearbeitet' });
    }

    // Reklamation speichern (bei neuer Reklamation auch Originalwerte speichern)
    const isNewComplaint = !entry.complaintMessage;
    const updatedEntry = await prisma.timeEntry.update({
      where: { id },
      data: {
        complaintMessage: message,
        complaintAt: isNewComplaint ? new Date() : entry.complaintAt,
        // Originalwerte nur bei neuer Reklamation speichern
        ...(isNewComplaint && {
          complaintOriginalClockIn: entry.clockIn,
          complaintOriginalClockOut: entry.clockOut,
          complaintOriginalBreakMinutes: entry.breakMinutes,
        }),
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: isNewComplaint ? 'COMPLAINT_CREATE' : 'COMPLAINT_UPDATE',
      entityType: 'TimeEntry',
      entityId: id,
      oldValues: entry.complaintMessage ? { complaintMessage: entry.complaintMessage } : null,
      newValues: { complaintMessage: message },
    });

    // E-Mail an Admins senden (nur bei neuer Reklamation)
    if (isNewComplaint) {
      const clockInDate = new Date(entry.clockIn);
      const clockInTime = clockInDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const clockOutTime = entry.clockOut
        ? new Date(entry.clockOut).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        : null;

      sendComplaintNotification(
        `${entry.employee.firstName} ${entry.employee.lastName}`,
        clockInDate,
        clockInTime,
        clockOutTime,
        message
      ).catch((err) => {
        console.error('Fehler beim Senden der Reklamations-E-Mail:', err);
      });
    }

    res.json(updatedEntry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create complaint error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Reklamation' });
  }
});

// Reklamation zurückziehen (nur wenn noch nicht bearbeitet)
router.delete('/:id/complaint', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const entry = await prisma.timeEntry.findUnique({ where: { id } });

    if (!entry) {
      return res.status(404).json({ error: 'Zeiteintrag nicht gefunden' });
    }

    // Prüfen ob der Eintrag dem Benutzer gehört
    if (entry.employeeId !== req.employee!.id && !req.employee!.isAdmin) {
      return res.status(403).json({ error: 'Keine Berechtigung für diesen Eintrag' });
    }

    // Prüfen ob Reklamation existiert
    if (!entry.complaintMessage) {
      return res.status(400).json({ error: 'Keine Reklamation vorhanden' });
    }

    // Prüfen ob bereits bearbeitet
    if (entry.complaintResolvedAt && !req.employee!.isAdmin) {
      return res.status(400).json({ error: 'Diese Reklamation wurde bereits bearbeitet und kann nicht mehr zurückgezogen werden' });
    }

    // Reklamation löschen (inkl. Originalwerte)
    const updatedEntry = await prisma.timeEntry.update({
      where: { id },
      data: {
        complaintMessage: null,
        complaintAt: null,
        complaintResolvedAt: null,
        complaintResolvedBy: null,
        complaintResponse: null,
        complaintOriginalClockIn: null,
        complaintOriginalClockOut: null,
        complaintOriginalBreakMinutes: null,
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'COMPLAINT_DELETE',
      entityType: 'TimeEntry',
      entityId: id,
      oldValues: { complaintMessage: entry.complaintMessage },
    });

    res.json(updatedEntry);
  } catch (error) {
    console.error('Delete complaint error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Reklamation' });
  }
});

// Reklamation bearbeiten/lösen (Admin)
router.post('/:id/complaint/resolve', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      response: z.string().max(1000).optional().nullable(),
    });

    const { response } = schema.parse(req.body);

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        employee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!entry) {
      return res.status(404).json({ error: 'Zeiteintrag nicht gefunden' });
    }

    if (!entry.complaintMessage) {
      return res.status(400).json({ error: 'Keine Reklamation vorhanden' });
    }

    // Reklamation als bearbeitet markieren
    const updatedEntry = await prisma.timeEntry.update({
      where: { id },
      data: {
        complaintResolvedAt: new Date(),
        complaintResolvedBy: req.employee!.id,
        complaintResponse: response || null,
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'COMPLAINT_RESOLVE',
      entityType: 'TimeEntry',
      entityId: id,
      oldValues: {
        employeeName: `${entry.employee.firstName} ${entry.employee.lastName}`,
        complaintMessage: entry.complaintMessage,
      },
      newValues: {
        complaintResolvedAt: updatedEntry.complaintResolvedAt,
        complaintResponse: updatedEntry.complaintResponse,
      },
    });

    // Bestätigungs-E-Mail an Mitarbeiter senden (wenn E-Mail vorhanden)
    if (entry.employee.email) {
      const formatTime = (date: Date) =>
        date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

      // Originalwerte (bei Reklamationserstellung gespeichert) vs. aktuelle Werte
      const oldClockIn = entry.complaintOriginalClockIn
        ? formatTime(new Date(entry.complaintOriginalClockIn))
        : formatTime(new Date(entry.clockIn));
      const oldClockOut = entry.complaintOriginalClockOut
        ? formatTime(new Date(entry.complaintOriginalClockOut))
        : entry.clockOut
          ? formatTime(new Date(entry.clockOut))
          : null;
      const oldBreakMinutes = entry.complaintOriginalBreakMinutes ?? entry.breakMinutes;

      const newClockIn = formatTime(new Date(entry.clockIn));
      const newClockOut = entry.clockOut ? formatTime(new Date(entry.clockOut)) : null;

      sendComplaintResolvedNotification(
        entry.employee.email,
        `${entry.employee.firstName} ${entry.employee.lastName}`,
        `${req.employee!.firstName} ${req.employee!.lastName}`,
        new Date(entry.clockIn),
        entry.complaintMessage,
        response || null,
        {
          oldClockIn,
          oldClockOut,
          newClockIn,
          newClockOut,
          oldBreakMinutes,
          newBreakMinutes: entry.breakMinutes,
        }
      ).catch((err) => {
        console.error('Fehler beim Senden der Bestätigungs-E-Mail:', err);
      });
    }

    res.json(updatedEntry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Resolve complaint error:', error);
    res.status(500).json({ error: 'Fehler beim Bearbeiten der Reklamation' });
  }
});

// Offene Reklamationen abrufen (Admin) - für Dashboard und Badge
router.get('/complaints/pending', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { limit = '5' } = req.query;

    const entries = await prisma.timeEntry.findMany({
      where: {
        complaintMessage: { not: null },
        complaintResolvedAt: null,
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeNumber: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
          },
        },
      },
      orderBy: { complaintAt: 'desc' },
      take: parseInt(limit as string),
    });

    // Gesamtanzahl für Badge
    const totalCount = await prisma.timeEntry.count({
      where: {
        complaintMessage: { not: null },
        complaintResolvedAt: null,
      },
    });

    res.json({
      count: totalCount,
      entries,
    });
  } catch (error) {
    console.error('Get pending complaints error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der offenen Reklamationen' });
  }
});

// Alle reklamierten Einträge abrufen (Admin)
router.get('/flagged', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { resolved, from, to } = req.query;

    const where: any = {
      complaintMessage: { not: null },
    };

    // Filter: nur gelöste oder nur offene
    if (resolved === 'true') {
      where.complaintResolvedAt = { not: null };
    } else if (resolved === 'false') {
      where.complaintResolvedAt = null;
    }

    // Datumsfilter
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
      orderBy: { complaintAt: 'desc' },
    });

    res.json(entries);
  } catch (error) {
    console.error('Get flagged entries error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der reklamierten Einträge' });
  }
});

export default router;
