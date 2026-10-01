'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrightspaceGet } = require('../src/brightspace/client');

test('authenticated transport retains GET, bearer token, timeout and redirect safeguards', async () => {
  const calls = [];
  const get = createBrightspaceGet({
    baseUrl: 'https://tenant.example',
    oauth: { async getAccessToken() { return 'test-token'; } },
    http: async config => { calls.push(config); return { data: { Id: 123 } }; }
  });
  assert.deepEqual(await get('/d2l/api/le/1.90/999/content/modules/123'), { Id: 123 });
  assert.deepEqual(calls, [{
    timeout: 15000, maxRedirects: 0, method: 'GET',
    url: 'https://tenant.example/d2l/api/le/1.90/999/content/modules/123',
    headers: { Authorization: 'Bearer test-token' }
  }]);
});

test('authenticated transport rejects foreign origins and HTTP before accessing credentials', async () => {
  let calls = 0;
  const get = createBrightspaceGet({ baseUrl: 'https://tenant.example',
    oauth: { async getAccessToken() { calls++; } }, http: async () => { calls++; } });
  await assert.rejects(() => get('https://other.example/d2l/api/le/1.90/999/quizzes/'));
  await assert.rejects(() => get('http://tenant.example/d2l/api/le/1.90/999/quizzes/'));
  assert.equal(calls, 0);
});
