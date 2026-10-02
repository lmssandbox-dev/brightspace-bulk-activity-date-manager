'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSourceDeploymentClient}=require('../src/replication/client');
const {createDeploymentJobs,parseDeploymentCsv}=require('../src/replication/jobs');
function client(options={}){const calls=[];return {calls,api:createSourceDeploymentClient({baseUrl:'https://tenant.example',lpVersion:options.version||'1.53',oauth:{getAccessToken:async()=>{if(options.authFail)throw Error('SECRET');return 'SECRET';}},api:{read:async url=>{calls.push({url});if(url.includes('reofferedCourses'))return {ReofferedCourses:[]};return {Identifier:url.split('/').at(-1),Name:'Course',Code:'C',IsActive:options.active??false};}},http:async config=>{calls.push(config);if(options.error)throw options.error;return options.response||{status:200,data:123};}})};}
test('deployment CSV groups repeated sources, preserves IDs and rejects conflicting replica mappings',()=>{
 const rows=parseDeploymentCsv('SourceOrgUnitId,ReplicaOrgUnitId\n10,20\n10,21\n10,20\n11,20\n30,30\n,\n40,50\n50,60');
 assert.deepEqual(rows.map(r=>r.status),['invalid','pending','duplicate','invalid','invalid','ignored','invalid','pending']);
 assert.equal(rows[1].sourceId,'10');assert.equal(rows[1].targetId,'21');
 for(const text of ['id,target\n1,2','SourceOrgUnitId,ReplicaOrgUnitId\n','SourceOrgUnitId,ReplicaOrgUnitId\n"bad','x'.repeat(16385)])assert.throws(()=>parseDeploymentCsv(text));
});
test('source-specific validation, inactive targets and API version requirements',async()=>{
 const s=client();await s.api.source('10');assert.match(s.calls[0].url,/sourceCourses\/10\/reofferedCourses$/);await s.api.target('20');
 assert.equal((await client({active:true}).api.target('20')).isActive,true);await assert.rejects(()=>client({version:'1.49'}).api.source('10'));
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
 const calls=[];const engine=createDeploymentJobs({enabled:()=>enabled,client:{source:async id=>{calls.push('source');return {orgUnitId:id,name:'Source'};},target:async id=>{calls.push('target');if(badTarget)throw Error();return {orgUnitId:id,name:'Replica',isActive:false};},setActive:async(id,active,before)=>{await before();calls.push(active?'activate':'deactivate');return {status:'updated',verifiedActive:active,writeAttempted:true};},deploy:async(source,targets,before)=>{await before();calls.push({source,targets});return {status:result,writeAttempted:true};}}});
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

const {courseStatusPayload}=require('../src/replication/client');
const course=()=>({Identifier:'20',Name:'Replica',Code:'CODE',IsActive:true,StartDate:null,EndDate:'2027-01-01T00:00:00Z',Description:{Html:'<p>Keep</p>',Text:'Keep'},CanSelfRegister:false,LocaleId:null,ForceLocale:false,ShowAddressBook:true});
test('course active-state writer preserves settings, reconciles lost PUT response and never repeats PUT',async()=>{
 for(const version of ['1.53','1.54']){
  let row=course(),puts=0,hooks=0;
  const api=createSourceDeploymentClient({baseUrl:'https://tenant.example',lpVersion:version,oauth:{getAccessToken:async()=> 'token'},api:{read:async()=>structuredClone(row)},http:async config=>{
   puts++;assert.equal(config.method,'PUT');assert.equal(config.data.Name,row.Name);assert.deepEqual(config.data.Description,{Content:'<p>Keep</p>',Type:'Html'});
   assert.equal('LocaleId' in config.data,version==='1.54');row.IsActive=config.data.IsActive;throw Error('response lost');
  }});
  const result=await api.setActive('20',false,async()=>{hooks++;});assert.equal(result.status,'updated');assert.equal(result.verifiedActive,false);assert.equal(hooks,1);assert.equal(puts,1);
  assert.equal((await api.setActive('20',false)).status,'unchanged');assert.equal(puts,1);
  assert.equal((await api.setActive('20',true)).status,'updated');assert.equal(puts,2);
 }
});
test('incomplete settings and storage failure prevent course PUT; changed settings fail verification',async()=>{
 for(const mode of ['missing','storage','changed','unverified']){
  let row=course(),puts=0,reads=0;if(mode==='missing')delete row.Code;
  const api=createSourceDeploymentClient({baseUrl:'https://tenant.example',lpVersion:'1.53',oauth:{getAccessToken:async()=> 'token'},api:{read:async()=>{if(++reads>1&&mode==='unverified')throw Error();return structuredClone(row);}},http:async()=>{puts++;row.IsActive=false;row.Name='Unexpected change';return {status:200};}});
  const run=()=>api.setActive('20',false,async()=>{if(mode==='storage')throw Error('lost lease');});
  if(mode==='storage')await assert.rejects(run);else assert.equal((await run()).status,'failed');
  assert.equal(puts,['missing','storage'].includes(mode)?0:1);
 }
 assert.throws(()=>courseStatusPayload({...course(),ShowAddressBook:undefined},false,'1.54'));
});
test('prepare verifies all replicas inactive before deploy and never activates automatically',async()=>{
 const s=workflow();await s.engine.plan(s.job,async()=>{});assert.equal(s.calls.includes('deactivate'),false);
 await s.engine.execute(s.job,async()=>{},async()=>{});
 assert.equal(s.calls.filter(c=>c==='deactivate').length,3);assert.equal(s.calls.includes('activate'),false);
 const firstPost=s.calls.findIndex(c=>typeof c==='object');assert.equal(s.calls.slice(0,firstPost).filter(c=>c==='deactivate').length,3);
 const submissions=structuredClone(s.job.tasks.map(t=>t.result));
 await s.engine.activate(s.job,async()=>{},async()=>{});assert.equal(s.job.status,'activated');assert.equal(s.calls.filter(c=>c==='activate').length,3);assert.deepEqual(s.job.tasks.map(t=>t.result),submissions);
});
test('failed deactivation blocks every deploy',async()=>{
 let posts=0;const engine=createDeploymentJobs({enabled:()=>true,client:{source:async()=>{},target:async()=>({isActive:true}),setActive:async()=>({status:'failed',verifiedActive:true}),deploy:async()=>{posts++;}}});
 const job={tasks:[{sourceId:'10',targets:[{orgUnitId:'20'}]}]};await engine.execute(job,async()=>{},async()=>{});assert.equal(posts,0);assert.equal(job.status,'failed');
});
test('activation interruption retains deployment IDs and allows status reconciliation',()=>{
 const {interruptJob}=require('../src/shared/jobs');
 const job={kind:'sourceDeployment',operation:'activate',tasks:[{result:{status:'submitted',deploymentId:'123'},targets:[{activation:{status:'running',writeAttempted:true}}]}]};
 interruptJob(job);assert.equal(job.status,'activationWithErrors');assert.equal(job.tasks[0].result.deploymentId,'123');assert.equal(job.tasks[0].targets[0].activation.status,'failed');
});

test('source validation succeeds when only optional name lookup is forbidden',async()=>{
 const calls=[];const c=createSourceDeploymentClient({baseUrl:'https://tenant.example',lpVersion:'1.53',api:{read:async url=>{calls.push(url);if(url.includes('reofferedCourses'))return {ReofferedCourses:[]};throw {status:403,message:'SECRET'};}}});
 const source=await c.source('9532');assert.equal(source.name,'Source Course 9532');assert.equal(source.orgUnitId,'9532');assert.match(source.warning,/HTTP 403/);assert.equal(calls.length,2);
 const engine=createDeploymentJobs({enabled:()=>true,client:{source:c.source,target:async orgUnitId=>({orgUnitId,name:'Replica',isActive:true})}});
 const job={rows:parseDeploymentCsv('SourceOrgUnitId,ReplicaOrgUnitId\n9532,8062\n9532,8063'),tasks:[]};
 await engine.plan(job,async()=>{});assert.equal(job.status,'ready');assert.equal(job.tasks[0].targets.length,2);assert.match(job.rows[0].message,/display name/);
});
test('source validation errors cannot be bypassed by optional metadata fallback',async()=>{
 for(const status of [401,403,404,429,500]){
  let calls=0;const c=createSourceDeploymentClient({baseUrl:'https://tenant.example',lpVersion:'1.53',api:{read:async()=>{calls++;throw {status,message:'SECRET'};}}});
  await assert.rejects(()=>c.source('9532'),e=>e.stage==='source'&&e.httpStatus===status&&!e.message.includes('SECRET'));assert.equal(calls,1);
 }
 const c=createSourceDeploymentClient({baseUrl:'https://tenant.example',lpVersion:'1.53',api:{read:async()=>({})}});
 await assert.rejects(()=>c.source('9532'),e=>e.reason==='INVALID_RESPONSE');
});
test('replica validation reports the failing ID, version and status without raw errors',async()=>{
 const c=createSourceDeploymentClient({baseUrl:'https://tenant.example',lpVersion:'1.53',api:{read:async()=>{throw {status:404,message:'SECRET'};}}});
 const engine=createDeploymentJobs({enabled:()=>true,client:{source:async()=>({name:'Source'}),target:c.target}});
 const job={rows:parseDeploymentCsv('SourceOrgUnitId,ReplicaOrgUnitId\n9532,8062'),tasks:[]};
 await engine.plan(job,async()=>{});assert.equal(job.status,'failed');assert.match(job.rows[0].message,/Replica.*8062.*LP 1.53, HTTP 404/);assert.doesNotMatch(job.rows[0].message,/SECRET/);
});
