import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: number;
  type: ToastType;
  message: string;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

export const TOASTS_ENABLED_KEY = "sams.toastsEnabled";

function toastsEnabled(): boolean {
  return localStorage.getItem(TOASTS_ENABLED_KEY) !== "false";
}

const ToastContext = createContext<ToastApi | null>(null);

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((type: ToastType, message: string) => {
    if (!toastsEnabled()) {
      return;
    }

    const id = nextId.current++;
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    success: (message: string) => push("success", message),
    error: (message: string) => push("error", message),
    info: (message: string) => push("info", message)
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = icons[toast.type];
          return (
            <div key={toast.id} className={`toast toast-${toast.type}`} role="status">
              <Icon size={18} />
              <span className="toast-message">{toast.message}</span>
              <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
