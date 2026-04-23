import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import * as otplib from 'otplib';
import QRCode from 'qrcode';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { prisma } from '../index.js';
import { authMiddleware, AuthRequest, generateToken } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLog.js';

const router = Router();
const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET env var missing or too short');
  return s;
})();

// In-memory challenge store (adequate for single-server PM2)
const challengeStore = new Map<string, { challenge: string; timestamp: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of challengeStore) {
    if (now - val.timestamp > 5 * 60 * 1000) challengeStore.delete(key);
  }
}, 5 * 60 * 1000);

// Helper: RP config from request
function getRpId(req: any): string {
  const origin = req.get('origin') || '';
  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return req.hostname || 'localhost';
  }
}

function getRpOrigin(req: any): string {
  const origin = req.get('origin');
  if (origin) return origin;
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

// ============================================================
// TOTP ENDPOINTS
// ============================================================

// Setup TOTP - generates secret + QR code
router.post('/totp/setup', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { id: true, firstName: true, lastName: true, email: true, totpEnabled: true, totpSecret: true },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    if (employee.totpEnabled) {
      return res.status(400).json({ error: '2FA ist bereits aktiviert' });
    }

    // Generate new secret
    const secret = otplib.generateSecret();

    // Store secret (not yet enabled)
    await prisma.employee.update({
      where: { id: employee.id },
      data: { totpSecret: secret },
    });

    // Generate QR code
    const accountName = employee.email || `${employee.firstName}.${employee.lastName}`;
    const otpauthUri = otplib.generateURI({ issuer: 'Zeiterfassung', label: accountName, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

    res.json({ secret, qrCodeDataUrl, otpauthUri });
  } catch (error) {
    console.error('TOTP setup error:', error);
    res.status(500).json({ error: 'Fehler beim Einrichten von 2FA' });
  }
});

// Verify TOTP setup - activates 2FA
router.post('/totp/verify-setup', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code erforderlich' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { id: true, firstName: true, lastName: true, totpSecret: true, totpEnabled: true },
    });

    if (!employee || !employee.totpSecret) {
      return res.status(400).json({ error: 'Kein TOTP-Secret vorhanden. Bitte zuerst Setup starten.' });
    }

    if (employee.totpEnabled) {
      return res.status(400).json({ error: '2FA ist bereits aktiviert' });
    }

    const isValid = otplib.verifySync({ token: code, secret: employee.totpSecret });
    if (!isValid) {
      return res.status(400).json({ error: 'Ungültiger Code. Bitte erneut versuchen.' });
    }

    await prisma.employee.update({
      where: { id: employee.id },
      data: { totpEnabled: true },
    });

    await createAuditLog({
      req,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'CREATE',
      entityType: 'Employee',
      entityId: employee.id,
      note: '2FA (TOTP) aktiviert',
    });

    res.json({ message: '2FA erfolgreich aktiviert' });
  } catch (error) {
    console.error('TOTP verify-setup error:', error);
    res.status(500).json({ error: 'Fehler beim Aktivieren von 2FA' });
  }
});

// Disable TOTP (user self-service, requires current code)
router.post('/totp/disable', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code erforderlich' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { id: true, firstName: true, lastName: true, totpSecret: true, totpEnabled: true },
    });

    if (!employee || !employee.totpEnabled || !employee.totpSecret) {
      return res.status(400).json({ error: '2FA ist nicht aktiviert' });
    }

    const isValid = otplib.verifySync({ token: code, secret: employee.totpSecret });
    if (!isValid) {
      return res.status(400).json({ error: 'Ungültiger Code' });
    }

    await prisma.employee.update({
      where: { id: employee.id },
      data: { totpEnabled: false, totpSecret: null },
    });

    await createAuditLog({
      req,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'DELETE',
      entityType: 'Employee',
      entityId: employee.id,
      note: '2FA (TOTP) deaktiviert',
    });

    res.json({ message: '2FA deaktiviert' });
  } catch (error) {
    console.error('TOTP disable error:', error);
    res.status(500).json({ error: 'Fehler beim Deaktivieren von 2FA' });
  }
});

// Validate TOTP during login (no JWT - uses tempToken)
router.post('/totp/validate', async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Token und Code erforderlich' });
    }

    // Verify temp token
    let decoded: { id: string; purpose: string };
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET) as any;
    } catch {
      return res.status(401).json({ error: 'Ungültiges oder abgelaufenes Token' });
    }

    if (decoded.purpose !== '2fa') {
      return res.status(401).json({ error: 'Ungültiges Token' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: decoded.id },
    });

    if (!employee || !employee.isActive || !employee.totpEnabled || !employee.totpSecret) {
      return res.status(401).json({ error: 'Ungültige Anfrage' });
    }

    const isValid = otplib.verifySync({ token: code, secret: employee.totpSecret });
    if (!isValid) {
      return res.status(401).json({ error: 'Ungültiger Code' });
    }

    // Issue real JWT
    const token = generateToken(employee);

    await createAuditLog({
      req,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'LOGIN',
      entityType: 'Employee',
      entityId: employee.id,
      note: 'Login mit 2FA',
    });

    res.json({
      token,
      employee: {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        username: employee.username,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        weeklyHours: employee.weeklyHours,
        vacationDaysPerYear: employee.vacationDaysPerYear,
        workDays: employee.workDays,
        isAdmin: employee.isAdmin,
      },
    });
  } catch (error) {
    console.error('TOTP validate error:', error);
    res.status(500).json({ error: 'Fehler bei der 2FA-Validierung' });
  }
});

// ============================================================
// PASSKEY (WebAuthn) ENDPOINTS
// ============================================================

// Generate registration options (authenticated user)
router.post('/passkey/register-options', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { id: true, firstName: true, lastName: true, username: true, passkeys: true },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    const rpId = getRpId(req);

    const options = await generateRegistrationOptions({
      rpName: 'Zeiterfassung',
      rpID: rpId,
      userID: new TextEncoder().encode(employee.id),
      userName: employee.username || `${employee.firstName}.${employee.lastName}`,
      userDisplayName: `${employee.firstName} ${employee.lastName}`,
      attestationType: 'none',
      excludeCredentials: employee.passkeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports ? JSON.parse(pk.transports) : undefined,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge
    challengeStore.set(`reg_${employee.id}`, {
      challenge: options.challenge,
      timestamp: Date.now(),
    });

    res.json(options);
  } catch (error) {
    console.error('Passkey register-options error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Passkey-Optionen' });
  }
});

// Verify registration response
router.post('/passkey/register-verify', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { credential, deviceName } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Credential erforderlich' });
    }

    const employeeId = req.employee!.id;
    const stored = challengeStore.get(`reg_${employeeId}`);
    if (!stored) {
      return res.status(400).json({ error: 'Keine ausstehende Registrierung' });
    }

    const rpId = getRpId(req);
    const expectedOrigin = getRpOrigin(req);

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: expectedOrigin,
      expectedRPID: rpId,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey-Registrierung fehlgeschlagen' });
    }

    const regInfo = verification.registrationInfo;

    // Save passkey
    await prisma.passkey.create({
      data: {
        employeeId,
        credentialId: regInfo!.credential.id,
        publicKey: Buffer.from(regInfo!.credential.publicKey).toString('base64url'),
        counter: regInfo!.credential.counter,
        deviceName: deviceName || 'Unbenannter Passkey',
        transports: credential.response?.transports ? JSON.stringify(credential.response.transports) : null,
      },
    });

    challengeStore.delete(`reg_${employeeId}`);

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true },
    });

    await createAuditLog({
      req,
      userId: employeeId,
      userName: employee ? `${employee.firstName} ${employee.lastName}` : undefined,
      action: 'CREATE',
      entityType: 'Employee',
      entityId: employeeId,
      note: `Passkey "${deviceName || 'Unbenannt'}" registriert`,
    });

    res.json({ message: 'Passkey erfolgreich registriert' });
  } catch (error) {
    console.error('Passkey register-verify error:', error);
    res.status(500).json({ error: 'Fehler bei der Passkey-Registrierung' });
  }
});

// List passkeys for current user
router.get('/passkey/list', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const passkeys = await prisma.passkey.findMany({
      where: { employeeId: req.employee!.id },
      select: { id: true, deviceName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(passkeys);
  } catch (error) {
    console.error('Passkey list error:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Passkeys' });
  }
});

// Delete passkey
router.delete('/passkey/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const passkey = await prisma.passkey.findUnique({ where: { id: req.params.id } });
    if (!passkey || passkey.employeeId !== req.employee!.id) {
      return res.status(404).json({ error: 'Passkey nicht gefunden' });
    }

    await prisma.passkey.delete({ where: { id: req.params.id } });

    await createAuditLog({
      req,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'DELETE',
      entityType: 'Employee',
      entityId: req.employee!.id,
      note: `Passkey "${passkey.deviceName}" gelöscht`,
    });

    res.json({ message: 'Passkey gelöscht' });
  } catch (error) {
    console.error('Passkey delete error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Passkeys' });
  }
});

// Generate authentication options (no JWT - pre-auth)
router.post('/passkey/auth-options', async (req, res) => {
  try {
    const rpId = getRpId(req);

    // Get all active passkeys for discoverable credential auth
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'preferred',
    });

    challengeStore.set(`auth_${options.challenge}`, {
      challenge: options.challenge,
      timestamp: Date.now(),
    });

    res.json(options);
  } catch (error) {
    console.error('Passkey auth-options error:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen der Authentifizierungs-Optionen' });
  }
});

// Verify authentication response (no JWT - pre-auth)
router.post('/passkey/auth-verify', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Credential erforderlich' });
    }

    // Find the passkey by credential ID
    const passkey = await prisma.passkey.findUnique({
      where: { credentialId: credential.id },
      include: { employee: true },
    });

    if (!passkey || !passkey.employee.isActive) {
      return res.status(401).json({ error: 'Passkey nicht gefunden oder Benutzer inaktiv' });
    }

    const rpId = getRpId(req);
    const expectedOrigin = getRpOrigin(req);

    // Try all stored auth challenges to find the matching one
    let verified = false;
    let verificationResult: any = null;

    for (const [key, stored] of challengeStore.entries()) {
      if (!key.startsWith('auth_')) continue;
      try {
        const result = await verifyAuthenticationResponse({
          response: credential,
          expectedChallenge: stored.challenge,
          expectedOrigin: expectedOrigin,
          expectedRPID: rpId,
          credential: {
            id: passkey.credentialId,
            publicKey: Buffer.from(passkey.publicKey, 'base64url'),
            counter: passkey.counter,
            transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
          },
          requireUserVerification: false,
        });
        if (result.verified) {
          verified = true;
          verificationResult = result;
          challengeStore.delete(key);
          break;
        }
      } catch {
        continue;
      }
    }

    if (!verified || !verificationResult) {
      return res.status(401).json({ error: 'Passkey-Authentifizierung fehlgeschlagen' });
    }

    // Update counter
    await prisma.passkey.update({
      where: { id: passkey.id },
      data: { counter: verificationResult.authenticationInfo.newCounter },
    });

    const employee = passkey.employee;

    // Issue JWT
    const token = generateToken(employee);

    await createAuditLog({
      req,
      userId: employee.id,
      userName: `${employee.firstName} ${employee.lastName}`,
      action: 'LOGIN',
      entityType: 'Employee',
      entityId: employee.id,
      note: `Login mit Passkey "${passkey.deviceName}"`,
    });

    res.json({
      token,
      employee: {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        username: employee.username,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        weeklyHours: employee.weeklyHours,
        vacationDaysPerYear: employee.vacationDaysPerYear,
        workDays: employee.workDays,
        isAdmin: employee.isAdmin,
      },
    });
  } catch (error) {
    console.error('Passkey auth-verify error:', error);
    res.status(500).json({ error: 'Fehler bei der Passkey-Authentifizierung' });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// Admin: Disable TOTP for a user
router.post('/admin/disable-totp', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.employee!.isAdmin) {
      return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
    }

    const { employeeId } = req.body;
    if (!employeeId) {
      return res.status(400).json({ error: 'Mitarbeiter-ID erforderlich' });
    }

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    await prisma.employee.update({
      where: { id: employeeId },
      data: { totpEnabled: false, totpSecret: null },
    });

    await createAuditLog({
      req,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: employeeId,
      note: `2FA für ${employee.firstName} ${employee.lastName} durch Admin deaktiviert`,
    });

    res.json({ message: `2FA für ${employee.firstName} ${employee.lastName} deaktiviert` });
  } catch (error) {
    console.error('Admin disable TOTP error:', error);
    res.status(500).json({ error: 'Fehler beim Deaktivieren von 2FA' });
  }
});

// Admin: Delete passkey for a user
router.delete('/admin/passkey/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.employee!.isAdmin) {
      return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
    }

    const passkey = await prisma.passkey.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    if (!passkey) {
      return res.status(404).json({ error: 'Passkey nicht gefunden' });
    }

    await prisma.passkey.delete({ where: { id: req.params.id } });

    await createAuditLog({
      req,
      userId: req.employee!.id,
      userName: `${req.employee!.firstName} ${req.employee!.lastName}`,
      action: 'DELETE',
      entityType: 'Employee',
      entityId: passkey.employeeId,
      note: `Passkey "${passkey.deviceName}" von ${passkey.employee.firstName} ${passkey.employee.lastName} durch Admin gelöscht`,
    });

    res.json({ message: 'Passkey gelöscht' });
  } catch (error) {
    console.error('Admin delete passkey error:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Passkeys' });
  }
});

// Get 2FA status for current user
router.get('/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.employee!.id },
      select: { totpEnabled: true, _count: { select: { passkeys: true } } },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    res.json({
      totpEnabled: employee.totpEnabled,
      passkeyCount: employee._count.passkeys,
    });
  } catch (error) {
    console.error('2FA status error:', error);
    res.status(500).json({ error: 'Fehler beim Laden des 2FA-Status' });
  }
});

// Get 2FA status for a specific employee (admin)
router.get('/admin/status/:employeeId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.employee!.isAdmin) {
      return res.status(403).json({ error: 'Admin-Berechtigung erforderlich' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: req.params.employeeId },
      select: {
        totpEnabled: true,
        passkeys: { select: { id: true, deviceName: true, createdAt: true } },
      },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden' });
    }

    res.json({
      totpEnabled: employee.totpEnabled,
      passkeys: employee.passkeys,
    });
  } catch (error) {
    console.error('Admin 2FA status error:', error);
    res.status(500).json({ error: 'Fehler beim Laden des 2FA-Status' });
  }
});

export default router;
