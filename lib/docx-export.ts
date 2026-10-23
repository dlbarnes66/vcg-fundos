import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, LevelFormat, Packer, PageNumber,
  Paragraph, Table, TableCell, TableRow, TextRun, WidthType, ShadingType,
} from 'docx';
import { parseMd } from './md.ts';

type Section = { heading: string; content: string | null };

/** Inline runs: **bold** and highlighted [[MISSING/COUNSEL]] markers. */
function runs(text: string): TextRun[] {
  const out: TextRun[] = [];
  const re = /(\*\*(.+?)\*\*)|(\[\[(MISSING|COUNSEL):\s*(.+?)\]\])/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(new TextRun(text.slice(last, m.index)));
    if (m[1]) out.push(new TextRun({ text: m[2], bold: true }));
    else out.push(new TextRun({ text: `[${m[4] === 'MISSING' ? 'MISSING' : 'COUNSEL'}: ${m[5]}]`, bold: true, highlight: m[4] === 'MISSING' ? 'yellow' : 'cyan' }));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(new TextRun(text.slice(last)));
  return out;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };

function blocks(content: string, numberingRef: { n: number }) {
  const out: (Paragraph | Table)[] = [];
  for (const b of parseMd(content)) {
    if (b.type === 'h') out.push(new Paragraph({ heading: b.level <= 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: runs(b.text) }));
    else if (b.type === 'p') out.push(new Paragraph({ children: runs(b.text), spacing: { after: 160 } }));
    else if (b.type === 'ul') b.items.forEach((it) => out.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: runs(it) })));
    else if (b.type === 'ol') {
      const instance = numberingRef.n++;
      b.items.forEach((it) => out.push(new Paragraph({ numbering: { reference: 'numbers', level: 0, instance }, children: runs(it) })));
    } else if (b.type === 'table' && b.rows.length) {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const width = Math.floor(9360 / cols);
      out.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: Array(cols).fill(width),
        rows: b.rows.map((r, ri) => new TableRow({
          children: Array.from({ length: cols }, (_, ci) => new TableCell({
            width: { size: width, type: WidthType.DXA },
            borders: { top: border, bottom: border, left: border, right: border },
            shading: ri === 0 ? { fill: 'E8ECF2', type: ShadingType.CLEAR, color: 'auto' } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({ children: ri === 0 ? [new TextRun({ text: r[ci] ?? '', bold: true })] : runs(r[ci] ?? '') })],
          })),
        })),
      }));
      out.push(new Paragraph({ children: [] }));
    }
  }
  return out;
}

export async function draftToDocx(opts: { title: string; fundName: string; version: number; status: string; approvedBy?: string | null; approvedAt?: string | null; sections: Section[] }) {
  const banner = opts.status === 'approved'
    ? `Version ${opts.version} · counsel approval recorded (${opts.approvedBy}, ${opts.approvedAt ? new Date(opts.approvedAt).toLocaleDateString('en-US') : ''})`
    : `DRAFT v${opts.version} for counsel review. Not legal advice. Not for distribution.`;
  const numberingRef = { n: 1 };

  const body: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(opts.fundName)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: opts.title, size: 32, bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: banner, italics: true, color: opts.status === 'approved' ? '1E7B4F' : 'B3261E' })] }),
  ];
  for (const s of opts.sections) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: body.length > 3, children: [new TextRun(s.heading)] }));
    body.push(...(s.content?.trim() ? blocks(s.content, numberingRef) : [new Paragraph({ children: [new TextRun({ text: '[Section not drafted yet]', italics: true, highlight: 'yellow' })] })]));
  }

  const doc = new Document({
    creator: 'VCG FundOS',
    title: `${opts.fundName}: ${opts.title} v${opts.version}`,
    styles: {
      default: { document: { run: { font: 'Times New Roman', size: 23 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: 'Times New Roman' }, paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: 'Times New Roman' }, paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, italics: true, font: 'Times New Roman' }, paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: banner, size: 16, color: '888888' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT], size: 18, color: '888888' })] })] }) },
      children: body,
    }],
  });
  return Packer.toBuffer(doc);
}
