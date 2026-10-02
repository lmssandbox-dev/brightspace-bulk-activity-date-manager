'use strict';

const DATABASE_NAME = 'brightspace_activity_date_manager';

function databaseConfig(uri) {
  // Inspect only the database path; never include credentials in an error.
  const match = typeof uri === 'string' && uri.match(/^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^?#]*)(?:\?[^#]*)?$/);
  if (!match || match[1] !== DATABASE_NAME) {
    throw new Error(`MONGODB_URL must explicitly select /${DATABASE_NAME} before any ? options. Refusing to connect to another database.`);
  }
  const query = new URLSearchParams(uri.split('?')[1] || '');
  for (const name of query.keys()) {
    if (name.toLowerCase() === 'dbname') throw new Error('Remove dbName from MONGODB_URL query options; use the database path.');
  }
  return { url: uri };
}

module.exports = { databaseConfig };
