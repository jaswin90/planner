// Markdown → note HTML, for pasting Markdown text into a note (headings, lists, to-dos,
// quotes, code, tables, rules, $$ equations, bold/italic/code/strike/highlight/links).
// The result always goes through sanitizeHtml before it reaches the page.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Does this plain text use Markdown block or inline syntax? */
export function looksLikeMarkdown(t) {
  if (!t || t.length > 500000) return false;
  return /(^|\n)[ \t]{0,3}(#{1,6}[ \t]|[-*+][ \t]+\S|\d+[.)][ \t]+\S|>[ \t]?\S|```|\$\$|([-*_])([ \t]*\3){2,}[ \t]*(\n|$)|\|.+\|[ \t]*\n[ \t]*\|?[ \t]*:?-{3,})/.test(t)
    || /\*\*[^*\n]+\*\*|(^|\s)`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|~~[^~\n]+~~/.test(t);
}

/** Inline Markdown on one line of text. */
export function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt, u) => `<a href="${u}">${alt || 'image'}</a>`);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)'"])/g, '$1<a href="$2">$2</a>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\s](?:[^_\n]*[^_\s])?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>').replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

const LIST = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
const TABLE_SEP = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/;
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function markdownToHtml(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]*```/.test(line)) {
      flush();
      const body = [];
      while (++i < lines.length && !/^[ \t]*```/.test(lines[i])) body.push(lines[i]);
      out.push(`<pre>${esc(body.join("\n"))}\n</pre>`);
      continue;
    }
    if (/^[ \t]*\$\$/.test(line)) {
      flush();
      let tex = line.trim().slice(2);
      if (tex.endsWith('$$') && tex.length > 2) tex = tex.slice(0, -2);
      else { while (++i < lines.length && !lines[i].trim().endsWith('$$')) tex += '\n' + lines[i]; if (i < lines.length) tex += '\n' + lines[i].trim().slice(0, -2); }
      tex = tex.trim();
      if (tex) out.push(`<div class="eq-block" data-tex="${esc(tex)}"></div>`);
      continue;
    }
    const hd = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line);
    if (hd) { flush(); const n = Math.min(4, hd[1].length); out.push(`<h${n}>${inline(hd[2])}</h${n}>`); continue; }
    if (/^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      let html = '<table><tbody><tr>' + head.map((c) => `<th>${inline(c) || '<br>'}</th>`).join('') + '</tr>';
      i++;
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) {
        const row = cells(lines[++i]);
        html += '<tr>' + head.map((_, k) => `<td>${inline(row[k] || '') || '<br>'}</td>`).join('') + '</tr>';
      }
      out.push(html + '</tbody></table>');
      continue;
    }
    if (/^[ \t]{0,3}>/.test(line)) {
      flush();
      const q = [];
      for (; i < lines.length && /^[ \t]{0,3}>/.test(lines[i]); i++) q.push(lines[i].replace(/^[ \t]{0,3}>[ \t]?/, ''));
      i--;
      out.push(`<blockquote>${q.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    if (LIST.test(line)) {
      flush();
      const items = [];
      for (; i < lines.length; i++) {
        const m = LIST.exec(lines[i]);
        if (m) {
          const task = /^\[([ xX])\][ \t]+/.exec(m[3]);
          items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), task: !!task, checked: !!task && task[1] !== ' ', text: task ? m[3].slice(task[0].length) : m[3] });
        } else if (lines[i].trim() && /^[ \t]{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ' ' + lines[i].trim(); // continuation line
        } else break;
      }
      i--;
      out.push(renderList(items));
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    para.push(line.trim());
  }
  flush();
  return out.join('');
}

function renderList(items) {
  let i = 0;
  const level = (min) => {
    let html = '', open = null;
    while (i < items.length && items[i].indent >= min) {
      const it = items[i];
      const tag = it.ordered ? 'ol' : 'ul';
      const key = tag + (it.task ? '.c' : '');
      if (open !== key) { if (open) html += `</${open.slice(0, 2)}>`; html += it.task ? '<ul class="checklist">' : `<${tag}>`; open = key; }
      i++;
      let inner = inline(it.text) || '<br>';
      if (i < items.length && items[i].indent > it.indent) inner += level(items[i].indent);
      html += `<li${it.task ? ` data-checked="${it.checked}"` : ''}>${inner}</li>`;
    }
    if (open) html += `</${open.slice(0, 2)}>`;
    return html;
  };
  let html = '';
  while (i < items.length) html += level(items[i].indent);
  return html;
}
