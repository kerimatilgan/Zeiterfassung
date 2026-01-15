import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

import employeeRoutes from './routes/employees.js';
import timeEntryRoutes from './routes/timeEntries.js';
import reportRoutes from './routes/reports.js';
import authRoutes from './routes/auth.js';
import terminalRoutes from './routes/terminal.js';
import settingsRoutes from './routes/settings.js';

export const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Request Logging
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/time-entries', timeEntryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/terminal', terminalRoutes);
app.use('/api/settings', settingsRoutes);

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

  app.listen(PORT, () => {
    console.log(`🚀 Zeiterfassung Backend läuft auf http://localhost:${PORT}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
