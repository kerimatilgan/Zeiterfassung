import { Router, Response } from 'express';
import { prisma, io } from '../index.js';
import { authMiddleware, adminMiddleware, AuthRequest } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLog.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { encryptFile, decryptFile } from '../utils/encryption.js';
import bcrypt from 'bcryptjs';
import { renderEmployeeInfoPDF } from '../utils/employeeInfoPdf.js';
import { sendDocumentNotification } from '../utils/emailService.js';
import { sendPushToEmployee } from '../utils/pushService.js';

const router = Router();

// ============================================
// Multer für Dokument-Upload
// ============================================
const documentStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const employeeId = req.params.employeeId;
    const dir = path.join(process.cwd(), 'uploads', 'documents', employeeId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `doc-${uniqueSuffix}${ext}.enc`);
  },
});

// MIME-Whitelist — nur sichere Dokument-Typen zulassen
const ALLOWED_DOC_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/plain',
  'text/csv',
]);

const documentUpload = multer({
  storage: documentStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOC_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Dateityp "${file.mimetype}" nicht erlaubt. Zulässig: PDF, Bilder, Office-Dokumente, Text.`));
    }
  },
});

// Multer-Storage für MA-Self-Uploads — nutzt req.employee.id (nicht URL-Param)
const selfDocumentStorage = multer.diskStorage({
  destination: (req: any, _file, cb) => {
    const employeeId = req.employee?.id;
    if (!employeeId) return cb(new Error('Nicht authentifiziert'), '');
    const dir = path.join(process.cwd(), 'uploads', 'documents', employeeId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `doc-${uniqueSuffix}${ext}.enc`);
  },
});

const selfDocumentUpload = multer({
  storage: selfDocumentStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOC_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Dateityp "${file.mimetype}" nicht erlaubt. Zulässig: PDF, Bilder, Office-Dokumente, Text.`));
    }
  },
});

// ============================================
// Endpoints
// ============================================

// Eigene Dokumente abrufen (Mitarbeiter)
router.get('/my', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { documentTypeId, year, month } = req.query;

    const where: any = { employeeId: req.employee!.id };
    if (documentTypeId) where.documentTypeId = documentTypeId as string;
    if (year) where.year = parseInt(year as string);
    if (month) where.month = parseInt(month as string);

    const documents = await prisma.document.findMany({
      where,
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(documents);
  } catch (error) {
    console.error('Get my documents error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Dokumente' });
  }
});

// Alle eigenen ungelesenen Dokumente als "gelesen" markieren
router.post('/my/mark-all-viewed', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await prisma.document.updateMany({
      where: { employeeId: req.employee!.id, firstViewedAt: null },
      data: { firstViewedAt: new Date() },
    });
    res.json({ markedAsRead: result.count });
  } catch (error) {
    console.error('Mark documents viewed error:', error);
    res.status(500).json({ error: 'Fehler beim Markieren als gelesen' });
  }
});

// MA lädt selbst ein Dokument hoch (eigenes Archiv)
// visibleToAdmin: true → Admin sieht es in der MA-Doc-Liste
// visibleToAdmin: false → nur der MA selbst sieht/lädt es runter
router.post('/my', authMiddleware, selfDocumentUpload.single('document'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    const { documentTypeId, year, month, note, visibleToAdmin } = req.body;

    if (!documentTypeId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Dokumenttyp ist erforderlich' });
    }

    const docType = await prisma.documentType.findUnique({ where: { id: documentTypeId } });
    if (!docType) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Dokumenttyp nicht gefunden' });
    }

    // Datei verschlüsseln (in-place) — gleicher Flow wie Admin-Upload
    const originalSize = req.file.size;
    try {
      const tempPath = req.file.path + '.tmp';
      fs.renameSync(req.file.path, tempPath);
      encryptFile(tempPath, req.file.path);
      fs.unlinkSync(tempPath);
    } catch (encError) {
      console.error('Encryption error (self-upload):', encError);
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (fs.existsSync(req.file.path + '.tmp')) fs.unlinkSync(req.file.path + '.tmp');
      return res.status(500).json({ error: 'Fehler bei der Verschlüsselung' });
    }

    const filePath = `/uploads/documents/${req.employee!.id}/${req.file.filename}`;
    // Body kommt aus multipart/form-data → boolean wird als String "true"/"false" geliefert
    const visible = visibleToAdmin === 'true' || visibleToAdmin === true;

    const document = await prisma.document.create({
      data: {
        employeeId: req.employee!.id,
        documentTypeId,
        filePath,
        originalFilename: req.file.originalname,
        fileSize: originalSize,
        mimeType: req.file.mimetype,
        year: year ? parseInt(year) : null,
        month: month ? parseInt(month) : null,
        note: note || null,
        uploadedBy: req.employee!.id,
        uploadedByName: `${(req.employee as any).firstName} ${(req.employee as any).lastName}`,
        visibleToAdmin: visible,
      },
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
    });

    await createAuditLog({
      req,
      action: 'UPLOAD',
      entityType: 'Document',
      entityId: document.id,
      newValues: {
        type: docType.name,
        filename: req.file.originalname,
        year: year || null,
        month: month || null,
        sichtbarkeit: visible ? 'sichtbar für Admin' : 'privat (nur für MA)',
      },
      note: `Eigenes Dokument "${req.file.originalname}" (${docType.name}) hochgeladen — ${visible ? 'sichtbar für Admin' : 'privat'}`,
    });

    // WebSocket-Update nur an Admin senden wenn das Dokument sichtbar ist —
    // bei privaten Uploads ändert sich für Admin nichts.
    if (visible) {
      io.emit('document-updated', { type: 'upload', employeeId: req.employee!.id, documentId: document.id });
    }

    res.status(201).json(document);
  } catch (error) {
    console.error('Self-upload document error:', error);
    res.status(500).json({ error: 'Fehler beim Hochladen' });
  }
});

// Dokumente eines Mitarbeiters abrufen (Admin)
// Private MA-Self-Uploads (visibleToAdmin: false) werden komplett rausgefiltert.
router.get('/employee/:employeeId', authMiddleware, adminMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId } = req.params;

    const documents = await prisma.document.findMany({
      where: { employeeId, visibleToAdmin: true },
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(documents);
  } catch (error) {
    console.error('Get employee documents error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Dokumente' });
  }
});

// Dokument hochladen (Admin) - wird nach Upload verschlüsselt
router.post('/employee/:employeeId', authMiddleware, adminMiddleware, documentUpload.single('document'), async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    }

    const { documentTypeId, year, month, note } = req.body;

    if (!documentTypeId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Dokumenttyp ist erforderlich' });
    }

    // Prüfe ob Mitarbeiter existiert
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    if (!employee) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    // Prüfe ob Dokumenttyp existiert
    const docType = await prisma.documentType.findUnique({ where: { id: documentTypeId } });
    if (!docType) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Dokumenttyp nicht gefunden' });
    }

    // Datei verschlüsseln (in-place)
    const originalSize = req.file.size;
    try {
      const tempPath = req.file.path + '.tmp';
      fs.renameSync(req.file.path, tempPath);
      encryptFile(tempPath, req.file.path);
      fs.unlinkSync(tempPath);
    } catch (encError) {
      console.error('Encryption error:', encError);
      // Aufräumen
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (fs.existsSync(req.file.path + '.tmp')) fs.unlinkSync(req.file.path + '.tmp');
      return res.status(500).json({ error: 'Fehler bei der Verschlüsselung' });
    }

    const filePath = `/uploads/documents/${employeeId}/${req.file.filename}`;

    const document = await prisma.document.create({
      data: {
        employeeId,
        documentTypeId,
        filePath,
        originalFilename: req.file.originalname,
        fileSize: originalSize,
        mimeType: req.file.mimetype,
        year: year ? parseInt(year) : null,
        month: month ? parseInt(month) : null,
        note: note || null,
        uploadedBy: req.employee!.id,
        uploadedByName: `${(req.employee as any).firstName} ${(req.employee as any).lastName}`,
      },
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
    });

    await createAuditLog({
      req,
      action: 'UPLOAD',
      entityType: 'Document',
      entityId: document.id,
      newValues: {
        employee: `${employee.firstName} ${employee.lastName}`,
        type: docType.name,
        filename: req.file.originalname,
        year: year || null,
        month: month || null,
      },
      note: `Dokument "${req.file.originalname}" (${docType.name}) für ${employee.firstName} ${employee.lastName} hochgeladen (verschlüsselt)`,
    });

    io.emit('document-updated', { type: 'upload', employeeId, documentId: document.id });

    // Mail + Push an MA — best-effort, blockiert die Response nicht
    if (employee.email) {
      sendDocumentNotification(
        employee.email,
        `${employee.firstName} ${employee.lastName}`,
        docType.name,
        req.file.originalname,
      ).catch(err => console.error('Doc notification mail failed:', err));
    }
    sendPushToEmployee(employeeId, {
      title: `Neues Dokument: ${docType.name}`,
      body: req.file.originalname,
      url: '/dashboard/documents',
      tag: 'document',
    }).catch(err => console.error('Doc notification push failed:', err));

    res.status(201).json(document);
  } catch (error) {
    console.error('Upload document error:', error);
    res.status(500).json({ error: 'Fehler beim Hochladen' });
  }
});

// Dokument herunterladen - entschlüsselt on-the-fly
router.get('/:id/download', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
        documentType: { select: { name: true, shortName: true } },
      },
    });
    if (!document) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    // Mitarbeiter darf nur eigene Dokumente herunterladen
    if (!req.employee!.isAdmin && req.employee!.id !== document.employeeId) {
      return res.status(403).json({ error: 'Kein Zugriff auf dieses Dokument' });
    }
    // Privater MA-Self-Upload: auch Admin darf nicht runterladen
    if (req.employee!.isAdmin && !document.visibleToAdmin) {
      return res.status(403).json({ error: 'Privates Dokument — kein Admin-Zugriff' });
    }

    const filePath = path.join(process.cwd(), document.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }

    // Datei entschlüsseln
    let fileBuffer: Buffer;
    try {
      fileBuffer = decryptFile(filePath);
    } catch (decError) {
      console.error('Decryption error:', decError);
      return res.status(500).json({ error: 'Fehler bei der Entschlüsselung' });
    }

    const periodStr = document.year && document.month
      ? ` (${document.month}/${document.year})`
      : document.year ? ` (${document.year})` : '';

    await createAuditLog({
      req,
      action: 'DOWNLOAD',
      entityType: 'Document',
      entityId: document.id,
      newValues: {
        datei: document.originalFilename,
        typ: document.documentType.name,
        mitarbeiter: `${document.employee.firstName} ${document.employee.lastName} (#${document.employee.employeeNumber})`,
        zeitraum: periodStr.trim() || undefined,
        groesse: `${(document.fileSize / 1024).toFixed(1)} KB`,
      },
      note: `${document.documentType.name}${periodStr} "${document.originalFilename}" für ${document.employee.firstName} ${document.employee.lastName} heruntergeladen`,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(document.originalFilename)}"`);
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.send(fileBuffer);
  } catch (error) {
    console.error('Download document error:', error);
    res.status(500).json({ error: 'Fehler beim Herunterladen' });
  }
});

// Dokument-Metadaten aktualisieren
// - Admin: alle Felder (documentTypeId, year, month, note, visibleToAdmin, originalFilename)
// - MA: nur originalFilename, documentTypeId, note, visibleToAdmin auf eigenen Self-Uploads
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { documentTypeId, year, month, note, visibleToAdmin, originalFilename } = req.body;

    const existing = await prisma.document.findUnique({
      where: { id },
      select: { id: true, employeeId: true, uploadedBy: true, visibleToAdmin: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    const isAdmin = req.employee!.isAdmin;
    const isOwnSelfUpload = existing.employeeId === req.employee!.id
      && existing.uploadedBy === req.employee!.id;

    if (!isAdmin && !isOwnSelfUpload) {
      return res.status(403).json({ error: 'Kein Zugriff auf dieses Dokument' });
    }

    const data: any = {};

    if (visibleToAdmin !== undefined) {
      data.visibleToAdmin = !!visibleToAdmin;
    }
    if (documentTypeId) {
      data.documentTypeId = documentTypeId;
    }
    if (note !== undefined) {
      data.note = note || null;
    }
    if (originalFilename !== undefined) {
      const trimmed = String(originalFilename).trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Dateiname darf nicht leer sein' });
      }
      if (trimmed.length > 200) {
        return res.status(400).json({ error: 'Dateiname zu lang (max. 200 Zeichen)' });
      }
      data.originalFilename = trimmed;
    }
    // Periode-Felder bleiben Admin-only
    if (isAdmin) {
      if (year !== undefined) data.year = year ? parseInt(year) : null;
      if (month !== undefined) data.month = month ? parseInt(month) : null;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Keine Änderung übermittelt' });
    }

    const document = await prisma.document.update({
      where: { id },
      data,
      include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
    });

    // WebSocket-Update nur senden wenn das Dokument für Admin sichtbar ist (oder
    // gerade sichtbar wurde) — bei privaten Uploads betrifft die Änderung den Admin nicht.
    if (document.visibleToAdmin || existing.visibleToAdmin) {
      io.emit('document-updated', { type: 'update', employeeId: document.employeeId, documentId: document.id });
    }

    res.json(document);
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren' });
  }
});

// Dokument löschen — Admin überall, MA nur eigene Self-Uploads (uploadedBy = self)
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        employee: { select: { firstName: true, lastName: true } },
        documentType: { select: { name: true } },
      },
    });

    if (!document) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    // Berechtigung: Admin darf alles, MA nur eigene Self-Uploads
    const isOwnSelfUpload = !req.employee!.isAdmin
      && document.employeeId === req.employee!.id
      && document.uploadedBy === req.employee!.id;
    if (!req.employee!.isAdmin && !isOwnSelfUpload) {
      return res.status(403).json({ error: 'Nur eigene hochgeladene Dokumente können gelöscht werden' });
    }

    // Verschlüsselte Datei löschen
    const filePath = path.join(process.cwd(), document.filePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await prisma.document.delete({ where: { id } });

    await createAuditLog({
      req,
      action: 'DELETE',
      entityType: 'Document',
      entityId: id,
      oldValues: {
        employee: `${document.employee.firstName} ${document.employee.lastName}`,
        type: document.documentType.name,
        filename: document.originalFilename,
      },
      note: `Dokument "${document.originalFilename}" (${document.documentType.name}) gelöscht`,
    });

    io.emit('document-updated', { type: 'delete', employeeId: document.employeeId, documentId: id });

    res.json({ message: 'Dokument gelöscht' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// Dokument digital signieren (MA bestätigt mit Passwort)
// Aktuell nur für Info-Schreiben genutzt; Signatur wird ins PDF eingebettet.
router.post('/:id/sign', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { password } = req.body as { password?: string };

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Passwort erforderlich' });
    }

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        employee: true,
        documentType: { select: { id: true, name: true } },
      },
    });
    if (!document) {
      return res.status(404).json({ error: 'Dokument nicht gefunden' });
    }

    // Nur der Eigentümer darf signieren — Admins können NICHT im Namen des MA bestätigen
    if (document.employeeId !== req.employee!.id) {
      return res.status(403).json({ error: 'Nur der Mitarbeiter selbst kann das Dokument bestätigen' });
    }

    // Aktuell nur Info-Schreiben als signier-bar
    if (document.documentType.name !== 'Info-Schreiben') {
      return res.status(400).json({ error: 'Dieser Dokumenttyp kann nicht digital bestätigt werden' });
    }

    if (document.signedAt) {
      return res.status(409).json({ error: 'Dokument wurde bereits bestätigt' });
    }

    // Passwort prüfen
    if (!document.employee.passwordHash) {
      return res.status(400).json({ error: 'Kein Passwort gesetzt — Signatur nicht möglich' });
    }
    const ok = await bcrypt.compare(password, document.employee.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Passwort nicht korrekt' });
    }

    const signedAt = new Date();
    // req.ip gibt die echte Client-IP, wenn trust proxy gesetzt ist
    const ip = req.ip || req.socket.remoteAddress || null;

    // PDF mit Signatur-Block neu rendern und bestehende verschlüsselte Datei ersetzen
    const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    if (!settings || !settings.employeeInfoTemplate) {
      return res.status(500).json({ error: 'Vorlage nicht mehr verfügbar' });
    }

    // WorkCategory vorab laden (falls vorhanden)
    const workCategory = document.employee.workCategoryId
      ? await prisma.workCategory.findUnique({
          where: { id: document.employee.workCategoryId },
          select: { name: true, earliestClockIn: true },
        })
      : null;

    const absEncryptedPath = path.join(process.cwd(), document.filePath);
    const dir = path.dirname(absEncryptedPath);
    const tempPdfPath = path.join(dir, `sign-${Date.now()}.pdf`);

    try {
      await renderEmployeeInfoPDF(
        {
          firstName: document.employee.firstName,
          lastName: document.employee.lastName,
          employeeNumber: document.employee.employeeNumber,
          email: document.employee.email,
          phone: document.employee.phone,
          rfidCard: document.employee.rfidCard,
          weeklyHours: document.employee.weeklyHours,
          vacationDaysPerYear: document.employee.vacationDaysPerYear,
          workDays: document.employee.workDays,
          startDate: document.employee.startDate,
          defaultClockOut: document.employee.defaultClockOut,
          workCategory,
        },
        {
          companyName: settings.companyName,
          companyAddress: settings.companyAddress,
          companyPhone: settings.companyPhone,
          companyEmail: settings.companyEmail,
        },
        settings.employeeInfoTemplate,
        tempPdfPath,
        {
          signedAt,
          signedByName: `${document.employee.firstName} ${document.employee.lastName}`,
          signedIp: ip,
        },
      );

      // Alte verschlüsselte Datei ersetzen
      if (fs.existsSync(absEncryptedPath)) fs.unlinkSync(absEncryptedPath);
      encryptFile(tempPdfPath, absEncryptedPath);
      fs.unlinkSync(tempPdfPath);

      const newSize = fs.statSync(absEncryptedPath).size;

      const updated = await prisma.document.update({
        where: { id },
        data: {
          signedAt,
          signedIp: ip,
          fileSize: newSize,
        },
        include: { documentType: { select: { id: true, name: true, shortName: true, color: true } } },
      });

      await createAuditLog({
        req,
        action: 'UPDATE',
        entityType: 'Document',
        entityId: id,
        note: `Dokument "${document.originalFilename}" digital bestätigt`,
        newValues: { signedAt: signedAt.toISOString(), signedIp: ip },
      });

      io.emit('document-updated', { type: 'sign', employeeId: document.employeeId, documentId: id });

      res.json(updated);
    } catch (renderErr) {
      console.error('Sign render error:', renderErr);
      if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
      return res.status(500).json({ error: 'Fehler beim Erstellen des signierten PDFs' });
    }
  } catch (error) {
    console.error('Sign document error:', error);
    res.status(500).json({ error: 'Fehler bei der Signatur' });
  }
});

export default router;
