// Addresses for every screen, so the back button, refresh and shared links work.
//
//   /mail/<company>/<folder>[/<thread>]      folder: inbox, drafts, sent, archive,
//                                            junk, trash, or a folder's id (f-<id>)
//   /search/<company>?q=...
//   /settings[/<section>[/<company>[/<tab>]]]
//   /login
import { useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  | { page: "login" }
  | { page: "mail"; cid: string; box: string; thread?: string }
  | { page: "search"; cid: string; q: string; thread?: string }
  | { page: "settings"; section: string; cid?: string; tab?: string };

export function parse(loc: Location = window.location): Route {
  const parts = loc.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(loc.search);
  if (parts[0] === "login") return { page: "login" };
  if (parts[0] === "mail" && parts[1]) return { page: "mail", cid: parts[1], box: parts[2] || "inbox", thread: parts[3] };
  if (parts[0] === "search" && parts[1]) return { page: "search", cid: parts[1], q: q.get("q") ?? "", thread: parts[2] };
  if (parts[0] === "settings") return { page: "settings", section: parts[1] || "companies", cid: parts[2], tab: parts[3] };
  return { page: "home" };
}

export function href(r: Route): string {
  const e = encodeURIComponent;
  switch (r.page) {
    case "home": return "/";
    case "login": return "/login";
    case "mail": return `/mail/${e(r.cid)}/${e(r.box)}${r.thread ? `/${e(r.thread)}` : ""}`;
    case "search": return `/search/${e(r.cid)}${r.thread ? `/${e(r.thread)}` : ""}?q=${e(r.q)}`;
    case "settings": return `/settings/${e(r.section)}${r.cid ? `/${e(r.cid)}` : ""}${r.cid && r.tab ? `/${e(r.tab)}` : ""}`;
  }
}

export function go(r: Route | string, replace = false): void {
  const url = typeof r === "string" ? r : href(r);
  if (url === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event("xm:route"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse());
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("popstate", on);
    window.addEventListener("xm:route", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("xm:route", on);
    };
  }, []);
  return route;
}

/** A link that navigates without reloading; modified clicks still open tabs. */
export function onNav(r: Route | string) {
  return (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(r);
  };
}
