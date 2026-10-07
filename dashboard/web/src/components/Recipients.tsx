// An address field: typed addresses become chips; suggestions come from the
// people this company has written to or heard from.
import { useMemo, useRef, useState } from "react";
import type { EmailAddress } from "../types";
import { cls, displayName, isEmail, parseAddresses } from "../util";
import { X } from "../icons";

export function Recipients({ value, onChange, suggestions, autoFocus, placeholder }: {
  value: EmailAddress[];
  onChange: (v: EmailAddress[]) => void;
  suggestions: EmailAddress[];
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(value.map((v) => v.email.toLowerCase()));
    return suggestions.filter((s) => !taken.has(s.email.toLowerCase()) && (s.email.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q))).slice(0, 6);
  }, [text, suggestions, value]);

  function commit(raw = text) {
    const parsed = parseAddresses(raw).filter((a) => isEmail(a.email));
    if (parsed.length) onChange([...value, ...parsed.filter((p) => !value.some((v) => v.email.toLowerCase() === p.email.toLowerCase()))]);
    setText("");
    setActive(0);
  }

  function pick(a: EmailAddress) {
    onChange([...value, a]);
    setText("");
    setActive(0);
    input.current?.focus();
  }

  return (
    <div className={cls("recips", focus && "is-focus")} onClick={() => input.current?.focus()}>
      {value.map((v, i) => (
        <span key={v.email + i} className={cls("recip", !isEmail(v.email) && "is-bad")} title={v.email}>
          {displayName(v)}
          <button type="button" aria-label={`Remove ${v.email}`} onClick={(e) => { e.stopPropagation(); onChange(value.filter((_, j) => j !== i)); }}><X size={12} /></button>
        </span>
      ))}
      <input
        ref={input}
        value={text}
        autoFocus={autoFocus}
        placeholder={value.length ? "" : placeholder}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); if (text.trim()) commit(); }}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;]\s*$/.test(v)) commit(v.replace(/[,;]\s*$/, ""));
          else setText(v);
        }}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (/[,;\n]/.test(t)) { e.preventDefault(); commit(t); }
        }}
        onKeyDown={(e) => {
          if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
          } else if ((e.key === "Enter" || e.key === "Tab") && (matches.length || text.trim())) {
            if (matches.length) { e.preventDefault(); pick(matches[active]); }
            else if (e.key === "Enter") { e.preventDefault(); commit(); }
          } else if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        aria-label={placeholder ?? "Recipients"}
      />
      {focus && matches.length > 0 && (
        <div className="recips-menu" role="listbox">
          {matches.map((m, i) => (
            <button key={m.email} type="button" role="option" aria-selected={i === active} className={cls("recips-opt", i === active && "is-active")}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
              <b>{m.name || m.email}</b>{m.name && <span>{m.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
