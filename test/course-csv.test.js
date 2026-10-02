'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseCourseCsv}=require('../src/services/courseCsv');
const {createCoursesClient}=require('../src/brightspace/courses');
test('CSV preserves numeric codes, BOM, leading zeroes, quoted values and row diagnostics',()=>{
 const rows=parseCourseCsv('\uFEFFOrgUnitCode,OrgUnitId\r\n"00123",\r\n,9524\r\n,9524\r\n,\r\ncode,12\r\n,-1\r\nextra,,column\r\n');
 assert.equal(rows[0].orgUnitCode,'00123');assert.equal(rows[0].orgUnitId,'');
 assert.deepEqual(rows.map(r=>r.status),['pending','pending','duplicate','ignored','invalid','invalid','invalid']);
 assert.equal(rows[2].duplicateOf,3);
});
test('CSV rejects malformed headers, quoting, empty input and limits',()=>{
 for(const csv of ['', 'id,code\n1,', 'OrgUnitId,OrgUnitId\n1,', 'OrgUnitId,OrgUnitCode\n"bad', 'OrgUnitId,OrgUnitCode\n,', 'OrgUnitId,OrgUnitCode\n'+('1,\n'.repeat(101)), 'x'.repeat(16385)])assert.throws(()=>parseCourseCsv(csv));
 assert.equal(parseCourseCsv('OrgUnitId,OrgUnitCode\ninvalid,')[0].status,'invalid');
});
test('resolver uses exact code query, all paged matches and offering endpoint; no numeric inference',async()=>{
 const calls=[];const api={list:async url=>{calls.push(url);return [{Identifier:'9524',Code:'00123'}];},read:async url=>{calls.push(url);return {Identifier:'9524',Code:'00123',Name:'Course'};}};
 const c=createCoursesClient({api,baseUrl:'https://tenant.example',lpVersion:'1.49'});
 assert.equal((await c.resolve({orgUnitCode:'00123'})).orgUnitId,'9524');
 assert.equal(new URL(calls[0]).searchParams.get('exactOrgUnitCode'),'00123');assert.match(calls[1],/\/courses\/9524$/);
 calls.length=0;await c.resolve({orgUnitId:'9524'});assert.equal(calls.length,1);
});
test('resolver rejects unknown/ambiguous codes, wrong IDs and inaccessible/non-offerings',async()=>{
 for(const matches of [[],[{Identifier:'1',Code:'x'},{Identifier:'2',Code:'x'}]]) {
  const c=createCoursesClient({api:{list:async()=>matches,read:async()=>{throw Error('must not read');}},baseUrl:'https://t.example',lpVersion:'1.49'});
  await assert.rejects(()=>c.resolve({orgUnitCode:'x'}));
 }
 for(const read of [async()=>({Identifier:'2',Name:'wrong',Code:'x'}),async()=>{throw Object.assign(Error('no'),{status:404});}]){
  const c=createCoursesClient({api:{read},baseUrl:'https://t.example',lpVersion:'1.49'});await assert.rejects(()=>c.get('1'));
 }
});

test('activity-date validation accepts genuine Source Courses only after source-specific validation',async()=>{
 let sourceCalls=0;const sourceClient={source:async orgUnitId=>{sourceCalls++;return {orgUnitId,name:'Source',code:'SRC'};}};
 const api={read:async()=>{throw Object.assign(Error('not offering'),{status:404});}};
 const c=createCoursesClient({api,baseUrl:'https://tenant.example',lpVersion:'1.53',sourceClient});
 assert.equal((await c.get('9531')).orgUnitId,'9531');assert.equal(sourceCalls,1);
 api.read=async()=>{throw Object.assign(Error('forbidden'),{status:403});};await assert.rejects(()=>c.get('9531'));assert.equal(sourceCalls,1);
});
