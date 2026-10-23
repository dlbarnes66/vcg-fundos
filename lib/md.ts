// Minimal Markdown handling for drafts: headings, paragraphs, bullet/numbered lists,
// tables and **bold**. Shared by the on-screen preview and the Word export.

export type MdBlock =
  | { type: 'h'; level: number; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'table'; rows: string[][] };

export function parseMd(src: string): MdBlock[] {
  const lines = (src ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ type: 'p', text: para.join(' ').trim() });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (!line.trim()) { flush(); continue; }
    if (h) { flush(); out.push({ type: 'h', level: h[1].length, text: h[2].trim() }); continue; }
    if (/^\s*\|/.test(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      out.push({ type: 'table', rows });
      continue;
    }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const last = out[out.length - 1];
      const item = (ul ?? ol)![1];
      if (last && last.type === kind) last.items.push(item);
      else out.push({ type: kind, items: [item] });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Inline: escape, then **bold** and highlighted [[MISSING/COUNSEL]] markers. */
export function inlineHtml(s: string) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\[(MISSING|COUNSEL):\s*(.+?)\]\]/g, (_m, k, t) => `<mark class="marker ${k === 'MISSING' ? 'missing' : 'counsel'}">${k === 'MISSING' ? 'Missing' : 'Counsel'}: ${t}</mark>`);
}

export function mdToHtml(src: string) {
  return parseMd(src)
    .map((b) => {
      if (b.type === 'h') return `<h${Math.min(6, b.level + 2)}>${inlineHtml(b.text)}</h${Math.min(6, b.level + 2)}>`;
      if (b.type === 'p') return `<p>${inlineHtml(b.text)}</p>`;
      if (b.type === 'table') {
        const [head, ...body] = b.rows;
        return `<table class="md"><thead><tr>${(head ?? []).map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`;
      }
      return `<${b.type}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${b.type}>`;
    })
    .join('\n');
}
