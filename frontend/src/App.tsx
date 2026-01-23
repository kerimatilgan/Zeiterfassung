import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import AdminDashboard from './pages/admin/Dashboard';
import AdminEmployees from './pages/admin/Employees';
import AdminReports from './pages/admin/Reports';
import AdminSettings from './pages/admin/Settings';
import AdminAuditLogs from './pages/admin/AuditLogs';
import EmployeeDashboard from './pages/employee/Dashboard';
import EmployeeTimesheet from './pages/employee/Timesheet';
import EmployeeReports from './pages/employee/Reports';
import EmployeeSettings from './pages/employee/Settings';
import Layout from './components/Layout';

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { isAuthenticated, employee } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !employee?.isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function App() {
  const { isAuthenticated, employee } = useAuthStore();

  return (
    <Routes>
      <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to={employee?.isAdmin ? '/admin' : '/dashboard'} />} />

      {/* Admin Routes */}
      <Route path="/admin" element={
        <ProtectedRoute adminOnly>
          <Layout isAdmin />
        </ProtectedRoute>
      }>
        <Route index element={<AdminDashboard />} />
        <Route path="employees" element={<AdminEmployees />} />
        <Route path="time-entries" element={<Navigate to="/admin/employees" replace />} />
        <Route path="reports" element={<AdminReports />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="audit-logs" element={<AdminAuditLogs />} />
      </Route>

      {/* Employee Routes */}
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<EmployeeDashboard />} />
        <Route path="timesheet" element={<EmployeeTimesheet />} />
        <Route path="reports" element={<EmployeeReports />} />
        <Route path="settings" element={<EmployeeSettings />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
