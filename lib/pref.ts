import { toCents } from './money.ts';

export type CapitalEvent = {
  kind: 'contribution' | 'distribution' | 'return_of_capital' | 'fee';
  amount: string | number;
  date: string; // YYYY-MM-DD
};

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * ESTIMATE of the simple (non-compounding) preferred return for one investor.
 *
 * Pref accrues daily on net invested capital (contributions minus returns of capital)
 * at `rate` per year on an actual/365 basis. Distributions are applied to accrued pref
 * first. Returns amounts in cents.
 *
 * This is a planning number for dashboards. The governing calculation is whatever the
 * PPM / operating agreement says, verified by the fund's accountant or administrator.
 * Pass events already netted for reversals.
 */
export function prefEstimate(events: CapitalEvent[], rate: number, asOf: string) {
  const sorted = [...events].filter((e) => e.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  let capital = 0n;
  let accruedMicro = 0; // fractional cents accumulate as float only within accrual, rounded at end
  let paid = 0n;
  let cursor: string | null = null;

  for (const e of sorted) {
    if (cursor) accruedMicro += Number(capital) * rate * (days(cursor, e.date) / 365);
    cursor = e.date;
    const amt = toCents(e.amount);
    if (e.kind === 'contribution') capital += amt;
    else if (e.kind === 'return_of_capital') capital -= amt;
    else if (e.kind === 'distribution') paid += amt;
  }
  if (cursor) accruedMicro += Number(capital) * rate * (days(cursor, asOf) / 365);

  const accrued = BigInt(Math.round(accruedMicro));
  const unpaid = accrued > paid ? accrued - paid : 0n;
  return { capital, accrued, paid, unpaid };
}
