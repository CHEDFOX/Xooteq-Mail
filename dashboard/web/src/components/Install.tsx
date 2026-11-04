// Adding Xooteq Mail to a device: the offer that appears once on a phone, the
// same thing as a card in Settings for whoever dismissed it, and the line that
// says a new version is ready.
import { useEffect, useState } from "react";
import { applyUpdate, canInstall, install, isApple, isInstalled } from "../pwa";
import { Check, Download, Plus, Refresh, X } from "../icons";
import { Button, Card } from "../ui";

const DISMISSED = "xm-install-dismissed";

/** What this device can do about keeping the app: pwa.ts holds the offer
 *  Chrome makes once at load, so a card opened later still sees it. */
function useInstallState() {
  const [offer, setOffer] = useState(canInstall);
  const [installed, setInstalled] = useState(isInstalled);
  useEffect(() => {
    const changed = () => setOffer(canInstall());
    const done = () => { setInstalled(true); setOffer(false); };
    window.addEventListener("xm:installable", changed);
    window.addEventListener("xm:installed", done);
    return () => { window.removeEventListener("xm:installable", changed); window.removeEventListener("xm:installed", done); };
  }, []);
  return { installed, offer, apple: isApple() };
}

/** The steps on an iPhone or iPad, where only Safari's own sheet can install. */
function AppleSteps({ short }: { short?: boolean }) {
  if (short) return <><b>Share</b> → <b>Add to Home Screen</b></>;
  return <>Open the <b>Share</b> menu at the bottom of Safari, then <b>Add to Home Screen</b>.</>;
}

/** Shown once, above everything, on a phone. Dismissing it is remembered. */
export function InstallBar() {
  const { installed, offer, apple } = useInstallState();
  const [gone, setGone] = useState(() => {
    try { return localStorage.getItem(DISMISSED) === "1"; } catch { return false; }
  });
  const hide = () => {
    setGone(true);
    try { localStorage.setItem(DISMISSED, "1"); } catch { /* private mode */ }
  };
  // Nothing to say when it is already an app, when it was waved away, or in a
  // browser that cannot install at all (no offer, and not Safari on iOS).
  if (installed || gone || (!offer && !apple)) return null;
  return (
    <div className="install-bar">
      <span className="install-mark" aria-hidden><Download size={15} /></span>
      <span className="install-text">
        <b>Keep Xooteq Mail on this device</b>
        <span>{offer ? "One tap from the home screen." : <AppleSteps short />}</span>
      </span>
      {offer && <Button size="sm" variant="primary" onClick={() => install().then((yes) => yes && hide())}>Add</Button>}
      <button className="icon-btn" aria-label="Not now" onClick={hide}><X size={16} /></button>
    </div>
  );
}

/** Settings → Account: the same offer, for whoever dismissed the bar. */
export function InstallCard() {
  const { installed, offer, apple } = useInstallState();
  return (
    <Card title="This device" subtitle="Xooteq Mail runs as an app on a phone, a tablet or a desktop: its own icon, its own window, and it opens where you left off.">
      {installed ? (
        <p className="install-done"><Check size={16} />Installed on this device.</p>
      ) : offer ? (
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => install()}>Add to this device</Button>
      ) : apple ? (
        <p className="field-hint"><AppleSteps /></p>
      ) : (
        <p className="field-hint">
          In Chrome or Edge, open the browser's menu and choose <b>Install Xooteq Mail</b> (or the install icon in the address bar).
          In Safari on a Mac, <b>File → Add to Dock</b>.
        </p>
      )}
    </Card>
  );
}

/** A new version of the app is cached and waiting; one tap starts it. */
export function UpdateBar() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener("xm:update", on);
    return () => window.removeEventListener("xm:update", on);
  }, []);
  if (!ready) return null;
  return (
    <div className="install-bar is-update">
      <span className="install-mark" aria-hidden><Refresh size={15} /></span>
      <span className="install-text"><b>A new version is ready</b><span>Reload to start it.</span></span>
      <Button size="sm" variant="primary" onClick={applyUpdate}>Reload</Button>
      <button className="icon-btn" aria-label="Later" onClick={() => setReady(false)}><X size={16} /></button>
    </div>
  );
}
