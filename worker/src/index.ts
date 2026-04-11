import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, Variables } from './bindings.js';
import { createPrismaClient } from './db.js';
import { authMiddleware } from './middleware/auth.js';

// Routes
import authRoutes from './routes/auth.js';
import employeeRoutes from './routes/employees.js';
import timeEntryRoutes from './routes/timeEntries.js';
import reportRoutes from './routes/reports.js';
import terminalRoutes from './routes/terminal.js';
import settingsRoutes from './routes/settings.js';
import auditLogRoutes from './routes/auditLogs.js';
import twoFactorRoutes from './routes/twoFactor.js';
import documentRoutes from './routes/documents.js';
import backupRoutes from './routes/backup.js';
import setupRoutes from './routes/setup.js';

// Cron handlers
import { handleAutoClockOut, handleVacationCarryOver, handleBackup } from './services/cronHandlers.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Global Middleware
// ============================================================

app.use('*', cors());
app.use('*', logger());

// Prisma middleware - create client per request
app.use('*', async (c, next) => {
  const prisma = createPrismaClient(c.env.DB);
  c.set('prisma', prisma);
  await next();
});

// ============================================================
// Public routes (no auth required)
// ============================================================

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: 'cloudflare-workers',
  });
});

// Setup (no auth)
app.route('/api/setup', setupRoutes);

// Terminal routes (own auth via API key - handled inside terminal routes)
app.route('/api/terminal', terminalRoutes);

// Serve uploads from R2
app.get('/uploads/*', async (c) => {
  const key = c.req.path.replace('/uploads/', '');
  const object = await c.env.UPLOADS.get(key);
  if (!object) return c.json({ error: 'File not found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=86400');

  return new Response(object.body, { headers });
});

// ============================================================
// Auth routes - mixed public/private
// The auth routes handle their own auth internally:
// - /login, /forgot-password, /reset-password are public
// - /me, /change-password, /admin-reset-password need auth
// We apply auth middleware selectively inside the route file
// ============================================================

app.route('/api/auth', authRoutes);

// 2FA routes - mixed public/private
// - /totp/validate, /passkey/auth-options, /passkey/auth-verify are public
// - rest need auth (handled inside route file)
app.route('/api/2fa', twoFactorRoutes);

// ============================================================
// Authenticated routes (auth middleware applied here)
// ============================================================

const authenticated = new Hono<{ Bindings: Env; Variables: Variables }>();
authenticated.use('*', authMiddleware);

authenticated.route('/api/employees', employeeRoutes);
authenticated.route('/api/time-entries', timeEntryRoutes);
authenticated.route('/api/reports', reportRoutes);
authenticated.route('/api/settings', settingsRoutes);
authenticated.route('/api/audit-logs', auditLogRoutes);
authenticated.route('/api/documents', documentRoutes);
authenticated.route('/api/backup', backupRoutes);

app.route('/', authenticated);

// ============================================================
// Startup seed (runs on first request, idempotent)
// ============================================================

async function seedIfNeeded(prisma: any) {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    if (!settings) {
      await prisma.settings.create({ data: { id: 'default', companyName: 'Handy-Insel' } });
    }

    const terminalCount = await prisma.terminal.count();
    if (terminalCount === 0) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const key = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      await prisma.terminal.create({ data: { name: 'Standard-Terminal', apiKey: key } });
    }

    const docTypeCount = await prisma.documentType.count();
    if (docTypeCount === 0) {
      const types = [
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
      for (const dt of types) {
        await prisma.documentType.create({ data: dt });
      }
    }
  } catch (error) {
    console.error('Seed error:', error);
  }
}

// ============================================================
// Error / 404 handlers
// ============================================================

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Interner Serverfehler' }, 500);
});

app.notFound((c) => {
  return c.json({ error: 'Route nicht gefunden' }, 404);
});

// ============================================================
// Export for Cloudflare Workers
// ============================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const prisma = createPrismaClient(env.DB);
    ctx.waitUntil(seedIfNeeded(prisma));
    return app.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const prisma = createPrismaClient(env.DB);

    switch (event.cron) {
      case '59 23 * * *':
        ctx.waitUntil(handleAutoClockOut(prisma));
        break;
      case '0 2 * * *':
        ctx.waitUntil(handleBackup(prisma));
        break;
      case '0 0 1 1 *':
        ctx.waitUntil(handleVacationCarryOver(prisma));
        break;
    }
  },
};
