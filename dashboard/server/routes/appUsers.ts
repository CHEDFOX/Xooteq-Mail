// The Users tab: connect a database, map its users table, read the list. It is
// on each Sending app (under its Sending path; Fastify prefers these routes to
// sending.ts's wildcard) and on each company. A company's connection is kept
// under "company:<id>", so a company and an app with the same id never share one.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireOwner } from "../auth.ts";
import { getCompany } from "../companies.ts";
import { connect, disconnect, inspect, listUsers, savedUrl, sourceOf, type Sort, UsersError } from "../appUsers.ts";

/** A Postal app's permalink or a company's id: the same lowercase slug. */
const slug = (id: string | undefined): string => {
  if (!id || !/^[a-z0-9-]{1,80}$/.test(id)) throw new UsersError("Not found.", 404);
  return id;
};

const OWNERS: { at: string; key: (req: FastifyRequest) => string }[] = [
  { at: "/api/sending/apps/:app/users", key: (req) => slug((req.params as { app?: string }).app) },
  {
    at: "/api/companies/:cid/users",
    key: (req) => {
      const id = slug((req.params as { cid?: string }).cid);
      getCompany(id);
      return `company:${id}`;
    },
  },
];

export async function appUserRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireOwner);
  for (const { at, key } of OWNERS) {
    app.get(`${at}/source`, async (req) => sourceOf(key(req)));

    // What a connection string can read. Without one, the saved connection's.
    app.post(`${at}/inspect`, async (req) => {
      const id = key(req);
      const body = (req.body ?? {}) as { url?: unknown };
      return inspect(typeof body.url === "string" && body.url.trim() ? body.url : savedUrl(id));
    });

    app.put(`${at}/source`, async (req) => {
      const b = (req.body ?? {}) as { url?: unknown; kind?: string; mapping?: unknown };
      return connect(key(req), { url: typeof b.url === "string" ? b.url : undefined, kind: b.kind, mapping: b.mapping });
    });

    app.delete(`${at}/source`, async (req) => {
      disconnect(key(req));
      return { ok: true };
    });

    app.get(at, async (req) => {
      const q = req.query as { q?: string; sort?: string; page?: string };
      const sort: Sort = q.sort === "used" || q.sort === "name" ? q.sort : "created";
      return listUsers(key(req), { q: q.q, sort, page: Number(q.page) || 1 });
    });
  }
}
