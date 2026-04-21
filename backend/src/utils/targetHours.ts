import { prisma } from '../index.js';

export interface TargetHoursInput {
  employeeId: string;
  year: number;
  month: number; // 0-11 (JS Date Monat)
  untilDay?: number; // Optional: nur bis zu diesem Tag rechnen (für Überstunden-Saldo)
}

export interface TargetHoursResult {
  monthlyTarget: number; // Volles Monatssoll
  monthlyTargetUntilToday: number; // Soll bis zum angegebenen Tag (oder heute falls im aktuellen Monat)
  dailyHours: number;
  workDaysArray: number[];
  holidaySet: Set<string>;
  absenceMap: Map<string, number>;
  empStartDate: Date | null;
  empEndDate: Date | null;
  toDateKey: (d: Date) => string;
}

/**
 * Zentrale Berechnung des Monatssoll für einen Mitarbeiter.
 *
 * Berücksichtigt:
 * - workDays (z.B. "1,2,3,5" = Mo/Di/Mi/Fr)
 * - weeklyHours / workDays = tägliches Soll
 * - Feiertage → 0h
 * - Abwesenheiten (Urlaub/Krank → 0h, Schule → requiredHours)
 * - Eintrittsdatum (startDate) und Austrittsdatum (endDate)
 * - Timezone: DB speichert Mitternacht UTC, wir normalisieren auf Lokalzeit
 */
export async function calculateTargetHours({
  employeeId,
  year,
  month,
  untilDay,
}: TargetHoursInput): Promise<TargetHoursResult> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      weeklyHours: true,
      workDays: true,
      startDate: true,
      endDate: true,
    },
  });

  if (!employee) {
    throw new Error('Mitarbeiter nicht gefunden');
  }

  const workDaysArray = (employee.workDays ?? '1,2,3,4,5').split(',').map(Number);
  const nominalWeeklyTarget = employee.weeklyHours ?? 40;
  const dailyHours = workDaysArray.length > 0 ? nominalWeeklyTarget / workDaysArray.length : 0;

  // Monatsgrenzen (lokale Mitternacht)
  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  // Start/End-Datum auf Mitternacht Lokalzeit normalisieren
  // (DB speichert Mitternacht UTC, was lokal z.B. 02:00 ergibt → Vergleich mit
  // "date < empStartDate" würde sonst den Eintrittstag fälschlich überspringen)
  const normalizeToLocalMidnight = (d: Date | null) =>
    d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
  const empStartDate = normalizeToLocalMidnight(employee.startDate);
  const empEndDate = normalizeToLocalMidnight(employee.endDate);

  // Datum als YYYY-MM-DD String (Lokalzeit) für Map/Set-Lookups
  const toDateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const monthHolidays = await prisma.holiday.findMany({
    where: { date: { gte: startOfMonth, lte: endOfMonth } },
  });
  const holidaySet = new Set(monthHolidays.map((h) => toDateKey(h.date)));

  const monthAbsences = await prisma.employeeAbsence.findMany({
    where: { employeeId, date: { gte: startOfMonth, lte: endOfMonth } },
    include: { absenceType: true },
  });
  const absenceMap = new Map<string, number>();
  monthAbsences.forEach((a) => absenceMap.set(toDateKey(a.date), a.absenceType.requiredHours));

  const calcForRange = (fromDay: number, toDay: number): number => {
    let target = 0;
    for (let d = fromDay; d <= toDay; d++) {
      const date = new Date(year, month, d);
      if (empStartDate && date < empStartDate) continue;
      if (empEndDate && date > empEndDate) continue;
      const dayOfWeek = date.getDay();
      // workDaysArray speichert 1=Mo..5=Fr,6=Sa,7=So; date.getDay() ist 0=So,1=Mo,..6=Sa
      if (!workDaysArray.includes(dayOfWeek === 0 ? 7 : dayOfWeek)) continue;

      const dateStr = toDateKey(date);
      // Feiertag → 0 Soll
      if (holidaySet.has(dateStr)) continue;
      // Abwesenheit → requiredHours (0 bei Urlaub/Krank, >0 bei Schule)
      if (absenceMap.has(dateStr)) {
        target += absenceMap.get(dateStr)!;
      } else {
        target += dailyHours;
      }
    }
    return Math.round(target * 100) / 100;
  };

  const monthlyTarget = calcForRange(1, lastDayOfMonth);
  const effectiveUntilDay = untilDay != null ? Math.min(untilDay, lastDayOfMonth) : lastDayOfMonth;
  const monthlyTargetUntilToday = calcForRange(1, effectiveUntilDay);

  return {
    monthlyTarget,
    monthlyTargetUntilToday,
    dailyHours,
    workDaysArray,
    holidaySet,
    absenceMap,
    empStartDate,
    empEndDate,
    toDateKey,
  };
}
