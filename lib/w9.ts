import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Substitute Form W-9 completed and signed electronically in the investor portal.
 *
 * Built to the IRS "Instructions for the Requester of Form W-9": same information as the
 * paper form, the four certifications under penalties of perjury, a final electronic
 * signature, and a printable copy. The TIN only ever lives inside this PDF (stored privately);
 * it is never written to the database.
 */

export const TAX_CLASSES: [string, string][] = [
  ['individual', 'Individual/sole proprietor'],
  ['c_corp', 'C corporation'],
  ['s_corp', 'S corporation'],
  ['partnership', 'Partnership'],
  ['trust_estate', 'Trust/estate'],
  ['llc_c', 'LLC taxed as C corporation'],
  ['llc_s', 'LLC taxed as S corporation'],
  ['llc_p', 'LLC taxed as partnership'],
  ['other', 'Other'],
];

export const W9_CERTIFICATIONS = [
  'The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and',
  'I am not subject to backup withholding because (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and',
  'I am a U.S. citizen or other U.S. person (defined in the instructions); and',
  'The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.',
];

export const W9_IRS_CONSENT_NOTE =
  'The Internal Revenue Service does not require your consent to any provision of this document other than the certifications required to avoid backup withholding.';

export type W9Input = {
  name: string;
  businessName?: string | null;
  taxClass: string;
  otherClass?: string | null;
  foreignPartners?: boolean;
  exemptPayeeCode?: string | null;
  fatcaCode?: string | null;
  address: string;
  cityStateZip: string;
  tinType: 'ssn' | 'ein';
  tin: string;
  backupWithholdingNotified: boolean; // if true, certification 2 is struck
  requester: string;
};

/** Returns the TIN formatted, or throws a readable error. */
export function normalizeTin(type: 'ssn' | 'ein', raw: string) {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 9) throw new Error(`Enter a 9-digit ${type === 'ssn' ? 'Social Security number' : 'EIN'}`);
  if (type === 'ssn') {
    const [a, g, s] = [d.slice(0, 3), d.slice(3, 5), d.slice(5)];
    if (a === '000' || a === '666' || a[0] === '9' || g === '00' || s === '0000') throw new Error('That Social Security number is not valid');
    return `${a}-${g}-${s}`;
  }
  if (/^(00|07|08|09|17|18|19|28|29|49|69|70|78|79|89|96|97)/.test(d)) throw new Error('That EIN prefix is not valid');
  return `${d.slice(0, 2)}-${d.slice(2)}`;
}

export function validateW9(i: W9Input) {
  if (i.name.trim().length < 2) throw new Error('Line 1: enter the name on your tax return');
  if (!TAX_CLASSES.some(([k]) => k === i.taxClass)) throw new Error('Line 3a: choose a federal tax classification');
  if (i.taxClass === 'other' && !i.otherClass?.trim()) throw new Error('Line 3a: describe the "Other" classification');
  if (i.address.trim().length < 3 || i.cityStateZip.trim().length < 5) throw new Error('Lines 5 and 6: enter your address');
  return { ...i, tin: normalizeTin(i.tinType, i.tin) };
}

const wrap = (text: string, font: PDFFont, size: number, max: number) => {
  const words = text.replace(/[^\x20-\x7E]/g, ' ').split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
};

export async function buildW9Pdf(input: W9Input, signer: { signatureName: string; signedAtIso: string }) {
  const i = validateW9(input);
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sig = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const ink = rgb(0.05, 0.08, 0.15);
  const grey = rgb(0.38, 0.4, 0.46);
  const L = 48, R = 564, W = R - L;
  let y = 744;

  const text = (p: PDFPage, s: string, x: number, yy: number, size = 9, f = font, color = ink) => p.drawText(s, { x, y: yy, size, font: f, color });
  const box = (label: string, value: string, h = 30) => {
    page.drawRectangle({ x: L, y: y - h, width: W, height: h, borderColor: grey, borderWidth: 0.6 });
    text(page, label, L + 5, y - 10, 7, font, grey);
    text(page, value || ' ', L + 5, y - 23, 10, bold);
    y -= h;
  };

  // Header
  text(page, 'Form W-9 (Substitute)', L, y, 16, bold);
  text(page, 'Request for Taxpayer Identification Number and Certification', L, y - 16, 10);
  text(page, 'Content substantially similar to IRS Form W-9 (Rev. March 2024). Completed and signed electronically.', L, y - 29, 7.5, font, grey);
  text(page, `Requester: ${i.requester}`, L, y - 41, 7.5, font, grey);
  y -= 54;

  box('1  Name of entity/individual (as shown on your income tax return)', i.name);
  box('2  Business name/disregarded entity name, if different from above', i.businessName ?? '');
  const cls = TAX_CLASSES.find(([k]) => k === i.taxClass)![1] + (i.taxClass === 'other' ? `: ${i.otherClass}` : '');
  box('3a  Federal tax classification', cls);
  box('3b  Partnership, trust or estate with foreign partners, owners or beneficiaries', i.foreignPartners ? 'Yes' : 'No', 26);
  box('4  Exemptions: exempt payee code (if any) / exemption from FATCA reporting code (if any)', `${i.exemptPayeeCode || 'None'} / ${i.fatcaCode || 'None'}`, 26);
  box('5  Address (number, street, and apt. or suite no.)', i.address);
  box('6  City, state, and ZIP code', i.cityStateZip);
  y -= 10;

  text(page, 'Part I  Taxpayer Identification Number (TIN)', L, y, 10, bold);
  y -= 6;
  box(i.tinType === 'ssn' ? 'Social security number' : 'Employer identification number', i.tin);
  y -= 12;

  // Part II certification, boxed and bold per the substitute-form rules
  text(page, 'Part II  Certification', L, y, 10, bold);
  y -= 8;
  const certLines: { s: string; strike: boolean }[] = [{ s: 'Under penalties of perjury, I certify that:', strike: false }];
  W9_CERTIFICATIONS.forEach((c, n) => {
    wrap(`${n + 1}. ${c}`, bold, 8.5, W - 16).forEach((ln) => certLines.push({ s: ln, strike: n === 1 && i.backupWithholdingNotified }));
  });
  const certH = certLines.length * 11.5 + 14;
  page.drawRectangle({ x: L, y: y - certH, width: W, height: certH, borderColor: ink, borderWidth: 1.2, color: rgb(0.97, 0.97, 0.99) });
  let cy = y - 14;
  for (const ln of certLines) {
    text(page, ln.s, L + 8, cy, 8.5, bold);
    if (ln.strike) page.drawLine({ start: { x: L + 8, y: cy + 3 }, end: { x: L + 8 + bold.widthOfTextAtSize(ln.s, 8.5), y: cy + 3 }, thickness: 0.8, color: rgb(0.7, 0.1, 0.1) });
    cy -= 11.5;
  }
  y -= certH + 10;
  if (i.backupWithholdingNotified) {
    text(page, 'Item 2 is crossed out: the payee indicated the IRS has notified them they are currently subject to backup withholding.', L, y, 7.5, font, rgb(0.7, 0.1, 0.1));
    y -= 12;
  }
  wrap(W9_IRS_CONSENT_NOTE, bold, 8, W).forEach((ln) => { text(page, ln, L, y, 8, bold); y -= 10; });
  y -= 14;

  // Signature
  text(page, 'Sign Here', L, y, 9, bold);
  text(page, signer.signatureName, L + 70, y - 2, 20, sig);
  page.drawLine({ start: { x: L + 66, y: y - 6 }, end: { x: L + 360, y: y - 6 }, thickness: 0.7, color: grey });
  text(page, 'Signature of U.S. person (electronic)', L + 70, y - 16, 7, font, grey);
  text(page, `Date: ${new Date(signer.signedAtIso).toISOString().slice(0, 10)}`, L + 380, y, 9);
  y -= 34;
  wrap('Signed electronically. The electronic signature certificate on the following page records the signer’s account, time, IP address, device, and a fingerprint of this page. A paper copy is available on request.', font, 7.5, W)
    .forEach((ln) => { text(page, ln, L, y, 7.5, font, grey); y -= 9.5; });

  doc.setTitle(`Form W-9 (Substitute): ${i.name}`);
  doc.setProducer('VCG FundOS');
  return { bytes: await doc.save(), tinLast4: i.tin.slice(-4) };
}
