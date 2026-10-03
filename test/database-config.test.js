const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseConfig } = require('../src/shared/database');

test('accepts only the dedicated database and preserves connection options', () => {
  const uri = 'mongodb+srv://user:password@cluster.example/brightspace_source_courses_tools?retryWrites=true&w=majority&authSource=admin';
  assert.deepEqual(databaseConfig(uri), { url: uri });
});

test('rejects existing databases, implicit defaults and query overrides without leaking credentials', () => {
  for (const path of ['brightspace_source_courses_tool', 'brightspace_activity_date_manager', 'lti-db', 'admin', 'local', 'sample_mflix', '', 'brightspace_source_courses_tools?dbName=lti-db']) {
    assert.throws(() => databaseConfig(`mongodb+srv://user:SECRET@cluster.example/${path}`), error => {
      assert.ok(!error.message.includes('SECRET'));
      return true;
    });
  }
  assert.throws(() => databaseConfig('mongodb+srv://user:SECRET@cluster.example'));
});
