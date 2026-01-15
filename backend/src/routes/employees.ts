import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

const employeeSchema = z.object({
  employeeNumber: z.string().min(1, 'Mitarbeiternummer erforderlich'),
  firstName: z.string().min(1, 'Vorname erforderlich'),
  lastName: z.string().min(1, 'Nachname erforderlich'),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  hourlyRate: z.number().min(0).optional(),
  weeklyHours: z.number().min(0).max(168).optional(),
  isAdmin: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

// Alle Mitarbeiter abrufen (nur Admin)
router.get('/', authMiddleware, adminMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        hourlyRate: true,
        weeklyHours: true,
        isActive: true,
        isAdmin: true,
        qrCode: true,
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
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        hourlyRate: true,
        weeklyHours: true,
        isActive: true,
        isAdmin: true,
        qrCode: true,
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
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        phone: data.phone || null,
        hourlyRate: data.hourlyRate ?? 12.0,
        weeklyHours: data.weeklyHours ?? 40.0,
        isAdmin: data.isAdmin ?? false,
        qrCode,
        passwordHash,
      },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        hourlyRate: true,
        weeklyHours: true,
        isActive: true,
        isAdmin: true,
        qrCode: true,
        createdAt: true,
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

    // Prüfen ob neue Mitarbeiternummer bereits vergeben
    if (data.employeeNumber && data.employeeNumber !== existing.employeeNumber) {
      const conflict = await prisma.employee.findUnique({
        where: { employeeNumber: data.employeeNumber },
      });
      if (conflict) {
        return res.status(400).json({ error: 'Mitarbeiternummer bereits vergeben' });
      }
    }

    // Passwort hashen falls angegeben
    let passwordHash: string | undefined;
    if (data.password) {
      passwordHash = await bcrypt.hash(data.password, 10);
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...(data.employeeNumber && { employeeNumber: data.employeeNumber }),
        ...(data.firstName && { firstName: data.firstName }),
        ...(data.lastName && { lastName: data.lastName }),
        ...(data.email !== undefined && { email: data.email || null }),
        ...(data.phone !== undefined && { phone: data.phone || null }),
        ...(data.hourlyRate !== undefined && { hourlyRate: data.hourlyRate }),
        ...(data.weeklyHours !== undefined && { weeklyHours: data.weeklyHours }),
        ...(data.isAdmin !== undefined && { isAdmin: data.isAdmin }),
        ...(passwordHash && { passwordHash }),
      },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        hourlyRate: true,
        weeklyHours: true,
        isActive: true,
        isAdmin: true,
        qrCode: true,
        createdAt: true,
        updatedAt: true,
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
      return res.status(400).json({ error: 'Sie können sich nicht selbst löschen' });
    }

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Soft delete: nur deaktivieren
    await prisma.employee.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ message: 'Mitarbeiter deaktiviert' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Mitarbeiters' });
  }
});

// QR-Code neu generieren (nur Admin)
router.post('/:id/regenerate-qr', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    const newQrCode = `HI-${employee.employeeNumber}-${uuidv4().substring(0, 8)}`;

    const updated = await prisma.employee.update({
      where: { id },
      data: { qrCode: newQrCode },
      select: { qrCode: true },
    });

    res.json({ qrCode: updated.qrCode });
  } catch (error) {
    console.error('Regenerate QR error:', error);
    res.status(500).json({ error: 'Fehler beim Generieren des neuen QR-Codes' });
  }
});

export default router;
