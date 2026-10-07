// AI: the providers (any key: Claude, OpenAI, Gemini, OpenRouter, your own
// server...) and, per company, the profile its replies follow.
import { useEffect, useState } from "react";
import { del, get, patch, post, put } from "../../api";
import { onNav } from "../../router";
import { useApp } from "../../store";
import type { Preset, Profile, Provider } from "../../types";
import { cls } from "../../util";
import { Check, Key, Plus, Sparkle, Trash } from "../../icons";
import { Button, Card, Empty, Field, Input, Modal, Pill, Segmented, Spinner, Textarea } from "../../ui";
import { PageHead } from "./Settings";
import type { FullCompany } from "./Company";

export function Providers() {
  const { toast } = useApp();
  const [list, setList] = useState<Provider[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [editing, setEditing] = useState<Provider | "new" | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, { ok: boolean; text: string }>>({});
  const load = () => get<Provider[]>("/api/ai/providers").then(setList).catch(() => setList([]));
  useEffect(() => { load(); get<Preset[]>("/api/ai/presets").then(setPresets).catch(() => {}); }, []);

  async function test(p: Provider) {
    setTesting(p.id);
    try {
      const r = await post<{ says: string }>(`/api/ai/providers/${p.id}/test`);
      setResults((x) => ({ ...x, [p.id]: { ok: true, text: r.says } }));
    } catch (e) {
      setResults((x) => ({ ...x, [p.id]: { ok: false, text: (e as Error).message } }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <PageHead title="AI providers" sub="The AI that writes replies. Bring any key; switch whenever you like. Keys are stored encrypted on your server."
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")}>Add a provider</Button>} />
      {!list ? <div className="center-pad"><Spinner /></div> : list.length === 0 ? (
        <Card><Empty icon={<Key size={22} />} title="No AI yet" action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")}>Add a key</Button>}>
          Add a key from Anthropic, OpenAI, Google, OpenRouter or any OpenAI-compatible server. Until then, mail works as normal and AI replies wait.
        </Empty></Card>
      ) : (
        <div className="providers">
          {list.map((p, i) => (
            <div key={p.id} className="provider">
              <span className="provider-logo">{p.name.slice(0, 1).toUpperCase()}</span>
              <div className="provider-main">
                <div className="provider-name">{p.name}{i === 0 && <Pill tone="accent">Default</Pill>}</div>
                <div className="provider-meta"><span className="mono">{p.model}</span>{p.keyHint && <span>key {p.keyHint}</span>}{p.kind === "openai" && <span>{p.baseUrl}</span>}</div>
                {results[p.id] && <div className={cls("provider-test", results[p.id].ok ? "is-ok" : "is-bad")}>{results[p.id].ok ? <Check size={14} /> : null}{results[p.id].text}</div>}
              </div>
              <div className="provider-actions">
                <Button size="sm" busy={testing === p.id} onClick={() => test(p)}>Test</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
                <button className="icon-btn" aria-label={`Delete ${p.name}`} onClick={async () => {
                  if (!confirm(`Delete ${p.name}? Companies using it switch to the default provider.`)) return;
                  await del(`/api/ai/providers/${p.id}`);
                  load();
                }}><Trash size={16} /></button>
              </div>
            </div>
          ))}
          <p className="form-note">The first provider is the default. Each company can pick its own under its AI replies settings.</p>
        </div>
      )}
      {editing && (
        <ProviderForm presets={presets} provider={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSaved={(p) => { setEditing(null); load(); toast({ text: `${p.name} saved. Testing it…` }); test(p); }} />
      )}
    </>
  );
}

function ProviderForm({ presets, provider, onClose, onSaved }: { presets: Preset[]; provider: Provider | null; onClose: () => void; onSaved: (p: Provider) => void }) {
  const initialPreset = provider ? (presets.find((p) => p.kind === provider.kind && p.baseUrl === provider.baseUrl)?.id ?? "custom") : "anthropic";
  const [preset, setPreset] = useState(initialPreset);
  const pre = presets.find((p) => p.id === preset);
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? pre?.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(provider?.model ?? pre?.model ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kind = pre?.kind ?? provider?.kind ?? "openai";

  function choose(id: string) {
    const p = presets.find((x) => x.id === id);
    setPreset(id);
    setBaseUrl(p?.baseUrl ?? "");
    setModel(p?.model ?? "");
    setModels([]);
    if (!provider) setName(id === "custom" ? "" : p?.name.replace(/ \(.*\)$/, "") ?? "");
  }

  async function loadModels() {
    setLoadingModels(true);
    setError("");
    try {
      const r = await post<{ models: string[] }>("/api/ai/models", { id: provider?.id, kind, baseUrl, key: key || undefined });
      setModels(r.models);
      if (!model && r.models[0]) setModel(r.models[0]);
      if (!r.models.length) setError("That server listed no models. Type the model's name.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body = { name: name || pre?.name, kind, baseUrl, model, ...(key ? { key } : {}) };
      const p = provider ? await patch<Provider>(`/api/ai/providers/${provider.id}`, body) : await post<Provider>("/api/ai/providers", body);
      onSaved(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={provider ? `Edit ${provider.name}` : "Add an AI provider"} width={640}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save} disabled={!model || (!provider && !key && !pre?.keyless)}>Save and test</Button></>}>
      <div className="form">
        {!provider && (
          <div className="preset-grid" role="radiogroup" aria-label="Provider">
            {presets.map((p) => (
              <button type="button" key={p.id} role="radio" aria-checked={p.id === preset} className={cls("preset", p.id === preset && "is-on")} onClick={() => choose(p.id)}>
                <b>{p.name}</b>
              </button>
            ))}
          </div>
        )}
        {pre && <p className="field-hint">{pre.hint}</p>}
        {(kind === "openai") && (
          <Field label="Server address" hint="Its OpenAI-compatible base URL, ending in /v1 for most.">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} />
          </Field>
        )}
        <Field label="API key" hint={provider?.keyHint ? `Saved key ${provider.keyHint}. Leave empty to keep it.` : pre?.keyless ? "Not needed for this one." : "Stored encrypted. Never shown again."}>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider?.keyHint ? "••••••••" : "Paste the key"} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Model">
          <div className="model-pick">
            <Input value={model} onChange={(e) => setModel(e.target.value)} list="model-list" placeholder="Model name" spellCheck={false} />
            <datalist id="model-list">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <Button type="button" busy={loadingModels} onClick={loadModels} disabled={!key && !provider && !pre?.keyless}>Load models</Button>
          </div>
        </Field>
        {models.length > 0 && <p className="field-hint">{models.length} models available. Start typing to pick one.</p>}
        <Field label="Name" hint="How it is shown here."><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={pre?.name} /></Field>
        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  );
}

export function AiProfile({ c }: { c: FullCompany }) {
  const { toast } = useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [providerId, setProviderId] = useState<number | null>(null);
  const [savedProvider, setSavedProvider] = useState<number | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ profile: Profile; providerId: number | null }>(`/api/companies/${encodeURIComponent(c.id)}/ai`).then((r) => {
      setProfile(r.profile); setSaved(JSON.stringify(r.profile)); setProviderId(r.providerId); setSavedProvider(r.providerId);
    });
    get<Provider[]>("/api/ai/providers").then(setProviders).catch(() => {});
  }, [c.id]);
  if (!profile) return <div className="center-pad"><Spinner /></div>;
  const set = (p: Partial<Profile>) => setProfile((x) => ({ ...x!, ...p }));
  const dirty = JSON.stringify(profile) !== saved || providerId !== savedProvider;
  const on = c.addresses.filter((a) => a.aiMode !== "off");

  async function save() {
    setBusy(true);
    try {
      const r = await put<{ profile: Profile; providerId: number | null }>(`/api/companies/${encodeURIComponent(c.id)}/ai`, { profile, providerId });
      setProfile(r.profile); setSaved(JSON.stringify(r.profile)); setSavedProvider(r.providerId);
      toast({ text: "Saved. New replies follow it from now on.", tone: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="AI replies" sub={<>What the AI knows about {c.name} and how it sounds. Write it the way you would brief a new colleague.</>} />
      <div className="ai-status">
        <Sparkle size={16} />
        {on.length ? <span>On for {on.map((a) => <b key={a.id}>{a.local}@ ({a.aiMode === "send" ? "sends" : "drafts"})</b>).reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, ", ", x] : [x]), [])}.</span>
          : <span>Off for every address. Turn it on per address under <a href={`/settings/company/${c.id}/addresses`} onClick={onNav({ page: "settings", section: "company", cid: c.id, tab: "addresses" })}>Addresses</a>.</span>}
      </div>
      <Card>
        <div className="form">
          <Field label="AI provider" hint={providers.length ? undefined : <>No provider yet. <a href="/settings/ai" onClick={onNav("/settings/ai")}>Add one</a>.</>}>
            <select className="input select" value={providerId ?? ""} onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Default{providers[0] ? ` (${providers[0].name}, ${providers[0].model})` : ""}</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
            </select>
          </Field>
          <Field label="About the company" hint="What it does, for whom, where. A few sentences.">
            <Textarea rows={3} value={profile.about} onChange={(e) => set({ about: e.target.value })} placeholder={`${c.name} makes … for … . We are based in … .`} />
          </Field>
          <Field label="Voice" hint="How replies sound.">
            <Textarea rows={2} value={profile.voice} onChange={(e) => set({ voice: e.target.value })} />
          </Field>
          <Field label="What it may use" hint="Facts, prices, opening hours, links, answers to common questions. The AI only states what is here or in the thread.">
            <Textarea rows={8} value={profile.knowledge} onChange={(e) => set({ knowledge: e.target.value })} placeholder={"Plans: Free, Pro ($8/month).\nRefunds: within 14 days, through support@.\nDocs: https://…"} />
          </Field>
          <Field label="Rules it must keep" hint="What it must never say or do, and what always goes to a person.">
            <Textarea rows={3} value={profile.policies} onChange={(e) => set({ policies: e.target.value })} />
          </Field>
          <Field label="Sign-off" hint={`Ends every AI reply. Empty uses the company signature.`}>
            <Textarea rows={2} value={profile.signature} onChange={(e) => set({ signature: e.target.value })} placeholder={`The ${c.name} team`} />
          </Field>
          <div className="form-row form-row-3">
            <Field label="Reply in">
              <Segmented value={profile.replyLanguage} onChange={(v) => set({ replyLanguage: v })} options={[{ value: "sender", label: "Their language" }, { value: "english", label: "English" }]} />
            </Field>
            <Field label="Wait before sending" hint="minutes, so you can stop it">
              <Input type="number" min={0} max={60} value={profile.sendDelayMinutes} onChange={(e) => set({ sendDelayMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Auto-replies per sender" hint="a day; past that, drafts">
              <Input type="number" min={1} max={20} value={profile.maxAutoPerSenderPerDay} onChange={(e) => set({ maxAutoPerSenderPerDay: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      </Card>
      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <Button variant="primary" busy={busy} onClick={save}>Save</Button>
        </div>
      )}
    </>
  );
}
