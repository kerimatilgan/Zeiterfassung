import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

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
    hoursWorked?: string;
  };
  message?: string;
  error?: string;
}

type AppState = 'idle' | 'scanning' | 'success' | 'error';

export default function App() {
  const [state, setState] = useState<AppState>('idle');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [cameraError, setCameraError] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'qr-reader';

  // Uhrzeit aktualisieren
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // QR-Code verarbeiten
  const processQRCode = useCallback(async (qrCode: string) => {
    console.log('Processing QR code:', qrCode);
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
  }, []);

  // Scanner starten
  const startScanner = useCallback(async () => {
    setCameraError(null);
    setState('scanning');

    // Warten bis DOM-Element gerendert ist
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const html5QrCode = new Html5Qrcode(scannerContainerId);
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        async (decodedText) => {
          console.log('QR Code detected:', decodedText);
          // Scanner stoppen
          await html5QrCode.stop();
          scannerRef.current = null;
          // QR-Code verarbeiten
          await processQRCode(decodedText);
        },
        (errorMessage) => {
          // Ignoriere "QR code parse error" - das passiert ständig wenn kein QR-Code im Bild ist
          if (!errorMessage.includes('QR code parse error')) {
            console.log('Scan info:', errorMessage);
          }
        }
      );
    } catch (error: unknown) {
      console.error('Camera error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('Permission') || errorMessage.includes('NotAllowed')) {
        setCameraError('Kamerazugriff verweigert. Bitte in den Browser-Einstellungen erlauben.');
      } else if (errorMessage.includes('NotFound')) {
        setCameraError('Keine Kamera gefunden.');
      } else {
        setCameraError(`Kamera-Fehler: ${errorMessage}`);
      }
      setState('idle');
    }
  }, [processQRCode]);

  // Scanner stoppen
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch (e) {
        console.log('Scanner already stopped');
      }
      scannerRef.current = null;
    }
    setState('idle');
  }, []);

  // Cleanup beim Unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

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
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-black">
              <div id={scannerContainerId} className="w-full h-full" />
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
                {result.entry.hoursWorked} h
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

    </div>
  );
}
