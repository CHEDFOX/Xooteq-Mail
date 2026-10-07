// Stalwart tells the dashboard about every delivered message (engine.py
// configure, step 4). The body is signed; anything unsigned is refused.
import type { FastifyInstance } from "fastify";
import { verifyWebhook } from "../crypto.ts";
import { fromWebhook } from "../ai/engine.ts";

export async function hookRoutes(app: FastifyInstance) {
  app.post("/hooks/stalwart", async (req, reply) => {
    if (!req.rawBody || !verifyWebhook(req.rawBody, req.headers["x-signature"] as string | undefined)) {
      return reply.code(401).send({ error: "bad signature" });
    }
    const queued = fromWebhook(req.body);
    return { ok: true, queued };
  });
}
