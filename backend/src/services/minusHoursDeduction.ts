import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from '../utils/emailService.js';

const prisma = new PrismaClient();

const MINUS_HOURS_THRESHOLD = -8; // Ab -8h wird 1 Urlaubstag abgezogen
const HOURS_PER_DAY = 8; // Stunden die pro abgezogenem Tag gutgeschrieben werden

export function startMinusHoursScheduler(): void {
  // Am 1. jedes Monats um 01:00 Uhr prüfen
  cron.schedule('0 1 1 * *', async () => {
    console.log('🔄 Minusstunden-Check: Prüfe Überstunden-Salden...');
    try {
      await checkMinusHours();
    } catch (error) {
      console.error('❌ Minusstunden-Check fehlgeschlagen:', error);
    }
  });

  console.log('⏰ Minusstunden-Check gestartet (1. des Monats, 01:00)');
}

export async function checkMinusHours(): Promise<void> {
  const now = new Date();
  const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // Vormonat
  const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  const employees = await prisma.employee.findMany({
    where: { isActive: true, isAdmin: false },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      employeeNumber: true,
      vacationDaysPerYear: true,
      carryOverVacationDays: true,
      workDays: true,
    },
  });

  for (const emp of employees) {
    // Letzten finalisierten Monatsbericht holen
    const lastReport = await prisma.monthlyReport.findFirst({
      where: { employeeId: emp.id, status: 'finalized' },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      select: { cumulativeOvertimeBalance: true, year: true, month: true },
    });

    if (!lastReport) continue;

    const balance = lastReport.cumulativeOvertimeBalance;

    // Prüfen ob bereits ein Abzug für diesen Monat existiert
    const existingDeduction = await prisma.vacationDeduction.findFirst({
      where: { employeeId: emp.id, year: lastReport.year, month: lastReport.month },
    });

    if (existingDeduction) continue; // Bereits abgezogen

    if (balance <= MINUS_HOURS_THRESHOLD) {
      // Berechne wie viele Tage abzuziehen sind
      const daysToDeduct = Math.floor(Math.abs(balance) / HOURS_PER_DAY);
      if (daysToDeduct < 1) continue;

      const hoursCompensated = daysToDeduct * HOURS_PER_DAY;
      const newBalance = balance + hoursCompensated;

      // Deduction erstellen
      await prisma.vacationDeduction.create({
        data: {
          employeeId: emp.id,
          year: lastReport.year,
          month: lastReport.month,
          reason: `Minusstunden-Ausgleich: ${balance.toFixed(1)}h → ${daysToDeduct} Urlaubstag(e) abgezogen, ${hoursCompensated}h gutgeschrieben`,
          daysDeducted: daysToDeduct,
          hoursCompensated,
          overtimeBalanceBefore: balance,
          overtimeBalanceAfter: newBalance,
        },
      });

      console.log(`  ⚠ ${emp.firstName} ${emp.lastName}: ${daysToDeduct} Urlaubstag(e) abgezogen (Saldo: ${balance.toFixed(1)}h → ${newBalance.toFixed(1)}h)`);

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: emp.id,
          userName: `${emp.firstName} ${emp.lastName}`,
          action: 'UPDATE',
          entityType: 'VacationDeduction',
          note: `Minusstunden-Abzug: ${daysToDeduct} Urlaubstag(e), ${hoursCompensated}h gutgeschrieben. Saldo: ${balance.toFixed(1)}h → ${newBalance.toFixed(1)}h`,
        },
      });

      // MA per E-Mail informieren
      if (emp.email) {
        try {
          await sendEmail({
            to: emp.email,
            subject: `Urlaubsabzug wegen Minusstunden`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
                <div style="background: #f59e0b; color: white; padding: 24px;">
                  <h2 style="margin: 0;">Urlaubsabzug</h2>
                  <p style="margin: 6px 0 0 0; opacity: 0.9;">Hallo ${emp.firstName},</p>
                </div>
                <div style="background: white; padding: 24px;">
                  <p style="font-size: 14px; color: #374151;">
                    aufgrund deines Überstunden-Saldos von <strong>${balance.toFixed(1)} Stunden</strong> wurde(n)
                    <strong>${daysToDeduct} Urlaubstag(e)</strong> abgezogen und dir <strong>${hoursCompensated} Stunden</strong> gutgeschrieben.
                  </p>
                  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr><td style="padding: 8px 0; color: #6b7280;">Saldo vorher:</td><td style="padding: 8px 0; font-weight: 600;">${balance.toFixed(1)} h</td></tr>
                    <tr><td style="padding: 8px 0; color: #6b7280;">Gutschrift:</td><td style="padding: 8px 0; font-weight: 600; color: #16a34a;">+${hoursCompensated} h</td></tr>
                    <tr><td style="padding: 8px 0; color: #6b7280;">Saldo nachher:</td><td style="padding: 8px 0; font-weight: 600;">${newBalance.toFixed(1)} h</td></tr>
                    <tr><td style="padding: 8px 0; color: #6b7280;">Urlaubstage abgezogen:</td><td style="padding: 8px 0; font-weight: 600; color: #dc2626;">${daysToDeduct}</td></tr>
                  </table>
                  <p style="font-size: 13px; color: #6b7280;">
                    Gemäß Arbeitsvertrag wird bei mehr als ${Math.abs(MINUS_HOURS_THRESHOLD)} Minusstunden ein Urlaubstag abgezogen.
                  </p>
                </div>
                <div style="background: #f9fafb; padding: 14px 24px; text-align: center; color: #9ca3af; font-size: 12px;">
                  Zeiterfassung – Automatische Benachrichtigung
                </div>
              </div>
            `,
          });
        } catch {}
      }
    }
  }
}
