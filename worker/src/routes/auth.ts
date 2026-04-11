import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { z } from 'zod';
import type { Env, Variables } from '../bindings.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLog.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const loginSchema = z.object({
  username: z.string().min(1, 'Benutzername erforderlich'),
  password: z.string().min(1, 'Passwort erforderlich'),
});

// Login
app.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { username, password } = loginSchema.parse(body);
    const prisma = c.get('prisma');

    const employee = await prisma.employee.findFirst({
      where: {
        OR: [{ username }, { employeeNumber: username }],
      },
    });

    if (!employee || !employee.passwordHash || !employee.isActive) {
      await createAuditLog({
        c, prisma,
        action: 'LOGIN_FAILED',
        entityType: 'Employee',
        note: `Fehlgeschlagener Login-Versuch für: ${username}`,
      });
      return c.json({ error: 'Ungültige Anmeldedaten' }, 401);
    }

    const isValid = await bcrypt.compare(password, employee.passwordHash);
    if (!isValid) {
      await createAuditLog({
        c, prisma,
        userId: employee.id,
        userName: `${employee.firstName} ${employee.lastName}`,
        action: 'LOGIN_FAILED',
        entityType: 'Employee',
        entityId: employee.id,
        note: 'Falsches Passwort',
      });
      return c.json({ error: 'Ungültige Anmeldedaten' }, 401);
    }

    // Check 2FA
    if (employee.totpEnabled) {
      const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'handy-insel-zeiterfassung-secret-key-2024');
      const tempToken = await new SignJWT({ id: employee.id, purpose: '2fa' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('5m')
        .sign(secret);

      await createAuditLog({
        c, prisma,
        userId: employee.id,
        userName: `${employee.firstName} ${employee.lastName}`,
        action: 'LOGIN',
        entityType: 'Employee',
        entityId: employee.id,
        note: '2FA erforderlich',
      });

      return c.json({ requires2FA: true, tempToken, methods: ['totp'] });
    }

    const token = await generateToken(employee, c);

    await createAuditLog({
      c, prisma,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'LOGIN',
      entityType: 'Employee',
      entityId: employee.id,
    });

    return c.json({
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
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Login error:', error);
    return c.json({ error: 'Anmeldung fehlgeschlagen' }, 500);
  }
});

// Aktueller Benutzer (auth required)
app.get('/me', authMiddleware, async (c) => {
  const prisma = c.get('prisma');
  const emp = c.get('employee');

  try {
    const employee = await prisma.employee.findUnique({
      where: { id: emp.id },
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

    return c.json({
      ...employee,
      passkeyCount: employee?._count?.passkeys || 0,
      _count: undefined,
    });
  } catch (error) {
    console.error('Get me error:', error);
    return c.json({ error: 'Fehler beim Laden der Benutzerdaten' }, 500);
  }
});

// Passwort ändern (auth required)
app.post('/change-password', authMiddleware, async (c) => {
  const prisma = c.get('prisma');
  const emp = c.get('employee');

  try {
    const { currentPassword, newPassword } = await c.req.json();

    if (!newPassword || newPassword.length < 6) {
      return c.json({ error: 'Neues Passwort muss mindestens 6 Zeichen haben' }, 400);
    }

    const employee = await prisma.employee.findUnique({ where: { id: emp.id } });
    if (!employee || !employee.passwordHash) {
      return c.json({ error: 'Passwort ändern nicht möglich' }, 400);
    }

    const isValid = await bcrypt.compare(currentPassword, employee.passwordHash);
    if (!isValid) {
      return c.json({ error: 'Aktuelles Passwort ist falsch' }, 401);
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.employee.update({
      where: { id: employee.id },
      data: { passwordHash: newHash },
    });

    await createAuditLog({
      c, prisma,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'PASSWORD_CHANGE',
      entityType: 'Employee',
      entityId: employee.id,
    });

    return c.json({ message: 'Passwort erfolgreich geändert' });
  } catch (error) {
    console.error('Change password error:', error);
    return c.json({ error: 'Passwort ändern fehlgeschlagen' }, 500);
  }
});

// Passwort vergessen
app.post('/forgot-password', async (c) => {
  try {
    const { email } = await c.req.json();
    const prisma = c.get('prisma');
    const successMessage = 'Falls ein Konto mit dieser E-Mail existiert, wurde ein Reset-Link gesendet.';

    if (!email) {
      return c.json({ error: 'E-Mail-Adresse erforderlich' }, 400);
    }

    const employee = await prisma.employee.findUnique({ where: { email } });
    if (!employee || !employee.isActive) {
      return c.json({ message: successMessage });
    }

    // Generate reset token using Web Crypto API
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const resetToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.employee.update({
      where: { id: employee.id },
      data: { passwordResetToken: resetToken, passwordResetExpires: resetExpires },
    });

    // TODO: Send email via API (Resend, Mailgun, etc.)
    // For now, just log the reset URL
    const frontendUrl = c.env.FRONTEND_URL || '';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    console.log(`Password reset URL for ${employee.email}: ${resetUrl}`);

    await createAuditLog({
      c, prisma,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'Employee',
      entityId: employee.id,
    });

    return c.json({ message: successMessage });
  } catch (error) {
    console.error('Forgot password error:', error);
    return c.json({ error: 'Fehler beim Zurücksetzen des Passworts' }, 500);
  }
});

// Token validieren
app.get('/reset-password/validate', async (c) => {
  try {
    const token = c.req.query('token');
    if (!token) return c.json({ error: 'Token erforderlich' }, 400);

    const prisma = c.get('prisma');
    const employee = await prisma.employee.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
        isActive: true,
      },
      select: { firstName: true, lastName: true, username: true },
    });

    if (!employee) {
      return c.json({ error: 'Ungültiger oder abgelaufener Reset-Link' }, 400);
    }

    return c.json(employee);
  } catch (error) {
    return c.json({ error: 'Fehler bei der Token-Validierung' }, 500);
  }
});

// Passwort zurücksetzen
app.post('/reset-password', async (c) => {
  try {
    const { token, newPassword } = await c.req.json();
    if (!token || !newPassword) return c.json({ error: 'Token und neues Passwort erforderlich' }, 400);
    if (newPassword.length < 6) return c.json({ error: 'Passwort muss mindestens 6 Zeichen haben' }, 400);

    const prisma = c.get('prisma');
    const employee = await prisma.employee.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpires: { gt: new Date() },
        isActive: true,
      },
    });

    if (!employee) return c.json({ error: 'Ungültiger oder abgelaufener Reset-Link' }, 400);

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.employee.update({
      where: { id: employee.id },
      data: { passwordHash: newHash, passwordResetToken: null, passwordResetExpires: null },
    });

    await createAuditLog({
      c, prisma,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'PASSWORD_RESET',
      entityType: 'Employee',
      entityId: employee.id,
    });

    return c.json({ message: 'Passwort erfolgreich zurückgesetzt' });
  } catch (error) {
    return c.json({ error: 'Fehler beim Zurücksetzen des Passworts' }, 500);
  }
});

// Admin: Reset-Link senden (auth required)
app.post('/admin-reset-password', authMiddleware, async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  try {
    const { employeeId } = await c.req.json();
    if (!employeeId) return c.json({ error: 'Mitarbeiter-ID erforderlich' }, 400);

    const prisma = c.get('prisma');
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    if (!employee.email) return c.json({ error: 'Mitarbeiter hat keine E-Mail-Adresse hinterlegt' }, 400);

    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const resetToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const resetExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.employee.update({
      where: { id: employee.id },
      data: { passwordResetToken: resetToken, passwordResetExpires: resetExpires },
    });

    // TODO: Send email via API
    const frontendUrl = c.env.FRONTEND_URL || '';
    console.log(`Admin reset URL for ${employee.email}: ${frontendUrl}/reset-password?token=${resetToken}`);

    await createAuditLog({
      c, prisma,
      userId: emp.id,
      userName: `${emp.firstName} ${emp.lastName}`,
      action: 'ADMIN_PASSWORD_RESET',
      entityType: 'Employee',
      entityId: employee.id,
      note: `Passwort-Reset für ${employee.firstName} ${employee.lastName} ausgelöst`,
    });

    return c.json({ message: `Reset-Link wurde an ${employee.email} gesendet` });
  } catch (error) {
    return c.json({ error: 'Fehler beim Senden des Reset-Links' }, 500);
  }
});

export default app;
