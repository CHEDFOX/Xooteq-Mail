// Starts Xooteq Mail.
import { assertReady, config } from "./config.ts";
import { buildApp } from "./app.ts";

const missing = assertReady();
if (missing.length) console.warn(`[xooteq-mail] not configured yet: ${missing.join(", ")}`);

const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: config.port });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
