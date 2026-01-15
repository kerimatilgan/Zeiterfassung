import { Router, Response } from 'express';
import { prisma } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { generateMonthlyReportPDF } from '../utils/pdf.js';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

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

    // Soll-Stunden berechnen (Arbeitstage * tägliche Soll-Stunden)
    const workingDays = countWorkingDays(yearNum, monthNum);
    const dailyTargetHours = employee.weeklyHours / 5;
    const targetHours = workingDays * dailyTargetHours;

    const overtimeHours = Math.max(0, totalHours - targetHours);
    const grossPay = totalHours * employee.hourlyRate;

    res.json({
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`,
        employeeNumber: employee.employeeNumber,
        hourlyRate: employee.hourlyRate,
        weeklyHours: employee.weeklyHours,
      },
      period: {
        year: yearNum,
        month: monthNum,
        monthName: getMonthName(monthNum),
      },
      summary: {
        totalHours,
        targetHours: Math.round(targetHours * 100) / 100,
        overtimeHours: Math.round(overtimeHours * 100) / 100,
        grossPay: Math.round(grossPay * 100) / 100,
        workingDays,
        entriesCount: entries.length,
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

    const workingDays = countWorkingDays(data.year, data.month);
    const dailyTargetHours = employee.weeklyHours / 5;
    const targetHours = workingDays * dailyTargetHours;
    const overtimeHours = Math.max(0, totalHours - targetHours);
    const grossPay = totalHours * employee.hourlyRate;

    const report = await prisma.monthlyReport.create({
      data: {
        employeeId: data.employeeId,
        year: data.year,
        month: data.month,
        totalHours,
        targetHours,
        overtimeHours,
        grossPay,
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
    const pdfDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const pdfFilename = `abrechnung_${report.employee.employeeNumber}_${report.year}_${String(report.month).padStart(2, '0')}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);

    const startDate = new Date(report.year, report.month - 1, 1);
    const endDate = new Date(report.year, report.month, 0, 23, 59, 59);
    const { dailyHours } = await calculateHoursForPeriod(report.employeeId, startDate, endDate);

    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });

    await generateMonthlyReportPDF({
      report,
      employee: report.employee,
      dailyHours,
      settings,
      outputPath: pdfPath,
    });

    const updatedReport = await prisma.monthlyReport.update({
      where: { id },
      data: {
        status: 'finalized',
        finalizedAt: new Date(),
        pdfPath: pdfFilename,
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

    res.download(pdfFullPath, report.pdfPath);
  } catch (error) {
    console.error('Download PDF error:', error);
    res.status(500).json({ error: 'Fehler beim Herunterladen der PDF' });
  }
});

// Abrechnung löschen (nur Drafts)
router.delete('/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const report = await prisma.monthlyReport.findUnique({ where: { id } });

    if (!report) {
      return res.status(404).json({ error: 'Abrechnung nicht gefunden' });
    }

    if (report.status !== 'draft') {
      return res.status(400).json({ error: 'Nur Entwürfe können gelöscht werden' });
    }

    await prisma.monthlyReport.delete({ where: { id } });

    res.json({ message: 'Abrechnung gelöscht' });
  } catch (error) {
    console.error('Delete report error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Abrechnung' });
  }
});

// Hilfsfunktionen
function countWorkingDays(year: number, month: number): number {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  let count = 0;

  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) { // Nicht Samstag oder Sonntag
      count++;
    }
  }

  return count;
}

function getMonthName(month: number): string {
  const months = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];
  return months[month - 1];
}

export default router;
