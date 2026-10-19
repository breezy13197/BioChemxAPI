/* ============================================================
   LEARNING RECORD v3 — durable pharmacy-learning xAPI schema
   Hierarchy: course > topic > module > section > activity/question
   Context kinds: learning, practice, remediation, mastery.
   ============================================================ */
(function(g){
  'use strict';
  var BASE='https://southuniversity.edu/xapi/pharmacy/biochemistry';
  var TYPES={course:'http://adlnet.gov/expapi/activities/course',module:'http://adlnet.gov/expapi/activities/module',lesson:'http://adlnet.gov/expapi/activities/lesson',assessment:'http://adlnet.gov/expapi/activities/assessment',interaction:'http://adlnet.gov/expapi/activities/cmi.interaction',other:'http://adlnet.gov/expapi/activities/other'};
  var VERBS={experienced:['http://adlnet.gov/expapi/verbs/experienced','experienced'],progressed:['http://adlnet.gov/expapi/verbs/progressed','progressed'],answered:['http://adlnet.gov/expapi/verbs/answered','answered'],completed:['http://adlnet.gov/expapi/verbs/completed','completed'],attempted:['http://adlnet.gov/expapi/verbs/attempted','attempted']};
  var EXT={kind:BASE+'/extensions/learning-context',topic:BASE+'/extensions/topic-id',scope:BASE+'/extensions/assessment-scope',module:BASE+'/extensions/module-id',section:BASE+'/extensions/section-id',concept:BASE+'/extensions/concept-id',attempt:BASE+'/extensions/attempt-number',firstAttempt:BASE+'/extensions/first-attempt',eventualCorrect:BASE+'/extensions/eventual-correct',percent:BASE+'/extensions/percent',skipped:BASE+'/extensions/skipped',question:BASE+'/extensions/question-id',assessment:BASE+'/extensions/assessment-id',progressReset:BASE+'/extensions/progress-reset'};
  function enc(x){return encodeURIComponent(String(x));}
  var outbox=[];
  var OUTBOX_PREFIX='biochem-xapi-outbox:';
  function outboxKey(){var r=g.CMI5Runtime;return OUTBOX_PREFIX+(r&&r.context&&r.context.registration?r.context.registration:'standalone');}
  function dispatchSync(status,detail){detail=detail||{};detail.channel='xapi';detail.status=status;detail.pending=outbox.length;try{g.dispatchEvent(new CustomEvent('biochem-sync-status',{detail:detail}));}catch(e){}}
  function loadOutbox(){try{var raw=localStorage.getItem(outboxKey());var a=raw?JSON.parse(raw):[];outbox=Array.isArray(a)?a:[];}catch(e){outbox=[];}if(outbox.length)dispatchSync('pending');}
  function persistOutbox(){try{if(outbox.length)localStorage.setItem(outboxKey(),JSON.stringify(outbox));else localStorage.removeItem(outboxKey());}catch(e){}}
  function removeOutbox(id){outbox=outbox.filter(function(x){return x.id!==id;});persistOutbox();dispatchSync(outbox.length?'saving':'saved');}
  function syncStatus(){return {status:outbox.length?'pending':'saved',pending:outbox.length};}
  function delay(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function deliver(st,attempt){var r=g.CMI5Runtime;if(!r||!r.active)return Promise.resolve();dispatchSync('saving');var prepared=r.rebasePreparedStatement?r.rebasePreparedStatement(st):st;return r.sendPreparedStatement(prepared,{keepalive:true}).then(function(){removeOutbox(st.id);}).catch(function(e){if(attempt<5)return delay(Math.min(1600,150*Math.pow(2,attempt))).then(function(){return deliver(st,attempt+1);});dispatchSync('pending',{error:String(e&&e.message||e)});throw e;});}
  function send(v,obj,result,ctx){
    var r=g.CMI5Runtime;if(!r||!r.active)return Promise.resolve();var x=VERBS[v],st=r.createAllowedStatement(x[0],x[1],obj,result,ctx);if(!st)return Promise.resolve();
    outbox.push(st);persistOutbox();dispatchSync('saving');return deliver(st,0).catch(function(e){console.warn('[xAPI] event remains queued after retries',v,e);dispatchSync('pending',{error:String(e&&e.message||e)});throw e;});
  }
  function flush(){loadOutbox();var batch=outbox.slice();if(!batch.length){dispatchSync('saved');return Promise.resolve();}dispatchSync('saving');return Promise.all(batch.map(function(st){return deliver(st,0);})).then(function(){if(outbox.length)return flush();dispatchSync('saved');}).catch(function(e){dispatchSync('pending',{error:String(e&&e.message||e)});throw e;});}
  function clearLocal(){try{localStorage.removeItem(outboxKey());}catch(e){}outbox=[];}
  loadOutbox();if(outbox.length&&g.CMI5Runtime&&g.CMI5Runtime.active)setTimeout(function(){flush().catch(function(e){console.warn('[xAPI] queued events are still pending',e);});},100);
  if(g.addEventListener)g.addEventListener('pagehide',function(){loadOutbox();outbox.slice().forEach(function(st){var r=g.CMI5Runtime;if(r&&r.active)r.sendPreparedStatement(st,{keepalive:true}).then(function(){removeOutbox(st.id);}).catch(function(){});});});
  function act(id,name,type){return g.CMI5Runtime.activity(id,name,type);}
  function topicId(){return typeof TOPIC_ID!=='undefined'?TOPIC_ID:'hub';}
  function topicTitle(){return typeof TOPIC_TITLE!=='undefined'?TOPIC_TITLE:topicId();}
  function conceptId(label){return g.ConceptRegistry?g.ConceptRegistry.idFor(label):String(label||'general').toLowerCase().replace(/[^a-z0-9]+/g,'-');}
  function findModuleForSection(key){if(typeof MODULES==='undefined')return null;for(var i=0;i<MODULES.length;i++)if(MODULES[i].sections.some(function(s){return s.key===key;}))return MODULES[i];return null;}
  function moduleForQuestion(q){if(!q||q.m==null||typeof MODULES==='undefined')return null;return MODULES.filter(function(m){return String(m.id)===String(q.m);})[0]||null;}
  function topicActivity(tid,title){return act(BASE+'/topics/'+enc(tid),title||tid,TYPES.module);}
  function moduleActivity(tid,mod){return act(BASE+'/topics/'+enc(tid)+'/modules/'+enc(mod.id),mod.title||mod.id,TYPES.module);}
  function sectionActivity(tid,key,label){var nm=(label||key);var tt=(tid===topicId()?topicTitle():tid);return act(BASE+'/topics/'+enc(tid)+'/sections/'+enc(key),(tt?tt+' · ':'')+nm+' section',TYPES.lesson);}
  function conceptActivity(label){var cid=conceptId(label);return act(BASE+'/concepts/'+enc(cid),label||cid,TYPES.other);}
  function kindActivity(kind){return {objectType:'Activity',id:BASE+'/contexts/'+enc(kind||'learning')};}
  function context(opts){opts=opts||{};var tid=opts.topicId||topicId(),ca={grouping:[],category:[kindActivity(opts.kind||'learning')]};if(!opts.omitTopic)ca.grouping.push(topicActivity(tid,opts.topicTitle||topicTitle()));if(opts.module)ca.grouping.push(moduleActivity(tid,opts.module));if(opts.section&&opts.module)ca.parent=[moduleActivity(tid,opts.module)];else if(opts.section)ca.parent=[topicActivity(tid,opts.topicTitle||topicTitle())];if(opts.parent)ca.parent=[opts.parent];if(opts.concept)ca.grouping.push(conceptActivity(opts.concept));var ex={};ex[EXT.kind]=opts.kind||'learning';if(!opts.omitTopic)ex[EXT.topic]=tid;if(opts.scope)ex[EXT.scope]=String(opts.scope);if(opts.module)ex[EXT.module]=String(opts.module.id);if(opts.section)ex[EXT.section]=String(opts.section.key);if(opts.concept)ex[EXT.concept]=conceptId(opts.concept);if(opts.questionId)ex[EXT.question]=String(opts.questionId);if(opts.assessmentId)ex[EXT.assessment]=String(opts.assessmentId);return {contextActivities:ca,extensions:ex};}
  function choiceActivity(tid,q,idOverride,nameOverride){var qid=idOverride||q.id,o=act(BASE+'/questions/'+enc(tid)+'/'+enc(qid),nameOverride||q.xapiName||q.stem||qid,TYPES.interaction);o.definition.interactionType='choice';o.definition.choices=(q.options||[]).map(function(txt,i){return {id:String(i),description:{'en-US':txt}};});o.definition.correctResponsesPattern=[String(q.answer)];return o;}

  function cleanTagName(txt){
    txt=String(txt||'').replace(/\s+/g,' ').trim();
    if(!txt)return '';
    var parts=txt.split(/\s*[·•|:]\s*/);if(parts.length>1)txt=parts.slice(1).join(' · ');
    if(txt===txt.toUpperCase())txt=txt.toLowerCase().replace(/^./,function(c){return c.toUpperCase();});
    return txt;
  }
  function sectionLabel(key){var m=findModuleForSection(key);if(!m)return key;var s=m.sections.filter(function(x){return x.key===key;})[0];return s?s.label:key;}
  function activityDisplayName(activityKey,sectionKey){
    /* Activity keys remain stable machine IDs; the LRS-facing label should be readable and not depend on fragile DOM box ordering. */
    return sectionKey?sectionLabel(sectionKey)+' · interactive activity':'Interactive activity · '+String(activityKey);
  }
  function assessmentDisplayName(quizId){
    if(typeof MANIFEST!=='undefined'&&MANIFEST.modules){for(var i=0;i<MANIFEST.modules.length;i++){var secs=MANIFEST.modules[i].sections||[];for(var j=0;j<secs.length;j++)if(String(secs[j].quiz)===String(quizId))return topicTitle()+' · '+secs[j].label;}}
    return topicTitle()+' · '+String(quizId)+' quiz';
  }
  function checkpointConcept(sectionKey,cp){
    if(cp&&cp.area)return cp.area;
    if(typeof AREA_SECTION!=='undefined'&&AREA_SECTION){var hits=Object.keys(AREA_SECTION).filter(function(a){return AREA_SECTION[a]===sectionKey;});if(hits.length===1)return hits[0];}
    return sectionLabel(sectionKey);
  }

  function section(key,label){var mod=findModuleForSection(key);return send('experienced',sectionActivity(topicId(),key,label),undefined,context({module:mod,section:{key:key,label:label},kind:'learning'}));}
  function sectionCompleted(key,label){var mod=findModuleForSection(key);return send('completed',sectionActivity(topicId(),key,label),{completion:true},context({module:mod,section:{key:key,label:label},kind:'learning'}));}
  function moduleCompleted(mod){return send('completed',moduleActivity(topicId(),mod),{completion:true},context({module:mod,kind:'learning'}));}
  function activityCompleted(activityKey,value,sectionKey){var mod=sectionKey?findModuleForSection(sectionKey):null;var result={completion:true};if(value&&typeof value==='object'&&Number.isFinite(value.best)&&Number.isFinite(value.of)&&value.of>0)result.score={scaled:value.best/value.of,raw:value.best,min:0,max:value.of};return send('completed',act(BASE+'/topics/'+enc(topicId())+'/activities/'+enc(activityKey),activityDisplayName(activityKey,sectionKey),TYPES.other),result,context({module:mod,section:sectionKey?{key:sectionKey,label:sectionLabel(sectionKey)}:null,concept:sectionKey?checkpointConcept(sectionKey,null):null,kind:'learning'}));}
  function checkpoint(id,cp,response,success,meta){meta=meta||{};var secKey=meta.sectionKey||null,mod=secKey?findModuleForSection(secKey):null;var res={response:String(response),success:!!success,completion:!!success,extensions:{}};res.extensions[EXT.attempt]=meta.attempt||1;res.extensions[EXT.firstAttempt]=!!meta.firstAttempt;res.extensions[EXT.eventualCorrect]=!!meta.eventualCorrect;return send('answered',choiceActivity(topicId(),cp,id,meta.questionName),res,context({module:mod,section:secKey?{key:secKey,label:meta.sectionLabel||secKey}:null,concept:meta.concept||checkpointConcept(secKey,cp),questionId:id,kind:'learning'}));}
  function assessmentKind(mode,quizId){if(mode==='mastery'||quizId==='final')return 'mastery';return 'practice';}
  function quizObj(quizId,name){return act(BASE+'/topics/'+enc(topicId())+'/assessments/'+enc(quizId),name||assessmentDisplayName(quizId),TYPES.assessment);}
  function quizAttempt(quizId,name,mode,attemptNo){var kind=assessmentKind(mode,quizId),mod=(typeof MODULES!=='undefined'?MODULES.filter(function(m){return String(m.id)===String(quizId);})[0]:null);var r={extensions:{}};r.extensions[EXT.attempt]=attemptNo||1;return send('attempted',quizObj(quizId,assessmentDisplayName(quizId)),r,context({module:mod,assessmentId:quizId,kind:kind}));}
  function quizQuestion(quizId,q,response,success,mode,attemptNo){var parent=quizObj(quizId,assessmentDisplayName(quizId)),mod=moduleForQuestion(q);var r={response:String(response),success:!!success,completion:true,extensions:{}};r.extensions[EXT.attempt]=attemptNo||1;return send('answered',choiceActivity(topicId(),q),r,context({module:mod,parent:parent,concept:q.area,questionId:q.id,assessmentId:quizId,kind:assessmentKind(mode,quizId)}));}
  function quizComplete(quizId,pct,correct,total,mode,attemptNo){var mod=(typeof MODULES!=='undefined'?MODULES.filter(function(m){return String(m.id)===String(quizId);})[0]:null),r={completion:true,score:{scaled:total?correct/total:0,raw:correct,min:0,max:total},extensions:{}};r.extensions[EXT.percent]=pct;r.extensions[EXT.attempt]=attemptNo||1;return send('completed',quizObj(quizId,assessmentDisplayName(quizId)),r,context({module:mod,assessmentId:quizId,kind:assessmentKind(mode,quizId)}));}
  function topicProgress(pct){return send('progressed',topicActivity(topicId(),topicTitle()),{extensions:{'https://w3id.org/xapi/cmi5/result/extensions/progress':Math.max(0,Math.min(100,pct))}},context({kind:'learning'}));}
  function topicReset(){var ex={};ex['https://w3id.org/xapi/cmi5/result/extensions/progress']=0;ex[EXT.progressReset]=true;return send('progressed',topicActivity(topicId(),topicTitle()),{extensions:ex},context({kind:'learning'}));}
  function courseProgress(pct){return send('progressed',act(BASE+'/course-progress','Biochemistry Companion progress',TYPES.course),{extensions:{'https://w3id.org/xapi/cmi5/result/extensions/progress':Math.max(0,Math.min(100,pct))}},context({topicId:'hub',topicTitle:'Biochemistry Companion',kind:'learning'}));}
  function hubKind(mode){return mode==='adaptive'||mode==='flagged'?'remediation':'practice';}
  function hubAssessment(mode){var names={adaptive:'Biochemistry Adaptive Review',flagged:'Flagged Question Review',normal:'Biochemistry Practice Exam',practice:'Biochemistry Practice Exam'};return act(BASE+'/hub/assessments/'+enc(mode||'normal'),names[mode]||'Biochemistry Practice Exam',TYPES.assessment);}
  function hubExamAttempt(mode,attemptNo){var r={extensions:{}};r.extensions[EXT.attempt]=attemptNo||1;return send('attempted',hubAssessment(mode),r,context({omitTopic:true,scope:'cross-topic',assessmentId:mode||'normal',kind:hubKind(mode)}));}
  function hubExamQuestion(mode,tid,q,response,success,attemptNo){var skipped=response===null;var r={completion:!skipped,extensions:{}};if(!skipped){r.response=String(response);r.success=!!success;}else{r.extensions[EXT.skipped]=true;}r.extensions[EXT.attempt]=attemptNo||1;return send('answered',choiceActivity(tid,q),r,context({topicId:tid,topicTitle:tid,parent:hubAssessment(mode),concept:q.area,questionId:q.id,assessmentId:mode||'normal',kind:hubKind(mode)}));}
  function hubExamComplete(mode,pct,correct,total,attemptNo){var r={completion:true,score:{scaled:total?correct/total:0,raw:correct,min:0,max:total},extensions:{}};r.extensions[EXT.percent]=pct;r.extensions[EXT.attempt]=attemptNo||1;return send('completed',hubAssessment(mode),r,context({omitTopic:true,scope:'cross-topic',assessmentId:mode||'normal',kind:hubKind(mode)}));}
  g.LearningRecord={VERSION:'3.4',BASE:BASE,EXT:EXT,section:section,sectionCompleted:sectionCompleted,moduleCompleted:moduleCompleted,activityCompleted:activityCompleted,checkpoint:checkpoint,quizAttempt:quizAttempt,quizQuestion:quizQuestion,quizComplete:quizComplete,topicProgress:topicProgress,topicReset:topicReset,courseProgress:courseProgress,hubExamAttempt:hubExamAttempt,hubExamQuestion:hubExamQuestion,hubExamComplete:hubExamComplete,conceptId:conceptId,flush:flush,clearLocal:clearLocal,syncStatus:syncStatus};
})(window);
