// The dashboard's own API: JSON in, JSON out, and the header that marks every
// state-changing call as coming from this app (see the server's CSRF check).
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let onSignedOut: (() => void) | null = null;
export function whenSignedOut(fn: () => void) {
  onSignedOut = fn;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-xooteq", "1");
  let payload: BodyInit | undefined;
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    payload = body as BodyInit;
  } else if (body !== undefined) {
    headers.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { ...init, method, headers, body: payload, credentials: "same-origin" });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) onSignedOut?.();
    throw new ApiError((data && typeof data === "object" && "error" in data ? String(data.error) : "") || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export const get = <T,>(p: string) => api<T>("GET", p);
export const post = <T,>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const patch = <T,>(p: string, b: unknown) => api<T>("PATCH", p, b);
export const put = <T,>(p: string, b: unknown) => api<T>("PUT", p, b);
export const del = <T,>(p: string) => api<T>("DELETE", p);
