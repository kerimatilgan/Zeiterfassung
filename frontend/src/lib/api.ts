import axios from 'axios';
import { useAuthStore } from '../store/authStore';

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
  downloadPdf: (id: string) => api.get(`/reports/${id}/pdf`, { responseType: 'blob' }),
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
};

export default api;
