import { Router, Response } from 'express';
import { prisma } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateMonthlyReportPDF } from '../utils/pdf.js';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { encryptBuffer, decryptFile } from '../utils/encryption.js';
import { createAuditLog } from '../utils/auditLog.js';

const router = Router();

// Berechnet Arbeitsstunden für einen Zeitraum
async function calculateHoursForPeriod(employeeId: string, startDate: Date, endDate: Date) {
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

// Meine Berichte (als Mitarbeiter)
router.get('/my', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const reports = await prisma.monthlyReport.findMany({
      where: { employeeId: req.employee!.id },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    res.json(reports);
  } catch (error) {
    console.error('Get my reports error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Berichte' });
  }
});

// Alle Berichte (Admin)
router.get('/', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { year, month, employeeId, status } = req.query;

    const where: any = {};
    if (year) where.year = parseInt(year as string);
    if (month) where.month = parseInt(month as string);
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

    res.json(reports);
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Berichte' });
  }
});

// Vorschau für Monatsabrechnung
router.get('/preview/:employeeId/:year/:month', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, year, month } = req.params;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);

    const startDate = new Date(yearNum, monthNum - 1, 1);
    const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59); // Letzter Tag des Monats

    const { totalHours, dailyHours, entries } = await calculateHoursForPeriod(
      employeeId,
      startDate,
      endDate
    );

    // Soll-Stunden berechnen (berücksichtigt Feiertage und Abwesenheiten)
    const workingDays = countWorkingDays(yearNum, monthNum, employee.workDays);
    const targetHours = await calculateAdjustedTargetHours(
      employeeId,
      yearNum,
      monthNum,
      employee.workDays,
      employee.weeklyHours
    );

    const overtimeHours = Math.round((totalHours - targetHours) * 100) / 100;

    // Urlaubstage berechnen
    const vacationDaysUsed = await calculateVacationDaysUsed(employeeId, yearNum, monthNum);
    const vacTotal = await calculateVacationDaysTotal(employeeId, yearNum);
    const vacationDaysRemaining = vacTotal - vacationDaysUsed;

    // Übertrag vom Vormonat
    const previousReport = await getPreviousMonthReport(employeeId, yearNum, monthNum);
    const previousOvertimeBalance = previousReport?.cumulativeOvertimeBalance ?? 0;
    const cumulativeOvertimeBalance = Math.round((previousOvertimeBalance + overtimeHours) * 100) / 100;

    // Krankheitstage
    const sickDays = await calculateSickDays(employeeId, yearNum, monthNum);

    // Minusstunden-Abzug berechnen
    let suggestedDeductionDays = 0;
    let suggestedDeductionHours = 0;
    if (cumulativeOvertimeBalance <= -8) {
      suggestedDeductionDays = Math.floor(Math.abs(cumulativeOvertimeBalance) / 8);
      suggestedDeductionHours = suggestedDeductionDays * 8;
    }

    res.json({
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
        })).map(a => ({ month: a.month, days: a.days, reason: a.reason })),
      },
      dailyHours,
    });
  } catch (error) {
    console.error('Preview report error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Vorschau' });
  }
});

// Monatsabrechnung erstellen
router.post('/create', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      employeeId: z.string().uuid(),
      year: z.number().min(2020).max(2100),
      month: z.number().min(1).max(12),
      notes: z.string().optional(),
      applyVacationDeduction: z.boolean().optional(),
      deductionDays: z.number().optional(),
    });

    const data = schema.parse(req.body);

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
      return res.status(400).json({ error: 'Abrechnung für diesen Monat existiert bereits' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: data.employeeId },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    const startDate = new Date(data.year, data.month - 1, 1);
    const endDate = new Date(data.year, data.month, 0, 23, 59, 59);

    const { totalHours } = await calculateHoursForPeriod(data.employeeId, startDate, endDate);

    // Soll-Stunden berechnen (berücksichtigt Feiertage und Abwesenheiten)
    const targetHours = await calculateAdjustedTargetHours(
      data.employeeId,
      data.year,
      data.month,
      employee.workDays,
      employee.weeklyHours
    );
    const overtimeHours = Math.round((totalHours - targetHours) * 100) / 100;

    // Urlaubstage berechnen
    const vacationDaysUsed = await calculateVacationDaysUsed(data.employeeId, data.year, data.month);
    const vacTotal = await calculateVacationDaysTotal(data.employeeId, data.year);
    const vacationDaysRemaining = vacTotal - vacationDaysUsed;

    // Übertrag vom Vormonat
    const previousReport = await getPreviousMonthReport(data.employeeId, data.year, data.month);
    const previousOvertimeBalance = previousReport?.cumulativeOvertimeBalance ?? 0;
    const cumulativeOvertimeBalance = Math.round((previousOvertimeBalance + overtimeHours) * 100) / 100;

    // Krankheitstage
    const sickDays = await calculateSickDays(data.employeeId, data.year, data.month);

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
        createdBy: `${req.employee!.firstName} ${req.employee!.lastName}`,
        status: 'draft',
      },
    });

    res.status(201).json(report);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create report error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Abrechnung' });
  }
});

// Abrechnung finalisieren und PDF generieren
router.post('/:id/finalize', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report) {
      return res.status(404).json({ error: 'Abrechnung nicht gefunden' });
    }

    if (report.status === 'finalized') {
      return res.status(400).json({ error: 'Abrechnung ist bereits finalisiert' });
    }

    // PDF generieren
    const pdfDir = path.join(process.cwd(), 'reports', report.employeeId);
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const safeName = `${report.employee.lastName}_${report.employee.firstName}`.replace(/[^a-zA-ZäöüÄÖÜß0-9_-]/g, '');
    const pdfFilename = `${safeName}_${String(report.month).padStart(2, '0')}_${report.year}.pdf`;
    const pdfRelPath = `${report.employeeId}/${pdfFilename}.enc`;
    const tempPath = path.join(pdfDir, pdfFilename);
    const encPath = path.join(pdfDir, `${pdfFilename}.enc`);

    const startDate = new Date(report.year, report.month - 1, 1);
    const endDate = new Date(report.year, report.month, 0, 23, 59, 59);
    const { dailyHours } = await calculateHoursForPeriod(report.employeeId, startDate, endDate);

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

    await generateMonthlyReportPDF({
      report: { ...report, vacationAdjustments: vacationAdjustments.map(a => ({ month: a.month, days: a.days, reason: a.reason })) },
      employee: report.employee,
      dailyHours,
      absences,
      holidays,
      settings,
      outputPath: tempPath,
      workCategory,
    } as any);

    // PDF verschlüsseln und Klartext löschen
    const pdfData = fs.readFileSync(tempPath);
    fs.writeFileSync(encPath, encryptBuffer(pdfData));
    fs.unlinkSync(tempPath);

    const updatedReport = await prisma.monthlyReport.update({
      where: { id },
      data: {
        status: 'finalized',
        finalizedAt: new Date(),
        pdfPath: pdfRelPath,
      },
    });

    res.json(updatedReport);
  } catch (error) {
    console.error('Finalize report error:', error);
    res.status(500).json({ error: 'Fehler beim Finalisieren der Abrechnung' });
  }
});

// PDF herunterladen
router.get('/:id/pdf', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report) {
      return res.status(404).json({ error: 'Abrechnung nicht gefunden' });
    }

    // Nicht-Admins können nur eigene Berichte herunterladen
    if (!req.employee!.isAdmin && report.employeeId !== req.employee!.id) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    if (!report.pdfPath) {
      return res.status(404).json({ error: 'PDF nicht verfügbar' });
    }

    const pdfFullPath = path.join(process.cwd(), 'reports', report.pdfPath);

    if (!fs.existsSync(pdfFullPath)) {
      return res.status(404).json({ error: 'PDF-Datei nicht gefunden' });
    }

    const dlSafeName = `${report.employee.lastName}_${report.employee.firstName}`.replace(/[^a-zA-ZäöüÄÖÜß0-9_-]/g, '');
    const downloadName = `${dlSafeName}_${String(report.month).padStart(2, '0')}_${report.year}.pdf`;

    const monthNames = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

    await createAuditLog({
      req,
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

    // Verschlüsselte Dateien (.enc) entschlüsseln, alte unverschlüsselte direkt senden
    if (report.pdfPath.endsWith('.enc')) {
      try {
        const pdfBuffer = decryptFile(pdfFullPath);
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
      } catch (decError) {
        console.error('PDF decryption error:', decError);
        return res.status(500).json({ error: 'Fehler bei der Entschlüsselung' });
      }
    } else {
      res.download(pdfFullPath, downloadName);
    }
  } catch (error) {
    console.error('Download PDF error:', error);
    res.status(500).json({ error: 'Fehler beim Herunterladen der PDF' });
  }
});

// PDF-Vorschau generieren (ohne zu speichern) - für Entwürfe
router.get('/:id/preview-pdf', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report) {
      return res.status(404).json({ error: 'Abrechnung nicht gefunden' });
    }

    // Zeiteinträge für den Monat laden
    const startDate = new Date(report.year, report.month - 1, 1);
    const endDate = new Date(report.year, report.month, 0, 23, 59, 59);
    const { dailyHours } = await calculateHoursForPeriod(report.employeeId, startDate, endDate);

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

    // Temporäres PDF generieren
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilename = `preview_${report.id}_${Date.now()}.pdf`;
    const tempPath = path.join(tempDir, tempFilename);

    await generateMonthlyReportPDF({
      report,
      employee: report.employee,
      dailyHours,
      absences,
      holidays,
      settings,
      outputPath: tempPath,
    });

    // PDF senden und danach löschen
    res.download(tempPath, `Vorschau_${report.employee.employeeNumber}_${report.year}_${report.month}.pdf`, (err) => {
      // Temporäre Datei löschen nach dem Senden
      fs.unlink(tempPath, () => {});
      if (err) {
        console.error('Error sending preview PDF:', err);
      }
    });
  } catch (error) {
    console.error('Preview PDF error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der PDF-Vorschau' });
  }
});

// Abrechnung neu berechnen (auch finalisierte - setzt Status auf draft zurück)
router.post('/:id/recalculate', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const report = await prisma.monthlyReport.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!report) {
      return res.status(404).json({ error: 'Abrechnung nicht gefunden' });
    }

    const startDate = new Date(report.year, report.month - 1, 1);
    const endDate = new Date(report.year, report.month, 0, 23, 59, 59);

    const { totalHours } = await calculateHoursForPeriod(report.employeeId, startDate, endDate);

    // Soll-Stunden berechnen (berücksichtigt Feiertage und Abwesenheiten)
    const targetHours = await calculateAdjustedTargetHours(
      report.employeeId,
      report.year,
      report.month,
      report.employee.workDays,
      report.employee.weeklyHours
    );
    const overtimeHours = Math.round((totalHours - targetHours) * 100) / 100;

    // Urlaubstage neu berechnen
    const vacationDaysUsed = await calculateVacationDaysUsed(report.employeeId, report.year, report.month);
    const vacTotal = await calculateVacationDaysTotal(report.employeeId, report.year);
    const vacationDaysRemaining = vacTotal - vacationDaysUsed;

    // Übertrag vom Vormonat
    const previousReport = await getPreviousMonthReport(report.employeeId, report.year, report.month);
    const previousOvertimeBalance = previousReport?.cumulativeOvertimeBalance ?? 0;
    const cumulativeOvertimeBalance = Math.round((previousOvertimeBalance + overtimeHours) * 100) / 100;

    // Krankheitstage
    const sickDays = await calculateSickDays(report.employeeId, report.year, report.month);

    // Bei finalisierten Abrechnungen: Alte PDF löschen und Status zurücksetzen
    if (report.status === 'finalized' && report.pdfPath) {
      const pdfFullPath = path.join(process.cwd(), 'reports', report.pdfPath);
      if (fs.existsSync(pdfFullPath)) {
        fs.unlinkSync(pdfFullPath);
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

    res.json({
      ...updatedReport,
      _warning: subsequentReports.length > 0
        ? `${subsequentReports.length} nachfolgende Abrechnung(en) sollten ebenfalls neu berechnet werden.`
        : undefined,
    });
  } catch (error) {
    console.error('Recalculate report error:', error);
    res.status(500).json({ error: 'Fehler beim Neuberechnen der Abrechnung' });
  }
});

// Abrechnung löschen (auch finalisierte - löscht zugehörige PDF)
router.delete('/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const report = await prisma.monthlyReport.findUnique({ where: { id } });

    if (!report) {
      return res.status(404).json({ error: 'Abrechnung nicht gefunden' });
    }

    // PDF löschen falls vorhanden
    if (report.pdfPath) {
      const pdfFullPath = path.join(process.cwd(), 'reports', report.pdfPath);
      if (fs.existsSync(pdfFullPath)) {
        fs.unlinkSync(pdfFullPath);
      }
    }

    await prisma.monthlyReport.delete({ where: { id } });

    res.json({ message: 'Abrechnung gelöscht' });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Abrechnung' });
  }
});

// Hilfsfunktionen

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
async function calculateVacationDaysUsed(employeeId: string, year: number, month: number): Promise<number> {
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
async function calculateVacationDaysTotal(employeeId: string, year: number): Promise<number> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { vacationDaysPerYear: true, carryOverVacationDays: true },
  });
  if (!employee) return 0;

  const adjustments = await prisma.vacationAdjustment.findMany({ where: { employeeId, year } });
  const adjDays = adjustments.reduce((s, a) => s + a.days, 0);

  const deductions = await prisma.vacationDeduction.findMany({ where: { employeeId, year } });
  const deductDays = deductions.reduce((s, d) => s + d.daysDeducted, 0);

  return employee.vacationDaysPerYear + ((employee as any).carryOverVacationDays || 0) + adjDays - deductDays;
}

// Holt den Report des Vormonats für Übertrag-Berechnung
async function getPreviousMonthReport(employeeId: string, year: number, month: number) {
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
async function calculateSickDays(employeeId: string, year: number, month: number): Promise<{ thisMonth: number; yearTotal: number }> {
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

export default router;
