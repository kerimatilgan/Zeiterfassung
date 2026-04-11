import { Hono } from 'hono';
import type { Env, Variables } from '../bindings.js';
import { createAuditLog } from '../utils/auditLog.js';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// Encryption helpers using Web Crypto API
// ============================================================

async function getEncryptionKey(env: Env): Promise<CryptoKey> {
  const keyHex = env.DOCUMENT_ENCRYPTION_KEY;
  if (!keyHex) throw new Error('DOCUMENT_ENCRYPTION_KEY not set');
  const keyBytes = new Uint8Array(keyHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptBuffer(data: ArrayBuffer, env: Env): Promise<ArrayBuffer> {
  const key = await getEncryptionKey(env);
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  // Format: [IV (16 bytes)] [Encrypted data with auth tag]
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  return result.buffer;
}

async function decryptBuffer(data: ArrayBuffer, env: Env): Promise<ArrayBuffer> {
  const key = await getEncryptionKey(env);
  const bytes = new Uint8Array(data);
  const iv = bytes.slice(0, 16);
  const encrypted = bytes.slice(16);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
}

// ============================================================
// Endpoints
// ============================================================

// Eigene Dokumente
app.get('/my', async (c) => {
  const prisma = c.get('prisma');
  const emp = c.get('employee');

  try {
    const documentTypeId = c.req.query('documentTypeId');
    const year = c.req.query('year');
    const month = c.req.query('month');

    const where: any = { employeeId: emp.id };
    if (documentTypeId) where.documentTypeId = documentTypeId;
    if (year) where.year = parseInt(year);
    if (month) where.month = parseInt(month);

    const documents = await prisma.document.findMany({
      where,
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
    });
    return c.json(documents);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Dokumente' }, 500);
  }
});

// Dokumente eines Mitarbeiters (Admin)
app.get('/employee/:employeeId', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const employeeId = c.req.param('employeeId');

  try {
    const documents = await prisma.document.findMany({
      where: { employeeId },
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
    });
    return c.json(documents);
  } catch (error) {
    return c.json({ error: 'Fehler beim Laden der Dokumente' }, 500);
  }
});

// Dokument hochladen (Admin) - encrypted to R2
app.post('/employee/:employeeId', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const employeeId = c.req.param('employeeId');

  try {
    const formData = await c.req.formData();
    const file = formData.get('document') as File | null;
    if (!file) return c.json({ error: 'Keine Datei hochgeladen' }, 400);

    const documentTypeId = formData.get('documentTypeId') as string;
    const year = formData.get('year') as string | null;
    const month = formData.get('month') as string | null;
    const note = formData.get('note') as string | null;

    if (!documentTypeId) return c.json({ error: 'Dokumenttyp ist erforderlich' }, 400);

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!employee) return c.json({ error: 'Mitarbeiter nicht gefunden' }, 404);

    const docType = await prisma.documentType.findUnique({ where: { id: documentTypeId } });
    if (!docType) return c.json({ error: 'Dokumenttyp nicht gefunden' }, 404);

    // Read file and encrypt
    const originalSize = file.size;
    const fileData = await file.arrayBuffer();
    const encryptedData = await encryptBuffer(fileData, c.env);

    // Upload to R2
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const filename = `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}.enc`;
    const r2Key = `documents/${employeeId}/${filename}`;
    await c.env.UPLOADS.put(r2Key, encryptedData, {
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { originalMimeType: file.type, originalFilename: file.name },
    });

    const filePath = `/uploads/${r2Key}`;

    const document = await prisma.document.create({
      data: {
        employeeId,
        documentTypeId,
        filePath,
        originalFilename: file.name,
        fileSize: originalSize,
        mimeType: file.type,
        year: year ? parseInt(year) : null,
        month: month ? parseInt(month) : null,
        note: note || null,
        uploadedBy: emp.id,
        uploadedByName: `${emp.firstName} ${emp.lastName}`,
      },
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
    });

    await createAuditLog({
      c, prisma, action: 'UPLOAD', entityType: 'Document', entityId: document.id,
      note: `Dokument "${file.name}" (${docType.name}) für ${employee.firstName} ${employee.lastName} hochgeladen`,
    });

    return c.json(document, 201);
  } catch (error) {
    console.error('Upload document error:', error);
    return c.json({ error: 'Fehler beim Hochladen' }, 500);
  }
});

// Dokument herunterladen - decrypt on-the-fly from R2
app.get('/:id/download', async (c) => {
  const prisma = c.get('prisma');
  const emp = c.get('employee');
  const id = c.req.param('id');

  try {
    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
        documentType: { select: { name: true, shortName: true } },
      },
    });
    if (!document) return c.json({ error: 'Dokument nicht gefunden' }, 404);
    if (!emp.isAdmin && emp.id !== document.employeeId) {
      return c.json({ error: 'Kein Zugriff auf dieses Dokument' }, 403);
    }

    // Fetch from R2
    const r2Key = document.filePath.replace('/uploads/', '');
    const r2Object = await c.env.UPLOADS.get(r2Key);
    if (!r2Object) return c.json({ error: 'Datei nicht gefunden' }, 404);

    // Decrypt
    const encryptedData = await r2Object.arrayBuffer();
    const decryptedData = await decryptBuffer(encryptedData, c.env);

    await createAuditLog({
      c, prisma, action: 'DOWNLOAD', entityType: 'Document', entityId: document.id,
      note: `${document.documentType.name} "${document.originalFilename}" heruntergeladen`,
    });

    return new Response(decryptedData, {
      headers: {
        'Content-Disposition': `attachment; filename="${encodeURIComponent(document.originalFilename)}"`,
        'Content-Type': document.mimeType,
        'Content-Length': String(decryptedData.byteLength),
      },
    });
  } catch (error) {
    console.error('Download document error:', error);
    return c.json({ error: 'Fehler beim Herunterladen' }, 500);
  }
});

// Update metadata
app.put('/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');

  try {
    const { documentTypeId, year, month, note } = await c.req.json();
    const document = await prisma.document.update({
      where: { id },
      data: {
        ...(documentTypeId && { documentTypeId }),
        ...(year !== undefined && { year: year ? parseInt(year) : null }),
        ...(month !== undefined && { month: month ? parseInt(month) : null }),
        ...(note !== undefined && { note: note || null }),
      },
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
    });
    return c.json(document);
  } catch (error) {
    return c.json({ error: 'Fehler beim Aktualisieren' }, 500);
  }
});

// Delete
app.delete('/:id', async (c) => {
  const emp = c.get('employee');
  if (!emp.isAdmin) return c.json({ error: 'Admin-Berechtigung erforderlich' }, 403);

  const prisma = c.get('prisma');
  const id = c.req.param('id');

  try {
    const document = await prisma.document.findUnique({
      where: { id },
      include: { employee: { select: { firstName: true, lastName: true } }, documentType: { select: { name: true } } },
    });
    if (!document) return c.json({ error: 'Dokument nicht gefunden' }, 404);

    // Delete from R2
    const r2Key = document.filePath.replace('/uploads/', '');
    await c.env.UPLOADS.delete(r2Key);

    await prisma.document.delete({ where: { id } });

    await createAuditLog({
      c, prisma, action: 'DELETE', entityType: 'Document', entityId: id,
      note: `Dokument "${document.originalFilename}" gelöscht`,
    });

    return c.json({ message: 'Dokument gelöscht' });
  } catch (error) {
    return c.json({ error: 'Fehler beim Löschen' }, 500);
  }
});

export default app;
