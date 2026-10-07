// The building blocks every screen is made of.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cls, initials, personColor } from "./util";
import { X } from "./icons";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  busy?: boolean;
};
export function Button({ variant = "secondary", size = "md", icon, busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button className={cls("btn", `btn-${variant}`, `btn-${size}`, busy && "is-busy", className)} disabled={disabled || busy} {...rest}>
      {busy ? <Spinner size={14} /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ label, shortcut, className, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean }) {
  return (
    <button className={cls("icon-btn", active && "is-active", className)} aria-label={label} data-tip={shortcut ? `${label}  ${shortcut}` : label} {...rest}>
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Field({ label, hint, error, children, inline }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={cls("field", inline && "field-inline")}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cls("input", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cls("input textarea", props.className)} />;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={cls("toggle", checked && "is-on")} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "md" }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className={cls("segmented", `segmented-${size}`)} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title}
          className={cls("segment", o.value === value && "is-on")} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Pill({ tone = "neutral", children, dot }: { tone?: "neutral" | "ok" | "warn" | "error" | "accent" | "info"; children: ReactNode; dot?: boolean }) {
  return <span className={cls("pill", `pill-${tone}`)}>{dot && <span className="pill-dot" />}{children}</span>;
}

export function Avatar({ name, email, size = 32 }: { name: string; email: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: personColor(email) }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input, textarea, select, button.btn-primary, button")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} style={{ maxWidth: width }}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** A button that opens a small menu below it. */
export function Menu({ trigger, items, align = "end" }: { trigger: (open: () => void) => ReactNode; items: ({ label: ReactNode; icon?: ReactNode; onSelect: () => void; danger?: boolean; hint?: string } | "sep")[]; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={cls("menu", `menu-${align}`)} role="menu">
          {items.map((it, i) => it === "sep" ? <div key={i} className="menu-sep" /> : (
            <button key={i} role="menuitem" className={cls("menu-item", it.danger && "is-danger")} onClick={() => { setOpen(false); it.onSelect(); }}>
              {it.icon}<span>{it.label}</span>{it.hint && <span className="menu-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cls("card", className)}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
