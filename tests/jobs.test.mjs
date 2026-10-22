import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/store.mjs';
import { createJobService } from '../lib/jobs.mjs';
import { createHandler } from '../lib/http.mjs';
import { requirements } from '../lib/prompts.mjs';
import { sectionIds } from '../lib/organiser.mjs';

const url = 'https://developers.google.com/workspace/gmail/api/auth/scopes';
const identity = { product: 'Gmail', organization: 'Google', environment: 'commercial', capability: 'read', distribution: 'unspecified', identity_notes: 'Gmail is a Google product.', excluded_products: ['Google Play'], official_domains: ['developers.google.com'], needs_clarification: false, clarification_question: '' };
const final = { guide_markdown: `# Gmail\n[Scopes](${url})`, corrections: [], removed_details: [], uncertainties: [],
  source_reviews: [{ url, official: true, applicable: true, current: true, explanation: 'Gmail scope documentation.' }],
  coverage: requirements.map(requirement => ({ requirement, status: 'supported', explanation: 'Documented.', evidence_urls: [url] })) };
const organised = { title: 'Gmail setup', subtitle: 'Connect Gmail', metrics: [], sections: sectionIds.map(id => ({ id, title: id, introduction: '', paragraphs: [{ text: 'Gmail OAuth setup.', source_ids: ['source-1'] }], checklist: [], steps: [], tables: [], details: [] })) };
function response(text, search = false) { return { status: 'completed', usage: {}, output: [...(search ? [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url }] } }] : []), { type: 'message', content: [{ type: 'output_text', text: typeof text === 'string' ? text : JSON.stringify(text) }] }] }; }
test('website job runs real four-stage orchestration and automatically stores a renderable guide', async () => {
  const store = openStore(':memory:'), dir = mkdtempSync(join(tmpdir(), 'oauth-jobs-'));
  try {
    const replies = [response(identity), response('Research dossier', true), response(final, true), response(organised)];
    const calls = [];
    const jobs = createJobService({ store, env: {}, artifactsRoot: dir, log: () => {}, request: async body => { calls.push(body); return replies.shift(); } });
    const id = jobs.submit('Help users connect Gmail');
    assert.equal(jobs.get(id).status, 'queued');
    await jobs.idle();
    assert.equal(calls.length, 4);
    assert.equal(calls[0].input, 'Help users connect Gmail');
    assert.equal(calls[3].model, 'gpt-5.4-mini');
    assert.ok(JSON.parse(calls[3].input).final_validation.guide_markdown.includes('# Gmail'));
    const job = jobs.get(id);
    assert.equal(job.status, 'completed');
    const row = store.getGuide(job.guide_url.split('/').at(-1));
    assert.equal(row.guide.original_prompt, 'Help users connect Gmail');
    assert.equal(store.listGuides().length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('clarification stops after analyser and publishes no guide', async () => {
  const store = openStore(':memory:'), dir = mkdtempSync(join(tmpdir(), 'oauth-jobs-'));
  try {
    let calls = 0;
    const jobs = createJobService({ store, env: {}, artifactsRoot: dir, log: () => {}, request: async () => { calls++; return response({ ...identity, needs_clarification: true, clarification_question: 'Gmail or Google Play?' }); } });
    const id = jobs.submit('Google'); await jobs.idle();
    assert.equal(calls, 1); assert.equal(jobs.get(id).status, 'needs_clarification');
    assert.equal(jobs.get(id).clarification, 'Gmail or Google Play?'); assert.equal(store.listGuides().length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('duplicate request identifiers reuse a job; conflicting prompts are rejected', async () => {
  const store = openStore(':memory:'), dir = mkdtempSync(join(tmpdir(), 'oauth-jobs-'));
  try {
    let calls = 0;
    const jobs = createJobService({ store, env: {}, artifactsRoot: dir, log: () => {}, request: async () => { calls++; throw new Error('fake failure'); } });
    const key = randomUUID(), id = jobs.submit('Gmail', key);
    assert.equal(jobs.submit('Gmail', key), id);
    assert.throws(() => jobs.submit('Slack', key), /different question/);
    await jobs.idle(); assert.equal(calls, 1); assert.equal(jobs.get(id).status, 'failed');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('restart interrupts pending jobs without automatically repeating paid work', () => {
  const store = openStore(':memory:');
  try {
    const id = store.createJob('Gmail');
    createJobService({ store, env: {}, log: () => {} });
    assert.equal(store.getJob(id).status, 'failed');
  } finally { store.close(); }
});
test('HTTP submission checks origin and JSON; status polling exposes completion link', async () => {
  const store = openStore(':memory:');
  try {
    let submitted = 0;
    const id = randomUUID();
    const handler = createHandler(store, {}, { enabled: true, submit: () => { submitted++; return id; }, get: () => ({ id, status: 'completed', guide_url: '/guides/gmail-example' }) });
    async function invoke(headers, body = '{}', method = 'POST', path = '/api/jobs') {
      const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(value) { this.body = value; } };
      await handler({ method, url: path, headers, async *[Symbol.asyncIterator]() { yield body; } }, res);
      return res;
    }
    const headers = { host: 'localhost:4174', origin: 'http://localhost:4174', 'content-type': 'application/json' };
    assert.equal((await invoke(headers, JSON.stringify({ prompt: 'Gmail', request_id: id }))).status, 202);
    assert.equal((await invoke({ ...headers, origin: 'https://other.example' })).status, 403);
    assert.equal((await invoke(headers, 'not json')).status, 400);
    assert.equal((await invoke(headers, 'x'.repeat(25000))).status, 413);
    assert.equal(submitted, 1);
    const polled = await invoke({}, '', 'GET', `/api/jobs/${id}`);
    assert.equal(JSON.parse(polled.body).guide_url, '/guides/gmail-example');
  } finally { store.close(); }
});
test('missing credentials reject submission without creating jobs', () => {
  const store = openStore(':memory:');
  try {
    const jobs = createJobService({ store, env: {} });
    assert.throws(() => jobs.submit('Gmail'), /not configured/);
    assert.equal(store.recentJobCount('2000'), 0);
  } finally { store.close(); }
});
