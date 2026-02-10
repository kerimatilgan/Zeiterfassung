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

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
