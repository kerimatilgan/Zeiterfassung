import { Context, Next } from 'hono';
import { jwtVerify, SignJWT } from 'jose';
import type { Env, Variables } from '../bindings.js';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const DEFAULT_SECRET = 'handy-insel-zeiterfassung-secret-key-2024';

function getSecret(c: AppContext) {
  const secret = c.env.JWT_SECRET || DEFAULT_SECRET;
  return new TextEncoder().encode(secret);
}

export async function generateToken(
  employee: { id: string; employeeNumber: string; isAdmin: boolean },
  c: AppContext
): Promise<string> {
  return new SignJWT({
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    isAdmin: employee.isAdmin,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .sign(getSecret(c));
}

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Nicht autorisiert' }, 401);
  }

  const token = authHeader.split(' ')[1];
  try {
    const { payload } = await jwtVerify(token, getSecret(c));
    const decoded = payload as { id: string; employeeNumber: string; isAdmin: boolean };

    const prisma = c.get('prisma');
    const employee = await prisma.employee.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        isAdmin: true,
        isActive: true,
      },
    });

    if (!employee || !employee.isActive) {
      return c.json({ error: 'Mitarbeiter nicht gefunden oder inaktiv' }, 401);
    }

    c.set('employee', employee);
    await next();
  } catch {
    return c.json({ error: 'Ungültiges Token' }, 401);
  }
}

export async function adminMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  const employee = c.get('employee');
  if (!employee?.isAdmin) {
    return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);
  }
  await next();
}

export async function terminalAuthMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next
) {
  const apiKey = c.req.header('x-terminal-api-key');
  if (!apiKey) {
    return c.json({ error: 'Ungültiger Terminal API-Key' }, 401);
  }

  try {
    const prisma = c.get('prisma');
    const terminal = await prisma.terminal.findFirst({
      where: { apiKey, isActive: true },
    });

    if (terminal) {
      c.set('terminalId' as any, terminal.id);
      // Update lastSeen in background
      c.executionCtx.waitUntil(
        prisma.terminal.update({
          where: { id: terminal.id },
          data: {
            lastSeen: new Date(),
            ipAddress: c.req.header('cf-connecting-ip') || undefined,
          },
        }).catch(() => {})
      );
      return next();
    }

    // Fallback: Legacy API key
    const legacyKey = c.env.TERMINAL_API_KEY || 'handy-insel-terminal-key-2024';
    if (apiKey === legacyKey) {
      return next();
    }

    return c.json({ error: 'Ungültiger Terminal API-Key' }, 401);
  } catch {
    return c.json({ error: 'Authentifizierungsfehler' }, 500);
  }
}
