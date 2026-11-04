// What the whole app shares: who is signed in, the companies, unread counts,
// the theme, notices, the command palette and the composer.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, get, whenSignedOut } from "./api";
import { Jmap } from "./jmap";
import { go } from "./router";
import type { Company, Email, Me } from "./types";

export type Theme = "system" | "light" | "dark";
export type Toast = { id: number; text: string; tone?: "ok" | "error" | "info"; action?: { label: string; run: () => void }; ms?: number };
export type Unread = Record<string, { inbox: number; drafts: number; aiDrafts: number }>;

export type ComposeIntent =
  | { kind: "new"; cid: string; to?: string; from?: string }
  | { kind: "reply" | "replyAll" | "forward"; cid: string; email: Email; aiText?: string }
  | { kind: "draft"; cid: string; email: Email; replyTo?: string };

type Ctx = {
  me: Me | null;
  loading: boolean;
  /** The server could not be reached, rather than this device being signed out. */
  offline: boolean;
  refreshMe: () => Promise<Me | null>;
  unread: Unread;
  refreshUnread: () => void;
  company: (cid?: string) => Company | undefined;
  jmap: (cid: string) => Jmap;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toast: (t: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
  toasts: Toast[];
  palette: boolean;
  setPalette: (open: boolean) => void;
  compose: ComposeIntent | null;
  setCompose: (c: ComposeIntent | null) => void;
  help: boolean;
  setHelp: (open: boolean) => void;
  /** The address the open view is about (its folder or filter), so new mail starts from it. */
  viewAddress: string | undefined;
  setViewAddress: (email: string | undefined) => void;
};

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

function readTheme(): Theme {
  try { return (localStorage.getItem("xm-theme") as Theme) || "system"; } catch { return "system"; }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [unread, setUnread] = useState<Unread>({});
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [palette, setPalette] = useState(false);
  const [compose, setCompose] = useState<ComposeIntent | null>(null);
  const [help, setHelp] = useState(false);
  const [viewAddress, setViewAddress] = useState<string | undefined>(undefined);
  const clients = useRef(new Map<string, Jmap>());
  const nextId = useRef(1);

  const refreshMe = useCallback(async () => {
    try {
      const m = await get<Me>("/api/me");
      setMe(m);
      setOffline(false);
      return m;
    } catch (e) {
      // A refusal means signed out; no answer at all means no connection, and
      // then what is already on screen stays rather than the sign-in page.
      if (e instanceof ApiError) {
        setMe(null);
        setOffline(false);
      } else {
        setOffline(true);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUnread = useCallback(() => {
    get<Unread>("/api/unread").then(setUnread).catch(() => {});
  }, []);

  useEffect(() => {
    whenSignedOut(() => { setMe(null); setOffline(false); go("/login", true); });
    refreshMe();
    const back = () => { refreshMe(); };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [refreshMe]);

  useEffect(() => {
    if (!me) return;
    refreshUnread();
    const t = setInterval(refreshUnread, 60_000);
    return () => clearInterval(t);
  }, [me, refreshUnread]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try { localStorage.setItem("xm-theme", theme); } catch { /* private mode */ }
  }, [theme]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.ms ?? (t.tone === "error" ? 7000 : 4500));
    return id;
  }, [dismiss]);

  const value = useMemo<Ctx>(() => ({
    me, loading, offline, refreshMe, unread, refreshUnread,
    company: (cid?: string) => me?.companies.find((c) => c.id === cid),
    jmap: (cid: string) => {
      let j = clients.current.get(cid);
      if (!j) { j = new Jmap(cid); clients.current.set(cid, j); }
      return j;
    },
    theme, setTheme: setThemeState, toast, dismiss, toasts, palette, setPalette, compose, setCompose, help, setHelp, viewAddress, setViewAddress,
  }), [me, loading, offline, refreshMe, unread, refreshUnread, theme, toast, dismiss, toasts, palette, compose, help, viewAddress]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
