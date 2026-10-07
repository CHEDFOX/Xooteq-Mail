// Any AI provider, behind one call. Two wire protocols cover nearly all of them:
//
//   anthropic   Claude, through Anthropic's own SDK (ai/anthropic.ts).
//   openai      the OpenAI-compatible chat completions API that OpenAI, OpenRouter,
//               Google Gemini, Groq, Mistral, DeepSeek, xAI, Together, Ollama and
//               most self-hosted servers speak (ai/openai.ts).
//
// A provider is a row in ai_providers: kind, base URL, model, and the key
// (encrypted at rest, see crypto.ts). Presets only fill in the base URL.
import { db, now } from "../db.ts";
import { keyHint, open, seal } from "../crypto.ts";
import { anthropicComplete, anthropicModels } from "./anthropic.ts";
import { openaiComplete, openaiModels } from "./openai.ts";

export type ProviderKind = "anthropic" | "openai";
export type Provider = { id: number; name: string; kind: ProviderKind; baseUrl: string; model: string; key: string };
export type ProviderView = Omit<Provider, "key"> & { keyHint: string };

export type CompleteRequest = {
  system: string;
  user: string;
  /** JSON Schema the answer must follow (an object). */
  schema: Record<string, unknown>;
};
export type CompleteResult = { data: unknown; model: string; inputTokens?: number; outputTokens?: number };

/** A failure worth showing as it is: the key was refused, the model is unknown... */
export class AiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export const PRESETS: { id: string; name: string; kind: ProviderKind; baseUrl: string; model?: string; keyless?: boolean; hint: string }[] = [
  { id: "anthropic", name: "Anthropic (Claude)", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", hint: "Key from console.anthropic.com" },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", hint: "Key from platform.openai.com" },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", hint: "One key for hundreds of models, from openrouter.ai" },
  { id: "gemini", name: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", hint: "Key from aistudio.google.com" },
  { id: "groq", name: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", hint: "Key from console.groq.com" },
  { id: "mistral", name: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", hint: "Key from console.mistral.ai" },
  { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", hint: "Key from platform.deepseek.com" },
  { id: "xai", name: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1", hint: "Key from console.x.ai" },
  { id: "together", name: "Together AI", kind: "openai", baseUrl: "https://api.together.xyz/v1", hint: "Key from api.together.ai" },
  { id: "ollama", name: "Ollama (your own server)", kind: "openai", baseUrl: "http://127.0.0.1:11434/v1", keyless: true, hint: "No key; the server's address" },
  { id: "custom", name: "Other (OpenAI-compatible)", kind: "openai", baseUrl: "", hint: "Any server that speaks the OpenAI chat API" },
];

type Row = { id: number; name: string; kind: ProviderKind; base_url: string | null; model: string; key_enc: string };

const fromRow = (r: Row): Provider => ({ id: r.id, name: r.name, kind: r.kind, baseUrl: r.base_url ?? "", model: r.model, key: r.key_enc ? open(r.key_enc) : "" });
const view = (p: Provider): ProviderView => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model, keyHint: p.key ? keyHint(p.key) : "" });

export function listProviders(): ProviderView[] {
  return (db.prepare("SELECT * FROM ai_providers ORDER BY id").all() as Row[]).map(fromRow).map(view);
}

export function getProvider(id: number): Provider | null {
  const r = db.prepare("SELECT * FROM ai_providers WHERE id = ?").get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function defaultProvider(): Provider | null {
  const r = db.prepare("SELECT * FROM ai_providers ORDER BY id LIMIT 1").get() as Row | undefined;
  return r ? fromRow(r) : null;
}

function cleanProvider(input: Record<string, unknown>, existing?: Provider): Omit<Provider, "id"> {
  const kind: ProviderKind = input.kind === "anthropic" ? "anthropic" : input.kind === "openai" ? "openai" : existing?.kind ?? "openai";
  const baseUrl = String(input.baseUrl ?? existing?.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (baseUrl && !/^https?:\/\/[^\s]+$/i.test(baseUrl)) throw new AiError("The address must start with https:// (or http:// for a server on your network).");
  if (kind === "openai" && !baseUrl) throw new AiError("Give the server's address (its OpenAI-compatible base URL).");
  const model = String(input.model ?? existing?.model ?? "").trim().slice(0, 200);
  if (!model) throw new AiError("Choose a model.");
  const key = input.key !== undefined && String(input.key).trim() !== "" ? String(input.key).trim() : existing?.key ?? "";
  const name = String(input.name ?? existing?.name ?? "").trim().slice(0, 60) || (kind === "anthropic" ? "Anthropic" : new URL(baseUrl).hostname);
  return { name, kind, baseUrl, model, key };
}

export function saveProvider(input: Record<string, unknown>, id?: number): ProviderView {
  const existing = id ? getProvider(id) : undefined;
  if (id && !existing) throw new AiError("No such provider.");
  const p = cleanProvider(input, existing ?? undefined);
  if (existing) {
    db.prepare("UPDATE ai_providers SET name = ?, kind = ?, base_url = ?, model = ?, key_enc = ? WHERE id = ?")
      .run(p.name, p.kind, p.baseUrl, p.model, p.key ? seal(p.key) : "", id!);
    return view({ ...p, id: id! });
  }
  const r = db.prepare("INSERT INTO ai_providers (name, kind, base_url, model, key_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(p.name, p.kind, p.baseUrl, p.model, p.key ? seal(p.key) : "", now());
  return view({ ...p, id: Number(r.lastInsertRowid) });
}

export function deleteProvider(id: number): void {
  db.prepare("DELETE FROM ai_providers WHERE id = ?").run(id);
}

export async function complete(p: Provider, req: CompleteRequest): Promise<CompleteResult> {
  return p.kind === "anthropic" ? anthropicComplete(p, req) : openaiComplete(p, req);
}

/** The models a key can use, for the picker. Unsaved settings work too. */
export async function listModels(input: Record<string, unknown>, id?: number): Promise<string[]> {
  const existing = id ? getProvider(id) ?? undefined : undefined;
  const p = { ...cleanProvider({ model: "-", ...input }, existing), id: id ?? 0 };
  return p.kind === "anthropic" ? anthropicModels(p) : openaiModels(p);
}

/** One small real request, so a wrong key or model shows up at once. */
export async function testProvider(p: Provider): Promise<string> {
  const r = await complete(p, {
    system: "You check that an email assistant is connected. Answer in the JSON shape asked for.",
    user: 'Reply with {"ok": true, "says": "<three words greeting the team>"}.',
    schema: { type: "object", properties: { ok: { type: "boolean" }, says: { type: "string" } }, required: ["ok", "says"], additionalProperties: false },
  });
  const d = r.data as { says?: string };
  return `${r.model}: ${d?.says ?? "connected"}`;
}

/** The JSON object in a model's text answer, with or without a code fence around it. */
export function parseJsonAnswer(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new AiError("The model did not answer in the expected format.");
  }
}
