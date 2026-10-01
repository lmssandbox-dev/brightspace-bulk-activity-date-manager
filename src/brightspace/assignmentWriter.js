'use strict';
const { isDeepStrictEqual } = require('node:util');
const { id } = require('./id');
const { normalizeAssignment, normalizeInstant } = require('./activities/normalizers');

const fields = ['CategoryId', 'Name', 'GroupTypeId', 'DisplayInCalendar', 'NotificationEmail',
  'IsHidden', 'IsAnonymous', 'DropboxType', 'SubmissionType', 'CompletionType', 'GradeItemId',
  'AllowOnlyUsersWithSpecialAccess'];
const fail = (code, message) => Object.assign(new Error(message), { code });
// Fixed-width fractions retain sub-millisecond ordering and equality.
const instantKey = value => value === null ? null : value.replace(/\.(\d+)Z$/, (_, fraction) => `.${fraction.padEnd(9, '0')}Z`);
function validateDates(dates) {
  if (!dates || Object.keys(dates).some(k => !['start','due','end'].includes(k))) throw fail('INVALID_DATES', 'Supply only start, due and end.');
  const result = {};
  for (const field of ['start','due','end']) {
    if (dates[field] == null) throw fail('INVALID_DATES', 'All three dates are required.');
    result[field] = normalizeInstant(dates[field], field);
  }
  if (instantKey(result.start) > instantKey(result.due) || instantKey(result.due) > instantKey(result.end)) {
    throw fail('INVALID_DATES', 'Dates must satisfy Start <= Due <= End.');
  }
  return result;
}
const sameDates = (a,b) => ['start','due','end'].every(key => instantKey(a[key]) === instantKey(b[key]));
function buildAssignmentPayload(current, dates, supportsLeVersion) {
  // These fields lack a documented omission-preserves-current guarantee.
  const required = ['CategoryId', 'Name', 'GroupTypeId', 'DisplayInCalendar',
    'NotificationEmail', 'CustomInstructions', 'Availability'];
  const missing = required.filter(key => !Object.hasOwn(current, key) || current[key] === undefined);
  if (missing.length) {
    throw Object.assign(fail('INCOMPLETE_NATIVE_DATA', `Required Assignment fields missing: ${missing.join(', ')}. No update was sent.`), { fields: missing });
  }
  if (typeof current.Name !== 'string' || typeof current.DisplayInCalendar !== 'boolean') {
    throw fail('INCOMPLETE_NATIVE_DATA', 'Assignment Name or DisplayInCalendar is invalid; no update was sent.');
  }
  const availability = current.Availability === null
    ? { StartDateAvailabilityType: null, EndDateAvailabilityType: null } : current.Availability;
  if (!availability || ['StartDateAvailabilityType','EndDateAvailabilityType'].some(key =>
    ![null,0,1,2,'0','1','2'].includes(availability[key]))) {
    throw fail('UNKNOWN_AVAILABILITY', 'Availability types must be null or a recognized value.');
  }
  const rich = current.CustomInstructions;
  let instructions;
  if (typeof rich?.Html === 'string') instructions = { Content: rich.Html, Type: 'Html' };
  else if (typeof rich?.Text === 'string') instructions = { Content: rich.Text, Type: 'Text' };
  else throw fail('INCOMPLETE_NATIVE_DATA', 'Assignment instructions could not be preserved.');
  // D2L documents omission/null as preserving these non-date settings.
  // Do not invent defaults when they are unavailable in the read response.
  const payload = Object.fromEntries(fields.filter(key => Object.hasOwn(current, key) && current[key] !== undefined)
    .map(key => [key, structuredClone(current[key])]));
  payload.CustomInstructions = instructions;
  if (current.Assessment?.ScoreDenominator != null) {
    payload.Assessment = { ScoreDenominator: current.Assessment.ScoreDenominator };
  }
  payload.Availability = { StartDate: dates.start, EndDate: dates.end,
    StartDateAvailabilityType: availability.StartDateAvailabilityType,
    EndDateAvailabilityType: availability.EndDateAvailabilityType };
  // Omitted unspecified types use the documented org-unit defaults.
  for (const key of ['StartDateAvailabilityType','EndDateAvailabilityType']) {
    if (payload.Availability[key] === null) delete payload.Availability[key];
  }
  payload.DueDate = dates.due;
  if (supportsLeVersion('1.98')) payload.SubmissionRule = current.SubmissionRule ?? null;
  return payload;
}
function preservedSettings(payload, requested = payload) {
  const result = structuredClone(payload);
  delete result.DueDate; delete result.Availability.StartDate; delete result.Availability.EndDate;
  // Brightspace may serialize enums as numbers or decimal strings.
  for (const key of ['DropboxType','SubmissionType','CompletionType','SubmissionRule']) {
    if (result[key] != null) result[key] = String(result[key]);
  }
  for (const key of ['StartDateAvailabilityType','EndDateAvailabilityType']) {
    if (!Object.hasOwn(requested.Availability, key)) delete result.Availability[key];
    else if (Object.hasOwn(result.Availability, key)) result.Availability[key] = String(result.Availability[key]);
  }
  return result;
}
function createAssignmentWriter({ api, put }) {
  return { async updateActivityDates({ orgUnitId, activity, dates, dryRun = false }) {
    const result = { courseOrgUnitId: null, activityKey: null, type: 'assignment', name: null,
      status: 'failed', requestedDates: null, verifiedDates: null, writeAttempted: false, error: null };
    let stage = 'validation';
    try {
      orgUnitId = id(orgUnitId);
      result.courseOrgUnitId = orgUnitId;
      const activityId = id(activity?.id);
      result.activityKey = `assignment:${orgUnitId}:${activityId}`;
      if (activity.type !== 'assignment' || (activity.orgUnitId != null && id(activity.orgUnitId) !== orgUnitId) ||
          (activity.key != null && activity.key !== result.activityKey)) throw fail('INVALID_IDENTITY', 'Assignment identity does not match the course.');
      result.requestedDates = validateDates(dates);
      if (instantKey(result.requestedDates.start) >= instantKey(result.requestedDates.end)) {
        throw fail('INVALID_DATES', 'Assignment Start must be earlier than End.');
      }
      const path = api.coursePath(orgUnitId, `dropbox/folders/${activityId}`);
      stage = 'read';
      const current = await api.read(path);
      if (id(current.Id) !== activityId) throw fail('INVALID_IDENTITY', 'API returned another Assignment.');
      const normalized = normalizeAssignment(current, orgUnitId);
      result.name = normalized.name;
      result.verifiedDates = normalized.dates;
      if (sameDates(normalized.dates, result.requestedDates)) return { ...result, status: 'unchanged' };
      const payload = buildAssignmentPayload(current, result.requestedDates, api.supportsLeVersion);
      if (dryRun) return { ...result, status: 'ready' };
      stage = 'write';
      result.writeAttempted = true;
      let writeError;
      try { await put(path, payload); } catch (error) { writeError = error; }
      // Always reconcile after a PUT, including uncertain network outcomes. Never retry blindly.
      stage = 'verification';
      result.verifiedDates = null;
      const after = await api.read(path);
      if (id(after.Id) !== activityId) throw fail('INVALID_IDENTITY', 'Verification returned another Assignment.');
      result.verifiedDates = normalizeAssignment(after, orgUnitId).dates;
      const afterPayload = buildAssignmentPayload(after, result.requestedDates, api.supportsLeVersion);
      if (!isDeepStrictEqual(preservedSettings(payload), preservedSettings(afterPayload, payload))) {
        throw fail('SETTINGS_CHANGED', 'Read-back found unrelated setting changes; inspect the Assignment before retrying.');
      }
      if (!sameDates(result.verifiedDates, result.requestedDates)) {
        if (writeError) { stage = 'write'; throw writeError; }
        throw fail('VERIFICATION_MISMATCH', 'Read-back dates do not match requested dates.');
      }
      return { ...result, status: 'updated', ...(writeError ? { reconciled: true } : {}) };
    } catch (error) {
      const allowed = ['INVALID_DATES','INVALID_DATE','INVALID_IDENTITY','INCOMPLETE_NATIVE_DATA','UNKNOWN_AVAILABILITY','SETTINGS_CHANGED','VERIFICATION_MISMATCH'];
      const known = allowed.includes(error.code);
      result.error = { category: known ? error.code : stage === 'validation' ? 'INVALID_INPUT' : 'API_FAILURE', stage,
        message: known ? error.message : error.status === 400
          ? 'Brightspace rejected the Assignment update (HTTP 400). See validation details below; the cause is not yet confirmed.'
          : 'Assignment operation failed; check configuration, permissions and API connectivity.',
        ...(known && Array.isArray(error.fields) ? { fields: error.fields } : {}),
        ...(Number.isInteger(error.status) ? { httpStatus: error.status } : {}),
        ...(error.status === 400 && Array.isArray(error.validation) ? { validation: error.validation } : {}) };
      return result;
    }
  } };
}
module.exports = { createAssignmentWriter, buildAssignmentPayload, validateDates };
