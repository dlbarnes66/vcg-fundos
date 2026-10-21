import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefEstimate } from './pref.ts';
import { toCents, parseAmount } from './money.ts';

test('one year at 7% on $100,000 accrues $7,000', () => {
  const r = prefEstimate([{ kind: 'contribution', amount: '100000', date: '2025-01-01' }], 0.07, '2026-01-01');
  assert.equal(r.accrued, 700000n);
  assert.equal(r.unpaid, 700000n);
});

test('distributions pay down accrued pref first', () => {
  const r = prefEstimate(
    [
      { kind: 'contribution', amount: '100000', date: '2025-01-01' },
      { kind: 'distribution', amount: '1750', date: '2025-04-01' },
    ],
    0.07,
    '2026-01-01',
  );
  assert.equal(r.paid, 175000n);
  assert.equal(r.unpaid, 700000n - 175000n);
});

test('return of capital reduces the accrual base', () => {
  const r = prefEstimate(
    [
      { kind: 'contribution', amount: '100000', date: '2025-01-01' },
      { kind: 'return_of_capital', amount: '50000', date: '2025-07-02' },
    ],
    0.07,
    '2026-01-01',
  );
  // 182 days on 100k + 183 days on 50k
  const expected = Math.round(10_000_000 * 0.07 * 182 / 365 + 5_000_000 * 0.07 * 183 / 365);
  assert.equal(r.accrued, BigInt(expected));
  assert.equal(r.capital, 5_000_000n);
});

test('future-dated events are ignored', () => {
  const r = prefEstimate([{ kind: 'contribution', amount: '100000', date: '2030-01-01' }], 0.07, '2026-01-01');
  assert.equal(r.accrued, 0n);
});

test('money helpers', () => {
  assert.equal(toCents('50000.5'), 5000050n);
  assert.equal(toCents('12.34'), 1234n);
  assert.equal(parseAmount('$50,000.00'), '50000.00');
  assert.throws(() => parseAmount('-5'));
  assert.throws(() => parseAmount('1.234'));
});
