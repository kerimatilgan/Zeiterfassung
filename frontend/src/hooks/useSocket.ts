import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { getServerUrl } from '../lib/serverConfig';

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
    // Socket.io Verbindung zum Backend aufbauen — mit JWT-Auth.
    // Im Browser (gleiche Domain) reicht window.location.origin; in Capacitor/Tauri
    // muss eine absolute URL aus serverConfig verwendet werden.
    const token = useAuthStore.getState().token || '';
    const serverUrl = getServerUrl();
    const socketTarget = serverUrl || window.location.origin;
    const socket = io(socketTarget, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      auth: { token },
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

    // Dokumenten-Events (Upload, Update, Delete, Sign, Generate)
    socket.on('document-updated', (event: { type: string; employeeId?: string; documentId?: string }) => {
      console.log('📥 Dokument Event:', event);
      queryClient.invalidateQueries({ queryKey: ['my-documents'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] }); // Admin: latestInfoLetter-Status
      if (event.employeeId) {
        queryClient.invalidateQueries({ queryKey: ['employee-documents', event.employeeId] });
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
