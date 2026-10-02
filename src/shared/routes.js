'use strict';
const { createHash,createHmac,timingSafeEqual }=require('node:crypto');
const { deploymentGuard }=require('./deploymentGuard');
const { brazilDate }=require('../dates/activityDates');
const { terminal }=require('./jobs');
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'}).format(new Date(v)):'—';
function createBulkDates({jobs,deploymentId,secret,writeEnabled,now=Date.now,view,kind='dates'}) {
  if(!secret)throw new Error('Bulk forms require the configured application key.');
  const prefix=kind==='sourceDeployment'?'/deploy':'/bulk';
  const guard=deploymentGuard(deploymentId);
  const owner=res=>createHash('sha256').update(JSON.stringify([res.locals.token.iss,res.locals.token.deploymentId,res.locals.token.user])).digest('hex');
  const session=res=>createHash('sha256').update(String(res.locals.ltik)).digest('hex');
  const signature=value=>createHmac('sha256',secret).update(value).digest('hex');
  function token(res,action,id='') {const data=Buffer.from(JSON.stringify({kind,action,id,session:session(res),expires:now()+30*60*1000})).toString('base64url');return `${data}.${signature(data)}`;}
  function valid(res,value,action,id='') {
    try {const [data,sig]=String(value).split('.');const expected=signature(data);if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return false;
      const t=JSON.parse(Buffer.from(data,'base64url'));return t.kind===kind&&t.session===session(res)&&t.action===action&&t.id===id&&t.expires>now();}catch{return false;}
  }
  const hidden=(k,v)=>`<input type="hidden" name="${k}" value="${escape(v)}">`;
  function controls(res,action,id='') {return hidden('ltik',res.locals.ltik)+hidden('ticket',token(res,action,id))+hidden('jobId',id);}
  function button(res,action,id,label,extra='') {return `<form method="post" action="${prefix}/${action}" ${extra}>${controls(res,action,id)}<button>${escape(label)}</button></form>`;}
  function form(res) {
    if(view)return view.form(res,{controls,button});
    return `<section id="date-management"><h1>1. Activity dates</h1><p>Upload courses and apply the same dates to all Assignments, Quizzes and Discussion Topics, including undated activities.</p>
    <p>CSV headers: <code>OrgUnitId,OrgUnitCode</code>. Supply one ID or code per row. Limit: 100 rows, 16 KB, 1,000 activities. Duplicate courses are processed once.</p>
    <form method="post" action="/bulk/preview" id="bulk-input">${controls(res,'preview')}
      <label>CSV file <input type="file" accept=".csv,text/csv" id="bulk-file"></label><p id="file-message" role="status"></p>
      <p><label>CSV contents (you may also paste here)<br><textarea id="bulk-csv" name="csv" rows="6" cols="55" required placeholder="OrgUnitId,OrgUnitCode&#10;9524,"></textarea></label></p>
      <p>Times are Brasília (America/Sao_Paulo). Start must be before Due; Due must be on or before End.</p>
      ${['start','due','end'].map(k=>`<label>${k} <input type="datetime-local" name="${k}" step="1" required></label>`).join(' ')}
      <p>Existing availability modes are preserved. Unspecified modes use the course defaults.</p><button>Validate and preview</button>
    </form>${button(res,'history','','My recent jobs')}
    <script>document.getElementById('bulk-file').addEventListener('change',async function(){const f=this.files[0],m=document.getElementById('file-message'),t=document.getElementById('bulk-csv');if(!f)return;t.value='';if(f.size>16384){m.textContent='File exceeds 16 KB.';return;}try{t.value=new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer());m.textContent='File loaded. Review dates, then validate.';}catch{m.textContent='Use a UTF-8 CSV file.';}});</script></section>`;
  }
  function render(res,job) {
    if(view)return view.render(res,job,{controls,button,now});
    const permitted=job.tasks.every(t=>writeEnabled(t.activity.type));
    const active=['validating','planning','queued','running'].includes(job.status);
    const summary=job.tasks.reduce((out,t)=>{const s=t.result?.status||t.preview?.status||'pending';out[s]=(out[s]||0)+1;return out;},{});
    return `<h1>Bulk dates — ${escape(job.status)}</h1><p>Job ${escape(job._id)}</p><p>${escape(job.message)}</p>
      <p>Requested dates — Brasília: Start ${date(job.dates.start)} · Due ${date(job.dates.due)} · End ${date(job.dates.end)}</p>
      <p>${job.courses.length} courses · ${job.tasks.length} activities · ${escape(Object.entries(summary).map(([k,v])=>`${k}: ${v}`).join(' · '))}</p>
      ${['validating','planning','ready','failed'].includes(job.status)?'<p>Preview does not change Brightspace dates. Apply uses only the activities shown in this saved plan.</p>':''}
      ${job.status==='ready' && job.expiresAt>now() && permitted?`<p>Confirm updating all ${job.tasks.length} listed activities in ${job.courses.length} courses. Unspecified availability modes will use course defaults.</p>${button(res,'apply',job._id,'Apply dates to these activities')}`:''}
      ${job.status==='ready'&&!permitted?'<p>Apply is unavailable: configure the required write scopes for every activity type in this plan.</p>':''}
      ${job.status==='ready'&&job.expiresAt<=now()?'<p>Preview expired. Create a new preview.</p>':''}
      ${['validating','ready','queued'].includes(job.status)?button(res,'cancel',job._id,'Cancel this job'):''}
      ${button(res,'status',job._id,'Refresh status','id="job-refresh"')}${button(res,'report',job._id,'Download CSV report')}${button(res,'history','','My recent jobs')}
      ${active?'<p>Processing in the background. This page refreshes every 10 seconds. You can close it and return through My recent jobs.</p><script>setTimeout(()=>document.getElementById("job-refresh").requestSubmit(),10000);</script>':''}
      <h2>CSV validation</h2><table border="1"><tr><th>Row</th><th>ID / code</th><th>Resolved ID</th><th>Status</th><th>Details</th></tr>${job.rows.map(r=>`<tr><td>${r.row}</td><td>${escape(r.orgUnitId||r.orgUnitCode)}</td><td>${escape(r.resolvedId)}</td><td>${escape(r.status)}</td><td>${escape(r.message)}${r.duplicateOf?` (row ${r.duplicateOf})`:''}</td></tr>`).join('')}</table>
      <h2>Courses</h2><table border="1"><tr><th>ID</th><th>Code</th><th>Name</th><th>Status</th><th>Activities / results</th></tr>${job.courses.map(c=>{const tasks=job.tasks.filter(t=>t.orgUnitId===c.orgUnitId);return `<tr><td>${escape(c.orgUnitId)}</td><td>${escape(c.code)}</td><td>${escape(c.name)}</td><td>${escape(c.status)}</td><td>${escape(c.message||JSON.stringify(c.counts))}; updated ${tasks.filter(t=>t.result?.status==='updated').length}, unchanged ${tasks.filter(t=>t.result?.status==='unchanged').length}, failed ${tasks.filter(t=>t.result?.status==='failed').length}</td></tr>`;}).join('')}</table>
      <h2>Activities</h2><table border="1"><tr><th>Course</th><th>Type / ID</th><th>Name</th><th>Status</th><th>Current / verified Start</th><th>Due</th><th>End</th><th>Details</th></tr>${job.tasks.map(t=>{const r=t.result||t.preview,d=r.verifiedDates;return `<tr><td>${escape(t.orgUnitId)}</td><td>${escape(t.activity.type)} ${escape(t.activity.id)}</td><td>${escape(t.name)}</td><td>${escape(r.status)}</td><td>${date(d?.start)}</td><td>${date(d?.due)}</td><td>${date(d?.end)}</td><td>${escape(r.error?.message)}</td></tr>`;}).join('')}</table>
      ${terminal.has(job.status)?form(res):''}`;
  }
  function authorize(req,res,action) {
    res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
    if(!guard(res.locals.token,req,res))return false;
    if(!res.locals.ltik || typeof res.locals.token?.user!=='string' || !res.locals.token.user){res.status(403).send('A validated LTI user session is required.');return false;}
    if(!valid(res,req.body?.ticket,action,action==='preview'||action==='history'?'':req.body?.jobId)){res.status(403).send('Form expired or invalid. Relaunch through Brightspace.');return false;}
    return true;
  }
  const handlers={form};
  for(const action of ['preview','apply','status','cancel','history','report','review','activate'])handlers[action]=async(req,res)=>{
    if(!authorize(req,res,action))return;
    try {
      if(action==='history'){const list=await jobs.list(owner(res),kind);return res.send(`<h1>My recent bulk jobs</h1>${list.map(j=>`<p>${escape(j.status)} · ${escape(j._id)}</p>${button(res,'status',j._id,'View job')}`).join('')}${form(res)}`);}
      if(action==='preview'){
        let dates;
        try {if(kind==='dates')dates=Object.fromEntries(['start','due','end'].map(k=>[k,brazilDate(req.body[k])]));}
        catch{return res.status(400).send(`<p>Enter all three valid Brasília date-times.</p>${form(res)}`);}
        let job;
        try {job=await jobs.create({owner:owner(res),csv:req.body.csv,dates,kind});}
        catch(e){return res.status(400).send(`<p>${escape(['INVALID_CSV','INVALID_DATES','INVALID_DATE'].includes(e.code)?e.message:'Could not create preview. Check database availability.')}</p>${form(res)}`);}
        return res.send(render(res,job));
      }
      const job=await jobs.get(req.body.jobId,owner(res));if(!job||(job.kind||'dates')!==kind)return res.status(404).send('Job not found.');
      if(action==='apply') {
        if(kind==='sourceDeployment'&&req.body.confirmReset!=='yes')return res.status(400).send('Confirm the reset of the listed replicas before deployment.');
        if(!(view?view.canApply():job.tasks.every(t=>writeEnabled(t.activity.type))))return res.status(403).send('A required write scope is unavailable.');
        if(!await jobs.confirm(job._id,owner(res)))return res.status(409).send('Job expired, was already confirmed, or is not ready.');
      }
      if(action==='activate'){
        if(kind!=='sourceDeployment'||req.body.confirmCompleted!=='yes')return res.status(400).send('Confirm that copying has finished for all replicas in Brightspace before activation.');
        if(!view.canApply())return res.status(403).send('Required scopes are unavailable.');
        if(!await jobs.activate(job._id,owner(res)))return res.status(409).send('Activation is already queued or this job is not eligible.');
      }
      if(action==='review'){if(kind!=='sourceDeployment'||req.body.confirmReviewed!=='yes')return res.status(400).send('Confirm review in Brightspace.');if(!await jobs.review(job._id,owner(res)))return res.status(409).send('Job cannot be reviewed in its current state.');}
      if(action==='cancel'&&!await jobs.cancel(job._id,owner(res)))return res.status(409).send('Job is already processing or finished.');
      if(action==='report') {res.set('Content-Type','text/csv; charset=utf-8');res.set('Content-Disposition','attachment; filename="bulk-job-results.csv"');return res.send(view?view.report(job):report(job));}
      return res.send(render(res,await jobs.get(job._id,owner(res))));
    } catch {return res.status(503).send('Job storage is unavailable. Refresh or relaunch to check the saved status before retrying.');}
  };
  return handlers;
}
function report(job) {
  const rows=[['Record','CSV row','Course ID','Course code','Activity type','Activity ID','Name','Status','Requested Start UTC','Requested Due UTC','Requested End UTC','Verified Start UTC','Verified Due UTC','Verified End UTC','Message']];
  for(const r of job.rows)rows.push(['CSV',r.row,r.resolvedId||r.orgUnitId,r.orgUnitCode,'','','',r.status,'','','','','','',r.message]);
  for(const t of job.tasks){const r=t.result||t.preview,c=job.courses.find(c=>c.orgUnitId===t.orgUnitId);rows.push(['Activity',c?.row,t.orgUnitId,c?.code,t.activity.type,t.activity.id,t.name,r.status,job.dates.start,job.dates.due,job.dates.end,r.verifiedDates?.start,r.verifiedDates?.due,r.verifiedDates?.end,r.error?.message]);}
  // Quote all cells and neutralize spreadsheet formula injection in native names/codes.
  return '\uFEFF'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
}
module.exports={createBulkDates,report};
