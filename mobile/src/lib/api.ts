// The line to a Xooteq Mail server: which server, the device's token, and the
// requests themselves. The token is the one /api/auth/device gives back; it is
// kept in the device's secure storage and sent as a bearer token, so the app
// stays signed in for a year of use without holding the password.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

/** Keys may hold letters, digits, ".", "-" and "_" (expo-secure-store). */
const TOKEN_KEY = "xooteq.token";
const SERVER_KEY = "xooteq.server";

// The phone keeps these in its secure storage, which the browser has no
// equivalent of; running the same app on the web falls back to localStorage.
const store = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
    }
    return SecureStore.getItemAsync(key).catch(() => null);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try { globalThis.localStorage?.setItem(key, value); } catch { /* private window */ }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try { globalThis.localStorage?.removeItem(key); } catch { /* private window */ }
      return;
    }
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
};

const configured = String((Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "").trim();

let server = "";
let token: string | null = null;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Thrown when the server could not be reached at all, as against refusing us. */
export class OfflineError extends Error {}

export const serverUrl = () => server;
export const authToken = () => token;

export function cleanServer(url: string): string {
  const s = url.trim().replace(/\/+$/, "");
  if (!s) return "";
  return /^https?:\/\//.test(s) ? s : `https://${s}`;
}

/** Reads what was kept from the last run; call once as the app starts. */
export async function loadSession(): Promise<{ server: string; token: string | null }> {
  const [savedServer, savedToken] = await Promise.all([store.get(SERVER_KEY), store.get(TOKEN_KEY)]);
  server = savedServer || configured;
  token = savedToken;
  return { server, token };
}

export async function setServer(url: string): Promise<void> {
  server = cleanServer(url);
  await store.set(SERVER_KEY, server);
}

export async function setToken(value: string | null): Promise<void> {
  token = value;
  if (value) await store.set(TOKEN_KEY, value);
  else await store.remove(TOKEN_KEY);
}

type Options = { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };

/**
 * One request to the dashboard's API. JSON in, JSON out, with the bearer token
 * and the header the server wants on everything that changes something.
 */
export async function api<T = unknown>(method: string, path: string, opts: Options = {}): Promise<T> {
  if (!server) throw new ApiError("No server yet. Sign in first.", 0);
  const headers: Record<string, string> = { "x-xooteq": "1", accept: "application/json", ...opts.headers };
  if (token) headers.authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(server + path, { method, headers, body, signal: opts.signal });
  } catch (e) {
    throw new OfflineError((e as Error).message || "The server could not be reached.");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = (data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "")
      || `The server said ${res.status}.`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const get = <T,>(path: string, opts?: Options) => api<T>("GET", path, opts);
export const post = <T,>(path: string, body?: unknown) => api<T>("POST", path, { body: body ?? {} });
export const patch = <T,>(path: string, body: unknown) => api<T>("PATCH", path, { body });
export const del = <T,>(path: string) => api<T>("DELETE", path);

/** Signs this device in and keeps its token. */
export async function signIn(url: string, email: string, password: string, device: string): Promise<{ email: string; name: string }> {
  await setServer(url);
  const out = await api<{ token: string; owner: { id: number; email: string; name: string } }>("POST", "/api/auth/device", {
    body: { email, password, device },
  });
  await setToken(out.token);
  return out.owner;
}

/** Signs out here and, unless the server is unreachable, there too. */
export async function signOut(): Promise<void> {
  try {
    await post("/api/auth/logout");
  } catch {
    // Already gone, or no connection: the token is dropped either way.
  }
  await setToken(null);
}

/** An address for a file on the server, for <Image> and downloads (it needs the token). */
export function fileUrl(path: string): { uri: string; headers: Record<string, string> } {
  return { uri: server + path, headers: token ? { authorization: `Bearer ${token}` } : {} };
}
