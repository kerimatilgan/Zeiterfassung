import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../bindings.js';
import { createAuditLog } from '../utils/auditLog.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Zeiteintraege fuer aktuellen Benutzer
app.get('/my', async (c) => {
  try {
    const prisma = c.get('prisma');
    const employee = c.get('employee');
    const from = c.req.query('from');
    const to = c.req.query('to');

    const where: any = { employeeId: employee.id };

    if (from) {
      where.clockIn = { ...where.clockIn, gte: new Date(from) };
    }
    if (to) {
      where.clockIn = { ...where.clockIn, lte: new Date(to) };
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      orderBy: { clockIn: 'desc' },
      take: 100,
    });

    return c.json(entries);
  } catch (error) {
    console.error('Get my time entries error:', error);
    return c.json({ error: 'Fehler beim Laden der Zeiteintraege' }, 500);
  }
});

// Aktueller Status (eingestempelt?)
app.get('/my/status', async (c) => {
  try {
    const prisma = c.get('prisma');
    const employee = c.get('employee');

    const activeEntry = await prisma.timeEntry.findFirst({
      where: {
        employeeId: employee.id,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    return c.json({
      isClockedIn: !!activeEntry,
      activeEntry,
    });
  } catch (error) {
    console.error('Get status error:', error);
    return c.json({ error: 'Fehler beim Laden des Status' }, 500);
  }
});

// Alle Zeiteintraege (Admin)
app.get('/', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const employeeId = c.req.query('employeeId');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const limit = c.req.query('limit') || '100';

    const where: any = {};

    if (employeeId) {
      where.employeeId = employeeId;
    }
    if (from) {
      where.clockIn = { ...where.clockIn, gte: new Date(from) };
    }
    if (to) {
      where.clockIn = { ...where.clockIn, lte: new Date(to) };
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
      take: parseInt(limit),
    });

    return c.json(entries);
  } catch (error) {
    console.error('Get time entries error:', error);
    return c.json({ error: 'Fehler beim Laden der Zeiteintraege' }, 500);
  }
});

// Manuell einstempeln (Admin)
app.post('/manual', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const schema = z.object({
      employeeId: z.string().uuid(),
      clockIn: z.string().min(1),
      clockOut: z.union([z.string().min(1), z.string().max(0), z.null()]).optional(),
      breakMinutes: z.number().min(0).optional(),
      note: z.string().nullable().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    // Pruefen ob Mitarbeiter existiert
    const employee = await prisma.employee.findUnique({ where: { id: data.employeeId } });
    if (!employee) {
      return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    }

    const entry = await prisma.timeEntry.create({
      data: {
        employeeId: data.employeeId,
        clockIn: new Date(data.clockIn),
        clockOut: data.clockOut && data.clockOut.length > 0 ? new Date(data.clockOut) : null,
        breakMinutes: data.breakMinutes ?? 0,
        note: data.note,
        isManual: true,
        editedBy: `${emp.firstName} ${emp.lastName}`,
      },
    });

    // Audit Log
    await createAuditLog({
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
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

    // TODO: WebSocket event for manually created entry (io.emit not available in Workers)

    return c.json(entry, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create manual entry error:', error);
    return c.json({ error: 'Fehler beim Erstellen des Eintrags' }, 500);
  }
});

// Zeiteintrag bearbeiten (Admin)
app.put('/:id', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');

    const schema = z.object({
      clockIn: z.string().min(1).optional(),
      clockOut: z.union([z.string().min(1), z.string().max(0), z.null()]).optional(),
      breakMinutes: z.number().min(0).optional(),
      note: z.union([z.string(), z.null()]).optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const existing = await prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: 'Zeiteintrag nicht gefunden' }, 404);
    }

    const entry = await prisma.timeEntry.update({
      where: { id },
      data: {
        ...(data.clockIn && { clockIn: new Date(data.clockIn) }),
        ...(data.clockOut !== undefined && { clockOut: data.clockOut ? new Date(data.clockOut) : null }),
        ...(data.breakMinutes !== undefined && { breakMinutes: data.breakMinutes }),
        ...(data.note !== undefined && { note: data.note }),
        editedBy: `${emp.firstName} ${emp.lastName}`,
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
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
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

    // TODO: WebSocket event for updated entry (io.emit not available in Workers)

    return c.json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Update entry error:', error);
    return c.json({ error: 'Fehler beim Aktualisieren des Eintrags' }, 500);
  }
});

// Pause einfuegen (Admin) - splittet einen Zeiteintrag in zwei Teile
app.post('/:id/insert-pause', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');
    const { pauseStart, pauseEnd } = await c.req.json();

    if (!pauseStart || !pauseEnd) {
      return c.json({ error: 'Pausenbeginn und -ende erforderlich' }, 400);
    }

    const pauseStartDate = new Date(pauseStart);
    const pauseEndDate = new Date(pauseEnd);

    if (pauseEndDate <= pauseStartDate) {
      return c.json({ error: 'Pausenende muss nach Pausenbeginn liegen' }, 400);
    }

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    if (!entry) {
      return c.json({ error: 'Zeiteintrag nicht gefunden' }, 404);
    }

    if (!entry.clockOut) {
      return c.json({ error: 'Nur bei abgeschlossenen Eintraegen moeglich' }, 400);
    }

    if (pauseStartDate < entry.clockIn || pauseEndDate > entry.clockOut) {
      return c.json({ error: 'Pause muss innerhalb des Zeiteintrags liegen' }, 400);
    }

    // Eintrag splitten: Original -> clockIn bis pauseStart, Neu -> pauseEnd bis clockOut
    const originalClockOut = entry.clockOut;

    await prisma.timeEntry.update({
      where: { id },
      data: {
        clockOut: pauseStartDate,
        editedBy: `${emp.firstName} ${emp.lastName}`,
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
        editedBy: `${emp.firstName} ${emp.lastName}`,
      },
    });

    await createAuditLog({
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
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
      note: `Pause eingefuegt fuer ${entry.employee.firstName} ${entry.employee.lastName}`,
    });

    return c.json({ entry1: { ...entry, clockOut: pauseStartDate }, entry2: newEntry });
  } catch (error) {
    console.error('Insert pause error:', error);
    return c.json({ error: 'Fehler beim Einfuegen der Pause' }, 500);
  }
});

// Zeiteintrag loeschen (Admin)
app.delete('/:id', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');

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
      return c.json({ error: 'Zeiteintrag nicht gefunden' }, 404);
    }

    await prisma.timeEntry.delete({ where: { id } });

    // Audit Log
    await createAuditLog({
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
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

    // TODO: WebSocket event for deleted entry (io.emit not available in Workers)

    return c.json({ message: 'Zeiteintrag geloescht' });
  } catch (error) {
    console.error('Delete entry error:', error);
    return c.json({ error: 'Fehler beim Loeschen des Eintrags' }, 500);
  }
});

// Taegliche Sollstunden fuer eine Woche (beruecksichtigt Feiertage, Abwesenheiten, Ein-/Austrittsdatum)
app.get('/my/week-targets', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    const from = c.req.query('from');

    if (!from) {
      return c.json({ error: 'from (Montag der Woche) erforderlich' }, 400);
    }

    // Wochenstart als lokales Datum parsen (YYYY-MM-DD)
    const [y, mo, d] = from.split('-').map(Number);
    const weekStart = new Date(y, mo - 1, d);
    const weekEnd = new Date(y, mo - 1, d + 6, 23, 59, 59, 999);

    // Fuer DB-Queries: Range erweitern um Timezone-Offset (Feiertage/Abwesenheiten sind als
    // Lokalzeit-Mitternacht gespeichert, was in UTC auf den Vortag fallen kann)
    const queryStart = new Date(weekStart);
    queryStart.setDate(queryStart.getDate() - 1);
    const queryEnd = new Date(weekEnd);
    queryEnd.setDate(queryEnd.getDate() + 1);

    const employee = await prisma.employee.findUnique({
      where: { id: emp.id },
      select: { weeklyHours: true, workDays: true, startDate: true, endDate: true },
    });

    const workDays = (employee?.workDays ?? '1,2,3,4,5').split(',').map(Number);
    const dailyHours = workDays.length > 0 ? (employee?.weeklyHours ?? 40) / workDays.length : 0;
    const empStart = (employee as any)?.startDate ? new Date((employee as any).startDate) : null;
    const empEnd = (employee as any)?.endDate ? new Date((employee as any).endDate) : null;

    // Feiertage laden (erweiterte Range fuer Timezone-Sicherheit)
    const holidays = await prisma.holiday.findMany({
      where: { date: { gte: queryStart, lte: queryEnd } },
    });
    // Lokale Datumskeys verwenden (nicht UTC!)
    const holidaySet = new Set(holidays.map(h =>
      `${h.date.getFullYear()}-${String(h.date.getMonth() + 1).padStart(2, '0')}-${String(h.date.getDate()).padStart(2, '0')}`
    ));

    // Abwesenheiten laden (erweiterte Range fuer Timezone-Sicherheit)
    const absences = await prisma.employeeAbsence.findMany({
      where: {
        employeeId: emp.id,
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
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
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

    return c.json({ days, weeklyHours: employee?.weeklyHours ?? 40 });
  } catch (error) {
    console.error('Week targets error:', error);
    return c.json({ error: 'Fehler beim Berechnen der Wochenziele' }, 500);
  }
});

// Statistiken fuer aktuellen Monat
app.get('/my/stats', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');

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
      where: { id: emp.id },
      select: { weeklyHours: true, vacationDaysPerYear: true, workDays: true, startDate: true, endDate: true,
        initialVacationDaysUsed: true, initialSickDays: true, initialBalanceYear: true, initialBalanceMonth: true },
    });

    // Alle Eintraege diesen Monat
    const monthEntries = await prisma.timeEntry.findMany({
      where: {
        employeeId: emp.id,
        clockIn: { gte: startOfMonth },
        clockOut: { not: null },
      },
    });

    // Alle Eintraege diese Woche
    const weekEntries = await prisma.timeEntry.findMany({
      where: {
        employeeId: emp.id,
        clockIn: { gte: startOfWeek },
        clockOut: { not: null },
      },
    });

    // Arbeitstage-Filter
    const empWorkDays = (employee?.workDays ?? '1,2,3,4,5').split(',').map(Number);
    const isEmpWorkDay = (d: Date) => empWorkDays.includes(d.getDay() === 0 ? 7 : d.getDay());

    // Urlaubstage dieses Jahr zaehlen (nur Arbeitstage mit countsAsVacation=true)
    const vacAbsYear = await prisma.employeeAbsence.findMany({
      where: { employeeId: emp.id, date: { gte: startOfYear, lte: endOfYear }, absenceType: { countsAsVacation: true } },
    });
    const vacationAbsences = vacAbsYear.filter(a => isEmpWorkDay(a.date)).length;

    const sickAbsYear = await prisma.employeeAbsence.findMany({
      where: { employeeId: emp.id, date: { gte: startOfYear, lte: endOfYear }, absenceType: { name: { contains: 'Krank' } } },
    });
    const sickDaysYear = sickAbsYear.filter(a => isEmpWorkDay(a.date)).length;

    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const sickAbsMonth = await prisma.employeeAbsence.findMany({
      where: { employeeId: emp.id, date: { gte: startOfMonth, lte: endOfMonth }, absenceType: { name: { contains: 'Krank' } } },
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

    // Wochensoll berechnen (beruecksichtigt Abwesenheiten + Feiertage in der Woche)
    const nominalWeeklyTarget = employee?.weeklyHours ?? 40;
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);
    const weekHolidays = await prisma.holiday.findMany({
      where: { date: { gte: startOfWeek, lte: weekEnd } },
    });
    const weekAbsences = await prisma.employeeAbsence.findMany({
      where: { employeeId: emp.id, date: { gte: startOfWeek, lte: weekEnd } },
      include: { absenceType: true },
    });
    // Berechne tatsaechliches Wochensoll
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

    // Monatssoll berechnen: Arbeitstage im Monat BIS HEUTE x taegliche Stunden
    // Beruecksichtigt Eintrittsdatum, Austrittsdatum, Feiertage und Abwesenheiten
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
        employeeId: emp.id,
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
      const dayOfWeekNum = date.getDay();
      if (!workDaysArray.includes(dayOfWeekNum === 0 ? 7 : dayOfWeekNum)) continue;

      const dateStr = toDateKey(date);
      // Feiertag -> 0 Soll
      if (holidaySet.has(dateStr)) continue;
      // Abwesenheit -> requiredHours (0 bei Urlaub/Krank, >0 bei Schule)
      if (absenceMap.has(dateStr)) {
        monthlyTarget += absenceMap.get(dateStr)!;
      } else {
        monthlyTarget += dailyHours;
      }
    }
    monthlyTarget = Math.round(monthlyTarget * 100) / 100;
    const monthOvertime = monthHours - monthlyTarget;

    // Kumulativer Ueberstunden-Saldo: letzter finalisierter Report + aktueller Monat
    const lastReport = await prisma.monthlyReport.findFirst({
      where: { employeeId: emp.id, status: 'finalized' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { cumulativeOvertimeBalance: true, year: true, month: true },
    });

    let totalOvertimeBalance: number;
    if (lastReport && (lastReport.year > now.getFullYear() ||
        (lastReport.year === now.getFullYear() && lastReport.month >= now.getMonth() + 1))) {
      // Letzter Report ist aktueller Monat oder spaeter -> direkt verwenden
      totalOvertimeBalance = lastReport.cumulativeOvertimeBalance;
    } else {
      // Letzter Report ist aelter -> Saldo + alle nicht-finalisierten Monate dazwischen berechnen
      const baseBalance = lastReport?.cumulativeOvertimeBalance ?? 0;

      // Nicht-finalisierte Monate seit dem letzten Report summieren
      // Einfacher Ansatz: Saldo bis Ende Vormonat + aktuellen Monat
      // Hole den initialOvertimeBalance falls kein Report existiert
      let previousBalance = baseBalance;
      if (!lastReport) {
        const empData = await prisma.employee.findUnique({
          where: { id: emp.id },
          select: { initialOvertimeBalance: true },
        });
        previousBalance = empData?.initialOvertimeBalance ?? 0;
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
    // Manuelle Anpassungen + Minusstunden-Abzuege
    const statsAdjustments = await prisma.vacationAdjustment.findMany({ where: { employeeId: emp.id, year: now.getFullYear() } });
    const statsAdjDays = statsAdjustments.reduce((s: number, a: any) => s + a.days, 0);
    const statsDeductions = await prisma.vacationDeduction.findMany({ where: { employeeId: emp.id, year: now.getFullYear() } });
    const statsDeductDays = statsDeductions.reduce((s: number, d: any) => s + d.daysDeducted, 0);
    const vacationDaysRemaining = vacationDaysTotal - vacationDaysUsed - statsDeductDays + statsAdjDays;

    // Tages-Berechnung: Soll und bereits gearbeitet heute
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const todayEntries = await prisma.timeEntry.findMany({
      where: { employeeId: emp.id, clockIn: { gte: todayStart, lte: todayEnd } },
    });
    let todayWorked = 0;
    for (const entry of todayEntries) {
      if (entry.clockOut) {
        todayWorked += (entry.clockOut.getTime() - entry.clockIn.getTime()) / (1000 * 60 * 60);
      } else {
        // Noch eingestempelt - aktuelle Zeit verwenden
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
        dailyTarget = absenceMap.get(todayDateKey)!;
      } else {
        dailyTarget = empWorkDays.length > 0 ? (employee?.weeklyHours ?? 40) / empWorkDays.length : 0;
      }
    }
    if (todayAbsence) {
      dailyTarget = absenceMap.get(todayDateKey)!;
    }
    dailyTarget = Math.round(dailyTarget * 100) / 100;
    const todayRemaining = Math.max(0, dailyTarget - todayWorked);

    return c.json({
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
    return c.json({ error: 'Fehler beim Laden der Statistiken' }, 500);
  }
});

// ==================== URLAUBSUEBERSICHT ====================

// Hilfsfunktion: Urlaubsuebersicht berechnen
async function calcVacationDetails(prisma: any, employeeId: string, year: number) {
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

  // Regulaere Urlaubstage (countsAsVacation=true, nur Arbeitstage)
  const vacationAbsences = await prisma.employeeAbsence.findMany({
    where: { employeeId, date: { gte: yearStart, lte: yearEnd }, absenceType: { countsAsVacation: true } },
    include: { absenceType: true },
  });
  const vacationUsed = vacationAbsences.filter((a: any) => workDayNums.includes(new Date(a.date).getDay())).length + initialVacUsed;

  // Sonderurlaub (countsAsVacation=false, aber nicht Krank/Schule etc.)
  const specialAbsences = await prisma.employeeAbsence.findMany({
    where: { employeeId, date: { gte: yearStart, lte: yearEnd }, absenceType: { countsAsVacation: false, name: { contains: 'Sonderurlaub' } } },
    include: { absenceType: true },
  });
  const specialLeaveUsed = specialAbsences.filter((a: any) => workDayNums.includes(new Date(a.date).getDay())).length;

  // Minusstunden-Abzuege
  const deductions = await prisma.vacationDeduction.findMany({
    where: { employeeId, year },
    orderBy: { createdAt: 'asc' },
  });
  const deductedDays = deductions.reduce((s: number, d: any) => s + d.daysDeducted, 0);

  // Manuelle Urlaubsanpassungen
  const adjustments = await prisma.vacationAdjustment.findMany({
    where: { employeeId, year },
    orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
  });
  const adjustmentDays = adjustments.reduce((s: number, a: any) => s + a.days, 0);

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
    adjustments: adjustments.map((a: any) => ({
      id: a.id, month: a.month, days: a.days, reason: a.reason, createdBy: a.createdBy, date: a.createdAt,
    })),
    deductions: deductions.map((d: any) => ({
      month: d.month,
      days: d.daysDeducted,
      hours: d.hoursCompensated,
      reason: d.reason,
      date: d.createdAt,
    })),
  };
}

// Detaillierte Urlaubsuebersicht fuer den aktuellen User
app.get('/my/vacation-details', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    const year = parseInt(c.req.query('year') || '') || new Date().getFullYear();
    const details = await calcVacationDetails(prisma, emp.id, year);
    if (!details) return c.json({ error: 'Nicht gefunden' }, 404);
    return c.json(details);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Urlaubsuebersicht' }, 500);
  }
});

// Urlaubsuebersicht fuer beliebigen MA (Admin)
app.get('/vacation-details/:employeeId', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const year = parseInt(c.req.query('year') || '') || new Date().getFullYear();
    const employeeId = c.req.param('employeeId');
    const details = await calcVacationDetails(prisma, employeeId, year);
    if (!details) return c.json({ error: 'Nicht gefunden' }, 404);
    return c.json(details);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Urlaubsuebersicht' }, 500);
  }
});

// ==================== URLAUBSANPASSUNGEN ====================

// Urlaubsanpassungen fuer einen MA abrufen
app.get('/vacation-adjustments/:employeeId', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const employeeId = c.req.param('employeeId');
    const year = parseInt(c.req.query('year') || '') || new Date().getFullYear();
    const adjustments = await prisma.vacationAdjustment.findMany({
      where: { employeeId, year },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
    });
    return c.json(adjustments);
  } catch (error) {
    console.error('Get vacation adjustments error:', error);
    return c.json({ error: 'Fehler beim Laden' }, 500);
  }
});

// Urlaubsanpassung erstellen
app.post('/vacation-adjustments', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const schema = z.object({
      employeeId: z.string().uuid(),
      year: z.number().int().min(2020).max(2100),
      month: z.number().int().min(1).max(12),
      days: z.number().refine(d => d !== 0, 'Tage duerfen nicht 0 sein'),
      reason: z.string().min(1, 'Begruendung erforderlich'),
    });
    const body = await c.req.json();
    const data = schema.parse(body);

    const adjustment = await prisma.vacationAdjustment.create({
      data: {
        ...data,
        createdBy: `${emp.firstName} ${emp.lastName}`,
      },
    });

    const empTarget = await prisma.employee.findUnique({ where: { id: data.employeeId }, select: { firstName: true, lastName: true } });
    await createAuditLog({
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
      action: 'CREATE',
      entityType: 'TimeEntry' as any, // VacationAdjustment not in EntityType union
      entityId: adjustment.id,
      newValues: { days: data.days, month: data.month, year: data.year, reason: data.reason },
      note: `Urlaubsanpassung ${data.days > 0 ? '+' : ''}${data.days} Tage fuer ${empTarget?.firstName} ${empTarget?.lastName}`,
    });

    return c.json(adjustment);
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: error.errors[0].message }, 400);
    console.error('Create vacation adjustment error:', error);
    return c.json({ error: 'Fehler beim Speichern' }, 500);
  }
});

// Urlaubsanpassung loeschen
app.delete('/vacation-adjustments/:id', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');
    const adj = await prisma.vacationAdjustment.findUnique({ where: { id } });
    if (!adj) return c.json({ error: 'Nicht gefunden' }, 404);

    await prisma.vacationAdjustment.delete({ where: { id } });
    await createAuditLog({
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
      action: 'DELETE',
      entityType: 'TimeEntry' as any, // VacationAdjustment not in EntityType union
      entityId: id,
      oldValues: { days: adj.days, reason: adj.reason },
    });
    return c.json({ success: true });
  } catch (error) {
    console.error('Delete vacation adjustment error:', error);
    return c.json({ error: 'Fehler beim Loeschen' }, 500);
  }
});

// ==================== PWA-STEMPELUNG ====================

// Reverse Geocoding: Koordinaten -> Adresse
async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=de`,
      { headers: { 'User-Agent': 'Zeiterfassung/1.0' } },
    );
    const data: any = await res.json();
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

// PWA Clock-In
app.post('/pwa/clock-in', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');

    const employee = await prisma.employee.findUnique({ where: { id: emp.id } });
    if (employee?.startDate && new Date(employee.startDate) > new Date()) {
      return c.json({ error: `Du kannst dich erst ab dem ${new Date(employee.startDate).toLocaleDateString('de-DE')} einstempeln` }, 403);
    }
    if (employee?.endDate && new Date(employee.endDate) <= new Date()) {
      return c.json({ error: 'Dein Arbeitsverhaeltnis ist beendet' }, 403);
    }
    if (!employee?.canClockInPwa) {
      return c.json({ error: 'PWA-Einstempeln ist fuer dich nicht aktiviert' }, 403);
    }

    // Pruefe ob bereits eingestempelt
    const active = await prisma.timeEntry.findFirst({
      where: { employeeId: employee.id, clockOut: null },
    });
    if (active) {
      return c.json({ error: 'Du bist bereits eingestempelt' }, 400);
    }

    const { latitude, longitude, reasonId, reasonText } = await c.req.json();
    if (latitude == null || longitude == null) {
      return c.json({ error: 'Standort ist erforderlich' }, 400);
    }
    if (!reasonId && !reasonText) {
      return c.json({ error: 'Bitte einen Grund angeben' }, 400);
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
        note: `Auswaerts eingestempelt: ${address} (${reasonName})`,
      },
    });

    // TODO: WebSocket event (io.emit not available in Workers)

    // TODO: Admin email notification (sendPwaNotificationEmail not available in Workers)

    await createAuditLog({
      c,
      prisma,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'CLOCK_IN',
      entityType: 'TimeEntry',
      entityId: entry.id,
      note: `PWA-Einstempeln (${reasonName}) - Standort: ${latitude}, ${longitude}`,
    });

    return c.json({ entry, message: 'Erfolgreich eingestempelt' });
  } catch (error) {
    console.error('PWA clock-in error:', error);
    return c.json({ error: 'Fehler beim Einstempeln' }, 500);
  }
});

// PWA Clock-Out
app.post('/pwa/clock-out', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');

    const employee = await prisma.employee.findUnique({ where: { id: emp.id } });
    if (!employee?.canClockOutPwa) {
      return c.json({ error: 'PWA-Ausstempeln ist fuer dich nicht aktiviert' }, 403);
    }

    const active = await prisma.timeEntry.findFirst({
      where: { employeeId: employee.id, clockOut: null },
    });
    if (!active) {
      return c.json({ error: 'Du bist nicht eingestempelt' }, 400);
    }

    const { latitude, longitude, reasonId, reasonText } = await c.req.json();
    if (latitude == null || longitude == null) {
      return c.json({ error: 'Standort ist erforderlich' }, 400);
    }
    if (!reasonId && !reasonText) {
      return c.json({ error: 'Bitte einen Grund angeben' }, 400);
    }

    let reasonName = reasonText || '';
    if (reasonId) {
      const reason = await prisma.pwaClockReason.findUnique({ where: { id: reasonId } });
      reasonName = reason?.name || reasonText || '';
    }

    const now = new Date();
    const address = await reverseGeocode(latitude, longitude);

    // Note ergaenzen (bestehende Note beibehalten)
    const existingNote = active.note || '';
    const outNote = `Auswaerts ausgestempelt: ${address} (${reasonName})`;
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

    // TODO: WebSocket event (io.emit not available in Workers)

    // TODO: Admin email notification (sendPwaNotificationEmail not available in Workers)

    await createAuditLog({
      c,
      prisma,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'CLOCK_OUT',
      entityType: 'TimeEntry',
      entityId: entry.id,
      note: `PWA-Ausstempeln (${reasonName}) - Standort: ${latitude}, ${longitude}`,
    });

    return c.json({ entry, message: 'Erfolgreich ausgestempelt' });
  } catch (error) {
    console.error('PWA clock-out error:', error);
    return c.json({ error: 'Fehler beim Ausstempeln' }, 500);
  }
});

// PWA-Stempel-Gruende abrufen
app.get('/pwa/reasons', async (c) => {
  try {
    const prisma = c.get('prisma');
    const reasons = await prisma.pwaClockReason.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return c.json(reasons);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Gruende' }, 500);
  }
});

// PWA-Berechtigung des aktuellen Users pruefen
app.get('/pwa/permissions', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    const employee = await prisma.employee.findUnique({
      where: { id: emp.id },
      select: { canClockInPwa: true, canClockOutPwa: true },
    });
    return c.json(employee || { canClockInPwa: false, canClockOutPwa: false });
  } catch (error) {
    return c.json({ error: 'Fehler' }, 500);
  }
});

// ==================== REKLAMATIONEN ====================

// Eigenstaendige Reklamation erstellen (ohne bestehenden Zeiteintrag, z.B. Karte vergessen)
app.post('/complaint/standalone', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');

    const schema = z.object({
      date: z.string().min(1, 'Datum erforderlich'),
      message: z.string().min(1, 'Bitte geben Sie eine Nachricht ein').max(1000),
    });

    const body = await c.req.json();
    const { date, message } = schema.parse(body);

    // Datum parsen (YYYY-MM-DD)
    const dayDate = new Date(date + 'T00:00:00');
    if (isNaN(dayDate.getTime())) {
      return c.json({ error: 'Ungueltiges Datum' }, 400);
    }

    // Nicht in der Zukunft erlauben
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (dayDate > today) {
      return c.json({ error: 'Reklamationen koennen nicht fuer zukuenftige Tage erstellt werden' }, 400);
    }

    // Placeholder-TimeEntry erstellen mit Reklamation
    const entry = await prisma.timeEntry.create({
      data: {
        employeeId: emp.id,
        clockIn: dayDate,
        clockOut: null,
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
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
      action: 'COMPLAINT_CREATE',
      entityType: 'TimeEntry',
      entityId: entry.id,
      oldValues: null,
      newValues: { complaintMessage: message, date, standalone: true },
    });

    // TODO: E-Mail an Admins (sendComplaintNotification not available in Workers)

    return c.json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create standalone complaint error:', error);
    return c.json({ error: 'Fehler beim Erstellen der Reklamation' }, 500);
  }
});

// Meine Reklamationen abrufen
app.get('/my/complaints', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');

    const entries = await prisma.timeEntry.findMany({
      where: {
        employeeId: emp.id,
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
    return c.json(entries);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Reklamationen' }, 500);
  }
});

// Reklamation erstellen/aktualisieren (eigener Eintrag)
app.post('/:id/complaint', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    const id = c.req.param('id');

    const schema = z.object({
      message: z.string().min(1, 'Bitte geben Sie eine Nachricht ein').max(1000),
    });

    const body = await c.req.json();
    const { message } = schema.parse(body);

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
      return c.json({ error: 'Zeiteintrag nicht gefunden' }, 404);
    }

    // Pruefen ob der Eintrag dem Benutzer gehoert (ausser Admin)
    if (entry.employeeId !== emp.id && !emp.isAdmin) {
      return c.json({ error: 'Keine Berechtigung fuer diesen Eintrag' }, 403);
    }

    // Pruefen ob bereits bearbeitet (dann kann nicht mehr geaendert werden)
    if (entry.complaintResolvedAt && !emp.isAdmin) {
      return c.json({ error: 'Diese Reklamation wurde bereits bearbeitet' }, 400);
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
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
      action: isNewComplaint ? 'COMPLAINT_CREATE' : 'COMPLAINT_UPDATE',
      entityType: 'TimeEntry',
      entityId: id,
      oldValues: entry.complaintMessage ? { complaintMessage: entry.complaintMessage } : null,
      newValues: { complaintMessage: message },
    });

    // TODO: E-Mail an Admins bei neuer Reklamation (sendComplaintNotification not available in Workers)

    return c.json(updatedEntry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create complaint error:', error);
    return c.json({ error: 'Fehler beim Erstellen der Reklamation' }, 500);
  }
});

// Reklamation zurueckziehen (nur wenn noch nicht bearbeitet)
app.delete('/:id/complaint', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    const id = c.req.param('id');

    const entry = await prisma.timeEntry.findUnique({ where: { id } });

    if (!entry) {
      return c.json({ error: 'Zeiteintrag nicht gefunden' }, 404);
    }

    // Pruefen ob der Eintrag dem Benutzer gehoert
    if (entry.employeeId !== emp.id && !emp.isAdmin) {
      return c.json({ error: 'Keine Berechtigung fuer diesen Eintrag' }, 403);
    }

    // Pruefen ob Reklamation existiert
    if (!entry.complaintMessage) {
      return c.json({ error: 'Keine Reklamation vorhanden' }, 400);
    }

    // Pruefen ob bereits bearbeitet
    if (entry.complaintResolvedAt && !emp.isAdmin) {
      return c.json({ error: 'Diese Reklamation wurde bereits bearbeitet und kann nicht mehr zurueckgezogen werden' }, 400);
    }

    // Reklamation loeschen (inkl. Originalwerte)
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
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
      action: 'COMPLAINT_DELETE',
      entityType: 'TimeEntry',
      entityId: id,
      oldValues: { complaintMessage: entry.complaintMessage },
    });

    return c.json(updatedEntry);
  } catch (error) {
    console.error('Delete complaint error:', error);
    return c.json({ error: 'Fehler beim Loeschen der Reklamation' }, 500);
  }
});

// Reklamation bearbeiten/loesen (Admin)
app.post('/:id/complaint/resolve', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');
    const schema = z.object({
      response: z.string().max(1000).optional().nullable(),
    });

    const body = await c.req.json();
    const { response } = schema.parse(body);

    const entry = await prisma.timeEntry.findUnique({
      where: { id },
      include: {
        employee: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!entry) {
      return c.json({ error: 'Zeiteintrag nicht gefunden' }, 404);
    }

    if (!entry.complaintMessage) {
      return c.json({ error: 'Keine Reklamation vorhanden' }, 400);
    }

    // Reklamation als bearbeitet markieren
    const updatedEntry = await prisma.timeEntry.update({
      where: { id },
      data: {
        complaintResolvedAt: new Date(),
        complaintResolvedBy: emp.id,
        complaintResponse: response || null,
      },
    });

    // Audit Log
    await createAuditLog({
      c,
      prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
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

    // TODO: Bestaetigungs-E-Mail an Mitarbeiter (sendComplaintResolvedNotification not available in Workers)

    return c.json(updatedEntry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Resolve complaint error:', error);
    return c.json({ error: 'Fehler beim Bearbeiten der Reklamation' }, 500);
  }
});

// Offene Reklamationen abrufen (Admin) - fuer Dashboard und Badge
app.get('/complaints/pending', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const limit = c.req.query('limit') || '5';

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
      take: parseInt(limit),
    });

    // Gesamtanzahl fuer Badge
    const totalCount = await prisma.timeEntry.count({
      where: {
        complaintMessage: { not: null },
        complaintResolvedAt: null,
      },
    });

    return c.json({
      count: totalCount,
      entries,
    });
  } catch (error) {
    console.error('Get pending complaints error:', error);
    return c.json({ error: 'Fehler beim Laden der offenen Reklamationen' }, 500);
  }
});

// Alle reklamierten Eintraege abrufen (Admin)
app.get('/flagged', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const resolved = c.req.query('resolved');
    const from = c.req.query('from');
    const to = c.req.query('to');

    const where: any = {
      complaintMessage: { not: null },
    };

    // Filter: nur geloeste oder nur offene
    if (resolved === 'true') {
      where.complaintResolvedAt = { not: null };
    } else if (resolved === 'false') {
      where.complaintResolvedAt = null;
    }

    // Datumsfilter
    if (from) {
      where.clockIn = { ...where.clockIn, gte: new Date(from) };
    }
    if (to) {
      where.clockIn = { ...where.clockIn, lte: new Date(to) };
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

    return c.json(entries);
  } catch (error) {
    console.error('Get flagged entries error:', error);
    return c.json({ error: 'Fehler beim Laden der reklamierten Eintraege' }, 500);
  }
});

export default app;
