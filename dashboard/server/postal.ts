// Postal, the platform's sending side (apps, SMTP and API keys, sending domains,
// the message log), reached through postal-bridge: a small service in Postal's
// own image on the private Docker network (../postal-bridge/bridge.rb).
import { config } from "./config.ts";

export class PostalError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function bridge(method: string, path: string, body?: unknown): Promise<unknown> {
  if (!config.postalBridgeSecret) throw new PostalError("Sending is not connected yet: run workspace-setup.sh on the server to start postal-bridge.", 503);
  let res: Response;
  try {
    res = await fetch(config.postalBridgeUrl + path, {
      method,
      headers: { "x-bridge-key": config.postalBridgeSecret, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    throw new PostalError(`Postal is not answering (${(e as Error).message}).`, 503);
  }
  const data = await res.json().catch(() => null) as { error?: string } | null;
  if (!res.ok) throw new PostalError(data?.error || `Postal said ${res.status}.`, res.status);
  return data;
}
