import test from 'node:test';
import assert from 'node:assert/strict';
import { runOrganiser, sectionIds, buildSourceCatalog, prepareGuideForDisplay } from '../lib/organiser.mjs';
import { redactor } from '../lib/openai.mjs';

const url = 'https://developers.google.com/workspace/gmail/api/auth/scopes';
const report = { status: 'needs_review', identity: { product: 'Gmail', organization: 'Google' }, sources: [{ url, title: 'Scopes', cited: true }],
  warnings: ['Missing retrieval evidence.'], unresolved: ['approval_requirements'],
  validation: { guide_markdown: '# Gmail\nUse gmail.send only for sending. Approval duration is uncertain.',
    coverage: [{ requirement: 'approval_requirements', status: 'unknown' }], uncertainties: ['Approval duration unknown.'], corrections: ['Fixed scope.'], removed_details: ['Removed Google Play.'],
    source_reviews: [{ url, official: true, applicable: true, current: true, explanation: 'Official Gmail reference.' }] } };
function content() {
  return { title: 'Connect Gmail', subtitle: 'Configure OAuth for Gmail', metrics: [{ label: 'Approval', value: 'Not established', note: 'Depends on scope', source_ids: ['source-1'] }],
    sections: sectionIds.map(id => ({ id, title: id, introduction: 'Based on the supplied report.', paragraphs: [{ text: 'Use gmail.send only for sending.', source_ids: ['source-1'] }], checklist: [], steps: [], tables: [], details: [] })) };
}
const response = value => ({ status: 'completed', usage: { input_tokens: 100, output_tokens: 200 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
test('organiser uses one no-tool request, preserves prompt, uncertainty, audit and original text', async () => {
  const calls = [];
  const result = await runOrganiser({ report, prompt: 'How can users connect Gmail?', request: async body => { calls.push(body); return response(content()); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gpt-5.4-mini');
  assert.equal(calls[0].tools, undefined);
  assert.equal(calls[0].text.format.strict, true);
  assert.equal(result.original_prompt, 'How can users connect Gmail?');
  assert.equal(result.verification.status, 'needs_review');
  assert.deepEqual(result.verification.uncertainties, report.validation.uncertainties);
  assert.deepEqual(result.verification.warnings, report.warnings);
  assert.equal(result.original_validated_markdown, report.validation.guide_markdown);
});
test('invalid saved report or missing original prompt makes no model call', async () => {
  let calls = 0;
  const request = async () => { calls++; };
  await assert.rejects(runOrganiser({ report: {}, prompt: 'Gmail', request }), /validation.json/);
  await assert.rejects(runOrganiser({ report, request }), /prompt is required/);
  assert.equal(calls, 0);
});
test('invented source IDs are rejected', async () => {
  const value = content(); value.metrics[0].source_ids = ['made-up'];
  await assert.rejects(runOrganiser({ report, prompt: 'Gmail', request: async () => response(value) }), /invented a source/);
});
test('missing sections, malformed values and inconsistent tables are rejected', async () => {
  const values = [content(), content(), content()];
  values[0].sections.pop();
  values[1].sections[0].paragraphs = 'invalid';
  values[2].sections[0].tables.push({ title: 'Cases', columns: ['Case', 'Action'], rows: [{ cells: ['Internal'], source_ids: [] }] });
  for (const value of values) await assert.rejects(runOrganiser({ report, prompt: 'Gmail', request: async () => response(value) }));
});
test('new URLs and forbidden social URLs cannot enter output', async () => {
  for (const newUrl of ['https://example.com/invented', 'https://reddit.com/thread']) {
    const value = content(); value.subtitle = newUrl;
    await assert.rejects(runOrganiser({ report, prompt: 'Gmail', request: async () => response(value) }), /introduced a URL/);
  }
});
test('unused search noise is excluded from formatting context', () => {
  const catalog = buildSourceCatalog({ ...report, sources: [...report.sources, { url: 'https://example.com/noise', cited: false }] });
  assert.equal(catalog.length, 1);
});
test('custom organiser model and token ceiling are passed through', async () => {
  let sent;
  await runOrganiser({ report, prompt: 'Gmail', model: 'gpt-4.1-mini', maxOutputTokens: 8000, request: async body => { sent = body; return response(content()); } });
  assert.equal(sent.model, 'gpt-4.1-mini'); assert.equal(sent.max_output_tokens, 8000); assert.equal(sent.reasoning, undefined);
});
test('redaction hides exact API key and common secret patterns', () => {
  assert.equal(redactor('fake-private-key')('error fake-private-key sk-testsecret'), 'error [REDACTED] [REDACTED]');
});
test('display text gets readable labels and links while source IDs remain internal', () => {
  const value = content();
  value.sections[0].tables.push({ title: 'Sources', columns: ['Source ids'], rows: [{ cells: ['source-1'], source_ids: ['source-1'] }] });
  const guide = prepareGuideForDisplay({ content: value, sources: buildSourceCatalog(report), verification: {} }, report);
  assert.equal(guide.content.sections[0].tables[0].rows[0].cells[0], 'Scopes');
  assert.deepEqual(guide.content.sections[0].tables[0].rows[0].source_links[0].url, url);
  assert.deepEqual(guide.content.sections[0].tables[0].rows[0].source_ids, ['source-1']);
  assert.equal(guide.raw_organiser_content.sections[0].tables[0].rows[0].cells[0], 'source-1');
});
test('saved page opens and equivalent tracking URLs resolve provenance without inventing retrieval', () => {
  const policy = 'https://developers.google.com/terms/api-services-user-data-policy';
  const sources = [{ id: 'source-1', title: 'Policy', url: policy }, { id: 'source-2', title: 'Unretrieved', url: 'https://support.google.com/cloud/answer/999' }];
  const reportWithOpens = { ...report, sources: [], validator_rounds: [{ searches: [{ status: 'completed', action: { type: 'open_page', url: policy + '?recordId=tracking' } }] }] };
  const guide = prepareGuideForDisplay({ content: content(), sources, verification: {} }, reportWithOpens);
  assert.equal(guide.sources[0].retrieved, true);
  assert.equal(guide.sources[1].retrieved, false);
  assert.equal(guide.verification.provenance_issues.length, 1);
});
