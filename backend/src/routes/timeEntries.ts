import { Router, Response } from 'express';
import { prisma, io } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { createAuditLog } from '../utils/auditLog.js';
import { sendComplaintNotification, sendComplaintResolvedNotification, sendEmail } from '../utils/emailService.js';

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
      clockIn: z.string().min(1),
      clockOut: z.union([z.string().min(1), z.string().max(0), z.null()]).optional(),
      breakMinutes: z.number().min(0).optional(),
      note: z.string().nullable().optional(),
    });

    const data = schema.parse(req.body);

    // Prüfen ob Mitarbeiter existiert
    const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Wenn neuer Eintrag offen ist (kein clockOut), darf MA nicht bereits eingestempelt sein
    const isOpenEntry = !data.clockOut || data.clockOut.length === 0;
    if (isOpenEntry) {
      const activeEntry = await prisma.timeEntry.findFirst({
        where: { employeeId: data.employeeId, clockOut: null },
      });
      if (activeEntry) {
        return res.status(400).json({
          error: 'Mitarbeiter ist bereits eingestempelt. Bitte zuerst den offenen Eintrag schließen.',
        });
      }
    }

    const entry = await prisma.timeEntry.create({
      data: {
        employeeId: data.employeeId,
        clockIn: new Date(data.clockIn),
        clockOut: data.clockOut && data.clockOut.length > 0 ? new Date(data.clockOut) : null,
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
      clockIn: z.string().min(1).optional(),
      clockOut: z.union([z.string().min(1), z.string().max(0), z.null()]).optional(),
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

// Pause einfügen (Admin) - splittet einen Zeiteintrag in zwei Teile
router.post('/:id/insert-pause', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { pauseStart, pauseEnd } = req.body;

    if (!pauseStart || !pauseEnd) {
      return res.status(400).json({ error: 'Pausenbeginn und -ende erforderlich' });
    }

    const pauseStartDate = new Date(pauseStart);
    const pauseEndDate = new Date(pauseEnd);

    if (pauseEndDate <= pauseStartDate) {
      return res.status(400).json({ error: 'Pausenende muss nach Pausenbeginn liegen' });
    }

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    if (!entry) {
      return res.status(404).json({ error: 'Zeiteintrag nicht gefunden' });
    }

    if (!entry.clockOut) {
      return res.status(400).json({ error: 'Nur bei abgeschlossenen Einträgen möglich' });
    }

    if (pauseStartDate < entry.clockIn || pauseEndDate > entry.clockOut) {
      return res.status(400).json({ error: 'Pause muss innerhalb des Zeiteintrags liegen' });
    }

    // Eintrag splitten: Original → clockIn bis pauseStart, Neu → pauseEnd bis clockOut
    const originalClockOut = entry.clockOut;

    await prisma.timeEntry.update({
      where: { id },
      data: {
        clockOut: pauseStartDate,
        editedBy: `${req.employee!.firstName} ${req.employee!.lastName}`,
      },
    });

    const newEntry = await prisma.timeEntry.create({
      data: {
        employeeId: entry.employeeId,
        clockIn: pauseEndDate,
        clockOut: originalClockOut,
        breakMinutes: 0,
        note: entry.note,
        isManual: true,
        editedBy: `${req.employee!.firstName} ${req.employee!.lastName}`,
      },
    });

    await createAuditLog({
      req: req as any,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'UPDATE',
      entityType: 'TimeEntry',
      entityId: id,
      oldValues: { clockIn: entry.clockIn, clockOut: entry.clockOut },
      newValues: {
        pauseInserted: true,
        pauseStart: pauseStartDate,
        pauseEnd: pauseEndDate,
        entry1: { clockIn: entry.clockIn, clockOut: pauseStartDate },
        entry2: { clockIn: pauseEndDate, clockOut: originalClockOut },
      },
      note: `Pause eingefügt für ${entry.employee.firstName} ${entry.employee.lastName}`,
    });

    res.json({ entry1: { ...entry, clockOut: pauseStartDate }, entry2: newEntry });
  } catch (error) {
    console.error('Insert pause error:', error);
    res.status(500).json({ error: 'Fehler beim Einfügen der Pause' });
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

// Tägliche Sollstunden für eine Woche (berücksichtigt Feiertage, Abwesenheiten, Ein-/Austrittsdatum)
router.get('/my/week-targets', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { from } = req.query;
    if (!from || typeof from !== 'string') {
      return res.status(400).json({ error: 'from (Montag der Woche) erforderlich' });
    }

    // Wochenstart als lokales Datum parsen (YYYY-MM-DD)
    const [y, mo, d] = (from as string).split('-').map(Number);
    const weekStart = new Date(y, mo - 1, d);
    const weekEnd = new Date(y, mo - 1, d + 6, 23, 59, 59, 999);

    // Für DB-Queries: Range erweitern um Timezone-Offset (Feiertage/Abwesenheiten sind als
    // Lokalzeit-Mitternacht gespeichert, was in UTC auf den Vortag fallen kann)
    const queryStart = new Date(weekStart);
    queryStart.setDate(queryStart.getDate() - 1);
    const queryEnd = new Date(weekEnd);
    queryEnd.setDate(queryEnd.getDate() + 1);

    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { weeklyHours: true, workDays: true, startDate: true, endDate: true },
    });

    const workDays = (employee?.workDays ?? '1,2,3,4,5').split(',').map(Number);
    const dailyHours = workDays.length > 0 ? (employee?.weeklyHours ?? 40) / workDays.length : 0;
    const empStart = (employee as any)?.startDate ? new Date((employee as any).startDate) : null;
    const empEnd = (employee as any)?.endDate ? new Date((employee as any).endDate) : null;

    // Feiertage laden (erweiterte Range für Timezone-Sicherheit)
    const holidays = await prisma.holiday.findMany({
      where: { date: { gte: queryStart, lte: queryEnd } },
    });
    // Lokale Datumskeys verwenden (nicht UTC!)
    const holidaySet = new Set(holidays.map(h =>
      `${h.date.getFullYear()}-${String(h.date.getMonth() + 1).padStart(2, '0')}-${String(h.date.getDate()).padStart(2, '0')}`
    ));

    // Abwesenheiten laden (erweiterte Range für Timezone-Sicherheit)
    const absences = await prisma.employeeAbsence.findMany({
      where: {
        employeeId: req.employee!.id,
        date: { gte: queryStart, lte: queryEnd },
      },
      include: { absenceType: true },
    });
    const absenceMap = new Map<string, { hours: number; type: string }>();
    absences.forEach(a => {
      // Lokale Datumskeys verwenden (nicht UTC!)
      const key = `${a.date.getFullYear()}-${String(a.date.getMonth() + 1).padStart(2, '0')}-${String(a.date.getDate()).padStart(2, '0')}`;
      absenceMap.set(key, { hours: a.absenceType.requiredHours, type: a.absenceType.name });
    });

    // Pro Tag berechnen
    const days: Record<string, { target: number; holiday?: string; absence?: string }> = {};
    for (let d = 0; d < 7; d++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + d);
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const dow = date.getDay();
      const dowMapped = dow === 0 ? 7 : dow;

      // Vor Eintrittsdatum oder nach Austrittsdatum
      if (empStart && date < empStart) { days[dateStr] = { target: 0 }; continue; }
      if (empEnd && date > empEnd) { days[dateStr] = { target: 0 }; continue; }

      // Kein Arbeitstag
      if (!workDays.includes(dowMapped)) { days[dateStr] = { target: 0 }; continue; }

      // Feiertag
      if (holidaySet.has(dateStr)) {
        const hol = holidays.find(h => {
          const hd = `${h.date.getFullYear()}-${String(h.date.getMonth() + 1).padStart(2, '0')}-${String(h.date.getDate()).padStart(2, '0')}`;
          return hd === dateStr;
        });
        days[dateStr] = { target: 0, holiday: hol?.name || 'Feiertag' };
        continue;
      }

      // Abwesenheit
      if (absenceMap.has(dateStr)) {
        const abs = absenceMap.get(dateStr)!;
        days[dateStr] = { target: abs.hours, absence: abs.type };
        continue;
      }

      days[dateStr] = { target: dailyHours };
    }

    res.json({ days, weeklyHours: employee?.weeklyHours ?? 40 });
  } catch (error) {
    console.error('Week targets error:', error);
    res.status(500).json({ error: 'Fehler beim Berechnen der Wochenziele' });
  }
});

// Statistiken für aktuellen Monat
router.get('/my/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now);
    const dayOfWeek = now.getDay(); // 0=So, 1=Mo, ...
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startOfWeek.setDate(now.getDate() - daysToMonday); // Montag
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);

    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { weeklyHours: true, vacationDaysPerYear: true, workDays: true, startDate: true, endDate: true,
        initialVacationDaysUsed: true, initialSickDays: true, initialBalanceYear: true, initialBalanceMonth: true },
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

    // Arbeitstage-Filter
    const empWorkDays = (employee?.workDays ?? '1,2,3,4,5').split(',').map(Number);
    const isEmpWorkDay = (d: Date) => empWorkDays.includes(d.getDay() === 0 ? 7 : d.getDay());

    // Urlaubstage dieses Jahr zählen (nur Arbeitstage mit countsAsVacation=true)
    const vacAbsYear = await prisma.employeeAbsence.findMany({
      where: { employeeId: req.employee!.id, date: { gte: startOfYear, lte: endOfYear }, absenceType: { countsAsVacation: true } },
    });
    const vacationAbsences = vacAbsYear.filter(a => isEmpWorkDay(a.date)).length;

    const sickAbsYear = await prisma.employeeAbsence.findMany({
      where: { employeeId: req.employee!.id, date: { gte: startOfYear, lte: endOfYear }, absenceType: { name: { contains: 'Krank' } } },
    });
    const sickDaysYear = sickAbsYear.filter(a => isEmpWorkDay(a.date)).length;

    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const sickAbsMonth = await prisma.employeeAbsence.findMany({
      where: { employeeId: req.employee!.id, date: { gte: startOfMonth, lte: endOfMonth }, absenceType: { name: { contains: 'Krank' } } },
    });
    const sickDaysMonth = sickAbsMonth.filter(a => isEmpWorkDay(a.date)).length;

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

    // Wochensoll berechnen (berücksichtigt Abwesenheiten + Feiertage in der Woche)
    const nominalWeeklyTarget = employee?.weeklyHours ?? 40;
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);
    const weekHolidays = await prisma.holiday.findMany({
      where: { date: { gte: startOfWeek, lte: weekEnd } },
    });
    const weekAbsences = await prisma.employeeAbsence.findMany({
      where: { employeeId: req.employee!.id, date: { gte: startOfWeek, lte: weekEnd } },
      include: { absenceType: true },
    });
    // Berechne tatsächliches Wochensoll
    const wWorkDays = (employee?.workDays ?? '1,2,3,4,5').split(',').map(Number);
    const wDailyHours = wWorkDays.length > 0 ? nominalWeeklyTarget / wWorkDays.length : 0;
    const wEmpStart = (employee as any)?.startDate ? new Date((employee as any).startDate) : null;
    const wEmpEnd = (employee as any)?.endDate ? new Date((employee as any).endDate) : null;
    let weeklyTarget = 0;
    for (let d = new Date(startOfWeek); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      if (wEmpStart && d < wEmpStart) continue;
      if (wEmpEnd && d > wEmpEnd) continue;
      const dw = d.getDay();
      if (!wWorkDays.includes(dw === 0 ? 7 : dw)) continue;
      const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const isHol = weekHolidays.some(h => `${h.date.getFullYear()}-${String(h.date.getMonth() + 1).padStart(2, '0')}-${String(h.date.getDate()).padStart(2, '0')}` === dk);
      if (isHol) continue;
      const abs = weekAbsences.find(a => `${a.date.getFullYear()}-${String(a.date.getMonth() + 1).padStart(2, '0')}-${String(a.date.getDate()).padStart(2, '0')}` === dk);
      if (abs) { weeklyTarget += abs.absenceType.requiredHours; }
      else { weeklyTarget += wDailyHours; }
    }
    weeklyTarget = Math.round(weeklyTarget * 100) / 100;
    const weekOvertime = weekHours - weeklyTarget;

    // Monatssoll berechnen: Arbeitstage im Monat BIS HEUTE × tägliche Stunden
    // Berücksichtigt Eintrittsdatum, Austrittsdatum, Feiertage und Abwesenheiten
    const workDaysArray = (employee?.workDays ?? '1,2,3,4,5').split(',').map(Number);
    const dailyHours = workDaysArray.length > 0 ? nominalWeeklyTarget / workDaysArray.length : 0;
    const todayDate = now.getDate(); // Nur bis heute rechnen, nicht ganzer Monat
    const empStartDate = (employee as any)?.startDate ? new Date((employee as any).startDate) : null;
    const empEndDate = (employee as any)?.endDate ? new Date((employee as any).endDate) : null;

    // Hilfsfunktion: Datum als lokalen String (YYYY-MM-DD) ohne Zeitzonen-Probleme
    const toDateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // DB-Daten (Holidays/Absences) werden als Mitternacht Lokalzeit gespeichert,
    // was in UTC auf den Vortag fallen kann (z.B. 22:00 UTC = 00:00 CEST).
    // Daher Lokalzeit verwenden, nicht UTC.
    const toDateKeyFromDb = (d: Date) => {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // Feiertage und Abwesenheiten laden
    const monthHolidays = await prisma.holiday.findMany({
      where: { date: { gte: startOfMonth, lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) } },
    });
    const holidaySet = new Set(monthHolidays.map(h => toDateKeyFromDb(h.date)));

    const monthAbsences = await prisma.employeeAbsence.findMany({
      where: {
        employeeId: req.employee!.id,
        date: { gte: startOfMonth, lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) },
      },
      include: { absenceType: true },
    });
    const absenceMap = new Map<string, number>();
    monthAbsences.forEach(a => absenceMap.set(toDateKeyFromDb(a.date), a.absenceType.requiredHours));

    let monthlyTarget = 0;
    for (let d = 1; d <= todayDate; d++) {
      const date = new Date(now.getFullYear(), now.getMonth(), d);
      if (empStartDate && date < empStartDate) continue;
      if (empEndDate && date > empEndDate) continue;
      const dayOfWeek = date.getDay();
      if (!workDaysArray.includes(dayOfWeek === 0 ? 7 : dayOfWeek)) continue;

      const dateStr = toDateKey(date);
      // Feiertag → 0 Soll
      if (holidaySet.has(dateStr)) continue;
      // Abwesenheit → requiredHours (0 bei Urlaub/Krank, >0 bei Schule)
      if (absenceMap.has(dateStr)) {
        monthlyTarget += absenceMap.get(dateStr)!;
      } else {
        monthlyTarget += dailyHours;
      }
    }
    monthlyTarget = Math.round(monthlyTarget * 100) / 100;
    const monthOvertime = monthHours - monthlyTarget;

    // Kumulativer Überstunden-Saldo: letzter finalisierter Report + aktueller Monat
    const lastReport = await prisma.monthlyReport.findFirst({
      where: { employeeId: req.employee!.id, status: 'finalized' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { cumulativeOvertimeBalance: true, year: true, month: true },
    });

    let totalOvertimeBalance: number;
    if (lastReport && (lastReport.year > now.getFullYear() ||
        (lastReport.year === now.getFullYear() && lastReport.month >= now.getMonth() + 1))) {
      // Letzter Report ist aktueller Monat oder später → direkt verwenden
      totalOvertimeBalance = lastReport.cumulativeOvertimeBalance;
    } else {
      // Letzter Report ist älter → Saldo + alle nicht-finalisierten Monate dazwischen berechnen
      const baseBalance = lastReport?.cumulativeOvertimeBalance ?? 0;

      // Nicht-finalisierte Monate seit dem letzten Report summieren
      // Einfacher Ansatz: Saldo bis Ende Vormonat + aktuellen Monat
      // Hole den initialOvertimeBalance falls kein Report existiert
      let previousBalance = baseBalance;
      if (!lastReport) {
        const emp = await prisma.employee.findUnique({
          where: { id: req.employee!.id },
          select: { initialOvertimeBalance: true },
        });
        previousBalance = emp?.initialOvertimeBalance ?? 0;
      }
      totalOvertimeBalance = Math.round((previousBalance + monthOvertime) * 100) / 100;
    }

    // Urlaubstage berechnen (inkl. importierte Anfangswerte)
    const vacationDaysTotal = employee?.vacationDaysPerYear ?? 30;
    const initialYear = (employee as any)?.initialBalanceYear;
    const initialInCurrentYear = initialYear === now.getFullYear();
    const initialVacUsed = initialInCurrentYear ? ((employee as any)?.initialVacationDaysUsed ?? 0) : 0;
    const initialSick = initialInCurrentYear ? ((employee as any)?.initialSickDays ?? 0) : 0;
    const vacationDaysUsed = vacationAbsences + initialVacUsed;
    // Manuelle Anpassungen + Minusstunden-Abzüge
    const statsAdjustments = await prisma.vacationAdjustment.findMany({ where: { employeeId: req.employee!.id, year: now.getFullYear() } });
    const statsAdjDays = statsAdjustments.reduce((s, a) => s + a.days, 0);
    const statsDeductions = await prisma.vacationDeduction.findMany({ where: { employeeId: req.employee!.id, year: now.getFullYear() } });
    const statsDeductDays = statsDeductions.reduce((s, d) => s + d.daysDeducted, 0);
    const vacationDaysRemaining = vacationDaysTotal - vacationDaysUsed - statsDeductDays + statsAdjDays;

    // Tages-Berechnung: Soll und bereits gearbeitet heute
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const todayEntries = await prisma.timeEntry.findMany({
      where: { employeeId: req.employee!.id, clockIn: { gte: todayStart, lte: todayEnd } },
    });
    let todayWorked = 0;
    for (const entry of todayEntries) {
      if (entry.clockOut) {
        todayWorked += (entry.clockOut.getTime() - entry.clockIn.getTime()) / (1000 * 60 * 60);
      } else {
        // Noch eingestempelt – aktuelle Zeit verwenden
        todayWorked += (now.getTime() - entry.clockIn.getTime()) / (1000 * 60 * 60);
      }
    }
    todayWorked = Math.round(todayWorked * 100) / 100;

    // Tagessoll: Wochenstunden / Anzahl Arbeitstage (nur wenn heute ein Arbeitstag ist)
    const todayDow = now.getDay();
    const isTodayWorkDay = empWorkDays.includes(todayDow === 0 ? 7 : todayDow);
    const todayDateKey = toDateKey(now);
    const todayHoliday = holidaySet.has(todayDateKey);
    const todayAbsence = absenceMap.has(todayDateKey);
    const isBeforeStart = empStartDate && now < empStartDate;
    const isAfterEnd = empEndDate && now > empEndDate;

    let dailyTarget = 0;
    if (isTodayWorkDay && !todayHoliday && !isBeforeStart && !isAfterEnd) {
      if (todayAbsence) {
        dailyTarget = absenceMap.get(todayDateKey)! / 60; // absenceMap hat Minuten aus dem monthly calc? Nein, requiredHours
      } else {
        dailyTarget = empWorkDays.length > 0 ? (employee?.weeklyHours ?? 40) / empWorkDays.length : 0;
      }
    }
    if (todayAbsence) {
      dailyTarget = absenceMap.get(todayDateKey)!;
    }
    dailyTarget = Math.round(dailyTarget * 100) / 100;
    const todayRemaining = Math.max(0, dailyTarget - todayWorked);

    res.json({
      monthHours: Math.round(monthHours * 100) / 100,
      weekHours: Math.round(weekHours * 100) / 100,
      weeklyTarget,
      weekOvertime: Math.round(weekOvertime * 100) / 100,
      monthlyTarget,
      monthOvertime: Math.round(monthOvertime * 100) / 100,
      entriesThisMonth: monthEntries.length,
      vacationDaysTotal,
      vacationDaysUsed,
      vacationDaysRemaining,
      sickDaysMonth,
      sickDaysYear: sickDaysYear + initialSick,
      totalOvertimeBalance,
      dailyTarget,
      todayWorked,
      todayRemaining,
      isTodayWorkDay: isTodayWorkDay && !todayHoliday && !isBeforeStart && !isAfterEnd,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

// ==================== URLAUBSÜBERSICHT ====================

// Hilfsfunktion: Urlaubsübersicht berechnen
async function calcVacationDetails(employeeId: string, year: number) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { vacationDaysPerYear: true, carryOverVacationDays: true, workDays: true,
      initialVacationDaysUsed: true, initialSickDays: true, initialBalanceYear: true },
  });
  if (!employee) return null;

  const workDayNums = employee.workDays.split(',').map(Number);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);

  // Importierte Anfangswerte (nur wenn Stichtag im selben Jahr)
  const initialInYear = (employee as any).initialBalanceYear === year;
  const initialVacUsed = initialInYear ? ((employee as any).initialVacationDaysUsed ?? 0) : 0;

  // Reguläre Urlaubstage (countsAsVacation=true, nur Arbeitstage)
  const vacationAbsences = await prisma.employeeAbsence.findMany({
    where: { employeeId, date: { gte: yearStart, lte: yearEnd }, absenceType: { countsAsVacation: true } },
    include: { absenceType: true },
  });
  const vacationUsed = vacationAbsences.filter(a => workDayNums.includes(new Date(a.date).getDay())).length + initialVacUsed;

  // Sonderurlaub (countsAsVacation=false, aber nicht Krank/Schule etc.)
  const specialAbsences = await prisma.employeeAbsence.findMany({
    where: { employeeId, date: { gte: yearStart, lte: yearEnd }, absenceType: { countsAsVacation: false, name: { contains: 'Sonderurlaub' } } },
    include: { absenceType: true },
  });
  const specialLeaveUsed = specialAbsences.filter(a => workDayNums.includes(new Date(a.date).getDay())).length;

  // Minusstunden-Abzüge
  const deductions = await prisma.vacationDeduction.findMany({
    where: { employeeId, year },
    orderBy: { createdAt: 'asc' },
  });
  const deductedDays = deductions.reduce((s, d) => s + d.daysDeducted, 0);

  // Manuelle Urlaubsanpassungen
  const adjustments = await prisma.vacationAdjustment.findMany({
    where: { employeeId, year },
    orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
  });
  const adjustmentDays = adjustments.reduce((s, a) => s + a.days, 0);

  const carryOver = (employee as any).carryOverVacationDays || 0;
  const annual = employee.vacationDaysPerYear;
  const totalAvailable = carryOver + annual - deductedDays + adjustmentDays;
  const carryOverUsed = Math.min(carryOver, vacationUsed);
  const annualUsed = vacationUsed - carryOverUsed;

  return {
    year,
    carryOver,
    carryOverUsed,
    carryOverRemaining: carryOver - carryOverUsed,
    annual,
    annualUsed,
    annualRemaining: annual - annualUsed - deductedDays + adjustmentDays,
    total: totalAvailable,
    totalUsed: vacationUsed,
    totalRemaining: totalAvailable - vacationUsed,
    specialLeaveUsed,
    deductedDays,
    adjustmentDays,
    adjustments: adjustments.map(a => ({
      id: a.id, month: a.month, days: a.days, reason: a.reason, createdBy: a.createdBy, date: a.createdAt,
    })),
    deductions: deductions.map(d => ({
      month: d.month,
      days: d.daysDeducted,
      hours: d.hoursCompensated,
      reason: d.reason,
      date: d.createdAt,
    })),
  };
}

// Detaillierte Urlaubsübersicht für den aktuellen User
router.get('/my/vacation-details', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const details = await calcVacationDetails(req.employee!.id, year);
    if (!details) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden der Urlaubsübersicht' });
  }
});

// Urlaubsübersicht für beliebigen MA (Admin)
router.get('/vacation-details/:employeeId', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const details = await calcVacationDetails(req.params.employeeId, year);
    if (!details) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden der Urlaubsübersicht' });
  }
});

// ==================== URLAUBSANPASSUNGEN ====================

// Urlaubsanpassungen für einen MA abrufen
router.get('/vacation-adjustments/:employeeId', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId } = req.params;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const adjustments = await prisma.vacationAdjustment.findMany({
      where: { employeeId, year },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(adjustments);
  } catch (error) {
    console.error('Get vacation adjustments error:', error);
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
});

// Urlaubsanpassung erstellen
router.post('/vacation-adjustments', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      employeeId: z.string().uuid(),
      year: z.number().int().min(2020).max(2100),
      month: z.number().int().min(1).max(12),
      days: z.number().refine(d => d !== 0, 'Tage dürfen nicht 0 sein'),
      reason: z.string().min(1, 'Begründung erforderlich'),
    });
    const data = schema.parse(req.body);

    const adjustment = await prisma.vacationAdjustment.create({
      data: {
        ...data,
        createdBy: `${req.employee!.firstName} ${req.employee!.lastName}`,
      },
    });

    const emp = await prisma.employee.findUnique({ where: { id: data.employeeId }, select: { firstName: true, lastName: true } });
    await createAuditLog({
      req,
      action: 'CREATE',
      entityType: 'VacationAdjustment',
      entityId: adjustment.id,
      newValues: { days: data.days, month: data.month, year: data.year, reason: data.reason },
      note: `Urlaubsanpassung ${data.days > 0 ? '+' : ''}${data.days} Tage für ${emp?.firstName} ${emp?.lastName}`,
    });

    res.json(adjustment);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0].message });
    console.error('Create vacation adjustment error:', error);
    res.status(500).json({ error: 'Fehler beim Speichern' });
  }
});

// Urlaubsanpassung löschen
router.delete('/vacation-adjustments/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const adj = await prisma.vacationAdjustment.findUnique({ where: { id } });
    if (!adj) return res.status(404).json({ error: 'Nicht gefunden' });

    await prisma.vacationAdjustment.delete({ where: { id } });
    await createAuditLog({ req, action: 'DELETE', entityType: 'VacationAdjustment', entityId: id, oldValues: { days: adj.days, reason: adj.reason } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete vacation adjustment error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// ==================== PWA-STEMPELUNG ====================

// PWA Clock-In
router.post('/pwa/clock-in', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.employee!.id } });
    if (employee?.startDate && new Date(employee.startDate) > new Date()) {
      return res.status(403).json({ error: `Du kannst dich erst ab dem ${new Date(employee.startDate).toLocaleDateString('de-DE')} einstempeln` });
    }
    if (employee?.endDate && new Date(employee.endDate) <= new Date()) {
      return res.status(403).json({ error: 'Dein Arbeitsverhältnis ist beendet' });
    }
    if (!employee?.canClockInPwa) {
      return res.status(403).json({ error: 'PWA-Einstempeln ist für dich nicht aktiviert' });
    }

    // Prüfe ob bereits eingestempelt
    const active = await prisma.timeEntry.findFirst({
      where: { employeeId: employee.id, clockOut: null },
    });
    if (active) {
      return res.status(400).json({ error: 'Du bist bereits eingestempelt' });
    }

    const { latitude, longitude, reasonId, reasonText } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Standort ist erforderlich' });
    }
    if (!reasonId && !reasonText) {
      return res.status(400).json({ error: 'Bitte einen Grund angeben' });
    }

    // Grund-Name laden
    let reasonName = reasonText || '';
    if (reasonId) {
      const reason = await prisma.pwaClockReason.findUnique({ where: { id: reasonId } });
      reasonName = reason?.name || reasonText || '';
    }

    // Adresse ermitteln
    const address = await reverseGeocode(latitude, longitude);

    const entry = await prisma.timeEntry.create({
      data: {
        employeeId: employee.id,
        clockIn: new Date(),
        clockInViaPwa: true,
        clockInLatitude: latitude,
        clockInLongitude: longitude,
        pwaClockInReasonId: reasonId || null,
        pwaClockInReasonText: reasonName,
        note: `Auswärts eingestempelt: ${address} (${reasonName})`,
      },
    });

    // WebSocket Event
    io.emit('employee-clocked-in', {
      employeeId: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      clockIn: entry.clockIn,
      viaPwa: true,
    });

    // Admin-E-Mail senden
    sendPwaNotificationEmail(employee, 'clock-in', latitude, longitude, reasonName, entry.clockIn);

    await createAuditLog({
      req: req as any,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'CLOCK_IN',
      entityType: 'TimeEntry',
      entityId: entry.id,
      note: `PWA-Einstempeln (${reasonName}) - Standort: ${latitude}, ${longitude}`,
    });

    res.json({ entry, message: 'Erfolgreich eingestempelt' });
  } catch (error) {
    console.error('PWA clock-in error:', error);
    res.status(500).json({ error: 'Fehler beim Einstempeln' });
  }
});

// PWA Clock-Out
router.post('/pwa/clock-out', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.employee!.id } });
    if (!employee?.canClockOutPwa) {
      return res.status(403).json({ error: 'PWA-Ausstempeln ist für dich nicht aktiviert' });
    }

    const active = await prisma.timeEntry.findFirst({
      where: { employeeId: employee.id, clockOut: null },
    });
    if (!active) {
      return res.status(400).json({ error: 'Du bist nicht eingestempelt' });
    }

    const { latitude, longitude, reasonId, reasonText } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Standort ist erforderlich' });
    }
    if (!reasonId && !reasonText) {
      return res.status(400).json({ error: 'Bitte einen Grund angeben' });
    }

    let reasonName = reasonText || '';
    if (reasonId) {
      const reason = await prisma.pwaClockReason.findUnique({ where: { id: reasonId } });
      reasonName = reason?.name || reasonText || '';
    }

    const now = new Date();
    const address = await reverseGeocode(latitude, longitude);

    // Note ergänzen (bestehende Note beibehalten)
    const existingNote = active.note || '';
    const outNote = `Auswärts ausgestempelt: ${address} (${reasonName})`;
    const combinedNote = existingNote ? `${existingNote} | ${outNote}` : outNote;

    const entry = await prisma.timeEntry.update({
      where: { id: active.id },
      data: {
        clockOut: now,
        clockOutViaPwa: true,
        clockOutLatitude: latitude,
        clockOutLongitude: longitude,
        pwaClockOutReasonId: reasonId || null,
        pwaClockOutReasonText: reasonName,
        note: combinedNote,
      },
    });

    io.emit('employee-clocked-out', {
      employeeId: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      clockOut: now,
      viaPwa: true,
    });

    sendPwaNotificationEmail(employee, 'clock-out', latitude, longitude, reasonName, now);

    await createAuditLog({
      req: req as any,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'CLOCK_OUT',
      entityType: 'TimeEntry',
      entityId: entry.id,
      note: `PWA-Ausstempeln (${reasonName}) - Standort: ${latitude}, ${longitude}`,
    });

    res.json({ entry, message: 'Erfolgreich ausgestempelt' });
  } catch (error) {
    console.error('PWA clock-out error:', error);
    res.status(500).json({ error: 'Fehler beim Ausstempeln' });
  }
});

// PWA-Stempel-Gründe abrufen
router.get('/pwa/reasons', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const reasons = await prisma.pwaClockReason.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(reasons);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden der Gründe' });
  }
});

// PWA-Berechtigung des aktuellen Users prüfen
router.get('/pwa/permissions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { canClockInPwa: true, canClockOutPwa: true },
    });
    res.json(employee || { canClockInPwa: false, canClockOutPwa: false });
  } catch (error) {
    res.status(500).json({ error: 'Fehler' });
  }
});

// Reverse Geocoding: Koordinaten → Adresse
async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=de`,
      { headers: { 'User-Agent': 'Zeiterfassung/1.0' } },
    );
    const data = await res.json();
    if (data.address) {
      const a = data.address;
      const street = a.road || a.pedestrian || a.footway || '';
      const number = a.house_number || '';
      const city = a.city || a.town || a.village || a.municipality || '';
      const postcode = a.postcode || '';
      const parts = [
        street && number ? `${street} ${number}` : street,
        postcode && city ? `${postcode} ${city}` : city,
      ].filter(Boolean);
      return parts.join(', ') || data.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
    return data.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  } catch {
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }
}

// Admin E-Mail bei Auswärtsstempelung
async function sendPwaNotificationEmail(
  employee: { firstName: string; lastName: string; employeeNumber: string },
  action: 'clock-in' | 'clock-out',
  latitude: number,
  longitude: number,
  reason: string,
  timestamp: Date,
) {
  try {
    const admins = await prisma.employee.findMany({
      where: { isAdmin: true, isActive: true, email: { not: null } },
      select: { email: true },
    });
    const adminEmails = admins.filter(a => a.email).map(a => a.email!);
    if (adminEmails.length === 0) return;

    const address = await reverseGeocode(latitude, longitude);
    const actionText = action === 'clock-in' ? 'eingestempelt' : 'ausgestempelt';
    const actionLabel = action === 'clock-in' ? 'Einstempeln' : 'Ausstempeln';
    const actionIcon = action === 'clock-in' ? '🟢' : '🔴';
    const headerColor = action === 'clock-in' ? '#16a34a' : '#dc2626';
    const time = timestamp.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const mapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;

    await sendEmail({
      to: adminEmails,
      subject: `Auswärtsstempelung: ${employee.firstName} ${employee.lastName} – ${actionLabel}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
          <div style="background: ${headerColor}; color: white; padding: 24px;">
            <h2 style="margin: 0; font-size: 18px;">Auswärtsstempelung</h2>
            <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">${employee.firstName} ${employee.lastName} hat sich auswärts ${actionText}</p>
          </div>
          <div style="background: white; padding: 24px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; color: #6b7280; width: 90px; vertical-align: top; font-size: 14px;">Aktion</td>
                <td style="padding: 10px 0; font-weight: 600; font-size: 14px;">${actionIcon} ${actionLabel}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #6b7280; vertical-align: top; font-size: 14px;">Mitarbeiter</td>
                <td style="padding: 10px 0; font-size: 14px;">${employee.firstName} ${employee.lastName} (${employee.employeeNumber})</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #6b7280; vertical-align: top; font-size: 14px;">Zeitpunkt</td>
                <td style="padding: 10px 0; font-size: 14px;">${time} Uhr</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #6b7280; vertical-align: top; font-size: 14px;">Grund</td>
                <td style="padding: 10px 0; font-size: 14px;">${reason}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #6b7280; vertical-align: top; font-size: 14px;">Standort</td>
                <td style="padding: 10px 0; font-size: 14px;">
                  📍 ${address}
                </td>
              </tr>
            </table>
            <div style="margin-top: 20px; text-align: center;">
              <a href="${mapUrl}" style="display: inline-block; padding: 10px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500;">
                Standort auf Karte anzeigen
              </a>
            </div>
          </div>
          <div style="background: #f9fafb; padding: 14px 24px; text-align: center; color: #9ca3af; font-size: 12px;">
            Zeiterfassung – Automatische Benachrichtigung
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error('Notification email error:', error);
  }
}

// ==================== REKLAMATIONEN ====================

// Eigenständige Reklamation erstellen (ohne bestehenden Zeiteintrag, z.B. Karte vergessen)
router.post('/complaint/standalone', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      date: z.string().min(1, 'Datum erforderlich'),
      message: z.string().min(1, 'Bitte geben Sie eine Nachricht ein').max(1000),
    });

    const { date, message } = schema.parse(req.body);

    // Datum parsen (YYYY-MM-DD)
    const dayDate = new Date(date + 'T00:00:00');
    if (isNaN(dayDate.getTime())) {
      return res.status(400).json({ error: 'Ungültiges Datum' });
    }

    // Nicht in der Zukunft erlauben
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (dayDate > today) {
      return res.status(400).json({ error: 'Reklamationen können nicht für zukünftige Tage erstellt werden' });
    }

    // Duplikat-Prüfung: Existiert bereits eine Reklamation für diesen Tag?
    const dayStart = new Date(dayDate);
    const dayEnd = new Date(dayDate);
    dayEnd.setHours(23, 59, 59, 999);

    const existingComplaint = await prisma.timeEntry.findFirst({
      where: {
        employeeId: req.employee!.id,
        complaintMessage: { not: null },
        clockIn: { gte: dayStart, lte: dayEnd },
      },
    });

    if (existingComplaint) {
      return res.status(400).json({ error: 'Für diesen Tag existiert bereits eine Reklamation.' });
    }

    // Placeholder-TimeEntry erstellen mit Reklamation
    // clockOut = clockIn (0 Minuten), damit Auto-Ausstempeln den Eintrag ignoriert
    const entry = await prisma.timeEntry.create({
      data: {
        employeeId: req.employee!.id,
        clockIn: dayDate,
        clockOut: dayDate,
        breakMinutes: 0,
        complaintMessage: message,
        complaintAt: new Date(),
        complaintOriginalClockIn: null,
        complaintOriginalClockOut: null,
        complaintOriginalBreakMinutes: null,
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'COMPLAINT_CREATE',
      entityType: 'TimeEntry',
      entityId: entry.id,
      oldValues: null,
      newValues: { complaintMessage: message, date, standalone: true },
    });

    // E-Mail an Admins
    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { firstName: true, lastName: true },
    });

    if (employee) {
      sendComplaintNotification(
        `${employee.firstName} ${employee.lastName}`,
        dayDate,
        '-',
        null,
        message
      ).catch((err) => {
        console.error('Fehler beim Senden der Reklamations-E-Mail:', err);
      });
    }

    res.json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create standalone complaint error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Reklamation' });
  }
});

// Meine Reklamationen abrufen
router.get('/my/complaints', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const entries = await prisma.timeEntry.findMany({
      where: {
        employeeId: req.employee!.id,
        complaintMessage: { not: null },
      },
      orderBy: { complaintAt: 'desc' },
      select: {
        id: true,
        clockIn: true,
        clockOut: true,
        breakMinutes: true,
        note: true,
        complaintMessage: true,
        complaintAt: true,
        complaintResolvedAt: true,
        complaintResolvedBy: true,
        complaintResponse: true,
        complaintOriginalClockIn: true,
        complaintOriginalClockOut: true,
        complaintOriginalBreakMinutes: true,
      },
    });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden der Reklamationen' });
  }
});

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
