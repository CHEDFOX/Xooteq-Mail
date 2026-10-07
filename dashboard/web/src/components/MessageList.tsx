// The list of conversations in a folder (or a search), newest first, grouped by day.
import { useEffect, useRef } from "react";
import type { ThreadRow } from "../jmap";
import type { Company } from "../types";
import { cls, dayGroup, displayName, shortTime } from "../util";
import { Avatar, Empty, Spinner } from "../ui";
import { Check, Inbox, Paperclip, Search, Sparkle, Star } from "../icons";

export function MessageList({ rows, total, loading, loadingMore, selected, focused, checked, company, folderName, labelFor, onOpen, onCheck, onMore, empty, header }: {
  rows: ThreadRow[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  selected?: string;
  focused: number;
  /** Conversations ticked for acting on together. */
  checked: Set<string>;
  company: Company;
  folderName: string;
  /** The address-folder label for a message (only shown where it adds something). */
  labelFor: (row: ThreadRow) => string | undefined;
  onOpen: (row: ThreadRow, index: number) => void;
  onCheck: (row: ThreadRow, index: number, range: boolean) => void;
  onMore: () => void;
  empty: { title: string; text: string; search?: boolean };
  header: React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard's row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${focused}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!loadingMore && rows.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 400) onMore();
  };

  let lastGroup = "";
  return (
    <section className="list" aria-label={folderName} style={{ "--co": company.color } as React.CSSProperties}>
      {header}
      <div className="list-scroll" ref={listRef} onScroll={onScroll} role="listbox" aria-label="Conversations">
        {loading && !rows.length ? (
          <div className="list-skeleton">{Array.from({ length: 8 }, (_, i) => <div key={i} className="row-skel" style={{ animationDelay: `${i * 60}ms` }} />)}</div>
        ) : !rows.length ? (
          <Empty icon={empty.search ? <Search size={22} /> : <Inbox size={22} />} title={empty.title}>{empty.text}</Empty>
        ) : rows.map((r, i) => {
          const group = dayGroup(r.receivedAt);
          const showGroup = group !== lastGroup;
          lastGroup = group;
          const from = r.from?.[0];
          const label = labelFor(r);
          const isDraft = r.keywords?.$draft;
          return (
            <div key={r.id} role="presentation">
              {showGroup && <div className="list-group">{group}</div>}
              <div
                role="option"
                tabIndex={-1}
                aria-selected={r.threadId === selected}
                data-index={i}
                className={cls("row", r.unread && "is-unread", r.threadId === selected && "is-selected", i === focused && "is-focused", checked.has(r.threadId) && "is-checked")}
                onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); onCheck(r, i, e.shiftKey); } else onOpen(r, i); }}
              >
                <span className="row-unread" aria-hidden />
                <button type="button" className={cls("row-pick", checked.size > 0 && "is-picking")} aria-label={checked.has(r.threadId) ? "Untick" : "Tick"} aria-pressed={checked.has(r.threadId)}
                  onClick={(e) => { e.stopPropagation(); onCheck(r, i, e.shiftKey); }}>
                  <Avatar name={displayName(isDraft ? r.to?.[0] : from)} email={(isDraft ? r.to?.[0]?.email : from?.email) ?? "?"} size={34} />
                  <span className="row-check" aria-hidden><Check size={16} /></span>
                </button>
                <span className="row-main">
                  <span className="row-line">
                    <span className="row-from">
                      {isDraft ? <em className="row-draft">Draft</em> : null}
                      {isDraft ? (r.to?.map((a) => displayName(a)).join(", ") || "(no recipient)") : displayName(from)}
                    </span>
                    {r.count > 1 && <span className="row-count">{r.count}</span>}
                    <span className="row-time">{shortTime(r.receivedAt)}</span>
                  </span>
                  <span className="row-line">
                    <span className="row-subject">{r.subject || "(no subject)"}</span>
                    <span className="row-flags">
                      {r.hasAttachment && <Paperclip size={14} />}
                      {r.keywords?.$flagged && <Star size={14} className="is-starred" />}
                    </span>
                  </span>
                  <span className="row-preview">{r.preview}</span>
                  {(label || r.keywords?.$ai_draft || r.keywords?.$ai_replied) && (
                    <span className="row-chips">
                      {label && <span className="chip chip-address">{label}</span>}
                      {r.keywords?.$ai_scheduled ? <span className="chip chip-ai"><Sparkle size={12} />AI reply sending</span>
                        : r.keywords?.$ai_draft && <span className="chip chip-ai"><Sparkle size={12} />AI reply to review</span>}
                      {r.keywords?.$ai_replied && <span className="chip chip-ai-done"><Sparkle size={12} />Answered by AI</span>}
                    </span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        {loadingMore && <div className="list-more"><Spinner /></div>}
        {!loading && rows.length > 0 && rows.length >= total && total > 12 && <div className="list-end">That's everything in {folderName}.</div>}
      </div>
    </section>
  );
}
