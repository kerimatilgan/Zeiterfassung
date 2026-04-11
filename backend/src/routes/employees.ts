import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { createAuditLog } from '../utils/auditLog.js';

// Multer-Konfiguration für Foto-Uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'photos');
    // Verzeichnis erstellen falls nicht vorhanden
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `photo-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Nur Bilder erlaubt (JPEG, PNG, GIF, WebP)'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

const router = Router();

const employeeSchema = z.object({
  employeeNumber: z.string().min(1, 'Mitarbeiternummer erforderlich'),
  username: z.string().min(3, 'Benutzername muss mindestens 3 Zeichen haben').regex(/^[a-zA-Z0-9._-]+$/, 'Benutzername darf nur Buchstaben, Zahlen, Punkte, Bindestriche und Unterstriche enthalten').optional().nullable(),
  firstName: z.string().min(1, 'Vorname erforderlich'),
  lastName: z.string().min(1, 'Nachname erforderlich'),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  weeklyHours: z.number().min(0).max(168).optional(),
  vacationDaysPerYear: z.number().int().min(0).max(365).optional(),
  workDays: z.string().optional(), // Komma-getrennte Wochentage: "1,2,3,4,5"
  isAdmin: z.boolean().optional(),
  password: z.string().min(6).optional(),
  workCategoryId: z.string().uuid().optional().nullable(),
  canClockInPwa: z.boolean().optional(),
  canClockOutPwa: z.boolean().optional(),
  defaultClockOut: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

// Alle Mitarbeiter abrufen (nur Admin)
router.get('/', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        employeeNumber: true,
        username: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        photoUrl: true,
        weeklyHours: true,
        vacationDaysPerYear: true,
        workDays: true,
        isActive: true,
        isAdmin: true,
        qrCode: true,
        rfidCard: true,
        workCategoryId: true,
        workCategory: { select: { id: true, name: true, earliestClockIn: true } },
        canClockInPwa: true,
        canClockOutPwa: true,
        defaultClockOut: true,
        startDate: true,
        endDate: true,
        carryOverVacationDays: true,
        initialOvertimeBalance: true,
        initialVacationDaysUsed: true,
        initialSickDays: true,
        initialBalanceYear: true,
        initialBalanceMonth: true,
        createdAt: true,
      },
      orderBy: { lastName: 'asc' },
    });

    res.json(employees);
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Mitarbeiter' });
  }
});

// Einzelnen Mitarbeiter abrufen
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Nicht-Admins können nur sich selbst abrufen
    if (!req.employee!.isAdmin && req.employee!.id !== id) {
      return res.status(403).json({ error: 'Keine Berechtigung' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id },
      select: {
        id: true,
        employeeNumber: true,
        username: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        photoUrl: true,
        weeklyHours: true,
        vacationDaysPerYear: true,
        workDays: true,
        isActive: true,
        isAdmin: true,
        qrCode: true,
        rfidCard: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    res.json(employee);
  } catch (error) {
    console.error('Get employee error:', error);
    res.status(500).json({ error: 'Fehler beim Laden des Mitarbeiters' });
  }
});

// Neuen Mitarbeiter anlegen (nur Admin)
router.post('/', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = employeeSchema.parse(req.body);

    // Prüfen ob Mitarbeiternummer bereits existiert
    const existing = await prisma.employee.findUnique({
      where: { employeeNumber: data.employeeNumber },
    });

    if (existing) {
      return res.status(400).json({ error: 'Mitarbeiternummer bereits vergeben' });
    }

    // Prüfen ob Benutzername bereits existiert
    if (data.username) {
      const usernameExists = await prisma.employee.findUnique({
        where: { username: data.username },
      });
      if (usernameExists) {
        return res.status(400).json({ error: 'Benutzername bereits vergeben' });
      }
    }

    // QR-Code generieren
    const qrCode = `HI-${data.employeeNumber}-${uuidv4().substring(0, 8)}`;

    // Passwort hashen falls angegeben
    let passwordHash: string | undefined;
    if (data.password) {
      passwordHash = await bcrypt.hash(data.password, 10);
    }

    const employee = await prisma.employee.create({
      data: {
        employeeNumber: data.employeeNumber,
        username: data.username || null,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone || null,
        weeklyHours: data.weeklyHours ?? 40.0,
        vacationDaysPerYear: data.vacationDaysPerYear ?? 30,
        workDays: data.workDays ?? '1,2,3,4,5',
        isAdmin: data.isAdmin ?? false,
        workCategoryId: data.workCategoryId || null,
        canClockInPwa: data.canClockInPwa ?? false,
        canClockOutPwa: data.canClockOutPwa ?? false,
        defaultClockOut: data.defaultClockOut || null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        qrCode,
        passwordHash,
      },
      select: {
        id: true,
        employeeNumber: true,
        username: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        photoUrl: true,
        weeklyHours: true,
        vacationDaysPerYear: true,
        workDays: true,
        isActive: true,
        isAdmin: true,
        qrCode: true,
        workCategoryId: true,
        workCategory: { select: { id: true, name: true, earliestClockIn: true } },
        canClockInPwa: true,
        canClockOutPwa: true,
        defaultClockOut: true,
        startDate: true,
        endDate: true,
        carryOverVacationDays: true,
        createdAt: true,
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'CREATE',
      entityType: 'Employee',
      entityId: employee.id,
      newValues: {
        employeeNumber: employee.employeeNumber,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        weeklyHours: employee.weeklyHours,
        vacationDaysPerYear: employee.vacationDaysPerYear,
        workDays: employee.workDays,
        isAdmin: employee.isAdmin,
      },
    });

    res.status(201).json(employee);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Create employee error:', error);
    res.status(500).json({ error: 'Fehler beim Anlegen des Mitarbeiters' });
  }
});

// Mitarbeiter aktualisieren (nur Admin)
router.put('/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const data = employeeSchema.partial().parse(req.body);

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Prüfen ob neuer Benutzername bereits vergeben
    if (data.username !== undefined && data.username !== existing.username) {
      if (data.username) {
        const usernameConflict = await prisma.employee.findUnique({
          where: { username: data.username },
        });
        if (usernameConflict) {
          return res.status(400).json({ error: 'Benutzername bereits vergeben' });
        }
      }
    }

    // Prüfen ob neue Mitarbeiternummer bereits vergeben
    if (data.employeeNumber && data.employeeNumber !== existing.employeeNumber) {
      const conflict = await prisma.employee.findUnique({
        where: { employeeNumber: data.employeeNumber },
      });
      if (conflict) {
        return res.status(400).json({ error: 'Mitarbeiternummer bereits vergeben' });
      }
    }

    // Letzten Admin schützen
    if (existing.isAdmin && data.isAdmin === false) {
      const adminCount = await prisma.employee.count({
        where: { isAdmin: true, isActive: true },
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Der letzte Administrator kann nicht herabgestuft werden' });
      }
    }

    // Passwort hashen falls angegeben
    let passwordHash: string | undefined;
    if (data.password) {
      passwordHash = await bcrypt.hash(data.password, 10);
    }

    // Alte Werte für Audit Log speichern
    const oldValues = {
      employeeNumber: existing.employeeNumber,
      firstName: existing.firstName,
      lastName: existing.lastName,
      email: existing.email,
      phone: existing.phone,
      weeklyHours: existing.weeklyHours,
      vacationDaysPerYear: existing.vacationDaysPerYear,
      workDays: existing.workDays,
      isAdmin: existing.isAdmin,
    };

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...(data.employeeNumber && { employeeNumber: data.employeeNumber }),
        ...(data.username !== undefined && { username: data.username || null }),
        ...(data.firstName && { firstName: data.firstName }),
        ...(data.lastName && { lastName: data.lastName }),
        ...(data.email !== undefined && { email: data.email || null }),
        ...(data.phone !== undefined && { phone: data.phone || null }),
        ...(data.weeklyHours !== undefined && { weeklyHours: data.weeklyHours }),
        ...(data.vacationDaysPerYear !== undefined && { vacationDaysPerYear: data.vacationDaysPerYear }),
        ...(data.workDays !== undefined && { workDays: data.workDays }),
        ...(data.isAdmin !== undefined && { isAdmin: data.isAdmin }),
        ...(data.workCategoryId !== undefined && { workCategoryId: data.workCategoryId || null }),
        ...(data.canClockInPwa !== undefined && { canClockInPwa: data.canClockInPwa }),
        ...(data.canClockOutPwa !== undefined && { canClockOutPwa: data.canClockOutPwa }),
        ...(data.defaultClockOut !== undefined && { defaultClockOut: data.defaultClockOut || null }),
        ...(data.startDate !== undefined && { startDate: data.startDate ? new Date(data.startDate) : null }),
        ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(data.endDate) : null }),
        ...(passwordHash && { passwordHash }),
      },
      select: {
        id: true,
        employeeNumber: true,
        username: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        photoUrl: true,
        weeklyHours: true,
        vacationDaysPerYear: true,
        workDays: true,
        isActive: true,
        isAdmin: true,
        qrCode: true,
        workCategoryId: true,
        workCategory: { select: { id: true, name: true, earliestClockIn: true } },
        canClockInPwa: true,
        canClockOutPwa: true,
        defaultClockOut: true,
        startDate: true,
        endDate: true,
        carryOverVacationDays: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: employee.id,
      oldValues,
      newValues: {
        employeeNumber: employee.employeeNumber,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        phone: employee.phone,
        weeklyHours: employee.weeklyHours,
        vacationDaysPerYear: employee.vacationDaysPerYear,
        workDays: employee.workDays,
        isAdmin: employee.isAdmin,
        passwordChanged: !!passwordHash,
      },
    });

    res.json(employee);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Mitarbeiters' });
  }
});

// Mitarbeiter deaktivieren (nur Admin)
router.delete('/:id', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Nicht sich selbst löschen
    if (req.employee!.id === id) {
      return res.status(400).json({ error: 'Sie können sich nicht selbst deaktivieren' });
    }

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Letzten Admin schützen
    if (existing.isAdmin) {
      const adminCount = await prisma.employee.count({
        where: { isAdmin: true, isActive: true },
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Der letzte Administrator kann nicht deaktiviert werden' });
      }
    }

    // Soft delete: nur deaktivieren
    await prisma.employee.update({
      where: { id },
      data: { isActive: false },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'DELETE',
      entityType: 'Employee',
      entityId: id,
      oldValues: {
        employeeNumber: existing.employeeNumber,
        firstName: existing.firstName,
        lastName: existing.lastName,
        isActive: true,
      },
      newValues: {
        isActive: false,
      },
      note: 'Mitarbeiter deaktiviert (Soft Delete)',
    });

    res.json({ message: 'Mitarbeiter deaktiviert' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Mitarbeiters' });
  }
});

// RFID-Karte registrieren (nur Admin)
router.post('/:id/register-rfid', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rfidCard } = req.body;

    if (!rfidCard || typeof rfidCard !== 'string' || rfidCard.trim().length === 0) {
      return res.status(400).json({ error: 'RFID-Karten-ID erforderlich' });
    }

    const trimmedRfid = rfidCard.trim().toUpperCase();

    // Prüfen ob Mitarbeiter existiert
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Prüfen ob RFID bereits verwendet wird
    const existingRfid = await prisma.employee.findUnique({
      where: { rfidCard: trimmedRfid },
    });

    if (existingRfid && existingRfid.id !== id) {
      return res.status(400).json({
        error: `RFID-Karte bereits vergeben an ${existingRfid.firstName} ${existingRfid.lastName}`,
      });
    }

    // RFID speichern
    const updated = await prisma.employee.update({
      where: { id },
      data: { rfidCard: trimmedRfid },
      select: {
        id: true,
        rfidCard: true,
        firstName: true,
        lastName: true,
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: id,
      oldValues: { rfidCard: employee.rfidCard },
      newValues: { rfidCard: trimmedRfid },
      note: 'RFID-Karte registriert',
    });

    res.json({
      message: 'RFID-Karte erfolgreich registriert',
      rfidCard: updated.rfidCard,
    });
  } catch (error) {
    console.error('Register RFID error:', error);
    res.status(500).json({ error: 'Fehler beim Registrieren der RFID-Karte' });
  }
});

// Foto hochladen (nur Admin)
router.post('/:id/photo', authMiddleware, adminMiddleware, upload.single('photo'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'Kein Foto hochgeladen' });
    }

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      // Lösche hochgeladene Datei wenn Mitarbeiter nicht existiert
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Altes Foto löschen falls vorhanden
    if (employee.photoUrl) {
      const oldPhotoPath = path.join(process.cwd(), employee.photoUrl);
      if (fs.existsSync(oldPhotoPath)) {
        fs.unlinkSync(oldPhotoPath);
      }
    }

    // Relativer Pfad für die Datenbank
    const photoUrl = `/uploads/photos/${req.file.filename}`;

    const updated = await prisma.employee.update({
      where: { id },
      data: { photoUrl },
      select: {
        id: true,
        photoUrl: true,
        firstName: true,
        lastName: true,
      },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: id,
      oldValues: { photoUrl: employee.photoUrl },
      newValues: { photoUrl },
      note: 'Foto hochgeladen',
    });

    res.json({
      message: 'Foto erfolgreich hochgeladen',
      photoUrl: updated.photoUrl,
    });
  } catch (error) {
    // Bei Fehler hochgeladene Datei löschen
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Upload photo error:', error);
    res.status(500).json({ error: 'Fehler beim Hochladen des Fotos' });
  }
});

// Foto löschen (nur Admin)
router.delete('/:id/photo', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    if (!employee.photoUrl) {
      return res.status(400).json({ error: 'Kein Foto vorhanden' });
    }

    // Foto-Datei löschen
    const photoPath = path.join(process.cwd(), employee.photoUrl);
    if (fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath);
    }

    // Datenbank aktualisieren
    await prisma.employee.update({
      where: { id },
      data: { photoUrl: null },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: id,
      oldValues: { photoUrl: employee.photoUrl },
      newValues: { photoUrl: null },
      note: 'Foto gelöscht',
    });

    res.json({ message: 'Foto erfolgreich gelöscht' });
  } catch (error) {
    console.error('Delete photo error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Fotos' });
  }
});

// RFID-Karte entfernen (nur Admin)
router.delete('/:id/rfid', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    if (!employee.rfidCard) {
      return res.status(400).json({ error: 'Keine RFID-Karte registriert' });
    }

    const oldRfid = employee.rfidCard;

    await prisma.employee.update({
      where: { id },
      data: { rfidCard: null },
    });

    // Audit Log
    await createAuditLog({
      req,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: id,
      oldValues: { rfidCard: oldRfid },
      newValues: { rfidCard: null },
      note: 'RFID-Karte entfernt',
    });

    res.json({ message: 'RFID-Karte erfolgreich entfernt' });
  } catch (error) {
    console.error('Remove RFID error:', error);
    res.status(500).json({ error: 'Fehler beim Entfernen der RFID-Karte' });
  }
});

export default router;
