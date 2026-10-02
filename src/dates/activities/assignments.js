'use strict';
const { normalizeAssignment, normalizeRows } = require('./normalizers');
// Scope: dropbox:folders:read
function createAssignmentsClient({ list, coursePath }) {
  return { async getAssignments(orgUnitId, raw) {
    return normalizeRows(await list(coursePath(orgUnitId, 'dropbox/folders/'), raw), normalizeAssignment,
      orgUnitId, 'assignments', row => row.Id);
  } };
}
module.exports = { createAssignmentsClient };
