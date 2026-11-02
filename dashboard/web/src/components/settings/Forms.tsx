// A company's contact forms: one plug per form, pointed at any of its
// addresses. Connecting one gives back the address to post to and the code to
// paste wherever the message is written — a site's form, a card in a phone app,
// a server — and from there it arrives like any other mail.
import { useCallback, useEffect, useState } from "react";
import { del, get, patch, post } from "../../api";
import { href, onNav } from "../../router";
import { useApp } from "../../store";
import type { ContactForm, FormSending, FormSubmission, FormsPage } from "../../types";
import { cls, relative } from "../../util";
import { Alert, At, Copy, FileText, Pencil, Plus, Refresh, Send, Trash } from "../../icons";
import { Button, Card, Empty, Field, Input, Modal, Pill, Segmented, Spinner, Textarea, Toggle } from "../../ui";
import { PageHead } from "./Settings";
import type { FullCompany } from "./Company";

const DEFAULT_SUBJECT = "New message from {name}";

/** Every field is sent along and becomes a line in the mail; these three are the
 *  ones a message card always has. Anything else (the screen it was written on,
 *  the app's version, who was signed in) is extra context in the same mail. */
const SNIPPETS: { id: string; label: string; code: (f: ContactForm) => string }[] = [
  {
    id: "html",
    label: "A form on a web page",
    code: (f) => [
      `<form action="${f.endpoint}" method="post">`,
      `  <input name="name" placeholder="Your name" required>`,
      `  <input name="email" type="email" placeholder="Your email" required>`,
      `  <textarea name="message" placeholder="How can we help?" required></textarea>`,
      `  <!-- a person never sees this; a bot fills it and is ignored -->`,
      `  <input type="checkbox" name="botcheck" style="display:none" tabindex="-1" autocomplete="off">`,
      ...(f.redirect ? [`  <input type="hidden" name="_redirect" value="${f.redirect}">`] : []),
      `  <button type="submit">Send</button>`,
      `</form>`,
    ].join("\n"),
  },
  {
    id: "js",
    label: "JavaScript, React or React Native",
    code: (f) => [
      `// The Send button of a message card.`,
      `async function send({ name, email, message }) {`,
      `  const res = await fetch("${f.endpoint}", {`,
      `    method: "POST",`,
      `    headers: { "content-type": "application/json" },`,
      `    body: JSON.stringify({`,
      `      name, email, message,`,
      `      screen: "Help",          // any extra field becomes a line in the mail`,
      `      app_version: "1.4.2",`,
      `    }),`,
      `  });`,
      `  const { ok, error } = await res.json();`,
      `  if (!ok) throw new Error(error);`,
      `  return true;                 // on its way to ${f.email}`,
      `}`,
    ].join("\n"),
  },
  {
    id: "swift",
    label: "Swift, iOS",
    code: (f) => [
      `struct Message: Encodable {`,
      `  let name: String, email: String, message: String`,
      `  let screen: String, app_version: String`,
      `}`,
      ``,
      `func send(_ m: Message) async throws -> Bool {`,
      `  var req = URLRequest(url: URL(string: "${f.endpoint}")!)`,
      `  req.httpMethod = "POST"`,
      `  req.setValue("application/json", forHTTPHeaderField: "Content-Type")`,
      `  req.httpBody = try JSONEncoder().encode(m)`,
      `  let (data, _) = try await URLSession.shared.data(for: req)`,
      `  let out = try JSONSerialization.jsonObject(with: data) as? [String: Any]`,
      `  return out?["ok"] as? Bool ?? false   // true: on its way to ${f.email}`,
      `}`,
    ].join("\n"),
  },
  {
    id: "kotlin",
    label: "Kotlin, Android",
    code: (f) => [
      `// OkHttp; runs off the main thread (a coroutine on Dispatchers.IO).`,
      `val payload = JSONObject(mapOf(`,
      `  "name" to name, "email" to email, "message" to message,`,
      `  "screen" to "Help", "app_version" to BuildConfig.VERSION_NAME,`,
      `)).toString().toRequestBody("application/json".toMediaType())`,
      ``,
      `val res = OkHttpClient().newCall(`,
      `  Request.Builder().url("${f.endpoint}").post(payload).build()`,
      `).execute()`,
      `val ok = JSONObject(res.body!!.string()).optBoolean("ok")   // on its way to ${f.email}`,
    ].join("\n"),
  },
  {
    id: "dart",
    label: "Dart, Flutter",
    code: (f) => [
      `import "dart:convert";`,
      `import "package:http/http.dart" as http;`,
      ``,
      `Future<bool> send(String name, String email, String message) async {`,
      `  final res = await http.post(`,
      `    Uri.parse("${f.endpoint}"),`,
      `    headers: {"content-type": "application/json"},`,
      `    body: jsonEncode({`,
      `      "name": name, "email": email, "message": message,`,
      `      "screen": "Help", "app_version": "1.4.2",`,
      `    }),`,
      `  );`,
      `  return jsonDecode(res.body)["ok"] == true;   // on its way to ${f.email}`,
      `}`,
    ].join("\n"),
  },
  {
    id: "curl",
    label: "A server, or curl",
    code: (f) => [
      `curl -s ${f.endpoint} \\`,
      `  -H 'content-type: application/json' \\`,
      `  -d '{"name":"Ada","email":"ada@example.com","message":"Is the blue one in stock?"}'`,
      `# {"ok":true,"id":"…"} — on its way to ${f.email}`,
    ].join("\n"),
  },
];

/** Who may post to a form, in a few words. */
function posters(f: ContactForm): string {
  if (!f.origins.length) return f.allowNoOrigin ? "any site or app may post" : "any site may post";
  return f.origins.join(", ") + (f.allowNoOrigin ? ", and apps" : "");
}

export function Forms({ c }: { c: FullCompany }) {
  const { toast } = useApp();
  const [page, setPage] = useState<FormsPage | null>(null);
  const [sending, setSending] = useState<FormSending | null>(null);
  const [sendError, setSendError] = useState("");
  const [editing, setEditing] = useState<ContactForm | "new" | null>(null);
  const [code, setCode] = useState<ContactForm | null>(null);
  const [showing, setShowing] = useState<ContactForm | null>(null);
  const [busy, setBusy] = useState("");

  const base = `/api/companies/${encodeURIComponent(c.id)}/forms`;
  const load = useCallback(() => get<FormsPage>(`/api/companies/${encodeURIComponent(c.id)}/forms`).then(setPage)
    .catch((e) => toast({ text: (e as Error).message, tone: "error" })), [c.id, toast]);
  const loadSending = useCallback(() => get<FormSending>(`/api/companies/${encodeURIComponent(c.id)}/forms/sending`)
    .then((s) => { setSending(s); setSendError(""); }).catch((e) => setSendError((e as Error).message)), [c.id]);
  useEffect(() => { load(); loadSending(); }, [load, loadSending]);

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      await load();
      if (done) toast({ text: done, tone: "ok" });
      return true;
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
      return false;
    } finally {
      setBusy("");
    }
  };

  const copy = (v: string, what = "Copied.") => navigator.clipboard.writeText(v)
    .then(() => toast({ text: what }), () => toast({ text: "Could not copy; select the text instead.", tone: "error" }));

  if (!page) return <div className="center-pad"><Spinner /></div>;
  const forms = page.forms;
  const app = sending?.apps.find((a) => a.id === (forms[0]?.appId ?? sending.suggested));
  const domain = app?.domain ?? null;
  const unready = domain ? Object.entries(domain.status).filter(([k, v]) => k !== "mx" && v.status !== "OK") : [];

  return (
    <>
      <PageHead title="Forms"
        sub={<>Point any message people write at one of {c.name}'s addresses: a site's contact form, a card in the app, anything your own code posts. It arrives in that address's folder, and one reply answers them.</>}
        actions={<Button variant="primary" icon={<Plus size={16} />} disabled={!page.ready} onClick={() => setEditing("new")}>Connect a form</Button>} />

      {!page.ready && (
        <div className="notice notice-warn"><Alert size={16} />
          <span>Forms are not connected to this dashboard yet. Run <code>workspace-setup.sh</code> on the server, so it can hand the forms service its sites.</span></div>
      )}
      {sendError && (
        <div className="notice notice-warn"><Alert size={16} />
          <span>Sending isn't connected, so a form cannot send yet: {sendError}</span></div>
      )}
      {forms.length > 0 && domain && unready.length > 0 && (
        <div className="notice notice-warn"><Alert size={16} />
          <span>
            {c.domain} still needs its {unready.map(([k]) => (k === "returnPath" ? "return path" : k.toUpperCase())).join(" and ")} record
            {unready.length > 1 ? "s" : ""} in DNS, or what the forms send may land in spam.{" "}
            <a href={href({ page: "settings", section: "sending", cid: app!.id, tab: "domains" })} onClick={onNav({ page: "settings", section: "sending", cid: app!.id, tab: "domains" })}>Show the records</a>
          </span></div>
      )}

      {forms.length === 0 ? (
        <Card>
          <Empty icon={<FileText size={22} />} title="No forms yet"
            action={<Button variant="primary" disabled={!page.ready} onClick={() => setEditing("new")}>Connect a form</Button>}>
            Pick an address, say where people write the message, and paste the code it gives you — a web form, a card in a phone app, or a call from your backend. Nothing else to host.
          </Empty>
        </Card>
      ) : (
        <div className="addr-list">
          {forms.map((f) => (
            <div key={f.id} className={cls("addr", !f.enabled && "is-off")}>
              <div className="addr-main">
                <span className="addr-icon"><FileText size={16} /></span>
                <div>
                  <div className="addr-email">{f.name}{!f.enabled && <Pill tone="warn">Off</Pill>}</div>
                  <div className="addr-folder">
                    <At size={13} />
                    <span>to {f.email}</span>
                    <span className="addr-dot" aria-hidden>·</span>
                    <span>{posters(f)}</span>
                    <span className="addr-dot" aria-hidden>·</span>
                    <span>sent by {f.appName}</span>
                  </div>
                  <div className="form-endpoint">
                    <code>{f.endpoint}</code>
                    <button className="icon-btn" aria-label="Copy the form's address" data-tip="Copy" onClick={() => copy(f.endpoint, "The form's address is copied.")}><Copy size={14} /></button>
                  </div>
                </div>
              </div>
              <div className="addr-ctl">
                <div className="addr-ctl-item">
                  <span className="mini-label">On</span>
                  <Toggle checked={f.enabled} label={`${f.name} on`}
                    onChange={(v) => run(`on-${f.id}`, () => patch(`${base}/${f.id}`, { enabled: v }), v ? `${f.name} is taking messages.` : `${f.name} is off; the site gets “No such form”.`)} />
                </div>
                <Button size="sm" onClick={() => setCode(f)}>Get the code</Button>
                <button className="icon-btn" aria-label={`Submissions to ${f.name}`} data-tip="Submissions" onClick={() => setShowing(f)}><FileText size={16} /></button>
                <button className="icon-btn" aria-label={`Send a test through ${f.name}`} data-tip="Send a test" disabled={busy === `test-${f.id}`}
                  onClick={async () => {
                    setBusy(`test-${f.id}`);
                    try {
                      const r = await post<{ ok: boolean; error?: string }>(`${base}/${f.id}/test`);
                      toast(r.ok ? { text: `Test sent through ${f.name}. It should be in ${f.email} in a moment.`, tone: "ok", ms: 7000 } : { text: r.error ?? "The form refused it.", tone: "error" });
                    } catch (e) {
                      toast({ text: (e as Error).message, tone: "error" });
                    } finally {
                      setBusy("");
                    }
                  }}><Send size={16} /></button>
                <button className="icon-btn" aria-label={`Edit ${f.name}`} data-tip="Edit" onClick={() => setEditing(f)}><Pencil size={16} /></button>
                <button className="icon-btn" aria-label={`Remove ${f.name}`} data-tip="Remove"
                  onClick={() => { if (confirm(`Remove “${f.name}”? The site's form stops working at once. Messages already received stay in ${f.email}.`)) run(`rm-${f.id}`, () => del(`${base}/${f.id}`), `${f.name} removed.`); }}>
                  <Trash size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {forms.length > 0 && (
        <Card title="How a message reaches the inbox" subtitle="Nothing to install and nothing to host; one address is all anything posts to.">
          <ol className="steps">
            <li>The page, the app or your server posts the fields as a form or as JSON to <code>{page.endpointBase}/s/…</code>. Every field becomes a line in the mail, so send whatever helps you answer.</li>
            <li>The service checks where it came from, the honeypot and the rate limits, then sends the message through {app?.name ?? "Postal"} as <b>{c.domain}</b>, with <b>Reply-To</b> set to the person, when the message carries their email.</li>
            <li>It arrives at the address the form names, filed in that address's folder. Every submission is also kept on the server, under Submissions.</li>
          </ol>
        </Card>
      )}

      {editing && (
        <FormEditor company={c} form={editing === "new" ? null : editing} sending={sending}
          onClose={() => setEditing(null)}
          onSaved={(f, isNew) => {
            setEditing(null);
            load();
            if (isNew) { setCode(f); toast({ text: `${f.name} is connected.`, tone: "ok" }); }
            else toast({ text: `${f.name} saved.`, tone: "ok" });
          }} />
      )}
      {code && <CodeModal form={code} onClose={() => setCode(null)} onCopy={copy} />}
      {showing && <Submissions company={c} form={showing} onClose={() => setShowing(null)} />}
    </>
  );
}

function FormEditor({ company, form, sending, onClose, onSaved }: {
  company: FullCompany; form: ContactForm | null; sending: FormSending | null;
  onClose: () => void; onSaved: (f: ContactForm, isNew: boolean) => void;
}) {
  const primary = company.addresses.find((a) => a.isPrimary) ?? company.addresses[0];
  const [name, setName] = useState(form?.name ?? "");
  const [addressId, setAddressId] = useState<number>(form?.addressId ?? primary?.id ?? 0);
  const [origins, setOrigins] = useState((form?.origins ?? [`https://${company.domain}`, `https://www.${company.domain}`]).join("\n"));
  const [redirect, setRedirect] = useState(form?.redirect ?? "");
  const [subject, setSubject] = useState(form?.subject ?? DEFAULT_SUBJECT);
  const [fromApps, setFromApps] = useState(form?.allowNoOrigin ?? false);
  const [auto, setAuto] = useState(!!form?.autoreply);
  const [autoSubject, setAutoSubject] = useState(form?.autoreply?.subject ?? `We got your message`);
  const [autoText, setAutoText] = useState(form?.autoreply?.text ?? `Hello {name},\n\nThanks for writing to ${company.name}. We have your message and will answer within one working day.\n\n${company.name}`);
  const [appId, setAppId] = useState(form?.appId ?? sending?.suggested ?? "");
  const [limits, setLimits] = useState(form?.limits ?? { perMinute: 5, perDay: 200 });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!form && sending && !appId) setAppId(sending.suggested); }, [form, sending, appId]);

  const address = company.addresses.find((a) => a.id === addressId);
  const submit = async () => {
    setBusy(true); setError("");
    const payload = {
      name, addressId, origins: origins.split(/[\s,]+/).filter(Boolean), allowNoOrigin: fromApps, redirect, subject,
      autoreply: auto ? { subject: autoSubject, text: autoText } : null, limits, appId,
    };
    try {
      const saved = form
        ? await patch<ContactForm>(`/api/companies/${encodeURIComponent(company.id)}/forms/${form.id}`, payload)
        : await post<ContactForm>(`/api/companies/${encodeURIComponent(company.id)}/forms`, payload);
      onSaved(saved, !form);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={form ? <>Edit “{form.name}”</> : "Connect a form"} width={640}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!name.trim() || !addressId} onClick={submit}>{form ? "Save" : "Connect"}</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="What is it" hint="For you, in this list: the page or site the form is on.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact page" maxLength={60} autoFocus />
        </Field>
        <Field label="Messages arrive at" hint={address ? <>Filed in “{address.label || "Inbox"}”, and answered from this address.</> : "One of the company's addresses."}>
          <select className="input select" value={addressId} onChange={(e) => setAddressId(Number(e.target.value))} aria-label="Address">
            {company.addresses.map((a) => <option key={a.id} value={a.id}>{a.email}{a.isPrimary ? " (main)" : a.label ? ` — ${a.label}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Sites allowed to post" hint={<>One per line: <code>https://{company.domain}</code>, or <code>*.{company.domain}</code> for every subdomain. Leave it empty and any site may post to this form.</>}>
          <Textarea rows={2} value={origins} onChange={(e) => setOrigins(e.target.value)} spellCheck={false} placeholder={`https://${company.domain}`} />
        </Field>
        <label className="toggle-row">
          <Toggle checked={fromApps} onChange={setFromApps} label="Apps and servers may post" />
          <span><b>A message written in an app, or sent by a server</b>
            <span className="field-hint">
              A phone or desktop app, or your own backend, sends no site address, so the list above cannot be checked for it.
              Turn this on for the message card in {company.name}'s app. The limits below still hold, whoever posts.
            </span></span>
        </label>
        <div className="form-row">
          <Field label="Subject of the mail" hint={<>“{"{field}"}” becomes that field: {DEFAULT_SUBJECT}.</>}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={DEFAULT_SUBJECT} maxLength={200} />
          </Field>
          <Field label="After sending, go to" hint="Optional: a thank-you page on the site. Only for a plain form, not for one that posts from a script.">
            <Input value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder={`https://${company.domain}/thanks`} spellCheck={false} />
          </Field>
        </div>
        <label className="toggle-row">
          <Toggle checked={auto} onChange={setAuto} label="Answer the visitor" />
          <span><b>Answer the visitor at once</b><span className="field-hint">Sent to the email they gave, from {address?.email ?? company.email}. “{"{name}"}” works here too.</span></span>
        </label>
        {auto && (
          <>
            <Field label="Their subject"><Input value={autoSubject} onChange={(e) => setAutoSubject(e.target.value)} maxLength={200} /></Field>
            <Field label="Their message"><Textarea rows={6} value={autoText} onChange={(e) => setAutoText(e.target.value)} /></Field>
          </>
        )}
        <button type="button" className="form-more" onClick={() => setMore((m) => !m)}>{more ? "Fewer settings" : "More settings"}</button>
        {more && (
          <div className="form-row form-row-3">
            <Field label="Sent through" hint="The app in Sending whose domain and key send it.">
              <select className="input select" value={appId} onChange={(e) => setAppId(e.target.value)} aria-label="Sending app">
                {(sending?.apps ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.domain ? ` · ${sending?.domain} ready` : ""}</option>)}
                <option value="">New app named {company.name}</option>
              </select>
            </Field>
            <Field label="Most per visitor a minute">
              <Input type="number" min={1} max={60} value={limits.perMinute} onChange={(e) => setLimits({ ...limits, perMinute: Number(e.target.value) })} />
            </Field>
            <Field label="Most a day">
              <Input type="number" min={1} max={20000} value={limits.perDay} onChange={(e) => setLimits({ ...limits, perDay: Number(e.target.value) })} />
            </Field>
          </div>
        )}
        {error && <div className="notice notice-warn"><Alert size={16} /><span>{error}</span></div>}
      </form>
    </Modal>
  );
}

function CodeModal({ form, onClose, onCopy }: { form: ContactForm; onClose: () => void; onCopy: (v: string, what?: string) => void }) {
  const [kind, setKind] = useState(SNIPPETS[0]!.id);
  const snippet = SNIPPETS.find((x) => x.id === kind) ?? SNIPPETS[0]!;
  const code = snippet.code(form);
  const needsApps = kind !== "html" && !form.allowNoOrigin && form.origins.length > 0;
  return (
    <Modal open onClose={onClose} title={<>The code for “{form.name}”</>} width={660}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="primary" icon={<Copy size={16} />} onClick={() => onCopy(code, "The code is copied. Paste it where the message is written.")}>Copy the code</Button></>}>
      <div className="form">
        <div className="kv"><span>Posts to</span><code>{form.endpoint}</code>
          <button className="icon-btn" aria-label="Copy the address" onClick={() => onCopy(form.endpoint, "The form's address is copied.")}><Copy size={14} /></button></div>
        <div className="kv"><span>Arrives at</span><code>{form.email}</code><span /></div>
        <Field label="Where the message is written">
          <select className="input select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Where the message is written">
            {SNIPPETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </Field>
        <pre className="form-code">{code}</pre>
        {needsApps && (
          <div className="notice notice-warn"><Alert size={16} />
            <span>A phone app, a desktop app or a server sends no site address, so this form would refuse it. Turn on <b>a message written in an app or sent by a server</b> under Edit.</span></div>
        )}
        <p className="field-hint">
          Every field is sent along with its name as its label, so add whatever helps you answer: who was signed in, the
          screen, the app's version, an order number. <code>email</code> becomes Reply-To{form.autoreply ? " and gets the answer" : ""};
          {" "}<code>_subject</code>, <code>_redirect</code> and <code>_cc</code> steer one submission; <code>botcheck</code> is the honeypot.
          A form moved over from Web3Forms keeps working: only its <code>action</code> changes.
        </p>
      </div>
    </Modal>
  );
}

const STATUS: Record<string, { tone: "ok" | "warn" | "error" | "neutral"; label: string }> = {
  sent: { tone: "ok", label: "Sent" },
  failed: { tone: "error", label: "Not sent" },
  rate: { tone: "warn", label: "Too many" },
  bot: { tone: "neutral", label: "Bot" },
};

function Submissions({ company, form, onClose }: { company: FullCompany; form: ContactForm; onClose: () => void }) {
  const [list, setList] = useState<FormSubmission[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setList(null);
    get<{ submissions: FormSubmission[] }>(`/api/companies/${encodeURIComponent(company.id)}/forms/${form.id}/submissions`)
      .then((r) => { setList(r.submissions); setError(""); })
      .catch((e) => { setError((e as Error).message); setList([]); });
  }, [company.id, form.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <Modal open onClose={onClose} title={<>Submissions to “{form.name}”</>} width={660}
      footer={<><Button icon={<Refresh size={15} />} onClick={load}>Refresh</Button><Button variant="ghost" onClick={onClose}>Close</Button></>}>
      {error ? <Empty icon={<Alert size={22} />} title="Can't read them">{error}</Empty>
        : !list ? <div className="center-pad"><Spinner /></div>
        : !list.length ? <Empty icon={<FileText size={22} />} title="Nothing yet">The first submission shows up here, mail or no mail.</Empty>
        : (
          <div className="subs">
            {list.map((s) => {
              const st = STATUS[s.status] ?? { tone: "neutral" as const, label: s.status };
              return (
                <div key={s.id} className="sub">
                  <div className="sub-top">
                    <Pill tone={st.tone} dot>{st.label}</Pill>
                    <span className="sub-when">{relative(Date.parse(s.at))}</span>
                    <span className="bar-fill" />
                    {s.page && <span className="sub-page">{s.page}</span>}
                  </div>
                  <div className="sub-fields">
                    {Object.entries(s.fields).map(([k, v]) => (
                      <div key={k} className="sub-field"><span>{k}</span><span>{v}</span></div>
                    ))}
                  </div>
                  {s.reason && <p className="dns-note">{s.reason}</p>}
                </div>
              );
            })}
          </div>
        )}
    </Modal>
  );
}
