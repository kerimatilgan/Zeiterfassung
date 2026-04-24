import { useQuery, useQueryClient } from '@tanstack/react-query';
import { timeEntriesApi, documentsApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { useNavigate } from 'react-router-dom';
import { Clock, Calendar, Timer, Umbrella, Thermometer, MapPin, LogIn, LogOut, X, Loader2, ChevronLeft, ChevronRight, MessageSquare, AlertTriangle, CheckCircle, Coffee, PenLine, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, getISOWeek, addWeeks, subWeeks, isAfter } from 'date-fns';
import { de } from 'date-fns/locale';
import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';

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

  // Ausstehende Info-Schreiben (zur Erinnerung als Banner)
  const { data: myDocuments } = useQuery({
    queryKey: ['my-documents'],
    queryFn: () => documentsApi.getMy().then((r) => r.data),
  });
  const pendingInfoLetters = (myDocuments || []).filter(
    (d: any) => d.documentType?.name === 'Info-Schreiben' && !d.signedAt,
  );

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
  const [complaintEntryId, setComplaintEntryId] = useState<string | null>(null);
  const [complaintStandaloneDate, setComplaintStandaloneDate] = useState<Date | null>(null);
  const [complaintMessage, setComplaintMessage] = useState('');
  const [complaintInitial, setComplaintInitial] = useState<{ message: string; resolvedAt: string | null; response: string | null; resolved: boolean } | null>(null);
  const [complaintSubmitting, setComplaintSubmitting] = useState(false);
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
        <h1 className="text-2xl font-bold text-gray-900">
          Hallo, {employee?.firstName}!
        </h1>
        <p className="text-gray-500">Deine Zeiterfassung auf einen Blick</p>
      </div>

      {/* Banner: Ausstehende Info-Schreiben zur Bestätigung */}
      {pendingInfoLetters.length > 0 && (
        <button
          type="button"
          onClick={() => navigate('/dashboard/documents')}
          className="w-full text-left bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg p-4 flex items-center gap-3 transition-colors"
        >
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <PenLine size={18} className="text-amber-700" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-amber-900">
              {pendingInfoLetters.length === 1
                ? 'Ein Info-Schreiben wartet auf deine Bestätigung'
                : `${pendingInfoLetters.length} Info-Schreiben warten auf deine Bestätigung`}
            </p>
            <p className="text-sm text-amber-700">Zu den Dokumenten wechseln und digital bestätigen</p>
          </div>
          <ChevronRightIcon size={20} className="text-amber-700 flex-shrink-0" />
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
            <p className={`text-sm ${status?.isClockedIn ? 'text-green-100' : 'text-gray-500'}`}>
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
              <p className={`mt-2 text-sm ${status?.isClockedIn ? 'text-green-100' : 'text-gray-500'}`}>
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
            <Clock size={32} className={status?.isClockedIn ? 'text-white' : 'text-gray-500'} />
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <MapPin size={14} className="inline mr-1" /> Standort
                </label>
                {geoLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">
                    <Loader2 size={16} className="animate-spin" /> Standort wird ermittelt...
                  </div>
                ) : geoError ? (
                  <div className="text-sm text-red-600 p-3 bg-red-50 rounded-lg">{geoError}</div>
                ) : geoPosition ? (
                  <div className="text-sm text-green-700 p-3 bg-green-50 rounded-lg flex items-center gap-2">
                    <MapPin size={14} />
                    Standort erfasst ({geoPosition.latitude.toFixed(4)}, {geoPosition.longitude.toFixed(4)})
                  </div>
                ) : null}
              </div>

              {/* Grund */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  className="flex-1 px-4 py-2.5 border rounded-lg text-gray-700 hover:bg-gray-50"
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

      {/* Stats Grid: 2 Spalten auf Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Überstunden-Saldo Gesamt */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-orange-100">
              <Timer className="w-5 h-5 text-orange-600" />
            </div>
            <h2 className="font-semibold text-gray-900">Überstunden-Saldo</h2>
          </div>
          <div className="text-center p-3 rounded-lg bg-orange-50">
            <p className={`text-2xl lg:text-3xl font-bold ${stats?.totalOvertimeBalance != null && stats.totalOvertimeBalance < 0 ? 'text-red-600' : stats?.totalOvertimeBalance != null && stats.totalOvertimeBalance > 0 ? 'text-green-600' : 'text-gray-900'}`}>
              {stats?.totalOvertimeBalance != null ? formatHoursToTime(stats.totalOvertimeBalance) : '-'} h
            </p>
            <p className="text-xs text-gray-500 mt-1">inkl. aktuellem Monat</p>
          </div>
          {stats?.totalOvertimeBalance != null && stats.totalOvertimeBalance <= -4 && (
            <div className={`mt-2 p-2 rounded-lg text-xs ${stats.totalOvertimeBalance <= -8 ? 'bg-amber-100 text-amber-700' : 'bg-orange-50 text-orange-600'}`}>
              <p>{stats.totalOvertimeBalance <= -8
                ? 'Achtung: Bei der nächsten Abrechnung können Urlaubstage für Minusstunden abgezogen werden.'
                : 'Hinweis: Bei mehr als 8 Minusstunden kann ein Urlaubstag abgezogen werden.'
              }</p>
            </div>
          )}
        </div>

        {/* Wochenübersicht */}
        {(() => {
          const weekWorkedTotal = weekDays.reduce((sum, day) => sum + getDayWorkedHours(day), 0);
          const weekTargetTotal = weekDays.reduce((sum, day) => sum + getDayTarget(day).target, 0);
          const weekDiff = weekWorkedTotal - weekTargetTotal;
          const weekPercent = weekTargetTotal > 0 ? Math.round((weekWorkedTotal / weekTargetTotal) * 100) : 0;

          return (
            <div className="card overflow-hidden lg:col-span-2">
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
                      <p className="text-sm text-gray-400">{weekStart.getFullYear()}</p>
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
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition"
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
                    className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Nächste <ChevronRight size={18} />
                  </button>
                </div>
              </div>

              {/* Day Cards */}
              <div className="divide-y divide-gray-100">
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
                        isToday ? 'bg-primary-50' :
                        !hasTarget && !isSpecial ? 'bg-gray-50' :
                        isFuture ? 'opacity-40' : ''
                      } ${canInteract ? 'cursor-pointer hover:bg-gray-100' : ''} ${isExpanded ? 'border-b' : ''}`}
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
                        <p className={`font-medium ${isToday ? 'text-primary-700' : !hasTarget && !isSpecial ? 'text-gray-400' : 'text-gray-900'}`}>
                          {format(day, 'EEEE', { locale: de })}
                        </p>
                        <p className={`text-sm ${!hasTarget && !isSpecial ? 'text-gray-400' : 'text-gray-500'}`}>
                          {format(day, 'dd.MM.yyyy')}
                          {dayInfo.holiday && <span className="ml-1.5 text-xs text-amber-600">({dayInfo.holiday})</span>}
                          {dayInfo.absence && <span className="ml-1.5 text-xs text-purple-600">({dayInfo.absence})</span>}
                        </p>
                      </div>

                      {/* Hours & Diff */}
                      {worked > 0 || (hasTarget && !isFuture) ? (
                        <div className="text-right flex-shrink-0">
                          <p className={`font-semibold ${!hasTarget && worked > 0 ? 'text-gray-700' : hasTarget ? 'text-gray-900' : 'text-gray-400'}`}>
                            {worked > 0 ? `${formatHoursToTime(worked)} h` : '-'}
                          </p>
                          {hasTarget && !isFuture && (
                            <p className={`text-sm font-medium ${
                              diff > 0.01 ? 'text-green-600' : diff < -0.01 ? 'text-red-500' : 'text-gray-400'
                            }`}>
                              {Math.abs(diff) > 0.01 ? `${diff > 0 ? '+' : ''}${formatHoursToTime(diff)} h` : '±0'}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                    {isExpanded && (
                      <div className="bg-gray-50 px-5 py-3 border-b">
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
                                    <div className="flex items-center gap-2 text-xs text-orange-600 py-1 px-2 bg-orange-50 rounded">
                                      <Coffee size={12} />
                                      <span>Pause: {pauseLabel} ({gap >= 60 ? `${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')}h` : `${gap} min`})</span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const prev = dayEntries[idx - 1];
                                          setComplaintEntryId(prev.id);
                                          setComplaintStandaloneDate(null);
                                          setComplaintMessage(prev.complaintMessage || `Reklamation zur Pause (${pauseLabel}): `);
                                          setComplaintInitial(prev.complaintMessage ? { message: prev.complaintMessage, resolvedAt: prev.complaintResolvedAt, response: prev.complaintResponse, resolved: !!prev.complaintResolvedAt } : null);
                                        }}
                                        className="ml-auto text-xs px-2 py-0.5 rounded text-orange-600 hover:bg-orange-100"
                                      >
                                        Reklamieren
                                      </button>
                                    </div>
                                  );
                                })()}
                                <div className="bg-white border rounded px-3 py-2 flex items-center gap-2 flex-wrap">
                                  {entry.complaintMessage && (
                                    entry.complaintResolvedAt
                                      ? <CheckCircle size={14} className="text-green-500" />
                                      : <AlertTriangle size={14} className="text-amber-500" />
                                  )}
                                  {(entry.clockInViaPwa || entry.clockOutViaPwa) && <MapPin size={14} className="text-blue-500" />}
                                  <span className="font-mono text-sm font-medium">
                                    {format(new Date(entry.clockIn), 'HH:mm')}
                                    {' - '}
                                    {entry.clockOut ? format(new Date(entry.clockOut), 'HH:mm') : <span className="text-green-600">Aktiv</span>}
                                  </span>
                                  {entry.breakMinutes > 0 && (
                                    <span className="text-xs text-gray-400">
                                      ({entry.breakMinutes >= 60 ? `${Math.floor(entry.breakMinutes / 60)}:${String(entry.breakMinutes % 60).padStart(2, '0')}h` : `${entry.breakMinutes} min`} Pause)
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setComplaintEntryId(entry.id);
                                      setComplaintStandaloneDate(null);
                                      setComplaintMessage(entry.complaintMessage || '');
                                      setComplaintInitial(entry.complaintMessage ? { message: entry.complaintMessage, resolvedAt: entry.complaintResolvedAt, response: entry.complaintResponse, resolved: !!entry.complaintResolvedAt } : null);
                                    }}
                                    className={`ml-auto text-xs px-2 py-1 rounded ${
                                      entry.complaintMessage
                                        ? entry.complaintResolvedAt
                                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                          : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                  >
                                    {entry.complaintMessage ? (entry.complaintResolvedAt ? 'Bearbeitet' : 'Offen') : 'Reklamieren'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-sm text-gray-500">
                            <span>Keine Zeiteinträge an diesem Tag</span>
                            {canInteract && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setComplaintStandaloneDate(day);
                                  setComplaintEntryId(null);
                                  setComplaintMessage('');
                                  setComplaintInitial(null);
                                }}
                                className="text-xs px-3 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 flex items-center gap-1"
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

        {/* Reklamations-Modal */}
        {(complaintEntryId || complaintStandaloneDate) && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => {
              setComplaintEntryId(null);
              setComplaintStandaloneDate(null);
              setComplaintMessage('');
              setComplaintInitial(null);
            }}
          >
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {complaintInitial?.resolved ? 'Reklamation (bearbeitet)' : complaintInitial ? 'Reklamation (offen)' : 'Neue Reklamation'}
                </h2>
                <button onClick={() => { setComplaintEntryId(null); setComplaintStandaloneDate(null); setComplaintMessage(''); setComplaintInitial(null); }} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <div className="p-5 space-y-3">
                {complaintInitial?.resolved && complaintInitial.response && (
                  <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
                    <div className="text-xs font-semibold text-green-700 mb-1">Antwort vom Admin:</div>
                    <div className="text-gray-700 whitespace-pre-wrap">{complaintInitial.response}</div>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    {complaintInitial ? 'Deine Nachricht' : 'Was möchtest du reklamieren?'}
                  </label>
                  <textarea
                    value={complaintMessage}
                    onChange={(e) => setComplaintMessage(e.target.value)}
                    rows={5}
                    placeholder="z.B. Habe vergessen auszustempeln, war eigentlich bis 17:00 da..."
                    disabled={!!complaintInitial?.resolved}
                    className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                  />
                </div>
              </div>
              <div className="p-5 border-t flex items-center justify-end gap-2">
                <button onClick={() => { setComplaintEntryId(null); setComplaintStandaloneDate(null); setComplaintMessage(''); setComplaintInitial(null); }} className="text-sm text-gray-600 hover:bg-gray-100 px-4 py-2 rounded-lg">
                  Schließen
                </button>
                {!complaintInitial?.resolved && (
                  <button
                    disabled={complaintSubmitting || !complaintMessage.trim()}
                    onClick={async () => {
                      if (!complaintMessage.trim()) { toast.error('Bitte Nachricht eingeben'); return; }
                      setComplaintSubmitting(true);
                      try {
                        if (complaintEntryId) {
                          await timeEntriesApi.createComplaint(complaintEntryId, complaintMessage);
                        } else if (complaintStandaloneDate) {
                          const dateStr = format(complaintStandaloneDate, 'yyyy-MM-dd');
                          await timeEntriesApi.createStandaloneComplaint(dateStr, complaintMessage);
                        }
                        toast.success('Reklamation gesendet');
                        queryClient.invalidateQueries({ queryKey: ['week-entries'] });
                        queryClient.invalidateQueries({ queryKey: ['myStats'] });
                        setComplaintEntryId(null);
                        setComplaintStandaloneDate(null);
                        setComplaintMessage('');
                        setComplaintInitial(null);
                      } catch (err: any) {
                        toast.error(err.response?.data?.error || 'Fehler beim Senden');
                      } finally {
                        setComplaintSubmitting(false);
                      }
                    }}
                    className="text-sm bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-lg disabled:opacity-50"
                  >
                    {complaintInitial ? 'Aktualisieren' : 'Reklamation senden'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Arbeitszeit Monat */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-purple-100">
              <Calendar className="w-5 h-5 text-purple-600" />
            </div>
            <h2 className="font-semibold text-gray-900">Dieser Monat</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-purple-50 rounded-lg">
              <p className="text-lg font-bold text-purple-600">
                {stats?.monthHours != null ? formatHoursToTime(stats.monthHours) : '-'}
              </p>
              <p className="text-xs text-gray-500">Gearbeitet</p>
            </div>
            <div className="text-center p-2 bg-gray-50 rounded-lg">
              <p className="text-lg font-bold text-gray-900">
                {stats?.monthlyTarget != null ? formatHoursToTime(stats.monthlyTarget) : '-'}
              </p>
              <p className="text-xs text-gray-500">Soll</p>
            </div>
            <div className="text-center p-2 bg-orange-50 rounded-lg">
              <p className={`text-lg font-bold ${stats?.monthOvertime != null && stats.monthOvertime < 0 ? 'text-red-600' : stats?.monthOvertime != null && stats.monthOvertime > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                {stats?.monthOvertime != null ? formatHoursToTime(stats.monthOvertime) : '-'}
              </p>
              <p className="text-xs text-gray-500">Saldo</p>
            </div>
          </div>
        </div>

        {/* Urlaubstage */}
        <div className="card p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-green-100">
              <Umbrella className="w-5 h-5 text-green-600" />
            </div>
            <h2 className="font-semibold text-gray-900">Urlaubstage {new Date().getFullYear()}</h2>
          </div>
          {vacationDetails?.carryOver > 0 && (
            <div className="mb-2 p-2 bg-blue-50 rounded-lg text-center">
              <p className="text-xs text-blue-600">
                Übertrag aus {(vacationDetails?.year || new Date().getFullYear()) - 1}: <span className="font-bold">{vacationDetails.carryOver}</span> Tage
                {vacationDetails.carryOverUsed > 0 && <span> ({vacationDetails.carryOverUsed} verbraucht, <span className="font-bold">{vacationDetails.carryOverRemaining}</span> übrig)</span>}
              </p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-gray-50 rounded-lg">
              <p className="text-lg font-bold text-gray-900">{vacationDetails?.total ?? stats?.vacationDaysTotal ?? '-'}</p>
              <p className="text-xs text-gray-500">Gesamt</p>
            </div>
            <div className="text-center p-2 bg-orange-50 rounded-lg">
              <p className="text-lg font-bold text-orange-600">{vacationDetails?.totalUsed ?? stats?.vacationDaysUsed ?? '-'}</p>
              <p className="text-xs text-gray-500">Genommen</p>
            </div>
            <div className="text-center p-2 bg-green-50 rounded-lg">
              <p className={`text-lg font-bold ${(vacationDetails?.totalRemaining ?? 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>{vacationDetails?.totalRemaining ?? stats?.vacationDaysRemaining ?? '-'}</p>
              <p className="text-xs text-gray-500">Verbleibend</p>
            </div>
          </div>
          {/* Abzüge & Sonderurlaub */}
          {(vacationDetails?.deductedDays > 0 || vacationDetails?.specialLeaveUsed > 0) && (
            <div className="mt-2 space-y-1">
              {vacationDetails.deductedDays > 0 && (
                <div className="p-1.5 bg-red-50 rounded text-xs text-red-600 text-center">
                  {vacationDetails.deductedDays} Tag(e) abgezogen (Minusstunden-Ausgleich)
                </div>
              )}
              {vacationDetails.specialLeaveUsed > 0 && (
                <div className="p-1.5 bg-purple-50 rounded text-xs text-purple-600 text-center">
                  {vacationDetails.specialLeaveUsed} Tag(e) Sonderurlaub (zählt nicht als Urlaub)
                </div>
              )}
            </div>
          )}
        </div>

        {/* Krankheitstage */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-lg bg-red-100">
              <Thermometer className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="font-semibold text-gray-900">Krankheitstage {new Date().getFullYear()}</h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-center p-2 bg-red-50 rounded-lg">
              <p className="text-lg font-bold text-red-600">{stats?.sickDaysMonth ?? 0}</p>
              <p className="text-xs text-gray-500">Dieser Monat</p>
            </div>
            <div className="text-center p-2 bg-gray-50 rounded-lg">
              <p className="text-lg font-bold text-gray-900">{stats?.sickDaysYear ?? 0}</p>
              <p className="text-xs text-gray-500">Dieses Jahr</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
