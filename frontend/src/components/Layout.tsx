import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useQuery } from '@tanstack/react-query';
import { complaintsApi, settingsApi } from '../lib/api';
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
import ThemeToggle from './ThemeToggle';

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
    refetchInterval: 30000,
  });

  const { data: branding } = useQuery({
    queryKey: ['public-branding'],
    queryFn: () => settingsApi.getPublic().then((r) => r.data as { companyName: string }),
    staleTime: 5 * 60 * 1000,
  });
  const companyName = branding?.companyName?.trim() || 'Zeiterfassung';
  const companyInitial = companyName.charAt(0).toUpperCase();
  const companyNameSizeClass = companyName.length <= 14
    ? 'text-headline-md'
    : companyName.length <= 22
    ? 'text-body-lg'
    : 'text-body-md';

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

  // Sidebar-Inhalt — wird desktop-fixed UND mobile-drawer-mäßig gerendert
  const sidebarBody = (
    <div className="flex flex-col h-full p-stack_md">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-stack_lg px-3 pt-1">
        <div className="w-10 h-10 rounded-lg bg-primary-container text-on-primary-container flex items-center justify-center font-headline-md text-headline-md font-bold shrink-0">
          {companyInitial}
        </div>
        <div className="min-w-0">
          <h1
            className={`${companyNameSizeClass} font-headline-md font-bold text-on-surface leading-tight break-words`}
            title={companyName}
          >
            {companyName}
          </h1>
          <p className="font-label-md text-label-md text-on-surface-variant">Zeiterfassung</p>
        </div>
        {/* Mobile-Close */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="md:hidden ml-auto p-1 text-on-surface-variant hover:text-on-surface rounded transition-colors"
          aria-label="Menü schließen"
        >
          <X size={20} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ease-in-out active:scale-[0.98] ${
                isActive
                  ? 'bg-secondary-container text-on-secondary-container font-semibold'
                  : 'text-on-surface-variant hover:bg-surface-container-high dark:hover:bg-surface-container-highest'
              }`
            }
          >
            <link.icon size={20} />
            <span className="font-body-md text-body-md flex-1">{link.label}</span>
            {'badge' in link && link.badge != null && (
              <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 text-label-md font-label-md font-bold text-on-error bg-error rounded-full animate-pulse">
                {(link.badge as number) > 9 ? '9+' : (link.badge as React.ReactNode)}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer: User + Theme + Logout */}
      <div className="mt-auto flex flex-col gap-stack_md border-t border-outline-variant pt-stack_md">
        <div className="px-3">
          <p className="font-body-md text-body-md font-semibold text-on-surface truncate">
            {employee?.firstName} {employee?.lastName}
          </p>
          <p className="font-label-md text-label-md text-on-surface-variant">
            {employee?.isAdmin ? 'Administrator' : 'Mitarbeiter'}
          </p>
        </div>
        <div className="px-3">
          <ThemeToggle />
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-error hover:bg-error-container/30 dark:hover:bg-error-container/40 transition-colors duration-150 ease-in-out active:scale-[0.98]"
        >
          <LogOut size={20} />
          <span className="font-body-md text-body-md">Abmelden</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-on-background">
      {/* Mobile-TopBar */}
      <nav className="md:hidden sticky top-0 z-30 flex items-center justify-between h-16 px-gutter bg-surface dark:bg-surface-container-high border-b border-outline-variant shadow-sm">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 text-on-surface-variant hover:text-on-surface transition-colors"
          aria-label="Menü öffnen"
        >
          <Menu size={24} />
        </button>
        <div className="font-headline-md text-headline-md font-bold text-primary-container">
          {companyName}
        </div>
        <div className="w-10" />
      </nav>

      {/* Mobile-Drawer-Overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`
            fixed md:sticky md:top-0 inset-y-0 left-0 z-50 w-sidebar_width h-screen
            bg-surface dark:bg-surface-container-high
            border-r border-outline-variant dark:border-outline
            shadow-sm transform transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}
        >
          {sidebarBody}
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0">
          <div className="w-full p-container_padding flex flex-col gap-stack_lg">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
