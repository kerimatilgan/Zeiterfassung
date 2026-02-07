import { Router, Response } from 'express';
import { prisma } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { createAuditLog } from '../utils/auditLog.js';
import { testConnection, sendTestEmail } from '../utils/emailService.js';
import {
  getGermanHolidays,
  getBundeslandFromPLZ,
  extractPLZFromAddress,
  BUNDESLAND_NAMES,
  type Bundesland,
} from '../utils/germanHolidays.js';

// Multer für Datei-Upload konfigurieren
const upload = multer({
  dest: 'temp-uploads/',
  limits: { fileSize: 100 * 1024 * 1024 }, // Max 100MB
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.db') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Nur .db Dateien sind erlaubt'));
    }
  },
});

const router = Router();

// Einstellungen abrufen
router.get('/', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Einstellungen' });
  }
});

// Einstellungen aktualisieren (Admin)
router.put('/', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      companyName: z.string().min(1).optional(),
      companyAddress: z.string().optional().nullable(),
      companyPhone: z.string().optional().nullable(),
      companyEmail: z.string().email().optional().nullable(),
      defaultBreakMinutes: z.number().min(0).max(120).optional(),
      overtimeThreshold: z.number().min(0).max(168).optional(),
    });

    const data = schema.parse(req.body);

    // Alte Werte für Audit Log
    const oldSettings = await prisma.settings.findUnique({ where: { id: 'default' } });

    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      update: data,
      create: {
        id: 'default',
        ...data,
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'Settings',
      entityId: 'default',
      oldValues: oldSettings,
      newValues: settings,
    });

    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Einstellungen' });
  }
});

// Feiertage abrufen
router.get('/holidays', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { year } = req.query;

    const where: any = {};
    if (year) {
      const startOfYear = new Date(parseInt(year as string), 0, 1);
      const endOfYear = new Date(parseInt(year as string), 11, 31, 23, 59, 59);
      where.date = { gte: startOfYear, lte: endOfYear };
    }

    const holidays = await prisma.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
    });

    res.json(holidays);
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Feiertage' });
  }
});

// Feiertag hinzufügen (Admin)
router.post('/holidays', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      date: z.string().datetime(),
      name: z.string().min(1),
      isRecurring: z.boolean().optional(),
    });

    const data = schema.parse(req.body);

    const holiday = await prisma.holiday.create({
      data: {
        date: new Date(data.date),
        name: data.name,
        isRecurring: data.isRecurring ?? false,
      },
    });

    res.status(201).json(holiday);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create holiday error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Feiertags' });
  }
});

// Feiertag löschen (Admin)
router.delete('/holidays/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.holiday.delete({ where: { id } });

    res.json({ message: 'Feiertag gelöscht' });
  } catch (error) {
    console.error('Delete holiday error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Feiertags' });
  }
});

// Feiertage automatisch generieren (Admin)
router.post('/holidays/generate', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      year: z.number().min(2020).max(2100),
      bundesland: z.string().optional(), // Optional: Direkt angeben statt aus PLZ
      deleteExisting: z.boolean().optional(), // Bestehende Feiertage des Jahres löschen
    });

    const data = schema.parse(req.body);
    const year = data.year;

    let bundesland: Bundesland | null = data.bundesland as Bundesland | null;

    // Wenn kein Bundesland angegeben, aus Firmenadresse ermitteln
    if (!bundesland) {
      const settings = await prisma.settings.findUnique({
        where: { id: 'default' },
      });

      if (!settings?.companyAddress) {
        return res.status(400).json({
          error: 'Keine Firmenadresse hinterlegt. Bitte zuerst eine Adresse mit PLZ eingeben oder Bundesland direkt angeben.',
        });
      }

      const plz = extractPLZFromAddress(settings.companyAddress);
      if (!plz) {
        return res.status(400).json({
          error: 'Keine gültige PLZ in der Firmenadresse gefunden. Bitte Adresse im Format "Straße, PLZ Ort" eingeben.',
        });
      }

      bundesland = getBundeslandFromPLZ(plz);
      if (!bundesland) {
        return res.status(400).json({
          error: `PLZ ${plz} konnte keinem Bundesland zugeordnet werden. Bitte Bundesland direkt angeben.`,
        });
      }
    }

    // Optional: Bestehende Feiertage des Jahres löschen
    if (data.deleteExisting) {
      const startOfYear = new Date(year, 0, 1);
      const endOfYear = new Date(year, 11, 31, 23, 59, 59);

      await prisma.holiday.deleteMany({
        where: {
          date: { gte: startOfYear, lte: endOfYear },
        },
      });
    }

    // Feiertage berechnen
    const holidays = getGermanHolidays(year, bundesland);

    // Feiertage in DB einfügen (Duplikate vermeiden)
    let created = 0;
    let skipped = 0;

    for (const holiday of holidays) {
      // Prüfen ob Feiertag bereits existiert (gleiches Datum)
      const existing = await prisma.holiday.findFirst({
        where: {
          date: {
            gte: new Date(holiday.date.getFullYear(), holiday.date.getMonth(), holiday.date.getDate()),
            lt: new Date(holiday.date.getFullYear(), holiday.date.getMonth(), holiday.date.getDate() + 1),
          },
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.holiday.create({
        data: {
          date: holiday.date,
          name: holiday.name,
          isRecurring: false,
        },
      });
      created++;
    }

    res.status(201).json({
      message: `${created} Feiertage für ${year} erstellt (${skipped} übersprungen)`,
      bundesland,
      bundeslandName: BUNDESLAND_NAMES[bundesland],
      year,
      created,
      skipped,
      total: holidays.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Generate holidays error:', error);
    res.status(500).json({ error: 'Fehler beim Generieren der Feiertage' });
  }
});

// Bundesland Info abrufen (für UI)
router.get('/holidays/bundesland-info', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    if (!settings?.companyAddress) {
      return res.json({
        detected: false,
        message: 'Keine Firmenadresse hinterlegt',
      });
    }

    const plz = extractPLZFromAddress(settings.companyAddress);
    if (!plz) {
      return res.json({
        detected: false,
        plz: null,
        message: 'Keine PLZ in der Adresse gefunden',
      });
    }

    const bundesland = getBundeslandFromPLZ(plz);
    if (!bundesland) {
      return res.json({
        detected: false,
        plz,
        message: `PLZ ${plz} konnte keinem Bundesland zugeordnet werden`,
      });
    }

    res.json({
      detected: true,
      plz,
      bundesland,
      bundeslandName: BUNDESLAND_NAMES[bundesland],
    });
  } catch (error) {
    console.error('Get bundesland info error:', error);
    res.status(500).json({ error: 'Fehler beim Ermitteln des Bundeslandes' });
  }
});

// Alle Bundesländer abrufen (für Dropdown)
router.get('/holidays/bundeslaender', authMiddleware, async (_req: AuthRequest, res: Response) => {
  res.json(
    Object.entries(BUNDESLAND_NAMES).map(([code, name]) => ({
      code,
      name,
    }))
  );
});

// ==================== ABWESENHEITSTYPEN ====================

// Abwesenheitstypen abrufen
router.get('/absence-types', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const absenceTypes = await prisma.absenceType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    res.json(absenceTypes);
  } catch (error) {
    console.error('Get absence types error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Abwesenheitstypen' });
  }
});

// Alle Abwesenheitstypen abrufen (inkl. inaktive, für Admin)
router.get('/absence-types/all', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const absenceTypes = await prisma.absenceType.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    res.json(absenceTypes);
  } catch (error) {
    console.error('Get all absence types error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Abwesenheitstypen' });
  }
});

// Abwesenheitstyp erstellen (Admin)
router.post('/absence-types', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      shortName: z.string().min(1).max(10),
      requiredHours: z.number().min(0).max(24),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const data = schema.parse(req.body);

    const absenceType = await prisma.absenceType.create({
      data: {
        name: data.name,
        shortName: data.shortName,
        requiredHours: data.requiredHours,
        color: data.color,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    res.status(201).json(absenceType);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create absence type error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Abwesenheitstyps' });
  }
});

// Abwesenheitstyp aktualisieren (Admin)
router.put('/absence-types/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      name: z.string().min(1).optional(),
      shortName: z.string().min(1).max(10).optional(),
      requiredHours: z.number().min(0).max(24).optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const data = schema.parse(req.body);

    const absenceType = await prisma.absenceType.update({
      where: { id },
      data,
    });

    res.json(absenceType);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update absence type error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Abwesenheitstyps' });
  }
});

// Abwesenheitstyp löschen (Admin)
router.delete('/absence-types/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Prüfen ob noch Abwesenheiten mit diesem Typ existieren
    const existingAbsences = await prisma.employeeAbsence.count({
      where: { absenceTypeId: id },
    });

    if (existingAbsences > 0) {
      return res.status(400).json({
        error: `Kann nicht löschen: ${existingAbsences} Abwesenheiten verwenden diesen Typ. Bitte erst deaktivieren statt löschen.`,
      });
    }

    await prisma.absenceType.delete({ where: { id } });

    res.json({ message: 'Abwesenheitstyp gelöscht' });
  } catch (error) {
    console.error('Delete absence type error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Abwesenheitstyps' });
  }
});

// ==================== MITARBEITER-ABWESENHEITEN ====================

// Abwesenheiten für einen Mitarbeiter abrufen
router.get('/absences', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, from, to } = req.query;

    const where: any = {};

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (from || to) {
      where.date = {};
      if (from) {
        where.date.gte = new Date(from as string);
      }
      if (to) {
        where.date.lte = new Date(to as string);
      }
    }

    const absences = await prisma.employeeAbsence.findMany({
      where,
      include: {
        absenceType: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    res.json(absences);
  } catch (error) {
    console.error('Get absences error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Abwesenheiten' });
  }
});

// Abwesenheit erstellen (Admin)
router.post('/absences', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      employeeId: z.string().uuid(),
      absenceTypeId: z.string().uuid(),
      date: z.string(),
      note: z.string().optional().nullable(),
    });

    const data = schema.parse(req.body);

    // Prüfen ob an diesem Tag bereits eine Abwesenheit existiert
    const existingAbsence = await prisma.employeeAbsence.findUnique({
      where: {
        employeeId_date: {
          employeeId: data.employeeId,
          date: new Date(data.date),
        },
      },
    });

    if (existingAbsence) {
      return res.status(400).json({ error: 'Für diesen Tag existiert bereits eine Abwesenheit' });
    }

    const absence = await prisma.employeeAbsence.create({
      data: {
        employeeId: data.employeeId,
        absenceTypeId: data.absenceTypeId,
        date: new Date(data.date),
        note: data.note || null,
      },
      include: {
        absenceType: true,
      },
    });

    res.status(201).json(absence);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create absence error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Abwesenheit' });
  }
});

// Abwesenheit aktualisieren (Admin)
router.put('/absences/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const schema = z.object({
      absenceTypeId: z.string().uuid().optional(),
      note: z.string().optional().nullable(),
    });

    const data = schema.parse(req.body);

    const absence = await prisma.employeeAbsence.update({
      where: { id },
      data,
      include: {
        absenceType: true,
      },
    });

    res.json(absence);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update absence error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Abwesenheit' });
  }
});

// Abwesenheit löschen (Admin)
router.delete('/absences/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.employeeAbsence.delete({ where: { id } });

    res.json({ message: 'Abwesenheit gelöscht' });
  } catch (error) {
    console.error('Delete absence error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Abwesenheit' });
  }
});

// Dashboard-Statistiken (Admin)
router.get('/dashboard-stats', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Aktive Mitarbeiter
    const activeEmployees = await prisma.employee.count({
      where: { isActive: true },
    });

    // Aktuell eingestempelt
    const currentlyClockedIn = await prisma.timeEntry.count({
      where: { clockOut: null },
    });

    // Einträge heute
    const entriesToday = await prisma.timeEntry.count({
      where: { clockIn: { gte: startOfDay } },
    });

    // Einträge diesen Monat
    const entriesThisMonth = await prisma.timeEntry.count({
      where: { clockIn: { gte: startOfMonth } },
    });

    // Offene Abrechnungen (Drafts)
    const pendingReports = await prisma.monthlyReport.count({
      where: { status: 'draft' },
    });

    res.json({
      activeEmployees,
      currentlyClockedIn,
      entriesToday,
      entriesThisMonth,
      pendingReports,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

// ==================== DATENBANK-VERWALTUNG ====================

// Datenbank-Info abrufen (Admin)
router.get('/database/info', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const dbPath = path.join(process.cwd(), 'prisma', 'zeiterfassung.db');

    // DB-Größe ermitteln
    let dbSize = 0;
    let dbSizeFormatted = '0 KB';
    let dbExists = false;

    if (fs.existsSync(dbPath)) {
      dbExists = true;
      const stats = fs.statSync(dbPath);
      dbSize = stats.size;

      if (dbSize < 1024) {
        dbSizeFormatted = `${dbSize} Bytes`;
      } else if (dbSize < 1024 * 1024) {
        dbSizeFormatted = `${(dbSize / 1024).toFixed(2)} KB`;
      } else {
        dbSizeFormatted = `${(dbSize / (1024 * 1024)).toFixed(2)} MB`;
      }
    }

    // Statistiken aus der DB
    const [
      employeeCount,
      timeEntryCount,
      monthlyReportCount,
      holidayCount,
      absenceCount,
      absenceTypeCount,
    ] = await Promise.all([
      prisma.employee.count(),
      prisma.timeEntry.count(),
      prisma.monthlyReport.count(),
      prisma.holiday.count(),
      prisma.employeeAbsence.count(),
      prisma.absenceType.count(),
    ]);

    // Letzte Änderung
    let lastModified: Date | null = null;
    if (dbExists) {
      const stats = fs.statSync(dbPath);
      lastModified = stats.mtime;
    }

    res.json({
      exists: dbExists,
      path: dbPath,
      size: dbSize,
      sizeFormatted: dbSizeFormatted,
      lastModified,
      stats: {
        employees: employeeCount,
        timeEntries: timeEntryCount,
        monthlyReports: monthlyReportCount,
        holidays: holidayCount,
        absences: absenceCount,
        absenceTypes: absenceTypeCount,
      },
    });
  } catch (error) {
    console.error('Get database info error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Datenbank-Informationen' });
  }
});

// Datenbank-Backup herunterladen (Admin)
router.get('/database/backup', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const dbPath = path.join(process.cwd(), 'prisma', 'zeiterfassung.db');

    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Datenbank-Datei nicht gefunden' });
    }

    // Dateiname mit Datum
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = `zeiterfassung_backup_${dateStr}.db`;

    // Audit Log
    await createAuditLog({
      req,
      action: 'DB_BACKUP',
      entityType: 'Database',
      newValues: {
        filename,
        size: fs.statSync(dbPath).size,
      },
    });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const fileStream = fs.createReadStream(dbPath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Database backup error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Backups' });
  }
});

// Datenbank wiederherstellen (Admin)
router.post('/database/restore', authMiddleware, adminMiddleware, upload.single('database'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    const uploadedPath = req.file.path;
    const dbPath = path.join(process.cwd(), 'prisma', 'zeiterfassung.db');
    const backupPath = path.join(process.cwd(), 'prisma', `zeiterfassung_before_restore_${Date.now()}.db.bak`);

    // Prisma-Verbindung schließen
    await prisma.$disconnect();

    try {
      // Aktuelle DB sichern
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
      }

      // Hochgeladene Datei als neue DB einsetzen
      fs.copyFileSync(uploadedPath, dbPath);

      // Temp-Datei löschen
      fs.unlinkSync(uploadedPath);

      // Prisma neu verbinden
      await prisma.$connect();

      // Test-Query um sicherzustellen, dass die DB valide ist
      await prisma.employee.count();

      // Audit Log
      await createAuditLog({
        req,
        action: 'DB_RESTORE',
        entityType: 'Database',
        newValues: {
          filename: req.file.originalname,
          backupPath,
        },
        note: 'Datenbank erfolgreich wiederhergestellt',
      });

      res.json({
        success: true,
        message: 'Datenbank erfolgreich wiederhergestellt',
        backupPath: backupPath,
      });
    } catch (restoreError) {
      // Bei Fehler: Backup wiederherstellen
      console.error('Restore failed, reverting:', restoreError);

      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, dbPath);
      }

      // Temp-Datei löschen falls noch vorhanden
      if (fs.existsSync(uploadedPath)) {
        fs.unlinkSync(uploadedPath);
      }

      // Prisma neu verbinden
      await prisma.$connect();

      return res.status(400).json({
        error: 'Datenbank-Wiederherstellung fehlgeschlagen. Die hochgeladene Datei ist keine gültige Zeiterfassung-Datenbank.',
      });
    }
  } catch (error) {
    console.error('Database restore error:', error);
    res.status(500).json({ error: 'Fehler bei der Datenbank-Wiederherstellung' });
  }
});

// ==================== MAIL-SERVER EINSTELLUNGEN ====================

// Mail-Einstellungen abrufen (Admin)
router.get('/mail', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
      select: {
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        smtpPassword: true,
        smtpFromAddress: true,
        smtpFromName: true,
        smtpSecure: true,
      },
    });

    if (!settings) {
      return res.json({
        smtpHost: null,
        smtpPort: 587,
        smtpUser: null,
        smtpPassword: null,
        smtpFromAddress: null,
        smtpFromName: 'Zeiterfassung',
        smtpSecure: false,
      });
    }

    // Passwort maskieren wenn vorhanden
    const maskedSettings = {
      ...settings,
      smtpPassword: settings.smtpPassword ? '********' : null,
    };

    res.json(maskedSettings);
  } catch (error) {
    console.error('Get mail settings error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Mail-Einstellungen' });
  }
});

// Mail-Einstellungen aktualisieren (Admin)
router.put('/mail', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      smtpHost: z.string().min(1).optional().nullable(),
      smtpPort: z.number().min(1).max(65535).optional().nullable(),
      smtpUser: z.string().optional().nullable(),
      smtpPassword: z.string().optional().nullable(),
      smtpFromAddress: z.string().email().optional().nullable(),
      smtpFromName: z.string().optional().nullable(),
      smtpSecure: z.boolean().optional(),
    });

    const data = schema.parse(req.body);

    // Wenn Passwort maskiert ist (********), behalten wir das alte
    let passwordToSave = data.smtpPassword;
    if (data.smtpPassword === '********') {
      const currentSettings = await prisma.settings.findUnique({
        where: { id: 'default' },
        select: { smtpPassword: true },
      });
      passwordToSave = currentSettings?.smtpPassword || null;
    }

    // Alte Werte für Audit Log
    const oldSettings = await prisma.settings.findUnique({ where: { id: 'default' } });

    const settings = await prisma.settings.upsert({
      where: { id: 'default' },
      update: {
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpUser: data.smtpUser,
        smtpPassword: passwordToSave,
        smtpFromAddress: data.smtpFromAddress,
        smtpFromName: data.smtpFromName,
        smtpSecure: data.smtpSecure,
      },
      create: {
        id: 'default',
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpUser: data.smtpUser,
        smtpPassword: passwordToSave,
        smtpFromAddress: data.smtpFromAddress,
        smtpFromName: data.smtpFromName,
        smtpSecure: data.smtpSecure,
      },
    });

    // Audit Log (Passwort nicht loggen)
    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'MailSettings',
      entityId: 'default',
      oldValues: oldSettings ? { ...oldSettings, smtpPassword: oldSettings.smtpPassword ? '[REDACTED]' : null } : null,
      newValues: { ...settings, smtpPassword: settings.smtpPassword ? '[REDACTED]' : null },
    });

    // Passwort maskieren in Response
    res.json({
      ...settings,
      smtpPassword: settings.smtpPassword ? '********' : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update mail settings error:', error);
    res.status(500).json({ error: 'Fehler beim Speichern der Mail-Einstellungen' });
  }
});

// Mail-Verbindung testen (Admin)
router.post('/mail/test', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      testEmail: z.string().email('Bitte gültige E-Mail-Adresse eingeben'),
    });

    const { testEmail } = schema.parse(req.body);

    // Erst Verbindung testen
    const connectionResult = await testConnection();
    if (!connectionResult.success) {
      return res.status(400).json({
        error: `Verbindung zum Mail-Server fehlgeschlagen: ${connectionResult.error}`,
      });
    }

    // Test-E-Mail senden
    await sendTestEmail(testEmail);

    // Audit Log
    await createAuditLog({
      req,
      action: 'MAIL_TEST',
      entityType: 'MailSettings',
      newValues: { testEmail },
    });

    res.json({
      success: true,
      message: `Test-E-Mail wurde an ${testEmail} gesendet`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Mail test error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Fehler beim Senden der Test-E-Mail',
    });
  }
});

// ==================== ARBEITSKATEGORIEN ====================

// Aktive Arbeitskategorien (für Dropdowns)
router.get('/work-categories', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.workCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(categories);
  } catch (error) {
    console.error('Get work categories error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Arbeitskategorien' });
  }
});

// Alle Arbeitskategorien (Admin-Verwaltung)
router.get('/work-categories/all', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.workCategory.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    res.json(categories);
  } catch (error) {
    console.error('Get all work categories error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Arbeitskategorien' });
  }
});

// Arbeitskategorie erstellen
router.post('/work-categories', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      name: z.string().min(1, 'Name erforderlich'),
      earliestClockIn: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format HH:mm erforderlich'),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const data = schema.parse(req.body);

    const category = await prisma.workCategory.create({
      data: {
        name: data.name,
        earliestClockIn: data.earliestClockIn,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    await createAuditLog({
      req,
      action: 'CREATE',
      entityType: 'WorkCategory',
      entityId: category.id,
      newValues: { name: data.name, earliestClockIn: data.earliestClockIn },
    });

    res.status(201).json(category);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create work category error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Arbeitskategorie' });
  }
});

// Arbeitskategorie bearbeiten
router.put('/work-categories/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      name: z.string().min(1).optional(),
      earliestClockIn: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const data = schema.parse(req.body);

    const existing = await prisma.workCategory.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Arbeitskategorie nicht gefunden' });
    }

    const category = await prisma.workCategory.update({
      where: { id },
      data,
    });

    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'WorkCategory',
      entityId: id,
      oldValues: { name: existing.name, earliestClockIn: existing.earliestClockIn },
      newValues: { name: category.name, earliestClockIn: category.earliestClockIn },
    });

    res.json(category);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update work category error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Arbeitskategorie' });
  }
});

// Arbeitskategorie löschen
router.delete('/work-categories/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const existing = await prisma.workCategory.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Arbeitskategorie nicht gefunden' });
    }

    const employeeCount = await prisma.employee.count({
      where: { workCategoryId: id },
    });

    if (employeeCount > 0) {
      return res.status(400).json({
        error: `Kann nicht löschen: ${employeeCount} Mitarbeiter verwenden diese Kategorie. Bitte erst deaktivieren oder Mitarbeiter umzuweisen.`,
      });
    }

    await prisma.workCategory.delete({ where: { id } });

    await createAuditLog({
      req,
      action: 'DELETE',
      entityType: 'WorkCategory',
      entityId: id,
      oldValues: { name: existing.name, earliestClockIn: existing.earliestClockIn },
    });

    res.json({ message: 'Arbeitskategorie gelöscht' });
  } catch (error) {
    console.error('Delete work category error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen der Arbeitskategorie' });
  }
});

export default router;
