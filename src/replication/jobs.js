'use strict';
const {parse}=require('csv-parse/sync');
const {id}=require('../shared/id');
const invalid=message=>Object.assign(new Error(message),{code:'INVALID_CSV'});
function parseDeploymentCsv(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>16384)throw invalid('Use a UTF-8 CSV of at most 16 KB.');
 let records;try{records=parse(text,{bom:true,trim:true,info:true,relax_column_count:true});}catch{throw invalid('Malformed CSV.');}
 const header=records.shift()?.record;
 if(!header||header.length!==2||!header.includes('SourceOrgUnitId')||!header.includes('ReplicaOrgUnitId'))throw invalid('Headers must be SourceOrgUnitId,ReplicaOrgUnitId.');
 if(records.length>100)throw invalid('At most 100 mappings are supported.');
 const targets=new Map();
 const rows=records.map(({record,info})=>{
  const row={row:info.lines,status:'pending'};
  if(record.every(x=>!x.trim()))return {...row,status:'ignored',message:'Blank row ignored.'};
  try{if(record.length!==2)throw Error();row.sourceId=id(record[header.indexOf('SourceOrgUnitId')]);row.targetId=id(record[header.indexOf('ReplicaOrgUnitId')]);if(row.sourceId===row.targetId||!Number.isSafeInteger(Number(row.targetId)))throw Error();}
  catch{return {...row,status:'invalid',message:'Supply two positive IDs; source and replica must differ.'};}
  const previous=targets.get(row.targetId);
  if(previous){if(previous.sourceId===row.sourceId)return {...row,status:'duplicate',message:`Duplicate of row ${previous.row}; deployed once.`};previous.status='invalid';previous.message='Replica is assigned to different sources.';return {...row,status:'invalid',message:previous.message};}
  targets.set(row.targetId,row);return row;
 });
 const sources=new Set(rows.map(r=>r.sourceId).filter(Boolean));
 for(const row of rows)if(sources.has(row.targetId)){row.status='invalid';row.message='A source in this file cannot also be a deployment target.';}
 if(!rows.some(r=>r.status!=='ignored'))throw invalid('CSV contains no mappings.');
 return rows;
}
function createDeploymentJobs({client,enabled,now=Date.now}){
 return {
  parse:parseDeploymentCsv,
  async plan(job,save){
   const sources=new Map();
   for(const row of job.rows){
    if(row.status!=='pending')continue;
    try{
     if(!sources.has(row.sourceId))sources.set(row.sourceId,await client.source(row.sourceId));
     const target=await client.target(row.targetId),source=sources.get(row.sourceId);
     row.sourceName=source.name;row.targetName=target.name;row.status='valid';
     let task=job.tasks.find(t=>t.sourceId===row.sourceId);
     if(!task){task={sourceId:row.sourceId,sourceName:source.name,targets:[],preview:{status:'ready'}};job.tasks.push(task);}
     task.targets.push(target);
    }catch{row.status='invalid';row.message='Source or replica could not be validated. Source must be a Source Course; replica must be an accessible Course Offering. Check LP version and permissions.';}
    await save(job);
   }
   job.status=job.rows.some(r=>r.status==='invalid')||!job.tasks.length?'failed':'ready';job.expiresAt=now()+30*60*1000;
  },
  async activate(job,save,renew){
   if(!enabled()){job.status='activationWithErrors';job.message='Required deployment/course update scopes are unavailable.';return;}
   for(const task of job.tasks)for(const target of task.targets){
    target.activation={status:'running',writeAttempted:false};await save(job);
    target.activation=await client.setActive(target.orgUnitId,true,async()=>{await renew();target.activation.writeAttempted=true;await save(job);});
    await save(job);
   }
   job.status=job.tasks.every(t=>t.targets.every(r=>['updated','unchanged'].includes(r.activation?.status)))?'activated':'activationWithErrors';
   job.message=job.status==='activated'?'All replicas verified active. Copy completion was confirmed manually by the user.':'Some replicas could not be verified active. Inspect the per-replica results; activation can be retried without deploying again.';
  },
  async execute(job,save,renew){
   if(!enabled()){job.status='failed';job.message='Configure manageCourses:deploy:manage and orgunits:course:update before deploying.';return;}
   // Validate the whole confirmed plan again before resetting any target.
   try{for(const t of job.tasks){await client.source(t.sourceId);for(const target of t.targets)await client.target(target.orgUnitId);}}
   catch{job.status='failed';job.message='Source or replica validation changed. No deployment was sent; create a new preview.';return;}
   // Prepare every replica before submitting any deployment. Never automatically reactivate.
   for(const task of job.tasks)for(const target of task.targets){
    target.deactivation={status:'running',writeAttempted:false};await save(job);
    target.deactivation=await client.setActive(target.orgUnitId,false,async()=>{await renew();target.deactivation.writeAttempted=true;await save(job);});
    await save(job);
    if(!['updated','unchanged'].includes(target.deactivation.status)||target.deactivation.verifiedActive!==false){job.status='failed';job.message='Preparation stopped: a replica was not verified inactive. No deployments were submitted. Inspect the saved results before restoring replicas.';return;}
   }
   let stop=false;
   for(const task of job.tasks){
    if(stop){task.result={status:'skipped',writeAttempted:false};continue;}
    // Recheck inactivity immediately before each destructive deployment.
    for(const target of task.targets)if((await client.target(target.orgUnitId)).isActive!==false)throw Error('Replica became active before deployment');
    task.result={status:'running',writeAttempted:false};await save(job);
    task.result=await client.deploy(task.sourceId,task.targets.map(t=>t.orgUnitId),async()=>{await renew();task.result.writeAttempted=true;await save(job);});
    if(task.result.status!=='submitted')stop=true;
    await save(job);
   }
   job.status=job.tasks.some(t=>t.result?.status==='uncertain')?'outcomeUnknown':job.tasks.every(t=>t.result?.status==='submitted')?'submitted':'submittedWithErrors';
   job.message='Submission results are recorded. Submitted means Brightspace initiated deployment; completion and copied dates must be checked in Brightspace. Return to this saved job after checking completion in Brightspace, then explicitly activate replicas. Do not repeat deployment to check status.';
  }
 };
}
module.exports={createDeploymentJobs,parseDeploymentCsv};
