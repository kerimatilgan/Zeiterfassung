import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from '../utils/emailService.js';

const prisma = new PrismaClient();

export function startAutoClockOutScheduler(): void {
  // Jeden Tag um 23:59
  cron.schedule('59 23 * * *', async () => {
    console.log('🔄 Auto-Ausstempeln: Prüfe offene Einträge...');
    try {
      await autoClockOutAll();
    } catch (error) {
      console.error('❌ Auto-Ausstempeln fehlgeschlagen:', error);
    }
  });

  console.log('⏰ Auto-Ausstempel-Scheduler gestartet (täglich 23:59)');
}

async function autoClockOutAll() {
  // Alle offenen Einträge (clockOut = null) mit nicht-Admin MA
  const openEntries = await prisma.timeEntry.findMany({
    where: { clockOut: null },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          employeeNumber: true,
          isAdmin: true,
          defaultClockOut: true,
        },
      },
    },
  });

  if (openEntries.length === 0) {
    console.log('✅ Auto-Ausstempeln: Keine offenen Einträge');
    return;
  }

  console.log(`🔄 Auto-Ausstempeln: ${openEntries.length} offene Einträge gefunden`);

  for (const entry of openEntries) {
    const emp = entry.employee;

    // Admins überspringen
    if (emp.isAdmin) continue;

    // Ausstempelzeit berechnen
    const clockInDate = new Date(entry.clockIn);
    const today = new Date();
    let clockOutTime: Date;

    if (emp.defaultClockOut) {
      // Reguläres Arbeitszeitende verwenden
      const [hours, minutes] = emp.defaultClockOut.split(':').map(Number);
      clockOutTime = new Date(clockInDate);
      clockOutTime.setHours(hours, minutes, 0, 0);

      // Wenn das berechnete clockOut VOR dem clockIn liegt, Eintrag am selben Tag setzen
      if (clockOutTime <= clockInDate) {
        // MA hat sich z.B. um 18:00 eingestempelt, defaultClockOut ist 17:00
        // → auf 23:59 des clockIn-Tages setzen
        clockOutTime = new Date(clockInDate);
        clockOutTime.setHours(23, 59, 0, 0);
      }
    } else {
      // Kein defaultClockOut hinterlegt → auf 23:59 des Einstempel-Tages setzen
      clockOutTime = new Date(clockInDate);
      clockOutTime.setHours(23, 59, 0, 0);
    }

    // Wenn clockOut in der Zukunft wäre (sollte nicht passieren bei 23:59 Cron), auf jetzt setzen
    if (clockOutTime > today) {
      clockOutTime = today;
    }

    try {
      // Eintrag aktualisieren
      await prisma.timeEntry.update({
        where: { id: entry.id },
        data: {
          clockOut: clockOutTime,
          editedBy: 'System (Auto-Ausstempeln)',
          note: `Automatisch ausgestempelt – Mitarbeiter hat sich nicht ausgestempelt. Reguläres Ende: ${emp.defaultClockOut || 'nicht hinterlegt'}`,
        },
      });

      console.log(`  ✓ ${emp.firstName} ${emp.lastName} ausgestempelt auf ${clockOutTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`);

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: emp.id,
          userName: `${emp.firstName} ${emp.lastName}`,
          action: 'CLOCK_OUT',
          entityType: 'TimeEntry',
          entityId: entry.id,
          note: `Auto-Ausstempeln: MA hat sich nicht ausgestempelt. Ausgestempelt auf ${emp.defaultClockOut || '23:59'}.`,
        },
      });

      // E-Mail an MA senden
      if (emp.email) {
        await sendAutoClockOutEmail(emp, entry, clockOutTime);
      }
    } catch (error) {
      console.error(`  ✗ Fehler bei ${emp.firstName} ${emp.lastName}:`, error);
    }
  }
}

async function sendAutoClockOutEmail(
  employee: { firstName: string; lastName: string; email: string | null; employeeNumber: string; defaultClockOut: string | null },
  entry: { id: string; clockIn: Date },
  clockOutTime: Date,
) {
  if (!employee.email) return;

  const clockInStr = entry.clockIn.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
  const clockOutStr = clockOutTime.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
  const dateStr = entry.clockIn.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });

  // Reklamations-Link (direkt zur Zeiten-Seite)
  const baseUrl = process.env.APP_URL || 'https://zeit.kerimatilgan.de';
  const complaintUrl = `${baseUrl}/dashboard/timesheet`;

  try {
    await sendEmail({
      to: employee.email,
      subject: `Automatische Ausstempelung am ${dateStr}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
          <div style="background: #f59e0b; color: white; padding: 24px;">
            <h2 style="margin: 0; font-size: 18px;">Automatische Ausstempelung</h2>
            <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">Hallo ${employee.firstName},</p>
          </div>
          <div style="background: white; padding: 24px;">
            <p style="font-size: 14px; color: #374151; margin-top: 0;">
              du hast dich am <strong>${dateStr}</strong> nicht ausgestempelt. Das System hat dich automatisch ausgestempelt:
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr>
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px; width: 120px;">Eingestempelt:</td>
                <td style="padding: 10px 0; font-size: 14px; font-weight: 600;">${clockInStr} Uhr</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Ausgestempelt:</td>
                <td style="padding: 10px 0; font-size: 14px; font-weight: 600;">${clockOutStr} Uhr (automatisch)</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #6b7280; font-size: 14px;">Reguläres Ende:</td>
                <td style="padding: 10px 0; font-size: 14px;">${employee.defaultClockOut || 'Nicht hinterlegt'} Uhr</td>
              </tr>
            </table>
            <p style="font-size: 14px; color: #374151;">
              Stimmt die Ausstempelzeit nicht? Du kannst den Eintrag direkt reklamieren:
            </p>
            <div style="margin-top: 16px; text-align: center;">
              <a href="${complaintUrl}" style="display: inline-block; padding: 12px 28px; background: #2563eb; color: white; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500;">
                Zeiteintrag prüfen & reklamieren
              </a>
            </div>
          </div>
          <div style="background: #f9fafb; padding: 14px 24px; text-align: center; color: #9ca3af; font-size: 12px;">
            Bitte denke daran, dich künftig auszustempeln. – Zeiterfassung
          </div>
        </div>
      `,
    });
  } catch (error) {
    console.error(`Auto-Ausstempel-Mail an ${employee.email} fehlgeschlagen:`, error);
  }
}
