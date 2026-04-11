import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Env, Variables } from '../bindings.js';
import { createAuditLog } from '../utils/auditLog.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const employeeSchema = z.object({
  employeeNumber: z.string().min(1, 'Mitarbeiternummer erforderlich'),
  username: z.string().min(3).regex(/^[a-zA-Z0-9._-]+$/).optional().nullable(),
  firstName: z.string().min(1, 'Vorname erforderlich'),
  lastName: z.string().min(1, 'Nachname erforderlich'),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  weeklyHours: z.number().min(0).max(168).optional(),
  vacationDaysPerYear: z.number().int().min(0).max(365).optional(),
  workDays: z.string().optional(),
  isAdmin: z.boolean().optional(),
  password: z.string().min(6).optional(),
  workCategoryId: z.string().uuid().optional().nullable(),
  canClockInPwa: z.boolean().optional(),
  canClockOutPwa: z.boolean().optional(),
  defaultClockOut: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

// Alle Mitarbeiter (Admin)
app.get('/', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const employees = await prisma.employee.findMany({
      select: {
        id: true, employeeNumber: true, username: true, firstName: true, lastName: true,
        email: true, phone: true, photoUrl: true, weeklyHours: true, vacationDaysPerYear: true,
        workDays: true, isActive: true, isAdmin: true, qrCode: true, rfidCard: true,
        workCategoryId: true,
        workCategory: { select: { id: true, name: true, earliestClockIn: true } },
        canClockInPwa: true, canClockOutPwa: true, defaultClockOut: true,
        startDate: true, endDate: true, carryOverVacationDays: true,
        initialOvertimeBalance: true, initialVacationDaysUsed: true,
        initialSickDays: true, initialBalanceYear: true, initialBalanceMonth: true,
        createdAt: true,
      },
      orderBy: { lastName: 'asc' },
    });
    return c.json(employees);
  } catch (error) {
    console.error('Get employees error:', error);
    return c.json({ error: 'Fehler beim Laden der Mitarbeiter' }, 500);
  }
});

// Einzelnen Mitarbeiter
app.get('/:id', async (c) => {
  const emp = c.get('employee');
  const id = c.req.param('id');
  if (!emp.isAdmin && emp.id !== id) return c.json({ error: 'Keine Berechtigung' }, 403);

  const prisma = c.get('prisma');
  try {
    const employee = await prisma.employee.findUnique({
      where: { id },
      select: {
        id: true, employeeNumber: true, username: true, firstName: true, lastName: true,
        email: true, phone: true, photoUrl: true, weeklyHours: true, vacationDaysPerYear: true,
        workDays: true, isActive: true, isAdmin: true, qrCode: true, rfidCard: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    return c.json(employee);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden des Mitarbeiters' }, 500);
  }
});

// Neuer Mitarbeiter (Admin)
app.post('/', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const data = employeeSchema.parse(await c.req.json());

    const existing = await prisma.employee.findUnique({ where: { employeeNumber: data.employeeNumber } });
    if (existing) return c.json({ error: 'Mitarbeiternummer bereits vergeben' }, 400);

    if (data.username) {
      const usernameExists = await prisma.employee.findUnique({ where: { username: data.username } });
      if (usernameExists) return c.json({ error: 'Benutzername bereits vergeben' }, 400);
    }

    // Generate QR code and UUID
    const uuid = crypto.randomUUID();
    const qrCode = `HI-${data.employeeNumber}-${uuid.substring(0, 8)}`;

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
        id: true, employeeNumber: true, username: true, firstName: true, lastName: true,
        email: true, phone: true, photoUrl: true, weeklyHours: true, vacationDaysPerYear: true,
        workDays: true, isActive: true, isAdmin: true, qrCode: true,
        workCategoryId: true,
        workCategory: { select: { id: true, name: true, earliestClockIn: true } },
        canClockInPwa: true, canClockOutPwa: true, defaultClockOut: true,
        startDate: true, endDate: true, carryOverVacationDays: true, createdAt: true,
      },
    });

    await createAuditLog({
      c, prisma,
      action: 'CREATE',
      entityType: 'Employee',
      entityId: employee.id,
      newValues: {
        employeeNumber: employee.employeeNumber,
        firstName: employee.firstName,
        lastName: employee.lastName,
      },
    });

    return c.json(employee, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: error.errors[0].message }, 400);
    console.error('Create employee error:', error);
    return c.json({ error: 'Fehler beim Anlegen des Mitarbeiters' }, 500);
  }
});

// Mitarbeiter aktualisieren (Admin)
app.put('/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');

  try {
    const data = employeeSchema.partial().parse(await c.req.json());
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);

    if (data.username !== undefined && data.username !== existing.username && data.username) {
      const conflict = await prisma.employee.findUnique({ where: { username: data.username } });
      if (conflict) return c.json({ error: 'Benutzername bereits vergeben' }, 400);
    }

    if (data.employeeNumber && data.employeeNumber !== existing.employeeNumber) {
      const conflict = await prisma.employee.findUnique({ where: { employeeNumber: data.employeeNumber } });
      if (conflict) return c.json({ error: 'Mitarbeiternummer bereits vergeben' }, 400);
    }

    if (existing.isAdmin && data.isAdmin === false) {
      const adminCount = await prisma.employee.count({ where: { isAdmin: true, isActive: true } });
      if (adminCount <= 1) return c.json({ error: 'Der letzte Administrator kann nicht herabgestuft werden' }, 400);
    }

    let passwordHash: string | undefined;
    if (data.password) {
      passwordHash = await bcrypt.hash(data.password, 10);
    }

    const oldValues = {
      employeeNumber: existing.employeeNumber, firstName: existing.firstName,
      lastName: existing.lastName, email: existing.email,
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
        id: true, employeeNumber: true, username: true, firstName: true, lastName: true,
        email: true, phone: true, photoUrl: true, weeklyHours: true, vacationDaysPerYear: true,
        workDays: true, isActive: true, isAdmin: true, qrCode: true,
        workCategoryId: true,
        workCategory: { select: { id: true, name: true, earliestClockIn: true } },
        canClockInPwa: true, canClockOutPwa: true, defaultClockOut: true,
        startDate: true, endDate: true, carryOverVacationDays: true,
        createdAt: true, updatedAt: true,
      },
    });

    await createAuditLog({ c, prisma, action: 'UPDATE', entityType: 'Employee', entityId: employee.id, oldValues });
    return c.json(employee);
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: error.errors[0].message }, 400);
    console.error('Update employee error:', error);
    return c.json({ error: 'Fehler beim Aktualisieren des Mitarbeiters' }, 500);
  }
});

// Mitarbeiter deaktivieren (Admin)
app.delete('/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');

  try {
    if (emp.id === id) return c.json({ error: 'Sie können sich nicht selbst deaktivieren' }, 400);

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);

    if (existing.isAdmin) {
      const adminCount = await prisma.employee.count({ where: { isAdmin: true, isActive: true } });
      if (adminCount <= 1) return c.json({ error: 'Der letzte Administrator kann nicht deaktiviert werden' }, 400);
    }

    await prisma.employee.update({ where: { id }, data: { isActive: false } });

    await createAuditLog({
      c, prisma,
      action: 'DELETE', entityType: 'Employee', entityId: id,
      oldValues: { isActive: true }, newValues: { isActive: false },
      note: 'Mitarbeiter deaktiviert (Soft Delete)',
    });

    return c.json({ message: 'Mitarbeiter deaktiviert' });
  } catch (error) {
    return c.json({ error: 'Fehler beim Löschen des Mitarbeiters' }, 500);
  }
});

// RFID registrieren
app.post('/:id/register-rfid', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');

  try {
    const { rfidCard } = await c.req.json();
    if (!rfidCard || typeof rfidCard !== 'string') return c.json({ error: 'RFID-Karten-ID erforderlich' }, 400);

    const trimmedRfid = rfidCard.trim().toUpperCase();
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);

    const existingRfid = await prisma.employee.findUnique({ where: { rfidCard: trimmedRfid } });
    if (existingRfid && existingRfid.id !== id) {
      return c.json({ error: `RFID-Karte bereits vergeben an ${existingRfid.firstName} ${existingRfid.lastName}` }, 400);
    }

    await prisma.employee.update({ where: { id }, data: { rfidCard: trimmedRfid } });

    await createAuditLog({
      c, prisma, action: 'UPDATE', entityType: 'Employee', entityId: id,
      oldValues: { rfidCard: employee.rfidCard }, newValues: { rfidCard: trimmedRfid },
      note: 'RFID-Karte registriert',
    });

    return c.json({ message: 'RFID-Karte erfolgreich registriert', rfidCard: trimmedRfid });
  } catch (error) {
    return c.json({ error: 'Fehler beim Registrieren der RFID-Karte' }, 500);
  }
});

// Foto hochladen (R2)
app.post('/:id/photo', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');

  try {
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);

    const formData = await c.req.formData();
    const file = formData.get('photo') as File | null;
    if (!file) return c.json({ error: 'Kein Foto hochgeladen' }, 400);

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Nur Bilder erlaubt (JPEG, PNG, GIF, WebP)' }, 400);
    }
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: 'Datei zu groß (max. 5MB)' }, 400);
    }

    // Delete old photo from R2
    if (employee.photoUrl) {
      const oldKey = employee.photoUrl.replace('/uploads/', '');
      await c.env.UPLOADS.delete(oldKey);
    }

    // Upload to R2
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const key = `photos/photo-${Date.now()}-${Math.round(Math.random() * 1E9)}.${ext}`;
    await c.env.UPLOADS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    const photoUrl = `/uploads/${key}`;
    await prisma.employee.update({ where: { id }, data: { photoUrl } });

    await createAuditLog({
      c, prisma, action: 'UPDATE', entityType: 'Employee', entityId: id,
      note: 'Foto hochgeladen',
    });

    return c.json({ message: 'Foto erfolgreich hochgeladen', photoUrl });
  } catch (error) {
    console.error('Upload photo error:', error);
    return c.json({ error: 'Fehler beim Hochladen des Fotos' }, 500);
  }
});

// Foto löschen
app.delete('/:id/photo', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');

  try {
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    if (!employee.photoUrl) return c.json({ error: 'Kein Foto vorhanden' }, 400);

    const key = employee.photoUrl.replace('/uploads/', '');
    await c.env.UPLOADS.delete(key);
    await prisma.employee.update({ where: { id }, data: { photoUrl: null } });

    await createAuditLog({
      c, prisma, action: 'UPDATE', entityType: 'Employee', entityId: id,
      note: 'Foto gelöscht',
    });

    return c.json({ message: 'Foto erfolgreich gelöscht' });
  } catch (error) {
    return c.json({ error: 'Fehler beim Löschen des Fotos' }, 500);
  }
});

// RFID entfernen
app.delete('/:id/rfid', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');

  try {
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    if (!employee.rfidCard) return c.json({ error: 'Keine RFID-Karte registriert' }, 400);

    const oldRfid = employee.rfidCard;
    await prisma.employee.update({ where: { id }, data: { rfidCard: null } });

    await createAuditLog({
      c, prisma, action: 'UPDATE', entityType: 'Employee', entityId: id,
      oldValues: { rfidCard: oldRfid }, newValues: { rfidCard: null },
      note: 'RFID-Karte entfernt',
    });

    return c.json({ message: 'RFID-Karte erfolgreich entfernt' });
  } catch (error) {
    return c.json({ error: 'Fehler beim Entfernen der RFID-Karte' }, 500);
  }
});

export default app;
