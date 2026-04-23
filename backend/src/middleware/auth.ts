import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index.js';

const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET env var missing or too short (min 32 chars). Generate with: openssl rand -hex 32');
  }
  return s;
})();

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

// Terminal Auth - DB-backed (keine Legacy-Fallbacks!)
export interface TerminalAuthRequest extends Request {
  terminalId?: string;
}

export async function terminalAuthMiddleware(req: TerminalAuthRequest, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-terminal-api-key'] as string | undefined;
  if (!apiKey) {
    return res.status(401).json({ error: 'Ungültiger Terminal API-Key' });
  }

  try {
    const terminal = await prisma.terminal.findFirst({
      where: { apiKey, isActive: true },
    });

    if (!terminal) {
      return res.status(401).json({ error: 'Ungültiger Terminal API-Key' });
    }

    req.terminalId = terminal.id;
    // lastSeen + IP aktualisieren (impliziter Heartbeat)
    const clientIp = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || undefined;
    prisma.terminal.update({
      where: { id: terminal.id },
      data: { lastSeen: new Date(), ipAddress: clientIp },
    }).catch((err) => console.error('Terminal lastSeen update error:', err));

    return next();
  } catch (error) {
    console.error('Terminal auth error:', error);
    return res.status(500).json({ error: 'Authentifizierungsfehler' });
  }
}
