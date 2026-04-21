import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Formatiert Zahlen im deutschen Format (Komma als Dezimaltrennzeichen)
export const formatNumber = (value: number, decimals: number = 2): string => {
  return value.toFixed(decimals).replace('.', ',');
};

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor für Auth Token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor für Auth Errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Nicht auf Login-/Auth-Endpunkten redirecten - dort wird der Fehler direkt angezeigt
      const url = error.config?.url || '';
      if (!url.includes('/auth/login') && !url.includes('/auth/forgot') && !url.includes('/2fa/')) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  validateResetToken: (token: string) =>
    api.get('/auth/reset-password/validate', { params: { token } }),
  resetPassword: (token: string, newPassword: string) =>
    api.post('/auth/reset-password', { token, newPassword }),
  adminResetPassword: (employeeId: string) =>
    api.post('/auth/admin-reset-password', { employeeId }),
};

// Employees
export const employeesApi = {
  getAll: () => api.get('/employees'),
  getOne: (id: string) => api.get(`/employees/${id}`),
  create: (data: any) => api.post('/employees', data),
  update: (id: string, data: any) => api.put(`/employees/${id}`, data),
  delete: (id: string) => api.delete(`/employees/${id}`),
  // RFID-Karten
  registerRfid: (id: string, rfidCard: string) => api.post(`/employees/${id}/register-rfid`, { rfidCard }),
  removeRfid: (id: string) => api.delete(`/employees/${id}/rfid`),
  // Fotos
  uploadPhoto: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    return api.post(`/employees/${id}/photo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deletePhoto: (id: string) => api.delete(`/employees/${id}/photo`),
};

// Terminal (RFID Registration)
export const terminalApi = {
  startRfidRegistration: (employeeId: string, socketId: string) =>
    api.post('/terminal/register-rfid/start', { employeeId, socketId }),
  stopRfidRegistration: () => api.post('/terminal/register-rfid/stop'),
  getRegistrationStatus: () => api.get('/terminal/register-rfid/status'),
  startRfidLookup: (socketId: string) =>
    api.post('/terminal/lookup-rfid/start', { socketId }),
  stopRfidLookup: () => api.post('/terminal/lookup-rfid/stop'),
};

// Time Entries
export const timeEntriesApi = {
  getMy: (params?: { from?: string; to?: string }) => api.get('/time-entries/my', { params }),
  getMyStatus: () => api.get('/time-entries/my/status'),
  getMyStats: () => api.get('/time-entries/my/stats'),
  getAll: (params?: { employeeId?: string; from?: string; to?: string }) =>
    api.get('/time-entries', { params }),
  createManual: (data: any) => api.post('/time-entries/manual', data),
  update: (id: string, data: any) => api.put(`/time-entries/${id}`, data),
  delete: (id: string) => api.delete(`/time-entries/${id}`),
  insertPause: (id: string, data: { pauseStart: string; pauseEnd: string }) =>
    api.post(`/time-entries/${id}/insert-pause`, data),
  // PWA-Stempelung
  pwaClockIn: (data: { latitude: number; longitude: number; reasonId?: string; reasonText?: string }) =>
    api.post('/time-entries/pwa/clock-in', data),
  pwaClockOut: (data: { latitude: number; longitude: number; reasonId?: string; reasonText?: string }) =>
    api.post('/time-entries/pwa/clock-out', data),
  getPwaReasons: () => api.get('/time-entries/pwa/reasons'),
  getPwaPermissions: () => api.get('/time-entries/pwa/permissions'),
  // Urlaub
  getMyWeekTargets: (from: string) => api.get('/time-entries/my/week-targets', { params: { from } }),
  getMyVacationDetails: (year?: number) => api.get('/time-entries/my/vacation-details', { params: { year } }),
  getVacationDetails: (employeeId: string, year?: number) => api.get(`/time-entries/vacation-details/${employeeId}`, { params: { year } }),
  getTargetHours: (employeeId: string, year: number, month: number) =>
    api.get<{ monthlyTarget: number; monthlyTargetUntilToday: number; dailyHours: number }>(
      `/time-entries/target-hours/${employeeId}`, { params: { year, month } }),
  // Reklamationen
  getMyComplaints: () => api.get('/time-entries/my/complaints'),
  createComplaint: (id: string, message: string) =>
    api.post(`/time-entries/${id}/complaint`, { message }),
  createStandaloneComplaint: (date: string, message: string) =>
    api.post('/time-entries/complaint/standalone', { date, message }),
  // Urlaubsanpassungen
  getVacationAdjustments: (employeeId: string, year?: number) =>
    api.get(`/time-entries/vacation-adjustments/${employeeId}`, { params: { year } }),
  createVacationAdjustment: (data: { employeeId: string; year: number; month: number; days: number; reason: string }) =>
    api.post('/time-entries/vacation-adjustments', data),
  deleteVacationAdjustment: (id: string) =>
    api.delete(`/time-entries/vacation-adjustments/${id}`),
  deleteComplaint: (id: string) => api.delete(`/time-entries/${id}/complaint`),
  resolveComplaint: (id: string, response?: string) =>
    api.post(`/time-entries/${id}/complaint/resolve`, { response }),
  getFlagged: (params?: { resolved?: boolean; from?: string; to?: string }) =>
    api.get('/time-entries/flagged', { params }),
  getPendingComplaints: (limit?: number) =>
    api.get('/time-entries/complaints/pending', { params: { limit } }),
};

// Reklamationen (neue API mit Historie)
export const complaintsApi = {
  getMy: () => api.get('/complaints/my'),
  getByEntry: (timeEntryId: string) => api.get(`/complaints/by-entry/${timeEntryId}`),
  create: (data: { timeEntryId?: string | null; date?: string; message: string }) =>
    api.post('/complaints', data),
  delete: (id: string) => api.delete(`/complaints/${id}`),
  // Admin
  getAll: (params?: { resolved?: boolean; employeeId?: string; from?: string; to?: string }) =>
    api.get('/complaints/all', { params }),
  getPendingCount: () => api.get('/complaints/pending/count'),
  resolve: (id: string, data: { response?: string; applyChanges?: { clockIn?: string; clockOut?: string | null; breakMinutes?: number } }) =>
    api.post(`/complaints/${id}/resolve`, data),
};

// Reports
export const reportsApi = {
  getMy: () => api.get('/reports/my'),
  getAll: (params?: { year?: number; month?: number; employeeId?: string }) =>
    api.get('/reports', { params }),
  preview: (employeeId: string, year: number, month: number) =>
    api.get(`/reports/preview/${employeeId}/${year}/${month}`),
  create: (data: { employeeId: string; year: number; month: number; notes?: string }) =>
    api.post('/reports/create', data),
  finalize: (id: string) => api.post(`/reports/${id}/finalize`),
  recalculate: (id: string) => api.post(`/reports/${id}/recalculate`),
  downloadPdf: (id: string) => api.get(`/reports/${id}/pdf`, { responseType: 'blob' }),
  previewPdf: (id: string) => api.get(`/reports/${id}/preview-pdf`, { responseType: 'blob' }),
  delete: (id: string) => api.delete(`/reports/${id}`),
};

// Settings
export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data: any) => api.put('/settings', data),
  getDashboardStats: () => api.get('/settings/dashboard-stats'),
  getCurrentlyClockedIn: () => api.get('/settings/currently-clocked-in'),
  getEntriesToday: () => api.get('/settings/entries-today'),
  getHolidays: (year?: number) => api.get('/settings/holidays', { params: { year } }),
  createHoliday: (data: any) => api.post('/settings/holidays', data),
  deleteHoliday: (id: string) => api.delete(`/settings/holidays/${id}`),
  generateHolidays: (data: { year: number; bundesland?: string; deleteExisting?: boolean }) =>
    api.post('/settings/holidays/generate', data),
  getBundeslandInfo: () => api.get('/settings/holidays/bundesland-info'),
  getBundeslaender: () => api.get('/settings/holidays/bundeslaender'),
  // Abwesenheitstypen
  getAbsenceTypes: () => api.get('/settings/absence-types'),
  getAllAbsenceTypes: () => api.get('/settings/absence-types/all'),
  createAbsenceType: (data: any) => api.post('/settings/absence-types', data),
  updateAbsenceType: (id: string, data: any) => api.put(`/settings/absence-types/${id}`, data),
  deleteAbsenceType: (id: string) => api.delete(`/settings/absence-types/${id}`),
  // Arbeitskategorien
  getWorkCategories: () => api.get('/settings/work-categories'),
  getAllWorkCategories: () => api.get('/settings/work-categories/all'),
  createWorkCategory: (data: any) => api.post('/settings/work-categories', data),
  updateWorkCategory: (id: string, data: any) => api.put(`/settings/work-categories/${id}`, data),
  deleteWorkCategory: (id: string) => api.delete(`/settings/work-categories/${id}`),
  // Terminals
  getTerminals: () => api.get('/settings/terminals'),
  createTerminal: (data: { name: string }) => api.post('/settings/terminals', data),
  updateTerminal: (id: string, data: any) => api.put(`/settings/terminals/${id}`, data),
  deleteTerminal: (id: string) => api.delete(`/settings/terminals/${id}`),
  regenerateTerminalKey: (id: string) => api.post(`/settings/terminals/${id}/regenerate-key`),
  downloadTerminalInstallScript: (id: string) => api.get(`/settings/terminals/${id}/install-script`, { responseType: 'blob' }),
  // Mitarbeiter-Abwesenheiten
  getAbsences: (params?: { employeeId?: string; from?: string; to?: string }) =>
    api.get('/settings/absences', { params }),
  createAbsence: (data: any) => api.post('/settings/absences', data),
  createAbsencesBulk: (data: { employeeId: string; absenceTypeId: string; dates: string[]; note?: string }) =>
    api.post('/settings/absences/bulk', data),
  deleteAbsencesBulk: (ids: string[]) => api.post('/settings/absences/bulk-delete', { ids }),
  updateAbsence: (id: string, data: any) => api.put(`/settings/absences/${id}`, data),
  deleteAbsence: (id: string) => api.delete(`/settings/absences/${id}`),
  // Daten-Import
  getInitialBalances: () => api.get('/settings/initial-balances'),
  setInitialBalance: (id: string, data: any) => api.put(`/settings/initial-balances/${id}`, data),
  importCsvBalances: (entries: any[]) => api.post('/settings/initial-balances/import-csv', { entries }),
  // PWA-Stempel-Gründe
  getPwaReasons: () => api.get('/settings/pwa-reasons'),
  createPwaReason: (name: string) => api.post('/settings/pwa-reasons', { name }),
  updatePwaReason: (id: string, data: any) => api.put(`/settings/pwa-reasons/${id}`, data),
  deletePwaReason: (id: string) => api.delete(`/settings/pwa-reasons/${id}`),
  // Dokumenttypen
  getDocumentTypes: () => api.get('/settings/document-types'),
  getAllDocumentTypes: () => api.get('/settings/document-types/all'),
  createDocumentType: (data: any) => api.post('/settings/document-types', data),
  updateDocumentType: (id: string, data: any) => api.put(`/settings/document-types/${id}`, data),
  deleteDocumentType: (id: string) => api.delete(`/settings/document-types/${id}`),
  // Terminal-Logo
  getTerminalLogo: () => api.get('/settings/terminal-logo'),
  uploadTerminalLogo: (file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return api.post('/settings/terminal-logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteTerminalLogo: () => api.delete('/settings/terminal-logo'),
  // Datenbank-Verwaltung
  getDatabaseInfo: () => api.get('/settings/database/info'),
  downloadBackup: () => api.get('/settings/database/backup', { responseType: 'blob' }),
  restoreDatabase: (file: File) => {
    const formData = new FormData();
    formData.append('database', file);
    return api.post('/settings/database/restore', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // Mail-Server Einstellungen
  getMailSettings: () => api.get('/settings/mail'),
  updateMailSettings: (data: any) => api.put('/settings/mail', data),
  testMailSettings: (testEmail: string) => api.post('/settings/mail/test', { testEmail }),
};

// 2FA / Passkeys
export const twoFactorApi = {
  // Status
  getStatus: () => api.get('/2fa/status'),
  getAdminStatus: (employeeId: string) => api.get(`/2fa/admin/status/${employeeId}`),
  // TOTP
  totpSetup: () => api.post('/2fa/totp/setup'),
  totpVerifySetup: (code: string) => api.post('/2fa/totp/verify-setup', { code }),
  totpDisable: (code: string) => api.post('/2fa/totp/disable', { code }),
  totpValidate: (tempToken: string, code: string) =>
    api.post('/2fa/totp/validate', { tempToken, code }),
  // Passkeys
  passkeyRegisterOptions: () => api.post('/2fa/passkey/register-options'),
  passkeyRegisterVerify: (credential: any, deviceName: string) =>
    api.post('/2fa/passkey/register-verify', { credential, deviceName }),
  passkeyList: () => api.get('/2fa/passkey/list'),
  passkeyDelete: (id: string) => api.delete(`/2fa/passkey/${id}`),
  passkeyAuthOptions: () => api.post('/2fa/passkey/auth-options'),
  passkeyAuthVerify: (credential: any) =>
    api.post('/2fa/passkey/auth-verify', { credential }),
  // Admin
  adminDisableTotp: (employeeId: string) =>
    api.post('/2fa/admin/disable-totp', { employeeId }),
  adminDeletePasskey: (id: string) => api.delete(`/2fa/admin/passkey/${id}`),
};

// Audit Logs
export const auditLogsApi = {
  getAll: (params?: {
    page?: number;
    limit?: number;
    action?: string;
    entityType?: string;
    userId?: string;
    from?: string;
    to?: string;
    search?: string;
  }) => api.get('/audit-logs', { params }),
  getOne: (id: string) => api.get(`/audit-logs/${id}`),
  getStats: () => api.get('/audit-logs/stats/summary'),
  getFilterOptions: () => api.get('/audit-logs/filters/options'),
};

// Documents
export const documentsApi = {
  getMy: (params?: { documentTypeId?: string; year?: number; month?: number }) =>
    api.get('/documents/my', { params }),
  getForEmployee: (employeeId: string) => api.get(`/documents/employee/${employeeId}`),
  upload: (employeeId: string, file: File, metadata: { documentTypeId: string; year?: number; month?: number; note?: string }) => {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('documentTypeId', metadata.documentTypeId);
    if (metadata.year) formData.append('year', String(metadata.year));
    if (metadata.month) formData.append('month', String(metadata.month));
    if (metadata.note) formData.append('note', metadata.note);
    return api.post(`/documents/employee/${employeeId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  download: (id: string) => api.get(`/documents/${id}/download`, { responseType: 'blob' }),
  update: (id: string, data: any) => api.put(`/documents/${id}`, data),
  delete: (id: string) => api.delete(`/documents/${id}`),
};

export const backupApi = {
  // Ziele
  getTargets: () => api.get('/backup/targets'),
  getTargetConfig: (id: string) => api.get(`/backup/targets/${id}/config`),
  createTarget: (data: any) => api.post('/backup/targets', data),
  updateTarget: (id: string, data: any) => api.put(`/backup/targets/${id}`, data),
  deleteTarget: (id: string) => api.delete(`/backup/targets/${id}`),
  testTarget: (id: string) => api.post(`/backup/targets/${id}/test`),
  testConfig: (type: string, config: any) => api.post('/backup/test-config', { type, config }),
  // OAuth
  startOAuth: (data: { provider: string; clientId: string; clientSecret: string; tenantId?: string }) =>
    api.post('/backup/oauth/start', data),
  getOAuthResult: (state: string) => api.get(`/backup/oauth/result/${state}`),
  // Einstellungen
  getSettings: () => api.get('/backup/settings'),
  updateSettings: (data: any) => api.put('/backup/settings', data),
  // Operationen
  runBackup: () => api.post('/backup/run'),
  getStatus: () => api.get('/backup/status'),
  cleanup: () => api.post('/backup/cleanup'),
  // Verlauf
  getHistory: (params?: { page?: number; limit?: number; targetId?: string }) =>
    api.get('/backup/history', { params }),
  downloadBackup: (id: string) => api.get(`/backup/download/${id}`, { responseType: 'blob' }),
  deleteRecord: (id: string) => api.delete(`/backup/history/${id}`),
};

export default api;
