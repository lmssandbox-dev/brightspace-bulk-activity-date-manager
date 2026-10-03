'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {installUi}=require('../src/ui/install');
const {page,workspace}=require('../src/ui/page');
const {createDeploymentView}=require('../src/replication/view');
const {createDateView}=require('../src/dates/view');
const helpers={controls:()=>'<input type="hidden" name="ticket" value="signed">',button:(r,a,id,label)=>`<form action="/${a}"><button>${label}</button></form>`,now:()=>100};
test('UI middleware serves only public bundle paths and leaves CSV/JSON payloads intact',()=>{
 let middleware;const assets=[],whitelist=[];
 installUi({whitelist:x=>whitelist.push(x.route),app:{get:(route,handler)=>assets.push(route),use:f=>middleware=f}});
 assert.deepEqual(assets,['/assets/app.js','/assets/app.css']);assert.deepEqual(whitelist,assets);
 for(const [type,body] of [['text/csv; charset=utf-8','a,b\r\n1,2'],['application/json','{"ok":true}']]){
  let sent;const res={locals:{},getHeader:()=>type,set:()=>{},send:value=>{sent=value;}};
  middleware({path:'/bulk/report'},res,()=>{});res.send(body);assert.equal(sent,body);
 }
 let sent;const res={locals:{ltik:'"/><script>bad()</script>'},getHeader:()=>'',set:()=>{},send:value=>{sent=value;}};
 middleware({path:'/bulk/preview'},res,()=>{});res.send('<h1>Preview</h1>');assert.match(sent,/<!doctype html>/);assert.match(sent,/\/assets\/app.js/);assert.doesNotMatch(sent,/<script>bad/);assert.match(sent,/&lt;script&gt;/);
});
test('workspace renders the selected sidebar panel and omits development tools',()=>{
 const html=workspace({dates:'Dates',replication:'Replication',history:'History',tools:'Diagnostics',selected:'replication'});
 assert.match(html,/data-section="replication" aria-current="page"/);assert.match(html,/id="pane-dates" hidden/);assert.match(html,/id="pane-replication"  aria-label="Bulk Source Courses Deployer"/);assert.doesNotMatch(html,/Development tools|d2l-tabs/);
 assert.match(page('content'),/Brightspace Source Courses Tools/);assert.doesNotMatch(page('content'),/<footer>/);
 assert.doesNotMatch(page('content',{ltik:'secret'}),/href="[^\"]*secret/);
});
test('submitted replication never claims copy completion or polls it and preserves activation confirmation',()=>{
 const job={_id:'j',status:'submitted',rows:[],tasks:[{sourceId:'10',sourceName:'<script>bad</script>',targets:[{orgUnitId:'20',name:'Replica',isActive:true,deactivation:{status:'updated'}}],result:{status:'submitted',deploymentId:'123'}}]};
 const html=createDeploymentView({enabled:()=>true}).render({},job,helpers);
 assert.match(html,/Check copy completion/);assert.match(html,/name="confirmCompleted" value="yes" required/);assert.match(html,/not verified completion/);assert.doesNotMatch(html,/setTimeout|<d2l-loading-spinner|<script>bad/);assert.match(html,/&lt;script&gt;/);
});
test('date review retains course-level blocking errors and does not offer Apply on failure',()=>{
 const job={_id:'j',status:'failed',dates:{},rows:[],courses:[{orgUnitId:'20',name:'Course',status:'invalid',message:'Discovery incomplete'}],tasks:[]};
 const html=createDateView({writeEnabled:()=>true}).render({},job,helpers);
 assert.match(html,/Discovery incomplete/);assert.match(html,/<details class="panel" open><summary>Course validation/);assert.doesNotMatch(html,/action="\/apply"/);
});

// ltijs registers its launch route during setup, before later app middleware.
test('page shell wraps an LTI launch registered after serverAddon',()=>{
 const {installPageShell}=require('../src/ui/install');
 const stack=[];
 installPageShell({use:fn=>stack.push(fn)});
 stack.push((req,res)=>res.send(workspace({dates:'Date form',replication:'Deploy form',history:'History'})));
 let output;const headers={};
 const res={locals:{ltik:'session'},getHeader:key=>headers[key],set:(key,value)=>headers[key]=value,send:body=>{output=body;}};
 stack[0]({path:'/'},res,()=>stack[1]({path:'/'},res));
 assert.match(output,/<!doctype html>/);assert.match(output,/href="\/assets\/app.css"/);assert.match(output,/src="\/assets\/app.js"/);assert.match(output,/Brightspace Source Courses Tools/);
 assert.equal((output.match(/<!doctype html>/g)||[]).length,1);
});
test('entry point installs page shell in serverAddon before launch routes',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
 assert.match(source,/serverAddon: app => \{\s*installDateUploadLimit\(app\);\s*installPageShell\(app\);/);
 assert.match(source,/installUi\(lti,\{shell:false\}\)/);
});
