// One tooltip for the whole app: any element with data-tip shows it after a
// short hover, placed beside the rail or below anything else, never clipped.
import { useEffect, useRef, useState } from "react";

export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; side: "right" | "below" | "above" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let current: Element | null = null;
    const hide = () => { clearTimeout(timer.current); current = null; setTip(null); };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.("[data-tip]");
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer.current = setTimeout(() => {
        const text = el.getAttribute("data-tip");
        if (!text || !document.contains(el)) return;
        const r = el.getBoundingClientRect();
        if (el.closest(".rail")) setTip({ text, x: r.right + 10, y: r.top + r.height / 2, side: "right" });
        else if (r.bottom + 40 > window.innerHeight) setTip({ text, x: r.left + r.width / 2, y: r.top - 8, side: "above" });
        else setTip({ text, x: r.left + r.width / 2, y: r.bottom + 8, side: "below" });
      }, 380);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      clearTimeout(timer.current);
    };
  }, []);
  if (!tip) return null;
  const [label, keys] = tip.text.split(/\s{2,}/);
  return (
    <div className={`tooltip tooltip-${tip.side}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {label}{keys && <span className="tooltip-keys">{keys}</span>}
    </div>
  );
}
