// Stalwart tells the dashboard about every delivered message (engine.py
// configure, step 4). The body is signed; anything unsigned is refused.
import type { FastifyInstance } from "fastify";
import { verifyWebhook } from "../crypto.ts";
import { fromWebhook } from "../ai/engine.ts";
import { notifyNewMail } from "../push.ts";

export async function hookRoutes(app: FastifyInstance) {
  app.post("/hooks/stalwart", async (req, reply) => {
    if (!req.rawBody || !verifyWebhook(req.rawBody, req.headers["x-signature"] as string | undefined)) {
      return reply.code(401).send({ error: "bad signature" });
    }
    const queued = fromWebhook(req.body);
    // The phones hear about it too. Expo is not on Stalwart's critical path, so
    // this is left running and only its failures are written down.
    void notifyNewMail(req.body).catch((e) => req.log.warn(`push: ${(e as Error).message}`));
    return { ok: true, queued };
  });
}
