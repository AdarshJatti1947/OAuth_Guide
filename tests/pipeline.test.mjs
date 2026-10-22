import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, configuration, auditCoverage, forbiddenUrl, parseResponse, evidenceUrls } from '../lib/pipeline.mjs';
import { requirements } from '../lib/prompts.mjs';

const identity = { product: 'Gmail', organization: 'Google', environment: 'commercial', capability: 'read email', distribution: 'unspecified', identity_notes: 'Google owns Gmail; this is not Google Play.', excluded_products: ['Google Play'], official_domains: ['developers.google.com'], needs_clarification: false, clarification_question: '' };
const source = 'https://developers.google.com/gmail/api/auth/scopes';
function response(text, search = false) {
  return { status: 'completed', usage: { total_tokens: 100 }, output: [
    ...(search ? [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url: source }] } }] : []),
    { type: 'message', content: [{ type: 'output_text', text }] },
  ] };
}
function validation() {
  return { guide_markdown: `# Gmail\nSee [official scopes](${source}).`, corrections: ['Removed unrelated Google Play instructions.'], removed_details: [], uncertainties: [],
    source_reviews: [{ url: source, official: true, applicable: true, current: true, explanation: 'Official Gmail API reference; applies to requested permissions.' }],
    coverage: requirements.map(requirement => ({ requirement, status: 'supported', explanation: 'Documented.', evidence_urls: [source] })) };
}
test('three stages preserve full input, identity, research and evidence; validator can search', async () => {
  const calls = [];
  const files = new Map();
  const replies = [response(JSON.stringify(identity)), response('Gmail research dossier', true), response(JSON.stringify(validation()), true)];
  const prompt = 'What must I configure with Google before people connect Gmail to my assistant?';
  const result = await runPipeline({ prompt, config: configuration({}), request: async body => { calls.push(body); return replies.shift(); }, save: async (name, data) => files.set(name, data) });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].input, prompt);
  assert.equal(JSON.parse(calls[1].input).product_identity.product, 'Gmail');
  assert.equal(calls[1].model, calls[2].model);
  assert.equal(calls[2].tool_choice, 'required');
  assert.equal(JSON.parse(calls[2].input).research_dossier, 'Gmail research dossier');
  assert.equal(result.status, 'model_reviewed');
  assert.ok(files.has('guide.md'));
  assert.ok(files.has('research-evidence.json'));
});
test('ambiguous input stops before paid research stages', async () => {
  let count = 0;
  const result = await runPipeline({ prompt: 'Google', config: configuration({}), request: async () => { count++; return response(JSON.stringify({ ...identity, needs_clarification: true, clarification_question: 'Gmail or Google Play?' })); } });
  assert.equal(count, 1);
  assert.equal(result.status, 'needs_clarification');
});
test('missing requirements and invented evidence cannot silently pass audit', () => {
  const value = validation();
  value.coverage.pop();
  value.coverage[0].evidence_urls = ['https://example.com/invented'];
  const warnings = auditCoverage(value, [{ url: source }]);
  assert.ok(warnings.some(w => w.includes('exactly one')));
  assert.ok(warnings.some(w => w.includes('not found')));
});
test('unknown requirements remain needs_review', async () => {
  const value = validation();
  value.coverage[0].status = 'unknown';
  const replies = [response(JSON.stringify(identity)), response('Research', true), response(JSON.stringify(value), true)];
  const result = await runPipeline({ prompt: 'Gmail', config: configuration({ VALIDATOR_MAX_ROUNDS: '1' }), request: async () => replies.shift() });
  assert.equal(result.status, 'needs_review');
});
test('search failure stops pipeline and retains research draft', async () => {
  const files = [];
  const replies = [response(JSON.stringify(identity)), response('Unsupported draft')];
  await assert.rejects(runPipeline({ prompt: 'Gmail', config: configuration({}), request: async () => replies.shift(), save: async name => files.push(name) }), /no usable search evidence/);
  assert.ok(files.includes('research.md'));
});
test('blocked social sources excluded, official Meta developer docs allowed', () => {
  for (const url of ['https://reddit.com/a', 'https://old.reddit.com/a', 'https://facebook.com/post', 'https://www.facebook.com/post', 'javascript:alert(1)']) assert.equal(forbiddenUrl(url), true);
  assert.equal(forbiddenUrl('https://developers.facebook.com/docs/marketing-api'), false);
  const result = response('Answer', true);
  result.output[0].action.sources.push({ url: 'https://reddit.com/a' });
  assert.equal(parseResponse(result).sources.length, 1);
});
test('incomplete or refused responses do not progress', () => {
  assert.throws(() => parseResponse({ status: 'incomplete' }), /incomplete/);
  assert.throws(() => parseResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), /declined/);
});
test('configuration rejects invalid budgets and unsupported provider', () => {
  assert.throws(() => configuration({ RESEARCH_MAX_TOOL_CALLS: '0' }), /integer/);
  assert.throws(() => configuration({ AI_PROVIDER: 'gemini' }), /OpenAI only/);
});
test('validator researches missing requirements again and preserves earlier audit', async () => {
  const incomplete = validation();
  incomplete.coverage.find(c => c.requirement === 'approval_requirements').status = 'unknown';
  const replies = [response(JSON.stringify(identity)), response('Research', true), response(JSON.stringify(incomplete), true), response(JSON.stringify(validation()), true)];
  const calls = [];
  const files = new Map();
  const result = await runPipeline({ prompt: 'Gmail', config: configuration({}), request: async body => { calls.push(body); return replies.shift(); }, save: async (name, value) => files.set(name, value) });
  assert.equal(calls.length, 4);
  assert.equal(calls[2].model, calls[3].model);
  assert.equal(calls[3].tool_choice, 'required');
  assert.equal(JSON.parse(calls[3].input).unresolved_requirements[0].requirement, 'approval_requirements');
  assert.ok(files.has('validator-round-1.json'));
  assert.ok(files.has('validator-round-2.json'));
  assert.equal(result.status, 'model_reviewed');
});
test('retrieved third-party or sibling-product sources need positive applicability review', () => {
  const value = validation();
  value.source_reviews[0].official = false;
  assert.ok(auditCoverage(value, [{ url: source }]).some(w => w.includes('source review')));
  value.source_reviews[0].official = true;
  value.source_reviews[0].applicable = false;
  assert.ok(auditCoverage(value, [{ url: source }]).length);
});
test('validator cannot silently pass without performing its own search', async () => {
  const replies = [response(JSON.stringify(identity)), response('Research', true), response(JSON.stringify(validation()))];
  const result = await runPipeline({ prompt: 'Gmail', config: configuration({ VALIDATOR_MAX_ROUNDS: '1' }), request: async () => replies.shift() });
  assert.equal(result.status, 'needs_review');
  assert.ok(result.warnings.some(w => w.includes('independent')));
});
test('remaining uncertainty prevents complete-review status', async () => {
  const value = validation();
  value.uncertainties = ['Approval turnaround could not be verified.'];
  const replies = [response(JSON.stringify(identity)), response('Research', true), response(JSON.stringify(value), true)];
  const result = await runPipeline({ prompt: 'Gmail', config: configuration({ VALIDATOR_MAX_ROUNDS: '1' }), request: async () => replies.shift() });
  assert.equal(result.status, 'needs_review');
});
test('scope identifiers and code examples are not documentary citation URLs', () => {
  const guide = '# Guide\nUse `https://www.googleapis.com/auth/gmail.send`, not `https://mail.google.com/`.\n```text\nhttps://example.com/callback\n```\nSee [Scopes](https://developers.google.com/gmail/scopes).';
  assert.deepEqual(evidenceUrls(guide), ['https://developers.google.com/gmail/scopes']);
});
test('completed page-open actions count as retrieval evidence without search snippets', () => {
  const result = response('Answer');
  result.output.unshift({ type: 'web_search_call', status: 'completed', action: { type: 'open_page', url: source } });
  assert.equal(parseResponse(result).sources[0].url, source);
  result.output[0].status = 'failed';
  assert.equal(parseResponse(result).sources.length, 0);
});
test('known Google tracking variants match but unrelated page IDs do not', () => {
  const value = validation();
  const policy = 'https://developers.google.com/terms/api-services-user-data-policy';
  value.guide_markdown = `[Policy](${policy})`;
  value.source_reviews = [{ url: policy, official: true, applicable: true, current: true, explanation: 'Official policy.' }];
  value.coverage.forEach(c => { c.evidence_urls = [policy]; });
  assert.deepEqual(auditCoverage(value, [{ url: policy + '?recordId=tracking' }]), []);
  assert.ok(auditCoverage(value, [{ url: policy + '-different' }]).length);
});
