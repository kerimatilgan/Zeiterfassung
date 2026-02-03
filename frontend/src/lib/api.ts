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
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  login: (employeeNumber: string, password: string) =>
    api.post('/auth/login', { employeeNumber, password }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

// Employees
export const employeesApi = {
  getAll: () => api.get('/employees'),
  getOne: (id: string) => api.get(`/employees/${id}`),
  create: (data: any) => api.post('/employees', data),
  update: (id: string, data: any) => api.put(`/employees/${id}`, data),
  delete: (id: string) => api.delete(`/employees/${id}`),
  regenerateQr: (id: string) => api.post(`/employees/${id}/regenerate-qr`),
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
  // Mitarbeiter-Abwesenheiten
  getAbsences: (params?: { employeeId?: string; from?: string; to?: string }) =>
    api.get('/settings/absences', { params }),
  createAbsence: (data: any) => api.post('/settings/absences', data),
  updateAbsence: (id: string, data: any) => api.put(`/settings/absences/${id}`, data),
  deleteAbsence: (id: string) => api.delete(`/settings/absences/${id}`),
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

export default api;
