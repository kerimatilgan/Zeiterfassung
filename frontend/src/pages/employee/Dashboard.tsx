import { useQuery, useQueryClient } from '@tanstack/react-query';
import { timeEntriesApi, documentsApi, employeesApi, reportsApi } from '../../lib/api';
import { isPushSupported, getNotificationPermission, hasActiveSubscription, enablePush } from '../../lib/pushNotifications';
import { useAuthStore } from '../../store/authStore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Clock, Calendar, Timer, Umbrella, Thermometer, MapPin, LogIn, LogOut, X, Loader2, ChevronLeft, ChevronRight, MessageSquare, AlertTriangle, CheckCircle, Coffee, PenLine, ChevronRight as ChevronRightIcon, FileText, Bell, GripVertical } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, getISOWeek, addWeeks, subWeeks, isAfter } from 'date-fns';
import { de } from 'date-fns/locale';
import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import SortableCard from '../../components/SortableCard';

// Default-Reihenfolge der sortierbaren Stats-Karten — entspricht dem visuellen
// Layout vor dem Drag-and-Drop-Feature.
const DEFAULT_CARD_ORDER = ['overtime', 'week', 'month', 'vacation', 'sick'] as const;
type CardId = typeof DEFAULT_CARD_ORDER[number];
// Welche Karten im 2-Spalten-Desktop-Grid die volle Breite spannen
const FULL_WIDTH_CARDS: Set<CardId> = new Set(['week', 'sick']);
// Kurze Label für die Drag-Overlay-Vorschau — die echte Karte ist während
// des Drags ausgeblendet, am Finger schwebt stattdessen nur dieses kompakte
// Pill mit dem Karten-Titel.
const CARD_LABELS: Record<CardId, string> = {
  overtime: 'Überstunden-Saldo',
  week: 'Wochenübersicht',
  month: 'Dieser Monat',
  vacation: 'Urlaubstage',
  sick: 'Krankheitstage',
};

// Parst gespeicherte Reihenfolge (JSON-String aus DB). Validiert dass alle IDs
// existieren und hängt fehlende ans Ende — robust gegen zukünftige neue Karten.
function parseCardOrder(raw: string | null | undefined): CardId[] {
  if (!raw) return [...DEFAULT_CARD_ORDER];
  try {
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return [...DEFAULT_CARD_ORDER];
    const valid = parsed.filter((id): id is CardId => DEFAULT_CARD_ORDER.includes(id as CardId));
    const missing = DEFAULT_CARD_ORDER.filter(id => !valid.includes(id));
    return [...valid, ...missing];
  } catch {
    return [...DEFAULT_CARD_ORDER];
  }
}

// Formatiert Dezimalstunden zu H:MM Format (unterstützt negative Werte)
const formatHoursToTime = (hours: number): string => {
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.floor((abs - h) * 60);
  return `${sign}${h}:${m.toString().padStart(2, '0')}`;
};

export default function EmployeeDashboard() {
  const { employee } = useAuthStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());

  // Ausstehende Info-Schreiben + ungelesene Dokumente + ungelesene Abrechnungen (Banner)
  const { data: myDocuments } = useQuery({
    queryKey: ['my-documents'],
    queryFn: () => documentsApi.getMy().then((r) => r.data),
  });
  const { data: myReports } = useQuery({
    queryKey: ['my-reports'],
    queryFn: () => reportsApi.getMy().then((r) => r.data),
  });
  const pendingInfoLetters = (myDocuments || []).filter(
    (d: any) => d.documentType?.name === 'Info-Schreiben' && !d.signedAt,
  );
  const unreadDocuments = (myDocuments || []).filter(
    (d: any) => !d.firstViewedAt && d.documentType?.name !== 'Info-Schreiben',
  );
  const unreadReports = (myReports || []).filter(
    (r: any) => r.status === 'finalized' && r.pdfPath && !r.firstViewedAt,
  );
  const totalUnread = unreadDocuments.length + unreadReports.length;

  // Push-Aktivierungs-Banner: zeigt sich, wenn Push supported, Permission noch
  // unentschieden ('default') und keine Subscription da. Per X dismissed → 7 Tage Ruhe.
  const PUSH_DISMISS_KEY = 'zeiterfassung.pushBannerDismissedUntil';
  const [showPushBanner, setShowPushBanner] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    (async () => {
      if (!isPushSupported()) return;
      if (getNotificationPermission() !== 'default') return;
      if (await hasActiveSubscription()) return;
      const dismissedUntil = parseInt(localStorage.getItem(PUSH_DISMISS_KEY) || '0', 10);
      if (Date.now() < dismissedUntil) return;
      setShowPushBanner(true);
    })();
  }, []);
  const handleEnablePush = async () => {
    setPushBusy(true);
    try {
      const res = await enablePush();
      if (res.ok) {
        toast.success('Benachrichtigungen aktiviert');
        setShowPushBanner(false);
      } else {
        toast.error(res.reason || 'Konnte nicht aktiviert werden');
        if (getNotificationPermission() !== 'default') setShowPushBanner(false);
      }
    } finally {
      setPushBusy(false);
    }
  };
  const dismissPushBanner = () => {
    localStorage.setItem(PUSH_DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    setShowPushBanner(false);
  };

  // Position-Heartbeat: einmal beim Mount + alle 15min wenn Permission da
  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    const sendOnce = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          employeesApi.sendPosition(pos.coords.latitude, pos.coords.longitude)
            .catch((err) => console.debug('Position heartbeat failed:', err));
        },
        () => { /* Permission denied — silent skip */ },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
      );
    };
    sendOnce();
    const interval = setInterval(sendOnce, 15 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // PWA Stempel State
  const [showPwaModal, setShowPwaModal] = useState(false);
  const [pwaAction, setPwaAction] = useState<'clock-in' | 'clock-out'>('clock-in');
  const [pwaReasonId, setPwaReasonId] = useState('');
  const [pwaReasonText, setPwaReasonText] = useState('');
  const [pwaLoading, setPwaLoading] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoPosition, setGeoPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoError, setGeoError] = useState('');

  // Echtzeit-Uhr für Arbeitszeit-Anzeige (aktualisiert jede Minute)
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Jede Minute
    return () => clearInterval(interval);
  }, []);

  const { data: status } = useQuery({
    queryKey: ['myStatus'],
    queryFn: () => timeEntriesApi.getMyStatus().then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['myStats'],
    queryFn: () => timeEntriesApi.getMyStats().then((r) => r.data),
  });

  const { data: vacationDetails } = useQuery({
    queryKey: ['myVacationDetails'],
    queryFn: () => timeEntriesApi.getMyVacationDetails().then(r => r.data),
  });

  // Wochenansicht State
  const [weekDate, setWeekDate] = useState(new Date());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Sortier-Reihenfolge der Stats-Karten (per Drag-and-Drop änderbar).
  // Persistiert in der DB pro User → folgt dem Login über alle Geräte.
  // Initialwert kommt aus authStore.employee.dashboardCardOrder (das wird beim
  // Login bzw. /auth/me-Refresh gefüllt).
  const updateEmployee = useAuthStore(s => s.updateEmployee);
  const [cardOrder, setCardOrder] = useState<CardId[]>(() => parseCardOrder(employee?.dashboardCardOrder));
  const [activeDragId, setActiveDragId] = useState<CardId | null>(null);
  // Wenn der authStore-Employee nach /auth/me-Refresh aktualisiert wird,
  // einmalig den lokalen State angleichen (z.B. bei Wechsel von Gerät).
  useEffect(() => {
    if (employee?.dashboardCardOrder) {
      const fromStore = parseCardOrder(employee.dashboardCardOrder);
      setCardOrder(prev => JSON.stringify(prev) === JSON.stringify(fromStore) ? prev : fromStore);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.dashboardCardOrder]);
  const dndSensors = useSensors(
    // Touch: kurzer Press hält, dann ziehen — verhindert Konflikt mit Scroll
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    // Maus: 5px Bewegung bevor Drag startet — verhindert dass jeder Klick zu Drag wird
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as CardId);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCardOrder((items) => {
      const oldIdx = items.indexOf(active.id as CardId);
      const newIdx = items.indexOf(over.id as CardId);
      if (oldIdx === -1 || newIdx === -1) return items;
      const next = arrayMove(items, oldIdx, newIdx);
      // Persistieren in DB + lokaler authStore-Cache (damit Reload sofort die
      // neue Reihenfolge zeigt, ohne auf /auth/me-Refresh zu warten).
      const orderJson = JSON.stringify(next);
      updateEmployee({ dashboardCardOrder: orderJson });
      employeesApi.saveDashboardOrder(next).catch(err => {
        console.error('Dashboard-Reihenfolge konnte nicht gespeichert werden:', err);
      });
      return next;
    });
  };

  // ?openComplaint=ENTRY_ID — direkt aus Mail-Link zur neuen Reklamations-Übersicht springen
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('openComplaint');
    if (!id) return;
    navigate(`/dashboard/complaints?entry=${encodeURIComponent(id)}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const weekStart = startOfWeek(weekDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const weekNumber = getISOWeek(weekDate);
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');

  const { data: weekEntries } = useQuery({
    queryKey: ['weekEntries', weekStartStr],
    queryFn: () => timeEntriesApi.getMy({
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
    }).then(r => r.data),
  });

  const { data: weekTargets } = useQuery({
    queryKey: ['weekTargets', weekStartStr],
    queryFn: () => timeEntriesApi.getMyWeekTargets(weekStartStr).then(r => r.data),
  });

  const getWeekDayEntries = (day: Date) =>
    (weekEntries || []).filter((e: any) => isSameDay(new Date(e.clockIn), day))
      .sort((a: any, b: any) => new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime());

  const getDayWorkedHours = (day: Date) => {
    const dayEntries = getWeekDayEntries(day);
    // Sekunden werden bei der Berechnung abgeschnitten (08:49:22 → 08:49:00)
    const truncMs = (d: Date) => Math.floor(d.getTime() / 60000) * 60000;
    return dayEntries.reduce((total: number, e: any) => {
      const end = e.clockOut ? new Date(e.clockOut) : currentTime;
      const hours = (truncMs(end) - truncMs(new Date(e.clockIn))) / (1000 * 60 * 60);
      return total + hours - (e.clockOut ? e.breakMinutes / 60 : 0);
    }, 0);
  };

  const getDayTarget = (day: Date): { target: number; holiday?: string; absence?: string } => {
    const dateStr = format(day, 'yyyy-MM-dd');
    return weekTargets?.days?.[dateStr] || { target: 0 };
  };

  const isCurrentWeek = isSameDay(startOfWeek(new Date(), { weekStartsOn: 1 }), weekStart);

  // Progress Ring SVG Komponente
  const ProgressRing = ({ percentage, size = 44, stroke = 4, color = '#22c55e' }: { percentage: number; size?: number; stroke?: number; color?: string }) => {
    const radius = (size - stroke) / 2;
    const circumference = radius * 2 * Math.PI;
    const clamped = Math.min(Math.max(percentage, 0), 100);
    const offset = circumference - (clamped / 100) * circumference;
    return (
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-500" />
      </svg>
    );
  };

  const { data: pwaPermissions } = useQuery({
    queryKey: ['pwaPermissions'],
    queryFn: () => timeEntriesApi.getPwaPermissions().then((r) => r.data),
  });

  const { data: pwaReasons } = useQuery({
    queryKey: ['pwaReasons'],
    queryFn: () => timeEntriesApi.getPwaReasons().then((r) => r.data),
    enabled: !!(pwaPermissions?.canClockInPwa || pwaPermissions?.canClockOutPwa),
  });

  const canPwaClockIn = pwaPermissions?.canClockInPwa && !status?.isClockedIn;
  const canPwaClockOut = pwaPermissions?.canClockOutPwa && status?.isClockedIn;

  const openPwaModal = (action: 'clock-in' | 'clock-out') => {
    setPwaAction(action);
    setPwaReasonId('');
    setPwaReasonText('');
    setGeoPosition(null);
    setGeoError('');
    setShowPwaModal(true);

    // Standort abfragen
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoPosition({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setGeoLoading(false);
      },
      (err) => {
        setGeoError(err.code === 1 ? 'Standortzugriff verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.' : 'Standort konnte nicht ermittelt werden.');
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const handlePwaStamp = async () => {
    if (!geoPosition) {
      toast.error('Standort ist erforderlich');
      return;
    }
    if (!pwaReasonId && !pwaReasonText.trim()) {
      toast.error('Bitte einen Grund angeben');
      return;
    }
    setPwaLoading(true);
    try {
      const data = {
        latitude: geoPosition.latitude,
        longitude: geoPosition.longitude,
        reasonId: pwaReasonId || undefined,
        reasonText: pwaReasonText.trim() || undefined,
      };
      if (pwaAction === 'clock-in') {
        await timeEntriesApi.pwaClockIn(data);
        toast.success('Erfolgreich eingestempelt');
      } else {
        await timeEntriesApi.pwaClockOut(data);
        toast.success('Erfolgreich ausgestempelt');
      }
      setShowPwaModal(false);
      setCurrentTime(new Date());
      queryClient.invalidateQueries({ queryKey: ['myStatus'] });
      queryClient.invalidateQueries({ queryKey: ['myStats'] });
      queryClient.invalidateQueries({ queryKey: ['myTimeEntries'] });
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Fehler beim Stempeln');
    }
    setPwaLoading(false);
  };

  const calculateCurrentDuration = useCallback(() => {
    if (!status?.activeEntry) return null;
    const start = new Date(status.activeEntry.clockIn);
    const diffMs = Math.max(0, currentTime.getTime() - start.getTime());
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }, [status?.activeEntry, currentTime]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Hallo, {employee?.firstName}!
        </h1>
        <p className="text-gray-500 dark:text-gray-400">Deine Zeiterfassung auf einen Blick</p>
      </div>

      {/* Banner: Push-Benachrichtigungen aktivieren (dezent, dismissable) */}
      {showPushBanner && (
        <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-lg p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0">
            <Bell size={18} className="text-purple-700 dark:text-purple-300" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-purple-900 dark:text-purple-200">Benachrichtigungen aktivieren?</p>
            <p className="text-sm text-purple-700 dark:text-purple-300">
              Erhalte Push-Nachrichten bei neuen Dokumenten, Abrechnungen und Stempel-Erinnerungen.
            </p>
          </div>
          <button
            type="button"
            onClick={handleEnablePush}
            disabled={pushBusy}
            className="btn btn-primary flex-shrink-0"
          >
            Aktivieren
          </button>
          <button
            type="button"
            onClick={dismissPushBanner}
            className="text-purple-700/70 hover:text-purple-900 p-1"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Banner: Ausstehende Info-Schreiben zur Bestätigung */}
      {pendingInfoLetters.length > 0 && (
        <button
          type="button"
          onClick={() => navigate('/dashboard/documents')}
          className="w-full text-left bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-center gap-3 transition-colors"
        >
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
            <PenLine size={18} className="text-amber-700 dark:text-amber-300" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {pendingInfoLetters.length === 1
                ? 'Ein Info-Schreiben wartet auf deine Bestätigung'
                : `${pendingInfoLetters.length} Info-Schreiben warten auf deine Bestätigung`}
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">Zu den Dokumenten wechseln und digital bestätigen</p>
          </div>
          <ChevronRightIcon size={20} className="text-amber-700 dark:text-amber-300 flex-shrink-0" />
        </button>
      )}

      {/* Banner: Ungelesene Dokumente + Abrechnungen */}
      {totalUnread > 0 && (
        <button
          type="button"
          onClick={() => navigate('/dashboard/documents')}
          className="w-full text-left bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex items-center gap-3 transition-colors"
        >
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-blue-700 dark:text-blue-300" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-blue-900 dark:text-blue-200">
              {totalUnread === 1
                ? (unreadReports.length === 1 ? 'Eine neue Abrechnung wurde für dich bereitgestellt' : 'Ein neues Dokument wurde für dich bereitgestellt')
                : `${totalUnread} neue Einträge wurden für dich bereitgestellt`}
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              {unreadDocuments.length > 0 && unreadReports.length > 0
                ? `${unreadDocuments.length} Dokument${unreadDocuments.length === 1 ? '' : 'e'} + ${unreadReports.length} Abrechnung${unreadReports.length === 1 ? '' : 'en'}`
                : 'Jetzt ansehen und herunterladen'}
            </p>
          </div>
          <ChevronRightIcon size={20} className="text-blue-700 dark:text-blue-300 flex-shrink-0" />
        </button>
      )}

      {/* Current Status */}
      <div
        className={`card p-6 ${
          status?.isClockedIn
            ? 'bg-gradient-to-r from-green-500 to-green-600 text-white'
            : 'bg-gradient-to-r from-gray-100 to-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-sm ${status?.isClockedIn ? 'text-green-100' : 'text-gray-500 dark:text-gray-400'}`}>
              Aktueller Status
            </p>
            <p className="text-2xl font-bold mt-1">
              {status?.isClockedIn ? 'Eingestempelt' : 'Ausgestempelt'}
            </p>
            {status?.isClockedIn && status.activeEntry && (
              <p className="text-green-100 mt-2">
                Seit {format(new Date(status.activeEntry.clockIn), 'HH:mm', { locale: de })} Uhr
                {' '}({calculateCurrentDuration()})
              </p>
            )}
            {stats?.isTodayWorkDay && stats.dailyTarget > 0 && (
              <p className={`mt-2 text-sm ${status?.isClockedIn ? 'text-green-100' : 'text-gray-500 dark:text-gray-400'}`}>
                Heute: {formatHoursToTime(stats.todayWorked)} / {formatHoursToTime(stats.dailyTarget)} h
                {stats.todayRemaining > 0 ? ` · noch ${formatHoursToTime(stats.todayRemaining)} h` : ' · Tagessoll erreicht!'}
              </p>
            )}
          </div>
          <div
            className={`p-4 rounded-full ${
              status?.isClockedIn ? 'bg-green-400/30' : 'bg-gray-300'
            }`}
          >
            <Clock size={32} className={status?.isClockedIn ? 'text-white' : 'text-gray-500 dark:text-gray-400'} />
          </div>
        </div>
      </div>

      {/* PWA Stempel-Buttons */}
      {(pwaPermissions?.canClockInPwa || pwaPermissions?.canClockOutPwa) && (
        <div className="flex gap-3">
          {canPwaClockIn && (
            <button
              onClick={() => openPwaModal('clock-in')}
              className="flex-1 flex items-center justify-center gap-2 p-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium shadow-lg transition"
            >
              <LogIn size={20} />
              Einstempeln
            </button>
          )}
          {canPwaClockOut && (
            <button
              onClick={() => openPwaModal('clock-out')}
              className="flex-1 flex items-center justify-center gap-2 p-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium shadow-lg transition"
            >
              <LogOut size={20} />
              Ausstempeln
            </button>
          )}
        </div>
      )}

      {/* PWA Stempel-Modal */}
      {showPwaModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowPwaModal(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className={`p-5 rounded-t-xl text-white ${pwaAction === 'clock-in' ? 'bg-green-600' : 'bg-red-600'}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  {pwaAction === 'clock-in' ? <><LogIn size={20} /> Einstempeln</> : <><LogOut size={20} /> Ausstempeln</>}
                </h3>
                <button onClick={() => setShowPwaModal(false)} className="p-1 hover:bg-white/20 rounded">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {/* Standort */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <MapPin size={14} className="inline mr-1" /> Standort
                </label>
                {geoLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <Loader2 size={16} className="animate-spin" /> Standort wird ermittelt...
                  </div>
                ) : geoError ? (
                  <div className="text-sm text-red-600 dark:text-red-400 p-3 bg-red-50 dark:bg-red-950/40 rounded-lg">{geoError}</div>
                ) : geoPosition ? (
                  <div className="text-sm text-green-700 dark:text-green-300 p-3 bg-green-50 dark:bg-green-950/40 rounded-lg flex items-center gap-2">
                    <MapPin size={14} />
                    Standort erfasst ({geoPosition.latitude.toFixed(4)}, {geoPosition.longitude.toFixed(4)})
                  </div>
                ) : null}
              </div>

              {/* Grund */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Grund <span className="text-red-500">*</span>
                </label>
                {pwaReasons?.length > 0 && (
                  <select
                    value={pwaReasonId}
                    onChange={(e) => { setPwaReasonId(e.target.value); if (e.target.value) setPwaReasonText(''); }}
                    className="w-full px-3 py-2 border rounded-lg text-sm mb-2"
                  >
                    <option value="">Bitte wählen...</option>
                    {pwaReasons.map((r: any) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                    <option value="">-- Anderer Grund --</option>
                  </select>
                )}
                {(!pwaReasonId || pwaReasons?.length === 0) && (
                  <input
                    type="text"
                    value={pwaReasonText}
                    onChange={(e) => setPwaReasonText(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="Grund eingeben..."
                  />
                )}
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowPwaModal(false)}
                  className="flex-1 px-4 py-2.5 border rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Abbrechen
                </button>
                <button
                  onClick={handlePwaStamp}
                  disabled={pwaLoading || !geoPosition || (!pwaReasonId && !pwaReasonText.trim())}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-white font-medium disabled:opacity-50 ${pwaAction === 'clock-in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
                >
                  {pwaLoading ? <Loader2 size={16} className="animate-spin mx-auto" /> :
                    pwaAction === 'clock-in' ? 'Jetzt einstempeln' : 'Jetzt ausstempeln'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid: 2 Spalten auf Desktop. Karten sind per Drag-Handle (oben
          rechts auf jeder Karte) sortierbar — Reihenfolge wird pro Browser/Gerät
          in localStorage persistiert. */}
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <SortableContext items={cardOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <SortableCard id="overtime" order={cardOrder.indexOf('overtime')} className={FULL_WIDTH_CARDS.has('overtime') ? 'lg:col-span-2' : ''}>
        {/* Überstunden-Saldo Gesamt */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-orange-100 dark:bg-orange-900/40">
              <Timer className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Überstunden-Saldo</h2>
          </div>
          <div className="text-center p-3 rounded-lg bg-orange-50 dark:bg-orange-950/40">
            <p className={`text-2xl lg:text-3xl font-bold ${stats?.totalOvertimeBalance != null && stats.totalOvertimeBalance < 0 ? 'text-red-600 dark:text-red-400' : stats?.totalOvertimeBalance != null && stats.totalOvertimeBalance > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-gray-100'}`}>
              {stats?.totalOvertimeBalance != null ? formatHoursToTime(stats.totalOvertimeBalance) : '-'} h
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">inkl. aktuellem Monat</p>
          </div>
          {stats?.totalOvertimeBalance != null && stats.totalOvertimeBalance <= -4 && (
            <div className={`mt-2 p-2 rounded-lg text-xs ${stats.totalOvertimeBalance <= -8 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'}`}>
              <p>{stats.totalOvertimeBalance <= -8
                ? 'Achtung: Bei der nächsten Abrechnung können Urlaubstage für Minusstunden abgezogen werden.'
                : 'Hinweis: Bei mehr als 8 Minusstunden kann ein Urlaubstag abgezogen werden.'
              }</p>
            </div>
          )}
        </div>
        </SortableCard>

        <SortableCard id="week" order={cardOrder.indexOf('week')} className={FULL_WIDTH_CARDS.has('week') ? 'lg:col-span-2' : ''}>
        {/* Wochenübersicht */}
        {(() => {
          const weekWorkedTotal = weekDays.reduce((sum, day) => sum + getDayWorkedHours(day), 0);
          const weekTargetTotal = weekDays.reduce((sum, day) => sum + getDayTarget(day).target, 0);
          const weekDiff = weekWorkedTotal - weekTargetTotal;
          const weekPercent = weekTargetTotal > 0 ? Math.round((weekWorkedTotal / weekTargetTotal) * 100) : 0;

          return (
            <div className="card overflow-hidden">
              {/* Week Header */}
              <div className="p-5 bg-gradient-to-r from-gray-800 to-gray-900 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <ProgressRing percentage={weekPercent} size={56} stroke={5} color={weekPercent >= 100 ? '#22c55e' : '#84cc16'} />
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                        {weekPercent}%
                      </span>
                    </div>
                    <div>
                      <h2 className="text-lg font-bold">Woche {weekNumber}</h2>
                      <p className="text-sm text-gray-400 dark:text-gray-500">{weekStart.getFullYear()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{formatHoursToTime(weekWorkedTotal)} / {formatHoursToTime(weekTargetTotal)} h</p>
                    <p className={`text-sm font-medium ${weekDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {weekDiff >= 0 ? '+' : ''}{formatHoursToTime(weekDiff)} h
                    </p>
                  </div>
                </div>
                {/* Navigation */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-700">
                  <button
                    onClick={() => setWeekDate(subWeeks(weekDate, 1))}
                    className="flex items-center gap-1 text-sm text-gray-400 dark:text-gray-500 hover:text-white transition"
                  >
                    <ChevronLeft size={18} /> Vorherige
                  </button>
                  {!isCurrentWeek && (
                    <button
                      onClick={() => setWeekDate(new Date())}
                      className="text-xs px-3 py-1 rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
                    >
                      Aktuelle Woche
                    </button>
                  )}
                  <button
                    onClick={() => setWeekDate(addWeeks(weekDate, 1))}
                    disabled={isAfter(addWeeks(weekStart, 1), new Date())}
                    className="flex items-center gap-1 text-sm text-gray-400 dark:text-gray-500 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Nächste <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              {/* Day Cards */}
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {weekDays.map(day => {
                  const worked = getDayWorkedHours(day);
                  const dayInfo = getDayTarget(day);
                  const target = dayInfo.target;
                  const hasTarget = target > 0;
                  const isSpecial = !!dayInfo.holiday || !!dayInfo.absence;
                  const diff = worked - target;
                  const percent = target > 0 ? Math.round((worked / target) * 100) : (worked > 0 ? 100 : 0);
                  const dayEntries = getWeekDayEntries(day);
                  const hasActive = dayEntries.some((e: any) => !e.clockOut);
                  const isToday = isSameDay(day, new Date());
                  const isFuture = isAfter(day, new Date());

                  const dayKey = format(day, 'yyyy-MM-dd');
                  const isExpanded = expandedDay === dayKey;
                  const canInteract = !isFuture;
                  return (
                    <div key={day.toISOString()}>
                    <div
                      onClick={() => canInteract && setExpandedDay(isExpanded ? null : dayKey)}
                      className={`flex items-center gap-4 px-5 py-3.5 transition ${
                        isToday ? 'bg-primary-50 dark:bg-primary-900/30' :
                        !hasTarget && !isSpecial ? 'bg-gray-50 dark:bg-gray-800' :
                        isFuture ? 'opacity-40' : ''
                      } ${canInteract ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : ''} ${isExpanded ? 'border-b' : ''}`}
                    >
                      {/* Progress Ring */}
                      <div className="flex-shrink-0">
                        {hasTarget ? (
                          <div className="relative">
                            <ProgressRing
                              percentage={percent}
                              size={40}
                              stroke={4}
                              color={
                                hasActive ? '#3b82f6' :
                                percent >= 100 ? '#22c55e' :
                                percent > 0 ? '#84cc16' : '#e5e7eb'
                              }
                            />
                            {hasActive && (
                              <span className="absolute inset-0 flex items-center justify-center">
                                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                              </span>
                            )}
                          </div>
                        ) : isSpecial ? (
                          <div className="w-10 h-10 flex items-center justify-center">
                            {dayInfo.holiday ? (
                              <span className="text-lg">🎉</span>
                            ) : dayInfo.absence?.toLowerCase().includes('krank') ? (
                              <Thermometer size={20} className="text-red-400" />
                            ) : (
                              <Umbrella size={20} className="text-green-400" />
                            )}
                          </div>
                        ) : (
                          <div className="w-10 h-10" />
                        )}
                      </div>

                      {/* Day Info */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium ${isToday ? 'text-primary-700 dark:text-primary-300' : !hasTarget && !isSpecial ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
                          {format(day, 'EEEE', { locale: de })}
                        </p>
                        <p className={`text-sm ${!hasTarget && !isSpecial ? 'text-gray-400 dark:text-gray-500' : 'text-gray-500 dark:text-gray-400'}`}>
                          {format(day, 'dd.MM.yyyy')}
                          {dayInfo.holiday && <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">({dayInfo.holiday})</span>}
                          {dayInfo.absence && <span className="ml-1.5 text-xs text-purple-600 dark:text-purple-400">({dayInfo.absence})</span>}
                        </p>
                      </div>

                      {/* Hours & Diff */}
                      {worked > 0 || (hasTarget && !isFuture) ? (
                        <div className="text-right flex-shrink-0">
                          <p className={`font-semibold ${!hasTarget && worked > 0 ? 'text-gray-700 dark:text-gray-300' : hasTarget ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
                            {worked > 0 ? `${formatHoursToTime(worked)} h` : '-'}
                          </p>
                          {hasTarget && !isFuture && (
                            <p className={`text-sm font-medium ${
                              diff > 0.01 ? 'text-green-600 dark:text-green-400' : diff < -0.01 ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'
                            }`}>
                              {Math.abs(diff) > 0.01 ? `${diff > 0 ? '+' : ''}${formatHoursToTime(diff)} h` : '±0'}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                    {isExpanded && (
                      <div className="bg-gray-50 dark:bg-gray-800 px-5 py-3 border-b">
                        {dayEntries.length > 0 ? (
                          <div className="space-y-2">
                            {dayEntries.map((entry: any, idx: number) => (
                              <div key={entry.id}>
                                {idx > 0 && dayEntries[idx - 1].clockOut && (() => {
                                  const prevEnd = new Date(dayEntries[idx - 1].clockOut);
                                  const currStart = new Date(entry.clockIn);
                                  const gap = Math.round((currStart.getTime() - prevEnd.getTime()) / 60000);
                                  if (gap <= 0) return null;
                                  const pauseLabel = `${format(prevEnd, 'HH:mm')} - ${format(currStart, 'HH:mm')}`;
                                  return (
                                    <div className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400 py-1 px-2 bg-orange-50 dark:bg-orange-950/40 rounded">
                                      <Coffee size={12} />
                                      <span>Pause: {pauseLabel} ({gap >= 60 ? `${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')}h` : `${gap} min`})</span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const prev = dayEntries[idx - 1];
                                          navigate(`/dashboard/complaints?entry=${encodeURIComponent(prev.id)}`);
                                        }}
                                        className="ml-auto text-xs px-2 py-0.5 rounded text-orange-600 dark:text-orange-400 hover:bg-orange-100"
                                      >
                                        Reklamieren
                                      </button>
                                    </div>
                                  );
                                })()}
                                <div className="bg-white dark:bg-gray-900 border rounded px-3 py-2 flex items-center gap-2 flex-wrap">
                                  {entry.complaintMessage && (
                                    entry.complaintResolvedAt
                                      ? <CheckCircle size={14} className="text-green-500" />
                                      : <AlertTriangle size={14} className="text-amber-500" />
                                  )}
                                  {(entry.clockInViaPwa || entry.clockOutViaPwa) && <MapPin size={14} className="text-blue-500" />}
                                  <span className="font-mono text-sm font-medium">
                                    {format(new Date(entry.clockIn), 'HH:mm')}
                                    {' - '}
                                    {entry.clockOut ? format(new Date(entry.clockOut), 'HH:mm') : <span className="text-green-600 dark:text-green-400">Aktiv</span>}
                                  </span>
                                  {entry.breakMinutes > 0 && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">
                                      ({entry.breakMinutes >= 60 ? `${Math.floor(entry.breakMinutes / 60)}:${String(entry.breakMinutes % 60).padStart(2, '0')}h` : `${entry.breakMinutes} min`} Pause)
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/dashboard/complaints?entry=${encodeURIComponent(entry.id)}`);
                                    }}
                                    className={`ml-auto text-xs px-2 py-1 rounded ${
                                      entry.complaintMessage
                                        ? entry.complaintResolvedAt
                                          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200'
                                          : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200'
                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                    }`}
                                  >
                                    {entry.complaintMessage ? (entry.complaintResolvedAt ? 'Bearbeitet' : 'Offen') : 'Reklamieren'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                            <span>Keine Zeiteinträge an diesem Tag</span>
                            {canInteract && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/dashboard/complaints?date=${format(day, 'yyyy-MM-dd')}`);
                                }}
                                className="text-xs px-3 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 flex items-center gap-1"
                              >
                                <MessageSquare size={12} /> Tag reklamieren
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        </SortableCard>

        <SortableCard id="month" order={cardOrder.indexOf('month')} className={FULL_WIDTH_CARDS.has('month') ? 'lg:col-span-2' : ''}>
        {/* Arbeitszeit Monat */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-purple-100 dark:bg-purple-900/40">
              <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Dieser Monat</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-purple-50 dark:bg-purple-950/40 rounded-lg">
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {stats?.monthHours != null ? formatHoursToTime(stats.monthHours) : '-'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Gearbeitet</p>
            </div>
            <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {stats?.monthlyTarget != null ? formatHoursToTime(stats.monthlyTarget) : '-'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Soll</p>
            </div>
            <div className="text-center p-2 bg-orange-50 dark:bg-orange-950/40 rounded-lg">
              <p className={`text-lg font-bold ${stats?.monthOvertime != null && stats.monthOvertime < 0 ? 'text-red-600 dark:text-red-400' : stats?.monthOvertime != null && stats.monthOvertime > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-gray-100'}`}>
                {stats?.monthOvertime != null ? formatHoursToTime(stats.monthOvertime) : '-'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Saldo</p>
            </div>
          </div>
        </div>
        </SortableCard>

        <SortableCard id="vacation" order={cardOrder.indexOf('vacation')} className={FULL_WIDTH_CARDS.has('vacation') ? 'lg:col-span-2' : ''}>
        {/* Urlaubstage */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-green-100 dark:bg-green-900/40">
              <Umbrella className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Urlaubstage {new Date().getFullYear()}</h2>
          </div>
          {vacationDetails?.carryOver > 0 && (
            <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-950/40 rounded-lg text-center">
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Übertrag aus {(vacationDetails?.year || new Date().getFullYear()) - 1}: <span className="font-bold">{vacationDetails.carryOver}</span> Tage
                {vacationDetails.carryOverUsed > 0 && <span> ({vacationDetails.carryOverUsed} verbraucht, <span className="font-bold">{vacationDetails.carryOverRemaining}</span> übrig)</span>}
              </p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{vacationDetails?.total ?? stats?.vacationDaysTotal ?? '-'}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Gesamt</p>
            </div>
            <div className="text-center p-2 bg-orange-50 dark:bg-orange-950/40 rounded-lg">
              <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{vacationDetails?.totalUsed ?? stats?.vacationDaysUsed ?? '-'}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Genommen</p>
            </div>
            <div className="text-center p-2 bg-green-50 dark:bg-green-950/40 rounded-lg">
              <p className={`text-lg font-bold ${(vacationDetails?.totalRemaining ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{vacationDetails?.totalRemaining ?? stats?.vacationDaysRemaining ?? '-'}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Verbleibend</p>
            </div>
          </div>
          {/* Abzüge & Sonderurlaub */}
          {(vacationDetails?.deductedDays > 0 || vacationDetails?.specialLeaveUsed > 0) && (
            <div className="mt-2 space-y-1">
              {vacationDetails.deductedDays > 0 && (
                <div className="p-1.5 bg-red-50 dark:bg-red-950/40 rounded text-xs text-red-600 dark:text-red-400 text-center">
                  {vacationDetails.deductedDays} Tag(e) abgezogen (Minusstunden-Ausgleich)
                </div>
              )}
              {vacationDetails.specialLeaveUsed > 0 && (
                <div className="p-1.5 bg-purple-50 dark:bg-purple-950/40 rounded text-xs text-purple-600 dark:text-purple-400 text-center">
                  {vacationDetails.specialLeaveUsed} Tag(e) Sonderurlaub (zählt nicht als Urlaub)
                </div>
              )}
            </div>
          )}
        </div>
        </SortableCard>

        <SortableCard id="sick" order={cardOrder.indexOf('sick')} className={FULL_WIDTH_CARDS.has('sick') ? 'lg:col-span-2' : ''}>
        {/* Krankheitstage */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-red-100 dark:bg-red-900/40">
              <Thermometer className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Krankheitstage {new Date().getFullYear()}</h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-center p-2 bg-red-50 dark:bg-red-950/40 rounded-lg">
              <p className="text-lg font-bold text-red-600 dark:text-red-400">{stats?.sickDaysMonth ?? 0}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Dieser Monat</p>
            </div>
            <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{stats?.sickDaysYear ?? 0}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Dieses Jahr</p>
            </div>
          </div>
        </div>
        </SortableCard>
          </div>
        </SortableContext>
        {/* Beim Drag schwebt diese kompakte Pille am Finger/Cursor — die echte
            Karte wird via opacity:0 ausgeblendet, damit es kein Layout-Chaos
            mit unterschiedlich hohen Karten gibt. */}
        <DragOverlay>
          {activeDragId ? (
            <div className="card px-4 py-3 shadow-2xl ring-2 ring-primary-400 cursor-grabbing inline-flex items-center gap-2">
              <GripVertical size={16} className="text-gray-400 dark:text-gray-500" />
              <span className="font-semibold text-gray-900 dark:text-gray-100">{CARD_LABELS[activeDragId]}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

    </div>
  );
}
