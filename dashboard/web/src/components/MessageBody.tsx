// One message's body. HTML is cleaned (DOMPurify), its remote images held back
// until asked for (they tell the sender you opened it), its embedded images
// shown, and the result drawn in a sandboxed frame that runs no script. Plain
// text keeps its lines and gets clickable links. Quoted history folds away.
import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Email } from "../types";
import type { Jmap } from "../jmap";
import { Eye, Image } from "../icons";
import { escapeHtml } from "../util";

const FRAME_CSS = `
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1b1c1f; overflow-wrap: anywhere; padding: 2px; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #0b6bcb; }
  blockquote { margin: 8px 0 8px 2px; padding-left: 12px; border-left: 3px solid #e2e3e6; color: #555; }
  pre { white-space: pre-wrap; }
  .xm-hide-quote .gmail_quote, .xm-hide-quote blockquote[type="cite"], .xm-hide-quote .xm-quote { display: none !important; }
  img[data-xm-pixel] { display: none !important; }
  img[data-xm-blocked] { display: inline-block; min-width: 20px; min-height: 20px; background: #f1f2f4; outline: 1px dashed #d4d6db; }
`;

function sanitize(html: string, showImages: boolean, cidMap: Map<string, string>): { html: string; blocked: number; hasQuote: boolean } {
  let blocked = 0;
  DOMPurify.removeAllHooks();
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") ?? "";
      if (src.startsWith("cid:")) {
        const url = cidMap.get(src.slice(4).replace(/^<|>$/g, ""));
        if (url) el.setAttribute("src", url); else el.removeAttribute("src");
      } else if (/^https?:/i.test(src) && !showImages) {
        el.setAttribute("data-xm-src", src);
        el.setAttribute("data-xm-blocked", "");
        const w = Number(el.getAttribute("width")), h = Number(el.getAttribute("height"));
        if ((w && w <= 3) || (h && h <= 3)) el.setAttribute("data-xm-pixel", "");
        el.removeAttribute("src");
        el.removeAttribute("srcset");
        blocked++;
      }
    }
    const style = el.getAttribute?.("style");
    if (style && /url\(/i.test(style) && !showImages) {
      el.setAttribute("style", style.replace(/url\([^)]*\)/gi, "none"));
      blocked++;
    }
    if (el.hasAttribute?.("background") && !showImages) {
      el.removeAttribute("background");
      blocked++;
    }
  });
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "meta", "link", "base"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
    ADD_ATTR: ["target"],
    ALLOW_DATA_ATTR: true,
  }) as string;
  DOMPurify.removeAllHooks();
  const hasQuote = /class="[^"]*gmail_quote|<blockquote[^>]+type="cite"/i.test(clean);
  return { html: clean, blocked, hasQuote };
}

function linkify(text: string): string {
  return escapeHtml(text).replace(/\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

/** Plain text with the trailing quoted block ("> ..." after "On ... wrote:") wrapped so it can fold. */
function textHtml(text: string): { html: string; hasQuote: boolean } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^On .+wrote:\s*$/.test(lines[i]) || (lines[i].startsWith(">") && lines.slice(i).every((l) => l.startsWith(">") || !l.trim()))) { cut = i; break; }
  }
  if (cut < 0) return { html: linkify(text), hasQuote: false };
  return { html: linkify(lines.slice(0, cut).join("\n")) + `<div class="xm-quote">${linkify(lines.slice(cut).join("\n"))}</div>`, hasQuote: true };
}

export function MessageBody({ email, jmap }: { email: Email; jmap: Jmap }) {
  const [showImages, setShowImages] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const htmlPart = email.htmlBody?.find((p) => p.type === "text/html" && p.partId && email.bodyValues?.[p.partId]);
  const text = (email.textBody ?? []).filter((p) => p.type === "text/plain").map((p) => email.bodyValues?.[p.partId!]?.value ?? "").join("\n");

  const cidMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of [...(email.attachments ?? []), ...(email.htmlBody ?? [])]) {
      if (p.cid && p.blobId) m.set(p.cid.replace(/^<|>$/g, ""), jmap.blobUrl(p.blobId, p.name ?? "image", p.type));
    }
    return m;
  }, [email, jmap]);

  const rendered = useMemo(() => {
    if (htmlPart) return sanitize(email.bodyValues![htmlPart.partId!].value, showImages, cidMap);
    return null;
  }, [email, htmlPart, showImages, cidMap]);

  // Size the frame to its content, and keep it sized as images load.
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    const fit = () => {
      const doc = f.contentDocument;
      if (!doc?.body) return;
      f.style.height = Math.max(40, doc.documentElement.scrollHeight) + "px";
    };
    const onLoad = () => {
      fit();
      const doc = f.contentDocument;
      if (doc?.body) {
        ro = new ResizeObserver(fit);
        ro.observe(doc.body);
        doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit));
      }
    };
    f.addEventListener("load", onLoad);
    return () => { f.removeEventListener("load", onLoad); ro?.disconnect(); };
  }, [rendered, showQuote]);

  if (!rendered) {
    const t = textHtml(text || email.preview || "");
    return (
      <div className="body-text-wrap">
        <div className={showQuote ? "body-text" : "body-text xm-hide-quote"} dangerouslySetInnerHTML={{ __html: t.html }} />
        {t.hasQuote && <button className="quote-toggle" onClick={() => setShowQuote((s) => !s)} aria-label="Show quoted text">•••</button>}
      </div>
    );
  }

  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${FRAME_CSS}</style></head><body class="${showQuote ? "" : "xm-hide-quote"}">${rendered.html}</body></html>`;
  return (
    <div className="body-html-wrap">
      {rendered.blocked > 0 && !showImages && (
        <div className="images-bar">
          <Image size={15} />
          <span>Remote images are hidden, so the sender cannot tell you opened this.</span>
          <button onClick={() => setShowImages(true)}><Eye size={14} />Show images</button>
        </div>
      )}
      <div className="paper">
        <iframe ref={frame} className="body-frame" title={email.subject ?? "Message"} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} />
      </div>
      {rendered.hasQuote && <button className="quote-toggle" onClick={() => setShowQuote((s) => !s)} aria-label="Show quoted text">•••</button>}
    </div>
  );
}
