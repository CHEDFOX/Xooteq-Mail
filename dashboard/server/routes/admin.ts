// Companies, their addresses, rules, DNS and mail-app access.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireOwner } from "../auth.ts";
import { hosts } from "../config.ts";
import {
  addAddress, createCompany, forgetCompany, getCompany, InputError, listCompanies, listRules, removeAddress,
  saveRules, setMailAppPassword, syncAddresses, unclaimedMailboxes, updateAddress, updateCompany,
} from "../companies.ts";
import { domains } from "../stalwart.ts";
import { check, expected } from "../dns.ts";

const cid = (req: FastifyRequest) => (req.params as { cid: string }).cid;

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireOwner);

  app.get("/api/companies", async () => listCompanies());
  app.post("/api/companies", async (req) => createCompany((req.body ?? {}) as Parameters<typeof createCompany>[0]));
  app.get("/api/companies/:cid", async (req) => ({ ...getCompany(cid(req)), rules: listRules(cid(req)) }));
  app.patch("/api/companies/:cid", async (req) => updateCompany(cid(req), (req.body ?? {}) as Record<string, unknown>));
  app.delete("/api/companies/:cid", async (req) => {
    getCompany(cid(req));
    forgetCompany(cid(req));
    return { ok: true };
  });
  app.post("/api/companies/:cid/sync", async (req) => syncAddresses(cid(req)));

  app.post("/api/companies/:cid/addresses", async (req) => addAddress(cid(req), (req.body ?? {}) as Parameters<typeof addAddress>[1]));
  app.patch("/api/companies/:cid/addresses/:aid", async (req) =>
    updateAddress(cid(req), Number((req.params as { aid: string }).aid), (req.body ?? {}) as Record<string, unknown>));
  app.delete("/api/companies/:cid/addresses/:aid", async (req) => removeAddress(cid(req), Number((req.params as { aid: string }).aid)));

  app.get("/api/companies/:cid/rules", async (req) => listRules(cid(req)));
  app.put("/api/companies/:cid/rules", async (req) => saveRules(cid(req), (req.body as { rules?: unknown })?.rules));

  app.get("/api/companies/:cid/dns", async (req) => {
    const c = getCompany(cid(req));
    const d = (await domains.list()).find((x) => x.name === c.domain);
    if (!d) throw new InputError(`${c.domain} is not on the mail server.`);
    const zone = (await domains.get(d.id))?.dnsZoneFile ?? "";
    return { domain: c.domain, records: await check(expected(c.domain, zone)) };
  });

  app.get("/api/companies/:cid/mail-app", async (req) => {
    const c = getCompany(cid(req));
    return {
      username: c.email,
      incoming: { protocol: "IMAP", host: hosts.imap, port: 993, security: "SSL/TLS" },
      outgoing: { protocol: "SMTP", host: hosts.smtp, port: 465, security: "SSL/TLS" },
    };
  });
  app.post("/api/companies/:cid/mail-app", async (req) => {
    await setMailAppPassword(cid(req), (req.body as { password?: unknown })?.password);
    return { ok: true };
  });

  app.get("/api/mailboxes/unclaimed", async () => unclaimedMailboxes());
}
