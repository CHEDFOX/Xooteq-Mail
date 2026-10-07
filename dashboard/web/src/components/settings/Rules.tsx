// Rules: "when mail matches this, do that", run by the mail server on arrival,
// top to bottom. Built here in plain words; the server turns them into Sieve.
import { useEffect, useState } from "react";
import { put } from "../../api";
import { useApp } from "../../store";
import { useMailData } from "../../mailData";
import type { Action, Condition, Rule } from "../../types";
import { cls } from "../../util";
import { ChevronDown, Plus, Rules as RulesIcon, Trash, X } from "../../icons";
import { Button, Card, Empty, Segmented, Toggle } from "../../ui";
import { PageHead } from "./Settings";
import type { FullCompany } from "./Company";

const FIELDS: { value: Condition["field"]; label: string }[] = [
  { value: "from", label: "Sender" }, { value: "to", label: "Recipient" }, { value: "subject", label: "Subject" },
  { value: "body", label: "Message text" }, { value: "header", label: "Header" }, { value: "attachment", label: "Attachment name" },
];
const OPS: { value: Condition["op"]; label: string }[] = [
  { value: "contains", label: "contains" }, { value: "not-contains", label: "does not contain" }, { value: "is", label: "is" },
  { value: "starts", label: "starts with" }, { value: "ends", label: "ends with" },
];
const ACTIONS: { value: Action["type"]; label: string; needs?: "folder" | "email" }[] = [
  { value: "move", label: "Move to folder", needs: "folder" }, { value: "label", label: "Also file in folder", needs: "folder" },
  { value: "read", label: "Mark as read" }, { value: "star", label: "Star it" },
  { value: "forward", label: "Forward a copy to", needs: "email" }, { value: "delete", label: "Delete it" },
  { value: "stop", label: "Stop, run no more rules" },
];

const blank = (): Rule => ({ name: "", enabled: true, match: "all", conditions: [{ field: "from", op: "contains", value: "" }], actions: [{ type: "move", value: "" }] });

export function Rules({ c, onSaved }: { c: FullCompany; onSaved: (rules: Rule[]) => void }) {
  const { toast, jmap } = useApp();
  const data = useMailData(jmap(c.id));
  const [rules, setRules] = useState<Rule[]>(c.rules);
  const [open, setOpen] = useState<number | null>(c.rules.length ? null : -1);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRules(c.rules), [c.rules]);
  const dirty = JSON.stringify(rules) !== JSON.stringify(c.rules);
  const folders = [...new Set(data.boxes.filter((b) => !b.role).map((b) => b.name))];

  const setRule = (i: number, p: Partial<Rule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const moveRule = (i: number, d: number) => setRules((rs) => { const n = [...rs]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });

  async function save() {
    setBusy(true);
    try {
      const saved = await put<Rule[]>(`/api/companies/${encodeURIComponent(c.id)}/rules`, { rules });
      onSaved(saved);
      setRules(saved);
      toast({ text: "Rules saved. They apply to mail from now on.", tone: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Rules" sub="Sort, flag and forward mail the moment it arrives. Rules run top to bottom, before auto-replies and AI."
        actions={<Button icon={<Plus size={16} />} onClick={() => { setRules((rs) => [...rs, blank()]); setOpen(rules.length); }}>New rule</Button>} />
      <datalist id="folder-names">{folders.map((f) => <option key={f} value={f} />)}</datalist>
      {rules.length === 0 ? (
        <Card><Empty icon={<RulesIcon size={22} />} title="No rules yet" action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => { setRules([blank()]); setOpen(0); }}>Make the first rule</Button>}>
          For example: mail from your payment provider goes to “Receipts” and is marked read; anything with “invoice” in the subject is starred.
        </Empty></Card>
      ) : (
        <div className="rules">
          {rules.map((r, i) => {
            const expanded = open === i;
            return (
              <div key={i} className={cls("rule", expanded && "is-open", !r.enabled && "is-off")}>
                <div className="rule-head" onClick={() => setOpen(expanded ? null : i)}>
                  <span className="rule-n">{i + 1}</span>
                  <div className="rule-sum">
                    <b>{r.name || summary(r)}</b>
                    {r.name && <span>{summary(r)}</span>}
                  </div>
                  <span onClick={(e) => e.stopPropagation()}><Toggle checked={r.enabled} onChange={(v) => setRule(i, { enabled: v })} label="Rule on" /></span>
                  <ChevronDown size={16} className="rule-chev" />
                </div>
                {expanded && (
                  <div className="rule-body">
                    <input className="input" value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} placeholder="Name (optional), e.g. Receipts" aria-label="Rule name" />
                    <div className="rule-sect">
                      <span className="rule-when">When</span>
                      <Segmented size="sm" value={r.match} onChange={(v) => setRule(i, { match: v })} options={[{ value: "all", label: "all of these match" }, { value: "any", label: "any of these match" }]} />
                    </div>
                    {r.conditions.map((cond, k) => (
                      <div key={k} className="rule-row">
                        <select className="input select" value={cond.field} onChange={(e) => setRule(i, { conditions: r.conditions.map((x, j) => (j === k ? { ...x, field: e.target.value as Condition["field"] } : x)) })}>
                          {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        {cond.field === "header" && (
                          <input className="input rule-header" value={cond.header ?? ""} placeholder="List-Id" onChange={(e) => setRule(i, { conditions: r.conditions.map((x, j) => (j === k ? { ...x, header: e.target.value } : x)) })} />
                        )}
                        <select className="input select" value={cond.op} onChange={(e) => setRule(i, { conditions: r.conditions.map((x, j) => (j === k ? { ...x, op: e.target.value as Condition["op"] } : x)) })}>
                          {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input className="input rule-value" value={cond.value} placeholder={cond.field === "from" ? "stripe.com" : "text"} onChange={(e) => setRule(i, { conditions: r.conditions.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })} />
                        <button className="icon-btn" aria-label="Remove condition" disabled={r.conditions.length === 1} onClick={() => setRule(i, { conditions: r.conditions.filter((_, j) => j !== k) })}><X size={14} /></button>
                      </div>
                    ))}
                    <button className="link-btn" onClick={() => setRule(i, { conditions: [...r.conditions, { field: "subject", op: "contains", value: "" }] })}><Plus size={14} />Condition</button>
                    <div className="rule-sect"><span className="rule-when">Then</span></div>
                    {r.actions.map((a, k) => {
                      const def = ACTIONS.find((x) => x.value === a.type);
                      return (
                        <div key={k} className="rule-row">
                          <select className="input select" value={a.type} onChange={(e) => setRule(i, { actions: r.actions.map((x, j) => (j === k ? { type: e.target.value as Action["type"], value: "" } : x)) })}>
                            {ACTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                          </select>
                          {def?.needs && (
                            <input className="input rule-value" list={def.needs === "folder" ? "folder-names" : undefined} type={def.needs === "email" ? "email" : "text"}
                              value={a.value ?? ""} placeholder={def.needs === "folder" ? "Folder (made if new)" : "someone@example.com"}
                              onChange={(e) => setRule(i, { actions: r.actions.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })} />
                          )}
                          <button className="icon-btn" aria-label="Remove action" disabled={r.actions.length === 1} onClick={() => setRule(i, { actions: r.actions.filter((_, j) => j !== k) })}><X size={14} /></button>
                        </div>
                      );
                    })}
                    <button className="link-btn" onClick={() => setRule(i, { actions: [...r.actions, { type: "read" }] })}><Plus size={14} />Action</button>
                    <div className="rule-foot">
                      <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => { moveRule(i, -1); setOpen(i - 1); }}>Move up</Button>
                      <Button size="sm" variant="ghost" disabled={i === rules.length - 1} onClick={() => { moveRule(i, 1); setOpen(i + 1); }}>Move down</Button>
                      <span className="bar-fill" />
                      <Button size="sm" variant="ghost" icon={<Trash size={15} />} onClick={() => { setRules((rs) => rs.filter((_, j) => j !== i)); setOpen(null); }}>Delete rule</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes to rules</span>
          <Button variant="ghost" onClick={() => setRules(c.rules)}>Undo changes</Button>
          <Button variant="primary" busy={busy} onClick={save}>Save rules</Button>
        </div>
      )}
    </>
  );
}

function summary(r: Rule): string {
  const f = (c: Condition) => `${FIELDS.find((x) => x.value === c.field)?.label.toLowerCase() ?? c.field}${c.field === "header" && c.header ? ` ${c.header}` : ""} ${OPS.find((x) => x.value === c.op)?.label ?? c.op} “${c.value}”`;
  const a = (x: Action) => {
    const def = ACTIONS.find((d) => d.value === x.type);
    return x.type === "move" ? `move to ${x.value}` : x.type === "label" ? `file in ${x.value}` : x.type === "forward" ? `forward to ${x.value}` : (def?.label.toLowerCase() ?? x.type);
  };
  const conds = r.conditions.filter((c) => c.value || c.field === "attachment");
  return `${conds.length ? `If ${conds.map(f).join(r.match === "all" ? " and " : " or ")}` : "Every message"}: ${r.actions.map(a).join(", ")}`;
}
