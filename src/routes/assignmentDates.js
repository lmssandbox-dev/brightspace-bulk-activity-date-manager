'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { id } = require('../brightspace/id');
const { validateDates } = require('../brightspace/assignmentWriter');
const { deploymentGuard } = require('../brightspace/deploymentGuard');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const zone = 'America/Sao_Paulo';
function brazilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('Invalid local date');
  const local = value.length === 16 ? `${value}:00` : value;
  const iso = `${local}-03:00`;
  const date = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
  if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` !== local) throw new Error('Unsupported local date');
  return iso;
}
function createAssignmentDates({ writer, deploymentId, writeEnabled = false, now = Date.now }) {
  const guard = deploymentGuard(deploymentId), tickets = new Map();
  const session = res => createHash('sha256').update(String(res.locals.ltik)).digest('hex');
  function issue(res, stage, data = null) {
    for (const [key,ticket] of tickets) if (ticket.expires <= now()) tickets.delete(key);
    if (tickets.size >= 1000) tickets.delete(tickets.keys().next().value);
    const token = randomBytes(32).toString('hex');
    tickets.set(token,{stage,data,session:session(res),expires:now()+10*60*1000});
    return token;
  }
  function consume(res, token, stage) {
    if (typeof token !== 'string') return null;
    const ticket = tickets.get(token);
    if (!ticket || ticket.stage !== stage || ticket.session !== session(res) || ticket.expires <= now()) return null;
    tickets.delete(token); // Consume synchronously before the first API await.
    return ticket;
  }
  const hidden = (name,value) => `<input type="hidden" name="${name}" value="${escape(value)}">`;
  function form(res, courseId = '') {
    return `<hr><h2>Assignment date test — 01C</h2>
      <p>Update one Assignment. Times are Brasília time (America/Sao_Paulo, UTC−03:00).</p>
      ${writeEnabled ? '' : '<p>Preview is available. Applying requires dropbox:folders:write or a covering wildcard (dropbox:folders:* or dropbox:*:*) in the OAuth registration and D2L_OAUTH2_SCOPES.</p>'}
      <form method="post" action="/diagnostics/assignment-dates/preview">
        ${hidden('ltik',res.locals.ltik)}${hidden('ticket',issue(res,'form'))}
        <p><label>Course Offering ID <input name="orgUnitId" pattern="[1-9][0-9]*" required value="${escape(courseId)}"></label>
        <label>Assignment ID <input name="assignmentId" pattern="[1-9][0-9]*" required></label></p>
        ${['start','due','end'].map(field=>`<p><label>${field[0].toUpperCase()+field.slice(1)} <input type="datetime-local" step="1" name="${field}"></label></p>`).join('')}
        <button name="mode" value="selected" type="submit">Preview selected dates</button>
        <button name="mode" value="now" type="submit">Preview current Brasília time for all dates</button>
      </form>`;
  }
  function authorize(req,res) {
    res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
    if (!guard(res.locals.token,req,res)) return false;
    if (!res.locals.ltik) {res.status(403).send('A validated LTI session is required.');return false;}
    return true;
  }
  const summary = result => `<h2>Assignment ${escape(result.activityKey)}</h2><p>${escape(result.name)}</p>
    <p>Status: <strong>${escape(result.status)}</strong></p>
    <table><thead><tr><th>Date</th><th>Requested — Brasília</th><th>Current / verified — Brasília</th></tr></thead><tbody>
    ${['start','due','end'].map(field=>`<tr><td>${field}</td><td>${escape(display(result.requestedDates?.[field]))}</td><td>${escape(display(result.verifiedDates?.[field]))}</td></tr>`).join('')}</tbody></table>
    ${result.error ? `<p>${escape(result.error.message)}</p>` : ''}
    <details><summary>Technical result (UTC)</summary><pre>${escape(JSON.stringify(result,null,2))}</pre></details>`;
  function display(value) {return value ? new Intl.DateTimeFormat('pt-BR',{timeZone:zone,dateStyle:'short',timeStyle:'medium'}).format(new Date(value)) : '—';}
  return { form,
    async preview(req,res) {
      if (!authorize(req,res)) return;
      if (!consume(res,req.body?.ticket,'form')) return res.status(409).send('Form expired or already submitted. Relaunch the tool and preview again.');
      let data;
      try {
        const orgUnitId=id(req.body.orgUnitId), assignmentId=id(req.body.assignmentId);
        if (!['now','selected'].includes(req.body.mode)) throw new Error('Invalid mode');
        const instant=new Date(now()).toISOString();
        const dates=validateDates(Object.fromEntries(['start','due','end'].map(field=>[field, req.body.mode==='now' ? instant : brazilDate(req.body[field])])));
        data={orgUnitId,activity:{type:'assignment',id:assignmentId},dates};
      } catch {return res.status(400).send(`<p>Enter valid IDs and all three dates in order: Start ≤ Due ≤ End.</p>${form(res)}`);}
      try {
        const result=await writer.updateActivityDates({...data,dryRun:true});
        let confirmation='';
        if(result.status==='ready' && writeEnabled) confirmation=`<form method="post" action="/diagnostics/assignment-dates/apply">
          ${hidden('ltik',res.locals.ltik)}${hidden('ticket',issue(res,'apply',data))}<button type="submit">Apply these dates</button></form>`;
        const same=data.dates.start===data.dates.end ? '<p>Start and End are equal: this creates a zero-duration availability window.</p>' : '';
        res.send(`<h1>Assignment date preview — no changes made</h1>${summary(result)}${same}${confirmation}${form(res,data.orgUnitId)}`);
      } catch {res.status(502).send(`<p>Preview failed. No update was requested.</p>${form(res,data.orgUnitId)}`);}
    },
    async apply(req,res) {
      if (!authorize(req,res)) return;
      if (!writeEnabled) return res.status(403).send('Assignment write scope is not configured.');
      const ticket=consume(res,req.body?.ticket,'apply');
      if(!ticket) return res.status(409).send('Preview expired or already applied. Preview again before applying.');
      try {
        const result=await writer.updateActivityDates({...ticket.data,dryRun:false});
        res.send(`<h1>Assignment date result</h1>${summary(result)}${form(res,ticket.data.orgUnitId)}`);
      } catch {res.status(502).send('<p>Update outcome could not be verified. Read the Assignment before retrying.</p>');}
    }
  };
}
module.exports = { createAssignmentDates, brazilDate };
