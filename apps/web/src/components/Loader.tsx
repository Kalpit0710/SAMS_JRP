import { Loader2 } from "lucide-react";

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spinner-icon" aria-hidden="true" />;
}

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="page-loader">
      <Spinner size={28} />
      <p>{label}</p>
    </div>
  );
}

export function InlineLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="inline-loader">
      <Spinner size={16} />
      <span>{label}</span>
    </div>
  );
}
