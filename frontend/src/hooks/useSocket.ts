import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

interface TimeEntryEvent {
  type: 'clock_in' | 'clock_out' | 'manual_create' | 'update' | 'delete';
  employeeId: string;
  entry?: any;
  entryId?: string;
  employee: {
    id: string;
    name: string;
    employeeNumber: string;
  };
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Socket.io Verbindung zum Backend aufbauen
    // Über nginx Proxy (gleiche Origin) oder direkt im DEV-Modus ohne nginx
    const socket = io(window.location.origin, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('🔌 WebSocket verbunden:', socket.id);
    });

    socket.on('disconnect', () => {
      console.log('🔌 WebSocket getrennt');
    });

    // Zeit-Einträge Events
    socket.on('time-entry-updated', (event: TimeEntryEvent) => {
      console.log('📥 Zeit-Eintrag Event:', event);

      // Alle relevanten Queries invalidieren
      queryClient.invalidateQueries({ queryKey: ['timeEntries'] });
      queryClient.invalidateQueries({ queryKey: ['myTimeEntries'] });
      queryClient.invalidateQueries({ queryKey: ['myStatus'] });
      queryClient.invalidateQueries({ queryKey: ['myStats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
      queryClient.invalidateQueries({ queryKey: ['activeEmployees'] });

      // Falls spezifische Employee-ID, auch diese invalidieren
      if (event.employeeId) {
        queryClient.invalidateQueries({ queryKey: ['employee', event.employeeId] });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  const emit = useCallback((event: string, data: any) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { emit, socket: socketRef.current };
}

// Hook für Echtzeit-Uhr (aktualisiert jede Sekunde)
export function useRealtimeClock(callback: () => void, intervalMs: number = 1000) {
  useEffect(() => {
    const interval = setInterval(callback, intervalMs);
    return () => clearInterval(interval);
  }, [callback, intervalMs]);
}
