/* ============================================================
   LEARNING STORE — Beta RC2.6 durable State API mirror.
   - registration-scoped browser cache in cmi5 mode
   - pending State writes persist across page loads/relaunches
   - launch reconciles unsynced local work before replacing cache
   - failed writes remain pending and are retried
   - pagehide sends pending state with keepalive
   - ETag / If-Match conflict protection with field-aware 3-way merge
   - explicit local deletions/resets remain authoritative during merge
   ============================================================ */
(function(g){
  'use strict';
  var PREFIX='biochem-state:',CACHE_PREFIX='biochem-cache:',PENDING_PREFIX='biochem-pending:';
  var timers={},dirty={},retryTimers={},etags={},knownRemote={};
  var MISSING={__biochemMissing:true};
  function rt(){return g.CMI5Runtime&&g.CMI5Runtime.active?g.CMI5Runtime:null;}
  function registration(){var r=g.CMI5Runtime;return r&&r.context?r.context.registration:null;}
  function cacheKey(k){var reg=registration();return reg?CACHE_PREFIX+reg+':'+k:k;}
  function pendingKey(k){var reg=registration();return reg?PENDING_PREFIX+reg+':'+k:null;}
  function rawGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
  function rawSet(k,v){try{localStorage.setItem(k,v);return true;}catch(e){return false;}}
  function rawRemove(k){try{localStorage.removeItem(k);return true;}catch(e){return false;}}
  function localGet(k){var ck=cacheKey(k),v=rawGet(ck);if(v===null&&ck!==k)v=rawGet(k);return v;}
  function localSet(k,v){var ck=cacheKey(k),ok=rawSet(ck,v);if(ck!==k)rawRemove(k);return ok;}
  function localRemove(k){var ck=cacheKey(k);rawRemove(ck);if(ck!==k)rawRemove(k);}
  function query(k){var r=rt();if(!r)return null;return new URLSearchParams({activityId:r.context.activityId,agent:JSON.stringify(r.context.actor),registration:r.context.registration,stateId:PREFIX+k});}
  function ensureOk(resp,label){if(!resp.ok)throw new Error(label+' '+resp.status);return resp;}
  function rememberVersion(k,resp,exists){knownRemote[k]=!!exists;try{etags[k]=resp&&resp.headers&&resp.headers.get?resp.headers.get('ETag'):null;}catch(e){etags[k]=null;}}
  function remoteGet(k){var r=rt(),q=query(k);if(!r||!q)return Promise.resolve(null);return r.request(r.endpointPath('activities/state')+'?'+q.toString(),{method:'GET',headers:{Accept:'application/json'}}).then(function(resp){if(resp.status===404||resp.status===204){rememberVersion(k,resp,false);return null;}ensureOk(resp,'State GET');rememberVersion(k,resp,true);return resp.text();});}

  function dispatchSync(status,detail){
    detail=detail||{};detail.channel='state';detail.status=status;detail.pending=pendingCount();
    try{g.dispatchEvent(new CustomEvent('biochem-sync-status',{detail:detail}));}catch(e){}
  }
  function pendingCount(){
    var reg=registration(),n=0;if(!reg)return 0;var pre=PENDING_PREFIX+reg+':';
    try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(pre)===0)n++;}}catch(e){}
    return n;
  }
  function syncStatus(){var n=pendingCount();return {status:n?'pending':'saved',pending:n};}

  function loadPending(k){var pk=pendingKey(k);if(!pk)return null;try{var raw=rawGet(pk),o=raw?JSON.parse(raw):null;return o&&o.schema===1?o:null;}catch(e){return null;}}
  function savePending(k,rec){var pk=pendingKey(k);if(!pk)return false;rec=Object.assign({schema:1,updatedAt:Date.now()},rec||{});return rawSet(pk,JSON.stringify(rec));}
  function clearPending(k){var pk=pendingKey(k);if(pk)rawRemove(pk);}
  function pendingKeys(){var reg=registration(),out=[];if(!reg)return out;var pre=PENDING_PREFIX+reg+':';try{for(var i=0;i<localStorage.length;i++){var x=localStorage.key(i);if(x&&x.indexOf(pre)===0)out.push(x.slice(pre.length));}}catch(e){}return out;}
  function restoreDirtyFromPending(){pendingKeys().forEach(function(k){var p=loadPending(k);if(p)dirty[k]=Object.prototype.hasOwnProperty.call(p,'value')?p.value:null;});if(Object.keys(dirty).length)dispatchSync('pending');}

  function isPlain(o){return !!o&&o!==MISSING&&typeof o==='object'&&!Array.isArray(o);}
  function clone(v){if(v===MISSING)return MISSING;if(v===undefined)return undefined;try{return JSON.parse(JSON.stringify(v));}catch(e){return v;}}
  function deepEqual(a,b){
    if(a===b)return true;if(a===MISSING||b===MISSING)return false;
    if(typeof a!==typeof b||a===null||b===null)return false;
    if(Array.isArray(a)){if(!Array.isArray(b)||a.length!==b.length)return false;for(var i=0;i<a.length;i++)if(!deepEqual(a[i],b[i]))return false;return true;}
    if(isPlain(a)){if(!isPlain(b))return false;var ak=Object.keys(a).sort(),bk=Object.keys(b).sort();if(ak.length!==bk.length)return false;for(var j=0;j<ak.length;j++)if(ak[j]!==bk[j]||!deepEqual(a[ak[j]],b[bk[j]]))return false;return true;}
    return false;
  }
  function parseText(t){if(t===null||t===undefined||t==='')return MISSING;try{return JSON.parse(t);}catch(e){return t;}}
  function stringifyValue(v){if(v===MISSING)return null;return typeof v==='string'?v:JSON.stringify(v);}
  function pathToken(path){return path.join('.');}
  function detectResetPaths(baseText,localText){
    var base=parseText(baseText),local=parseText(localText),out=[];
    function walk(b,l,path){
      if(isPlain(b)&&isPlain(l)){
        var bk=Object.keys(b),lk=Object.keys(l);if(path.length&&bk.length>0&&lk.length===0){out.push(pathToken(path));return;}
        var keys={};bk.forEach(function(k){keys[k]=1;});lk.forEach(function(k){keys[k]=1;});Object.keys(keys).forEach(function(k){if(Object.prototype.hasOwnProperty.call(b,k)&&Object.prototype.hasOwnProperty.call(l,k))walk(b[k],l[k],path.concat(k));});
      }else if(Array.isArray(b)&&Array.isArray(l)&&path.length&&b.length>0&&l.length===0)out.push(pathToken(path));
    }
    walk(base,local,[]);
    /* A single map becoming empty can be an ordinary item deletion (for
       example unflagging the last flagged question). Treat it as a whole-
       collection reset only when the companion reset signature is present:
       several progress collections are cleared together. */
    var resetRoots=['checks','activities','best','flags','areaStats'],rootHits=resetRoots.filter(function(x){return out.indexOf(x)>=0;}).length;
    if(rootHits<3){out=out.filter(function(x){return resetRoots.indexOf(x)<0&&x!=='telemetry.sectionsReported'&&x!=='telemetry.modulesReported'&&x!=='telemetry.activitiesReported';});}
    return out;
  }
  function resetMap(paths){var m={};(paths||[]).forEach(function(p){m[p]=1;});return m;}
  function pathIs(path,parts){if(path.length!==parts.length)return false;for(var i=0;i<parts.length;i++)if(parts[i]!=='*'&&path[i]!==parts[i])return false;return true;}
  function num(v,d){return typeof v==='number'&&isFinite(v)?v:(d==null?0:d);}
  function additiveCounter(base,local,remote){
    var b=num(base,0),l=num(local,b),r=num(remote,b);
    /* A local decrease is an explicit reset and wins over concurrent increments. */
    if(l<b)return l;
    return b+Math.max(0,l-b)+Math.max(0,r-b);
  }
  function mergeHistory(base,local,remote){
    var seen={},out=[];function add(a){(Array.isArray(a)?a:[]).forEach(function(v){var sig=(v&&v.ts!=null?String(v.ts):'')+'|'+(v&&v.mode||'')+'|'+JSON.stringify(v);if(!seen[sig]){seen[sig]=1;out.push(clone(v));}});}add(remote);add(local);out.sort(function(a,b){return num(a&&a.ts,0)-num(b&&b.ts,0);});return out.slice(-60);
  }
  function mergeArea(base,local,remote,docKey,path,resets){
    var out=mergeObject(base,local,remote,docKey,path,resets);
    if(out===MISSING)return out;
    out.asked=additiveCounter(base&&base.asked,local&&local.asked,remote&&remote.asked);
    out.right=additiveCounter(base&&base.right,local&&local.right,remote&&remote.right);
    var lt=num(local&&local.lastTs,0),rtm=num(remote&&remote.lastTs,0);
    if(lt>=rtm){out.lastTs=lt;out.lastAcc=local&&Object.prototype.hasOwnProperty.call(local,'lastAcc')?clone(local.lastAcc):clone(remote&&remote.lastAcc);}else{out.lastTs=rtm;out.lastAcc=clone(remote&&remote.lastAcc);}
    return out;
  }
  function mergeProgressSnapshot(base,local,remote){
    var le=num(local&&local.epoch,0),re=num(remote&&remote.epoch,0);
    if(le!==re)return clone(le>re?local:remote);
    var lt=num(local&&local.updatedAt,0),rtm=num(remote&&remote.updatedAt,0);
    return clone(lt>=rtm?local:remote);
  }
  function mergeCheckpointAttempt(base,local,remote,docKey,path,resets){
    var out=mergeObject(base,local,remote,docKey,path,resets);if(out===MISSING)return out;
    out.attempts=additiveCounter(base&&base.attempts,local&&local.attempts,remote&&remote.attempts);
    var b=base&&base.firstCorrect,l=local&&local.firstCorrect,r=remote&&remote.firstCorrect;
    if(b!==null&&b!==undefined)out.firstCorrect=b;
    else if(l!==null&&l!==undefined&&r!==null&&r!==undefined)out.firstCorrect=!!l&&!!r; /* conservative if concurrent first attempts disagree */
    else if(l!==null&&l!==undefined)out.firstCorrect=!!l;
    else if(r!==null&&r!==undefined)out.firstCorrect=!!r;
    else out.firstCorrect=null;
    out.eventualCorrect=!!((local&&local.eventualCorrect)||(remote&&remote.eventualCorrect)||(base&&base.eventualCorrect));
    return out;
  }
  function mergeObject(base,local,remote,docKey,path,resets){
    var out={},keys={};[base,local,remote].forEach(function(o){if(isPlain(o))Object.keys(o).forEach(function(k){keys[k]=1;});});
    Object.keys(keys).forEach(function(k){var b=isPlain(base)&&Object.prototype.hasOwnProperty.call(base,k)?base[k]:MISSING,l=isPlain(local)&&Object.prototype.hasOwnProperty.call(local,k)?local[k]:MISSING,r=isPlain(remote)&&Object.prototype.hasOwnProperty.call(remote,k)?remote[k]:MISSING;var v=threeWay(b,l,r,docKey,path.concat(k),resets);if(v!==MISSING)out[k]=v;});return out;
  }
  function resolveScalar(base,local,remote,docKey,path){
    /* Monotonic/best fields. */
    if(path.length>=2&&path[0]==='best')return Math.max(num(local,0),num(remote,0));
    if(pathIs(path,['telemetry','sectionsReported','*'])||pathIs(path,['telemetry','modulesReported','*'])||pathIs(path,['telemetry','activitiesReported','*']))return (local===true||remote===true||num(local,0)>0||num(remote,0)>0)?1:0;
    if(pathIs(path,['telemetry','quizAttempts','*'])||pathIs(path,['telemetry','examAttempts','*']))return additiveCounter(base,local,remote);
    if(docKey==='hub.v1'&&path.length===3&&path[0]==='seen'&&(path[2]==='n'||path[2]==='ok'))return additiveCounter(base,local,remote);
    if(docKey==='cmi5.meta.v1'&&path.length===1&&path[0]==='completed')return !!local||!!remote;
    if(docKey==='cmi5.meta.v1'&&path.length===1&&path[0]==='completedAt'){
      var vals=[local,remote].filter(function(x){return typeof x==='string'&&x;}).sort();return vals.length?vals[0]:local;
    }
    if(path.length===1&&path[0]==='progressEpoch')return Math.max(num(local,0),num(remote,0));
    if(path.length&&path[path.length-1]==='lastTs')return Math.max(num(local,0),num(remote,0));
    if(path.length>=2&&path[0]==='flags'){
      if(typeof local==='number'&&typeof remote==='number')return Math.max(local,remote);
      if(isPlain(local)&&isPlain(remote)&&('ts' in local||'ts' in remote))return num(local.ts,0)>=num(remote.ts,0)?clone(local):clone(remote);
    }
    /* Latest local edit wins for non-monotonic scalar values. */
    return clone(local);
  }
  function threeWay(base,local,remote,docKey,path,resets){
    if(resets&&resets[pathToken(path)])return clone(local);
    if(deepEqual(local,base))return clone(remote);
    if(deepEqual(remote,base))return clone(local);
    /* Cumulative evidence must combine independent deltas even when both
       devices happen to arrive at the same visible count. */
    if(isPlain(local)&&isPlain(remote)&&pathIs(path,['progressSnapshot']))return mergeProgressSnapshot(base,local,remote);
    if(isPlain(local)&&isPlain(remote)&&path.length===2&&path[0]==='areaStats')return mergeArea(isPlain(base)?base:{},local,remote,docKey,path,resets);
    if(isPlain(local)&&isPlain(remote)&&path.length===3&&path[0]==='telemetry'&&path[1]==='checkpointAttempts')return mergeCheckpointAttempt(isPlain(base)?base:{},local,remote,docKey,path,resets);
    if(isPlain(local)&&isPlain(remote)&&(pathIs(path,['areaStats'])||pathIs(path,['telemetry','checkpointAttempts'])||pathIs(path,['telemetry','quizAttempts'])||pathIs(path,['telemetry','examAttempts'])||(docKey==='hub.v1'&&pathIs(path,['seen']))))return mergeObject(isPlain(base)?base:{},local,remote,docKey,path,resets);
    if((pathIs(path,['telemetry','quizAttempts','*'])||pathIs(path,['telemetry','examAttempts','*'])||(docKey==='hub.v1'&&path.length===3&&path[0]==='seen'&&(path[2]==='n'||path[2]==='ok')))&&typeof local==='number'&&typeof remote==='number')return resolveScalar(base,local,remote,docKey,path);
    if(deepEqual(local,remote))return clone(local);
    /* Explicit local deletion/reset marker wins if both sides changed. */
    if(local===MISSING)return MISSING;
    if(remote===MISSING)return clone(local);
    if(isPlain(local)&&isPlain(remote)){
      return mergeObject(isPlain(base)?base:{},local,remote,docKey,path,resets);
    }
    if(Array.isArray(local)&&Array.isArray(remote)){
      if(docKey==='hub.v1'&&path.length===1&&path[0]==='history')return mergeHistory(base,local,remote);
      return clone(local); /* latest local preference/activity state */
    }
    return resolveScalar(base,local,remote,docKey,path);
  }
  function mergeDocuments(docKey,baseText,localText,remoteText,resetPaths){
    /* Backward-compatible 2-argument form: mergeDocuments(remote, local). */
    if(arguments.length===2){remoteText=docKey;localText=baseText;baseText=null;docKey='';resetPaths=[];}
    var base=parseText(baseText),local=parseText(localText),remote=parseText(remoteText),merged=threeWay(base,local,remote,docKey,[],resetMap(resetPaths));return stringifyValue(merged);
  }

  function conditionalHeaders(k){var h={'Content-Type':'application/json'};if(etags[k])h['If-Match']=etags[k];else if(knownRemote[k]===false)h['If-None-Match']='*';return h;}
  function updatePendingAfterMerge(k,base,value){var p=loadPending(k)||{};savePending(k,{schema:1,base:base,value:value,resetPaths:p.resetPaths||[],updatedAt:p.updatedAt||Date.now()});dirty[k]=value;}
  function remoteSet(k,v,opts,conflicts){
    var r=rt(),q=query(k);if(!r||!q)return Promise.resolve();opts=opts||{};conflicts=conflicts||0;
    return r.request(r.endpointPath('activities/state')+'?'+q.toString(),{method:'PUT',headers:conditionalHeaders(k),body:v,keepalive:!!opts.keepalive}).then(function(resp){
      if(resp.status===409||resp.status===412){
        if(conflicts>=3)throw new Error('State PUT conflict could not be reconciled after retries');
        return remoteGet(k).then(function(remote){var p=loadPending(k),base=p&&Object.prototype.hasOwnProperty.call(p,'base')?p.base:null;var merged=mergeDocuments(k,base,v,remote,p&&p.resetPaths||[]);if(merged===null){localRemove(k);}else{localSet(k,merged);}updatePendingAfterMerge(k,remote,merged);return merged===null?remoteRemove(k,opts):remoteSet(k,merged,opts,conflicts+1);});
      }
      ensureOk(resp,'State PUT');rememberVersion(k,resp,true);clearPending(k);
    });
  }
  function remoteRemove(k,opts){var r=rt(),q=query(k);if(!r||!q)return Promise.resolve();opts=opts||{};var h={};if(etags[k])h['If-Match']=etags[k];return r.request(r.endpointPath('activities/state')+'?'+q.toString(),{method:'DELETE',headers:h,keepalive:!!opts.keepalive}).then(function(resp){if(resp.status===409||resp.status===412)throw new Error('State DELETE conflict: newer progress exists on another session');ensureOk(resp,'State DELETE');knownRemote[k]=false;etags[k]=null;clearPending(k);});}
  function markDirty(k,v,base){var p=loadPending(k),origin=p&&Object.prototype.hasOwnProperty.call(p,'base')?p.base:base;var resets=detectResetPaths(origin,v),seen={};((p&&p.resetPaths)||[]).concat(resets).forEach(function(x){seen[x]=1;});if(!p){p={schema:1,base:origin,value:v,resetPaths:Object.keys(seen),updatedAt:Date.now()};}else{p.value=v;p.resetPaths=Object.keys(seen);p.updatedAt=Date.now();}if(!savePending(k,p))console.warn('[cmi5] browser could not persist pending State write',k);dirty[k]=v;dispatchSync('saving',{key:k});}
  function schedule(k,delay){clearTimeout(timers[k]);timers[k]=setTimeout(function(){delete timers[k];writeDirty(k,false).catch(function(e){console.warn('[cmi5] state save failed; remains pending',k,e);dispatchSync('pending',{key:k,error:String(e&&e.message||e)});clearTimeout(retryTimers[k]);retryTimers[k]=setTimeout(function(){schedule(k,0);},1500);});},delay==null?250:delay);}
  function writeDirty(k,keepalive){
    if(!Object.prototype.hasOwnProperty.call(dirty,k)){var pp=loadPending(k);if(pp)dirty[k]=Object.prototype.hasOwnProperty.call(pp,'value')?pp.value:null;else return Promise.resolve();}
    var v=dirty[k];dispatchSync('saving',{key:k});var op=v===null?remoteRemove(k,{keepalive:keepalive}):remoteSet(k,v,{keepalive:keepalive});
    return op.then(function(){if(dirty[k]===v){delete dirty[k];clearPending(k);}dispatchSync(pendingCount()?'pending':'saved',{key:k});});
  }
  function get(k){return localGet(k);}
  function set(k,v){var prior=localGet(k);localSet(k,v);if(rt()){markDirty(k,v,prior);schedule(k,250);}return true;}
  function remove(k){var prior=localGet(k);localRemove(k);if(rt()){markDirty(k,null,prior);schedule(k,0);}}

  function reconcilePending(k,remote,p){
    var localVal=Object.prototype.hasOwnProperty.call(p,'value')?p.value:null;
    var merged=mergeDocuments(k,Object.prototype.hasOwnProperty.call(p,'base')?p.base:null,localVal,remote,p.resetPaths||[]);
    if(merged===null)localRemove(k);else localSet(k,merged);
    updatePendingAfterMerge(k,remote,merged);
    return writeDirty(k,false).then(function(){return {key:k,loaded:merged!==null,recovered:true,pending:false};}).catch(function(e){console.warn('[cmi5] recovered local progress is still pending sync',k,e);dispatchSync('pending',{key:k,error:String(e&&e.message||e)});return {key:k,loaded:merged!==null,recovered:true,pending:true};});
  }
  function preload(keys){
    if(!rt())return Promise.resolve([]);
    return Promise.all(keys.map(function(k){
      var p=loadPending(k);
      return remoteGet(k).then(function(v){
        if(p)return reconcilePending(k,v,p);
        if(v!==null&&v!==''){localSet(k,v);return {key:k,loaded:true};}
        localRemove(k);return {key:k,loaded:false};
      });
    })).then(function(rows){dispatchSync(pendingCount()?'pending':'saved');return rows;});
  }
  function flush(opts){
    opts=opts||{};if(!rt())return Promise.resolve();restoreDirtyFromPending();Object.keys(timers).forEach(function(k){clearTimeout(timers[k]);delete timers[k];});Object.keys(retryTimers).forEach(function(k){clearTimeout(retryTimers[k]);delete retryTimers[k];});var keys=Object.keys(dirty);if(!keys.length){dispatchSync('saved');return Promise.resolve();}
    dispatchSync('saving');return Promise.all(keys.map(function(k){return writeDirty(k,!!opts.keepalive);})).then(function(){restoreDirtyFromPending();return Object.keys(dirty).length?flush(opts):undefined;}).then(function(){dispatchSync(pendingCount()?'pending':'saved');}).catch(function(e){dispatchSync('pending',{error:String(e&&e.message||e)});throw e;});
  }
  function clearLocalProgress(){
    try{var reg=registration(),keys=[];for(var i=0;i<localStorage.length;i++)keys.push(localStorage.key(i));keys.forEach(function(k){if(/^companion\.[a-z]+\.v1$/.test(k)||k==='hub.v1'||k==='cmi5.meta.v1'||(reg&&k.indexOf(CACHE_PREFIX+reg+':')===0)||(reg&&k.indexOf(PENDING_PREFIX+reg+':')===0))rawRemove(k);});}catch(e){}
    dirty={};dispatchSync('saved');
  }
  if(g.addEventListener)g.addEventListener('pagehide',function(){flush({keepalive:true}).catch(function(e){console.warn('[cmi5] pagehide state flush failed; changes remain pending',e);});});

  g.LearningStore={get:get,set:set,remove:remove,preload:preload,flush:flush,remoteGet:remoteGet,remoteSet:remoteSet,clearLocalProgress:clearLocalProgress,mergeDocuments:mergeDocuments,syncStatus:syncStatus,pendingCount:pendingCount,_loadPending:loadPending};

  /* On normal in-course navigation the cmi5 session is restored before this script loads. */
  if(rt()){
    restoreDirtyFromPending();
    if(Object.keys(dirty).length)setTimeout(function(){flush().catch(function(e){console.warn('[cmi5] queued State changes remain pending',e);});},120);
    else dispatchSync('saved');
  }
})(window);
