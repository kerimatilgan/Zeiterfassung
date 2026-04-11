import PDFDocument from 'pdfkit';
import fs from 'fs';

interface TimeEntry {
  id: string;
  clockIn: Date;
  clockOut: Date | null;
  breakMinutes: number;
  note: string | null;
}

interface Absence {
  date: Date;
  absenceType: {
    name: string;
    shortName: string;
    requiredHours: number;
  };
}

interface Holiday {
  date: Date;
  name: string;
}

interface DailyData {
  date: string;
  hours: number;
  entries: TimeEntry[];
}

interface ReportData {
  report: {
    year: number;
    month: number;
    totalHours: number;
    targetHours: number;
    overtimeHours: number;
    previousOvertimeBalance: number;
    cumulativeOvertimeBalance: number;
    sickDaysThisMonth: number;
    sickDaysTotal: number;
    vacationDaysUsed: number;
    vacationDaysRemaining: number;
    notes?: string | null;
    createdBy: string;
  };
  employee: {
    firstName: string;
    lastName: string;
    employeeNumber: string;
    weeklyHours: number;
    vacationDaysPerYear: number;
    workDays: string;
  };
  dailyHours: DailyData[];
  absences?: Absence[];
  holidays?: Holiday[];
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

const DAY_NAMES_FULL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DAY_NAMES_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

// Konvertiert Date zu lokalem Datum-String (YYYY-MM-DD) - wichtig für Zeitzonenkorrektur
function toLocalDateString(date: Date): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Formatiert Minuten zu HH:MM Format
function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const absMinutes = Math.abs(minutes);
  const h = Math.floor(absMinutes / 60);
  const m = Math.floor(absMinutes % 60);
  return `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// Formatiert Zeit im HH:MM Format
function formatTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export async function generateMonthlyReportPDF(data: ReportData): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 30,
        size: 'A4',
        bufferPages: true
      });
      const stream = fs.createWriteStream(data.outputPath);

      doc.pipe(stream);

      const { report, employee, dailyHours, absences = [], holidays = [], settings } = data;

      // workDays parsen
      const workDayNumbers = employee.workDays.split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
      const dailyTargetMinutes = workDayNumbers.length > 0
        ? Math.round((employee.weeklyHours / workDayNumbers.length) * 60)
        : 0;

      // Alle Tage des Monats vorbereiten
      const daysInMonth = new Date(report.year, report.month, 0).getDate();
      const allDays: {
        date: Date;
        dateStr: string;
        dayOfWeek: number;
        isWorkDay: boolean;
        entries: TimeEntry[];
        absence?: Absence;
        holiday?: Holiday;
        netMinutes: number;
        breakMinutes: number;
        targetMinutes: number;
        diffMinutes: number;
      }[] = [];

      // Absences und Holidays in Maps für schnellen Zugriff
      // WICHTIG: toLocalDateString verwenden, nicht toISOString, wegen Zeitzonenverschiebung!
      const absenceMap = new Map<string, Absence>();
      absences.forEach(a => {
        const dateStr = toLocalDateString(new Date(a.date));
        absenceMap.set(dateStr, a);
      });

      const holidayMap = new Map<string, Holiday>();
      holidays.forEach(h => {
        const dateStr = toLocalDateString(new Date(h.date));
        holidayMap.set(dateStr, h);
      });

      // dailyHours in Map
      const dailyHoursMap = new Map<string, DailyData>();
      dailyHours.forEach(d => {
        dailyHoursMap.set(d.date, d);
      });

      let runningTotalMinutes = 0;

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(report.year, report.month - 1, day);
        const dateStr = `${report.year}-${String(report.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayOfWeek = date.getDay();
        const isWorkDay = workDayNumbers.includes(dayOfWeek);

        const dayData = dailyHoursMap.get(dateStr);
        const entries = dayData?.entries || [];
        const absence = absenceMap.get(dateStr);
        const holiday = holidayMap.get(dateStr);

        // Berechne Brutto-Minuten (erster clockIn bis letzter clockOut), Netto-Minuten (Summe Arbeitszeit), Pausen
        let netMinutes = 0;
        let firstClockIn: number | null = null;  // Timestamp
        let lastClockOut: number | null = null;  // Timestamp

        // Sortiere entries nach clockIn
        const sortedEntries = [...entries].sort((a, b) =>
          new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime()
        );

        sortedEntries.forEach(entry => {
          if (entry.clockOut) {
            const clockInTime = new Date(entry.clockIn).getTime();
            const clockOutTime = new Date(entry.clockOut).getTime();
            const worked = (clockOutTime - clockInTime) / (1000 * 60);
            const entryBreak = Number(entry.breakMinutes) || 0;
            netMinutes += worked - entryBreak;

            // Track first/last times
            if (firstClockIn === null || clockInTime < firstClockIn) {
              firstClockIn = clockInTime;
            }
            if (lastClockOut === null || clockOutTime > lastClockOut) {
              lastClockOut = clockOutTime;
            }
          }
        });

        // Brutto = von erstem Einstempeln bis letztem Ausstempeln
        // Pausen = Brutto - Netto (inkl. Lücken zwischen Einträgen)
        let grossMinutes = 0;
        let breakMinutes = 0;
        if (firstClockIn !== null && lastClockOut !== null) {
          grossMinutes = (lastClockOut - firstClockIn) / (1000 * 60);
          breakMinutes = Math.round(grossMinutes - netMinutes);
        }

        // Target für den Tag (nur an Arbeitstagen ohne Feiertag)
        let targetMinutes = 0;
        if (isWorkDay && !holiday) {
          // Bei Abwesenheit mit requiredHours = 0: kein Soll (z.B. Urlaub, Krank)
          // Der Mitarbeiter muss an diesem Tag nicht arbeiten
          if (absence && absence.absenceType.requiredHours === 0) {
            targetMinutes = 0;
          } else {
            targetMinutes = dailyTargetMinutes;
          }
        }

        // Bei Abwesenheit: requiredHours anrechnen (z.B. Berufsschule = halber Tag)
        if (absence && absence.absenceType.requiredHours > 0) {
          netMinutes = absence.absenceType.requiredHours * 60;
        }

        const diffMinutes = netMinutes - targetMinutes;
        runningTotalMinutes += diffMinutes;

        allDays.push({
          date,
          dateStr,
          dayOfWeek,
          isWorkDay,
          entries,
          absence,
          holiday,
          netMinutes: Math.round(netMinutes),
          breakMinutes: Math.round(breakMinutes),
          targetMinutes,
          diffMinutes: Math.round(diffMinutes),
        });
      }

      // ============ PDF RENDERING ============

      const pageWidth = doc.page.width - 60; // margins
      const leftMargin = 30;

      // --- HEADER ---
      doc.fontSize(14).font('Helvetica-Bold');
      doc.text(`Zeiterfassung - ${employee.firstName} ${employee.lastName}`, leftMargin, 30, { width: pageWidth * 0.6, lineBreak: false });
      doc.text(`${MONTH_NAMES[report.month - 1]} ${report.year}`, leftMargin, 30, { width: pageWidth, align: 'right', lineBreak: false });

      doc.fontSize(9).font('Helvetica');
      doc.text(`#${employee.employeeNumber} | ${employee.weeklyHours} h/Woche | gedruckt am ${new Date().toLocaleDateString('de-DE')}`, leftMargin, 48, { lineBreak: false });

      doc.y = 62;

      // Urlaubstage und Krankheitstage zählen
      let vacationDays = 0;
      let sickDays = 0;
      allDays.forEach(d => {
        if (d.absence) {
          const name = d.absence.absenceType.name.toLowerCase();
          if (name.includes('urlaub')) vacationDays++;
          else if (name.includes('krank')) sickDays++;
        }
      });

      // --- ZUSAMMENFASSUNG BANNER ---
      const summaryY = doc.y;
      const totalTargetMinutes = Math.round(report.targetHours * 60);
      const totalWorkedMinutes = Math.round(report.totalHours * 60);
      const diffMinutes = totalWorkedMinutes - totalTargetMinutes;

      // Box + Zusammenfassung: Automatische Seitenerstellung deaktivieren
      const origBufferedPageRange = (doc as any).bufferedPageRange;
      const colWidth = pageWidth / 4;
      const dataY = summaryY + 28;
      const dataY2 = dataY + 36;
      const prevBalance = report.previousOvertimeBalance || 0;
      const prevBalanceMinutes = Math.round(prevBalance * 60);
      const cumBalance = report.cumulativeOvertimeBalance || 0;
      const cumBalanceMinutes = Math.round(cumBalance * 60);
      const diffColor = diffMinutes >= 0 ? '#228B22' : '#DC143C';
      const prevColor = prevBalanceMinutes >= 0 ? '#228B22' : '#DC143C';
      const cumColor = cumBalanceMinutes >= 0 ? '#228B22' : '#DC143C';

      // Hilfsfunktion: Text ohne Cursor-Bewegung und ohne Seitenumbruch
      const t = (text: string, x: number, y: number, opts: any = {}) => {
        doc.y = y; // Cursor VOR dem Text auf die richtige Position setzen
        doc.text(text, x, y, { ...opts, lineBreak: false, height: 15 });
        doc.y = y; // Cursor nach dem Text zurücksetzen
      };

      // "bis einschl." Text VOR der Box
      doc.fontSize(9).font('Helvetica');
      t(`bis einschl. ${MONTH_NAMES[report.month - 1]}: Urlaub ${vacationDays} Tage, krank ${sickDays} Tage`, leftMargin + pageWidth - 280, summaryY - 12, { width: 280 });

      // Box (etwas höher für mehr Platz)
      doc.rect(leftMargin, summaryY, pageWidth, 115).stroke();

      // Titel
      doc.fontSize(12).font('Helvetica-Bold');
      t('Zusammenfassung', leftMargin + 10, summaryY + 8);
      // Arbeitskategorie (optional, rechts neben Zusammenfassung)
      const workCat = (data as any).workCategory;
      if (workCat) {
        doc.fontSize(9).font('Helvetica');
        t(`Kategorie: ${workCat.name} (ab ${workCat.earliestClockIn} Uhr)`, leftMargin + pageWidth - 200, summaryY + 10, { width: 190, align: 'right' });
      }

      // Reihe 1
      doc.fontSize(10).font('Helvetica-Bold');
      t('Gesamtstunden', leftMargin + 10, dataY);
      doc.font('Helvetica').fontSize(11);
      t(formatMinutes(totalWorkedMinutes), leftMargin + 10, dataY + 14);

      doc.fontSize(10).font('Helvetica-Bold');
      t('Soll-Stunden', leftMargin + colWidth + 10, dataY);
      doc.font('Helvetica').fontSize(11);
      t(formatMinutes(totalTargetMinutes), leftMargin + colWidth + 10, dataY + 14);

      doc.fontSize(10).font('Helvetica-Bold');
      t('Differenz Monat', leftMargin + colWidth * 2 + 10, dataY);
      doc.font('Helvetica').fontSize(11).fillColor(diffColor);
      t(formatMinutes(diffMinutes), leftMargin + colWidth * 2 + 10, dataY + 14);
      doc.fillColor('#000000');

      doc.fontSize(10).font('Helvetica-Bold');
      t('Urlaubstage', leftMargin + colWidth * 3 + 10, dataY);
      doc.font('Helvetica').fontSize(11);
      // Adjustments im Gesamt berücksichtigen
      const adjList2 = (report as any).vacationAdjustments || [];
      const adjTotal = adjList2.reduce((s: number, a: any) => s + a.days, 0);
      const vacTotal = employee.vacationDaysPerYear + adjTotal;
      t(`${report.vacationDaysUsed} / ${vacTotal}`, leftMargin + colWidth * 3 + 10, dataY + 14);

      // Reihe 2
      doc.fontSize(10).font('Helvetica-Bold');
      t('Übertrag Vormonat', leftMargin + 10, dataY2);
      doc.font('Helvetica').fontSize(11).fillColor(prevColor);
      t(formatMinutes(prevBalanceMinutes), leftMargin + 10, dataY2 + 14);
      doc.fillColor('#000000');

      doc.fontSize(9).font('Helvetica-Bold');
      t('Überstunden-Saldo', leftMargin + colWidth + 10, dataY2);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(cumColor);
      t(formatMinutes(cumBalanceMinutes), leftMargin + colWidth + 10, dataY2 + 13);
      doc.fillColor('#000000').font('Helvetica');

      doc.fontSize(10).font('Helvetica-Bold');
      t('Krank (Monat)', leftMargin + colWidth * 2 + 10, dataY2);
      doc.font('Helvetica').fontSize(11);
      t(`${report.sickDaysThisMonth || 0} Tage`, leftMargin + colWidth * 2 + 10, dataY2 + 14);

      doc.fontSize(10).font('Helvetica-Bold');
      t('Krank (Jahr)', leftMargin + colWidth * 3 + 10, dataY2);
      doc.font('Helvetica').fontSize(11);
      t(`${report.sickDaysTotal || 0} Tage`, leftMargin + colWidth * 3 + 10, dataY2 + 14);

      // Cursor nach der Box setzen
      doc.y = summaryY + 122;

      // Minusstunden-Urlaubsabzug Hinweis
      if ((report as any).vacationDeductionDays > 0) {
        doc.moveDown(0.3);
        const deductY = doc.y;
        doc.rect(leftMargin, deductY, pageWidth, 22).fillAndStroke('#FEF3C7', '#F59E0B');
        doc.fillColor('#92400E').fontSize(9).font('Helvetica-Bold');
        doc.text(
          `Hinweis: In dieser Abrechnung wurden ${(report as any).vacationDeductionDays} Urlaubstag(e) für ${(report as any).vacationDeductionHours}h Minusstunden-Ausgleich abgezogen.`,
          leftMargin + 8, deductY + 6, { width: pageWidth - 16 }
        );
        doc.fillColor('#000000').font('Helvetica');
        doc.y = deductY + 26;
      }

      // Urlaubsanpassung Hinweis
      const adjList = (report as any).vacationAdjustments || [];
      if (adjList.length > 0) {
        doc.moveDown(0.3);
        const adjY = doc.y;
        const adjText = adjList.map((a: any) => {
          const mNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
          return `${mNames[a.month - 1]}: ${a.days > 0 ? '+' : ''}${a.days} Tag(e) – ${a.reason}`;
        }).join('; ');
        doc.rect(leftMargin, adjY, pageWidth, 22).fillAndStroke('#DBEAFE', '#3B82F6');
        doc.fillColor('#1E40AF').fontSize(9).font('Helvetica-Bold');
        t(`Urlaubsanpassung: ${adjText}`, leftMargin + 8, adjY + 6, { width: pageWidth - 16 });
        doc.fillColor('#000000').font('Helvetica');
        doc.y = adjY + 26;
      }

      doc.moveDown(1);

      // --- TABELLE ---
      const tableTop = doc.y;
      const colWidths = {
        datum: 70,
        dienst: 65,
        beginn: 45,
        ende: 45,
        pausen: 45,
        netto: 45,
        soll: 45,
        tagDiff: 50,
        monatDiff: 55,
      };

      let x = leftMargin;

      // Header
      doc.fontSize(9).font('Helvetica-Bold');
      t('Datum', x, tableTop); x += colWidths.datum;
      t('Dienst', x, tableTop); x += colWidths.dienst;
      t('Beginn', x, tableTop); x += colWidths.beginn;
      t('Ende', x, tableTop); x += colWidths.ende;
      t('Pausen', x, tableTop, { width: colWidths.pausen - 5, align: 'right' }); x += colWidths.pausen;
      t('Netto', x, tableTop, { width: colWidths.netto - 5, align: 'right' }); x += colWidths.netto;
      t('Soll', x, tableTop, { width: colWidths.soll - 5, align: 'right' }); x += colWidths.soll;
      t('Tag+/-', x, tableTop, { width: colWidths.tagDiff - 5, align: 'right' }); x += colWidths.tagDiff;
      t('Monat+/-', x, tableTop, { width: colWidths.monatDiff - 5, align: 'right' });

      // Linie unter Header
      doc.moveTo(leftMargin, tableTop + 14).lineTo(leftMargin + pageWidth, tableTop + 14).stroke();

      let y = tableTop + 18;
      // Monat+/- startet mit dem Übertrag vom Vormonat
      let runningTotal = Math.round((report.previousOvertimeBalance || 0) * 60);

      doc.font('Helvetica').fontSize(9);

      for (const day of allDays) {
        // Neue Seite wenn nötig
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 30;
        }

        const dateFormatted = `${String(day.date.getDate()).padStart(2, '0')}.${String(day.date.getMonth() + 1).padStart(2, '0')}.${String(day.date.getFullYear()).slice(-2)} ${DAY_NAMES_SHORT[day.dayOfWeek]}`;

        // Bestimme Dienst-Typ
        let dienstTyp = '';
        if (day.holiday) {
          dienstTyp = 'Feiertag';
        } else if (day.absence) {
          dienstTyp = day.absence.absenceType.shortName || day.absence.absenceType.name;
        } else if (!day.isWorkDay) {
          dienstTyp = 'frei';
        } else if (day.entries.length > 0) {
          dienstTyp = 'Tagdienst';
        } else if (day.isWorkDay) {
          dienstTyp = 'Abwesend';
        }

        // Zeiten
        let beginn = '';
        let ende = '';
        if (day.entries.length > 0) {
          const firstEntry = day.entries[0];
          const lastEntry = day.entries[day.entries.length - 1];
          beginn = formatTime(new Date(firstEntry.clockIn));
          if (lastEntry.clockOut) {
            ende = formatTime(new Date(lastEntry.clockOut));
          }
        }

        const pausen = day.breakMinutes > 0 ? formatMinutes(day.breakMinutes) : '';
        const netto = day.netMinutes > 0 ? formatMinutes(day.netMinutes) : '';
        const soll = formatMinutes(day.targetMinutes);

        runningTotal += day.diffMinutes;
        const tagDiff = formatMinutes(day.diffMinutes);
        const monatDiff = formatMinutes(runningTotal);

        // Zeile zeichnen
        x = leftMargin;
        const rowColor = !day.isWorkDay ? '#888888' : '#000000';
        doc.fillColor(rowColor);

        t(dateFormatted, x, y, { width: colWidths.datum - 5 }); x += colWidths.datum;
        t(dienstTyp, x, y, { width: colWidths.dienst - 5 }); x += colWidths.dienst;
        t(beginn, x, y, { width: colWidths.beginn - 5 }); x += colWidths.beginn;
        t(ende, x, y, { width: colWidths.ende - 5 }); x += colWidths.ende;
        t(pausen, x, y, { width: colWidths.pausen - 5, align: 'right' }); x += colWidths.pausen;
        t(netto, x, y, { width: colWidths.netto - 5, align: 'right' }); x += colWidths.netto;
        t(soll, x, y, { width: colWidths.soll - 5, align: 'right' }); x += colWidths.soll;
        t(tagDiff, x, y, { width: colWidths.tagDiff - 5, align: 'right' }); x += colWidths.tagDiff;
        t(monatDiff, x, y, { width: colWidths.monatDiff - 5, align: 'right' });

        doc.fillColor('#000000');
        y += 16;

        // Dünne Trennlinie zwischen den Tagen
        doc.strokeColor('#E5E5E5').lineWidth(0.5);
        doc.moveTo(leftMargin, y - 4).lineTo(leftMargin + pageWidth, y - 4).stroke();
        doc.strokeColor('#000000').lineWidth(1);
      }

      // --- FOOTER SUMMARY ---
      y += 10;
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 30;
      }

      doc.moveTo(leftMargin, y).lineTo(leftMargin + pageWidth, y).stroke();
      y += 10;

      const footerTotalTargetMinutes = Math.round(report.targetHours * 60);
      const footerTotalWorkedMinutes = Math.round(report.totalHours * 60);
      const footerDiffMinutes = footerTotalWorkedMinutes - footerTotalTargetMinutes;

      // Feiertage zählen
      const holidayCount = allDays.filter(d => d.holiday && d.isWorkDay).length;

      doc.fontSize(10).font('Helvetica-Bold');

      // Footer in 3 Spalten mit fester Breite
      const footerCol1 = leftMargin;
      const footerCol2 = leftMargin + 180;
      const footerCol3 = leftMargin + 360;
      const labelWidth = 75;
      const valueWidth = 55;

      // Zeile 1
      doc.font('Helvetica-Bold'); t('Gesamt-Soll', footerCol1, y, { width: labelWidth });
      doc.font('Helvetica'); t(formatMinutes(footerTotalTargetMinutes), footerCol1 + labelWidth, y, { width: valueWidth, align: 'right' });
      doc.font('Helvetica-Bold'); t('Urlaub', footerCol2, y, { width: labelWidth });
      doc.font('Helvetica'); t(formatMinutes(vacationDays * dailyTargetMinutes), footerCol2 + labelWidth, y, { width: valueWidth, align: 'right' });
      doc.font('Helvetica-Bold'); t('Feiertage', footerCol3, y, { width: labelWidth });
      doc.font('Helvetica'); t(formatMinutes(holidayCount * dailyTargetMinutes), footerCol3 + labelWidth, y, { width: valueWidth, align: 'right' });

      y += 16;
      // Zeile 2
      doc.font('Helvetica-Bold'); t('Arbeitszeit', footerCol1, y, { width: labelWidth });
      doc.font('Helvetica'); t(formatMinutes(footerTotalWorkedMinutes), footerCol1 + labelWidth, y, { width: valueWidth, align: 'right' });
      doc.font('Helvetica-Bold'); t('krank', footerCol2, y, { width: labelWidth });
      doc.font('Helvetica'); t(formatMinutes(sickDays * dailyTargetMinutes), footerCol2 + labelWidth, y, { width: valueWidth, align: 'right' });
      doc.font('Helvetica-Bold'); t('Gesamtsumme', footerCol3, y, { width: labelWidth });
      doc.font('Helvetica'); t(formatMinutes(footerTotalWorkedMinutes), footerCol3 + labelWidth, y, { width: valueWidth, align: 'right' });

      y += 16;
      // Zeile 3
      doc.font('Helvetica-Bold'); t('Differenz', footerCol1, y, { width: labelWidth });
      doc.font('Helvetica'); t(formatMinutes(footerDiffMinutes), footerCol1 + labelWidth, y, { width: valueWidth, align: 'right' });
      doc.font('Helvetica-Bold'); t('Krank (Jahr)', footerCol2, y, { width: labelWidth });
      doc.font('Helvetica'); t(`${report.sickDaysTotal || 0} Tage`, footerCol2 + labelWidth, y, { width: valueWidth, align: 'right' });

      y += 16;
      // Zeile 4: Übertrag
      const footerPrevBalance = Math.round((report.previousOvertimeBalance || 0) * 60);
      const footerCumBalance = Math.round((report.cumulativeOvertimeBalance || 0) * 60);
      doc.font('Helvetica-Bold'); t('Übertrag Vorm.', footerCol1, y, { width: labelWidth });
      doc.font('Helvetica'); t(formatMinutes(footerPrevBalance), footerCol1 + labelWidth, y, { width: valueWidth, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(8); t('Überstunden-Saldo', footerCol2, y + 1, { width: labelWidth + 15 });
      doc.fontSize(10);
      const footerCumColor = footerCumBalance >= 0 ? '#228B22' : '#DC143C';
      doc.font('Helvetica-Bold').fillColor(footerCumColor);
      t(formatMinutes(footerCumBalance), footerCol2 + labelWidth + 5, y, { width: valueWidth, align: 'right' });
      doc.fillColor('#000000').font('Helvetica');
      doc.y = y + 20;

      // Notizen
      if (report.notes) {
        y += 25;
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Notizen:', leftMargin, y);
        doc.font('Helvetica').fontSize(10);
        doc.text(report.notes, leftMargin, y + 15, { width: pageWidth });
      }

      doc.end();

      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}
