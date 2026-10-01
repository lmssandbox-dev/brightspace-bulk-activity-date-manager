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
  const required = [...fields, 'CustomInstructions', 'Availability', 'Assessment'];
  if (supportsLeVersion('1.98')) required.push('SubmissionRule');
  if (required.some(key => !Object.hasOwn(current, key) || current[key] === undefined)) {
    throw fail('INCOMPLETE_NATIVE_DATA', 'Required Assignment settings are missing; no update was sent.');
  }
  if (typeof current.Name !== 'string' || typeof current.DisplayInCalendar !== 'boolean' ||
      typeof current.AllowOnlyUsersWithSpecialAccess !== 'boolean') {
    throw fail('INCOMPLETE_NATIVE_DATA', 'Assignment settings are unavailable or invalid; check service-user permissions.');
  }
  const availability = current.Availability;
  if (!availability || ['StartDateAvailabilityType','EndDateAvailabilityType'].some(key =>
    ![0,1,2,'0','1','2'].includes(availability[key]))) {
    throw fail('UNKNOWN_AVAILABILITY', 'Existing availability types are required; defaults will not be guessed.');
  }
  const rich = current.CustomInstructions;
  let instructions;
  if (typeof rich?.Html === 'string') instructions = { Content: rich.Html, Type: 'Html' };
  else if (typeof rich?.Text === 'string') instructions = { Content: rich.Text, Type: 'Text' };
  else throw fail('INCOMPLETE_NATIVE_DATA', 'Assignment instructions could not be preserved.');
  if (current.Assessment !== null && (!current.Assessment || !Object.hasOwn(current.Assessment, 'ScoreDenominator'))) {
    throw fail('INCOMPLETE_NATIVE_DATA', 'Assignment assessment settings could not be preserved.');
  }
  const payload = Object.fromEntries(fields.map(key => [key, structuredClone(current[key])]));
  payload.CustomInstructions = instructions;
  payload.Assessment = current.Assessment === null ? null : { ScoreDenominator: current.Assessment.ScoreDenominator };
  payload.Availability = { StartDate: dates.start, EndDate: dates.end,
    StartDateAvailabilityType: availability.StartDateAvailabilityType,
    EndDateAvailabilityType: availability.EndDateAvailabilityType };
  payload.DueDate = dates.due;
  if (supportsLeVersion('1.98')) payload.SubmissionRule = current.SubmissionRule;
  return payload;
}
function preservedSettings(payload) {
  const result = structuredClone(payload);
  delete result.DueDate; delete result.Availability.StartDate; delete result.Availability.EndDate;
  // Brightspace may serialize enums as numbers or decimal strings.
  for (const key of ['DropboxType','SubmissionType','CompletionType','SubmissionRule']) {
    if (result[key] != null) result[key] = String(result[key]);
  }
  for (const key of ['StartDateAvailabilityType','EndDateAvailabilityType']) result.Availability[key] = String(result.Availability[key]);
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
      if (!isDeepStrictEqual(preservedSettings(payload), preservedSettings(afterPayload))) {
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
        message: known ? error.message : 'Assignment operation failed; check configuration, permissions and API connectivity.',
        ...(Number.isInteger(error.status) ? { httpStatus: error.status } : {}) };
      return result;
    }
  } };
}
module.exports = { createAssignmentWriter, buildAssignmentPayload, validateDates };
