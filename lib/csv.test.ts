import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from './csv.ts';

test('quotes, escapes and neutralises formulas', () => {
  const csv = toCsv([{ a: 'Smith, "Jr"', b: '=HYPERLINK("x")', c: 5, d: null, e: -3 }], [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D'], ['e', 'E']]);
  const line = csv.split('\r\n')[1];
  assert.equal(line, `"Smith, ""Jr""","'=HYPERLINK(""x"")",5,,-3`);
  assert.ok(csv.startsWith('﻿A,B,C,D,E'));
});
