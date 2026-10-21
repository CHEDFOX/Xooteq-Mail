// A company's contact forms: the plug a site's form posts to, one per form
// (forms.ts). All of them hang off the company, because a form is just one of
// its addresses with an endpoint in front of it.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireOwner } from "../auth.ts";
import { config } from "../config.ts";
import { getCompany } from "../companies.ts";
import {
  createForm, deleteForm, formsReady, getForm, listForms, recentSubmissions, sendingChoices, testForm, updateForm,
  type FormInput,
} from "../forms.ts";

const cid = (req: FastifyRequest) => (req.params as { cid: string }).cid;
const fid = (req: FastifyRequest) => Number((req.params as { fid: string }).fid);
const body = (req: FastifyRequest) => (req.body ?? {}) as FormInput;

export async function formRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireOwner);

  app.get("/api/companies/:cid/forms", async (req) => {
    const c = getCompany(cid(req));
    return { ready: formsReady(), endpointBase: config.formsPublicUrl, domain: c.domain, forms: listForms(c.id) };
  });

  /** Which of Postal's apps can send this company's forms, and its DNS there. */
  app.get("/api/companies/:cid/forms/sending", async (req) => sendingChoices(cid(req)));

  app.post("/api/companies/:cid/forms", async (req) => createForm(cid(req), body(req)));
  app.get("/api/companies/:cid/forms/:fid", async (req) => getForm(cid(req), fid(req)));
  app.patch("/api/companies/:cid/forms/:fid", async (req) => updateForm(cid(req), fid(req), body(req)));
  app.delete("/api/companies/:cid/forms/:fid", async (req) => {
    deleteForm(cid(req), fid(req));
    return { ok: true };
  });

  app.get("/api/companies/:cid/forms/:fid/submissions", async (req) => {
    const n = Number((req.query as { n?: string }).n) || 50;
    return { submissions: await recentSubmissions(cid(req), fid(req), n) };
  });

  /** Sends one message through the form, as a visitor's browser would. */
  app.post("/api/companies/:cid/forms/:fid/test", async (req) => testForm(cid(req), fid(req), req.owner!.email));
}
