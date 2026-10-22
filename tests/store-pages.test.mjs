import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../lib/store.mjs';
import { sectionIds } from '../lib/organiser.mjs';
import { createHandler } from '../lib/http.mjs';

function fixture() {
  return { product: 'Gmail', organization: 'Google', original_prompt: '<script>alert("prompt")</script>', verification: { status: 'needs_review', uncertainties: ['Architecture unspecified.'] },
    sources: [{ id: 'source-1', title: 'Google scopes', url: 'https://developers.google.com/workspace/gmail/api/auth/scopes' }],
    content: { title: 'Gmail setup', subtitle: 'Configure OAuth', metrics: [], sections: sectionIds.map(id => ({ id, title: id, introduction: '', paragraphs: [{ text: '<img src=x onerror=alert(1)> source-1', source_ids: ['source-1'] }], checklist: [], steps: [], tables: [], details: [] })) } };
}
function get(handler, url, method = 'GET') {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = body; } };
  handler({ method, url }, res); return res;
}
test('SQLite guide survives close/reopen and does not overwrite duplicate slugs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oauth-guide-'));
  let store;
  try {
    const path = join(dir, 'app.db'); store = openStore(path);
    const saved = store.insertGuide(fixture(), 'gmail-guide-456');
    assert.throws(() => store.insertGuide(fixture(), 'gmail-guide-456'), /UNIQUE/);
    store.close(); store = openStore(path);
    assert.equal(store.getGuide(saved.slug).guide.original_prompt, fixture().original_prompt);
    assert.equal(store.listGuides().length, 1);
    assert.equal(store.getGuide("' OR 1=1 --"), null);
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('generated slugs are unique and job foreign keys connect only to stored guides', () => {
  const store = openStore(':memory:');
  try {
    const a = store.insertGuide(fixture()), b = store.insertGuide(fixture());
    assert.notEqual(a.slug, b.slug);
    const job = store.createJob('Gmail');
    store.updateJob(job, { status: 'running', stage: 'validator' });
    assert.equal(store.getJob(job).stage, 'validator');
    const stageStart = store.getJob(job).stage_started_at;
    store.updateJobProgress(job, 'Validator repair round 2');
    assert.equal(store.getJob(job).progress_message, 'Validator repair round 2');
    assert.ok(store.getJob(job).heartbeat_at);
    assert.equal(store.getJob(job).stage_started_at, stageStart);
    assert.throws(() => store.updateJob(job, { status: 'completed', stage: 'completed', guide_id: 'missing' }), /FOREIGN KEY/);
    store.updateJob(job, { status: 'completed', stage: 'completed', guide_id: a.id });
    assert.equal(store.getJob(job).guide_id, a.id);
  } finally { store.close(); }
});
test('routes render saved guide with safe HTML, source links and new-tab library link', () => {
  const store = openStore(':memory:');
  try {
    store.insertGuide(fixture(), 'gmail-guide-456');
    const handler = createHandler(store, { '/assets/guide.css': { body: 'css', type: 'text/css' } });
    const page = get(handler, '/guides/gmail-guide-456');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('&lt;script&gt;'));
    assert.ok(!page.body.includes('<img src=x'));
    assert.ok(page.body.includes('https://developers.google.com/workspace/gmail/api/auth/scopes'));
    assert.ok(!page.body.includes('source-1'));
    assert.ok(page.body.includes('data-copy-link'));
    assert.ok(get(handler, '/').body.includes('target="_blank"'));
    assert.equal(get(handler, '/guides/missing').status, 404);
    assert.equal(get(handler, '/.env').status, 404);
    assert.equal(get(handler, '/assets/guide.css').status, 200);
    assert.equal(get(handler, '/', 'POST').status, 405);
    assert.equal(get(handler, '/', 'HEAD').body, undefined);
  } finally { store.close(); }
});
test('invalid guide structure and inconsistent source references are rejected before storage', () => {
  const store = openStore(':memory:');
  try {
    const a = fixture(); a.content.sections.pop(); assert.throws(() => store.insertGuide(a));
    const b = fixture(); b.content.sections[0].paragraphs[0].source_ids = ['made-up']; assert.throws(() => store.insertGuide(b));
    assert.equal(store.listGuides().length, 0);
  } finally { store.close(); }
});
