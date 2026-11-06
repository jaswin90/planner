// Allow-list HTML sanitizer for rich notes. Runs on every save AND every
// render, so pasted or synced HTML can never run script, load remote
// content, or carry tracking pixels. Uses DOMParser, which builds an inert
// document (scripts do not run, images do not load).

const TAGS = new Set([
  'P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP',
  'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'IMG', 'SPAN',
  'MARK', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
]);
// Elements removed together with their content.
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'BASE', 'TITLE', 'HEAD', 'AUDIO', 'VIDEO', 'SOURCE', 'FRAME', 'FRAMESET']);
const ATT_ID = /^[0-9a-f]{24}$/;

function safeHref(href) {
  const h = String(href || '').trim();
  try {
    const u = new URL(h, 'https://invalid.example/');
    if (u.origin === 'https://invalid.example') return null; // relative links are pointless here
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch { return null; }
}

function clean(node, doc) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) { child.remove(); continue; } // comments etc.
    const tag = child.tagName.toUpperCase();
    if (DROP.has(tag)) { child.remove(); continue; }
    if (!TAGS.has(tag)) {
      // Unwrap unknown element, keep its (cleaned) children.
      clean(child, doc);
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    const keep = {};
    if (tag === 'A') {
      const href = safeHref(child.getAttribute('href'));
      if (!href) { clean(child, doc); child.replaceWith(...Array.from(child.childNodes)); continue; }
      keep.href = href; keep.target = '_blank'; keep.rel = 'noopener noreferrer nofollow';
    } else if (tag === 'IMG') {
      const id = child.getAttribute('data-att');
      if (!id || !ATT_ID.test(id)) { child.remove(); continue; } // only our own encrypted images
      keep['data-att'] = id;
      const alt = child.getAttribute('alt');
      if (alt) keep.alt = alt.slice(0, 200);
      const w = child.getAttribute('data-w');
      if (w && /^(25|50|75|100)$/.test(w)) keep['data-w'] = w;
    } else if (tag === 'LI') {
      const c = child.getAttribute('data-checked');
      if (c === 'true' || c === 'false') keep['data-checked'] = c;
    } else if (tag === 'UL') {
      if (child.classList.contains('checklist')) keep.class = 'checklist';
    } else if (tag === 'SPAN') {
      const a = child.getAttribute('data-att');
      if (a && ATT_ID.test(a) && child.classList.contains('att-chip')) { keep['data-att'] = a; keep.class = 'att-chip'; keep.contenteditable = 'false'; }
    } else if (tag === 'TD' || tag === 'TH') {
      for (const k of ['colspan', 'rowspan']) {
        const v = child.getAttribute(k);
        if (v && /^[1-9]$/.test(v)) keep[k] = v;
      }
    }
    for (const a of Array.from(child.attributes)) child.removeAttribute(a.name);
    for (const [k, v] of Object.entries(keep)) child.setAttribute(k, v);
    clean(child, doc);
  }
}

/** Return sanitized HTML string. */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${String(html || '')}`, 'text/html');
  clean(doc.body, doc);
  return doc.body.innerHTML;
}

/** Sanitize and return a DocumentFragment ready to insert. */
export function sanitizeToFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitizeHtml(html); // already inert-safe: only allow-listed markup survives
  return tpl.content;
}
