import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../index.js';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { createAuditLog } from '../utils/auditLog.js';

const router = Router();

const loginSchema = z.object({
  employeeNumber: z.string().min(1, 'Mitarbeiternummer erforderlich'),
  password: z.string().min(1, 'Passwort erforderlich'),
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { employeeNumber, password } = loginSchema.parse(req.body);

    const employee = await prisma.employee.findUnique({
      where: { employeeNumber },
    });

    if (!employee || !employee.passwordHash || !employee.isActive) {
      await createAuditLog({
        req,
        action: 'LOGIN_FAILED',
        entityType: 'Employee',
        note: `Fehlgeschlagener Login-Versuch für Mitarbeiternummer: ${employeeNumber}`,
      });
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    const isValid = await bcrypt.compare(password, employee.passwordHash);
    if (!isValid) {
      await createAuditLog({
        req,
        userId: employee.id,
        userName: `${employee.firstName} ${employee.lastName}`,
        action: 'LOGIN_FAILED',
        entityType: 'Employee',
        entityId: employee.id,
        note: 'Falsches Passwort',
      });
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    const token = generateToken(employee);

    // Erfolgreiche Anmeldung loggen
    await createAuditLog({
      req,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'LOGIN',
      entityType: 'Employee',
      entityId: employee.id,
    });

    res.json({
      token,
      employee: {
        id: employee.id,
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Anmeldung fehlgeschlagen' });
  }
});

// Aktueller Benutzer
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        weeklyHours: true,
        vacationDaysPerYear: true,
        workDays: true,
        isAdmin: true,
        createdAt: true,
      },
    });

    res.json(employee);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Benutzerdaten' });
  }
});

// Passwort ändern
router.post('/change-password', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen haben' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
    });

    if (!employee || !employee.passwordHash) {
      return res.status(400).json({ error: 'Passwort ändern nicht möglich' });
    }

    const isValid = await bcrypt.compare(currentPassword, employee.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.employee.update({
      where: { id: employee.id },
      data: { passwordHash: newHash },
    });

    // Passwortänderung loggen
    await createAuditLog({
      req,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'PASSWORD_CHANGE',
      entityType: 'Employee',
      entityId: employee.id,
    });

    res.json({ message: 'Passwort erfolgreich geändert' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Passwort ändern fehlgeschlagen' });
  }
});

export default router;
