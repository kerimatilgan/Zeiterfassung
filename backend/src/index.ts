import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
import setupRoutes from './routes/setup.js';
import complaintRoutes from './routes/complaints.js';
import { startBackupScheduler } from './services/backup/scheduler.js';
import { startAutoClockOutScheduler } from './services/autoClockOut.js';
import { startVacationCarryOverScheduler } from './services/vacationCarryOver.js';

export const prisma = new PrismaClient();

const app = express();
const httpServer = createServer(app);

// Socket.io Setup
export const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Socket.io Connection Handler
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Request Logging
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Static Files für Foto-Uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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

// Health Check
app.get('/api/health', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  res.json({ status: 'ok', timestamp: new Date().toISOString(), baseUrl: `${protocol}://${host}` });
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
