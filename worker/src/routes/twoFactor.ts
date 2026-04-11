import { Hono } from 'hono';
import { jwtVerify } from 'jose';
import type { Env, Variables } from '../bindings.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLog.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// TOTP Helper functions (Web Crypto API based)
// ============================================================

function base32Encode(buffer: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleanInput = input.replace(/[=\s]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of cleanInput) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function generateTOTP(secret: string, time?: number): Promise<string> {
  const counter = Math.floor((time || Date.now() / 1000) / 30);
  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setBigUint64(0, BigInt(counter));

  const keyData = base32Decode(secret);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, counterBytes);
  const hmac = new Uint8Array(sig);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (code % 1000000).toString().padStart(6, '0');
}

async function verifyTOTP(token: string, secret: string): Promise<boolean> {
  const now = Date.now() / 1000;
  // Check current and ±1 time step
  for (const offset of [0, -30, 30]) {
    const expected = await generateTOTP(secret, now + offset);
    if (expected === token) return true;
  }
  return false;
}

function generateSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function generateOtpauthUri(issuer: string, account: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Simple QR code as SVG (no external dependency)
// Uses a minimal QR encoder - for production, consider a proper QR library
async function generateQRDataUrl(text: string): Promise<string> {
  // Return the otpauth URI directly - frontend can use a QR library to render it
  // or we can use a simple approach with a data URL
  return text; // Frontend will handle QR rendering
}

// ============================================================
// TOTP ENDPOINTS
// ============================================================

// Setup TOTP (auth required)
app.post('/totp/setup', authMiddleware, async (c) => {
  const emp = c.get('employee');
  const prisma = c.get('prisma');

  try {
    const employee = await prisma.employee.findUnique({
      where: { id: emp.id },
      select: { id: true, firstName: true, lastName: true, email: true, totpEnabled: true },
    });
    if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
    if (employee.totpEnabled) return c.json({ error: '2FA ist bereits aktiviert' }, 400);

    const secret = generateSecret();
    await prisma.employee.update({ where: { id: employee.id }, data: { totpSecret: secret } });

    const accountName = employee.email || `${employee.firstName}.${employee.lastName}`;
    const otpauthUri = generateOtpauthUri('Zeiterfassung', accountName, secret);

    return c.json({ secret, otpauthUri });
  } catch (error) {
    console.error('TOTP setup error:', error);
    return c.json({ error: 'Fehler beim Einrichten von 2FA' }, 500);
  }
});

// Verify TOTP setup (auth required)
app.post('/totp/verify-setup', authMiddleware, async (c) => {
  const emp = c.get('employee');
  const prisma = c.get('prisma');

  try {
    const { code } = await c.req.json();
    if (!code) return c.json({ error: 'Code erforderlich' }, 400);

    const employee = await prisma.employee.findUnique({
      where: { id: emp.id },
      select: { id: true, firstName: true, lastName: true, totpSecret: true, totpEnabled: true },
    });
    if (!employee || !employee.totpSecret) return c.json({ error: 'Kein TOTP-Secret vorhanden' }, 400);
    if (employee.totpEnabled) return c.json({ error: '2FA ist bereits aktiviert' }, 400);

    const isValid = await verifyTOTP(code, employee.totpSecret);
    if (!isValid) return c.json({ error: 'Ungültiger Code. Bitte erneut versuchen.' }, 400);

    await prisma.employee.update({ where: { id: employee.id }, data: { totpEnabled: true } });

    await createAuditLog({
      c, prisma, userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'CREATE', entityType: 'Employee', entityId: employee.id,
      note: '2FA (TOTP) aktiviert',
    });

    return c.json({ message: '2FA erfolgreich aktiviert' });
  } catch (error) {
    return c.json({ error: 'Fehler beim Aktivieren von 2FA' }, 500);
  }
});

// Disable TOTP (auth required)
app.post('/totp/disable', authMiddleware, async (c) => {
  const emp = c.get('employee');
  const prisma = c.get('prisma');

  try {
    const { code } = await c.req.json();
    if (!code) return c.json({ error: 'Code erforderlich' }, 400);

    const employee = await prisma.employee.findUnique({
      where: { id: emp.id },
      select: { id: true, firstName: true, lastName: true, totpSecret: true, totpEnabled: true },
    });
    if (!employee || !employee.totpEnabled || !employee.totpSecret) {
      return c.json({ error: '2FA ist nicht aktiviert' }, 400);
    }

    const isValid = await verifyTOTP(code, employee.totpSecret);
    if (!isValid) return c.json({ error: 'Ungültiger Code' }, 400);

    await prisma.employee.update({ where: { id: employee.id }, data: { totpEnabled: false, totpSecret: null } });

    await createAuditLog({
      c, prisma, userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'DELETE', entityType: 'Employee', entityId: employee.id,
      note: '2FA (TOTP) deaktiviert',
    });

    return c.json({ message: '2FA deaktiviert' });
  } catch (error) {
    return c.json({ error: 'Fehler beim Deaktivieren von 2FA' }, 500);
  }
});

// Validate TOTP during login (no JWT - uses tempToken)
app.post('/totp/validate', async (c) => {
  const prisma = c.get('prisma');

  try {
    const { tempToken, code } = await c.req.json();
    if (!tempToken || !code) return c.json({ error: 'Token und Code erforderlich' }, 400);

    const secret = new TextEncoder().encode(c.env.JWT_SECRET || 'handy-insel-zeiterfassung-secret-key-2024');
    let decoded: { id: string; purpose: string };
    try {
      const result = await jwtVerify(tempToken, secret);
      decoded = result.payload as any;
    } catch {
      return c.json({ error: 'Ungültiges oder abgelaufenes Token' }, 401);
    }

    if (decoded.purpose !== '2fa') return c.json({ error: 'Ungültiges Token' }, 401);

    const employee = await prisma.employee.findUnique({ where: { id: decoded.id } });
    if (!employee || !employee.isActive || !employee.totpEnabled || !employee.totpSecret) {
      return c.json({ error: 'Ungültige Anfrage' }, 401);
    }

    const isValid = await verifyTOTP(code, employee.totpSecret);
    if (!isValid) return c.json({ error: 'Ungültiger Code' }, 401);

    const token = await generateToken(employee, c);

    await createAuditLog({
      c, prisma, userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'LOGIN', entityType: 'Employee', entityId: employee.id,
      note: 'Login mit 2FA',
    });

    return c.json({
      token,
      employee: {
        id: employee.id, employeeNumber: employee.employeeNumber, username: employee.username,
        firstName: employee.firstName, lastName: employee.lastName, email: employee.email,
        weeklyHours: employee.weeklyHours, vacationDaysPerYear: employee.vacationDaysPerYear,
        workDays: employee.workDays, isAdmin: employee.isAdmin,
      },
    });
  } catch (error) {
    return c.json({ error: 'Fehler bei der 2FA-Validierung' }, 500);
  }
});

// ============================================================
// PASSKEY ENDPOINTS (using KV for challenge store)
// ============================================================

// Note: Passkeys require @simplewebauthn/server which uses Node.js APIs.
// For Cloudflare Workers, we'd need a Workers-compatible WebAuthn library.
// For now, these endpoints return a "not available" message.
// TODO: Implement with a Workers-compatible WebAuthn library

app.post('/passkey/register-options', authMiddleware, async (c) => {
  return c.json({ error: 'Passkeys sind in der Cloudflare Workers Version noch nicht verfügbar' }, 501);
});

app.post('/passkey/register-verify', authMiddleware, async (c) => {
  return c.json({ error: 'Passkeys sind in der Cloudflare Workers Version noch nicht verfügbar' }, 501);
});

app.get('/passkey/list', authMiddleware, async (c) => {
  const prisma = c.get('prisma');
  const emp = c.get('employee');
  const passkeys = await prisma.passkey.findMany({
    where: { employeeId: emp.id },
    select: { id: true, deviceName: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return c.json(passkeys);
});

app.delete('/passkey/:id', authMiddleware, async (c) => {
  const prisma = c.get('prisma');
  const emp = c.get('employee');
  const id = c.req.param('id');

  const passkey = await prisma.passkey.findUnique({ where: { id } });
  if (!passkey || passkey.employeeId !== emp.id) return c.json({ error: 'Passkey nicht gefunden' }, 404);

  await prisma.passkey.delete({ where: { id } });
  return c.json({ message: 'Passkey gelöscht' });
});

app.post('/passkey/auth-options', async (c) => {
  return c.json({ error: 'Passkeys sind in der Cloudflare Workers Version noch nicht verfügbar' }, 501);
});

app.post('/passkey/auth-verify', async (c) => {
  return c.json({ error: 'Passkeys sind in der Cloudflare Workers Version noch nicht verfügbar' }, 501);
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

app.post('/admin/disable-totp', authMiddleware, async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const { employeeId } = await c.req.json();
  if (!employeeId) return c.json({ error: 'Mitarbeiter-ID erforderlich' }, 400);

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);

  await prisma.employee.update({ where: { id: employeeId }, data: { totpEnabled: false, totpSecret: null } });

  await createAuditLog({
    c, prisma, userId: emp.id, userName: `${emp.firstName} ${emp.lastName}`,
    action: 'UPDATE', entityType: 'Employee', entityId: employeeId,
    note: `2FA für ${employee.firstName} ${employee.lastName} durch Admin deaktiviert`,
  });

  return c.json({ message: `2FA für ${employee.firstName} ${employee.lastName} deaktiviert` });
});

app.delete('/admin/passkey/:id', authMiddleware, async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');
  const passkey = await prisma.passkey.findUnique({
    where: { id },
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  if (!passkey) return c.json({ error: 'Passkey nicht gefunden' }, 404);

  await prisma.passkey.delete({ where: { id } });

  await createAuditLog({
    c, prisma, userId: emp.id, userName: `${emp.firstName} ${emp.lastName}`,
    action: 'DELETE', entityType: 'Employee', entityId: passkey.employeeId,
    note: `Passkey "${passkey.deviceName}" durch Admin gelöscht`,
  });

  return c.json({ message: 'Passkey gelöscht' });
});

// 2FA status (auth required)
app.get('/status', authMiddleware, async (c) => {
  const prisma = c.get('prisma');
  const emp = c.get('employee');
  const employee = await prisma.employee.findUnique({
    where: { id: emp.id },
    select: { totpEnabled: true, _count: { select: { passkeys: true } } },
  });
  if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
  return c.json({ totpEnabled: employee.totpEnabled, passkeyCount: employee._count.passkeys });
});

app.get('/admin/status/:employeeId', authMiddleware, async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const employeeId = c.req.param('employeeId');
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { totpEnabled: true, passkeys: { select: { id: true, deviceName: true, createdAt: true } } },
  });
  if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);
  return c.json({ totpEnabled: employee.totpEnabled, passkeys: employee.passkeys });
});

export default app;
