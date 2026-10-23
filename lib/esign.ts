import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const ESIGN_CONSENT = `I agree to use electronic records and signatures for this subscription. I understand that my typed name below is my legal signature, with the same effect as signing by hand, and that I may request a paper copy from the fund manager. I can download a copy of what I sign.`;

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export type SignatureEvidence = {
  fundName: string;
  documentTitle: string;
  templateSha256: string;
  investorLegalName: string;
  signatureName: string;
  signerTitle?: string | null;
  signerEmail: string;
  amount: string;
  signedAtIso: string;
  ip: string;
  userAgent: string;
};

/** The exact template the investor signed, followed by a signature certificate page. */
export async function buildSignedPacket(template: Uint8Array, e: SignatureEvidence) {
  const src = await PDFDocument.load(template, { ignoreEncryption: false });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, src.getPageIndices());
  pages.forEach((p) => out.addPage(p));

  const page = out.addPage([612, 792]);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const sig = await out.embedFont(StandardFonts.TimesRomanItalic);
  const ink = rgb(0.08, 0.13, 0.24);
  const grey = rgb(0.36, 0.39, 0.46);
  let y = 730;

  const line = (label: string, value: string) => {
    page.drawText(label, { x: 60, y, size: 9, font: bold, color: grey });
    const wrapped = wrap(value, 70);
    wrapped.forEach((w, i) => page.drawText(w, { x: 200, y: y - i * 13, size: 10, font, color: ink }));
    y -= 13 * Math.max(1, wrapped.length) + 9;
  };

  page.drawText('Electronic Signature Certificate', { x: 60, y, size: 18, font: bold, color: ink });
  y -= 22;
  page.drawText(`${e.fundName}: ${e.documentTitle}`, { x: 60, y, size: 11, font, color: grey });
  y -= 36;

  page.drawText(e.signatureName, { x: 60, y, size: 26, font: sig, color: ink });
  y -= 8;
  page.drawLine({ start: { x: 60, y }, end: { x: 360, y }, thickness: 0.8, color: grey });
  y -= 14;
  page.drawText('Signature (typed by the signer)', { x: 60, y, size: 8, font, color: grey });
  y -= 32;

  line('Investor', e.investorLegalName);
  line('Signed by', `${e.signatureName}${e.signerTitle ? `, ${e.signerTitle}` : ''}`);
  line('Account email', e.signerEmail);
  line('Subscription amount', e.amount);
  line('Signed at (UTC)', new Date(e.signedAtIso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'));
  line('IP address', e.ip || 'not available');
  line('Device', e.userAgent || 'not available');
  line('Document fingerprint', `SHA-256 ${e.templateSha256}`);
  y -= 6;
  page.drawText('Consent to electronic signature (accepted by the signer)', { x: 60, y, size: 9, font: bold, color: grey });
  y -= 14;
  wrap(ESIGN_CONSENT, 95).forEach((w) => { page.drawText(w, { x: 60, y, size: 9, font, color: ink }); y -= 12; });
  y -= 10;
  wrap(
    'The pages before this certificate are the exact document presented to and signed by the signer. Its SHA-256 fingerprint above was computed at the moment of signing; any change to those pages would produce a different fingerprint. Signed in VCG FundOS after the signer authenticated with their own account.',
    95,
  ).forEach((w) => { page.drawText(w, { x: 60, y, size: 8, font, color: grey }); y -= 11; });

  out.setTitle(`${e.documentTitle} (signed by ${e.investorLegalName})`);
  out.setProducer('VCG FundOS');
  return out.save();
}

function wrap(text: string, max: number) {
  const words = text.replace(/[^\x20-\x7E]/g, ' ').split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.length ? lines : [''];
}
