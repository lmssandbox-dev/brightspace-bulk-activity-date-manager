'use strict';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function createDeploymentView({enabled}){
 return {
  canApply:()=>enabled(),
  form(res,{controls,button}){
   return `<section><h1>Source Course deployment</h1><p>Prepare and deploy a source to existing replicas. The app first deactivates replicas and verifies their status. Brightspace resets each target before copying source content. No date offset is requested. Replicas remain inactive until you confirm completion in Brightspace and explicitly activate them here.</p>
   <p>CSV headers: <code>SourceOrgUnitId,ReplicaOrgUnitId</code>. Both IDs are required on each row. Repeat a source for several replicas. Limit: 100 rows, 16 KB.</p>
   <form method="post" action="/deploy/preview">${controls(res,'preview')}
   <label>CSV file <input type="file" accept=".csv,text/csv" id="deploy-file"></label><p id="deploy-message" role="status"></p>
   <p><textarea name="csv" id="deploy-csv" rows="6" cols="55" required placeholder="SourceOrgUnitId,ReplicaOrgUnitId&#10;9531,12001&#10;9531,12002"></textarea></p><button>Validate deployment mappings</button></form>
   ${button(res,'history','','My deployment jobs')}
   <script>document.getElementById('deploy-file').addEventListener('change',async function(){const f=this.files[0],t=document.getElementById('deploy-csv'),m=document.getElementById('deploy-message');if(!f)return;t.value='';if(f.size>16384){m.textContent='File exceeds 16 KB.';return;}try{t.value=new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer());m.textContent='Mappings loaded.';}catch{m.textContent='Use a UTF-8 CSV.';}});</script></section>`;
  },
  render(res,job,{controls,button,now}){
   const active=['validating','planning','queued','running'].includes(job.status);
   const results=job.tasks.flatMap(t=>t.targets.map(target=>({sourceId:t.sourceId,sourceName:t.sourceName,target,...(t.result||t.preview),status:t.result?.targets?.find(r=>r.orgUnitId===target.orgUnitId)?.status||t.result?.status||'ready'})));
   return `<h1>Source deployment — ${escape(job.status)}</h1><p>Job ${escape(job._id)}</p><p>${escape(job.message)}</p>
    <p>${job.tasks.length} sources · ${results.length} replicas. Submitted means accepted for processing, not verified completion.</p>
    ${job.status==='ready'&&job.expiresAt>now()&&enabled()?`<form method="post" action="/deploy/apply">${controls(res,'apply',job._id)}<p><label><input type="checkbox" name="confirmReset" value="yes" required> I confirm Brightspace will reset all ${results.length} listed replicas and replace their content from the listed sources.</label></p><button>Prepare and deploy</button></form>`:''}
    ${job.status==='ready'&&!enabled()?'<p>Deployment requires manageCourses:deploy:manage and orgunits:course:update (or matching wildcard) and Service User deployment permissions.</p>':''}
    ${job.status==='ready'&&job.expiresAt<=now()?'<p>Preview expired. Upload the mappings again.</p>':''}
    ${job.operation!=='activate'&&['validating','ready','queued'].includes(job.status)?button(res,'cancel',job._id,'Cancel'):''}
    ${button(res,'status',job._id,'Refresh submission status','id="deploy-refresh"')}${button(res,'report',job._id,'Download submission report')}${button(res,'history','','My deployment jobs')}
    ${active?'<p>Processing in the background.</p><script>setTimeout(()=>document.getElementById("deploy-refresh").requestSubmit(),10000);</script>':''}
    <h2>CSV validation</h2><table border="1"><tr><th>Row</th><th>Source ID</th><th>Replica ID</th><th>Status</th><th>Details</th></tr>${job.rows.map(r=>`<tr><td>${r.row}</td><td>${escape(r.sourceId)}</td><td>${escape(r.targetId)}</td><td>${escape(r.status)}</td><td>${escape(r.message)}</td></tr>`).join('')}</table>
    <h2>Deployment mappings and submission results</h2><table border="1"><tr><th>Source</th><th>Replica</th><th>Status</th><th>Deployment ID</th><th>Initially active</th><th>Deactivation</th><th>Activation</th><th>Details</th></tr>${results.map(r=>`<tr><td>${escape(r.sourceId)} — ${escape(r.sourceName)}</td><td>${escape(r.target.orgUnitId)} — ${escape(r.target.name)}</td><td>${escape(r.status)}</td><td>${escape(r.deploymentId)}</td><td>${escape(r.target.isActive)}</td><td>${escape(r.target.deactivation?.status)}</td><td>${escape(r.target.activation?.status)}</td><td>${escape(r.target.activation?.error?.message||r.target.deactivation?.error?.message||r.error?.message)}</td></tr>`).join('')}</table>
    ${['submitted','submittedWithErrors','outcomeUnknown','interrupted','failed','activationWithErrors'].includes(job.status)&&job.tasks.some(t=>t.targets.some(r=>r.deactivation))?`<p>Check every replica in Brightspace first. If deployment failed or was uncertain, resolve it there before confirming. Activation affects all listed replicas, including those originally inactive. This app does not check copy completion automatically.</p><form method="post" action="/deploy/activate">${controls(res,'activate',job._id)}<label><input type="checkbox" name="confirmCompleted" value="yes" required> I have verified that all copies have finished, no deployment is still running, and every listed replica is ready to activate.</label><button>Activate replicas</button></form>`:''}`;
  },
  report(job){
   const rows=[['CSV row','Source ID','Replica ID','Source name','Replica name','Validation','Submission status','Deployment ID','Details','Deactivation','Activation']];
   for(const row of job.rows){const task=job.tasks.find(t=>t.sourceId===row.sourceId),r=task?.result;rows.push([row.row,row.sourceId,row.targetId,row.sourceName,row.targetName,row.status,r?.targets?.find(t=>t.orgUnitId===row.targetId)?.status||r?.status||'',r?.deploymentId,row.message||r?.error?.message,task?.targets.find(t=>t.orgUnitId===row.targetId)?.deactivation?.status,task?.targets.find(t=>t.orgUnitId===row.targetId)?.activation?.status]);}
   return '\uFEFF'+rows.map(row=>row.map(value=>{let v=String(value??'');if(/^\s*[=+\-@]|^[\t\r\n]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
  }
 };
}
module.exports={createDeploymentView};
