import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SetupWizard from './pages/Setup';
import AdminDashboard from './pages/admin/Dashboard';
import AdminEmployees from './pages/admin/Employees';
import AdminTimeEntries from './pages/admin/TimeEntries';
import AdminReports from './pages/admin/Reports';
import AdminSettings from './pages/admin/Settings';
import AdminAuditLogs from './pages/admin/AuditLogs';
import EmployeeDashboard from './pages/employee/Dashboard';
import EmployeeTimesheet from './pages/employee/Timesheet';
import EmployeeReports from './pages/employee/Reports';
import EmployeeSettings from './pages/employee/Settings';
import EmployeeDocuments from './pages/employee/Documents';
import EmployeeComplaints from './pages/employee/Complaints';
import Layout from './components/Layout';
import api from './lib/api';

function ProtectedRoute({ children, adminOnly = false, employeeOnly = false }: { children: React.ReactNode; adminOnly?: boolean; employeeOnly?: boolean }) {
  const { isAuthenticated, employee } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !employee?.isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  // Admins haben keinen Zugang zum Mitarbeiter-Dashboard
  if (employeeOnly && employee?.isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}

function App() {
  const { isAuthenticated, employee } = useAuthStore();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    api.get('/setup/status').then(res => {
      setNeedsSetup(res.data.needsSetup);
    }).catch(() => setNeedsSetup(false));
  }, []);

  // Loading
  if (needsSetup === null) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>;
  }

  // Setup-Wizard
  if (needsSetup) {
    return <SetupWizard onComplete={() => setNeedsSetup(false)} />;
  }

  return (
    <Routes>
      <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to={employee?.isAdmin ? '/admin' : '/dashboard'} />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Admin Routes */}
      <Route path="/admin" element={
        <ProtectedRoute adminOnly>
          <Layout isAdmin />
        </ProtectedRoute>
      }>
        <Route index element={<AdminDashboard />} />
        <Route path="employees" element={<AdminEmployees />} />
        <Route path="time-entries" element={<AdminTimeEntries />} />
        <Route path="reports" element={<AdminReports />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="account" element={<EmployeeSettings />} />
        <Route path="audit-logs" element={<AdminAuditLogs />} />
      </Route>

      {/* Employee Routes - nicht für Admins */}
      <Route path="/dashboard" element={
        <ProtectedRoute employeeOnly>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<EmployeeDashboard />} />
        <Route path="timesheet" element={<EmployeeTimesheet />} />
        <Route path="reports" element={<EmployeeReports />} />
        <Route path="documents" element={<EmployeeDocuments />} />
        <Route path="complaints" element={<EmployeeComplaints />} />
        <Route path="settings" element={<EmployeeSettings />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
