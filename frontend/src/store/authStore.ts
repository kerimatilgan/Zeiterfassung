import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  weeklyHours: number;
  vacationDaysPerYear: number;
  workDays: string;
  isAdmin: boolean;
}

interface AuthState {
  token: string | null;
  employee: Employee | null;
  isAuthenticated: boolean;
  login: (token: string, employee: Employee) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      employee: null,
      isAuthenticated: false,
      login: (token, employee) => set({ token, employee, isAuthenticated: true }),
      logout: () => set({ token: null, employee: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
    }
  )
);
