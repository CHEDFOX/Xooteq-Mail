// Reading something from the server for a screen: the answer, what went wrong,
// and pull-to-refresh. Nothing is set until the request comes back, so opening
// a screen draws once rather than twice.
//
// `key` says what the request depends on — put the ids and filters in it, and
// the request runs again whenever it changes.
import { useEffect, useState } from "react";

export type Loaded<T> = {
  data: T | null;
  error: string;
  /** A refresh the person asked for, for the spinner at the top of a list. */
  busy: boolean;
  refresh: () => void;
  /** For a screen that shows a change before the server has confirmed it. */
  set: (next: T | null) => void;
};

export function useLoad<T>(fetcher: () => Promise<T>, key = ""): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await fetcher();
        if (!alive) return;
        setData(next);
        setError("");
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is what the request depends on
  }, [key, again]);

  return {
    data,
    error,
    busy,
    refresh: () => { setBusy(true); setAgain((n) => n + 1); },
    set: setData,
  };
}
