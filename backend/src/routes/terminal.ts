import { Router } from 'express';
import { prisma, io } from '../index.js';
import { terminalAuthMiddleware, authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLog.js';

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
// Terminal-Endpoints (Terminal API Key Auth)
// ============================================

// Terminal authentifizieren
router.use(terminalAuthMiddleware);

// QR-Code oder RFID-Karte scannen / Ein- oder Ausstempeln
router.post('/scan', async (req, res) => {
  try {
    const { qrCode, rfidCard } = req.body;

    if (!qrCode && !rfidCard) {
      return res.status(400).json({
        success: false,
        error: 'Kein QR-Code oder RFID-Karte übermittelt'
      });
    }

    // Prüfe ob Registrierungs-Modus aktiv ist
    if (rfidCard && checkRegistrationMode(rfidCard)) {
      return res.json({
        success: true,
        action: 'registration',
        message: 'RFID-Karte zur Registrierung übermittelt'
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
          isActive: true,
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
          isActive: true,
        },
      });
      authMethod = 'qrcode';
    }

    if (!employee) {
      return res.status(404).json({
        success: false,
        error: rfidCard ? 'Unbekannte RFID-Karte' : 'Unbekannter QR-Code',
        message: 'Mitarbeiter nicht gefunden'
      });
    }

    if (!employee.isActive) {
      return res.status(403).json({
        success: false,
        error: 'Mitarbeiter inaktiv',
        message: `${employee.firstName} ${employee.lastName} ist nicht mehr aktiv`
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

    if (activeEntry) {
      // Ausstempeln
      const now = new Date();
      const currentEntryHours = (now.getTime() - activeEntry.clockIn.getTime()) / (1000 * 60 * 60);

      // Automatische Pause nach 6 Stunden (30 min)
      let breakMinutes = activeEntry.breakMinutes;
      if (currentEntryHours > 6 && breakMinutes === 0) {
        const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
        breakMinutes = settings?.defaultBreakMinutes ?? 30;
      }

      const updatedEntry = await prisma.timeEntry.update({
        where: { id: activeEntry.id },
        data: {
          clockOut: now,
          breakMinutes,
        },
      });

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
        req,
        userId: employee.id,
        userName: `${employee.firstName} ${employee.lastName}`,
        action: 'CLOCK_OUT',
        entityType: 'TimeEntry',
        entityId: updatedEntry.id,
        newValues: {
          clockOut: updatedEntry.clockOut,
          breakMinutes,
          hoursWorked: formattedTime,
        },
      });

      // WebSocket Event für Ausstempeln
      io.emit('time-entry-updated', {
        type: 'clock_out',
        employeeId: employee.id,
        entry: updatedEntry,
        employee: {
          id: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
          employeeNumber: employee.employeeNumber,
        },
      });

      return res.json({
        success: true,
        action: 'clock_out',
        employee: {
          name: `${employee.firstName} ${employee.lastName}`,
          employeeNumber: employee.employeeNumber,
        },
        entry: {
          clockIn: activeEntry.clockIn,
          clockOut: updatedEntry.clockOut,
          breakMinutes,
          hoursWorked: formattedTime,
        },
        message: `Auf Wiedersehen, ${employee.firstName}! Du hast heute ${formattedTime} Stunden gearbeitet.`,
      });
    } else {
      // Einstempeln
      const newEntry = await prisma.timeEntry.create({
        data: {
          employeeId: employee.id,
          clockIn: new Date(),
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

      // WebSocket Event für Einstempeln
      io.emit('time-entry-updated', {
        type: 'clock_in',
        employeeId: employee.id,
        entry: newEntry,
        employee: {
          id: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
          employeeNumber: employee.employeeNumber,
        },
      });

      return res.json({
        success: true,
        action: 'clock_in',
        employee: {
          name: `${employee.firstName} ${employee.lastName}`,
          employeeNumber: employee.employeeNumber,
        },
        entry: {
          clockIn: newEntry.clockIn,
        },
        message: `Guten Tag, ${employee.firstName}! Du bist jetzt eingestempelt.`,
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

// PIN-basiertes Stempeln (Alternative zum QR-Code)
router.post('/pin', async (req, res) => {
  try {
    const { employeeNumber, pin } = req.body;

    if (!employeeNumber || !pin) {
      return res.status(400).json({
        success: false,
        error: 'Mitarbeiternummer und PIN erforderlich'
      });
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
      return res.status(401).json({
        success: false,
        error: 'Ungültige Anmeldedaten'
      });
    }

    // Verwende den gleichen Scan-Prozess
    const scanResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/terminal/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-terminal-api-key': process.env.TERMINAL_API_KEY || 'handy-insel-terminal-key-2024',
      },
      body: JSON.stringify({ qrCode: employee.qrCode }),
    });

    const result = await scanResponse.json();
    res.status(scanResponse.status).json(result);
  } catch (error) {
    console.error('Terminal PIN error:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Verarbeiten'
    });
  }
});

// Aktueller Status eines Mitarbeiters (für Terminal-Display)
router.get('/status/:qrCode', async (req, res) => {
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

    res.json({
      employee: {
        name: `${employee.firstName} ${employee.lastName}`,
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
router.get('/active', async (_req, res) => {
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

    res.json(activeEntries.map(entry => ({
      employeeName: `${entry.employee.firstName} ${entry.employee.lastName}`,
      employeeNumber: entry.employee.employeeNumber,
      clockIn: entry.clockIn,
    })));
  } catch (error) {
    console.error('Get active error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der aktiven Mitarbeiter' });
  }
});

export default router;
