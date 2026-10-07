// Every other provider: the OpenAI-compatible chat completions API (OpenAI,
// OpenRouter, Google Gemini, Groq, Mistral, DeepSeek, xAI, Together, Ollama and
// most self-hosted servers). The answer is asked for as a JSON object; servers
// that do not support that switch get the same request without it, and the JSON
// is read out of the text.
import { AiError, parseJsonAnswer, type CompleteRequest, type CompleteResult, type Provider } from "./providers.ts";

type ChatResponse = {
  model?: string;
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

function headers(p: Provider): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(p.key ? { authorization: `Bearer ${p.key}` } : {}),
    // OpenRouter shows these on its usage page; others ignore them.
    "http-referer": "https://xooteq.online",
    "x-title": "Xooteq Mail",
  };
}

async function post(p: Provider, body: Record<string, unknown>): Promise<{ status: number; json: ChatResponse }> {
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST", headers: headers(p), body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new AiError(`Could not reach ${new URL(p.baseUrl).host} (${(e as Error).message}).`, 503);
  }
  const json = await res.json().catch(() => ({})) as ChatResponse;
  return { status: res.status, json };
}

function failure(p: Provider, status: number, json: ChatResponse): AiError {
  const host = new URL(p.baseUrl).host;
  const said = json.error?.message ? `: ${json.error.message}` : "";
  if (status === 401 || status === 403) return new AiError(`${host} refused the key${said}`, status);
  if (status === 404) return new AiError(`${host} does not know the model "${p.model}"${said}`, status);
  if (status === 429) return new AiError(`${host}'s rate limit was reached${said}`, status);
  return new AiError(`${host} answered ${status}${said}`, status);
}

export async function openaiComplete(p: Provider, req: CompleteRequest): Promise<CompleteResult> {
  const messages = [
    { role: "system", content: `${req.system}\n\nAnswer with one JSON object only, following this JSON Schema:\n${JSON.stringify(req.schema)}` },
    { role: "user", content: req.user },
  ];
  let { status, json } = await post(p, { model: p.model, messages, response_format: { type: "json_object" } });
  // Some servers reject response_format (or json_object for this model): ask again without it.
  if (status === 400 && /response_format|json_object|json mode/i.test(json.error?.message ?? "")) {
    ({ status, json } = await post(p, { model: p.model, messages }));
  }
  if (status < 200 || status >= 300) throw failure(p, status, json);
  const choice = json.choices?.[0];
  if (choice?.message?.refusal) throw new AiError("The model declined to write this reply; it is left for you.");
  const text = choice?.message?.content ?? "";
  if (!text) throw new AiError("The model sent back an empty answer.");
  return { data: parseJsonAnswer(text), model: json.model ?? p.model, inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens };
}

export async function openaiModels(p: Provider): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/models`, { headers: headers(p), signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new AiError(`Could not reach ${new URL(p.baseUrl).host} (${(e as Error).message}).`, 503);
  }
  const json = await res.json().catch(() => ({})) as { data?: { id: string }[]; models?: { name?: string; id?: string }[]; error?: { message?: string } };
  if (!res.ok) throw failure(p, res.status, json as ChatResponse);
  const ids = (json.data ?? []).map((m) => m.id).concat((json.models ?? []).map((m) => m.id ?? m.name ?? "")).filter(Boolean);
  return [...new Set(ids)].sort();
}
