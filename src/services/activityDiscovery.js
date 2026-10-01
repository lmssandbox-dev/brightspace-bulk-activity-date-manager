'use strict';
const { id } = require('../brightspace/id');
const { hasDates } = require('../brightspace/activities/normalizers');
const { apiWarning } = require('../brightspace/client');

function createActivityDiscovery({ assignments, quizzes, discussions }) {
  return { async discover(orgUnitId, { includeRaw = false, includeUndated = true } = {}) {
    orgUnitId = id(orgUnitId);
    const raw = includeRaw ? [] : undefined;
    const warnings = [], sources = {};
    let successfulReads = 0;
    async function attempt(source, read, collection = true) {
      try {
        const result = await read();
        successfulReads++;
        warnings.push(...result.warnings);
        sources[source] = { status: result.warnings.length ? 'partial' : 'complete' };
        return result;
      } catch (error) {
        // Authentication, throttling, transport outages and invalid org-unit
        // collection requests must not become a misleading partial success.
        if (error.fatal || (collection && [400, 404].includes(error.status))) throw error;
        warnings.push(apiWarning(source, error));
        sources[source] = { status: 'failed' };
        return null;
      }
    }
    const a = await attempt('assignments', () => assignments.getAssignments(orgUnitId, raw));
    const q = await attempt('quizzes', () => quizzes.getQuizzes(orgUnitId, raw));
    const f = await attempt('discussionForums', () => discussions.getDiscussionForums(orgUnitId, raw));
    const native = [...(a?.activities ?? []), ...(q?.activities ?? [])];
    for (const forumId of f?.forumIds ?? []) {
      const topics = await attempt(`discussionTopics:${forumId}`, () => discussions.getDiscussionTopics(orgUnitId, forumId, raw), false);
      native.push(...(topics?.activities ?? []));
    }
    if (!successfulReads) throw new Error('All discovery sources failed');
    const nativeByKey = new Map();
    for (const activity of native) {
      if (nativeByKey.has(activity.key)) warnings.push({ source: 'activities', code: 'DUPLICATE_IDENTITY',
        message: 'A native activity occurred more than once; the first record was retained.', details: { key: activity.key } });
      else nativeByKey.set(activity.key, activity);
    }
    const all = [...nativeByKey.values()];
    const activities = includeUndated ? all : all.filter(hasDates);
    return { schemaVersion: 3, orgUnitId, complete: Object.values(sources).every(s => s.status === 'complete') &&
        !warnings.some(w => w.code === 'DUPLICATE_IDENTITY'),
      sources, activities,
      counts: { allActivities: all.length, datedActivities: all.filter(hasDates).length, returnedActivities: activities.length },
      warnings, ...(includeRaw ? { raw } : {}) };
  } };
}
module.exports = { createActivityDiscovery };
