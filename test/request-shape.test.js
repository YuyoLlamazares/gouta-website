import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TWIN_TOKEN ||= 'shape-test';
process.env.TWIN_DB ||= '/tmp/twin-shape-test.db';

const { buildRequest } = await import('../server/claude.js');

const sample = () => buildRequest({
  system: 'You are the twin.',
  messages: [{ role: 'user', content: 'hello' }],
  effort: 'medium',
});

test('targets Opus 5', () => {
  assert.equal(sample().model, 'claude-opus-5');
});

test('sends no sampling parameters — Opus 5 rejects them outright', () => {
  const request = sample();
  for (const banned of ['temperature', 'top_p', 'top_k']) {
    assert.ok(!(banned in request), `${banned} must not be sent`);
  }
});

test('sends no budget_tokens — removed on Opus 5, returns 400', () => {
  const request = sample();
  assert.ok(!('thinking' in request) || !('budget_tokens' in (request.thinking ?? {})));
});

test('effort rides inside output_config, not top level', () => {
  const request = sample();
  assert.equal(request.output_config.effort, 'medium');
  assert.ok(!("effort" in request));
});

test('refusal fallbacks are on, with the matching beta header', () => {
  const request = sample();
  assert.equal(request.fallbacks, 'default');
  assert.ok(request.betas.includes('server-side-fallback-2026-07-01'));
});

test('the system prompt is a cacheable block', () => {
  const [block] = sample().system;
  assert.equal(block.type, 'text');
  assert.deepEqual(block.cache_control, { type: 'ephemeral' });
});

test('tools are omitted entirely when there are none', () => {
  assert.ok(!('tools' in sample()));
});

// A strict tool whose schema omits a property from `required`, or allows extra
// properties, is rejected by the API — so the shape is worth asserting directly.
test('the triage tool schema satisfies strict-mode rules', async () => {
  const { TRIAGE_SCHEMA } = await import('../server/twin/schema.js');
  let objectsChecked = 0;

  const walk = (node, path = '$') => {
    if (node?.type === 'object') {
      objectsChecked += 1;
      assert.equal(node.additionalProperties, false, `${path} must set additionalProperties:false`);
      assert.deepEqual(
        [...(node.required ?? [])].sort(),
        Object.keys(node.properties ?? {}).sort(),
        `${path} must list every property in required`,
      );
      for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${path}.${key}`);
    }
    if (node?.type === 'array') walk(node.items, `${path}[]`);
  };

  walk(TRIAGE_SCHEMA);
  assert.equal(objectsChecked, 4, 'expected the root plus memory, task and proposal items');
});
