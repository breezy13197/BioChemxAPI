/* ============================================================
   cmi5 RUNTIME — Beta 1.0-RC2.6
   Durable launch/session/xAPI transport for this AU.
   ============================================================ */
(function(g){
  'use strict';
  var SESSION_KEY='biochem.cmi5.session.v1';
  var VERSION='1.0.3';
  var NS='https://southuniversity.edu/xapi/pharmacy/biochemistry';
  var RELEASE={label:'Biochemistry Companion Beta 1.0-RC2.6',contentVersion:'biochem-1.0-rc2.6',telemetryVersion:'3.4'};
  var RELEASE_EXT={contentVersion:NS+'/extensions/content-version',telemetryVersion:NS+'/extensions/telemetry-version'};
  var CAT_CMI5='https://w3id.org/xapi/cmi5/context/categories/cmi5';
  var CAT_MOVEON='https://w3id.org/xapi/cmi5/context/categories/moveon';
  var COURSE_REQUIREMENTS={
    enzymes:['m1','m2','m3','m4','final'],
    aminoacids:['lab','m1','m2','m3','m4','m5','final'],
    hemoglobin:['m1','m2','m3','m4','m5','lab','final'],
    signaling:['m1','m2','m3','m4','lab','final'],
    nucleotides:['m1','m2','m3','m4','m5','final'],
    glycogen:['m1','m2','m3','m4','m5','final'],
    cac:['m1','m2','m3','m4','m5','mi','final'],
    oxphos:['m1','m2','m3','m4','m5','lab','final'],
    aametabolism:['m1','m2','m3','m4','m5','final'],
    integration:['m1','m2','m3','m4','map','final']
  };
  var state={active:false,initialized:false,terminated:false,initializedAt:null,ctx:null,launchData:null,sessionExpired:false,sessionErrorStatus:null,launchInstanceId:null};
  var completionPromise=null;

  function clone(o){return o==null?o:JSON.parse(JSON.stringify(o));}
  function isoDurationSince(start){var ms=Math.max(0,Date.now()-(start||Date.now()));var sec=ms/1000;return 'PT'+sec.toFixed(3).replace(/\.000$/,'')+'S';}
  function uuid(){if(g.crypto&&g.crypto.randomUUID)return g.crypto.randomUUID();return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});}
  function authHeader(token){return /^Basic\s/i.test(token||'')?token:'Basic '+token;}
  function endpointPath(path){var e=state.ctx.endpoint||'';return e.replace(/\/?$/,'/')+path.replace(/^\//,'');}
  function clearSessionErrorUI(){
    state.sessionExpired=false;state.sessionErrorStatus=null;syncChannels.session='ok';
    try{var b=document&&document.getElementById?document.getElementById('cmi5SessionError'):null;if(b&&b.parentNode)b.parentNode.removeChild(b);}catch(e){}
    renderSyncStatus();
  }
  function markSessionExpired(status){
    state.sessionExpired=true;state.sessionErrorStatus=status||null;saveSession();
    try{g.dispatchEvent(new CustomEvent('cmi5sessionerror',{detail:{status:status||null}}));}catch(e){}
  }
  function validationUrl(){
    if(!state.ctx)return null;
    var q=new URLSearchParams({activityId:state.ctx.activityId,agent:JSON.stringify(state.ctx.actor),registration:state.ctx.registration,stateId:'LMS.LaunchData'});
    return endpointPath('activities/state')+'?'+q.toString();
  }
  function validateCurrentAuthorization(){
    if(!state.ctx||!state.ctx.authToken)return Promise.resolve(false);
    var url=validationUrl();
    if(!url)return Promise.resolve(false);
    return fetch(url,{method:'GET',headers:{Authorization:authHeader(state.ctx.authToken),'X-Experience-API-Version':VERSION,Accept:'application/json'},cache:'no-store'})
      .then(function(r){if(r.status===401||r.status===403)return false;return true;})
      .catch(function(){return true;});
  }
  function request(url,opts){
    opts=opts||{};var suppress=!!opts.suppressSessionError,allowExpired=!!opts.allowExpired;
    var fetchOpts=Object.assign({},opts);delete fetchOpts.suppressSessionError;delete fetchOpts.allowExpired;
    if(state.sessionExpired&&!allowExpired)return Promise.reject(new Error('SCORM Cloud session expired; relaunch the course before continuing'));
    fetchOpts.headers=Object.assign({},fetchOpts.headers||{});if(state.ctx&&state.ctx.authToken)fetchOpts.headers.Authorization=authHeader(state.ctx.authToken);fetchOpts.headers['X-Experience-API-Version']=VERSION;
    return fetch(url,fetchOpts).then(function(r){
      if(!state.active||suppress)return r;
      if(r.status===401){markSessionExpired(r.status);return r;}
      if(r.status===403){
        /* A 403 can mean either an expired cmi5 launch or a statement-specific rejection
           (for example, replaying a queued statement with an old cmi5 session context).
           Verify the current authorization before invalidating the whole launch. */
        return validateCurrentAuthorization().then(function(valid){if(!valid)markSessionExpired(r.status);return r;});
      }
      return r;
    });
  }
  function addActivity(arr,id){arr=arr||[];if(!arr.some(function(x){return x&&x.id===id;}))arr.push({objectType:'Activity',id:id});return arr;}
  function statementContext(extra,moveOnRelevant,cmi5Defined){
    var c=clone((state.launchData&&state.launchData.contextTemplate)||{})||{};c.registration=state.ctx.registration;c.contextActivities=c.contextActivities||{};
    if(cmi5Defined)c.contextActivities.category=addActivity(c.contextActivities.category,CAT_CMI5);else if(c.contextActivities.category)c.contextActivities.category=c.contextActivities.category.filter(function(x){return x&&x.id!==CAT_CMI5&&x.id!==CAT_MOVEON;});
    if(moveOnRelevant)c.contextActivities.category=addActivity(c.contextActivities.category,CAT_MOVEON);
    if(extra)Object.keys(extra).forEach(function(k){if(k==='contextActivities'){Object.keys(extra.contextActivities||{}).forEach(function(t){c.contextActivities[t]=(c.contextActivities[t]||[]).concat(clone(extra.contextActivities[t]||[]));});}else if(k==='extensions'){c.extensions=Object.assign({},c.extensions||{},clone(extra.extensions||{}));}else if(c[k]===undefined){c[k]=clone(extra[k]);}});
    c.extensions=Object.assign({},c.extensions||{});c.extensions[RELEASE_EXT.contentVersion]=RELEASE.contentVersion;c.extensions[RELEASE_EXT.telemetryVersion]=RELEASE.telemetryVersion;return c;
  }
  function appContextFromPrepared(oldContext){
    oldContext=oldContext||{};var extra={contextActivities:{},extensions:{}};
    var ca=oldContext.contextActivities||{};
    ['parent','grouping','category','other'].forEach(function(kind){
      var rows=(ca[kind]||[]).filter(function(x){return x&&x.id&&String(x.id).indexOf(NS+'/')===0;});
      if(rows.length)extra.contextActivities[kind]=clone(rows);
    });
    Object.keys(oldContext.extensions||{}).forEach(function(k){if(String(k).indexOf(NS+'/')===0)extra.extensions[k]=clone(oldContext.extensions[k]);});
    if(!Object.keys(extra.contextActivities).length)delete extra.contextActivities;
    if(!Object.keys(extra.extensions).length)delete extra.extensions;
    return extra;
  }
  function rebasePreparedStatement(st){
    if(!st||!state.ctx)return st;
    var out=clone(st);out.actor=clone(state.ctx.actor);
    out.context=statementContext(appContextFromPrepared(st.context),false,false);
    return out;
  }
  function makeStatement(verbId,display,obj,result,extraContext,moveOnRelevant,cmi5Defined){return {id:uuid(),actor:clone(state.ctx.actor),verb:{id:verbId,display:{'en-US':display}},object:obj||{objectType:'Activity',id:state.ctx.activityId},result:result||undefined,context:statementContext(extraContext,moveOnRelevant,cmi5Defined),timestamp:new Date().toISOString()};}
  function sendStatement(st,opts){
    opts=opts||{};
    if(!state.active||(!state.initialized&&st.verb.id!=='http://adlnet.gov/expapi/verbs/initialized'))return Promise.resolve(null);
    return request(endpointPath('statements'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(st),keepalive:opts.keepalive!==false})
      .then(function(r){if(!r.ok)throw new Error('xAPI statement failed: '+r.status);return r.text();});
  }
  function saveSession(){try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({ctx:state.ctx,launchData:state.launchData,initialized:state.initialized,terminated:state.terminated,initializedAt:state.initializedAt,sessionExpired:state.sessionExpired,sessionErrorStatus:state.sessionErrorStatus,launchInstanceId:state.launchInstanceId}));}catch(e){}}
  function restore(){try{var raw=sessionStorage.getItem(SESSION_KEY);if(!raw)return false;var s=JSON.parse(raw);if(!s||!s.ctx||!s.ctx.endpoint||!s.ctx.authToken)return false;state.ctx=s.ctx;state.launchData=s.launchData||{};state.initialized=!!s.initialized;state.terminated=!!s.terminated;state.initializedAt=s.initializedAt||null;state.sessionExpired=!!s.sessionExpired;state.sessionErrorStatus=s.sessionErrorStatus||null;state.launchInstanceId=s.launchInstanceId||null;state.active=!state.terminated;return state.active;}catch(e){return false;}}
  function hasFreshLaunchParams(){try{var p=new URLSearchParams((g.location&&g.location.search)||'');return !!(p.get('endpoint')&&p.get('fetch')&&p.get('actor')&&p.get('registration')&&p.get('activityId'));}catch(e){return false;}}
  function resetForFreshLaunch(){
    /* A new cmi5 launch must never inherit authorization/session failure state from a prior launch in the same browser.
       Registration-scoped progress, pending State writes, and xAPI outboxes live in localStorage and are intentionally preserved. */
    try{sessionStorage.removeItem(SESSION_KEY);}catch(e){}
    state.active=false;state.initialized=false;state.terminated=false;state.initializedAt=null;state.ctx=null;state.launchData=null;state.sessionExpired=false;state.sessionErrorStatus=null;state.launchInstanceId=uuid();
    clearSessionErrorUI();
  }
  function getLaunchData(){var q=new URLSearchParams({activityId:state.ctx.activityId,agent:JSON.stringify(state.ctx.actor),registration:state.ctx.registration,stateId:'LMS.LaunchData'});return request(endpointPath('activities/state')+'?'+q.toString(),{method:'GET',headers:{Accept:'application/json'}}).then(function(r){if(!r.ok)throw new Error('Unable to read LMS.LaunchData: '+r.status);return r.json();});}
  function getLearnerPreferences(){if(!state.ctx)return Promise.resolve(null);var q=new URLSearchParams({profileId:'cmi5LearnerPreferences',agent:JSON.stringify(state.ctx.actor)});return request(endpointPath('agents/profile')+'?'+q.toString(),{method:'GET',headers:{Accept:'application/json'},suppressSessionError:true}).then(function(r){if(r.status===404||r.status===403||r.status===204)return null;if(!r.ok)throw new Error('Learner preferences GET '+r.status);return r.json();}).catch(function(e){console.warn('[cmi5] learner preferences unavailable',e);return null;});}
  function bootstrap(params){
    resetForFreshLaunch();
    state.ctx={endpoint:params.endpoint,fetchUrl:params.fetchUrl,actor:params.actor,registration:params.registration,activityId:params.activityId,authToken:null};
    return fetch(params.fetchUrl,{method:'POST',cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('cmi5 authorization fetch failed: '+r.status);return r.json();}).then(function(j){if(!j['auth-token'])throw new Error(j['error-text']||'No auth-token returned');state.ctx.authToken=j['auth-token'];return getLaunchData();}).then(function(ld){state.launchData=ld||{};state.active=true;state.initialized=false;state.terminated=false;state.initializedAt=null;state.sessionExpired=false;state.sessionErrorStatus=null;saveSession();return getLearnerPreferences().then(function(){clearSessionErrorUI();saveSession();return ld;});});
  }
  function initialized(){if(!state.active||state.initialized)return Promise.resolve();var startedAt=Date.now(),st=makeStatement('http://adlnet.gov/expapi/verbs/initialized','initialized',null,undefined,null,false,true);return sendStatement(st).then(function(){state.initialized=true;state.initializedAt=startedAt;saveSession();});}
  function readMeta(){try{var raw=g.LearningStore&&g.LearningStore.get?g.LearningStore.get('cmi5.meta.v1'):null;return raw?JSON.parse(raw):{};}catch(e){return {};}}
  function writeMeta(meta){if(g.LearningStore&&g.LearningStore.set)g.LearningStore.set('cmi5.meta.v1',JSON.stringify(meta));}
  function completed(){
    if(!state.active||!state.initialized||state.terminated)return Promise.resolve(false);
    if((state.launchData&&state.launchData.launchMode)!=='Normal')return Promise.resolve(false);
    var meta=readMeta();if(meta.completed)return Promise.resolve(true);if(completionPromise)return completionPromise;
    var st=makeStatement('http://adlnet.gov/expapi/verbs/completed','completed',null,{completion:true,duration:isoDurationSince(state.initializedAt),extensions:{'https://w3id.org/xapi/cmi5/result/extensions/progress':100}},null,true,true);
    completionPromise=sendStatement(st).then(function(){var m=readMeta();m.completed=true;m.completedAt=new Date().toISOString();writeMeta(m);return true;}).catch(function(e){completionPromise=null;throw e;});
    return completionPromise;
  }
  function courseCompleteFromCache(){
    if(!g.LearningStore||!g.LearningStore.get)return false;
    return Object.keys(COURSE_REQUIREMENTS).every(function(t){try{var raw=g.LearningStore.get('companion.'+t+'.v1');if(!raw)return false;var o=JSON.parse(raw),mr=o&&o.telemetry&&o.telemetry.modulesReported||{};return COURSE_REQUIREMENTS[t].every(function(id){return !!mr[id];});}catch(e){return false;}});
  }
  function ensureCourseCompletion(){return courseCompleteFromCache()?completed():Promise.resolve(false);}
  function terminate(){if(!state.active||!state.initialized||state.terminated)return Promise.resolve();var st=makeStatement('http://adlnet.gov/expapi/verbs/terminated','terminated',null,{duration:isoDurationSince(state.initializedAt)},null,false,true);return sendStatement(st).then(function(){state.terminated=true;state.active=false;saveSession();}).catch(function(err){console.error('[cmi5] terminated statement was rejected or could not be sent',err);throw err;});}
  function exitCourse(){
    var ret=(state.launchData&&state.launchData.returnURL)||null;
    var rf=(g.LearningRecord&&g.LearningRecord.flush)?g.LearningRecord.flush():Promise.resolve();
    return rf.then(function(){return g.LearningStore&&g.LearningStore.flush?g.LearningStore.flush():undefined;})
      .then(function(){return ensureCourseCompletion();})
      .then(function(){return g.LearningStore&&g.LearningStore.flush?g.LearningStore.flush():undefined;})
      .then(function(){return g.LearningRecord&&g.LearningRecord.flush?g.LearningRecord.flush():undefined;})
      .then(function(){return terminate();})
      .then(function(){if(g.LearningRecord&&g.LearningRecord.clearLocal)g.LearningRecord.clearLocal();if(g.LearningStore&&g.LearningStore.clearLocalProgress)g.LearningStore.clearLocalProgress();try{sessionStorage.removeItem(SESSION_KEY);}catch(e){}if(ret)location.href=ret;else if(window.close)window.close();});
  }
  function activity(id,name,type){var o={objectType:'Activity',id:id};if(name||type)o.definition={};if(name)o.definition.name={'en-US':name};if(type)o.definition.type=type;return o;}
  function createAllowedStatement(verbId,display,obj,result,extraContext){if(!state.active||!state.initialized||state.terminated)return null;return makeStatement(verbId,display,obj,result,extraContext,false,false);}
  function allowedStatement(verbId,display,obj,result,extraContext){var st=createAllowedStatement(verbId,display,obj,result,extraContext);return st?sendStatement(st):Promise.resolve();}
  function status(){return {active:state.active,initialized:state.initialized,terminated:state.terminated,sessionExpired:state.sessionExpired,sessionErrorStatus:state.sessionErrorStatus,launchInstanceId:state.launchInstanceId,launchMode:state.launchData&&state.launchData.launchMode,actor:state.ctx&&clone(state.ctx.actor),registration:state.ctx&&state.ctx.registration,activityId:state.ctx&&state.ctx.activityId};}

  var syncChannels={state:'saved',xapi:'saved',session:'ok'};
  function renderSyncStatus(){
    if(!state.active||!document)return;var el=document.getElementById('cmi5SyncStatus');if(!el)return;
    var mode='saved',label='Saved to course',bg='#eef8f0',border='#8fbe99',color='#285f32';
    if(syncChannels.session==='expired'){mode='expired';label='Session expired';bg='#fff0f0';border='#d56a6a';color='#7a2828';}
    else if(syncChannels.state==='pending'||syncChannels.xapi==='pending'){mode='pending';label='Pending sync';bg='#fff7df';border='#e3bf62';color='#665019';}
    else if(syncChannels.state==='saving'||syncChannels.xapi==='saving'){mode='saving';label='Saving…';bg='#f3f6f8';border='#b7c4cc';color='#41515b';}
    el.dataset.status=mode;el.textContent=label;el.style.background=bg;el.style.borderColor=border;el.style.color=color;
    el.title=mode==='pending'?'Your work is saved in this browser and will retry syncing to the course automatically.':mode==='expired'?'Relaunch the course before doing more work.':mode==='saving'?'Your latest changes are being sent to the course.':'Your latest saved work has synced to the course.';
  }
  function initialSyncChannels(){
    syncChannels.session=state.sessionExpired?'expired':'ok';
    try{if(g.LearningStore&&g.LearningStore.syncStatus)syncChannels.state=g.LearningStore.syncStatus().status;}catch(e){}
    try{if(g.LearningRecord&&g.LearningRecord.syncStatus)syncChannels.xapi=g.LearningRecord.syncStatus().status;}catch(e){}
    renderSyncStatus();
  }

  g.CMI5Runtime={VERSION:VERSION,NS:NS,RELEASE:clone(RELEASE),RELEASE_EXT:clone(RELEASE_EXT),SESSION_KEY:SESSION_KEY,bootstrap:bootstrap,restore:restore,initialized:initialized,completed:completed,ensureCourseCompletion:ensureCourseCompletion,courseCompleteFromCache:courseCompleteFromCache,terminate:terminate,exitCourse:exitCourse,request:request,endpointPath:endpointPath,activity:activity,allowedStatement:allowedStatement,createAllowedStatement:createAllowedStatement,sendPreparedStatement:sendStatement,rebasePreparedStatement:rebasePreparedStatement,status:status,resetForFreshLaunch:resetForFreshLaunch,get context(){return state.ctx;},get launchData(){return state.launchData;},get active(){return state.active;},get sessionExpired(){return state.sessionExpired;}};

  /* launch.html is a new authorization boundary. Do not restore an older session before bootstrap,
     because learning-store.js would otherwise retry pending writes with an invalidated token. */
  if(!hasFreshLaunchParams())restore();
  if(document&&document.addEventListener){
    document.addEventListener('DOMContentLoaded',function(){
      if(state.active){
        var backup=document.querySelector('[data-view="backup"]');if(backup)backup.style.display='none';
        if(!document.getElementById('cmi5SyncStatus')){var ss=document.createElement('div');ss.id='cmi5SyncStatus';ss.setAttribute('role','status');ss.setAttribute('aria-live','polite');ss.textContent='Saved to course';ss.style.cssText='position:fixed;right:132px;bottom:17px;z-index:99999;border:1px solid #8fbe99;background:#eef8f0;color:#285f32;border-radius:999px;padding:8px 11px;font:700 12px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.10)';document.body.appendChild(ss);}
        if(!document.getElementById('cmi5ExitCourse')){var b=document.createElement('button');b.id='cmi5ExitCourse';b.type='button';b.textContent='Exit course';b.setAttribute('aria-label','Save progress and exit course');b.style.cssText='position:fixed;right:16px;bottom:16px;z-index:99999;border:1px solid #cfd8df;background:#fff;color:#34434d;border-radius:999px;padding:9px 14px;font:600 13px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.12);cursor:pointer';b.onclick=function(){b.disabled=true;b.textContent='Saving…';g.CMI5Runtime.exitCourse().then(function(){if(document.body&&document.body.contains(b)){b.disabled=true;b.textContent='Course exited';b.style.cursor='default';}}).catch(function(err){b.disabled=false;b.textContent='Exit course';alert('Your progress could not be fully saved, so this cmi5 session has not been terminated. Please check your connection and try Exit course again.\n\n'+(err&&err.message?err.message:String(err)));});};document.body.appendChild(b);}
        initialSyncChannels();
        if(state.sessionExpired){try{g.dispatchEvent(new CustomEvent('cmi5sessionerror',{detail:{status:state.sessionErrorStatus}}));}catch(e){}}
      }else if(!document.getElementById('cmi5StandaloneNotice')){
        var n=document.createElement('div');n.id='cmi5StandaloneNotice';n.textContent='Standalone mode: this page is not connected to SCORM Cloud. Progress will be stored only in this browser and will not be recorded to your course account. Relaunch from your course to enable syncing.';n.setAttribute('role','status');n.style.cssText='position:relative;margin:10px 12px;background:#fff7df;border:1px solid #e3bf62;color:#665019;border-radius:10px;padding:9px 12px;font:600 12px system-ui;box-shadow:0 3px 12px rgba(0,0,0,.08)';document.body.insertBefore(n,document.body.firstChild);
      }
    });
    g.addEventListener('biochem-sync-status',function(ev){var d=ev&&ev.detail||{};if(d.channel==='state'||d.channel==='xapi')syncChannels[d.channel]=d.status||syncChannels[d.channel];renderSyncStatus();});
    g.addEventListener('cmi5sessionerror',function(ev){syncChannels.session='expired';state.sessionExpired=true;state.sessionErrorStatus=ev&&ev.detail&&ev.detail.status||state.sessionErrorStatus;saveSession();renderSyncStatus();var b=document.getElementById('cmi5SessionError');if(!b){b=document.createElement('div');b.id='cmi5SessionError';b.textContent='This course session has expired or was replaced by another launch. Your saved progress is still available, but this session can no longer record new activity. Close this course and relaunch it from SCORM Cloud before continuing.';b.style.cssText='position:fixed;left:12px;right:12px;top:10px;z-index:100000;background:#fff0f0;border:1px solid #d56a6a;color:#7a2828;border-radius:10px;padding:10px 12px;font:700 12px system-ui';document.body.appendChild(b);}});
  }
})(window);
