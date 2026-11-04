// Xooteq Mail as an app on a phone or a desktop: the service worker that keeps
// its shell (public/sw.js), and whether this device can add it to its home
// screen. A browser without any of this loses nothing; everything here is quiet
// when it is missing.

let waiting: ServiceWorker | null = null;

/** Installs the service worker, and says when a newer version is ready to take over. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // The new version took over after applyUpdate(); start it cleanly.
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      const announce = (sw: ServiceWorker | null) => {
        // Only once something is already serving the page: the first install is
        // this very visit, and there is nothing to tell anyone about.
        if (!sw || !navigator.serviceWorker.controller) return;
        waiting = sw;
        window.dispatchEvent(new Event("xm:update"));
      };
      announce(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => { if (sw.state === "installed") announce(sw); });
      });
      // Look for a new version each time the app is opened again.
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => { /* the app works without it */ });
  });
}

/** Lets the waiting version take over; the page reloads into it by itself. */
export function applyUpdate(): void {
  waiting?.postMessage({ type: "skip-waiting" });
}

/** Already running from the home screen (or as an installed desktop app). */
export function isInstalled(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: fullscreen)").matches
    || (navigator as { standalone?: boolean }).standalone === true;
}

/** iPhone and iPad, where installing is the Share sheet rather than a button. */
export function isApple(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Chrome's own "install this app" offer, held back until the page asks for it. */
type InstallOffer = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Chrome offers this once, early — before most of the app has been drawn — so
// it is caught here as the module loads and kept for whoever asks later.
let offer: InstallOffer | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    offer = e as InstallOffer;
    window.dispatchEvent(new Event("xm:installable"));
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    window.dispatchEvent(new Event("xm:installed"));
  });
}

/** Whether this browser will install the app at a button's press. */
export const canInstall = (): boolean => offer !== null;

/** Shows Chrome's own offer; true when the app was added. */
export async function install(): Promise<boolean> {
  if (!offer) return false;
  await offer.prompt();
  const { outcome } = await offer.userChoice;
  offer = null;
  window.dispatchEvent(new Event("xm:installable"));
  return outcome === "accepted";
}
