/** Every [[MISSING: …]] and [[COUNSEL: …]] item in a section, for the to-do list. */
export function extractMarkers(content: string) {
  const out = new Set<string>();
  for (const m of (content ?? '').matchAll(/\[\[(MISSING|COUNSEL):\s*([^\]]+?)\]\]/g)) {
    out.add(`${m[1] === 'MISSING' ? 'Missing' : 'Counsel'}: ${m[2].trim()}`);
  }
  return [...out];
}
