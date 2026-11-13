import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { normalizeTin, buildW9Pdf } from './w9.ts';

test('TIN validation and formatting', () => {
  assert.equal(normalizeTin('ssn', '123 45 6789'), '123-45-6789');
  assert.equal(normalizeTin('ein', '12-3456789'), '12-3456789');
  assert.throws(() => normalizeTin('ssn', '000-12-3456'));
  assert.throws(() => normalizeTin('ssn', '912-12-3456'));
  assert.throws(() => normalizeTin('ssn', '123-00-4567'));
  assert.throws(() => normalizeTin('ein', '07-1234567'));
  assert.throws(() => normalizeTin('ssn', '12345'));
});

test('builds a one-page substitute W-9 and rejects bad input', async () => {
  const base = {
    name: 'Jane Q. Investor', taxClass: 'individual', address: '1 Main St', cityStateZip: 'Mobile, AL 36602',
    tinType: 'ssn' as const, tin: '123456789', backupWithholdingNotified: true, requester: 'VCG Veterans Housing Fund I, LP',
  };
  const { bytes, tinLast4 } = await buildW9Pdf(base, { signatureName: 'Jane Q. Investor', signedAtIso: '2026-11-13T15:00:00Z' });
  assert.equal(tinLast4, '6789');
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  await assert.rejects(buildW9Pdf({ ...base, taxClass: 'nope' }, { signatureName: 'x', signedAtIso: '2026-11-13T15:00:00Z' }));
  await assert.rejects(buildW9Pdf({ ...base, taxClass: 'other', otherClass: '' }, { signatureName: 'x', signedAtIso: '2026-11-13T15:00:00Z' }));
});
