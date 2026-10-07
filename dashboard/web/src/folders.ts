// The sidebar's folders for one company, from its mailboxes and addresses:
// Inbox, one folder per address (Support, Contact, ...), the system folders,
// then any other folders rules or mail apps made.
import type { Company, Mailbox } from "./types";

export type FolderKind = "system" | "address" | "folder";
export type Folder = {
  key: string;
  id: string;
  name: string;
  role: string | null;
  kind: FolderKind;
  unread: number;
  total: number;
  /** For an address folder, the address it collects. */
  email?: string;
};

const SYSTEM: { role: string; key: string; name: string }[] = [
  { role: "inbox", key: "inbox", name: "Inbox" },
  { role: "drafts", key: "drafts", name: "Drafts" },
  { role: "sent", key: "sent", name: "Sent" },
  { role: "archive", key: "archive", name: "Archive" },
  { role: "junk", key: "junk", name: "Spam" },
  { role: "trash", key: "trash", name: "Trash" },
];

export function buildFolders(boxes: Mailbox[], company?: Company): { inbox?: Folder; addresses: Folder[]; system: Folder[]; other: Folder[] } {
  const byRole = new Map(boxes.filter((b) => b.role).map((b) => [b.role!, b]));
  const sys = (role: string): Folder | undefined => {
    const s = SYSTEM.find((x) => x.role === role)!;
    const b = byRole.get(role);
    return b ? { key: s.key, id: b.id, name: s.name, role, kind: "system", unread: b.unreadThreads, total: b.totalThreads } : undefined;
  };
  const labels = new Map((company?.addresses ?? []).filter((a) => !a.isPrimary && a.label).map((a) => [a.label.toLowerCase(), a]));
  const addresses: Folder[] = [];
  const other: Folder[] = [];
  for (const b of boxes) {
    if (b.role) continue;
    const a = !b.parentId ? labels.get(b.name.toLowerCase()) : undefined;
    const f: Folder = { key: `f-${b.id}`, id: b.id, name: b.name, role: null, kind: a ? "address" : "folder", unread: b.unreadThreads, total: b.totalThreads, email: a?.email };
    (a ? addresses : other).push(f);
  }
  // Addresses in the order the company lists them; other folders by name.
  const order = (company?.addresses ?? []).map((a) => a.label.toLowerCase());
  addresses.sort((x, y) => order.indexOf(x.name.toLowerCase()) - order.indexOf(y.name.toLowerCase()));
  other.sort((x, y) => x.name.localeCompare(y.name));
  return {
    inbox: sys("inbox"),
    addresses,
    system: ["drafts", "sent", "archive", "junk", "trash"].map(sys).filter(Boolean) as Folder[],
    other,
  };
}

export function folderFor(key: string, boxes: Mailbox[], company?: Company): Folder | undefined {
  const f = buildFolders(boxes, company);
  return [f.inbox, ...f.addresses, ...f.system, ...f.other].find((x) => x?.key === key) as Folder | undefined;
}

/** Mail for the main address: in the Inbox and filed under no other address. */
export function mainOnly(f: ReturnType<typeof buildFolders>): Record<string, unknown> | null {
  if (!f.inbox) return null;
  return f.addresses.length
    ? { operator: "AND", conditions: [{ inMailbox: f.inbox.id }, { operator: "NOT", conditions: f.addresses.map((x) => ({ inMailbox: x.id })) }] }
    : { inMailbox: f.inbox.id };
}
