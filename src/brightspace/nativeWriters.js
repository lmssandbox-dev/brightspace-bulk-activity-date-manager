'use strict';
const { isDeepStrictEqual } = require('node:util');
const { id } = require('./id');
const { validateDates } = require('./assignmentWriter');
const { normalizeQuiz, normalizeDiscussionTopic } = require('./activities/normalizers');
const fail = (code,message,fields) => Object.assign(new Error(message),{code,fields});
function required(row,fields) {
  const missing=fields.filter(key=>!Object.hasOwn(row,key)||row[key]===undefined);
  if(missing.length) throw fail('INCOMPLETE_NATIVE_DATA',`Settings missing: ${missing.join(', ')}. No update was sent.`,missing);
}
function richText(value) {
  if(typeof value?.Html==='string') return {Content:value.Html,Type:'Html'};
  if(typeof value?.Text==='string') return {Content:value.Text,Type:'Text'};
  throw fail('INCOMPLETE_NATIVE_DATA','Rich text settings could not be preserved.');
}
const quizFields=['Name','IsActive','SortOrder','AutoExportToGrades','GradeItemId','IsAutoSetGraded',
  'DisplayInCalendar','LateSubmissionInfo','SubmissionTimeLimit','SubmissionGracePeriod','Password',
  'AllowHints','DisableRightClick','DisablePagerAndAlerts','NotificationEmail','CalcTypeId',
  'RestrictIPAddressRange','CategoryId','PreventMovingBackwards','Shuffle','AllowOnlyUsersWithSpecialAccess',
  'IsRetakeIncorrectOnly','PagingTypeId','IsSynchronous','DeductionPercentage','HideQuestionPoints'];
function buildQuizPayload(row,dates,supports) {
  const fields=[...quizFields];
  if(supports('1.92'))fields.push('IsSingleSession');
  if(supports('1.98'))fields.push('AnnotationToolsEnabled');
  required(row,[...fields,'AttemptsAllowed','Instructions','Description','Header','Footer']);
  const payload=Object.fromEntries(fields.map(key=>[key,structuredClone(row[key])]));
  for(const key of ['Instructions','Description','Header','Footer']) {
    if(typeof row[key]?.IsDisplayed!=='boolean')throw fail('INCOMPLETE_NATIVE_DATA',`${key}.IsDisplayed is unavailable.`);
    payload[key]={Text:richText(row[key].Text),IsDisplayed:row[key].IsDisplayed};
  }
  const attempts=row.AttemptsAllowed;
  if(typeof attempts?.IsUnlimited!=='boolean'||(!attempts.IsUnlimited&&(!Number.isInteger(attempts.NumberOfAttemptsAllowed)||attempts.NumberOfAttemptsAllowed<1||attempts.NumberOfAttemptsAllowed>10))) {
    throw fail('INCOMPLETE_NATIVE_DATA','Quiz attempt settings could not be preserved.');
  }
  for(const [key,fields] of [['LateSubmissionInfo',['LateSubmissionOption','LateLimitMinutes']],['SubmissionTimeLimit',['IsEnforced','ShowClock','TimeLimitValue']]]){
    if(!row[key]||typeof row[key]!=='object')throw fail('INCOMPLETE_NATIVE_DATA',`${key} is unavailable.`);
    required(row[key],fields);
    payload[key]=Object.fromEntries(fields.map(field=>[field,row[key][field]]));
  }
  payload.NumberOfAttemptsAllowed=attempts.IsUnlimited?null:attempts.NumberOfAttemptsAllowed;
  return {...payload,StartDate:dates.start,DueDate:dates.due,EndDate:dates.end};
}
const topicFields=['Name','AllowAnonymousPosts','IsHidden','UnlockStartDate','UnlockEndDate',
  'RequiresApproval','ScoreOutOf','IsAutoScore','IncludeNonScoredValues','ScoringType','IsLocked',
  'MustPostToParticipate','RatingType','DisplayInCalendar','DisplayUnlockDatesInCalendar','GroupTypeId',
  'StartDateAvailabilityType','EndDateAvailabilityType'];
function buildDiscussionTopicPayload(row,dates) {
  required(row,[...topicFields,'Description']);
  for(const key of ['StartDateAvailabilityType','EndDateAvailabilityType']) {
    if(![0,1,2,'0','1','2'].includes(row[key]))throw fail('UNKNOWN_AVAILABILITY','Discussion availability types are unknown; defaults will not be guessed.');
  }
  if(typeof row.DisplayInCalendar!=='boolean'||typeof row.DisplayUnlockDatesInCalendar!=='boolean') {
    throw fail('INCOMPLETE_NATIVE_DATA','Discussion calendar settings are unknown; no update was sent.');
  }
  const payload=Object.fromEntries(topicFields.map(key=>[key,structuredClone(row[key])]));
  return {...payload,Description:richText(row.Description),StartDate:dates.start,DueDate:dates.due,EndDate:dates.end};
}
const dateKey=value=>value===null?null:value.replace(/\.(\d+)Z$/,(_,f)=>`.${f.padEnd(9,'0')}Z`);
const equalDates=(a,b)=>['start','due','end'].every(key=>dateKey(a[key])===dateKey(b[key]));
function settings(payload) {
  const copy=structuredClone(payload);delete copy.StartDate;delete copy.DueDate;delete copy.EndDate;
  for(const key of ['ScoringType','RatingType','StartDateAvailabilityType','EndDateAvailabilityType'])if(copy[key]!=null)copy[key]=String(copy[key]);
  return copy;
}
function createNativeWriter({api,put,type}) {
  if(!['quiz','discussionTopic'].includes(type))throw new Error('Unsupported writer type');
  const topic=type==='discussionTopic', normalize=topic?normalizeDiscussionTopic:normalizeQuiz;
  const build=topic?buildDiscussionTopicPayload:buildQuizPayload;
  return { async updateActivityDates({orgUnitId,activity,dates,dryRun=false}) {
    const result={courseOrgUnitId:null,activityKey:null,type,name:null,status:'failed',requestedDates:null,verifiedDates:null,writeAttempted:false,error:null};
    let stage='validation';
    try {
      orgUnitId=id(orgUnitId);result.courseOrgUnitId=orgUnitId;
      const itemId=id(activity?.id), parentId=topic?id(activity?.parentId):null;
      result.activityKey=`${type}:${orgUnitId}:${itemId}`;
      if(activity.type!==type||(activity.orgUnitId!=null&&id(activity.orgUnitId)!==orgUnitId)||(activity.key!=null&&activity.key!==result.activityKey))throw fail('INVALID_IDENTITY','Activity identity does not match the requested course/type.');
      result.requestedDates=validateDates(dates);
      if(topic&&dateKey(result.requestedDates.start)>=dateKey(result.requestedDates.due))throw fail('INVALID_DATES','Discussion Topic Due must be later than Start.');
      const path=api.coursePath(orgUnitId,topic?`discussions/forums/${parentId}/topics/${itemId}`:`quizzes/${itemId}`);
      const check=row=>{if(id(row[topic?'TopicId':'QuizId'])!==itemId||(topic&&id(row.ForumId)!==parentId))throw fail('INVALID_IDENTITY','API returned an unexpected activity or parent forum.');};
      stage='read';const before=await api.read(path);check(before);
      const normalized=normalize(before,orgUnitId);result.name=normalized.name;result.verifiedDates=normalized.dates;
      if(equalDates(normalized.dates,result.requestedDates))return {...result,status:'unchanged'};
      const payload=build(before,result.requestedDates,api.supportsLeVersion);
      if(dryRun)return {...result,status:'ready'};
      stage='write';result.writeAttempted=true;
      let writeError;try{await put(path,payload);}catch(error){writeError=error;}
      stage='verification';result.verifiedDates=null;
      const after=await api.read(path);check(after);result.verifiedDates=normalize(after,orgUnitId).dates;
      const verified=build(after,result.requestedDates,api.supportsLeVersion);
      if(!isDeepStrictEqual(settings(payload),settings(verified)))throw fail('SETTINGS_CHANGED','Unrelated settings differ after the update; inspect the activity before retrying.');
      if(!equalDates(result.verifiedDates,result.requestedDates)){
        if(writeError){stage='write';throw writeError;}
        throw fail('VERIFICATION_MISMATCH','Read-back dates do not match the request.');
      }
      return {...result,status:'updated',...(writeError?{reconciled:true}:{})};
    }catch(error){
      const known=['INVALID_DATE','INVALID_DATES','INVALID_IDENTITY','INCOMPLETE_NATIVE_DATA','UNKNOWN_AVAILABILITY','SETTINGS_CHANGED','VERIFICATION_MISMATCH'].includes(error.code);
      result.error={category:known?error.code:stage==='validation'?'INVALID_INPUT':'API_FAILURE',stage,
        message:known?error.message:'Activity operation failed; check API configuration and Service User permissions.',
        ...(known&&error.fields?{fields:error.fields}:{}),...(Number.isInteger(error.status)?{httpStatus:error.status}:{})};
      return result;
    }
  }};
}
module.exports={createNativeWriter,buildQuizPayload,buildDiscussionTopicPayload};
