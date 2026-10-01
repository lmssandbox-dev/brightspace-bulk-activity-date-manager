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

const { hasScope } = require('../src/brightspace/client');
test('scope matching accepts explicit, wildcard and action-list permissions', () => {
  for (const scope of ['dropbox:folders:write','dropbox:folders:*','dropbox:*:*','dropbox:*:write',
    'dropbox:folders:read,write','quizzing:*:*  dropbox:*:*\ncontent:*:*','  dropbox:folders:write  ']) {
    assert.equal(hasScope(scope,'dropbox:folders:write'),true,scope);
  }
});
test('scope matching rejects read-only, unrelated, malformed and universal-looking grants', () => {
  for (const scope of [undefined,null,{},'', 'dropbox:folders:read','dropbox:folders:readonly','quizzing:*:*',
    'core:*:*','*:*:*','dropbox:folders:writeExtra','dropbox:folders:write,','dropbox:folders:*,read',
    'dropbox:folders:read, write','dropbox:folders:write:extra','dropbox:other:write']) {
    assert.equal(hasScope(scope,'dropbox:folders:write'),false,String(scope));
  }
  assert.equal(hasScope('dropbox:*:*','dropbox:folders:*'),false);
});
