import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';

// API Key für Terminal
const API_KEY = 'handy-insel-terminal-key-2024';
const API_BASE = '/api/terminal';

interface ScanResult {
  success: boolean;
  action?: 'clock_in' | 'clock_out';
  employee?: {
    name: string;
    employeeNumber: string;
  };
  entry?: {
    clockIn: string;
    clockOut?: string;
    hoursWorked?: number;
  };
  message?: string;
  error?: string;
}

interface ActiveEmployee {
  employeeName: string;
  employeeNumber: string;
  clockIn: string;
}

type AppState = 'idle' | 'scanning' | 'success' | 'error';

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeEmployees, setActiveEmployees] = useState<ActiveEmployee[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);

  // Uhrzeit aktualisieren
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Aktive Mitarbeiter laden
  const loadActiveEmployees = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/active`, {
        headers: { 'x-terminal-api-key': API_KEY },
      });
      if (response.ok) {
        const data = await response.json();
        setActiveEmployees(data);
      }
    } catch (error) {
      console.error('Failed to load active employees:', error);
    }
  }, []);

  useEffect(() => {
    loadActiveEmployees();
    const interval = setInterval(loadActiveEmployees, 30000);
    return () => clearInterval(interval);
  }, [loadActiveEmployees]);

  // QR-Code Scanner initialisieren
  const startScanner = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);

      const reader = new BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      const backCamera = devices.find(
        (d) => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear')
      );
      const deviceId = backCamera?.deviceId || devices[0]?.deviceId;

      if (!deviceId) {
        setCameraError('Keine Kamera gefunden');
        return;
      }

      setState('scanning');

      await reader.decodeFromVideoDevice(deviceId, videoRef.current, async (scanResult, error) => {
        if (scanResult) {
          const qrCode = scanResult.getText();
          console.log('Scanned:', qrCode);

          // Scanner stoppen während der Verarbeitung
          reader.reset();
          setState('idle');

          await processQRCode(qrCode);
        }
        if (error && !(error.name === 'NotFoundException')) {
          console.error('Scan error:', error);
        }
      });
    } catch (error) {
      console.error('Camera error:', error);
      setCameraError('Kamerazugriff verweigert. Bitte Berechtigung erteilen.');
    }
  }, []);

  const stopScanner = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current = null;
    }
    setState('idle');
  }, []);

  // QR-Code verarbeiten
  const processQRCode = async (qrCode: string) => {
    try {
      const response = await fetch(`${API_BASE}/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-terminal-api-key': API_KEY,
        },
        body: JSON.stringify({ qrCode }),
      });

      const data: ScanResult = await response.json();
      setResult(data);
      setState(data.success ? 'success' : 'error');

      // Nach Erfolg aktive Mitarbeiter aktualisieren
      if (data.success) {
        loadActiveEmployees();
      }

      // Nach 5 Sekunden zurücksetzen
      setTimeout(() => {
        setResult(null);
        setState('idle');
      }, 5000);
    } catch (error) {
      console.error('API error:', error);
      setResult({
        success: false,
        error: 'Verbindungsfehler zum Server',
      });
      setState('error');

      setTimeout(() => {
        setResult(null);
        setState('idle');
      }, 5000);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('de-DE', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  };

  return (
    <div className="h-full flex flex-col text-white">
      {/* Header */}
      <header className="p-6 text-center">
        <h1 className="text-3xl font-bold mb-2">Handy-Insel</h1>
        <p className="text-5xl font-mono font-bold">{formatTime(currentTime)}</p>
        <p className="text-lg text-blue-200 mt-2">{formatDate(currentTime)}</p>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6">
        {state === 'idle' && (
          <div className="text-center">
            <button
              onClick={startScanner}
              className="w-48 h-48 rounded-full bg-white/20 backdrop-blur border-4 border-white/50 flex items-center justify-center hover:bg-white/30 transition-all active:scale-95"
            >
              <div className="text-center">
                <svg
                  className="w-20 h-20 mx-auto mb-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                  />
                </svg>
                <span className="text-xl font-medium">QR-Code scannen</span>
              </div>
            </button>
            {cameraError && (
              <p className="mt-4 text-red-300 bg-red-900/50 px-4 py-2 rounded-lg">
                {cameraError}
              </p>
            )}
            <p className="mt-6 text-blue-200">
              Halte deinen QR-Code Badge vor die Kamera
            </p>
          </div>
        )}

        {state === 'scanning' && (
          <div className="text-center w-full max-w-md">
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-black scanner-overlay">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
              <div className="absolute inset-4 border-2 border-white/50 rounded-lg pointer-events-none" />
            </div>
            <button
              onClick={stopScanner}
              className="mt-6 px-8 py-3 bg-white/20 rounded-full text-lg font-medium hover:bg-white/30 transition-all"
            >
              Abbrechen
            </button>
          </div>
        )}

        {state === 'success' && result && (
          <div className="text-center">
            <div
              className={`w-32 h-32 rounded-full mx-auto mb-6 flex items-center justify-center ${
                result.action === 'clock_in'
                  ? 'bg-green-500 pulse-green'
                  : 'bg-orange-500 pulse-red'
              }`}
            >
              {result.action === 'clock_in' ? (
                <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              )}
            </div>
            <h2 className="text-4xl font-bold mb-2">{result.employee?.name}</h2>
            <p className="text-xl text-blue-200 mb-4">#{result.employee?.employeeNumber}</p>
            <p className="text-2xl">{result.message}</p>
            {result.entry?.hoursWorked !== undefined && (
              <p className="text-3xl font-bold mt-4">
                {result.entry.hoursWorked} Stunden
              </p>
            )}
          </div>
        )}

        {state === 'error' && result && (
          <div className="text-center">
            <div className="w-32 h-32 rounded-full bg-red-500 mx-auto mb-6 flex items-center justify-center pulse-red">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold mb-4">Fehler</h2>
            <p className="text-xl">{result.error}</p>
          </div>
        )}
      </main>

      {/* Active Employees */}
      {state === 'idle' && activeEmployees.length > 0 && (
        <footer className="p-4 bg-black/20">
          <p className="text-sm text-blue-200 mb-2 text-center">
            Aktuell eingestempelt ({activeEmployees.length}):
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {activeEmployees.map((emp) => (
              <span
                key={emp.employeeNumber}
                className="px-3 py-1 bg-green-500/30 rounded-full text-sm"
              >
                {emp.employeeName}
              </span>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
