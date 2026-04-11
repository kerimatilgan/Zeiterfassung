import { PrismaClient } from '@prisma/client';

/**
 * Auto Clock-Out: Stempelt alle noch eingestempelten Mitarbeiter aus
 * Cron: 59 23 * * *
 */
export async function handleAutoClockOut(prisma: PrismaClient) {
  console.log('Auto-Ausstempeln: Prüfe offene Einträge...');

  const openEntries = await prisma.timeEntry.findMany({
    where: { clockOut: null },
    include: {
      employee: {
        select: {
          id: true, firstName: true, lastName: true, email: true,
          employeeNumber: true, isAdmin: true, defaultClockOut: true,
        },
      },
    },
  });

  if (openEntries.length === 0) {
    console.log('Auto-Ausstempeln: Keine offenen Einträge');
    return;
  }

  console.log(`Auto-Ausstempeln: ${openEntries.length} offene Einträge gefunden`);

  for (const entry of openEntries) {
    const emp = entry.employee;
    if (emp.isAdmin) continue;

    const clockInDate = new Date(entry.clockIn);
    const today = new Date();
    let clockOutTime: Date;

    if (emp.defaultClockOut) {
      const [hours, minutes] = emp.defaultClockOut.split(':').map(Number);
      clockOutTime = new Date(clockInDate);
      clockOutTime.setHours(hours, minutes, 0, 0);
      if (clockOutTime <= clockInDate) {
        clockOutTime = new Date(clockInDate);
        clockOutTime.setHours(23, 59, 0, 0);
      }
    } else {
      clockOutTime = new Date(clockInDate);
      clockOutTime.setHours(23, 59, 0, 0);
    }

    if (clockOutTime > today) clockOutTime = today;

    try {
      await prisma.timeEntry.update({
        where: { id: entry.id },
        data: {
          clockOut: clockOutTime,
          editedBy: 'System (Auto-Ausstempeln)',
          note: `Automatisch ausgestempelt – Reguläres Ende: ${emp.defaultClockOut || 'nicht hinterlegt'}`,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: emp.id,
          userName: `${emp.firstName} ${emp.lastName}`,
          action: 'CLOCK_OUT',
          entityType: 'TimeEntry',
          entityId: entry.id,
          note: `Auto-Ausstempeln auf ${emp.defaultClockOut || '23:59'}`,
        },
      });

      console.log(`  Auto-Ausstempeln: ${emp.firstName} ${emp.lastName} ausgestempelt`);
    } catch (error) {
      console.error(`  Auto-Ausstempeln Fehler bei ${emp.firstName} ${emp.lastName}:`, error);
    }
  }
}

/**
 * Vacation Carry-Over: Überträgt Resturlaub zum Jahreswechsel
 * Cron: 0 0 1 1 *
 */
export async function handleVacationCarryOver(prisma: PrismaClient) {
  console.log('Urlaubs-Übertrag: Prüfe Jahreswechsel...');

  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, vacationDaysPerYear: true },
  });

  for (const emp of employees) {
    try {
      // Find last month's report for remaining vacation days
      const lastReport = await prisma.monthlyReport.findFirst({
        where: { employeeId: emp.id, year: lastYear },
        orderBy: { month: 'desc' },
      });

      if (lastReport && lastReport.vacationDaysRemaining > 0) {
        await prisma.employee.update({
          where: { id: emp.id },
          data: { carryOverVacationDays: lastReport.vacationDaysRemaining },
        });
        console.log(`  Urlaubs-Übertrag: ${emp.firstName} ${emp.lastName} → ${lastReport.vacationDaysRemaining} Tage`);
      }
    } catch (error) {
      console.error(`  Urlaubs-Übertrag Fehler bei ${emp.firstName} ${emp.lastName}:`, error);
    }
  }
}

/**
 * Backup handler (simplified for Workers - just logs)
 * Cron: 0 2 * * *
 */
export async function handleBackup(prisma: PrismaClient) {
  console.log('Backup: D1 Datenbank wird automatisch von Cloudflare gesichert.');
  // D1 has automatic backups managed by Cloudflare
  // No manual backup needed in Workers environment
}
