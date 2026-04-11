import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Employee {
  id: string;
  employeeNumber: string;
  username: string | null;
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
  // 2FA pending state (not persisted)
  pending2FA: { tempToken: string; methods: string[] } | null;
  login: (token: string, employee: Employee) => void;
  logout: () => void;
  setPending2FA: (data: { tempToken: string; methods: string[] } | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      employee: null,
      isAuthenticated: false,
      pending2FA: null,
      login: (token, employee) => set({ token, employee, isAuthenticated: true, pending2FA: null }),
      logout: () => set({ token: null, employee: null, isAuthenticated: false, pending2FA: null }),
      setPending2FA: (data) => set({ pending2FA: data }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        employee: state.employee,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
