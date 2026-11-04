// Who sees what: the sign-in page, or the app; "/" goes to the first company's Inbox.
import { useEffect } from "react";
import { go, useRoute } from "./router";
import { AppProvider, useApp } from "./store";
import { Login } from "./components/Login";
import { Shell } from "./components/Shell";
import { Toasts } from "./components/Toasts";
import { Tooltip } from "./components/Tooltip";
import { InstallBar, UpdateBar } from "./components/Install";
import { Mark } from "./components/Brand";
import { Button } from "./ui";

function Routes() {
  const route = useRoute();
  const { me, loading, offline, refreshMe } = useApp();

  useEffect(() => {
    if (loading || (offline && !me)) return;
    if (!me && route.page !== "login") go("/login", true);
    else if (me && route.page === "login") go("/", true);
    else if (me && route.page === "home") {
      const first = me.companies[0];
      go(first ? { page: "mail", cid: first.id, box: "inbox" } : "/settings/new", true);
    }
  }, [me, loading, offline, route]);

  useEffect(() => {
    const c = me?.companies.find((x) => (route.page === "mail" || route.page === "search") && x.id === route.cid);
    document.title = c ? `${c.name} · Xooteq Mail` : route.page === "settings" ? "Settings · Xooteq Mail" : "Xooteq Mail";
  }, [me, route]);

  if (loading) return <div className="splash"><Mark size={40} /></div>;
  // No answer from the server at all: say so, rather than asking them to sign
  // in again — the session is fine, the connection is not.
  if (!me && offline) {
    return (
      <div className="splash splash-offline">
        <Mark size={40} />
        <h1>No connection</h1>
        <p>Xooteq Mail opens as soon as this device is back online.</p>
        <Button onClick={() => refreshMe()}>Try again</Button>
      </div>
    );
  }
  if (!me) return route.page === "login" ? <Login /> : <div className="splash"><Mark size={40} /></div>;
  if (route.page === "home" || route.page === "login") return <div className="splash"><Mark size={40} /></div>;
  return (
    <div className="app">
      <UpdateBar />
      <InstallBar />
      <Shell route={route} />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Routes />
      <Toasts />
      <Tooltip />
    </AppProvider>
  );
}
