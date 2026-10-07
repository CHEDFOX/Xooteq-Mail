// AI providers (any key), each company's profile, and the log of what the AI did.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireOwner } from "../auth.ts";
import { getCompany } from "../companies.ts";
import { AiError, deleteProvider, getProvider, listModels, listProviders, PRESETS, saveProvider, testProvider } from "../ai/providers.ts";
import { getProfile, saveProfile } from "../ai/prompt.ts";
import { listRuns } from "../ai/engine.ts";

const pid = (req: FastifyRequest) => Number((req.params as { id: string }).id);

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireOwner);

  app.get("/api/ai/presets", async () => PRESETS);
  app.get("/api/ai/providers", async () => listProviders());
  app.post("/api/ai/providers", async (req) => saveProvider((req.body ?? {}) as Record<string, unknown>));
  app.patch("/api/ai/providers/:id", async (req) => saveProvider((req.body ?? {}) as Record<string, unknown>, pid(req)));
  app.delete("/api/ai/providers/:id", async (req) => {
    deleteProvider(pid(req));
    return { ok: true };
  });
  app.post("/api/ai/providers/:id/test", async (req) => {
    const p = getProvider(pid(req));
    if (!p) throw new AiError("No such provider.");
    return { ok: true, says: await testProvider(p) };
  });
  // Lists models for settings that may not be saved yet (key typed, not stored).
  app.post("/api/ai/models", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = body.id ? Number(body.id) : undefined;
    return { models: await listModels(body, id) };
  });

  app.get("/api/companies/:cid/ai", async (req) => {
    const c = getCompany((req.params as { cid: string }).cid);
    return getProfile(c.id);
  });
  app.put("/api/companies/:cid/ai", async (req) => {
    const c = getCompany((req.params as { cid: string }).cid);
    const body = (req.body ?? {}) as { profile?: Record<string, unknown>; providerId?: number | null };
    const providerId = body.providerId ? Number(body.providerId) : null;
    if (providerId && !getProvider(providerId)) throw new AiError("No such provider.");
    return { profile: saveProfile(c.id, body.profile ?? {}, providerId), providerId };
  });

  app.get("/api/ai/runs", async (req) => {
    const { company, limit } = req.query as { company?: string; limit?: string };
    return listRuns(company || undefined, Math.min(500, Number(limit) || 100));
  });
}
