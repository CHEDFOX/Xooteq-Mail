// What the whole app shares: which server, who is signed in, their companies,
// the unread counts, and one JMAP client per company.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, get, loadSession, serverUrl, signIn as apiSignIn, signOut as apiSignOut } from "./api";
import { Jmap } from "./jmap";
import type { Company, Me } from "./types";

export type Unread = Record<string, { inbox: number; drafts: number; aiDrafts: number }>;

type Session = {
  /** Still reading what was kept from the last run. */
  starting: boolean;
  me: Me | null;
  server: string;
  /** The server answered nothing at all, rather than refusing us. */
  offline: boolean;
  unread: Unread;
  company: (cid?: string) => Company | undefined;
  jmap: (cid: string) => Jmap;
  refresh: () => Promise<Me | null>;
  refreshUnread: () => void;
  signIn: (server: string, email: string, password: string, device: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);
export const useSession = () => useContext(Ctx)!;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [starting, setStarting] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [server, setServerState] = useState("");
  const [offline, setOffline] = useState(false);
  const [unread, setUnread] = useState<Unread>({});
  const clients = useRef(new Map<string, Jmap>());

  const refresh = useCallback(async () => {
    try {
      const next = await get<Me>("/api/me");
      setMe(next);
      setOffline(false);
      return next;
    } catch (e) {
      // Refused means the token is gone; silence means no connection, and then
      // what the app already has stays on screen.
      if (e instanceof ApiError) setMe(null);
      else setOffline(true);
      return null;
    }
  }, []);

  const refreshUnread = useCallback(() => {
    get<Unread>("/api/unread").then(setUnread).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const kept = await loadSession();
      setServerState(kept.server);
      if (kept.token && kept.server) await refresh();
      setStarting(false);
    })();
  }, [refresh]);

  useEffect(() => {
    if (!me) return;
    refreshUnread();
    const t = setInterval(refreshUnread, 60_000);
    return () => clearInterval(t);
  }, [me, refreshUnread]);

  const value = useMemo<Session>(() => ({
    starting, me, server, offline, unread,
    company: (cid?: string) => me?.companies.find((c) => c.id === cid),
    jmap: (cid: string) => {
      let j = clients.current.get(cid);
      if (!j) clients.current.set(cid, (j = new Jmap(cid)));
      return j;
    },
    refresh,
    refreshUnread,
    signIn: async (url, email, password, device) => {
      await apiSignIn(url, email, password, device);
      setServerState(serverUrl());
      clients.current.clear();
      const next = await get<Me>("/api/me");
      setMe(next);
      setOffline(false);
    },
    signOut: async () => {
      await apiSignOut();
      clients.current.clear();
      setMe(null);
      setUnread({});
    },
  }), [starting, me, server, offline, unread, refresh, refreshUnread]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
