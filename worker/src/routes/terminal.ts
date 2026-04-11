import { Hono } from 'hono';
import type { Env, Variables } from '../bindings.js';
import { authMiddleware, adminMiddleware, terminalAuthMiddleware } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLog.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// RFID Registrierungs-Modus
// ============================================
interface RegistrationSession {
  employeeId: string;
  employeeName: string;
  startedAt: string; // ISO string for KV serialization
}

interface LookupSession {
  adminId: string;
  startedAt: string; // ISO string for KV serialization
}

const REGISTRATION_TIMEOUT_TTL = 30; // 30 seconds TTL in KV

// ============================================
// Pure logic functions (preserved as-is)
// ============================================

// Formatiert Minuten zu H:MM Format
const formatMinutesToTime = (totalMinutes: number): string => {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
};

// Teilt einen mehrtägigen Zeiteintrag in einzelne Tage auf (CET/CEST-basiert für Deutschland)
interface DayEntry {
  clockIn: Date;
  clockOut: Date;
  isFirstDay: boolean;
  isLastDay: boolean;
}

// Hilfsfunktion: Gibt den UTC-Offset für Deutschland zurück (1 für CET, 2 für CEST)
const getGermanTimezoneOffset = (date: Date): number => {
  // Sommerzeit: letzter Sonntag im März bis letzter Sonntag im Oktober
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  if (month > 2 && month < 9) return 2; // April bis September = CEST
  if (month < 2 || month > 9) return 1; // November bis Februar = CET

  if (month === 2) { // März
    const lastSunday = new Date(Date.UTC(year, 2, 31));
    while (lastSunday.getUTCDay() !== 0) lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
    lastSunday.setUTCHours(1, 0, 0, 0);
    return date >= lastSunday ? 2 : 1;
  } else { // Oktober
    const lastSunday = new Date(Date.UTC(year, 9, 31));
    while (lastSunday.getUTCDay() !== 0) lastSunday.setUTCDate(lastSunday.getUTCDate() - 1);
    lastSunday.setUTCHours(1, 0, 0, 0);
    return date < lastSunday ? 2 : 1;
  }
};

// Konvertiert lokale deutsche Zeit zu UTC
const germanLocalToUTC = (year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): Date => {
  const tempDate = new Date(Date.UTC(year, month, day, 12, 0, 0)); // Mittag für stabile Offset-Berechnung
  const offset = getGermanTimezoneOffset(tempDate);
  return new Date(Date.UTC(year, month, day, hour - offset, minute, second, ms));
};

// Gibt das lokale deutsche Datum zurück (Jahr, Monat, Tag)
const getGermanLocalDate = (utcDate: Date): { year: number; month: number; day: number } => {
  const offset = getGermanTimezoneOffset(utcDate);
  const localTime = new Date(utcDate.getTime() + offset * 3600000);
  return {
    year: localTime.getUTCFullYear(),
    month: localTime.getUTCMonth(),
    day: localTime.getUTCDate()
  };
};

const splitMultiDayEntry = (clockIn: Date, clockOut: Date): DayEntry[] => {
  const entries: DayEntry[] = [];

  // Lokale deutsche Tage berechnen
  const startLocal = getGermanLocalDate(clockIn);
  const endLocal = getGermanLocalDate(clockOut);

  const startLocalTime = Date.UTC(startLocal.year, startLocal.month, startLocal.day);
  const endLocalTime = Date.UTC(endLocal.year, endLocal.month, endLocal.day);

  // Wenn gleicher lokaler Tag, keine Aufteilung nötig
  if (startLocalTime === endLocalTime) {
    return [{
      clockIn: clockIn,
      clockOut: clockOut,
      isFirstDay: true,
      isLastDay: true,
    }];
  }

  // Erster Tag: von clockIn bis 23:59:59 lokaler Zeit
  const firstDayEnd = germanLocalToUTC(startLocal.year, startLocal.month, startLocal.day, 23, 59, 59, 999);
  entries.push({
    clockIn: clockIn,
    clockOut: firstDayEnd,
    isFirstDay: true,
    isLastDay: false,
  });

  // Mittlere Tage: 00:00:00 bis 23:59:59 lokaler Zeit
  const currentLocalDate = new Date(startLocalTime);
  currentLocalDate.setUTCDate(currentLocalDate.getUTCDate() + 1);

  while (currentLocalDate.getTime() < endLocalTime) {
    const y = currentLocalDate.getUTCFullYear();
    const m = currentLocalDate.getUTCMonth();
    const d = currentLocalDate.getUTCDate();

    const dayStart = germanLocalToUTC(y, m, d, 0, 0, 0, 0);
    const dayEnd = germanLocalToUTC(y, m, d, 23, 59, 59, 999);

    entries.push({
      clockIn: dayStart,
      clockOut: dayEnd,
      isFirstDay: false,
      isLastDay: false,
    });

    currentLocalDate.setUTCDate(currentLocalDate.getUTCDate() + 1);
  }

  // Letzter Tag: 00:00:00 lokaler Zeit bis clockOut
  const lastDayStart = germanLocalToUTC(endLocal.year, endLocal.month, endLocal.day, 0, 0, 0, 0);
  entries.push({
    clockIn: lastDayStart,
    clockOut: clockOut,
    isFirstDay: false,
    isLastDay: true,
  });

  return entries;
};

// ============================================
// RFID Registrierungs-Modus Endpoints (JWT Auth für Admin-UI)
// ============================================

// Startet den Registrierungs-Modus (wartet auf nächsten RFID-Scan)
app.post('/register-rfid/start', authMiddleware, adminMiddleware, async (c) => {
  try {
    const { employeeId } = await c.req.json();
    const prisma = c.get('prisma');

    if (!employeeId) {
      return c.json({
        success: false,
        error: 'employeeId erforderlich'
      }, 400);
    }

    // Mitarbeiter prüfen
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, lastName: true }
    });

    if (!employee) {
      return c.json({
        success: false,
        error: 'Mitarbeiter nicht gefunden'
      }, 404);
    }

    // Alte Sessions beenden
    await c.env.KV.delete('rfid-session');
    await c.env.KV.delete('rfid-lookup-session');

    // Neue Session in KV speichern
    const session: RegistrationSession = {
      employeeId,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      startedAt: new Date().toISOString(),
    };
    await c.env.KV.put('rfid-session', JSON.stringify(session), { expirationTtl: REGISTRATION_TIMEOUT_TTL });

    console.log(`RFID-Registrierung gestartet für ${employee.firstName} ${employee.lastName}`);

    return c.json({
      success: true,
      message: 'Registrierungs-Modus aktiv',
      timeout: REGISTRATION_TIMEOUT_TTL * 1000,
      employeeName: `${employee.firstName} ${employee.lastName}`,
    });
  } catch (error) {
    console.error('Start registration error:', error);
    return c.json({
      success: false,
      error: 'Fehler beim Starten des Registrierungs-Modus'
    }, 500);
  }
});

// Stoppt den Registrierungs-Modus
app.post('/register-rfid/stop', authMiddleware, adminMiddleware, async (c) => {
  await c.env.KV.delete('rfid-session');
  return c.json({ success: true, message: 'Registrierungs-Modus beendet' });
});

// Status des Registrierungs-Modus
app.get('/register-rfid/status', authMiddleware, adminMiddleware, async (c) => {
  const session = await c.env.KV.get<RegistrationSession>('rfid-session', 'json');
  if (session) {
    return c.json({
      active: true,
      employeeId: session.employeeId,
      employeeName: session.employeeName,
      startedAt: session.startedAt,
    });
  } else {
    return c.json({ active: false });
  }
});

// ============================================
// RFID Karten-Abfrage (Lookup)
// ============================================

// Startet den Lookup-Modus
app.post('/lookup-rfid/start', authMiddleware, adminMiddleware, async (c) => {
  try {
    const emp = c.get('employee');

    // Alte Sessions beenden
    await c.env.KV.delete('rfid-session');
    await c.env.KV.delete('rfid-lookup-session');

    const session: LookupSession = {
      adminId: emp.id,
      startedAt: new Date().toISOString(),
    };
    await c.env.KV.put('rfid-lookup-session', JSON.stringify(session), { expirationTtl: REGISTRATION_TIMEOUT_TTL });

    console.log('RFID-Lookup gestartet');
    return c.json({ success: true, message: 'Abfrage-Modus aktiv', timeout: REGISTRATION_TIMEOUT_TTL * 1000 });
  } catch (error) {
    console.error('Start lookup error:', error);
    return c.json({ success: false, error: 'Fehler beim Starten' }, 500);
  }
});

// Stoppt den Lookup-Modus
app.post('/lookup-rfid/stop', authMiddleware, adminMiddleware, async (c) => {
  await c.env.KV.delete('rfid-lookup-session');
  return c.json({ success: true, message: 'Abfrage-Modus beendet' });
});

// ============================================
// Terminal-Endpoints (Terminal API Key Auth)
// ============================================

// Apply terminal auth middleware to all routes below
app.use('/*', terminalAuthMiddleware);

// Aktueller Einstempel-Status aller Mitarbeiter (für Terminal-Cache)
app.get('/active-status', async (c) => {
  try {
    const prisma = c.get('prisma');
    // Alle offenen Einträge (clockOut = null) = eingestempelt
    const activeEntries = await prisma.timeEntry.findMany({
      where: { clockOut: null },
      select: {
        employeeId: true,
        employee: {
          select: { rfidCard: true },
        },
      },
    });
    const result = activeEntries
      .filter((e: any) => e.employee.rfidCard)
      .map((e: any) => ({ rfidCard: e.employee.rfidCard }));
    return c.json(result);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden des Status' }, 500);
  }
});

// Mitarbeiter-Liste für Terminal-Cache (RFID → Name)
app.get('/employees', async (c) => {
  try {
    const prisma = c.get('prisma');
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        rfidCard: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
      },
    });
    const result = employees
      .filter((e: any) => e.rfidCard)
      .map((e: any) => ({
        rfidCard: e.rfidCard,
        name: `${e.firstName} ${e.lastName}`,
        firstName: e.firstName,
        lastName: e.lastName,
        employeeNumber: e.employeeNumber,
      }));
    return c.json(result);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Mitarbeiter' }, 500);
  }
});

// Heartbeat - Terminal meldet sich regelmäßig
app.post('/heartbeat', async (c) => {
  try {
    const terminalId = c.get('terminalId');
    if (terminalId) {
      const prisma = c.get('prisma');
      const terminal = await prisma.terminal.findUnique({
        where: { id: terminalId },
        select: { name: true },
      });
      return c.json({ success: true, terminalName: terminal?.name || 'Unbekannt' });
    }
    return c.json({ success: true, terminalName: 'Legacy-Terminal' });
  } catch (error) {
    console.error('Heartbeat error:', error);
    return c.json({ success: false, error: 'Heartbeat fehlgeschlagen' }, 500);
  }
});

// QR-Code oder RFID-Karte scannen / Ein- oder Ausstempeln
// Unterstützt optionalen timestamp-Parameter für Offline-Synchronisation
app.post('/scan', async (c) => {
  try {
    const prisma = c.get('prisma');
    const { qrCode, rfidCard, timestamp, silent } = await c.req.json();

    if (!qrCode && !rfidCard) {
      return c.json({
        success: false,
        error: 'Kein QR-Code oder RFID-Karte übermittelt'
      }, 400);
    }

    // Zeitstempel für die Stempelung (für Offline-Sync)
    let scanTime = new Date();
    let isOfflineSync = false;

    if (timestamp) {
      const parsedTime = new Date(timestamp);
      // Validiere Timestamp (nicht älter als 7 Tage, nicht in der Zukunft)
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      if (!isNaN(parsedTime.getTime()) && parsedTime >= sevenDaysAgo && parsedTime <= now) {
        scanTime = parsedTime;
        isOfflineSync = true;
        console.log(`Offline-Sync: Stempelung von ${timestamp}`);
      } else {
        console.warn(`Ungültiger Offline-Timestamp ignoriert: ${timestamp}`);
      }
    }

    // Prüfe ob Registrierungs-Modus aktiv ist (KV-based)
    if (rfidCard) {
      const regSession = await c.env.KV.get<RegistrationSession>('rfid-session', 'json');
      if (regSession) {
        // Clear the session
        await c.env.KV.delete('rfid-session');

        // Store the scanned card result in KV for the admin UI to poll
        await c.env.KV.put('rfid-scan-result', JSON.stringify({
          success: true,
          rfidCard: rfidCard,
          employeeId: regSession.employeeId,
          employeeName: regSession.employeeName,
        }), { expirationTtl: 60 });

        console.log(`RFID-Registrierung: Karte ${rfidCard} für ${regSession.employeeName} übermittelt`);
        return c.json({
          success: true,
          action: 'registration',
          message: 'RFID-Karte zur Registrierung übermittelt'
        });
      }

      // Prüfe ob Lookup-Modus aktiv ist (KV-based)
      const lookupSession = await c.env.KV.get<LookupSession>('rfid-lookup-session', 'json');
      if (lookupSession) {
        // Clear the session
        await c.env.KV.delete('rfid-lookup-session');

        // Karte in DB suchen
        const foundEmployee = await prisma.employee.findFirst({
          where: { rfidCard },
          select: { id: true, firstName: true, lastName: true, employeeNumber: true, photoUrl: true, isActive: true },
        });

        if (foundEmployee) {
          // Store lookup result in KV for the admin UI to poll
          await c.env.KV.put('rfid-lookup-result', JSON.stringify({
            success: true,
            rfidCard,
            found: true,
            employee: foundEmployee,
          }), { expirationTtl: 60 });

          console.log(`RFID-Lookup: Karte ${rfidCard} gehört zu ${foundEmployee.firstName} ${foundEmployee.lastName}`);
          await createAuditLog({
            c,
            prisma,
            userId: lookupSession.adminId,
            action: 'RFID_LOOKUP',
            entityType: 'Terminal',
            entityId: foundEmployee.id,
            note: `RFID-Karte abgefragt: ${rfidCard} → ${foundEmployee.firstName} ${foundEmployee.lastName} (#${foundEmployee.employeeNumber})`,
          });
        } else {
          await c.env.KV.put('rfid-lookup-result', JSON.stringify({
            success: true,
            rfidCard,
            found: false,
          }), { expirationTtl: 60 });

          console.log(`RFID-Lookup: Karte ${rfidCard} ist keinem Mitarbeiter zugeordnet`);
          await createAuditLog({
            c,
            prisma,
            userId: lookupSession.adminId,
            action: 'RFID_LOOKUP',
            entityType: 'Terminal',
            note: `RFID-Karte abgefragt: ${rfidCard} → nicht zugeordnet`,
          });
        }

        return c.json({
          success: true,
          action: 'lookup',
          message: 'RFID-Karte abgefragt'
        });
      }
    }

    // Mitarbeiter anhand RFID-Karte oder QR-Code finden
    let employee: any = null;
    let authMethod = '';

    if (rfidCard) {
      employee = await prisma.employee.findUnique({
        where: { rfidCard },
        select: {
          id: true,
          employeeNumber: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          isActive: true,
          isAdmin: true,
          startDate: true,
          endDate: true,
          workCategory: { select: { earliestClockIn: true, name: true } },
        },
      });
      authMethod = 'rfid';
    }

    if (!employee && qrCode) {
      employee = await prisma.employee.findUnique({
        where: { qrCode },
        select: {
          id: true,
          employeeNumber: true,
          firstName: true,
          lastName: true,
          photoUrl: true,
          isActive: true,
          isAdmin: true,
          startDate: true,
          endDate: true,
          workCategory: { select: { earliestClockIn: true, name: true } },
        },
      });
      authMethod = 'qrcode';
    }

    if (!employee) {
      const errorData = {
        success: false,
        error: rfidCard ? 'Unbekannte RFID-Karte' : 'Unbekannter QR-Code',
        message: 'Mitarbeiter nicht gefunden'
      };
      // TODO: Replace io.emit('scan-error', errorData) with appropriate notification mechanism
      return c.json(errorData, 404);
    }

    if (!employee.isActive) {
      const errorData = {
        success: false,
        error: 'Mitarbeiter inaktiv',
        message: `${employee.firstName} ${employee.lastName} ist nicht mehr aktiv`
      };
      // TODO: Replace io.emit('scan-error', errorData) with appropriate notification mechanism
      return c.json(errorData, 403);
    }

    // Eintrittsdatum prüfen
    if (employee.startDate && new Date(employee.startDate) > new Date()) {
      const startFormatted = new Date(employee.startDate).toLocaleDateString('de-DE');
      const errorData = {
        success: false,
        error: 'Noch nicht eingetreten',
        message: `${employee.firstName} ${employee.lastName} kann sich erst ab dem ${startFormatted} einstempeln`
      };
      // TODO: Replace io.emit('scan-error', errorData) with appropriate notification mechanism
      return c.json(errorData, 403);
    }

    // Austrittsdatum prüfen
    if (employee.endDate && new Date(employee.endDate) <= new Date()) {
      const errorData = {
        success: false,
        error: 'Mitarbeiter ausgetreten',
        message: `${employee.firstName} ${employee.lastName} ist seit dem ${new Date(employee.endDate).toLocaleDateString('de-DE')} ausgetreten`
      };
      // TODO: Replace io.emit('scan-error', errorData) with appropriate notification mechanism
      return c.json(errorData, 403);
    }

    // Admins können nicht am Terminal stempeln
    if (employee.isAdmin) {
      return c.json({
        success: false,
        error: 'Admin-Account',
        message: 'Administrator-Accounts können nicht am Terminal stempeln'
      }, 403);
    }

    // Prüfen ob bereits eingestempelt
    const activeEntry = await prisma.timeEntry.findFirst({
      where: {
        employeeId: employee.id,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    if (activeEntry) {
      // Ausstempeln
      const now = scanTime;  // Verwende scanTime für Offline-Sync

      // Prüfe ob der Eintrag mehrere Tage umspannt
      const dayEntries = splitMultiDayEntry(activeEntry.clockIn, now);
      const isMultiDay = dayEntries.length > 1;

      let updatedEntry: any;

      if (isMultiDay) {
        // Mehrtägiger Eintrag - aufteilen
        console.log(`[MULTI-DAY] Eintrag umspannt ${dayEntries.length} Tage, teile auf...`);

        // Ursprünglichen Eintrag löschen
        await prisma.timeEntry.delete({
          where: { id: activeEntry.id },
        });

        // Neue Einträge für jeden Tag erstellen
        for (const dayEntry of dayEntries) {
          const created = await prisma.timeEntry.create({
            data: {
              employeeId: employee.id,
              clockIn: dayEntry.clockIn,
              clockOut: dayEntry.clockOut,
              breakMinutes: 0,
            },
          });

          // Letzter Eintrag für die Antwort merken
          if (dayEntry.isLastDay) {
            updatedEntry = created;
          }

          const entryHours = (dayEntry.clockOut.getTime() - dayEntry.clockIn.getTime()) / (1000 * 60 * 60);
          console.log(`[MULTI-DAY] Tag erstellt: ${dayEntry.clockIn.toISOString()} - ${dayEntry.clockOut.toISOString()} (${entryHours.toFixed(1)}h)`);
        }
      } else {
        // Eintägiger Eintrag - normales Update
        updatedEntry = await prisma.timeEntry.update({
          where: { id: activeEntry.id },
          data: {
            clockOut: now,
          },
        });
      }

      // Alle Einträge des heutigen Tages abrufen (für Gesamtarbeitszeit)
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);

      const todayEntries = await prisma.timeEntry.findMany({
        where: {
          employeeId: employee.id,
          clockIn: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
        orderBy: { clockIn: 'asc' },
      });

      // Gesamtarbeitszeit des Tages berechnen (nur volle Minuten)
      let totalWorkMinutes = 0;
      let totalBreakMinutes = 0;

      for (let i = 0; i < todayEntries.length; i++) {
        const entry = todayEntries[i];
        if (entry.clockOut) {
          // Arbeitszeit dieses Eintrags (nur volle Minuten)
          const workMs = entry.clockOut.getTime() - entry.clockIn.getTime();
          totalWorkMinutes += Math.floor(workMs / (1000 * 60));
          totalBreakMinutes += entry.breakMinutes;
        }
      }

      // Nettoarbeitszeit (Arbeitszeit minus Pausen)
      const netWorkMinutes = totalWorkMinutes - totalBreakMinutes;
      const formattedTime = formatMinutesToTime(netWorkMinutes);

      // Audit Log für Ausstempeln
      await createAuditLog({
        c,
        prisma,
        userId: employee.id,
        userName: `${employee.firstName} ${employee.lastName}`,
        action: 'CLOCK_OUT',
        entityType: 'TimeEntry',
        entityId: updatedEntry!.id,
        newValues: {
          clockOut: updatedEntry!.clockOut,
          breakMinutes: 0,
          hoursWorked: formattedTime,
          multiDaySplit: isMultiDay ? dayEntries.length : undefined,
        },
      });

      // TODO: Replace io.emit('time-entry-updated', {...}) with appropriate notification mechanism
      // Previously emitted WebSocket event for clock_out (not emitted when silent)

      // Nachricht erstellen
      let message: string;
      if (isOfflineSync) {
        message = `Offline-Sync: ${employee.firstName} ausgestempelt (${formattedTime}h)`;
      } else if (isMultiDay) {
        message = `Auf Wiedersehen, ${employee.firstName}! Einträge auf ${dayEntries.length} Tage aufgeteilt. Heute: ${formattedTime} Stunden.`;
      } else {
        message = `Auf Wiedersehen, ${employee.firstName}! Du hast heute ${formattedTime} Stunden gearbeitet.`;
      }

      return c.json({
        success: true,
        action: 'clock_out',
        offlineSync: isOfflineSync,
        multiDaySplit: isMultiDay ? dayEntries.length : undefined,
        employee: {
          name: `${employee.firstName} ${employee.lastName}`,
          employeeNumber: employee.employeeNumber,
          photoUrl: employee.photoUrl,
        },
        entry: {
          clockIn: updatedEntry!.clockIn,
          clockOut: updatedEntry!.clockOut,
          breakMinutes: 0,
          hoursWorked: formattedTime,
        },
        message,
      });
    } else {
      // Einstempeln
      // Arbeitskategorie: früheste Einstempelzeit prüfen
      let effectiveClockIn = scanTime;
      if (employee.workCategory?.earliestClockIn) {
        const [earlyHour, earlyMinute] = employee.workCategory.earliestClockIn.split(':').map(Number);
        const scanLocal = getGermanLocalDate(scanTime);
        const offset = getGermanTimezoneOffset(scanTime);
        const scanLocalTime = new Date(scanTime.getTime() + offset * 3600000);
        const scanHour = scanLocalTime.getUTCHours();
        const scanMinute = scanLocalTime.getUTCMinutes();

        if (scanHour < earlyHour || (scanHour === earlyHour && scanMinute < earlyMinute)) {
          effectiveClockIn = germanLocalToUTC(
            scanLocal.year, scanLocal.month, scanLocal.day,
            earlyHour, earlyMinute, 0, 0
          );
          console.log(`Arbeitskategorie "${employee.workCategory.name}": Einstempelzeit angepasst auf ${employee.workCategory.earliestClockIn} (war ${scanHour}:${String(scanMinute).padStart(2, '0')})`);
        }
      }

      const newEntry = await prisma.timeEntry.create({
        data: {
          employeeId: employee.id,
          clockIn: effectiveClockIn,
        },
      });

      // Audit Log für Einstempeln
      await createAuditLog({
        c,
        prisma,
        userId: employee.id,
        userName: `${employee.firstName} ${employee.lastName}`,
        action: 'CLOCK_IN',
        entityType: 'TimeEntry',
        entityId: newEntry.id,
        newValues: {
          clockIn: newEntry.clockIn,
        },
      });

      // TODO: Replace io.emit('time-entry-updated', {...}) with appropriate notification mechanism
      // Previously emitted WebSocket event for clock_in (not emitted when silent)

      return c.json({
        success: true,
        action: 'clock_in',
        offlineSync: isOfflineSync,
        employee: {
          name: `${employee.firstName} ${employee.lastName}`,
          employeeNumber: employee.employeeNumber,
          photoUrl: employee.photoUrl,
        },
        entry: {
          clockIn: newEntry.clockIn,
        },
        message: isOfflineSync
          ? `Offline-Sync: ${employee.firstName} eingestempelt`
          : `Guten Tag, ${employee.firstName}! Du bist jetzt eingestempelt.`,
      });
    }
  } catch (error) {
    console.error('Terminal scan error:', error);
    return c.json({
      success: false,
      error: 'Fehler beim Verarbeiten des Scans'
    }, 500);
  }
});

// PIN-basiertes Stempeln (Alternative zum QR-Code)
app.post('/pin', async (c) => {
  try {
    const prisma = c.get('prisma');
    const { employeeNumber, pin } = await c.req.json();

    if (!employeeNumber || !pin) {
      return c.json({
        success: false,
        error: 'Mitarbeiternummer und PIN erforderlich'
      }, 400);
    }

    const employee = await prisma.employee.findUnique({
      where: { employeeNumber },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        pin: true,
        isActive: true,
        qrCode: true,
      },
    });

    if (!employee || employee.pin !== pin) {
      return c.json({
        success: false,
        error: 'Ungültige Anmeldedaten'
      }, 401);
    }

    // Internally invoke the scan logic by making a request to self
    // In Cloudflare Workers, we re-use the same origin URL
    const url = new URL('/api/terminal/scan', c.req.url);
    const scanResponse = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-terminal-api-key': c.req.header('x-terminal-api-key') || '',
      },
      body: JSON.stringify({ qrCode: employee.qrCode }),
    });

    const result = await scanResponse.json();
    return c.json(result as any, scanResponse.status as any);
  } catch (error) {
    console.error('Terminal PIN error:', error);
    return c.json({
      success: false,
      error: 'Fehler beim Verarbeiten'
    }, 500);
  }
});

// Aktueller Status eines Mitarbeiters (für Terminal-Display)
app.get('/status/:qrCode', async (c) => {
  try {
    const prisma = c.get('prisma');
    const qrCode = c.req.param('qrCode');

    const employee = await prisma.employee.findUnique({
      where: { qrCode },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        isActive: true,
      },
    });

    if (!employee) {
      return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    }

    const activeEntry = await prisma.timeEntry.findFirst({
      where: {
        employeeId: employee.id,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    return c.json({
      employee: {
        name: `${employee.firstName} ${employee.lastName}`,
        employeeNumber: employee.employeeNumber,
      },
      isClockedIn: !!activeEntry,
      clockInTime: activeEntry?.clockIn || null,
    });
  } catch (error) {
    console.error('Get status error:', error);
    return c.json({ error: 'Fehler beim Laden des Status' }, 500);
  }
});

// Liste aller aktuell eingestempelten Mitarbeiter
app.get('/active', async (c) => {
  try {
    const prisma = c.get('prisma');
    const activeEntries = await prisma.timeEntry.findMany({
      where: { clockOut: null },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
      orderBy: { clockIn: 'asc' },
    });

    return c.json(activeEntries.map((entry: any) => ({
      employeeName: `${entry.employee.firstName} ${entry.employee.lastName}`,
      employeeNumber: entry.employee.employeeNumber,
      clockIn: entry.clockIn,
    })));
  } catch (error) {
    console.error('Get active error:', error);
    return c.json({ error: 'Fehler beim Laden der aktiven Mitarbeiter' }, 500);
  }
});

export default app;
