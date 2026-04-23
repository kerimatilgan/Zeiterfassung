import { Router } from 'express';
import { prisma, io } from '../index.js';
import { terminalAuthMiddleware, authMiddleware, adminMiddleware, AuthRequest, TerminalAuthRequest } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLog.js';
import { minutesBetween } from '../utils/timeCalc.js';
import { formatDisplayName } from '../utils/displayName.js';

const router = Router();

// ============================================
// RFID Registrierungs-Modus
// ============================================
interface RegistrationSession {
  employeeId: string;
  employeeName: string;
  socketId: string;
  startedAt: Date;
  timeoutId: NodeJS.Timeout;
}

let activeRegistrationSession: RegistrationSession | null = null;
const REGISTRATION_TIMEOUT = 30000; // 30 Sekunden

// Aufräumen einer Registration Session
const clearRegistrationSession = () => {
  if (activeRegistrationSession) {
    clearTimeout(activeRegistrationSession.timeoutId);
    activeRegistrationSession = null;
  }
};

// Prüft ob eine Registration Session aktiv ist und verarbeitet die Karte
const checkRegistrationMode = (rfidCard: string): boolean => {
  if (!activeRegistrationSession) return false;

  const session = activeRegistrationSession;
  clearRegistrationSession();

  // Sende die Karten-ID an den wartenden Client
  io.to(session.socketId).emit('rfid-card-scanned', {
    success: true,
    rfidCard: rfidCard,
    employeeId: session.employeeId,
    employeeName: session.employeeName,
  });

  console.log(`📋 RFID-Registrierung: Karte ${rfidCard} für ${session.employeeName} übermittelt`);
  return true;
};

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
router.post('/register-rfid/start', authMiddleware, adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { employeeId, socketId } = req.body;

    if (!employeeId || !socketId) {
      return res.status(400).json({
        success: false,
        error: 'employeeId und socketId erforderlich'
      });
    }

    // Mitarbeiter prüfen
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, lastName: true }
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Mitarbeiter nicht gefunden'
      });
    }

    // Alte Session beenden falls vorhanden
    clearRegistrationSession();

    // Neue Session starten
    const timeoutId = setTimeout(() => {
      if (activeRegistrationSession) {
        // Timeout - informiere Client
        io.to(socketId).emit('rfid-card-scanned', {
          success: false,
          error: 'Timeout - keine Karte gescannt',
          employeeId: employeeId,
        });
        clearRegistrationSession();
        console.log(`⏱️ RFID-Registrierung Timeout für ${employee.firstName} ${employee.lastName}`);
      }
    }, REGISTRATION_TIMEOUT);

    activeRegistrationSession = {
      employeeId,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      socketId,
      startedAt: new Date(),
      timeoutId,
    };

    console.log(`📋 RFID-Registrierung gestartet für ${employee.firstName} ${employee.lastName}`);

    res.json({
      success: true,
      message: 'Registrierungs-Modus aktiv',
      timeout: REGISTRATION_TIMEOUT,
      employeeName: `${employee.firstName} ${employee.lastName}`,
    });
  } catch (error) {
    console.error('Start registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Starten des Registrierungs-Modus'
    });
  }
});

// Stoppt den Registrierungs-Modus
router.post('/register-rfid/stop', authMiddleware, adminMiddleware, (_req, res) => {
  clearRegistrationSession();
  res.json({ success: true, message: 'Registrierungs-Modus beendet' });
});

// Status des Registrierungs-Modus
router.get('/register-rfid/status', authMiddleware, adminMiddleware, (_req, res) => {
  if (activeRegistrationSession) {
    res.json({
      active: true,
      employeeId: activeRegistrationSession.employeeId,
      employeeName: activeRegistrationSession.employeeName,
      startedAt: activeRegistrationSession.startedAt,
    });
  } else {
    res.json({ active: false });
  }
});

// ============================================
// RFID Karten-Abfrage (Lookup)
// ============================================
interface LookupSession {
  socketId: string;
  adminId: string;
  startedAt: Date;
  timeoutId: NodeJS.Timeout;
}

let activeLookupSession: LookupSession | null = null;

const clearLookupSession = () => {
  if (activeLookupSession) {
    clearTimeout(activeLookupSession.timeoutId);
    activeLookupSession = null;
  }
};

const checkLookupMode = async (rfidCard: string): Promise<boolean> => {
  if (!activeLookupSession) return false;

  const session = activeLookupSession;
  clearLookupSession();

  // Karte in DB suchen
  const employee = await prisma.employee.findFirst({
    where: { rfidCard },
    select: { id: true, firstName: true, lastName: true, employeeNumber: true, photoUrl: true, isActive: true },
  });

  if (employee) {
    io.to(session.socketId).emit('rfid-card-lookup', {
      success: true,
      rfidCard,
      found: true,
      employee,
    });
    console.log(`🔍 RFID-Lookup: Karte ${rfidCard} gehört zu ${employee.firstName} ${employee.lastName}`);
    await createAuditLog({
      userId: session.adminId,
      action: 'RFID_LOOKUP',
      entityType: 'Terminal',
      entityId: employee.id,
      note: `RFID-Karte abgefragt: ${rfidCard} → ${employee.firstName} ${employee.lastName} (#${employee.employeeNumber})`,
    });
  } else {
    io.to(session.socketId).emit('rfid-card-lookup', {
      success: true,
      rfidCard,
      found: false,
    });
    console.log(`🔍 RFID-Lookup: Karte ${rfidCard} ist keinem Mitarbeiter zugeordnet`);
    await createAuditLog({
      userId: session.adminId,
      action: 'RFID_LOOKUP',
      entityType: 'Terminal',
      note: `RFID-Karte abgefragt: ${rfidCard} → nicht zugeordnet`,
    });
  }

  return true;
};

// Startet den Lookup-Modus
router.post('/lookup-rfid/start', authMiddleware, adminMiddleware, async (req: AuthRequest, res) => {
  try {
    const { socketId } = req.body;

    if (!socketId) {
      return res.status(400).json({ success: false, error: 'socketId erforderlich' });
    }

    // Alte Sessions beenden
    clearRegistrationSession();
    clearLookupSession();

    const timeoutId = setTimeout(() => {
      if (activeLookupSession) {
        io.to(socketId).emit('rfid-card-lookup', {
          success: false,
          error: 'Timeout - keine Karte gescannt',
        });
        clearLookupSession();
        console.log('⏱️ RFID-Lookup Timeout');
      }
    }, REGISTRATION_TIMEOUT);

    activeLookupSession = { socketId, adminId: req.employee!.id, startedAt: new Date(), timeoutId };

    console.log('🔍 RFID-Lookup gestartet');
    res.json({ success: true, message: 'Abfrage-Modus aktiv', timeout: REGISTRATION_TIMEOUT });
  } catch (error) {
    console.error('Start lookup error:', error);
    res.status(500).json({ success: false, error: 'Fehler beim Starten' });
  }
});

// Stoppt den Lookup-Modus
router.post('/lookup-rfid/stop', authMiddleware, adminMiddleware, (_req, res) => {
  clearLookupSession();
  res.json({ success: true, message: 'Abfrage-Modus beendet' });
});

// ============================================
// Terminal-Endpoints (Terminal API Key Auth)
// ============================================

// Terminal authentifizieren
router.use(terminalAuthMiddleware);

// Aktueller Einstempel-Status aller Mitarbeiter (für Terminal-Cache)
router.get('/active-status', async (_req, res) => {
  try {
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
      .filter(e => e.employee.rfidCard)
      .map(e => ({ rfidCard: e.employee.rfidCard }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden des Status' });
  }
});

// Mitarbeiter-Liste für Terminal-Cache (RFID → Name)
router.get('/employees', async (req: TerminalAuthRequest, res) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: {
        rfidCard: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
      },
    });
    const mode = req.terminal?.displayMode || 'fullName';
    const result = employees
      .filter(e => e.rfidCard)
      .map(e => ({
        rfidCard: e.rfidCard,
        name: formatDisplayName(e.firstName, e.lastName, mode),
        employeeNumber: e.employeeNumber,
      }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Fehler beim Laden der Mitarbeiter' });
  }
});

// Heartbeat - Terminal meldet sich regelmäßig
router.post('/heartbeat', async (req: TerminalAuthRequest, res) => {
  try {
    if (req.terminalId) {
      const terminal = await prisma.terminal.findUnique({
        where: { id: req.terminalId },
        select: { name: true },
      });
      return res.json({ success: true, terminalName: terminal?.name || 'Unbekannt' });
    }
    res.json({ success: true, terminalName: 'Legacy-Terminal' });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ success: false, error: 'Heartbeat fehlgeschlagen' });
  }
});

// QR-Code oder RFID-Karte scannen / Ein- oder Ausstempeln
// Unterstützt optionalen timestamp-Parameter für Offline-Synchronisation
router.post('/scan', async (req: TerminalAuthRequest, res) => {
  try {
    const { qrCode, rfidCard, timestamp, silent } = req.body;
    const displayMode = req.terminal?.displayMode || 'fullName';

    if (!qrCode && !rfidCard) {
      return res.status(400).json({
        success: false,
        error: 'Kein QR-Code oder RFID-Karte übermittelt'
      });
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
        console.log(`📡 Offline-Sync: Stempelung von ${timestamp}`);
      } else {
        console.warn(`⚠️ Ungültiger Offline-Timestamp ignoriert: ${timestamp}`);
      }
    }

    // Prüfe ob Registrierungs-Modus aktiv ist
    if (rfidCard && checkRegistrationMode(rfidCard)) {
      return res.json({
        success: true,
        action: 'registration',
        message: 'RFID-Karte zur Registrierung übermittelt'
      });
    }

    // Prüfe ob Lookup-Modus aktiv ist
    if (rfidCard && await checkLookupMode(rfidCard)) {
      return res.json({
        success: true,
        action: 'lookup',
        message: 'RFID-Karte abgefragt'
      });
    }

    // Mitarbeiter anhand RFID-Karte oder QR-Code finden
    let employee = null;
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
      if (!silent) io.emit('scan-error', errorData);
      return res.status(404).json(errorData);
    }

    if (!employee.isActive) {
      const errorData = {
        success: false,
        error: 'Mitarbeiter inaktiv',
        message: `${employee.firstName} ${employee.lastName} ist nicht mehr aktiv`
      };
      if (!silent) io.emit('scan-error', errorData);
      return res.status(403).json(errorData);
    }

    // Eintrittsdatum prüfen
    if (employee.startDate && new Date(employee.startDate) > new Date()) {
      const startFormatted = new Date(employee.startDate).toLocaleDateString('de-DE');
      const errorData = {
        success: false,
        error: 'Noch nicht eingetreten',
        message: `${employee.firstName} ${employee.lastName} kann sich erst ab dem ${startFormatted} einstempeln`
      };
      if (!silent) io.emit('scan-error', errorData);
      return res.status(403).json(errorData);
    }

    // Austrittsdatum prüfen
    if (employee.endDate && new Date(employee.endDate) <= new Date()) {
      const errorData = {
        success: false,
        error: 'Mitarbeiter ausgetreten',
        message: `${employee.firstName} ${employee.lastName} ist seit dem ${new Date(employee.endDate).toLocaleDateString('de-DE')} ausgetreten`
      };
      if (!silent) io.emit('scan-error', errorData);
      return res.status(403).json(errorData);
    }

    // Admins können nicht am Terminal stempeln
    if (employee.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin-Account',
        message: 'Administrator-Accounts können nicht am Terminal stempeln'
      });
    }

    // Prüfen ob bereits eingestempelt
    const activeEntry = await prisma.timeEntry.findFirst({
      where: {
        employeeId: employee.id,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    // Bei Offline-Sync: Prüfe ob die Stempelung noch sinnvoll ist
    if (isOfflineSync) {
      if (activeEntry) {
        // Aktiver Eintrag existiert → würde ausstempeln
        // Aber: Wenn clockIn des aktiven Eintrags NACH dem Offline-Timestamp liegt,
        // wäre das Ergebnis clockOut < clockIn → unsinnig, überspringen
        if (activeEntry.clockIn > scanTime) {
          console.log(`⚠️ Offline-Sync übersprungen: Aktiver Eintrag (${activeEntry.clockIn.toISOString()}) ist neuer als Offline-Timestamp (${scanTime.toISOString()}) für ${employee.firstName} ${employee.lastName}`);
          return res.json({
            success: true,
            action: 'skipped',
            offlineSync: true,
            employee: {
              name: `${employee.firstName} ${employee.lastName}`,
              employeeNumber: employee.employeeNumber,
            },
            message: `Offline-Stempelung übersprungen (neuerer Eintrag existiert bereits)`,
          });
        }
      } else {
        // Kein aktiver Eintrag → würde einstempeln
        // Aber: Wenn schon ein neuerer Eintrag (nach dem Offline-Timestamp) existiert,
        // hat sich der MA in der Zwischenzeit bereits online eingestempelt → überspringen
        const laterEntry = await prisma.timeEntry.findFirst({
          where: {
            employeeId: employee.id,
            clockIn: { gte: scanTime },
          },
        });
        if (laterEntry) {
          console.log(`⚠️ Offline-Sync übersprungen: Neuerer Eintrag existiert (${laterEntry.clockIn.toISOString()}) für ${employee.firstName} ${employee.lastName}, Offline-Timestamp war ${scanTime.toISOString()}`);
          return res.json({
            success: true,
            action: 'skipped',
            offlineSync: true,
            employee: {
              name: `${employee.firstName} ${employee.lastName}`,
              employeeNumber: employee.employeeNumber,
            },
            message: `Offline-Stempelung übersprungen (neuerer Eintrag existiert bereits)`,
          });
        }
      }
    }

    if (activeEntry) {
      // Ausstempeln
      const now = scanTime;  // Verwende scanTime für Offline-Sync

      // Prüfe ob der Eintrag mehrere Tage umspannt
      const dayEntries = splitMultiDayEntry(activeEntry.clockIn, now);
      const isMultiDay = dayEntries.length > 1;

      let updatedEntry;

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
          // Arbeitszeit dieses Eintrags (Sekunden werden abgeschnitten)
          totalWorkMinutes += minutesBetween(entry.clockIn, entry.clockOut);
          totalBreakMinutes += entry.breakMinutes;
        }
      }

      // Nettoarbeitszeit (Arbeitszeit minus Pausen)
      const netWorkMinutes = totalWorkMinutes - totalBreakMinutes;
      const formattedTime = formatMinutesToTime(netWorkMinutes);

      // Audit Log für Ausstempeln
      await createAuditLog({
        req,
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

      // WebSocket Event für Ausstempeln (nicht bei stiller Sync)
      if (!silent) {
        io.emit('time-entry-updated', {
          type: 'clock_out',
          employeeId: employee.id,
          entry: updatedEntry,
          employee: {
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
            employeeNumber: employee.employeeNumber,
            photoUrl: employee.photoUrl,
          },
        });
      }

      // Nachricht erstellen
      let message: string;
      if (isOfflineSync) {
        message = `Offline-Sync: ${employee.firstName} ausgestempelt (${formattedTime}h)`;
      } else if (isMultiDay) {
        message = `Auf Wiedersehen, ${employee.firstName}! Einträge auf ${dayEntries.length} Tage aufgeteilt. Heute: ${formattedTime} Stunden.`;
      } else {
        message = `Auf Wiedersehen, ${employee.firstName}! Du hast heute ${formattedTime} Stunden gearbeitet.`;
      }

      return res.json({
        success: true,
        action: 'clock_out',
        offlineSync: isOfflineSync,
        multiDaySplit: isMultiDay ? dayEntries.length : undefined,
        employee: {
          name: formatDisplayName(employee.firstName, employee.lastName, displayMode),
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
          console.log(`⏰ Arbeitskategorie "${employee.workCategory.name}": Einstempelzeit angepasst auf ${employee.workCategory.earliestClockIn} (war ${scanHour}:${String(scanMinute).padStart(2, '0')})`);
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
        req,
        userId: employee.id,
        userName: `${employee.firstName} ${employee.lastName}`,
        action: 'CLOCK_IN',
        entityType: 'TimeEntry',
        entityId: newEntry.id,
        newValues: {
          clockIn: newEntry.clockIn,
        },
      });

      // WebSocket Event für Einstempeln (nicht bei stiller Sync)
      if (!silent) {
        io.emit('time-entry-updated', {
          type: 'clock_in',
          employeeId: employee.id,
          entry: newEntry,
          employee: {
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
            employeeNumber: employee.employeeNumber,
            photoUrl: employee.photoUrl,
          },
        });
      }

      return res.json({
        success: true,
        action: 'clock_in',
        offlineSync: isOfflineSync,
        employee: {
          name: formatDisplayName(employee.firstName, employee.lastName, displayMode),
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
    res.status(500).json({
      success: false,
      error: 'Fehler beim Verarbeiten des Scans'
    });
  }
});

// Aktueller Status eines Mitarbeiters (für Terminal-Display)
router.get('/status/:qrCode', async (req: TerminalAuthRequest, res) => {
  try {
    const { qrCode } = req.params;

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
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    const activeEntry = await prisma.timeEntry.findFirst({
      where: {
        employeeId: employee.id,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    const mode = req.terminal?.displayMode || 'fullName';
    res.json({
      employee: {
        name: formatDisplayName(employee.firstName, employee.lastName, mode),
        employeeNumber: employee.employeeNumber,
      },
      isClockedIn: !!activeEntry,
      clockInTime: activeEntry?.clockIn || null,
    });
  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Status' });
  }
});

// Liste aller aktuell eingestempelten Mitarbeiter
router.get('/active', async (req: TerminalAuthRequest, res) => {
  try {
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

    const mode = req.terminal?.displayMode || 'fullName';
    res.json(activeEntries.map(entry => ({
      employeeName: formatDisplayName(entry.employee.firstName, entry.employee.lastName, mode),
      employeeNumber: entry.employee.employeeNumber,
      clockIn: entry.clockIn,
    })));
  } catch (error) {
    console.error('Get active error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der aktiven Mitarbeiter' });
  }
});

export default router;
