import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMd, mdToHtml } from './md.ts';
import { extractMarkers } from './markers.ts';

test('parses headings, lists, tables and paragraphs', () => {
  const b = parseMd('### Terms\n\nThe Fund will **target** returns.\n\n- one\n- two\n\n1. a\n2. b\n\n| Term | Value |\n|---|---|\n| Pref | 7% |');
  assert.deepEqual(b.map((x) => x.type), ['h', 'p', 'ul', 'ol', 'table']);
  assert.deepEqual((b[4] as { rows: string[][] }).rows, [['Term', 'Value'], ['Pref', '7%']]);
});

test('preview escapes HTML and highlights markers', () => {
  const html = mdToHtml('<script>x</script> fee is [[MISSING: fee basis]]');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<mark class="marker missing">Missing: fee basis</mark>'));
});

test('extracts missing and counsel markers once each', () => {
  const m = extractMarkers('a [[MISSING: GP name]] b [[COUNSEL: standard of care]] c [[MISSING: GP name]]');
  assert.deepEqual(m, ['Missing: GP name', 'Counsel: standard of care']);
});
