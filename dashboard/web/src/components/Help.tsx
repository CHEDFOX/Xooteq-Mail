// "?": every keyboard shortcut on one card.
import { useApp } from "../store";
import { modKey } from "../util";
import { Modal } from "../ui";

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  { title: "Anywhere", keys: [[[modKey, "K"], "Command menu"], [["C"], "Write"], [["/"], "Search"], [[modKey, "1–9"], "Switch company"], [["?"], "These shortcuts"]] },
  { title: "Go to", keys: [[["G", "I"], "Inbox"], [["G", "D"], "Drafts"], [["G", "S"], "Sent"], [["G", "A"], "Archive"], [["G", "T"], "Trash"], [["G", "O"], "Settings"]] },
  { title: "Conversations", keys: [[["J"], "Next"], [["K"], "Previous"], [["↵"], "Open"], [["Esc"], "Back to the list"], [["X"], "Tick"], [["E"], "Archive"], [["#"], "Delete"], [["!"], "Spam"], [["S"], "Star"], [["⇧", "U"], "Mark unread"], [["⇧", "I"], "Mark read"]] },
  { title: "Replying", keys: [[["R"], "Reply"], [["A"], "Reply all"], [["F"], "Forward"], [[modKey, "↵"], "Send"], [["Esc"], "Close, keeping the draft"]] },
];

export function Help() {
  const { setHelp } = useApp();
  return (
    <Modal open onClose={() => setHelp(false)} title="Keyboard shortcuts" width={720}>
      <div className="help-grid">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h4>{g.title}</h4>
            <dl>
              {g.keys.map(([keys, what]) => (
                <div key={what + keys.join()} className="help-row">
                  <dt>{what}</dt>
                  <dd>{keys.map((k, i) => <kbd key={i} className="kbd">{k}</kbd>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
