import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLog.js';
import { sendComplaintNotification, sendComplaintResolvedNotification } from '../utils/emailService.js';

const router = Router();

// ============================================================
// EMPLOYEE: Eigene Reklamationen
// ============================================================

// Alle eigenen Reklamationen
router.get('/my', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const complaints = await prisma.complaint.findMany({
      where: { employeeId: req.employee!.id },
      include: {
        timeEntry: {
          select: {
            id: true,
            clockIn: true,
            clockOut: true,
            breakMinutes: true,
            clockInViaPwa: true,
            clockOutViaPwa: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(complaints);
  } catch (error) {
    console.error('Get my complaints error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Reklamationen' });
  }
});

// Reklamationen für einen Eintrag (Historie)
router.get('/by-entry/:timeEntryId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { timeEntryId } = req.params;

    // Berechtigung prüfen
    const entry = await prisma.timeEntry.findUnique({ where: { id: timeEntryId } });
    if (!entry) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
    if (entry.employeeId !== req.employee!.id && !req.employee!.isAdmin) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const complaints = await prisma.complaint.findMany({
      where: { timeEntryId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(complaints);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
});

// Neue Reklamation anlegen (für TimeEntry oder Standalone)
const createSchema = z.object({
  timeEntryId: z.string().uuid().optional().nullable(),
  date: z.string().min(1).optional(), // Pflicht bei Standalone
  message: z.string().min(1, 'Nachricht erforderlich').max(1000),
});

router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = createSchema.parse(req.body);
    if (!data.timeEntryId && !data.date) {
      return res.status(400).json({ error: 'Entweder timeEntryId oder date erforderlich' });
    }

    let timeEntry: any = null;
    let date: Date;

    if (data.timeEntryId) {
      timeEntry = await prisma.timeEntry.findUnique({ where: { id: data.timeEntryId } });
      if (!timeEntry) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
      if (timeEntry.employeeId !== req.employee!.id && !req.employee!.isAdmin) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }
      date = timeEntry.clockIn;
    } else {
      date = new Date(data.date! + 'T00:00:00');
      if (isNaN(date.getTime())) return res.status(400).json({ error: 'Ungültiges Datum' });

      // Nicht in Zukunft
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (date > today) return res.status(400).json({ error: 'Reklamationen können nicht für zukünftige Tage erstellt werden' });
    }

    // Bei Standalone-Reklamationen: prüfen ob für diesen Tag schon eine offene Reklamation existiert
    if (!data.timeEntryId) {
      const dayStart = new Date(date);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      const existing = await prisma.complaint.findFirst({
        where: {
          employeeId: req.employee!.id,
          timeEntryId: null,
          date: { gte: dayStart, lte: dayEnd },
          resolvedAt: null,
        },
      });
      if (existing) return res.status(400).json({ error: 'Für diesen Tag existiert bereits eine offene Reklamation.' });
    }

    // Bei Reklamation an existierendem Eintrag: prüfen ob bereits offene Reklamation existiert
    if (data.timeEntryId) {
      const existing = await prisma.complaint.findFirst({
        where: { timeEntryId: data.timeEntryId, resolvedAt: null },
      });
      if (existing) return res.status(400).json({ error: 'Für diesen Eintrag existiert bereits eine offene Reklamation.' });
    }

    const complaint = await prisma.complaint.create({
      data: {
        employeeId: req.employee!.id,
        timeEntryId: data.timeEntryId || null,
        date,
        message: data.message,
        originalClockIn: timeEntry?.clockIn || null,
        originalClockOut: timeEntry?.clockOut || null,
        originalBreakMinutes: timeEntry?.breakMinutes ?? null,
      },
      include: {
        timeEntry: {
          select: { id: true, clockIn: true, clockOut: true, breakMinutes: true },
        },
      },
    });

    // Sync auf TimeEntry (für Backward-Compat: Icon-Anzeige)
    if (timeEntry) {
      await prisma.timeEntry.update({
        where: { id: timeEntry.id },
        data: {
          complaintMessage: data.message,
          complaintAt: new Date(),
          complaintResolvedAt: null,
          complaintResolvedBy: null,
          complaintResponse: null,
          complaintOriginalClockIn: timeEntry.clockIn,
          complaintOriginalClockOut: timeEntry.clockOut,
          complaintOriginalBreakMinutes: timeEntry.breakMinutes,
        },
      });
    }

    // Audit
    await createAuditLog({
      req,
      action: 'COMPLAINT_CREATE',
      entityType: 'TimeEntry',
      entityId: complaint.id,
      newValues: { message: data.message, standalone: !data.timeEntryId, date: date.toISOString() },
    });

    // E-Mail an Admins
    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { firstName: true, lastName: true },
    });
    if (employee) {
      const formatTime = (d: Date | null) =>
        d ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null;
      sendComplaintNotification(
        `${employee.firstName} ${employee.lastName}`,
        date,
        formatTime(timeEntry?.clockIn || null) || '-',
        formatTime(timeEntry?.clockOut || null),
        data.message,
      ).catch((err) => console.error('Mail-Fehler:', err));
    }

    res.status(201).json(complaint);
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Create complaint error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen' });
  }
});

// Reklamation zurückziehen (nur eigene, nur offene)
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const complaint = await prisma.complaint.findUnique({ where: { id: req.params.id } });
    if (!complaint) return res.status(404).json({ error: 'Nicht gefunden' });
    if (complaint.employeeId !== req.employee!.id && !req.employee!.isAdmin) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }
    if (complaint.resolvedAt) return res.status(400).json({ error: 'Bereits bearbeitete Reklamationen können nicht zurückgezogen werden' });

    await prisma.complaint.delete({ where: { id: req.params.id } });

    // Backward-compat: TimeEntry-Felder zurücksetzen wenn diese die letzte Reklamation war
    if (complaint.timeEntryId) {
      const remaining = await prisma.complaint.findFirst({
        where: { timeEntryId: complaint.timeEntryId },
        orderBy: { createdAt: 'desc' },
      });
      await prisma.timeEntry.update({
        where: { id: complaint.timeEntryId },
        data: remaining ? {
          complaintMessage: remaining.message,
          complaintAt: remaining.createdAt,
          complaintResolvedAt: remaining.resolvedAt,
          complaintResolvedBy: remaining.resolvedBy,
          complaintResponse: remaining.response,
          complaintOriginalClockIn: remaining.originalClockIn,
          complaintOriginalClockOut: remaining.originalClockOut,
          complaintOriginalBreakMinutes: remaining.originalBreakMinutes,
        } : {
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
    }

    await createAuditLog({
      req, action: 'COMPLAINT_DELETE', entityType: 'TimeEntry', entityId: complaint.id,
      note: 'Reklamation zurückgezogen',
    });

    res.json({ message: 'Reklamation gelöscht' });
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// ============================================================
// ADMIN: Alle Reklamationen
// ============================================================

router.get('/all', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { resolved, employeeId, from, to } = req.query;
    const where: any = {};
    if (resolved === 'true') where.resolvedAt = { not: null };
    else if (resolved === 'false') where.resolvedAt = null;
    if (employeeId) where.employeeId = employeeId;
    if (from) where.date = { ...where.date, gte: new Date(from as string) };
    if (to) where.date = { ...where.date, lte: new Date(to as string) };

    const complaints = await prisma.complaint.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        timeEntry: { select: { id: true, clockIn: true, clockOut: true, breakMinutes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(complaints);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
});

// Pending count für Badge
router.get('/pending/count', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.complaint.count({ where: { resolvedAt: null } });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Fehler' });
  }
});

// Reklamation lösen (Admin)
const resolveSchema = z.object({
  response: z.string().max(1000).optional().nullable(),
  // Optional: Zeit-Updates anwenden
  applyChanges: z.object({
    clockIn: z.string().optional(),
    clockOut: z.string().optional().nullable(),
    breakMinutes: z.number().optional(),
  }).optional(),
});

router.post('/:id/resolve', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = resolveSchema.parse(req.body);
    const complaint = await prisma.complaint.findUnique({
      where: { id: req.params.id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, email: true } },
        timeEntry: true,
      },
    });
    if (!complaint) return res.status(404).json({ error: 'Nicht gefunden' });
    if (complaint.resolvedAt) return res.status(400).json({ error: 'Bereits bearbeitet' });

    let updatedEntry = complaint.timeEntry;

    // Optional: TimeEntry aktualisieren
    if (data.applyChanges && complaint.timeEntryId && complaint.timeEntry) {
      updatedEntry = await prisma.timeEntry.update({
        where: { id: complaint.timeEntryId },
        data: {
          ...(data.applyChanges.clockIn && { clockIn: new Date(data.applyChanges.clockIn) }),
          ...(data.applyChanges.clockOut !== undefined && {
            clockOut: data.applyChanges.clockOut ? new Date(data.applyChanges.clockOut) : null,
          }),
          ...(data.applyChanges.breakMinutes !== undefined && { breakMinutes: data.applyChanges.breakMinutes }),
          editedBy: `${req.employee!.firstName} ${req.employee!.lastName}`,
        },
      });
    }

    // Reklamation als bearbeitet markieren
    const resolved = await prisma.complaint.update({
      where: { id: complaint.id },
      data: {
        resolvedAt: new Date(),
        resolvedBy: req.employee!.id,
        resolvedByName: `${req.employee!.firstName} ${req.employee!.lastName}`,
        response: data.response || null,
        newClockIn: updatedEntry?.clockIn || null,
        newClockOut: updatedEntry?.clockOut || null,
        newBreakMinutes: updatedEntry?.breakMinutes ?? null,
      },
    });

    // Backward-compat: TimeEntry-Felder synchronisieren
    if (complaint.timeEntryId) {
      await prisma.timeEntry.update({
        where: { id: complaint.timeEntryId },
        data: {
          complaintResolvedAt: resolved.resolvedAt,
          complaintResolvedBy: resolved.resolvedBy,
          complaintResponse: resolved.response,
        },
      });
    }

    await createAuditLog({
      req, action: 'COMPLAINT_RESOLVE', entityType: 'TimeEntry', entityId: complaint.id,
      newValues: { resolvedAt: resolved.resolvedAt, response: resolved.response, applied: !!data.applyChanges },
    });

    // E-Mail an MA
    if (complaint.employee.email) {
      const formatTime = (date: Date | null) =>
        date ? date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : null;
      sendComplaintResolvedNotification(
        complaint.employee.email,
        `${complaint.employee.firstName} ${complaint.employee.lastName}`,
        `${req.employee!.firstName} ${req.employee!.lastName}`,
        complaint.date,
        complaint.message,
        data.response || null,
        {
          oldClockIn: formatTime(complaint.originalClockIn) || '-',
          oldClockOut: formatTime(complaint.originalClockOut),
          newClockIn: formatTime(resolved.newClockIn) || '-',
          newClockOut: formatTime(resolved.newClockOut),
          oldBreakMinutes: complaint.originalBreakMinutes ?? 0,
          newBreakMinutes: resolved.newBreakMinutes ?? 0,
        },
      ).catch((err) => console.error('Mail-Fehler:', err));
    }

    res.json(resolved);
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Resolve error:', error);
    res.status(500).json({ error: 'Fehler beim Bearbeiten' });
  }
});

export default router;
