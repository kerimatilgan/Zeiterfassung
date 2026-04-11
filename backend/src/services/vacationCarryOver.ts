import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export function startVacationCarryOverScheduler(): void {
  // Am 1. Januar um 00:05 Uhr
  cron.schedule('5 0 1 1 *', async () => {
    console.log('🔄 Urlaubsübertrag: Berechne Resturlaub...');
    try {
      await calculateCarryOver();
    } catch (error) {
      console.error('❌ Urlaubsübertrag fehlgeschlagen:', error);
    }
  });

  console.log('⏰ Urlaubsübertrag-Scheduler gestartet (1. Januar, 00:05)');
}

export async function calculateCarryOver(forYear?: number): Promise<void> {
  // forYear = das abgelaufene Jahr (default: letztes Jahr)
  const lastYear = forYear || new Date().getFullYear() - 1;
  const currentYear = lastYear + 1;

  const employees = await prisma.employee.findMany({
    where: { isActive: true, isAdmin: false },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      vacationDaysPerYear: true,
      carryOverVacationDays: true,
      workDays: true,
    },
  });

  console.log(`  Berechne Übertrag von ${lastYear} → ${currentYear} für ${employees.length} MA...`);

  for (const emp of employees) {
    const workDayNums = emp.workDays.split(',').map(Number);

    // Urlaubstage im abgelaufenen Jahr zählen (nur Arbeitstage)
    const vacationAbsences = await prisma.employeeAbsence.findMany({
      where: {
        employeeId: emp.id,
        date: { gte: new Date(lastYear, 0, 1), lte: new Date(lastYear, 11, 31, 23, 59, 59) },
        absenceType: { name: { contains: 'Urlaub' } },
      },
    });
    const vacationUsed = vacationAbsences.filter(a => workDayNums.includes(new Date(a.date).getDay())).length;

    // Gesamtanspruch letztes Jahr (inkl. damaligem Übertrag)
    const oldCarryOver = (emp as any).carryOverVacationDays || 0;
    const totalLastYear = emp.vacationDaysPerYear + oldCarryOver;
    const remaining = Math.max(0, totalLastYear - vacationUsed);

    // Neuen Übertrag setzen
    await prisma.employee.update({
      where: { id: emp.id },
      data: { carryOverVacationDays: remaining },
    });

    if (remaining > 0) {
      console.log(`  ✓ ${emp.firstName} ${emp.lastName}: ${remaining} Tage übertragen (${vacationUsed}/${totalLastYear} genommen)`);
    }

    // Audit-Log
    await prisma.auditLog.create({
      data: {
        userId: emp.id,
        userName: `${emp.firstName} ${emp.lastName}`,
        action: 'UPDATE',
        entityType: 'Employee',
        entityId: emp.id,
        note: `Urlaubsübertrag ${lastYear}→${currentYear}: ${remaining} Tage (${vacationUsed}/${totalLastYear} genommen)`,
        oldValues: JSON.stringify({ carryOverVacationDays: oldCarryOver }),
        newValues: JSON.stringify({ carryOverVacationDays: remaining }),
      },
    });
  }

  console.log('✅ Urlaubsübertrag abgeschlossen');
}
