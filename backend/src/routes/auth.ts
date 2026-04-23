import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth.js';
import { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } from '../middleware/rateLimits.js';
import { z } from 'zod';
import { createAuditLog } from '../utils/auditLog.js';
import { sendPasswordResetEmail } from '../utils/emailService.js';

const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET env var missing or too short');
  return s;
})();
const FRONTEND_URL: string = (() => {
  const s = process.env.FRONTEND_URL;
  if (!s) throw new Error('FRONTEND_URL env var required (e.g. https://zeit.example.com)');
  return s.replace(/\/+$/, '');
})();

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Benutzername erforderlich'),
  password: z.string().min(1, 'Passwort erforderlich'),
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    // Suche nach username (primär) oder employeeNumber (Fallback für Migration)
    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { username: username },
          { employeeNumber: username },
        ],
      },
    });

    if (!employee || !employee.passwordHash || !employee.isActive) {
      await createAuditLog({
        req,
        action: 'LOGIN_FAILED',
        entityType: 'Employee',
        note: `Fehlgeschlagener Login-Versuch für: ${username}`,
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

    // Check if 2FA is enabled
    if (employee.totpEnabled) {
      const tempToken = jwt.sign(
        { id: employee.id, purpose: '2fa' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );

      await createAuditLog({
        req,
        userId: employee.id,
        userName: `${employee.firstName} ${employee.lastName}`,
        action: 'LOGIN',
        entityType: 'Employee',
        entityId: employee.id,
        note: '2FA erforderlich',
      });

      return res.json({
        requires2FA: true,
        tempToken,
        methods: ['totp'],
      });
    }

    const token = generateToken(employee);

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
        username: employee.username,
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
        username: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        weeklyHours: true,
        vacationDaysPerYear: true,
        workDays: true,
        isAdmin: true,
        totpEnabled: true,
        _count: { select: { passkeys: true } },
        createdAt: true,
      },
    });

    res.json({
      ...employee,
      passkeyCount: employee?._count?.passkeys || 0,
      _count: undefined,
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Benutzerdaten' });
  }
});

// Passwort ändern
router.post('/change-password', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 10) {
      return res.status(400).json({ error: 'Neues Passwort muss mindestens 10 Zeichen haben' });
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

// Passwort vergessen - Reset-Link per E-Mail senden
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
    }

    // Immer gleiche Antwort zurückgeben (Sicherheit: kein User-Enumeration)
    const successMessage = 'Falls ein Konto mit dieser E-Mail existiert, wurde ein Reset-Link gesendet.';

    const employee = await prisma.employee.findUnique({
      where: { email },
    });

    if (!employee || !employee.isActive) {
      return res.json({ message: successMessage });
    }

    // Reset-Token generieren
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 Stunde gültig

    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      },
    });

    const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

    try {
      await sendPasswordResetEmail(employee.email!, employee.firstName, resetUrl);
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
      return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden. Bitte kontaktieren Sie den Administrator.' });
    }

    await createAuditLog({
      req,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'Employee',
      entityId: employee.id,
    });

    res.json({ message: successMessage });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Fehler beim Zurücksetzen des Passworts' });
  }
});

// Passwort zurücksetzen mit Token
// Token validieren und Benutzerinfo zurückgeben
router.get('/reset-password/validate', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'Token erforderlich' });
    }

    const employee = await prisma.employee.findFirst({
      where: {
        passwordResetToken: token as string,
        passwordResetExpires: { gt: new Date() },
        isActive: true,
      },
      select: { firstName: true, lastName: true, username: true },
    });

    if (!employee) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Reset-Link' });
    }

    res.json({ firstName: employee.firstName, lastName: employee.lastName, username: employee.username });
  } catch (error) {
    console.error('Validate reset token error:', error);
    res.status(500).json({ error: 'Fehler bei der Token-Validierung' });
  }
});

router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token und neues Passwort erforderlich' });
    }

    if (newPassword.length < 10) {
      return res.status(400).json({ error: 'Passwort muss mindestens 10 Zeichen haben' });
    }

    const employee = await prisma.employee.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
        isActive: true,
      },
    });

    if (!employee) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Reset-Link' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        passwordHash: newHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    await createAuditLog({
      req,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'PASSWORD_RESET',
      entityType: 'Employee',
      entityId: employee.id,
    });

    res.json({ message: 'Passwort erfolgreich zurückgesetzt' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Fehler beim Zurücksetzen des Passworts' });
  }
});

// Admin: Passwort-Reset-Link für einen Mitarbeiter senden
router.post('/admin-reset-password', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.employee!.isAdmin) {
      return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
    }

    const { employeeId } = req.body;
    if (!employeeId) {
      return res.status(400).json({ error: 'Mitarbeiter-ID erforderlich' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    if (!employee.email) {
      return res.status(400).json({ error: 'Mitarbeiter hat keine E-Mail-Adresse hinterlegt' });
    }

    // Reset-Token generieren
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 Stunden gültig

    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      },
    });

    const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

    try {
      await sendPasswordResetEmail(employee.email, employee.firstName, resetUrl);
    } catch (emailError) {
      console.error('Failed to send admin reset email:', emailError);
      return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden' });
    }

    await createAuditLog({
      req,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'ADMIN_PASSWORD_RESET',
      entityType: 'Employee',
      entityId: employee.id,
      note: `Passwort-Reset für ${employee.firstName} ${employee.lastName} ausgelöst`,
    });

    res.json({ message: `Reset-Link wurde an ${employee.email} gesendet` });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ error: 'Fehler beim Senden des Reset-Links' });
  }
});

export default router;
