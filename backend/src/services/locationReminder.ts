import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { sendLocationReminderEmail } from '../utils/emailService.js';
import { sendPushToEmployee } from '../utils/pushService.js';

const prisma = new PrismaClient();

// Maximales Alter der letzten bekannten MA-Position, ab dem wir "kein Standort
// aktiv" annehmen und überspringen.
const POSITION_FRESHNESS_HOURS = 2;

export function startLocationReminderScheduler(): void {
  // Stündlich zur Minute :05 (versetzt von anderen Schedulern)
  cron.schedule('5 * * * *', () => {
    runLocationReminderCheck()
      .catch((error) => console.error('❌ Standort-Erinnerungs-Check fehlgeschlagen:', error));
  });

  console.log('⏰ Standort-Erinnerungs-Scheduler gestartet (stündlich :05)');
}

// Haversine-Distanz in Metern zwischen zwei Lat/Lng-Punkten
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Erdradius in Metern
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatClockedInSince(clockIn: Date): string {
  const dt = new Date(clockIn);
  const day = String(dt.getDate()).padStart(2, '0');
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  // Falls heute: nur Uhrzeit
  const today = new Date();
  if (dt.getDate() === today.getDate() && dt.getMonth() === today.getMonth() && dt.getFullYear() === today.getFullYear()) {
    return `${hh}:${mm} Uhr`;
  }
  return `${day}.${month}. um ${hh}:${mm} Uhr`;
}

export async function runLocationReminderCheck(): Promise<{
  checked: number; sent: number; skippedNoPos: number; skippedInRange: number; skippedCooldown: number;
  details: Array<{ employeeId: string; name: string; status: string; distanceMeters?: number }>;
}> {
  const empty = { checked: 0, sent: 0, skippedNoPos: 0, skippedInRange: 0, skippedCooldown: 0, details: [] as Array<{ employeeId: string; name: string; status: string; distanceMeters?: number }> };
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  if (!settings?.locationReminderEnabled) {
    return { ...empty, details: [{ employeeId: '-', name: '-', status: 'reminder-disabled' }] };
  }
  if (settings.companyLatitude == null || settings.companyLongitude == null) {
    console.log('⏰ Standort-Erinnerung: kein Firmen-Standort konfiguriert — übersprungen');
    return { ...empty, details: [{ employeeId: '-', name: '-', status: 'no-company-location' }] };
  }

  const radius = settings.companyRadiusMeters || 500;
  const now = new Date();
  const positionStaleThreshold = new Date(now.getTime() - POSITION_FRESHNESS_HOURS * 60 * 60 * 1000);

  // Alle eingestempelten MA mit aktueller Position
  const openEntries = await prisma.timeEntry.findMany({
    where: { clockOut: null },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          isAdmin: true,
          isActive: true,
          canClockOutPwa: true,
          lastKnownLatitude: true,
          lastKnownLongitude: true,
          lastKnownLocationAt: true,
          lastLocationReminderAt: true,
        },
      },
    },
  });

  let checked = 0;
  let sent = 0;
  let skippedNoPos = 0;
  let skippedCooldown = 0;
  let skippedInRange = 0;
  const details: Array<{ employeeId: string; name: string; status: string; distanceMeters?: number }> = [];

  for (const entry of openEntries) {
    const emp = entry.employee;
    if (!emp.isActive || emp.isAdmin) continue;
    checked++;
    const name = `${emp.firstName} ${emp.lastName}`;

    if (!emp.lastKnownLatitude || !emp.lastKnownLongitude || !emp.lastKnownLocationAt
      || emp.lastKnownLocationAt < positionStaleThreshold) {
      skippedNoPos++;
      details.push({ employeeId: emp.id, name, status: 'no-fresh-position' });
      continue;
    }

    const distance = haversineMeters(
      emp.lastKnownLatitude,
      emp.lastKnownLongitude,
      settings.companyLatitude,
      settings.companyLongitude,
    );
    if (distance <= radius) {
      skippedInRange++;
      details.push({ employeeId: emp.id, name, status: 'in-range', distanceMeters: distance });
      continue;
    }

    // Nur EINE Erinnerung pro Schicht: wenn die letzte Erinnerung NACH dem
    // aktuellen clockIn lag, wurde sie schon für genau diesen offenen Eintrag verschickt.
    if (emp.lastLocationReminderAt && emp.lastLocationReminderAt > entry.clockIn) {
      skippedCooldown++;
      details.push({ employeeId: emp.id, name, status: 'already-sent-this-shift', distanceMeters: distance });
      continue;
    }

    // Je nach App-Berechtigung: andere Mail (App-Stempelung möglich vs.
    // Reklamation nötig) und anderer Push-Link.
    // Datenschutz: weder Mail noch Push nennen die genaue Distanz.
    const canSelfClockOut = emp.canClockOutPwa;
    const sinceText = formatClockedInSince(entry.clockIn);

    if (emp.email) {
      try {
        await sendLocationReminderEmail(
          emp.email,
          `${emp.firstName} ${emp.lastName}`,
          distance,
          sinceText,
          canSelfClockOut ? null : entry.id,
        );
        sent++;
      } catch (err) {
        console.error(`Standort-Reminder-Mail an ${emp.email} fehlgeschlagen:`, err);
      }
    }

    sendPushToEmployee(emp.id, {
      title: 'Du bist noch eingestempelt',
      body: canSelfClockOut
        ? 'Du bist nicht mehr in der Nähe — vergessen auszustempeln?'
        : 'Du bist nicht mehr in der Nähe. Bitte korrekte Arbeitszeit melden.',
      url: canSelfClockOut ? '/dashboard' : `/dashboard?openComplaint=${entry.id}`,
      tag: 'location-reminder',
    }).catch(err => console.error('Location-Reminder Push failed:', err));

    await prisma.employee.update({
      where: { id: emp.id },
      data: { lastLocationReminderAt: new Date() },
    });
    details.push({ employeeId: emp.id, name, status: 'reminder-sent', distanceMeters: distance });
  }

  if (checked > 0) {
    console.log(
      `⏰ Standort-Erinnerung: ${checked} eingestempelt, ${sent} Reminder gesendet ` +
      `(skip: ${skippedNoPos} ohne Position, ${skippedInRange} im Radius, ${skippedCooldown} Cooldown)`,
    );
  }
  return { checked, sent, skippedNoPos, skippedInRange, skippedCooldown, details };
}
