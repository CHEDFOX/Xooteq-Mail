// A company's folders and sending identities, loaded once and shared by every
// view that needs them (the sidebar, the list, the composer), refreshed on demand.
import { useEffect, useState } from "react";
import type { Jmap } from "./jmap";
import type { Identity, Mailbox } from "./types";

type Entry = { boxes: Mailbox[]; identities: Identity[]; loaded: boolean; error?: string; inflight?: Promise<void> };
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

const notify = (cid: string) => listeners.get(cid)?.forEach((f) => f());

export async function refreshMailData(j: Jmap, withIdentities = false): Promise<void> {
  const cur = cache.get(j.cid) ?? { boxes: [], identities: [], loaded: false };
  cache.set(j.cid, cur);
  if (cur.inflight && !withIdentities) return cur.inflight;
  cur.inflight = (async () => {
    try {
      const [boxes, identities] = await Promise.all([j.mailboxes(), withIdentities || !cur.loaded ? j.identities() : Promise.resolve(cur.identities)]);
      cache.set(j.cid, { boxes, identities, loaded: true });
    } catch (e) {
      cache.set(j.cid, { ...cur, inflight: undefined, error: (e as Error).message, loaded: cur.loaded });
    }
    notify(j.cid);
  })();
  return cur.inflight;
}

export function useMailData(j: Jmap | undefined): Entry & { refresh: () => Promise<void> } {
  const [, setTick] = useState(0);
  const cid = j?.cid ?? "";
  useEffect(() => {
    if (!j) return;
    const on = () => setTick((t) => t + 1);
    if (!listeners.has(cid)) listeners.set(cid, new Set());
    listeners.get(cid)!.add(on);
    if (!cache.get(cid)?.loaded) refreshMailData(j);
    return () => { listeners.get(cid)?.delete(on); };
  }, [j, cid]);
  const e = cache.get(cid) ?? { boxes: [], identities: [], loaded: false };
  return { ...e, refresh: () => (j ? refreshMailData(j) : Promise.resolve()) };
}
