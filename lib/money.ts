const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Postgres numeric arrives as a string or number; display only. */
export function fmtMoney(v: string | number | null | undefined, whole = false) {
  const n = Number(v ?? 0);
  return (whole ? usd0 : usd).format(n);
}

export function fmtPct(rate: string | number | null | undefined) {
  return `${(Number(rate ?? 0) * 100).toFixed(2).replace(/\.00$/, '')}%`;
}

/** Validates a user-entered amount and returns it as a decimal string for Postgres
 *  (strings keep numeric(18,2) exact; no float math touches money on the way in). */
export function parseAmount(input: FormDataEntryValue | null): string {
  const raw = String(input ?? '').replace(/[$,\s]/g, '');
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(raw)) throw new Error('Enter an amount like 50000 or 50000.00');
  if (Number(raw) <= 0) throw new Error('Amount must be greater than zero');
  return raw;
}

export function toCents(v: string | number): bigint {
  const [whole, frac = ''] = String(v).split('.');
  const sign = whole.startsWith('-') ? -1n : 1n;
  return sign * (BigInt(whole.replace('-', '')) * 100n + BigInt((frac + '00').slice(0, 2)));
}

export function fromCents(c: bigint): number {
  return Number(c) / 100;
}
