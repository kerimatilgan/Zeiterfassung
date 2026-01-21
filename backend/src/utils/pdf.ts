import PDFDocument from 'pdfkit';
import fs from 'fs';

interface DailyHour {
  date: string;
  hours: number;
}

interface ReportData {
  report: {
    year: number;
    month: number;
    totalHours: number;
    targetHours: number;
    overtimeHours: number;
    vacationDaysUsed: number;
    vacationDaysRemaining: number;
    notes?: string | null;
    createdBy: string;
  };
  employee: {
    firstName: string;
    lastName: string;
    employeeNumber: string;
    vacationDaysPerYear: number;
    workDays: string;
  };
  dailyHours: DailyHour[];
  settings: {
    companyName: string;
    companyAddress?: string | null;
    companyPhone?: string | null;
    companyEmail?: string | null;
  } | null;
  outputPath: string;
}

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export async function generateMonthlyReportPDF(data: ReportData): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const stream = fs.createWriteStream(data.outputPath);

      doc.pipe(stream);

      const { report, employee, dailyHours, settings } = data;

      // Header
      doc.fontSize(20).font('Helvetica-Bold');
      doc.text(settings?.companyName || 'Handy-Insel', { align: 'center' });

      doc.fontSize(10).font('Helvetica');
      if (settings?.companyAddress) {
        doc.text(settings.companyAddress, { align: 'center' });
      }
      if (settings?.companyPhone || settings?.companyEmail) {
        doc.text(
          [settings?.companyPhone, settings?.companyEmail].filter(Boolean).join(' | '),
          { align: 'center' }
        );
      }

      doc.moveDown(2);

      // Titel
      doc.fontSize(16).font('Helvetica-Bold');
      doc.text(`Stundenabrechnung ${MONTH_NAMES[report.month - 1]} ${report.year}`, { align: 'center' });

      doc.moveDown();

      // Mitarbeiterdaten
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Mitarbeiter:');
      doc.font('Helvetica').fontSize(11);
      doc.text(`Name: ${employee.firstName} ${employee.lastName}`);
      doc.text(`Mitarbeiternummer: ${employee.employeeNumber}`);

      doc.moveDown(1.5);

      // Zusammenfassung Box
      const summaryY = doc.y;
      doc.rect(50, summaryY, 495, 95).stroke();

      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Zusammenfassung', 60, summaryY + 10);

      doc.fontSize(10).font('Helvetica');
      const col1X = 60;
      const col2X = 300;
      let rowY = summaryY + 30;

      doc.text(`Gesamtstunden:`, col1X, rowY);
      doc.text(`${report.totalHours.toFixed(2)} Std.`, col1X + 100, rowY);
      doc.text(`Soll-Stunden:`, col2X, rowY);
      doc.text(`${report.targetHours.toFixed(2)} Std.`, col2X + 100, rowY);

      rowY += 15;
      doc.text(`Überstunden:`, col1X, rowY);
      doc.text(`${report.overtimeHours.toFixed(2)} Std.`, col1X + 100, rowY);

      rowY += 15;
      doc.text(`Urlaubstage:`, col1X, rowY);
      doc.font('Helvetica-Bold');
      doc.text(`${report.vacationDaysUsed} von ${employee.vacationDaysPerYear} genommen`, col1X + 100, rowY);
      doc.font('Helvetica');
      doc.text(`Verbleibend:`, col2X, rowY);
      doc.font('Helvetica-Bold').text(`${report.vacationDaysRemaining} Tage`, col2X + 100, rowY);

      doc.y = summaryY + 110;

      // Tägliche Aufstellung
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text('Tägliche Aufstellung');
      doc.moveDown(0.5);

      // Tabellen-Header
      const tableTop = doc.y;
      const tableLeft = 50;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Datum', tableLeft, tableTop);
      doc.text('Tag', tableLeft + 80, tableTop);
      doc.text('Stunden', tableLeft + 120, tableTop);

      doc.text('Datum', tableLeft + 180, tableTop);
      doc.text('Tag', tableLeft + 260, tableTop);
      doc.text('Stunden', tableLeft + 300, tableTop);

      doc.moveTo(tableLeft, tableTop + 15).lineTo(tableLeft + 350, tableTop + 15).stroke();

      // Alle Tage des Monats generieren
      const daysInMonth = new Date(report.year, report.month, 0).getDate();
      const allDays: { date: string; dayName: string; hours: number; dayOfWeek: number }[] = [];

      // workDays parsen (z.B. "1,2,3,4,5" -> [1,2,3,4,5])
      const workDayNumbers = employee.workDays.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${report.year}-${String(report.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(report.year, report.month - 1, day);
        const dayOfWeek = dateObj.getDay();
        const dayName = DAY_NAMES[dayOfWeek];
        const entry = dailyHours.find(d => d.date === dateStr);
        allDays.push({
          date: dateStr,
          dayName,
          hours: entry?.hours || 0,
          dayOfWeek,
        });
      }

      // In zwei Spalten aufteilen
      const midPoint = Math.ceil(allDays.length / 2);
      let rowOffset = 20;

      doc.fontSize(8).font('Helvetica');

      for (let i = 0; i < midPoint; i++) {
        const y = tableTop + rowOffset;

        // Linke Spalte
        const leftDay = allDays[i];
        const leftDateFormatted = leftDay.date.split('-').reverse().join('.');
        const isNonWorkDayLeft = !workDayNumbers.includes(leftDay.dayOfWeek);

        if (isNonWorkDayLeft) doc.fillColor('#888888');
        doc.text(leftDateFormatted, tableLeft, y);
        doc.text(leftDay.dayName, tableLeft + 80, y);
        doc.text(leftDay.hours > 0 ? leftDay.hours.toFixed(2) : '-', tableLeft + 120, y);
        if (isNonWorkDayLeft) doc.fillColor('#000000');

        // Rechte Spalte
        const rightIndex = i + midPoint;
        if (rightIndex < allDays.length) {
          const rightDay = allDays[rightIndex];
          const rightDateFormatted = rightDay.date.split('-').reverse().join('.');
          const isNonWorkDayRight = !workDayNumbers.includes(rightDay.dayOfWeek);

          if (isNonWorkDayRight) doc.fillColor('#888888');
          doc.text(rightDateFormatted, tableLeft + 180, y);
          doc.text(rightDay.dayName, tableLeft + 260, y);
          doc.text(rightDay.hours > 0 ? rightDay.hours.toFixed(2) : '-', tableLeft + 300, y);
          if (isNonWorkDayRight) doc.fillColor('#000000');
        }

        rowOffset += 12;
      }

      // Notizen
      if (report.notes) {
        doc.y = tableTop + rowOffset + 20;
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Notizen:');
        doc.font('Helvetica').fontSize(9);
        doc.text(report.notes);
      }

      // Footer
      doc.fontSize(8).font('Helvetica');
      doc.text(
        `Erstellt am: ${new Date().toLocaleDateString('de-DE')} von ${report.createdBy}`,
        50,
        doc.page.height - 50,
        { align: 'center' }
      );

      doc.end();

      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}
