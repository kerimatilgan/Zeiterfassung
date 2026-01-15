import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { timeEntriesApi } from '../../lib/api';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';

interface TimeEntry {
  id: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  note: string | null;
}

export default function EmployeeTimesheet() {
  const [currentDate, setCurrentDate] = useState(new Date());

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);

  const { data: entries } = useQuery({
    queryKey: ['my-entries', currentDate.getMonth(), currentDate.getFullYear()],
    queryFn: () =>
      timeEntriesApi
        .getMy({
          from: monthStart.toISOString(),
          to: monthEnd.toISOString(),
        })
        .then((r) => r.data as TimeEntry[]),
  });

  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getEntriesForDay = (day: Date) => {
    return entries?.filter((entry) => isSameDay(new Date(entry.clockIn), day)) || [];
  };

  const calculateDayHours = (dayEntries: TimeEntry[]) => {
    return dayEntries.reduce((total, entry) => {
      if (!entry.clockOut) return total;
      const ms = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime();
      const hours = ms / (1000 * 60 * 60) - entry.breakMinutes / 60;
      return total + hours;
    }, 0);
  };

  const totalMonthHours = entries?.reduce((total, entry) => {
    if (!entry.clockOut) return total;
    const ms = new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime();
    const hours = ms / (1000 * 60 * 60) - entry.breakMinutes / 60;
    return total + hours;
  }, 0) || 0;

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const isWeekend = (day: Date) => day.getDay() === 0 || day.getDay() === 6;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meine Zeiten</h1>
          <p className="text-gray-500">Übersicht deiner Arbeitsstunden</p>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center gap-4">
          <button
            onClick={prevMonth}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-lg font-medium min-w-[180px] text-center">
            {format(currentDate, 'MMMM yyyy', { locale: de })}
          </span>
          <button
            onClick={nextMonth}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="card p-6 bg-gradient-to-r from-primary-500 to-primary-600 text-white">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white/20 rounded-lg">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-primary-100">Gesamtstunden {format(currentDate, 'MMMM', { locale: de })}</p>
            <p className="text-3xl font-bold">{totalMonthHours.toFixed(2)} Stunden</p>
          </div>
        </div>
      </div>

      {/* Calendar View */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">
                  Datum
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Tag
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Zeiten
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase w-24">
                  Stunden
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {daysInMonth.map((day) => {
                const dayEntries = getEntriesForDay(day);
                const dayHours = calculateDayHours(dayEntries);
                const weekend = isWeekend(day);
                const isToday = isSameDay(day, new Date());

                return (
                  <tr
                    key={day.toISOString()}
                    className={`
                      ${weekend ? 'bg-gray-50 text-gray-400' : ''}
                      ${isToday ? 'bg-primary-50' : ''}
                    `}
                  >
                    <td className="px-4 py-3">
                      <span className={`font-medium ${isToday ? 'text-primary-600' : ''}`}>
                        {format(day, 'dd.MM.yyyy')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {format(day, 'EEEE', { locale: de })}
                    </td>
                    <td className="px-4 py-3">
                      {dayEntries.length > 0 ? (
                        <div className="space-y-1">
                          {dayEntries.map((entry) => (
                            <div key={entry.id} className="text-sm">
                              <span className="font-medium">
                                {format(new Date(entry.clockIn), 'HH:mm')}
                              </span>
                              {entry.clockOut ? (
                                <span> - {format(new Date(entry.clockOut), 'HH:mm')}</span>
                              ) : (
                                <span className="text-green-600 ml-2">(aktiv)</span>
                              )}
                              {entry.breakMinutes > 0 && (
                                <span className="text-gray-400 ml-2">
                                  ({entry.breakMinutes} min Pause)
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : weekend ? (
                        <span className="text-gray-400">-</span>
                      ) : (
                        <span className="text-gray-400">Kein Eintrag</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {dayHours > 0 ? (
                        <span className="font-medium text-gray-900">
                          {dayHours.toFixed(2)} h
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={3} className="px-4 py-3 font-medium text-gray-900">
                  Gesamt
                </td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">
                  {totalMonthHours.toFixed(2)} h
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
