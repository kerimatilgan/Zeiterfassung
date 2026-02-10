import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'handy-insel-zeiterfassung-secret-key-2024';

export interface AuthRequest extends Request {
  employee?: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
    isAdmin: boolean;
  };
}

export function generateToken(employee: { id: string; employeeNumber: string; isAdmin: boolean }): string {
  return jwt.sign(
    { id: employee.id, employeeNumber: employee.employeeNumber, isAdmin: employee.isAdmin },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Nicht autorisiert' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; employeeNumber: string; isAdmin: boolean };

    const employee = await prisma.employee.findUnique({
      where: { id: decoded.id },
      select: { id: true, employeeNumber: true, firstName: true, lastName: true, isAdmin: true, isActive: true },
    });

    if (!employee || !employee.isActive) {
      return res.status(401).json({ error: 'Mitarbeiter nicht gefunden oder inaktiv' });
    }

    req.employee = employee;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Ungültiges Token' });
  }
}

export async function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.employee?.isAdmin) {
    return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
  }
  next();
}

// Terminal Auth - DB-backed mit Fallback auf Env-Variable
const LEGACY_TERMINAL_API_KEY = process.env.TERMINAL_API_KEY || 'handy-insel-terminal-key-2024';

export interface TerminalAuthRequest extends Request {
  terminalId?: string;
}

export async function terminalAuthMiddleware(req: TerminalAuthRequest, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-terminal-api-key'] as string | undefined;
  if (!apiKey) {
    return res.status(401).json({ error: 'Ungültiger Terminal API-Key' });
  }

  try {
    // DB-Lookup: Aktives Terminal mit diesem API-Key suchen
    const terminal = await prisma.terminal.findFirst({
      where: { apiKey, isActive: true },
    });

    if (terminal) {
      req.terminalId = terminal.id;
      // lastSeen + IP aktualisieren (impliziter Heartbeat)
      const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || undefined;
      prisma.terminal.update({
        where: { id: terminal.id },
        data: {
          lastSeen: new Date(),
          ipAddress: clientIp,
        },
      }).catch((err) => console.error('Terminal lastSeen update error:', err));
      return next();
    }

    // Fallback: Legacy API-Key aus Env-Variable (für Migration)
    if (apiKey === LEGACY_TERMINAL_API_KEY) {
      return next();
    }

    return res.status(401).json({ error: 'Ungültiger Terminal API-Key' });
  } catch (error) {
    console.error('Terminal auth error:', error);
    return res.status(500).json({ error: 'Authentifizierungsfehler' });
  }
}
