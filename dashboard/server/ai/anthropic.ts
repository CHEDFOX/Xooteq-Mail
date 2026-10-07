// Claude, through Anthropic's SDK. One request per reply: a system prompt with
// the company's profile, the thread as the user turn, and a JSON schema the
// answer must follow (structured outputs), so the reply and the decision come
// back as data, never parsed out of prose.
import Anthropic from "@anthropic-ai/sdk";
import { AiError, parseJsonAnswer, type CompleteRequest, type CompleteResult, type Provider } from "./providers.ts";

function client(p: Provider): Anthropic {
  if (!p.key) throw new AiError("This provider has no API key yet.");
  return new Anthropic({
    apiKey: p.key,
    ...(p.baseUrl && !/^https:\/\/api\.anthropic\.com\/?$/.test(p.baseUrl) ? { baseURL: p.baseUrl } : {}),
    maxRetries: 2,
    timeout: 120_000,
  });
}

// Models whose safety classifiers can decline a request, and which accept
// server-side fallback: a declined reply is retried on the model Anthropic
// recommends for that kind of decline, inside the same call.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
// The effort setting exists on Opus 4.6 and later, Sonnet 5 and later, and Fable.
const takesEffort = (m: string) => /^claude-(fable|mythos)-/.test(m) || /^claude-opus-(5|4-[6-9])/.test(m) || /^claude-sonnet-5/.test(m);

function friendly(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new AiError("Anthropic refused the key. Check it in Settings, AI.", 401);
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError("The key is valid but may not use this model.", 403);
  if (e instanceof Anthropic.NotFoundError) return new AiError("Anthropic does not know this model name.", 404);
  if (e instanceof Anthropic.RateLimitError) return new AiError("Anthropic's rate limit was reached. It will try again on the next message.", 429);
  if (e instanceof Anthropic.BadRequestError) return new AiError(`Anthropic refused the request: ${e.message}`, 400);
  if (e instanceof Anthropic.APIConnectionError) return new AiError("Could not reach Anthropic.", 503);
  if (e instanceof Anthropic.APIError) return new AiError(`Anthropic error ${e.status ?? ""}: ${e.message}`, e.status);
  return new AiError((e as Error).message || "The AI request failed.");
}

export async function anthropicComplete(p: Provider, req: CompleteRequest): Promise<CompleteResult> {
  const c = client(p);
  const base = {
    model: p.model,
    // Room for the model's thinking as well as the reply; replies themselves are short.
    max_tokens: 16000,
    system: req.system,
    messages: [{ role: "user" as const, content: req.user }],
    output_config: {
      ...(takesEffort(p.model) ? { effort: "medium" as const } : {}),
      format: { type: "json_schema" as const, schema: req.schema },
    },
  };
  try {
    const msg = FALLBACK_MODELS.has(p.model)
      ? await c.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : await c.messages.create(base);
    if (msg.stop_reason === "refusal") {
      throw new AiError("The model declined to write this reply; it is left for you.");
    }
    if (msg.stop_reason === "max_tokens") throw new AiError("The reply ran past the length limit.");
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { data: parseJsonAnswer(text), model: msg.model, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
  } catch (e) {
    throw friendly(e);
  }
}

export async function anthropicModels(p: Provider): Promise<string[]> {
  const c = client(p);
  try {
    const ids: string[] = [];
    for await (const m of c.models.list()) ids.push(m.id);
    return ids;
  } catch (e) {
    throw friendly(e);
  }
}
