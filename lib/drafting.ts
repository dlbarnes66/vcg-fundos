import { claude } from '@/lib/ai';
import type { DocSpec, SectionSpec } from '@/lib/doc-templates';
import { extractMarkers } from '@/lib/markers';
export { extractMarkers };

const SYSTEM = `You are a drafting assistant preparing a FIRST DRAFT of private fund documents for review by the fund's securities counsel. You are not giving legal advice and your output is not ready to use.

Rules, in priority order:
1. Use ONLY the fund facts provided. Never invent names, numbers, dates, entities, addresses, track records, prior performance, people's experience, or legal conclusions.
2. When the section needs a fact that is not provided, write the marker [[MISSING: short description of what is needed]] at that spot and keep drafting around it. Never guess or substitute "market standard" terms for economics (fees, preferred return, catch-up, carry, timing).
3. Do not choose or confirm a securities exemption, tax treatment, or regulatory status. If the exemption is provided, describe it as the intended exemption. Otherwise mark it missing.
4. Projections and targets are only stated as targets, with a plain statement that they are not guaranteed and may not be achieved.
5. Where a provision is a judgment call for counsel (standard of care, governing-law nuances, tax allocations), draft a reasonable placeholder and add [[COUNSEL: what they need to decide]].
6. Write in clear, professional legal-document English. Use defined terms consistently: "the Fund", "the General Partner", "the Manager", "Limited Partners", "Capital Commitment", "Capital Contribution".
7. Output only the body of the requested section in Markdown. Use ### for subheadings, numbered or bulleted lists and tables where helpful. Do not repeat the section heading. Do not add commentary before or after.`;

export async function draftSection(opts: { doc: DocSpec; section: SectionSpec; facts: string; unknown: string[]; priorHeadings: string[] }) {
  const prompt = `Document: ${opts.doc.title}
Purpose: ${opts.doc.purpose}
Sections in this document: ${opts.doc.sections.map((s) => s.heading).join('; ')}

Draft this section now: "${opts.section.heading}"
What it should cover: ${opts.section.brief}

FUND FACTS (the only facts you may use):
${opts.facts || '(none provided)'}

NOT PROVIDED (use [[MISSING: …]] if the section needs any of these): ${opts.unknown.join(', ') || 'none'}`;

  const { text, truncated } = await claude({ system: SYSTEM, content: [{ type: 'text', text: prompt }], maxTokens: 6000 });
  const content = text.trim() + (truncated ? '\n\n[[COUNSEL: This section was cut off by length. Regenerate or complete it.]]' : '');
  return { content, missing: extractMarkers(content) };
}

// ─────────── Consistency checker ───────────

export type Finding = {
  severity: 'conflict' | 'missing' | 'review';
  topic: string;
  where: string;
  says: string;
  expected: string;
  explanation: string;
};

const CHECK_SYSTEM = `You review private fund documents for INTERNAL CONSISTENCY. You are helping a fund manager prepare questions for their securities counsel. You do not give legal advice.

Compare:
(a) each document against the FUND RECORD (the terms the manager has recorded), and
(b) the documents against each other (for example, the PPM's description versus the LPA's operative terms).

Report only concrete, checkable issues:
- "conflict": two sources state different values or rules for the same thing (rates, minimums, fund size, term, waterfall order, catch-up, carry, fee basis, distribution frequency, entity names, exemption, eligibility, transfer rules, notice periods).
- "missing": a term in the fund record that a document should address but does not, or a placeholder or blank left in a document.
- "review": ambiguous or internally inconsistent wording within a single document that counsel should look at.

Quote the documents briefly and exactly in "says". In "expected", give what the other source says. Do not report style issues. Do not speculate about law. If you find nothing, return an empty list.

Respond with ONLY a JSON object, no prose and no code fences:
{"summary": "<two sentences>", "findings": [{"severity": "conflict|missing|review", "topic": "...", "where": "<document and section/page>", "says": "...", "expected": "...", "explanation": "..."}]}`;

export async function checkConsistency(opts: { facts: string; docs: { title: string; pdfBase64?: string; text?: string }[] }) {
  const content = [
    { type: 'text' as const, text: `FUND RECORD (as entered in FundOS):\n${opts.facts || '(no terms recorded)'}` },
    ...opts.docs.map((d) =>
      d.pdfBase64
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: d.pdfBase64 }, title: d.title }
        : { type: 'document' as const, source: { type: 'text' as const, media_type: 'text/plain' as const, data: d.text ?? '' }, title: d.title },
    ),
    { type: 'text' as const, text: `Check these ${opts.docs.length} document(s): ${opts.docs.map((d) => d.title).join('; ')}. Return the JSON object.` },
  ];
  const { text } = await claude({ system: CHECK_SYSTEM, content, maxTokens: 8000 });
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const parsed = JSON.parse(json) as { summary?: string; findings?: Finding[] };
    const findings = (parsed.findings ?? []).filter((f) => f && f.topic).map((f) => ({
      severity: (['conflict', 'missing', 'review'].includes(f.severity) ? f.severity : 'review') as Finding['severity'],
      topic: String(f.topic).slice(0, 200),
      where: String(f.where ?? '').slice(0, 300),
      says: String(f.says ?? '').slice(0, 1000),
      expected: String(f.expected ?? '').slice(0, 1000),
      explanation: String(f.explanation ?? '').slice(0, 1500),
    }));
    return { summary: String(parsed.summary ?? '').slice(0, 1000), findings };
  } catch {
    throw new Error('The checker returned an unreadable result. Try again; very long documents may need to be checked one at a time.');
  }
}
