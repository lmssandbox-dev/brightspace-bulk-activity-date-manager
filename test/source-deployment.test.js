'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSourceDeploymentClient}=require('../src/brightspace/sourceDeployment');
const {createDeploymentJobs,parseDeploymentCsv}=require('../src/services/deploymentJobs');
function client(options={}){const calls=[];return {calls,api:createSourceDeploymentClient({baseUrl:'https://tenant.example',lpVersion:options.version||'1.53',oauth:{getAccessToken:async()=>{if(options.authFail)throw Error('SECRET');return 'SECRET';}},api:{read:async url=>{calls.push({url});if(url.includes('reofferedCourses'))return {ReofferedCourses:[]};return {Identifier:url.split('/').at(-1),Name:'Course',Code:'C',IsActive:options.active??false};}},http:async config=>{calls.push(config);if(options.error)throw options.error;return options.response||{status:200,data:123};}})};}
test('deployment CSV groups repeated sources, preserves IDs and rejects conflicting replica mappings',()=>{
 const rows=parseDeploymentCsv('SourceOrgUnitId,ReplicaOrgUnitId\n10,20\n10,21\n10,20\n11,20\n30,30\n,\n40,50\n50,60');
 assert.deepEqual(rows.map(r=>r.status),['invalid','pending','duplicate','invalid','invalid','ignored','invalid','pending']);
 assert.equal(rows[1].sourceId,'10');assert.equal(rows[1].targetId,'21');
 for(const text of ['id,target\n1,2','SourceOrgUnitId,ReplicaOrgUnitId\n','SourceOrgUnitId,ReplicaOrgUnitId\n"bad','x'.repeat(16385)])assert.throws(()=>parseDeploymentCsv(text));
});
test('source-specific validation, inactive targets and API version requirements',async()=>{
 const s=client();await s.api.source('10');assert.match(s.calls[0].url,/sourceCourses\/10\/reofferedCourses$/);await s.api.target('20');
 await assert.rejects(()=>client({active:true}).api.target('20'));await assert.rejects(()=>client({version:'1.49'}).api.source('10'));
});
test('deployment sends one restricted POST with target array after persistence hook',async()=>{
 const s=client();let persisted=false;const r=await s.api.deploy('10',['20','21','20'],async()=>{persisted=true;});
 assert.equal(persisted,true);assert.equal(r.status,'submitted');assert.equal(r.deploymentId,'123');assert.equal(r.targets.length,2);
 assert.equal(s.calls.length,1);assert.equal(s.calls[0].method,'POST');assert.match(s.calls[0].url,/sourceCourses\/10\/deploy$/);
 assert.deepEqual(s.calls[0].data,{TargetCourseOfferingIds:[20,21]});assert.equal(s.calls[0].maxRedirects,0);
 await assert.rejects(()=>s.api.deploy('10',['10']));assert.equal(s.calls.length,1);
});
test('207 response retains deployment ID and per-target failures without leaking raw text',async()=>{
 const s=client({response:{status:207,data:{SourceCourseDeployId:99,FailedOrgUnitsIds:['21'],FailedOrgUnitsWithInfoStr:'SECRET'}}});
 const r=await s.api.deploy('10',['20','21']);assert.equal(r.status,'submittedWithErrors');assert.deepEqual(r.targets.map(t=>t.status),['submitted','failed']);assert.equal(JSON.stringify(r).includes('SECRET'),false);
});
test('lost/malformed responses are uncertain; explicit rejection is failed; no POST is retried',async()=>{
 for(const options of [{error:Error('SECRET')},{response:{status:200,data:{unexpected:true}}},{error:{response:{status:403}}}]){
  const s=client(options),r=await s.api.deploy('10',['20']);assert.equal(r.status,options.error?.response?'failed':'uncertain');assert.equal(s.calls.length,1);assert.equal(JSON.stringify(r).includes('SECRET'),false);
 }
 const s=client({authFail:true}),r=await s.api.deploy('10',['20']);assert.equal(r.writeAttempted,false);assert.equal(s.calls.length,0);
});
test('lease/persistence failure prevents deployment POST',async()=>{
 const s=client();await assert.rejects(()=>s.api.deploy('10',['20'],async()=>{throw Error('storage unavailable');}));assert.equal(s.calls.length,0);
});
function workflow({badTarget=false,result='submitted',enabled=true}={}){
 const calls=[];const engine=createDeploymentJobs({enabled:()=>enabled,client:{source:async id=>{calls.push('source');return {orgUnitId:id,name:'Source'};},target:async id=>{calls.push('target');if(badTarget)throw Error();return {orgUnitId:id,name:'Replica'};},deploy:async(source,targets,before)=>{await before();calls.push({source,targets});return {status:result,writeAttempted:true};}}});
 const job={kind:'sourceDeployment',rows:parseDeploymentCsv('SourceOrgUnitId,ReplicaOrgUnitId\n10,20\n10,21\n11,22'),tasks:[]};
 return {engine,job,calls};
}
test('deployment planner is read-only; valid mappings group replicas by source',async()=>{
 const s=workflow();await s.engine.plan(s.job,async()=>{});assert.equal(s.job.status,'ready');assert.equal(s.job.tasks.length,2);assert.equal(s.job.tasks[0].targets.length,2);assert.ok(s.calls.every(c=>typeof c==='string'));
 await s.engine.execute(s.job,async()=>{},async()=>{});assert.equal(s.job.status,'submitted');assert.equal(s.calls.filter(c=>typeof c==='object').length,2);
});
test('invalid targets block preview and revalidation or missing scope prevent all POSTs',async()=>{
 const s=workflow({badTarget:true});await s.engine.plan(s.job,async()=>{});assert.equal(s.job.status,'failed');
 for(const option of [{badTarget:true},{enabled:false}]){
  const good=workflow();await good.engine.plan(good.job,async()=>{});const bad=workflow(option);await bad.engine.execute(good.job,async()=>{},async()=>{});assert.equal(good.job.status,'failed');assert.ok(bad.calls.every(c=>typeof c==='string'));
 }
});
test('uncertain source-group outcome stops remaining deployment submissions',async()=>{
 const s=workflow({result:'uncertain'});await s.engine.plan(s.job,async()=>{});await s.engine.execute(s.job,async()=>{},async()=>{});
 assert.equal(s.job.status,'outcomeUnknown');assert.equal(s.job.tasks[1].result.status,'skipped');assert.equal(s.calls.filter(c=>typeof c==='object').length,1);
});
