import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFailure, createOpenAIRequest } from '../lib/openai.mjs';

test('quota details retain provider code and owner contacts without exposing credentials', () => {
  const error = apiFailure({ status: 429, code: 'insufficient_quota', message: 'Quota exceeded fake-secret sk-sampletoken /Users/name/private.json', model: 'test-model', apiKey: 'fake-secret' });
  assert.ok(error.publicMessage.includes('quota or billing'));
  assert.ok(error.publicMessage.includes('insufficient_quota'));
  assert.ok(error.publicMessage.includes('HTTP status: 429'));
  for (const contact of ['Adarsh Jatti', 'adarshjatti@gmail.com', '6361598124']) assert.ok(error.publicMessage.includes(contact));
  assert.ok(!error.publicMessage.includes('fake-secret'));
  assert.ok(!error.publicMessage.includes('sk-sampletoken'));
  assert.ok(!error.publicMessage.includes('/Users/name'));
});
test('rate limits, authentication, access, missing models and outages have distinct messages', () => {
  for (const [status, expected] of [[429, 'rate limit'], [401, 'key was rejected'], [403, 'denied access'], [404, 'unavailable'], [503, 'service error']]) {
    assert.ok(apiFailure({ status, message: 'Provider details', model: 'model' }).publicMessage.includes(expected));
  }
});
test('transport retains structured provider failure without retrying', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 429, json: async () => ({ error: { code: 'insufficient_quota', message: 'Please check your billing.' } }) }; };
  try {
    await assert.rejects(createOpenAIRequest('fake-key', () => {})({ model: 'model' }), error => error.isModelApiError && error.providerCode === 'insufficient_quota');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});
test('provider network failures become actionable public API failures', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('sensitive low-level data'); };
  try {
    await assert.rejects(createOpenAIRequest('fake-key', () => {})({ model: 'model' }), error => error.isModelApiError && error.providerCode === 'connection_error' && !error.publicMessage.includes('sensitive'));
  } finally { globalThis.fetch = previous; }
});
