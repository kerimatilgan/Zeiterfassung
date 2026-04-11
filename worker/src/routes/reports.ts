import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../bindings.js';
import { createAuditLog } from '../utils/auditLog.js';
import type { PrismaClient } from '@prisma/client';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Berechnet Arbeitsstunden für einen Zeitraum
async function calculateHoursForPeriod(prisma: PrismaClient, employeeId: string, startDate: Date, endDate: Date) {
  const entries = await prisma.timeEntry.findMany({
    where: {
      employeeId,
      clockIn: { gte: startDate },
      clockOut: { lte: endDate, not: null },
    },
    orderBy: { clockIn: 'asc' },
  });

  let totalMinutes = 0;
  const dailyHours: { date: string; hours: number; entries: typeof entries }[] = [];

  const entriesByDate = new Map<string, typeof entries>();

  entries.forEach(entry => {
    const dateKey = entry.clockIn.toISOString().split('T')[0];
    if (!entriesByDate.has(dateKey)) {
      entriesByDate.set(dateKey, []);
    }
    entriesByDate.get(dateKey)!.push(entry);
  });

  entriesByDate.forEach((dayEntries, dateKey) => {
    let dayMinutes = 0;
    dayEntries.forEach(entry => {
      if (entry.clockOut) {
        const worked = (entry.clockOut.getTime() - entry.clockIn.getTime()) / (1000 * 60);
        dayMinutes += worked - entry.breakMinutes;
      }
    });
    totalMinutes += dayMinutes;
    dailyHours.push({
      date: dateKey,
      hours: Math.round((dayMinutes / 60) * 100) / 100,
      entries: dayEntries,
    });
  });

  return {
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    dailyHours,
    entries,
  };
}

// Konvertiert Date zu lokalem Datum-String (YYYY-MM-DD) - wichtig für Zeitzonenkorrektur
function toLocalDateString(date: Date): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Parst workDays String zu Array von Zahlen (0=So, 1=Mo, ..., 6=Sa)
function parseWorkDays(workDaysStr: string): number[] {
  return workDaysStr.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
}

// Zählt Arbeitstage basierend auf employee.workDays (ohne Feiertage/Abwesenheiten)
function countWorkingDays(year: number, month: number, workDaysStr: string = '1,2,3,4,5'): number {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const workDays = parseWorkDays(workDaysStr);
  let count = 0;

  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (workDays.includes(day)) {
      count++;
    }
  }

  return count;
}

// Berechnet die tatsächlichen Soll-Stunden unter Berücksichtigung von Feiertagen und Abwesenheiten
async function calculateAdjustedTargetHours(
  prisma: PrismaClient,
  employeeId: string,
  year: number,
  month: number,
  workDaysStr: string,
  weeklyHours: number
): Promise<number> {
  const workDays = parseWorkDays(workDaysStr);
  const dailyTargetHours = workDays.length > 0 ? weeklyHours / workDays.length : 0;

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  // Eintritts-/Austrittsdatum berücksichtigen
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { startDate: true, endDate: true },
  });
  const empStart = emp?.startDate ? new Date(emp.startDate) : null;
  const empEnd = emp?.endDate ? new Date(emp.endDate) : null;

  // Effektiver Zeitraum: Max(Monatsanfang, Eintrittsdatum) bis Min(Monatsende, Austrittsdatum)
  const startDate = empStart && empStart > monthStart ? empStart : monthStart;
  const endDate = empEnd && empEnd < monthEnd ? empEnd : monthEnd;

  // Wenn Eintritt nach Monatsende oder Austritt vor Monatsanfang → 0 Soll
  if (startDate > monthEnd || endDate < monthStart) return 0;

  // Feiertage laden
  const holidays = await prisma.holiday.findMany({
    where: {
      date: { gte: startDate, lte: endDate }
    }
  });
  const holidayDates = new Set(holidays.map(h => toLocalDateString(h.date)));

  // Alle Abwesenheiten laden
  const absences = await prisma.employeeAbsence.findMany({
    where: {
      employeeId,
      date: { gte: startDate, lte: endDate }
    },
    include: { absenceType: true }
  });
  const absenceMap = new Map<string, number>();
  absences.forEach(a => absenceMap.set(toLocalDateString(a.date), a.absenceType.requiredHours));

  let targetHours = 0;

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = toLocalDateString(d);
    const dayOfWeek = d.getDay();

    // Kein Arbeitstag? → 0 Soll
    if (!workDays.includes(dayOfWeek)) continue;

    // Feiertag? → 0 Soll
    if (holidayDates.has(dateStr)) continue;

    // Abwesenheit?
    if (absenceMap.has(dateStr)) {
      const requiredHours = absenceMap.get(dateStr)!;
      // Bei requiredHours = 0 (Urlaub, Krank): kein Soll
      // Bei requiredHours > 0 (Berufsschule): nur diese Stunden als Soll
      targetHours += requiredHours;
    } else {
      // Normaler Arbeitstag
      targetHours += dailyTargetHours;
    }
  }

  return Math.round(targetHours * 100) / 100;
}

// Berechnet verbrauchte Urlaubstage im Jahr bis einschließlich Monat
async function calculateVacationDaysUsed(prisma: PrismaClient, employeeId: string, year: number, month: number): Promise<number> {
  const startOfYear = new Date(year, 0, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { workDays: true, initialVacationDaysUsed: true, initialBalanceYear: true },
  });
  if (!employee) return 0;

  const workDayNums = employee.workDays.split(',').map(Number);

  // Alle Urlaubs-Abwesenheiten (countsAsVacation=true, nur Arbeitstage)
  const absences = await prisma.employeeAbsence.findMany({
    where: {
      employeeId,
      date: { gte: startOfYear, lte: endOfMonth },
      absenceType: { countsAsVacation: true },
    },
  });
  const vacDays = absences.filter(a => workDayNums.includes(new Date(a.date).getDay())).length;

  // Initiale Urlaubstage addieren
  let total = vacDays;
  if (employee.initialBalanceYear === year && employee.initialVacationDaysUsed > 0) {
    total += employee.initialVacationDaysUsed;
  }

  return total;
}

// Berechnet die Gesamtzahl verfügbarer Urlaubstage (inkl. Adjustments, abzüglich Deductions)
async function calculateVacationDaysTotal(prisma: PrismaClient, employeeId: string, year: number): Promise<number> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { vacationDaysPerYear: true, carryOverVacationDays: true },
  });
  if (!employee) return 0;

  const adjustments = await prisma.vacationAdjustment.findMany({ where: { employeeId, year } });
  const adjDays = adjustments.reduce((s: number, a: any) => s + a.days, 0);

  const deductions = await prisma.vacationDeduction.findMany({ where: { employeeId, year } });
  const deductDays = deductions.reduce((s: number, d: any) => s + d.daysDeducted, 0);

  return employee.vacationDaysPerYear + ((employee as any).carryOverVacationDays || 0) + adjDays - deductDays;
}

// Holt den Report des Vormonats für Übertrag-Berechnung
async function getPreviousMonthReport(prisma: PrismaClient, employeeId: string, year: number, month: number) {
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = year - 1;
  }

  const report = await prisma.monthlyReport.findUnique({
    where: {
      employeeId_year_month: {
        employeeId,
        year: prevYear,
        month: prevMonth,
      },
    },
  });

  // Wenn keine vorherige Abrechnung existiert, initiale Salden als Startwert verwenden
  if (!report) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { initialOvertimeBalance: true, initialBalanceYear: true, initialBalanceMonth: true },
    });

    if (employee && employee.initialBalanceYear && employee.initialBalanceMonth) {
      // Nur anwenden wenn der Stichtag vor oder gleich dem angefragten Monat liegt
      const balanceDate = employee.initialBalanceYear * 12 + employee.initialBalanceMonth;
      const requestDate = year * 12 + month;
      if (balanceDate <= requestDate && employee.initialOvertimeBalance !== 0) {
        return { cumulativeOvertimeBalance: employee.initialOvertimeBalance } as any;
      }
    }
  }

  return report;
}

// Berechnet Krankheitstage (diesen Monat + kumulativ im Jahr)
async function calculateSickDays(prisma: PrismaClient, employeeId: string, year: number, month: number): Promise<{ thisMonth: number; yearTotal: number }> {
  const sickType = await prisma.absenceType.findFirst({
    where: { name: { contains: 'krank' } },
  });

  if (!sickType) return { thisMonth: 0, yearTotal: 0 };

  const startOfYear = new Date(year, 0, 1);
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);

  const [thisMonth, yearTotal] = await Promise.all([
    prisma.employeeAbsence.count({
      where: {
        employeeId,
        absenceTypeId: sickType.id,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
    }),
    prisma.employeeAbsence.count({
      where: {
        employeeId,
        absenceTypeId: sickType.id,
        date: { gte: startOfYear, lte: endOfMonth },
      },
    }),
  ]);

  // Initiale Krankheitstage addieren
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { initialSickDays: true, initialBalanceYear: true },
  });
  if (employee && employee.initialBalanceYear === year && employee.initialSickDays > 0) {
    return { thisMonth, yearTotal: yearTotal + employee.initialSickDays };
  }

  return { thisMonth, yearTotal };
}

function getMonthName(month: number): string {
  const months = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];
  return months[month - 1];
}

// Meine Berichte (als Mitarbeiter)
app.get('/my', async (c) => {
  try {
    const prisma = c.get('prisma');
    const employee = c.get('employee');

    const reports = await prisma.monthlyReport.findMany({
      where: { employeeId: employee.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return c.json(reports);
  } catch (error) {
    console.error('Get my reports error:', error);
    return c.json({ error: 'Fehler beim Laden der Berichte' }, 500);
  }
});

// Alle Berichte (Admin)
app.get('/', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const year = c.req.query('year');
    const month = c.req.query('month');
    const employeeId = c.req.query('employeeId');
    const status = c.req.query('status');

    const where: any = {};
    if (year) where.year = parseInt(year);
    if (month) where.month = parseInt(month);
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;

    const reports = await prisma.monthlyReport.findMany({
      where,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    return c.json(reports);
  } catch (error) {
    console.error('Get reports error:', error);
    return c.json({ error: 'Fehler beim Laden der Berichte' }, 500);
  }
});

// Vorschau für Monatsabrechnung
app.get('/preview/:employeeId/:year/:month', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const employeeId = c.req.param('employeeId');
    const year = c.req.param('year');
    const month = c.req.param('month');

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    }

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);

    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59); // Letzter Tag des Monats

    const { totalHours, dailyHours, entries } = await calculateHoursForPeriod(
      prisma,
      employeeId,
      startDate,
      endDate
    );

    // Soll-Stunden berechnen (berücksichtigt Feiertage und Abwesenheiten)
    const workingDays = countWorkingDays(yearNum, monthNum, employee.workDays);
    const targetHours = await calculateAdjustedTargetHours(
      prisma,
      employeeId,
      yearNum,
      monthNum,
      employee.workDays,
      employee.weeklyHours
    );

    const overtimeHours = Math.round((totalHours - targetHours) * 100) / 100;

    // Urlaubstage berechnen
    const vacationDaysUsed = await calculateVacationDaysUsed(prisma, employeeId, yearNum, monthNum);
    const vacTotal = await calculateVacationDaysTotal(prisma, employeeId, yearNum);
    const vacationDaysRemaining = vacTotal - vacationDaysUsed;

    // Übertrag vom Vormonat
    const previousReport = await getPreviousMonthReport(prisma, employeeId, yearNum, monthNum);
    const previousOvertimeBalance = previousReport?.cumulativeOvertimeBalance ?? 0;
    const cumulativeOvertimeBalance = Math.round((previousOvertimeBalance + overtimeHours) * 100) / 100;

    // Krankheitstage
    const sickDays = await calculateSickDays(prisma, employeeId, yearNum, monthNum);

    // Minusstunden-Abzug berechnen
    let suggestedDeductionDays = 0;
    let suggestedDeductionHours = 0;
    if (cumulativeOvertimeBalance <= -8) {
      suggestedDeductionDays = Math.floor(Math.abs(cumulativeOvertimeBalance) / 8);
      suggestedDeductionHours = suggestedDeductionDays * 8;
    }

    return c.json({
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        employeeNumber: employee.employeeNumber,
        weeklyHours: employee.weeklyHours,
        vacationDaysPerYear: employee.vacationDaysPerYear,
        vacationDaysTotal: vacTotal,
        workDays: employee.workDays,
      },
      period: {
        year: yearNum,
        month: monthNum,
        monthName: getMonthName(monthNum),
      },
      summary: {
        totalHours,
        targetHours: Math.round(targetHours * 100) / 100,
        overtimeHours,
        previousOvertimeBalance,
        cumulativeOvertimeBalance,
        workingDays,
        entriesCount: entries.length,
        vacationDaysUsed,
        vacationDaysRemaining,
        sickDaysThisMonth: sickDays.thisMonth,
        sickDaysTotal: sickDays.yearTotal,
        suggestedDeductionDays,
        suggestedDeductionHours,
        vacationAdjustments: (await prisma.vacationAdjustment.findMany({
          where: { employeeId, year: yearNum },
          orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
        })).map((a: any) => ({ month: a.month, days: a.days, reason: a.reason })),
      },
      dailyHours,
    });
  } catch (error) {
    console.error('Preview report error:', error);
    return c.json({ error: 'Fehler beim Erstellen der Vorschau' }, 500);
  }
});

// Monatsabrechnung erstellen
app.post('/create', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const schema = z.object({
      employeeId: z.string().uuid(),
      year: z.number().min(2020).max(2100),
      month: z.number().min(1).max(12),
      notes: z.string().optional(),
      applyVacationDeduction: z.boolean().optional(),
      deductionDays: z.number().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    // Prüfen ob bereits existiert
    const existing = await prisma.monthlyReport.findUnique({
      where: {
        employeeId_year_month: {
          employeeId: data.employeeId,
          year: data.year,
          month: data.month,
        },
      },
    });

    if (existing) {
      return c.json({ error: 'Abrechnung für diesen Monat existiert bereits' }, 400);
    }

    const employee = await prisma.employee.findUnique({
      where: { id: data.employeeId },
    });

    if (!employee) {
      return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    }

    const startDate = new Date(data.year, data.month - 1, 1);
    const endDate = new Date(data.year, data.month, 0, 23, 59, 59);

    const { totalHours } = await calculateHoursForPeriod(prisma, data.employeeId, startDate, endDate);

    // Soll-Stunden berechnen (berücksichtigt Feiertage und Abwesenheiten)
    const targetHours = await calculateAdjustedTargetHours(
      prisma,
      data.employeeId,
      data.year,
      data.month,
      employee.workDays,
      employee.weeklyHours
    );
    const overtimeHours = Math.round((totalHours - targetHours) * 100) / 100;

    // Urlaubstage berechnen
    const vacationDaysUsed = await calculateVacationDaysUsed(prisma, data.employeeId, data.year, data.month);
    const vacTotal = await calculateVacationDaysTotal(prisma, data.employeeId, data.year);
    const vacationDaysRemaining = vacTotal - vacationDaysUsed;

    // Übertrag vom Vormonat
    const previousReport = await getPreviousMonthReport(prisma, data.employeeId, data.year, data.month);
    const previousOvertimeBalance = previousReport?.cumulativeOvertimeBalance ?? 0;
    const cumulativeOvertimeBalance = Math.round((previousOvertimeBalance + overtimeHours) * 100) / 100;

    // Krankheitstage
    const sickDays = await calculateSickDays(prisma, data.employeeId, data.year, data.month);

    // Minusstunden-Urlaubsabzug
    let deductionDays = 0;
    let deductionHours = 0;
    let deductionNote: string | null = null;
    let adjustedCumulativeBalance = cumulativeOvertimeBalance;

    if (data.applyVacationDeduction && cumulativeOvertimeBalance <= -8) {
      deductionDays = data.deductionDays || Math.floor(Math.abs(cumulativeOvertimeBalance) / 8);
      deductionHours = deductionDays * 8;
      adjustedCumulativeBalance = Math.round((cumulativeOvertimeBalance + deductionHours) * 100) / 100;
      deductionNote = `${deductionDays} Urlaubstag(e) für ${deductionHours}h Minusstunden-Ausgleich abgezogen (Saldo: ${cumulativeOvertimeBalance.toFixed(1)}h → ${adjustedCumulativeBalance.toFixed(1)}h)`;

      // VacationDeduction erstellen
      await prisma.vacationDeduction.create({
        data: {
          employeeId: data.employeeId,
          year: data.year,
          month: data.month,
          reason: deductionNote,
          daysDeducted: deductionDays,
          hoursCompensated: deductionHours,
          overtimeBalanceBefore: cumulativeOvertimeBalance,
          overtimeBalanceAfter: adjustedCumulativeBalance,
        },
      });
    }

    const report = await prisma.monthlyReport.create({
      data: {
        employeeId: data.employeeId,
        year: data.year,
        month: data.month,
        totalHours,
        targetHours,
        overtimeHours,
        previousOvertimeBalance,
        cumulativeOvertimeBalance: adjustedCumulativeBalance,
        vacationDaysUsed: vacationDaysUsed + deductionDays,
        vacationDaysRemaining: vacationDaysRemaining - deductionDays,
        vacationDeductionDays: deductionDays,
        vacationDeductionHours: deductionHours,
        vacationDeductionNote: deductionNote,
        sickDaysThisMonth: sickDays.thisMonth,
        sickDaysTotal: sickDays.yearTotal,
        notes: data.notes,
        createdBy: `${emp.firstName} ${emp.lastName}`,
        status: 'draft',
      },
    });

    return c.json(report, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create report error:', error);
    return c.json({ error: 'Fehler beim Erstellen der Abrechnung' }, 500);
  }
});

// Abrechnung finalisieren und PDF generieren
app.post('/:id/finalize', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report) {
      return c.json({ error: 'Abrechnung nicht gefunden' }, 404);
    }

    if (report.status === 'finalized') {
      return c.json({ error: 'Abrechnung ist bereits finalisiert' }, 400);
    }

    const safeName = `${report.employee.lastName}_${report.employee.firstName}`.replace(/[^a-zA-ZäöüÄÖÜß0-9_-]/g, '');
    const pdfFilename = `${safeName}_${String(report.month).padStart(2, '0')}_${report.year}.pdf`;
    const r2Key = `reports/${report.employeeId}/${pdfFilename}`;

    const startDate = new Date(report.year, report.month - 1, 1);
    const endDate = new Date(report.year, report.month, 0, 23, 59, 59);
    const { dailyHours } = await calculateHoursForPeriod(prisma, report.employeeId, startDate, endDate);

    // Abwesenheiten für den Monat laden
    const absences = await prisma.employeeAbsence.findMany({
      where: {
        employeeId: report.employeeId,
        date: { gte: startDate, lte: endDate },
      },
      include: { absenceType: true },
    });

    // Feiertage für den Monat laden
    const holidays = await prisma.holiday.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
    });

    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });

    // Urlaubsanpassungen für das Jahr laden
    const vacationAdjustments = await prisma.vacationAdjustment.findMany({
      where: { employeeId: report.employeeId, year: report.year },
      orderBy: [{ month: 'asc' }, { createdAt: 'asc' }],
    });

    // Arbeitskategorie laden (wenn in Settings aktiviert)
    let workCategory: { name: string; earliestClockIn: string } | undefined;
    if ((settings as any)?.pdfShowWorkCategory && report.employee.workCategoryId) {
      const wc = await prisma.workCategory.findUnique({ where: { id: report.employee.workCategoryId } });
      if (wc) workCategory = { name: wc.name, earliestClockIn: wc.earliestClockIn };
    }

    // TODO: Generate actual PDF using pdf-lib instead of this placeholder.
    // The original Express version uses PDFKit via generateMonthlyReportPDF().
    // Port that logic to use pdf-lib (which works in Cloudflare Workers) and generate
    // a proper PDF with all report data (dailyHours, absences, holidays, settings,
    // vacationAdjustments, workCategory, etc.).
    const placeholderPdf = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, // %PDF-1.4
      0x0A, 0x31, 0x20, 0x30, 0x20, 0x6F, 0x62, 0x6A, // \n1 0 obj
      0x0A, 0x3C, 0x3C, 0x2F, 0x54, 0x79, 0x70, 0x65, // \n<</Type
      0x2F, 0x43, 0x61, 0x74, 0x61, 0x6C, 0x6F, 0x67, // /Catalog
      0x2F, 0x50, 0x61, 0x67, 0x65, 0x73, 0x20, 0x32, // /Pages 2
      0x20, 0x30, 0x20, 0x52, 0x3E, 0x3E, 0x0A, 0x65, //  0 R>>\ne
      0x6E, 0x64, 0x6F, 0x62, 0x6A, 0x0A,             // ndobj\n
      0x32, 0x20, 0x30, 0x20, 0x6F, 0x62, 0x6A, 0x0A, // 2 0 obj\n
      0x3C, 0x3C, 0x2F, 0x54, 0x79, 0x70, 0x65, 0x2F, // <</Type/
      0x50, 0x61, 0x67, 0x65, 0x73, 0x2F, 0x4B, 0x69, // Pages/Ki
      0x64, 0x73, 0x5B, 0x33, 0x20, 0x30, 0x20, 0x52, // ds[3 0 R
      0x5D, 0x2F, 0x43, 0x6F, 0x75, 0x6E, 0x74, 0x20, // ]/Count
      0x31, 0x3E, 0x3E, 0x0A, 0x65, 0x6E, 0x64, 0x6F, // 1>>\nendo
      0x62, 0x6A, 0x0A,                                 // bj\n
      0x33, 0x20, 0x30, 0x20, 0x6F, 0x62, 0x6A, 0x0A, // 3 0 obj\n
      0x3C, 0x3C, 0x2F, 0x54, 0x79, 0x70, 0x65, 0x2F, // <</Type/
      0x50, 0x61, 0x67, 0x65, 0x2F, 0x50, 0x61, 0x72, // Page/Par
      0x65, 0x6E, 0x74, 0x20, 0x32, 0x20, 0x30, 0x20, // ent 2 0
      0x52, 0x2F, 0x4D, 0x65, 0x64, 0x69, 0x61, 0x42, // R/MediaB
      0x6F, 0x78, 0x5B, 0x30, 0x20, 0x30, 0x20, 0x36, // ox[0 0 6
      0x31, 0x32, 0x20, 0x37, 0x39, 0x32, 0x5D, 0x3E, // 12 792]>
      0x3E, 0x0A, 0x65, 0x6E, 0x64, 0x6F, 0x62, 0x6A, // >\nendobj
      0x0A, 0x78, 0x72, 0x65, 0x66, 0x0A,             // \nxref\n
      0x30, 0x20, 0x34, 0x0A,                           // 0 4\n
      0x74, 0x72, 0x61, 0x69, 0x6C, 0x65, 0x72, 0x0A, // trailer\n
      0x3C, 0x3C, 0x2F, 0x53, 0x69, 0x7A, 0x65, 0x20, // <</Size
      0x34, 0x2F, 0x52, 0x6F, 0x6F, 0x74, 0x20, 0x31, // 4/Root 1
      0x20, 0x30, 0x20, 0x52, 0x3E, 0x3E, 0x0A,       //  0 R>>\n
      0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, // startxre
      0x66, 0x0A, 0x30, 0x0A,                           // f\n0\n
      0x25, 0x25, 0x45, 0x4F, 0x46,                     // %%EOF
    ]);

    // Store PDF in R2
    await c.env.UPLOADS.put(r2Key, placeholderPdf, {
      httpMetadata: {
        contentType: 'application/pdf',
      },
      customMetadata: {
        employeeId: report.employeeId,
        year: String(report.year),
        month: String(report.month),
        reportId: report.id,
      },
    });

    const updatedReport = await prisma.monthlyReport.update({
      where: { id },
      data: {
        status: 'finalized',
        finalizedAt: new Date(),
        pdfPath: r2Key,
      },
    });

    return c.json(updatedReport);
  } catch (error) {
    console.error('Finalize report error:', error);
    return c.json({ error: 'Fehler beim Finalisieren der Abrechnung' }, 500);
  }
});

// PDF herunterladen
app.get('/:id/pdf', async (c) => {
  try {
    const prisma = c.get('prisma');
    const employee = c.get('employee');
    const id = c.req.param('id');

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report) {
      return c.json({ error: 'Abrechnung nicht gefunden' }, 404);
    }

    // Nicht-Admins können nur eigene Berichte herunterladen
    if (!employee.isAdmin && report.employeeId !== employee.id) {
      return c.json({ error: 'Keine Berechtigung' }, 403);
    }

    if (!report.pdfPath) {
      return c.json({ error: 'PDF nicht verfügbar' }, 404);
    }

    // Fetch PDF from R2
    const r2Object = await c.env.UPLOADS.get(report.pdfPath);

    if (!r2Object) {
      return c.json({ error: 'PDF-Datei nicht gefunden' }, 404);
    }

    const dlSafeName = `${report.employee.lastName}_${report.employee.firstName}`.replace(/[^a-zA-ZäöüÄÖÜß0-9_-]/g, '');
    const downloadName = `${dlSafeName}_${String(report.month).padStart(2, '0')}_${report.year}.pdf`;

    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

    await createAuditLog({
      c,
      prisma,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'DOWNLOAD',
      entityType: 'MonthlyReport',
      entityId: report.id,
      newValues: {
        typ: 'Stundenabrechnung',
        mitarbeiter: `${report.employee.firstName} ${report.employee.lastName} (#${report.employee.employeeNumber})`,
        zeitraum: `${monthNames[report.month - 1]} ${report.year}`,
        stunden: `${report.totalHours}h (Soll: ${report.targetHours}h)`,
      },
      note: `Stundenabrechnung ${monthNames[report.month - 1]} ${report.year} für ${report.employee.firstName} ${report.employee.lastName} heruntergeladen`,
    });

    const pdfBuffer = await r2Object.arrayBuffer();

    return new Response(pdfBuffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBuffer.byteLength),
      },
    });
  } catch (error) {
    console.error('Download PDF error:', error);
    return c.json({ error: 'Fehler beim Herunterladen der PDF' }, 500);
  }
});

// PDF-Vorschau generieren (ohne zu speichern) - für Entwürfe
app.get('/:id/preview-pdf', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report) {
      return c.json({ error: 'Abrechnung nicht gefunden' }, 404);
    }

    // Zeiteinträge für den Monat laden
    const startDate = new Date(report.year, report.month - 1, 1);
    const endDate = new Date(report.year, report.month, 0, 23, 59, 59);
    const { dailyHours } = await calculateHoursForPeriod(prisma, report.employeeId, startDate, endDate);

    // Abwesenheiten für den Monat laden
    const absences = await prisma.employeeAbsence.findMany({
      where: {
        employeeId: report.employeeId,
        date: { gte: startDate, lte: endDate },
      },
      include: { absenceType: true },
    });

    // Feiertage für den Monat laden
    const holidays = await prisma.holiday.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
    });

    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });

    // TODO: Generate actual preview PDF using pdf-lib instead of this placeholder.
    // The original Express version uses PDFKit via generateMonthlyReportPDF().
    // Port that logic to use pdf-lib (which works in Cloudflare Workers).
    const placeholderPdf = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, // %PDF-1.4
      0x0A, 0x25, 0x25, 0x45, 0x4F, 0x46,               // \n%%EOF
    ]);

    const downloadName = `Vorschau_${report.employee.employeeNumber}_${report.year}_${report.month}.pdf`;

    return new Response(placeholderPdf, {
      headers: {
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Type': 'application/pdf',
        'Content-Length': String(placeholderPdf.byteLength),
      },
    });
  } catch (error) {
    console.error('Preview PDF error:', error);
    return c.json({ error: 'Fehler beim Erstellen der PDF-Vorschau' }, 500);
  }
});

// Abrechnung neu berechnen (auch finalisierte - setzt Status auf draft zurück)
app.post('/:id/recalculate', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report) {
      return c.json({ error: 'Abrechnung nicht gefunden' }, 404);
    }

    const startDate = new Date(report.year, report.month - 1, 1);
    const endDate = new Date(report.year, report.month, 0, 23, 59, 59);

    const { totalHours } = await calculateHoursForPeriod(prisma, report.employeeId, startDate, endDate);

    // Soll-Stunden berechnen (berücksichtigt Feiertage und Abwesenheiten)
    const targetHours = await calculateAdjustedTargetHours(
      prisma,
      report.employeeId,
      report.year,
      report.month,
      report.employee.workDays,
      report.employee.weeklyHours
    );
    const overtimeHours = Math.round((totalHours - targetHours) * 100) / 100;

    // Urlaubstage neu berechnen
    const vacationDaysUsed = await calculateVacationDaysUsed(prisma, report.employeeId, report.year, report.month);
    const vacTotal = await calculateVacationDaysTotal(prisma, report.employeeId, report.year);
    const vacationDaysRemaining = vacTotal - vacationDaysUsed;

    // Übertrag vom Vormonat
    const previousReport = await getPreviousMonthReport(prisma, report.employeeId, report.year, report.month);
    const previousOvertimeBalance = previousReport?.cumulativeOvertimeBalance ?? 0;
    const cumulativeOvertimeBalance = Math.round((previousOvertimeBalance + overtimeHours) * 100) / 100;

    // Krankheitstage
    const sickDays = await calculateSickDays(prisma, report.employeeId, report.year, report.month);

    // Bei finalisierten Abrechnungen: Alte PDF aus R2 löschen und Status zurücksetzen
    if (report.status === 'finalized' && report.pdfPath) {
      try {
        await c.env.UPLOADS.delete(report.pdfPath);
      } catch (e) {
        console.error('Error deleting old PDF from R2:', e);
      }
    }

    const updatedReport = await prisma.monthlyReport.update({
      where: { id },
      data: {
        totalHours,
        targetHours,
        overtimeHours,
        previousOvertimeBalance,
        cumulativeOvertimeBalance,
        vacationDaysUsed,
        vacationDaysRemaining,
        sickDaysThisMonth: sickDays.thisMonth,
        sickDaysTotal: sickDays.yearTotal,
        status: 'draft',
        pdfPath: null,
        finalizedAt: null,
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
    });

    // Warnung falls nachfolgende Abrechnungen existieren
    const subsequentReports = await prisma.monthlyReport.findMany({
      where: {
        employeeId: report.employeeId,
        OR: [
          { year: report.year, month: { gt: report.month } },
          { year: { gt: report.year } },
        ],
      },
      select: { id: true },
    });

    return c.json({
      ...updatedReport,
      _warning: subsequentReports.length > 0
        ? `${subsequentReports.length} nachfolgende Abrechnung(en) sollten ebenfalls neu berechnet werden.`
        : undefined,
    });
  } catch (error) {
    console.error('Recalculate report error:', error);
    return c.json({ error: 'Fehler beim Neuberechnen der Abrechnung' }, 500);
  }
});

// Abrechnung löschen (auch finalisierte - löscht zugehörige PDF)
app.delete('/:id', async (c) => {
  try {
    const prisma = c.get('prisma');
    const emp = c.get('employee');
    if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

    const id = c.req.param('id');

    const report = await prisma.monthlyReport.findUnique({ where: { id } });

    if (!report) {
      return c.json({ error: 'Abrechnung nicht gefunden' }, 404);
    }

    // PDF aus R2 löschen falls vorhanden
    if (report.pdfPath) {
      try {
        await c.env.UPLOADS.delete(report.pdfPath);
      } catch (e) {
        console.error('Error deleting PDF from R2:', e);
      }
    }

    await prisma.monthlyReport.delete({ where: { id } });

    return c.json({ message: 'Abrechnung gelöscht' });
  } catch (error) {
    console.error('Delete report error:', error);
    return c.json({ error: 'Fehler beim Löschen der Abrechnung' }, 500);
  }
});

export default app;
