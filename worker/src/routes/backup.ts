import { Hono } from 'hono';
import type { Env, Variables } from '../bindings.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Backup status - D1 hat automatische Backups
app.get('/status', async (c) => {
  return c.json({
    enabled: false,
    message: 'Backups werden automatisch von Cloudflare D1 verwaltet',
    targets: [],
    lastBackup: null,
  });
});

// Stub endpoints for frontend compatibility
app.get('/targets', async (c) => c.json([]));
app.get('/records', async (c) => c.json({ records: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } }));

export default app;
