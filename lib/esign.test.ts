import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildSignedPacket, sha256 } from './esign.ts';

test('signed packet = original pages + certificate page, fingerprint stable', async () => {
  const t = await PDFDocument.create();
  t.addPage(); t.addPage(); t.addPage();
  const template = await t.save();
  const fp = sha256(template);
  assert.equal(fp, sha256(template));
  assert.match(fp, /^[0-9a-f]{64}$/);

  const packet = await buildSignedPacket(template, {
    fundName: 'VCG Veterans Housing Fund I', documentTitle: 'Subscription Agreement', templateSha256: fp,
    investorLegalName: 'Sample Family Trust B', signatureName: 'Jane Q. Investor', signerTitle: 'Trustee',
    signerEmail: 'b@example.com', amount: '$250,000.00', signedAtIso: '2026-10-23T14:00:00Z', ip: '203.0.113.5', userAgent: 'Mozilla/5.0 (Macintosh) — test',
  });
  const out = await PDFDocument.load(packet);
  assert.equal(out.getPageCount(), 4);
});
