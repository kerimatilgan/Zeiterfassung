import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Check if we're running against Cloudflare Workers (no socket.io support)
const isWorkersBackend = import.meta.env.VITE_API_URL?.includes('workers.dev') || false;

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
  const socketRef = useRef<any>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Workers backend: no WebSocket, use polling instead
    if (isWorkersBackend) {
      // Poll for updates every 30 seconds
      const interval = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ['timeEntries'] });
        queryClient.invalidateQueries({ queryKey: ['myTimeEntries'] });
        queryClient.invalidateQueries({ queryKey: ['myStatus'] });
        queryClient.invalidateQueries({ queryKey: ['activeEmployees'] });
      }, 30000);
      return () => clearInterval(interval);
    }

    // Node.js backend: use socket.io
    import('socket.io-client').then(({ io }) => {
      const socket = io(window.location.origin, {
        path: '/socket.io/',
        transports: ['websocket', 'polling'],
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('WebSocket verbunden:', socket.id);
      });

      socket.on('disconnect', () => {
        console.log('WebSocket getrennt');
      });

      socket.on('time-entry-updated', (event: TimeEntryEvent) => {
        queryClient.invalidateQueries({ queryKey: ['timeEntries'] });
        queryClient.invalidateQueries({ queryKey: ['myTimeEntries'] });
        queryClient.invalidateQueries({ queryKey: ['myStatus'] });
        queryClient.invalidateQueries({ queryKey: ['myStats'] });
        queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
        queryClient.invalidateQueries({ queryKey: ['activeEmployees'] });
        if (event.employeeId) {
          queryClient.invalidateQueries({ queryKey: ['employee', event.employeeId] });
        }
      });
    }).catch(() => {
      console.log('Socket.io nicht verfügbar, verwende Polling');
    });

    return () => {
      socketRef.current?.disconnect();
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
