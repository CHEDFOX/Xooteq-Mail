// Notices at the foot of the screen, each with an optional action (Undo).
import { useApp } from "../store";
import { cls } from "../util";
import { Alert, Check, X } from "../icons";

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cls("toast", t.tone && `toast-${t.tone}`)}>
          {t.tone === "error" ? <Alert size={16} /> : t.tone === "ok" ? <Check size={16} /> : null}
          <span className="toast-text">{t.text}</span>
          {t.action && <button className="toast-action" onClick={() => { dismiss(t.id); t.action!.run(); }}>{t.action.label}</button>}
          <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
