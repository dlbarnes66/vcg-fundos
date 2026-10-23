/** CSV for Excel/Numbers. Guards against spreadsheet formula injection (=, +, -, @ at the start of text). */
export function toCsv(rows: Record<string, unknown>[], columns: [string, string][]) {
  const cell = (v: unknown) => {
    if (v == null) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(([, label]) => cell(label)).join(',');
  const body = rows.map((r) => columns.map(([key]) => cell(r[key])).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}
