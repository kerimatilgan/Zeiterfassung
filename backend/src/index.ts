import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';

import employeeRoutes from './routes/employees.js';
import timeEntryRoutes from './routes/timeEntries.js';
import reportRoutes from './routes/reports.js';
import authRoutes from './routes/auth.js';
import terminalRoutes from './routes/terminal.js';
import settingsRoutes from './routes/settings.js';
import auditLogRoutes from './routes/auditLogs.js';
import twoFactorRoutes from './routes/twoFactor.js';
import documentRoutes from './routes/documents.js';
import backupRoutes from './routes/backup.js';
import { authMiddleware, adminMiddleware } from './middleware/auth.js';
import setupRoutes from './routes/setup.js';
import complaintRoutes from './routes/complaints.js';
import { startBackupScheduler } from './services/backup/scheduler.js';
import { startAutoClockOutScheduler } from './services/autoClockOut.js';
import { startVacationCarryOverScheduler } from './services/vacationCarryOver.js';

export const prisma = new PrismaClient();

const app = express();
const httpServer = createServer(app);

// Hinter 2 Reverse-Proxies (Pangolin + lokaler nginx). Damit liest Express
// die korrekte Client-IP aus X-Forwarded-For — wichtig für Rate-Limits.
app.set('trust proxy', 2);

const FRONTEND_URL = process.env.FRONTEND_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || '';

// Socket.io Setup (CORS eingeschränkt auf FRONTEND_URL)
export const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL || false,
    methods: ['GET', 'POST'],
  },
});

// Socket.io Authentifizierung: JWT (Frontend) ODER Terminal-API-Key (Pi).
// Ohne gültige Credentials werden keine Events empfangen.
io.use(async (socket, next) => {
  const auth = socket.handshake.auth || {};
  const token = auth.token || (socket.handshake.headers.authorization || '').replace(/^Bearer /, '');
  const apiKey = auth.api_key || socket.handshake.headers['x-terminal-api-key'];

  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return next();
    } catch {}
  }
  if (apiKey) {
    const terminal = await prisma.terminal.findFirst({ where: { apiKey: String(apiKey), isActive: true } });
    if (terminal) return next();
  }
  next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

// Middleware
// Helmet als Defense-in-Depth (nginx setzt die Security-Header schon, hier
// für den Fall dass das Backend mal direkt exposed wird)
app.use(helmet({
  contentSecurityPolicy: false,  // CSP wird im nginx gesetzt (flexibler)
  crossOriginEmbedderPolicy: false,
}));
// CORS: nur die eigene Frontend-URL
app.use(cors({ origin: FRONTEND_URL || false, credentials: false }));
app.use(express.json());

// Request Logging
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Logos öffentlich (Branding in E-Mail-Footern, Login-Seite)
app.use('/uploads/logos', express.static(path.join(process.cwd(), 'uploads/logos')));

// Fotos: JWT-Auth ODER Terminal-API-Key (damit Pi-Terminals sie laden können)
app.get('/uploads/photos/:filename', async (req, res) => {
  try {
    const jwt = await import('jsonwebtoken');
    const fs = await import('fs');
    const authHeader = req.headers.authorization;
    const terminalKey = req.headers['x-terminal-api-key'] as string | undefined;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    let authenticated = false;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        jwt.default.verify(authHeader.split(' ')[1], process.env.JWT_SECRET!);
        authenticated = true;
      } catch {}
    }
    // Browser-<img> kann keinen Header senden — daher auch ?token=... akzeptieren
    if (!authenticated && queryToken) {
      try {
        jwt.default.verify(queryToken, process.env.JWT_SECRET!);
        authenticated = true;
      } catch {}
    }
    if (!authenticated && terminalKey) {
      const term = await prisma.terminal.findFirst({ where: { apiKey: terminalKey, isActive: true } });
      if (term) authenticated = true;
    }
    if (!authenticated) return res.status(401).send('Unauthorized');

    // Path-Traversal verhindern — nur basename verwenden
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(process.cwd(), 'uploads/photos', safeName);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    res.sendFile(filePath);
  } catch (err) {
    console.error('Photo serve error:', err);
    res.status(500).send('Server error');
  }
});

// Dokumente: werden über /api/documents/* mit strikter Auth + Ownership-Check
// ausgeliefert (und AES-verschlüsselt), /uploads/documents/ daher bewusst nicht freigegeben.

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/terminal', terminalRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/2fa', twoFactorRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/setup', setupRoutes);
app.use('/api/complaints', complaintRoutes);

// Health Check — bewusst minimal, keine interne Info exposen
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Debug: zeigt wie der Request durch die Proxy-Chain ankommt — hilft
// bei der Diagnose von X-Forwarded-For-Problemen (Pangolin/nginx). Admin-only.
app.get('/api/_debug-ip', authMiddleware, adminMiddleware, (req, res) => {
  res.json({
    reqIp: req.ip,
    reqIps: req.ips,
    socketRemote: req.socket.remoteAddress,
    xForwardedFor: req.headers['x-forwarded-for'] || null,
    xRealIp: req.headers['x-real-ip'] || null,
    trustProxySetting: req.app.get('trust proxy'),
  });
});


// Error Handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Interner Serverfehler' });
});

// Startup
async function main() {
  // Erstelle Standard-Einstellungen falls nicht vorhanden
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  if (!settings) {
    await prisma.settings.create({
      data: {
        id: 'default',
        companyName: 'Handy-Insel',
      },
    });
    console.log('Standard-Einstellungen erstellt');
  }

  // Terminal-Migration: Falls keine Terminals in DB existieren, Legacy-Key migrieren
  const terminalCount = await prisma.terminal.count();
  if (terminalCount === 0) {
    const legacyKey = process.env.TERMINAL_API_KEY || 'handy-insel-terminal-key-2024';
    await prisma.terminal.create({
      data: {
        name: 'Standard-Terminal',
        apiKey: legacyKey,
      },
    });
    console.log('Standard-Terminal mit Legacy-Key migriert');
  }

  // Standard-Dokumenttypen erstellen falls keine existieren
  const docTypeCount = await prisma.documentType.count();
  if (docTypeCount === 0) {
    const defaultDocTypes = [
      { name: 'Gehaltsabrechnung', shortName: 'GA', color: '#3B82F6', sortOrder: 1 },
      { name: 'Provisionsabrechnung', shortName: 'PA', color: '#8B5CF6', sortOrder: 2 },
      { name: 'Ausdruck der elektronischen Lohnsteuerbescheinigung', shortName: 'LSt', color: '#EF4444', sortOrder: 3 },
      { name: 'Sozialversicherungsnachweis', shortName: 'SVN', color: '#10B981', sortOrder: 4 },
      { name: 'Arbeitsvertrag', shortName: 'AV', color: '#F59E0B', sortOrder: 5 },
      { name: 'Vertragsänderung / Nachtrag', shortName: 'VÄ', color: '#F97316', sortOrder: 6 },
      { name: 'Meldebescheinigung zur Sozialversicherung', shortName: 'MSV', color: '#84CC16', sortOrder: 7 },
      { name: 'Sonderzahlungsabrechnung', shortName: 'SZA', color: '#EC4899', sortOrder: 8 },
      { name: 'Jahresabrechnung', shortName: 'JA', color: '#6366F1', sortOrder: 9 },
    ];
    for (const dt of defaultDocTypes) {
      await prisma.documentType.create({ data: dt });
    }
    console.log('Standard-Dokumenttypen erstellt');
  }

  // Info-Schreiben als eigenen Dokumenttyp sicherstellen (auch in bestehenden DBs)
  const infoType = await prisma.documentType.findFirst({ where: { name: 'Info-Schreiben' } });
  if (!infoType) {
    await prisma.documentType.create({
      data: { name: 'Info-Schreiben', shortName: 'IS', color: '#0EA5E9', sortOrder: 10 },
    });
    console.log('Dokumenttyp "Info-Schreiben" erstellt');
  }

  // Scheduler starten
  startBackupScheduler();
  startAutoClockOutScheduler();
  startVacationCarryOverScheduler();

  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 Zeiterfassung Backend läuft auf http://0.0.0.0:${PORT}`);
    console.log(`🔌 WebSocket Server bereit`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
