import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Env, Variables } from '../bindings.js';
import { getBundeslandFromPLZ, extractPLZFromAddress, getGermanHolidays, BUNDESLAND_NAMES } from '../utils/germanHolidays.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const setupSchema = z.object({
  companyName: z.string().min(1, 'Firmenname erforderlich'),
  companyAddress: z.string().optional(),
  companyPhone: z.string().optional(),
  companyEmail: z.string().email().optional().or(z.literal('')),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFromAddress: z.string().optional(),
  smtpFromName: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  firstName: z.string().min(1, 'Vorname erforderlich'),
  lastName: z.string().min(1, 'Nachname erforderlich'),
  username: z.string().min(3, 'Benutzername muss mindestens 3 Zeichen haben'),
  email: z.string().email('Ungültige E-Mail').optional().or(z.literal('')),
  password: z.string().min(6, 'Passwort muss mindestens 6 Zeichen haben'),
});

const DEFAULT_ABSENCE_TYPES = [
  { name: 'Urlaub', shortName: 'Urlaub', requiredHours: 0, color: '#3B82F6', sortOrder: 0 },
  { name: 'Krank', shortName: 'Krank', requiredHours: 0, color: '#ff3333', sortOrder: 1 },
  { name: 'Berufschule ganzer Tag', shortName: 'Schule 1', requiredHours: 0, color: '#5ffb37', sortOrder: 2 },
  { name: 'Schule halber Tag', shortName: 'Schule 1/2', requiredHours: 4, color: '#bbb100', sortOrder: 3 },
  { name: 'Ü-frei', shortName: 'Ü-Frei', requiredHours: 8, color: '#39e6f9', sortOrder: 4 },
];

// Setup status (no auth)
app.get('/status', async (c) => {
  const prisma = c.get('prisma');
  try {
    const employeeCount = await prisma.employee.count();
    return c.json({ needsSetup: employeeCount === 0 });
  } catch {
    return c.json({ error: 'Fehler beim Prüfen des Setup-Status' }, 500);
  }
});

// Complete setup (no auth)
app.post('/complete', async (c) => {
  const prisma = c.get('prisma');
  try {
    const employeeCount = await prisma.employee.count();
    if (employeeCount > 0) return c.json({ error: 'Einrichtung bereits abgeschlossen' }, 400);

    const data = setupSchema.parse(await c.req.json());

    // 1. Settings
    const settingsData: any = {
      companyName: data.companyName,
      companyAddress: data.companyAddress || null,
      companyPhone: data.companyPhone || null,
      companyEmail: data.companyEmail || null,
    };
    if (data.smtpHost) {
      settingsData.smtpHost = data.smtpHost;
      settingsData.smtpPort = data.smtpPort || 587;
      settingsData.smtpUser = data.smtpUser || null;
      settingsData.smtpPassword = data.smtpPassword || null;
      settingsData.smtpFromAddress = data.smtpFromAddress || null;
      settingsData.smtpFromName = data.smtpFromName || 'Zeiterfassung';
      settingsData.smtpSecure = data.smtpSecure || false;
    }

    await prisma.settings.upsert({
      where: { id: 'default' },
      update: settingsData,
      create: { id: 'default', ...settingsData },
    });

    // 2. Admin account
    const passwordHash = await bcrypt.hash(data.password, 10);
    const admin = await prisma.employee.create({
      data: {
        employeeNumber: 'ADMIN',
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email || null,
        isAdmin: true,
        isActive: true,
        qrCode: crypto.randomUUID(),
        passwordHash,
      },
    });

    // 3. Default absence types
    const absenceCount = await prisma.absenceType.count();
    if (absenceCount === 0) {
      for (const at of DEFAULT_ABSENCE_TYPES) {
        await prisma.absenceType.create({ data: at });
      }
    }

    // 4. Holidays from PLZ
    if (data.companyAddress) {
      const plz = extractPLZFromAddress(data.companyAddress);
      if (plz) {
        const bundesland = getBundeslandFromPLZ(plz);
        if (bundesland) {
          const year = new Date().getFullYear();
          const holidays = getGermanHolidays(year, bundesland);
          for (const h of holidays) {
            await prisma.holiday.create({ data: { date: h.date, name: h.name, isRecurring: false } });
          }
        }
      }
    }

    // 5. Default terminal
    const terminalCount = await prisma.terminal.count();
    if (terminalCount === 0) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const terminalKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      await prisma.terminal.create({ data: { name: 'Standard-Terminal', apiKey: terminalKey } });
    }

    return c.json({
      success: true,
      message: 'Einrichtung erfolgreich abgeschlossen',
      admin: { username: admin.username, firstName: admin.firstName, lastName: admin.lastName },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return c.json({ error: error.errors[0].message }, 400);
    console.error('Setup error:', error);
    return c.json({ error: error.message || 'Fehler bei der Einrichtung' }, 500);
  }
});

export default app;
