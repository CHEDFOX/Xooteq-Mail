// An app's Users tab: connect its database, map its users table, read the list.
// These are the dashboard's own routes (not postal-bridge's), under the app's
// Sending path; Fastify prefers them to sending.ts's wildcard.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireOwner } from "../auth.ts";
import { connect, disconnect, inspect, listUsers, savedUrl, sourceOf, type Sort, UsersError } from "../appUsers.ts";

type P = { Params: { app: string } };

/** A Postal app's permalink, the same pattern sending.ts allows. */
function appOf(req: FastifyRequest<P>): string {
  const id = req.params.app;
  if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new UsersError("Not found.", 404);
  return id;
}

export async function appUserRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireOwner);
  const at = "/api/sending/apps/:app/users";

  app.get<P>(`${at}/source`, async (req) => sourceOf(appOf(req)));

  // What a connection string can read. Without one, the saved connection's.
  app.post<P & { Body: { url?: string } }>(`${at}/inspect`, async (req) => {
    const id = appOf(req);
    const url = typeof req.body?.url === "string" && req.body.url.trim() ? req.body.url : savedUrl(id);
    return inspect(url);
  });

  app.put<P & { Body: { url?: string; kind?: string; mapping?: unknown } }>(`${at}/source`, async (req) => {
    const b = req.body ?? {};
    return connect(appOf(req), { url: typeof b.url === "string" ? b.url : undefined, kind: b.kind, mapping: b.mapping });
  });

  app.delete<P>(`${at}/source`, async (req) => {
    disconnect(appOf(req));
    return { ok: true };
  });

  app.get<P & { Querystring: { q?: string; sort?: string; page?: string } }>(at, async (req) => {
    const sort: Sort = req.query.sort === "used" || req.query.sort === "name" ? req.query.sort : "created";
    return listUsers(appOf(req), { q: req.query.q, sort, page: Number(req.query.page) || 1 });
  });
}
