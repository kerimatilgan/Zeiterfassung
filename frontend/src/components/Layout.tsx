import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useQuery } from '@tanstack/react-query';
import { complaintsApi } from '../lib/api';
import {
  LayoutDashboard,
  Users,
  Clock,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Shield,
  UserCog,
  FolderOpen,
  MessageSquare,
} from 'lucide-react';
import { useState } from 'react';
import { useSocket } from '../hooks/useSocket';

interface LayoutProps {
  isAdmin?: boolean;
}

export default function Layout({ isAdmin = false }: LayoutProps) {
  const { employee, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // WebSocket-Verbindung für Echtzeit-Updates
  useSocket();

  // Offene Reklamationen abfragen (nur für Admin)
  const { data: pendingComplaints } = useQuery({
    queryKey: ['pendingComplaints'],
    queryFn: () => complaintsApi.getPendingCount().then((r) => r.data),
    enabled: isAdmin,
    refetchInterval: 30000, // Alle 30 Sekunden aktualisieren
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const pendingCount = pendingComplaints?.count ?? 0;

  const adminLinks = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/admin/employees', icon: Users, label: 'Mitarbeiter' },
    { to: '/admin/time-entries', icon: Clock, label: 'Zeiteinträge' },
    { to: '/admin/complaints', icon: MessageSquare, label: 'Reklamationen', badge: pendingCount > 0 ? pendingCount : undefined },
    { to: '/admin/reports', icon: FileText, label: 'Abrechnungen' },
    { to: '/admin/settings', icon: Settings, label: 'Einstellungen' },
    { to: '/admin/account', icon: UserCog, label: 'Mein Konto' },
    { to: '/admin/audit-logs', icon: Shield, label: 'Audit-Log' },
  ];

  const employeeLinks = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/dashboard/timesheet', icon: Clock, label: 'Meine Zeiten' },
    { to: '/dashboard/reports', icon: FileText, label: 'Abrechnungen' },
    { to: '/dashboard/documents', icon: FolderOpen, label: 'Dokumente' },
    { to: '/dashboard/complaints', icon: MessageSquare, label: 'Reklamationen' },
    { to: '/dashboard/settings', icon: Settings, label: 'Einstellungen' },
  ];

  const links = isAdmin ? adminLinks : employeeLinks;

  return (
    <div className="min-h-screen flex">
      {/* Mobile Menu Button (nur wenn Sidebar geschlossen) */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md"
        >
          <Menu size={24} />
        </button>
      )}

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky lg:top-0 inset-y-0 left-0 z-40 w-64 h-screen bg-white border-r border-gray-200
          transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo + Mobile Close Button */}
          <div className="p-6 border-b border-gray-200 flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-primary-600">Handy-Insel</h1>
              <p className="text-sm text-gray-500">Zeiterfassung</p>
            </div>
            {/* Mobile Close Button */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
            >
              <X size={24} />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`
                }
              >
                <link.icon size={20} />
                <span className="flex-1">{link.label}</span>
                {'badge' in link && link.badge != null && (
                  <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-white bg-red-500 rounded-full animate-pulse">
                    {(link.badge as number) > 9 ? '9+' : (link.badge as React.ReactNode)}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {/* User Info & Logout */}
          <div className="p-4 border-t border-gray-200">
            <div className="mb-3">
              <p className="font-medium text-gray-900">
                {employee?.firstName} {employee?.lastName}
              </p>
              <p className="text-sm text-gray-500">
                {employee?.isAdmin ? 'Administrator' : 'Mitarbeiter'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={20} />
              Abmelden
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-0">
        <div className="p-4 lg:p-8 pt-16 lg:pt-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
