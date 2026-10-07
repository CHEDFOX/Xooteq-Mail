// Sending: Postal's apps, their domains, keys, message log and suppression lists.
// The dashboard's own paths, passed to postal-bridge ("apps" are Postal's servers).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireOwner } from "../auth.ts";
import { bridge } from "../postal.ts";

const ALLOWED: [string, RegExp][] = [
  ["GET", /^\/overview$/],
  ["POST", /^\/servers$/],
  ["GET", /^\/servers\/[a-z0-9-]+$/],
  ["PATCH", /^\/servers\/[a-z0-9-]+$/],
  ["DELETE", /^\/servers\/[a-z0-9-]+$/],
  ["POST", /^\/servers\/[a-z0-9-]+\/domains$/],
  ["POST", /^\/servers\/[a-z0-9-]+\/domains\/[a-f0-9-]+\/check$/],
  ["DELETE", /^\/servers\/[a-z0-9-]+\/domains\/[a-f0-9-]+$/],
  ["POST", /^\/servers\/[a-z0-9-]+\/credentials$/],
  ["PATCH", /^\/servers\/[a-z0-9-]+\/credentials\/\d+$/],
  ["DELETE", /^\/servers\/[a-z0-9-]+\/credentials\/\d+$/],
  ["GET", /^\/servers\/[a-z0-9-]+\/messages$/],
  ["GET", /^\/servers\/[a-z0-9-]+\/messages\/\d+$/],
  ["POST", /^\/servers\/[a-z0-9-]+\/messages\/\d+\/(retry|cancel-hold)$/],
  ["GET", /^\/servers\/[a-z0-9-]+\/suppressions$/],
  ["DELETE", /^\/servers\/[a-z0-9-]+\/suppressions$/],
  ["POST", /^\/servers\/[a-z0-9-]+\/test$/],
];

export async function sendingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireOwner);
  const pass = async (req: FastifyRequest) => {
    const url = new URL(req.url, "http://x");
    const rest = url.pathname.replace(/^\/api\/sending/, "") || "/overview";
    const path = rest.replace(/^\/apps(?=\/|$)/, "/servers");
    if (!ALLOWED.some(([m, re]) => m === req.method && re.test(path))) {
      const e = new Error("Not found.") as Error & { statusCode: number };
      e.statusCode = 404;
      throw e;
    }
    return bridge(req.method, path + url.search, ["GET", "DELETE"].includes(req.method) ? undefined : req.body ?? {});
  };
  for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
    app.route({ method, url: "/api/sending", handler: pass });
    app.route({ method, url: "/api/sending/*", handler: pass });
  }
}
