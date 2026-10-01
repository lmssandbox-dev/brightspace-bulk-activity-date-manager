'use strict';
// Explicit single-Assignment operator tool. No frontend route or bulk execution.
const { id } = require('../src/brightspace/id');
const { createBrightspaceAuth } = require('../src/brightspace/auth');
const { createBrightspaceClient, createBrightspaceGet, createAssignmentPut, hasScope } = require('../src/brightspace/client');
const { createAssignmentWriter, validateDates } = require('../src/brightspace/assignmentWriter');
async function main() {
  const args = process.argv.slice(2);
  if (![5,6].includes(args.length) || (args[5] && args[5] !== '--apply')) throw new Error('usage');
  const orgUnitId=id(args[0]), assignmentId=id(args[1]);
  const dates=validateDates({start:args[2],due:args[3],end:args[4]});
  require('dotenv').config();
  const http=require('axios'), env=process.env;
  const leRoot=`${env.BS_URL}/d2l/api/le/${env.D2L_LE_VERSION}`;
  const apply=args[5]==='--apply';
  if (apply && !hasScope(env.D2L_OAUTH2_SCOPES, 'dropbox:folders:write')) throw new Error('scope');
  const oauth=createBrightspaceAuth({http,clientId:env.D2L_OAUTH2_CLIENT_ID,scope:env.D2L_OAUTH2_SCOPES,
    kid:env.D2L_OAUTH2_KEY_ID,privateKeyPem:env.D2L_OAUTH2_PRIVATE_KEY,tokenEndpoint:env.D2L_OAUTH2_TOKEN_ENDPOINT});
  const api=createBrightspaceClient({leRoot,get:createBrightspaceGet({http,oauth,baseUrl:env.BS_URL})});
  const writer=createAssignmentWriter({api,put:createAssignmentPut({http,oauth,leRoot})});
  const result=await writer.updateActivityDates({orgUnitId,activity:{type:'assignment',id:assignmentId},dates,dryRun:!apply});
  console.log(JSON.stringify(result,null,2));
  if(result.status==='failed')process.exitCode=1;
}
main().catch(()=>{
  console.error('Could not start. Use npm run assignment:dates -- <courseId> <assignmentId> <startISO> <dueISO> <endISO> [--apply]. Configure OAuth environment; --apply requires dropbox:folders:write. Without --apply this is a dry run.');
  process.exitCode=1;
});
