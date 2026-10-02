'use strict';
const { MongoClient } = require('mongodb');
const { interruptJob } = require('./bulkJobs');
const { databaseConfig } = require('../config/database');
// Dedicated application collections; ltijs collections are never accessed.
function createBulkStore({uri,namespace,now=Date.now,leaseMs=120000,mongoClient}) {
  databaseConfig(uri);
  const client=mongoClient || new MongoClient(uri,{serverSelectionTimeoutMS:10000,socketTimeoutMS:15000});
  let connected;
  async function collections() {
    if(!connected)connected=client.connect().catch(e=>{connected=null;throw e;});
    await connected;
    return {jobs:client.db().collection('bulk_date_jobs'),locks:client.db().collection('bulk_date_locks')};
  }
  return {
    async insert(job) {const {jobs}=await collections();await jobs.insertOne({...job,namespace});},
    async get(_id,owner) {const {jobs}=await collections();return jobs.findOne({_id,owner,namespace});},
    async list(owner) {const {jobs}=await collections();return jobs.find({owner,namespace},{projection:{_id:1,status:1,createdAt:1,totals:1}}).sort({createdAt:-1}).limit(20).toArray();},
    async confirm(_id,owner,time) {
      const {jobs}=await collections();return (await jobs.updateOne({_id,owner,namespace,status:'ready',expiresAt:{$gt:time}},{$set:{status:'queued',confirmedAt:time}})).modifiedCount===1;
    },
    async cancel(_id,owner) {
      const {jobs}=await collections();return (await jobs.updateOne({_id,owner,namespace,status:{$in:['validating','ready','queued']}},{$set:{status:'cancelled',updatedAt:now()}})).modifiedCount===1;
    },
    async acquire(worker) {
      const {locks,jobs}=await collections();let lock;
      try {lock=await locks.findOneAndUpdate({_id:namespace,until:{$lte:now()}},{$set:{worker,until:now()+leaseMs}},{upsert:true,returnDocument:'after'});}
      catch(e){if(e.code===11000)return false;throw e;}
      if(lock.value?.worker!==worker)return false;
      const interrupted=await jobs.find({namespace,status:{$in:['planning','running']}}).toArray();
      for(const job of interrupted) {
        interruptJob(job);
        await jobs.updateOne({_id:job._id,namespace,status:{$in:['planning','running']}},{$set:{status:job.status,tasks:job.tasks,totals:job.totals,worker:null,updatedAt:now(),message:job.message}});
      }
      return true;
    },
    async renew(worker) {
      const {locks}=await collections();
      const r=await locks.updateOne({_id:namespace,worker,until:{$gt:now()}},{$set:{until:now()+leaseMs}});
      if(!r.matchedCount)throw new Error('Worker lease lost.');
    },
    async claim(worker) {
      const {jobs}=await collections();
      await jobs.updateMany({namespace,status:'queued',expiresAt:{$lte:now()}},{$set:{status:'failed',message:'Preview expired before execution. Create a new preview.'}});
      const queued=await jobs.findOneAndUpdate({namespace,status:'queued'},{$set:{status:'running',worker,updatedAt:now()}},{sort:{createdAt:1},returnDocument:'after'});
      if(queued.value)return queued.value;
      return (await jobs.findOneAndUpdate({namespace,status:'validating'},{$set:{status:'planning',worker,updatedAt:now()}},{sort:{createdAt:1},returnDocument:'after'})).value;
    },
    async save(job,worker) {
      await this.renew(worker);
      if(Buffer.byteLength(JSON.stringify(job))>8*1024*1024)throw new Error('Job exceeds storage limit.');
      const {jobs}=await collections();const {_id,...data}=job;
      const r=await jobs.updateOne({_id,namespace,worker,status:{$in:['planning','running']}},{$set:data});
      if(!r.matchedCount)throw new Error('Job is no longer owned by this worker.');
    },
    async release(worker) {const {locks}=await collections();await locks.updateOne({_id:namespace,worker},{$set:{until:0}});},
    async close(){await client.close();}
  };
}
module.exports={createBulkStore};
