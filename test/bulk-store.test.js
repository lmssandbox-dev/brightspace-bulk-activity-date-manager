'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBulkStore}=require('../src/shared/store');
function setup({lost=false,duplicate=false,recover=[]}={}){
 const calls=[];
 const collection=name=>({
  updateOne:async(filter,update)=>{calls.push({name,op:'updateOne',filter,update});return {matchedCount:lost?0:1,modifiedCount:1};},
  updateMany:async(filter,update)=>{calls.push({name,op:'updateMany',filter,update});},
  findOneAndUpdate:async(filter,update,options)=>{calls.push({name,op:'claim',filter,update,options});if(duplicate)throw {code:11000};return {value:name==='bulk_date_locks'?{worker:'w'}:{_id:'j',...update.$set}};},
  find:filter=>({toArray:async()=>recover}),findOne:async filter=>{calls.push({name,op:'get',filter});return null;},insertOne:async doc=>calls.push({name,op:'insert',doc})
 });
 const mongoClient={connect:async()=>{},db:()=>({collection}),close:async()=>{}};
 const store=createBulkStore({uri:'mongodb://localhost/brightspace_source_courses_tools',namespace:'n',mongoClient,now:()=>100});
 return {store,calls};
}
test('Mongo confirmation is a single owner/status/expiry-guarded mutation',async()=>{
 const s=setup();await s.store.confirm('j','owner',100);
 assert.deepEqual(s.calls[0].filter,{_id:'j',owner:'owner',namespace:'n',status:'ready',expiresAt:{$gt:100}});
 assert.equal(s.calls[0].update.$set.status,'queued');
 await s.store.get('j','other');assert.equal(s.calls[1].filter.owner,'other');
});
test('Mongo lease contention and lease loss prevent worker persistence',async()=>{
 assert.equal(await setup({duplicate:true}).store.acquire('w'),false);
 const s=setup({lost:true});await assert.rejects(()=>s.store.save({_id:'j',status:'completed'},'w'));assert.equal(s.calls.length,1);assert.equal(s.calls[0].name,'bulk_date_locks');
});
test('Mongo recovery preserves saved successes and marks uncertain work without resuming',async()=>{
 const s=setup({recover:[{_id:'j',tasks:[{result:{status:'updated'}},{result:{status:'running'}},{}]}]});
 assert.equal(await s.store.acquire('w'),true);
 const recovery=s.calls.find(c=>c.name==='bulk_date_jobs'&&c.op==='updateOne');assert.equal(recovery.update.$set.status,'interrupted');
 assert.deepEqual(recovery.update.$set.tasks.map(t=>t.result.status),['updated','failed','skipped']);assert.equal(recovery.update.$set.worker,null);
});
test('Mongo save is fenced by worker and running state; no ltijs collections are touched',async()=>{
 const s=setup();await s.store.save({_id:'j',status:'ready',tasks:[]},'w');
 const saved=s.calls.find(c=>c.name==='bulk_date_jobs');assert.deepEqual(saved.filter,{_id:'j',namespace:'n',worker:'w',status:{$in:['planning','running']}});
 assert.ok(s.calls.every(c=>['bulk_date_jobs','bulk_date_locks'].includes(c.name)));
});

test('activation queues atomically for the owner and removes preview expiry',async()=>{
 const s=setup();await s.store.activate('j','owner',100);
 const c=s.calls[0];assert.equal(c.filter.owner,'owner');assert.equal(c.filter.kind,'sourceDeployment');assert.ok(!c.filter.status.$in.includes('queued'));assert.ok(!c.filter.status.$in.includes('activated'));
 assert.deepEqual(c.filter['tasks.targets.deactivation'],{$exists:true});assert.equal(c.update.$set.operation,'activate');assert.equal(c.update.$set.status,'queued');assert.deepEqual(c.update.$unset,{expiresAt:''});
});
test('activation jobs cannot be cancelled and leave inactive replicas untracked',async()=>{
 const s=setup();await s.store.cancel('j','owner');assert.deepEqual(s.calls[0].filter.operation,{$ne:'activate'});
});

test('chunked date recovery requeues checkpoints without rewriting tasks',async()=>{
 const s=setup({recover:[{_id:'p',kind:'dates',storageVersion:2,status:'planning'},{_id:'r',kind:'dates',storageVersion:2,status:'running'}]});
 await s.store.acquire('w');const changes=s.calls.filter(c=>c.name==='bulk_date_jobs'&&c.op==='updateOne');
 assert.deepEqual(changes.map(c=>c.update.$set.status),['validating','queued']);assert.ok(changes.every(c=>!Object.hasOwn(c.update.$set,'tasks')));
});
