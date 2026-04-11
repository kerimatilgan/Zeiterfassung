import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../bindings.js';
import { createAuditLog } from '../utils/auditLog.js';
import {
  getGermanHolidays,
  getBundeslandFromPLZ,
  extractPLZFromAddress,
  BUNDESLAND_NAMES,
  type Bundesland,
} from '../utils/germanHolidays.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Einstellungen abrufen
app.get('/', async (c) => {
  const prisma = c.get('prisma');
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    return c.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    return c.json({ error: 'Fehler beim Laden der Einstellungen' }, 500);
  }
});

// Einstellungen aktualisieren (Admin)
app.put('/', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      companyName: z.string().min(1).optional(),
      companyAddress: z.string().optional().nullable(),
      companyPhone: z.string().optional().nullable(),
      companyEmail: z.string().email().optional().nullable(),
      defaultBreakMinutes: z.number().min(0).max(120).optional(),
      overtimeThreshold: z.number().min(0).max(168).optional(),
      pdfShowWorkCategory: z.boolean().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

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
      c,
      prisma,
      action: 'UPDATE',
      entityType: 'Settings',
      entityId: 'default',
      oldValues: oldSettings,
      newValues: settings,
    });

    return c.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Update settings error:', error);
    return c.json({ error: 'Fehler beim Speichern der Einstellungen' }, 500);
  }
});

// Feiertage abrufen
app.get('/holidays', async (c) => {
  const prisma = c.get('prisma');
  try {
    const year = c.req.query('year');

    const where: any = {};
    if (year) {
      const startOfYear = new Date(parseInt(year), 0, 1);
      const endOfYear = new Date(parseInt(year), 11, 31, 23, 59, 59);
      where.date = { gte: startOfYear, lte: endOfYear };
    }

    const holidays = await prisma.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
    });

    return c.json(holidays);
  } catch (error) {
    console.error('Get holidays error:', error);
    return c.json({ error: 'Fehler beim Laden der Feiertage' }, 500);
  }
});

// Feiertag hinzufügen (Admin)
app.post('/holidays', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      date: z.string().datetime(),
      name: z.string().min(1),
      isRecurring: z.boolean().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const holiday = await prisma.holiday.create({
      data: {
        date: new Date(data.date),
        name: data.name,
        isRecurring: data.isRecurring ?? false,
      },
    });

    return c.json(holiday, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create holiday error:', error);
    return c.json({ error: 'Fehler beim Erstellen des Feiertags' }, 500);
  }
});

// Feiertag löschen (Admin)
app.delete('/holidays/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    await prisma.holiday.delete({ where: { id } });

    return c.json({ message: 'Feiertag gelöscht' });
  } catch (error) {
    console.error('Delete holiday error:', error);
    return c.json({ error: 'Fehler beim Löschen des Feiertags' }, 500);
  }
});

// Feiertage automatisch generieren (Admin)
app.post('/holidays/generate', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      year: z.number().min(2020).max(2100),
      bundesland: z.string().optional(), // Optional: Direkt angeben statt aus PLZ
      deleteExisting: z.boolean().optional(), // Bestehende Feiertage des Jahres löschen
    });

    const body = await c.req.json();
    const data = schema.parse(body);
    const year = data.year;

    let bundesland: Bundesland | null = data.bundesland as Bundesland | null;

    // Wenn kein Bundesland angegeben, aus Firmenadresse ermitteln
    if (!bundesland) {
      const settings = await prisma.settings.findUnique({
        where: { id: 'default' },
      });

      if (!settings?.companyAddress) {
        return c.json({
          error: 'Keine Firmenadresse hinterlegt. Bitte zuerst eine Adresse mit PLZ eingeben oder Bundesland direkt angeben.',
        }, 400);
      }

      const plz = extractPLZFromAddress(settings.companyAddress);
      if (!plz) {
        return c.json({
          error: 'Keine gültige PLZ in der Firmenadresse gefunden. Bitte Adresse im Format "Straße, PLZ Ort" eingeben.',
        }, 400);
      }

      bundesland = getBundeslandFromPLZ(plz);
      if (!bundesland) {
        return c.json({
          error: `PLZ ${plz} konnte keinem Bundesland zugeordnet werden. Bitte Bundesland direkt angeben.`,
        }, 400);
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

    return c.json({
      message: `${created} Feiertage für ${year} erstellt (${skipped} übersprungen)`,
      bundesland,
      bundeslandName: BUNDESLAND_NAMES[bundesland],
      year,
      created,
      skipped,
      total: holidays.length,
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Generate holidays error:', error);
    return c.json({ error: 'Fehler beim Generieren der Feiertage' }, 500);
  }
});

// Bundesland Info abrufen (für UI)
app.get('/holidays/bundesland-info', async (c) => {
  const prisma = c.get('prisma');
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    if (!settings?.companyAddress) {
      return c.json({
        detected: false,
        message: 'Keine Firmenadresse hinterlegt',
      });
    }

    const plz = extractPLZFromAddress(settings.companyAddress);
    if (!plz) {
      return c.json({
        detected: false,
        plz: null,
        message: 'Keine PLZ in der Adresse gefunden',
      });
    }

    const bundesland = getBundeslandFromPLZ(plz);
    if (!bundesland) {
      return c.json({
        detected: false,
        plz,
        message: `PLZ ${plz} konnte keinem Bundesland zugeordnet werden`,
      });
    }

    return c.json({
      detected: true,
      plz,
      bundesland,
      bundeslandName: BUNDESLAND_NAMES[bundesland],
    });
  } catch (error) {
    console.error('Get bundesland info error:', error);
    return c.json({ error: 'Fehler beim Ermitteln des Bundeslandes' }, 500);
  }
});

// Alle Bundesländer abrufen (für Dropdown)
app.get('/holidays/bundeslaender', async (c) => {
  return c.json(
    Object.entries(BUNDESLAND_NAMES).map(([code, name]) => ({
      code,
      name,
    }))
  );
});

// ==================== ABWESENHEITSTYPEN ====================

// Abwesenheitstypen abrufen
app.get('/absence-types', async (c) => {
  const prisma = c.get('prisma');
  try {
    const absenceTypes = await prisma.absenceType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return c.json(absenceTypes);
  } catch (error) {
    console.error('Get absence types error:', error);
    return c.json({ error: 'Fehler beim Laden der Abwesenheitstypen' }, 500);
  }
});

// Alle Abwesenheitstypen abrufen (inkl. inaktive, für Admin)
app.get('/absence-types/all', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const absenceTypes = await prisma.absenceType.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return c.json(absenceTypes);
  } catch (error) {
    console.error('Get all absence types error:', error);
    return c.json({ error: 'Fehler beim Laden der Abwesenheitstypen' }, 500);
  }
});

// Abwesenheitstyp erstellen (Admin)
app.post('/absence-types', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      name: z.string().min(1),
      shortName: z.string().min(1).max(10),
      requiredHours: z.number().min(0).max(24),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      countsAsVacation: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const absenceType = await prisma.absenceType.create({
      data: {
        name: data.name,
        shortName: data.shortName,
        requiredHours: data.requiredHours,
        color: data.color,
        countsAsVacation: data.countsAsVacation ?? false,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    return c.json(absenceType, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create absence type error:', error);
    return c.json({ error: 'Fehler beim Erstellen des Abwesenheitstyps' }, 500);
  }
});

// Abwesenheitstyp aktualisieren (Admin)
app.put('/absence-types/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    const schema = z.object({
      name: z.string().min(1).optional(),
      shortName: z.string().min(1).max(10).optional(),
      requiredHours: z.number().min(0).max(24).optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      countsAsVacation: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const absenceType = await prisma.absenceType.update({
      where: { id },
      data,
    });

    return c.json(absenceType);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Update absence type error:', error);
    return c.json({ error: 'Fehler beim Aktualisieren des Abwesenheitstyps' }, 500);
  }
});

// Abwesenheitstyp löschen (Admin)
app.delete('/absence-types/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    // Prüfen ob noch Abwesenheiten mit diesem Typ existieren
    const existingAbsences = await prisma.employeeAbsence.count({
      where: { absenceTypeId: id },
    });

    if (existingAbsences > 0) {
      return c.json({
        error: `Kann nicht löschen: ${existingAbsences} Abwesenheiten verwenden diesen Typ. Bitte erst deaktivieren statt löschen.`,
      }, 400);
    }

    await prisma.absenceType.delete({ where: { id } });

    return c.json({ message: 'Abwesenheitstyp gelöscht' });
  } catch (error) {
    console.error('Delete absence type error:', error);
    return c.json({ error: 'Fehler beim Löschen des Abwesenheitstyps' }, 500);
  }
});

// ==================== MITARBEITER-ABWESENHEITEN ====================

// Abwesenheiten für einen Mitarbeiter abrufen
app.get('/absences', async (c) => {
  const prisma = c.get('prisma');
  try {
    const employeeId = c.req.query('employeeId');
    const from = c.req.query('from');
    const to = c.req.query('to');

    const where: any = {};

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (from || to) {
      where.date = {};
      if (from) {
        where.date.gte = new Date(from);
      }
      if (to) {
        where.date.lte = new Date(to);
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

    return c.json(absences);
  } catch (error) {
    console.error('Get absences error:', error);
    return c.json({ error: 'Fehler beim Laden der Abwesenheiten' }, 500);
  }
});

// Abwesenheit erstellen (Admin)
app.post('/absences', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      employeeId: z.string().uuid(),
      absenceTypeId: z.string().uuid(),
      date: z.string(),
      note: z.string().optional().nullable(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

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
      return c.json({ error: 'Für diesen Tag existiert bereits eine Abwesenheit' }, 400);
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

    return c.json(absence, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create absence error:', error);
    return c.json({ error: 'Fehler beim Erstellen der Abwesenheit' }, 500);
  }
});

// Bulk-Abwesenheiten erstellen (Admin) - für Multi-Tag-Auswahl
app.post('/absences/bulk', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      employeeId: z.string().uuid(),
      absenceTypeId: z.string().uuid(),
      dates: z.array(z.string()),
      note: z.string().optional().nullable(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    let created = 0;
    for (const dateStr of data.dates) {
      const date = new Date(dateStr);
      // Bestehende überspringen
      const existing = await prisma.employeeAbsence.findUnique({
        where: { employeeId_date: { employeeId: data.employeeId, date } },
      });
      if (existing) continue;

      await prisma.employeeAbsence.create({
        data: { employeeId: data.employeeId, absenceTypeId: data.absenceTypeId, date, note: data.note || null },
      });
      created++;
    }

    return c.json({ created, total: data.dates.length }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return c.json({ error: error.errors[0].message }, 400);
    return c.json({ error: 'Fehler beim Erstellen' }, 500);
  }
});

// Bulk-Abwesenheiten löschen (Admin)
app.post('/absences/bulk-delete', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const body = await c.req.json();
    const { ids } = body;
    if (!Array.isArray(ids)) return c.json({ error: 'IDs erforderlich' }, 400);
    const result = await prisma.employeeAbsence.deleteMany({ where: { id: { in: ids } } });
    return c.json({ deleted: result.count });
  } catch (error) {
    return c.json({ error: 'Fehler beim Löschen' }, 500);
  }
});

// Abwesenheit aktualisieren (Admin)
app.put('/absences/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    const schema = z.object({
      absenceTypeId: z.string().uuid().optional(),
      note: z.string().optional().nullable(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const absence = await prisma.employeeAbsence.update({
      where: { id },
      data,
      include: {
        absenceType: true,
      },
    });

    return c.json(absence);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Update absence error:', error);
    return c.json({ error: 'Fehler beim Aktualisieren der Abwesenheit' }, 500);
  }
});

// Abwesenheit löschen (Admin)
app.delete('/absences/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    const existing = await prisma.employeeAbsence.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ message: 'Bereits gelöscht' });
    }

    await prisma.employeeAbsence.delete({ where: { id } });

    return c.json({ message: 'Abwesenheit gelöscht' });
  } catch (error) {
    console.error('Delete absence error:', error);
    return c.json({ error: 'Fehler beim Löschen der Abwesenheit' }, 500);
  }
});

// Dashboard-Statistiken (Admin)
app.get('/dashboard-stats', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
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

    return c.json({
      activeEmployees,
      currentlyClockedIn,
      entriesToday,
      entriesThisMonth,
      pendingReports,
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return c.json({ error: 'Fehler beim Laden der Statistiken' }, 500);
  }
});

// Aktuell eingestempelte Mitarbeiter (Admin)
app.get('/currently-clocked-in', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const entries = await prisma.timeEntry.findMany({
      where: { clockOut: null },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNumber: true, photoUrl: true },
        },
      },
      orderBy: { clockIn: 'desc' },
    });
    return c.json(entries);
  } catch (error) {
    console.error('Get currently clocked in error:', error);
    return c.json({ error: 'Fehler beim Laden' }, 500);
  }
});

// Einträge heute (Admin)
app.get('/entries-today', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const entries = await prisma.timeEntry.findMany({
      where: { clockIn: { gte: startOfDay } },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNumber: true, photoUrl: true },
        },
      },
      orderBy: { clockIn: 'desc' },
    });
    return c.json(entries);
  } catch (error) {
    console.error('Get entries today error:', error);
    return c.json({ error: 'Fehler beim Laden' }, 500);
  }
});

// ==================== DATEN-IMPORT ====================

// Aktuelle Startsalden aller Mitarbeiter abrufen
app.get('/initial-balances', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const employees = await prisma.employee.findMany({
      where: { isActive: true, isAdmin: false },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        initialOvertimeBalance: true,
        initialVacationDaysUsed: true,
        initialSickDays: true,
        initialBalanceYear: true,
        initialBalanceMonth: true,
      },
      orderBy: { lastName: 'asc' },
    });
    return c.json(employees);
  } catch (error) {
    console.error('Get initial balances error:', error);
    return c.json({ error: 'Fehler beim Laden' }, 500);
  }
});

// Startsaldo für einen Mitarbeiter setzen
app.put('/initial-balances/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');
    const schema = z.object({
      initialOvertimeBalance: z.number(),
      initialVacationDaysUsed: z.number().int().min(0),
      initialSickDays: z.number().int().min(0),
      initialBalanceYear: z.number().int().min(2020).max(2030),
      initialBalanceMonth: z.number().int().min(1).max(12),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const employee = await prisma.employee.update({
      where: { id },
      data,
      select: {
        id: true, employeeNumber: true, firstName: true, lastName: true,
        initialOvertimeBalance: true, initialVacationDaysUsed: true, initialSickDays: true,
        initialBalanceYear: true, initialBalanceMonth: true,
      },
    });

    await createAuditLog({
      c,
      prisma,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: id,
      newValues: {
        initialOvertimeBalance: data.initialOvertimeBalance,
        initialVacationDaysUsed: data.initialVacationDaysUsed,
        initialSickDays: data.initialSickDays,
        stichtag: `${data.initialBalanceMonth}/${data.initialBalanceYear}`,
      },
      note: `Startsalden importiert für ${employee.firstName} ${employee.lastName}`,
    });

    return c.json(employee);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Set initial balance error:', error);
    return c.json({ error: 'Fehler beim Speichern' }, 500);
  }
});

// CSV-Import für Startsalden
app.post('/initial-balances/import-csv', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const body = await c.req.json();
    const { entries } = body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return c.json({ error: 'Keine Daten zum Importieren' }, 400);
    }

    const results: any[] = [];
    const errors: string[] = [];

    for (const entry of entries) {
      const { employeeNumber, overtimeBalance, vacationDaysUsed, sickDays, year, month } = entry;

      if (!employeeNumber) {
        errors.push(`Zeile ohne Mitarbeiternummer übersprungen`);
        continue;
      }

      const employee = await prisma.employee.findUnique({
        where: { employeeNumber: String(employeeNumber) },
      });

      if (!employee) {
        errors.push(`Mitarbeiter #${employeeNumber} nicht gefunden`);
        continue;
      }

      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          initialOvertimeBalance: parseFloat(String(overtimeBalance).replace(',', '.')) || 0,
          initialVacationDaysUsed: parseInt(vacationDaysUsed) || 0,
          initialSickDays: parseInt(sickDays) || 0,
          initialBalanceYear: parseInt(year) || new Date().getFullYear(),
          initialBalanceMonth: parseInt(month) || new Date().getMonth() + 1,
        },
      });

      results.push({ employeeNumber, name: `${employee.firstName} ${employee.lastName}`, status: 'ok' });
    }

    await createAuditLog({
      c,
      prisma,
      action: 'UPDATE',
      entityType: 'Employee',
      newValues: { importiert: results.length, fehler: errors.length },
      note: `CSV-Import: ${results.length} Startsalden importiert, ${errors.length} Fehler`,
    });

    return c.json({ imported: results.length, errors, results });
  } catch (error) {
    console.error('CSV import error:', error);
    return c.json({ error: 'Fehler beim Import' }, 500);
  }
});

// ==================== PWA-STEMPEL-GRÜNDE ====================

// Alle Gründe abrufen (Admin)
app.get('/pwa-reasons', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const reasons = await prisma.pwaClockReason.findMany({ orderBy: { sortOrder: 'asc' } });
    return c.json(reasons);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden' }, 500);
  }
});

// Neuen Grund erstellen
app.post('/pwa-reasons', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const body = await c.req.json();
    const { name } = body;
    if (!name) return c.json({ error: 'Name erforderlich' }, 400);
    const count = await prisma.pwaClockReason.count();
    const reason = await prisma.pwaClockReason.create({
      data: { name, sortOrder: count },
    });
    return c.json(reason, 201);
  } catch (error) {
    return c.json({ error: 'Fehler beim Erstellen' }, 500);
  }
});

// Grund aktualisieren
app.put('/pwa-reasons/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const body = await c.req.json();
    const { name, isActive, sortOrder } = body;
    const id = c.req.param('id');
    const reason = await prisma.pwaClockReason.update({
      where: { id },
      data: { ...(name !== undefined && { name }), ...(isActive !== undefined && { isActive }), ...(sortOrder !== undefined && { sortOrder }) },
    });
    return c.json(reason);
  } catch (error) {
    return c.json({ error: 'Fehler beim Aktualisieren' }, 500);
  }
});

// Grund löschen
app.delete('/pwa-reasons/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');
    await prisma.pwaClockReason.delete({ where: { id } });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: 'Fehler beim Löschen' }, 500);
  }
});

// ==================== DOKUMENTTYPEN ====================

// Aktive Dokumenttypen abrufen
app.get('/document-types', async (c) => {
  const prisma = c.get('prisma');
  try {
    const types = await prisma.documentType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return c.json(types);
  } catch (error) {
    console.error('Get document types error:', error);
    return c.json({ error: 'Fehler beim Laden der Dokumenttypen' }, 500);
  }
});

// Alle Dokumenttypen (inkl. inaktive, Admin)
app.get('/document-types/all', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const types = await prisma.documentType.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return c.json(types);
  } catch (error) {
    console.error('Get all document types error:', error);
    return c.json({ error: 'Fehler beim Laden der Dokumenttypen' }, 500);
  }
});

// Dokumenttyp erstellen (Admin)
app.post('/document-types', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      name: z.string().min(1),
      shortName: z.string().min(1).max(10),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const docType = await prisma.documentType.create({
      data: {
        name: data.name,
        shortName: data.shortName,
        color: data.color,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    await createAuditLog({
      c,
      prisma,
      action: 'CREATE',
      entityType: 'DocumentType',
      entityId: docType.id,
      newValues: { name: data.name, shortName: data.shortName },
    });

    return c.json(docType, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create document type error:', error);
    return c.json({ error: 'Fehler beim Erstellen des Dokumenttyps' }, 500);
  }
});

// Dokumenttyp aktualisieren (Admin)
app.put('/document-types/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');
    const schema = z.object({
      name: z.string().min(1).optional(),
      shortName: z.string().min(1).max(10).optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);
    const docType = await prisma.documentType.update({ where: { id }, data });

    return c.json(docType);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Update document type error:', error);
    return c.json({ error: 'Fehler beim Aktualisieren des Dokumenttyps' }, 500);
  }
});

// Dokumenttyp löschen (Admin)
app.delete('/document-types/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    const existingDocs = await prisma.document.count({ where: { documentTypeId: id } });
    if (existingDocs > 0) {
      return c.json({
        error: `Kann nicht löschen: ${existingDocs} Dokumente verwenden diesen Typ. Bitte erst deaktivieren.`,
      }, 400);
    }

    await prisma.documentType.delete({ where: { id } });
    return c.json({ message: 'Dokumenttyp gelöscht' });
  } catch (error) {
    console.error('Delete document type error:', error);
    return c.json({ error: 'Fehler beim Löschen des Dokumenttyps' }, 500);
  }
});

// ==================== TERMINAL-LOGO ====================

// Logo hochladen (Admin)
// TODO: Implement logo upload using R2 storage (c.env.UPLOADS bucket)
// The Express version used multer + filesystem; for Workers, accept the file from
// a multipart form, store it in R2 under "logos/terminal-logo.<ext>", and return the URL.
app.post('/terminal-logo', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const formData = await c.req.formData();
    const file = formData.get('logo') as File | null;

    if (!file) {
      return c.json({ error: 'Keine Datei hochgeladen' }, 400);
    }

    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      return c.json({ error: 'Nur PNG, JPG, WebP oder SVG erlaubt' }, 400);
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: 'Datei zu groß (max. 5MB)' }, 400);
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
    const r2Key = `logos/terminal-logo.${ext}`;

    // Delete old logos from R2
    const existingList = await c.env.UPLOADS.list({ prefix: 'logos/terminal-logo' });
    for (const obj of existingList.objects) {
      if (obj.key !== r2Key) {
        await c.env.UPLOADS.delete(obj.key);
      }
    }

    // Upload new logo to R2
    const arrayBuffer = await file.arrayBuffer();
    await c.env.UPLOADS.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType: file.type },
    });

    const logoUrl = `/uploads/${r2Key}`;

    await createAuditLog({
      c,
      prisma,
      action: 'UPDATE',
      entityType: 'Terminal',
      note: `Terminal-Logo hochgeladen: ${file.name}`,
    });

    return c.json({ success: true, logoUrl });
  } catch (error) {
    console.error('Upload terminal logo error:', error);
    return c.json({ error: 'Fehler beim Hochladen' }, 500);
  }
});

// Logo abrufen (Terminal - API Key oder Admin)
app.get('/terminal-logo', async (c) => {
  try {
    const existingList = await c.env.UPLOADS.list({ prefix: 'logos/terminal-logo' });
    if (existingList.objects.length === 0) {
      return c.json({ logoUrl: null });
    }
    const key = existingList.objects[0].key;
    return c.json({ logoUrl: `/uploads/${key}` });
  } catch (error) {
    console.error('Get terminal logo error:', error);
    return c.json({ error: 'Fehler beim Laden' }, 500);
  }
});

// Logo löschen (Admin)
app.delete('/terminal-logo', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const existingList = await c.env.UPLOADS.list({ prefix: 'logos/terminal-logo' });
    for (const obj of existingList.objects) {
      await c.env.UPLOADS.delete(obj.key);
    }

    await createAuditLog({
      c,
      prisma,
      action: 'DELETE',
      entityType: 'Terminal',
      note: 'Terminal-Logo gelöscht',
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Delete terminal logo error:', error);
    return c.json({ error: 'Fehler beim Löschen' }, 500);
  }
});

// ==================== DATENBANK-VERWALTUNG ====================

// Datenbank-Info abrufen (Admin)
// Note: In Cloudflare Workers with D1, there is no filesystem-based DB.
// We return table counts only; size info is not available for D1.
app.get('/database/info', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
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

    return c.json({
      exists: true,
      path: 'D1 Database',
      size: 0,
      sizeFormatted: 'N/A (D1)',
      lastModified: null,
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
    return c.json({ error: 'Fehler beim Laden der Datenbank-Informationen' }, 500);
  }
});

// Datenbank-Backup herunterladen (Admin)
// Note: D1 does not support file-based backup downloads.
// This endpoint returns an error indicating the feature is not available in Workers.
app.get('/database/backup', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  // TODO: Implement D1 backup export if Cloudflare provides an API for it.
  // For now, D1 backups should be managed through the Cloudflare dashboard or wrangler CLI.
  return c.json({
    error: 'Datenbank-Backup ist für D1-Datenbanken nicht über die API verfügbar. Bitte verwende das Cloudflare Dashboard oder wrangler CLI.',
  }, 501);
});

// Datenbank wiederherstellen (Admin)
// Note: D1 does not support file-based restore.
app.post('/database/restore', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  // TODO: Implement D1 restore if Cloudflare provides an API for it.
  return c.json({
    error: 'Datenbank-Wiederherstellung ist für D1-Datenbanken nicht über die API verfügbar. Bitte verwende das Cloudflare Dashboard oder wrangler CLI.',
  }, 501);
});

// ==================== MAIL-SERVER EINSTELLUNGEN ====================

// Mail-Einstellungen abrufen (Admin)
app.get('/mail', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
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
      return c.json({
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

    return c.json(maskedSettings);
  } catch (error) {
    console.error('Get mail settings error:', error);
    return c.json({ error: 'Fehler beim Laden der Mail-Einstellungen' }, 500);
  }
});

// Mail-Einstellungen aktualisieren (Admin)
app.put('/mail', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
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

    const body = await c.req.json();
    const data = schema.parse(body);

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
      c,
      prisma,
      action: 'UPDATE',
      entityType: 'MailSettings',
      entityId: 'default',
      oldValues: oldSettings ? { ...oldSettings, smtpPassword: oldSettings.smtpPassword ? '[REDACTED]' : null } : null,
      newValues: { ...settings, smtpPassword: settings.smtpPassword ? '[REDACTED]' : null },
    });

    // Passwort maskieren in Response
    return c.json({
      ...settings,
      smtpPassword: settings.smtpPassword ? '********' : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Update mail settings error:', error);
    return c.json({ error: 'Fehler beim Speichern der Mail-Einstellungen' }, 500);
  }
});

// Mail-Verbindung testen (Admin)
app.post('/mail/test', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      testEmail: z.string().email('Bitte gültige E-Mail-Adresse eingeben'),
    });

    const body = await c.req.json();
    const { testEmail } = schema.parse(body);

    // TODO: Implement API-based email sending for Cloudflare Workers
    // The Express version used nodemailer with SMTP. In Workers, use an email API
    // such as Cloudflare Email Workers, Resend, SendGrid, or Mailgun.
    // For now, return a not-implemented response.

    await createAuditLog({
      c,
      prisma,
      action: 'MAIL_TEST',
      entityType: 'MailSettings',
      newValues: { testEmail },
    });

    return c.json({
      error: 'E-Mail-Versand ist in der Workers-Umgebung noch nicht implementiert. Bitte verwende eine API-basierte E-Mail-Lösung (z.B. Resend, SendGrid).',
    }, 501);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Mail test error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Fehler beim Senden der Test-E-Mail',
    }, 500);
  }
});

// ==================== ARBEITSKATEGORIEN ====================

// Aktive Arbeitskategorien (für Dropdowns)
app.get('/work-categories', async (c) => {
  const prisma = c.get('prisma');
  try {
    const categories = await prisma.workCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return c.json(categories);
  } catch (error) {
    console.error('Get work categories error:', error);
    return c.json({ error: 'Fehler beim Laden der Arbeitskategorien' }, 500);
  }
});

// Alle Arbeitskategorien (Admin-Verwaltung)
app.get('/work-categories/all', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const categories = await prisma.workCategory.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return c.json(categories);
  } catch (error) {
    console.error('Get all work categories error:', error);
    return c.json({ error: 'Fehler beim Laden der Arbeitskategorien' }, 500);
  }
});

// Arbeitskategorie erstellen
app.post('/work-categories', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      name: z.string().min(1, 'Name erforderlich'),
      earliestClockIn: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format HH:mm erforderlich'),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const category = await prisma.workCategory.create({
      data: {
        name: data.name,
        earliestClockIn: data.earliestClockIn,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    await createAuditLog({
      c,
      prisma,
      action: 'CREATE',
      entityType: 'WorkCategory',
      entityId: category.id,
      newValues: { name: data.name, earliestClockIn: data.earliestClockIn },
    });

    return c.json(category, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Create work category error:', error);
    return c.json({ error: 'Fehler beim Erstellen der Arbeitskategorie' }, 500);
  }
});

// Arbeitskategorie bearbeiten
app.put('/work-categories/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');
    const schema = z.object({
      name: z.string().min(1).optional(),
      earliestClockIn: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const existing = await prisma.workCategory.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: 'Arbeitskategorie nicht gefunden' }, 404);
    }

    const category = await prisma.workCategory.update({
      where: { id },
      data,
    });

    await createAuditLog({
      c,
      prisma,
      action: 'UPDATE',
      entityType: 'WorkCategory',
      entityId: id,
      oldValues: { name: existing.name, earliestClockIn: existing.earliestClockIn },
      newValues: { name: category.name, earliestClockIn: category.earliestClockIn },
    });

    return c.json(category);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: error.errors[0].message }, 400);
    }
    console.error('Update work category error:', error);
    return c.json({ error: 'Fehler beim Aktualisieren der Arbeitskategorie' }, 500);
  }
});

// Arbeitskategorie löschen
app.delete('/work-categories/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    const existing = await prisma.workCategory.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: 'Arbeitskategorie nicht gefunden' }, 404);
    }

    const employeeCount = await prisma.employee.count({
      where: { workCategoryId: id },
    });

    if (employeeCount > 0) {
      return c.json({
        error: `Kann nicht löschen: ${employeeCount} Mitarbeiter verwenden diese Kategorie. Bitte erst deaktivieren oder Mitarbeiter umzuweisen.`,
      }, 400);
    }

    await prisma.workCategory.delete({ where: { id } });

    await createAuditLog({
      c,
      prisma,
      action: 'DELETE',
      entityType: 'WorkCategory',
      entityId: id,
      oldValues: { name: existing.name, earliestClockIn: existing.earliestClockIn },
    });

    return c.json({ message: 'Arbeitskategorie gelöscht' });
  } catch (error) {
    console.error('Delete work category error:', error);
    return c.json({ error: 'Fehler beim Löschen der Arbeitskategorie' }, 500);
  }
});

// ==================== TERMINALS ====================

const TERMINAL_ONLINE_THRESHOLD_SECONDS = 90;

// Alle Terminals (Admin-Verwaltung)
app.get('/terminals', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const terminals = await prisma.terminal.findMany({
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    const result = terminals.map((t: any) => ({
      id: t.id,
      name: t.name,
      isActive: t.isActive,
      lastSeen: t.lastSeen,
      ipAddress: t.ipAddress,
      version: t.version,
      isOnline: t.lastSeen
        ? (now.getTime() - new Date(t.lastSeen).getTime()) / 1000 < TERMINAL_ONLINE_THRESHOLD_SECONDS
        : false,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));

    return c.json(result);
  } catch (error) {
    console.error('Get terminals error:', error);
    return c.json({ error: 'Fehler beim Laden der Terminals' }, 500);
  }
});

// Terminal erstellen
app.post('/terminals', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const schema = z.object({
      name: z.string().min(1, 'Name erforderlich'),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    // Use Web Crypto API instead of Node crypto
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const apiKey = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const terminal = await prisma.terminal.create({
      data: {
        name: data.name,
        apiKey,
      },
    });

    await createAuditLog({
      c,
      prisma,
      action: 'CREATE',
      entityType: 'Terminal',
      entityId: terminal.id,
      newValues: { name: terminal.name },
    });

    // API-Key wird einmalig im Klartext zurückgegeben
    return c.json({
      id: terminal.id,
      name: terminal.name,
      apiKey,
      isActive: terminal.isActive,
      createdAt: terminal.createdAt,
    }, 201);
  } catch (error) {
    console.error('Create terminal error:', error);
    return c.json({ error: 'Fehler beim Erstellen des Terminals' }, 500);
  }
});

// Terminal bearbeiten
app.put('/terminals/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');
    const schema = z.object({
      name: z.string().min(1, 'Name erforderlich').optional(),
      isActive: z.boolean().optional(),
    });

    const body = await c.req.json();
    const data = schema.parse(body);

    const existing = await prisma.terminal.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: 'Terminal nicht gefunden' }, 404);
    }

    const terminal = await prisma.terminal.update({
      where: { id },
      data,
    });

    await createAuditLog({
      c,
      prisma,
      action: 'UPDATE',
      entityType: 'Terminal',
      entityId: id,
      oldValues: { name: existing.name, isActive: existing.isActive },
      newValues: { name: terminal.name, isActive: terminal.isActive },
    });

    return c.json({
      id: terminal.id,
      name: terminal.name,
      isActive: terminal.isActive,
      lastSeen: terminal.lastSeen,
      ipAddress: terminal.ipAddress,
      version: terminal.version,
      createdAt: terminal.createdAt,
      updatedAt: terminal.updatedAt,
    });
  } catch (error) {
    console.error('Update terminal error:', error);
    return c.json({ error: 'Fehler beim Aktualisieren des Terminals' }, 500);
  }
});

// Terminal löschen
app.delete('/terminals/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    const existing = await prisma.terminal.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: 'Terminal nicht gefunden' }, 404);
    }

    await prisma.terminal.delete({ where: { id } });

    await createAuditLog({
      c,
      prisma,
      action: 'DELETE',
      entityType: 'Terminal',
      entityId: id,
      oldValues: { name: existing.name },
    });

    return c.json({ message: 'Terminal gelöscht' });
  } catch (error) {
    console.error('Delete terminal error:', error);
    return c.json({ error: 'Fehler beim Löschen des Terminals' }, 500);
  }
});

// Terminal API-Key regenerieren
app.post('/terminals/:id/regenerate-key', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');

    const existing = await prisma.terminal.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: 'Terminal nicht gefunden' }, 404);
    }

    // Use Web Crypto API instead of Node crypto
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const newApiKey = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    await prisma.terminal.update({
      where: { id },
      data: { apiKey: newApiKey },
    });

    await createAuditLog({
      c,
      prisma,
      action: 'UPDATE',
      entityType: 'Terminal',
      entityId: id,
      oldValues: { apiKeyRegenerated: true },
      newValues: { apiKeyRegenerated: true },
      note: `API-Key für Terminal "${existing.name}" wurde erneuert`,
    });

    return c.json({ apiKey: newApiKey });
  } catch (error) {
    console.error('Regenerate terminal key error:', error);
    return c.json({ error: 'Fehler beim Erneuern des API-Keys' }, 500);
  }
});

// Terminal Install-Script generieren
app.get('/terminals/:id/install-script', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  try {
    const id = c.req.param('id');
    const terminal = await prisma.terminal.findUnique({ where: { id } });
    if (!terminal) return c.json({ error: 'Terminal nicht gefunden' }, 404);

    const protocol = c.req.header('x-forwarded-proto') || 'https';
    const host = c.req.header('x-forwarded-host') || c.req.header('host');
    const backendUrl = `${protocol}://${host}`;
    const apiKey = terminal.apiKey;
    const terminalName = terminal.name;

    const script = `#!/bin/bash
#
# Zeiterfassung Terminal - Schnellinstallation
# Terminal: ${terminalName}
# Generiert am: ${new Date().toLocaleString('de-DE')}
#
set -e

echo "========================================"
echo "  Zeiterfassung Terminal Installation"
echo "  Terminal: ${terminalName}"
echo "========================================"
echo ""

# Konfiguration
BACKEND_URL="${backendUrl}"
API_KEY="${apiKey}"
INSTALL_DIR="$HOME/zeiterfassung-terminal"

# Prüfe ob Python3 installiert ist
if ! command -v python3 &> /dev/null; then
    echo "[1/6] Python3 installieren..."
    sudo apt-get update -qq
    sudo apt-get install -y python3 python3-pip python3-venv
else
    echo "[1/6] Python3 vorhanden ✓"
fi

# Verzeichnis erstellen
echo "[2/6] Verzeichnis erstellen..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Python-Abhängigkeiten installieren
echo "[3/6] Abhängigkeiten installieren..."
pip3 install --user requests evdev pygame python-socketio[client] websocket-client 2>/dev/null || \\
pip3 install requests evdev pygame python-socketio[client] websocket-client

# Optional: pyscard für ACR122U NFC Reader
pip3 install --user pyscard 2>/dev/null || echo "  pyscard nicht installiert (optional, für ACR122U)"

# Config erstellen
echo "[4/6] Konfiguration erstellen..."
cat > "$INSTALL_DIR/config.json" << CONF
{
  "backend_url": "$BACKEND_URL",
  "api_key": "$API_KEY",
  "display_enabled": false
}
CONF

# Terminal-Dateien herunterladen (vom Server)
echo "[5/6] Terminal-Software herunterladen..."
for file in terminal.py api_client.py offline_queue.py display.py hdmi_display.py notify_display.py; do
    if [ -f "$INSTALL_DIR/$file" ]; then
        echo "  $file bereits vorhanden, überspringe..."
    fi
done

# Verbindung testen
echo "[6/6] Verbindung testen..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
    echo "  Backend erreichbar ✓"
else
    echo "  ⚠ Backend nicht erreichbar (HTTP $HEALTH)"
    echo "  URL: $BACKEND_URL"
    echo "  Bitte prüfe die Netzwerkverbindung."
fi

# Systemd-Services erstellen
echo ""
echo "Systemd-Services einrichten..."

sudo tee /etc/systemd/system/zeiterfassung-terminal.service > /dev/null << SVC
[Unit]
Description=Zeiterfassung RFID Terminal
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/python3 $INSTALL_DIR/terminal.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

sudo tee /etc/systemd/system/zeiterfassung-display.service > /dev/null << SVC
[Unit]
Description=Zeiterfassung HDMI Display
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStartPre=/bin/sleep 10
ExecStart=/usr/bin/python3 $INSTALL_DIR/hdmi_display.py
Restart=always
RestartSec=5
Environment=DISPLAY=:0
Environment=SDL_VIDEODRIVER=x11

[Install]
WantedBy=multi-user.target
SVC

sudo systemctl daemon-reload
sudo systemctl enable zeiterfassung-terminal zeiterfassung-display

echo ""
echo "========================================"
echo "  Installation abgeschlossen!"
echo "========================================"
echo ""
echo "  Terminal:    ${terminalName}"
echo "  Backend:     $BACKEND_URL"
echo "  Verzeichnis: $INSTALL_DIR"
echo ""
echo "  Terminal-Dateien müssen noch in"
echo "  $INSTALL_DIR kopiert werden:"
echo "  - terminal.py"
echo "  - api_client.py"
echo "  - offline_queue.py"
echo "  - display.py"
echo "  - hdmi_display.py"
echo "  - notify_display.py"
echo ""
echo "  Dann starten mit:"
echo "    sudo systemctl start zeiterfassung-terminal"
echo "    sudo systemctl start zeiterfassung-display"
echo ""
echo "  Logs anzeigen:"
echo "    journalctl -u zeiterfassung-terminal -f"
echo ""
`;

    return new Response(script, {
      headers: {
        'Content-Type': 'application/x-shellscript',
        'Content-Disposition': `attachment; filename="install-terminal-${terminalName.replace(/[^a-zA-Z0-9]/g, '_')}.sh"`,
      },
    });
  } catch (error) {
    return c.json({ error: 'Fehler beim Generieren des Scripts' }, 500);
  }
});

export default app;
