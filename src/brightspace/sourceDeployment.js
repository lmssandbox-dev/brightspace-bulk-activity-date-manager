'use strict';
const { id }=require('./id');
function createSourceDeploymentClient({api,http,oauth,baseUrl,lpVersion}) {
  const base=new URL(baseUrl);
  const version=/^\d+\.\d+$/.test(lpVersion||'')?lpVersion:null;
  const root=version?`${base.origin}/d2l/api/lp/${version}`:null;
  function configured(){const [major,minor]=(version||'0.0').split('.').map(Number);if(base.protocol!=='https:'||major<1||(major===1&&minor<53))throw Error('Source deployment requires LP 1.53 or later.');}
  const safeNumber=value=>{const n=Number(id(value));if(!Number.isSafeInteger(n))throw Error('ID exceeds JSON number precision');return n;};
  return {
    async source(value){
      configured();const orgUnitId=id(value);
      // The source-specific endpoint validates the source kind without hard-coding tenant type IDs.
      await api.read(`${root}/sourceCourses/${orgUnitId}/reofferedCourses`);
      const row=await api.read(`${root}/orgstructure/${orgUnitId}`);
      if(id(row.Identifier)!==orgUnitId || typeof row.Name!=='string')throw Error('Invalid source response');
      return {orgUnitId,name:row.Name,code:row.Code??null};
    },
    async target(value){
      configured();const orgUnitId=id(value),row=await api.read(`${root}/courses/${orgUnitId}`);
      if(id(row.Identifier)!==orgUnitId || typeof row.Name!=='string'||typeof row.IsActive!=='boolean')throw Error('Target must be a Course Offering with a known active state.');
      return {orgUnitId,name:row.Name,code:row.Code??null,isActive:row.IsActive};
    },
    async setActive(value,desired,beforeWrite){
      configured();const orgUnitId=id(value),url=`${root}/courses/${orgUnitId}`;
      if(typeof desired!=='boolean')throw Error('Invalid active state');
      let row,payload,token;
      const failure=(message,writeAttempted=false,verifiedActive=null)=>({status:'failed',writeAttempted,verifiedActive,error:{message}});
      try{
        row=await api.read(url);
        if(id(row.Identifier)!==orgUnitId||typeof row.IsActive!=='boolean')throw Error();
        if(row.IsActive===desired)return {status:'unchanged',writeAttempted:false,verifiedActive:desired};
        payload=courseStatusPayload(row,desired,version);
        token=await oauth.getAccessToken();
      }catch{return failure('Could not read complete course settings or obtain authorization. No status update was sent.');}
      // Persist intent before sending; storage failures must propagate to stop the worker.
      if(beforeWrite)await beforeWrite();
      try{await http({method:'PUT',url,timeout:15000,maxRedirects:0,headers:{Authorization:`Bearer ${token}`},data:payload});}catch{ /* Resolve uncertain transport outcomes through read-back, never repeat PUT. */ }
      try{
        const verified=await api.read(url);
        if(id(verified.Identifier)!==orgUnitId)throw Error();
        const actual=courseStatusPayload(verified,desired,version);
        if(verified.IsActive!==desired||JSON.stringify(actual)!==JSON.stringify(payload))return failure('Course status or preserved settings did not verify. Inspect the offering in Brightspace.',true,verified.IsActive);
        return {status:'updated',writeAttempted:true,verifiedActive:desired};
      }catch{return failure('Status update outcome could not be verified. Inspect the offering in Brightspace.',true);}
    },
    async deploy(sourceId,targetIds,beforeSend){
      configured();const source=id(sourceId),targets=[...new Set(targetIds.map(id))];
      if(!targets.length||targets.length>100||targets.includes(source))throw Error('Invalid deployment targets');
      const data={TargetCourseOfferingIds:targets.map(safeNumber)};
      // Fetch credentials before recording the POST attempt. A transport loss after POST is uncertain.
      let token;try{token=await oauth.getAccessToken();}catch{return {status:'failed',writeAttempted:false,error:{httpStatus:401,message:'Token exchange failed; deployment was not sent.'},targets:targets.map(orgUnitId=>({orgUnitId,status:'failed'}))};}
      if(beforeSend)await beforeSend();
      try{
        const response=await http({method:'POST',url:`${root}/sourceCourses/${source}/deploy`,timeout:30000,maxRedirects:0,headers:{Authorization:`Bearer ${token}`},data});
        if(response.status===200 && Number.isSafeInteger(response.data)&&response.data>0){return {status:'submitted',writeAttempted:true,deploymentId:String(response.data),targets:targets.map(orgUnitId=>({orgUnitId,status:'submitted'}))};}
        const body=response.data;
        if(response.status===207 && body && Array.isArray(body.FailedOrgUnitsIds)){
          const failed=body.FailedOrgUnitsIds.map(id);
          if(failed.some(x=>!targets.includes(x)))throw Error('Unexpected failed target');
          const deploymentId=body.SourceCourseDeployId==null?null:id(body.SourceCourseDeployId);
          return {status:'submittedWithErrors',writeAttempted:true,deploymentId,targets:targets.map(orgUnitId=>({orgUnitId,status:failed.includes(orgUnitId)?'failed':deploymentId?'submitted':'uncertain'})),error:{message:'Brightspace reported partial success. Check each target in Brightspace before any new deployment.'}};
        }
        throw Error('Unexpected deployment response');
      }catch(error){
        const httpStatus=error.response?.status;
        // A received non-success response is documented as not initiating deployment.
        const rejected=Number.isInteger(httpStatus)&&httpStatus>=400;
        return {status:rejected?'failed':'uncertain',writeAttempted:true,error:{...(httpStatus?{httpStatus}:{}),message:rejected?'Brightspace rejected deployment; no deployment was initiated.':'Deployment outcome is unknown. Check Brightspace before retrying; do not submit again blindly.'},targets:targets.map(orgUnitId=>({orgUnitId,status:rejected?'failed':'uncertain'}))};
      }
    }
  };
}
function courseStatusPayload(row,active,version){
  for(const key of ['Name','Code'])if(typeof row[key]!=='string')throw Error('Missing course setting');
  for(const key of ['StartDate','EndDate'])if(row[key]!==null&&(typeof row[key]!=='string'||!Number.isFinite(Date.parse(row[key]))))throw Error('Missing course date');
  if(typeof row.CanSelfRegister!=='boolean'||!row.Description)throw Error('Missing course setting');
  const description=typeof row.Description.Html==='string'?{Content:row.Description.Html,Type:'Html'}:typeof row.Description.Text==='string'?{Content:row.Description.Text,Type:'Text'}:null;
  if(!description)throw Error('Missing description');
  const payload={Name:row.Name,Code:row.Code,StartDate:row.StartDate,EndDate:row.EndDate,IsActive:active,Description:description,CanSelfRegister:row.CanSelfRegister};
  const [major,minor]=version.split('.').map(Number);
  if(major>1||minor>=54){
    if((row.LocaleId!==null&&!Number.isInteger(row.LocaleId))||typeof row.ForceLocale!=='boolean'||typeof row.ShowAddressBook!=='boolean')throw Error('Missing locale/address book setting');
    Object.assign(payload,{LocaleId:row.LocaleId,ForceLocale:row.ForceLocale,ShowAddressBook:row.ShowAddressBook});
  }
  return payload;
}
module.exports={createSourceDeploymentClient,courseStatusPayload};
