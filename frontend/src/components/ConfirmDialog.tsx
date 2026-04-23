import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

type Variant = 'warning' | 'danger' | 'info';

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  variant?: Variant;
  confirmText?: string;
  cancelText?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

const variantStyles: Record<Variant, { icon: string; iconBg: string; button: string }> = {
  warning: { icon: 'text-amber-600', iconBg: 'bg-amber-100', button: 'bg-amber-600 hover:bg-amber-700' },
  danger: { icon: 'text-red-600', iconBg: 'bg-red-100', button: 'bg-red-600 hover:bg-red-700' },
  info: { icon: 'text-blue-600', iconBg: 'bg-blue-100', button: 'bg-blue-600 hover:bg-blue-700' },
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = (result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpts(null);
  };

  const styles = opts ? variantStyles[opts.variant ?? 'warning'] : variantStyles.warning;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[60]" onClick={() => close(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl w-full max-w-md z-[70] mx-4">
            <div className="p-5 flex items-start gap-3 border-b">
              <div className={`p-2 ${styles.iconBg} rounded-lg shrink-0`}>
                <AlertTriangle size={20} className={styles.icon} />
              </div>
              <div className="flex-1 pt-0.5">
                <h3 className="font-semibold text-gray-900">{opts.title}</h3>
              </div>
              <button onClick={() => close(false)} className="p-1 hover:bg-gray-100 rounded text-gray-500">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 text-sm text-gray-700 whitespace-pre-line">
              {opts.message}
            </div>
            <div className="p-4 bg-gray-50 rounded-b-xl flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {opts.cancelText ?? 'Abbrechen'}
              </button>
              <button
                onClick={() => close(true)}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${styles.button}`}
              >
                {opts.confirmText ?? 'Fortfahren'}
              </button>
            </div>
          </div>
        </>
      )}
    </ConfirmContext.Provider>
  );
}
