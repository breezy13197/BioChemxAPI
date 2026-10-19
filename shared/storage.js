/* ============================================================
   COMPANION STORAGE — shared across every topic
   Defines `state`, the one object every other script reads and
   writes progress through. Loads right after the bank file (it
   needs TOPIC_ID for a per-topic storage key) and before both the
   content script and engine.js (they both read/write `state` as
   soon as they run, not just inside click handlers).
   ============================================================ */
var KEY='companion.'+(typeof TOPIC_ID!=='undefined'?TOPIC_ID:'default')+'.v1', memory={};
var storageWorks=(function(){try{localStorage.setItem('__t','1');localStorage.removeItem('__t');return true;}catch(e){return false;}})();
function storeGet(k){if(typeof LearningStore!=='undefined')return LearningStore.get(k);return storageWorks?localStorage.getItem(k):memory[k];}
function storeSet(k,v){if(typeof LearningStore!=='undefined'){LearningStore.set(k,v);return;}if(storageWorks)localStorage.setItem(k,v);else memory[k]=v;}
function storeRemove(k){if(typeof LearningStore!=='undefined'){LearningStore.remove(k);return;}if(storageWorks)localStorage.removeItem(k);else delete memory[k];}
function loadState(){
  /* `flags` holds question ids the student marked "come back to this"
     after grading a quiz or the mastery exam: {questionId: timestamp}.
     It lives here rather than in the hub so a companion stays
     self-contained, and so flags travel automatically with this
     companion's progress in a hub backup file. The hub reads these to
     build its Flagged questions list, and is the one place a flag can
     be cleared from outside this page.

     `lastSection` holds the FLOW key of the section the student was
     last on (e.g. "m2s3"), written by engine.js's goTo() on every
     navigation. It powers "continue where I left off" on the next
     visit — see engine.js for how the starting section is resolved.

     `areaStats` holds real per-concept-area evidence from graded quiz
     questions: {area: {asked, right, lastAcc, lastTs}}. engine.js's
     grade() already computes exactly this breakdown (byArea) for every
     quiz submission to render the "Mastery by concept area" panel —
     this is that same data, kept, instead of discarded once the panel
     is drawn. It's updated on EVERY submission (a retake, a mastery
     round, not just a new personal best), because each one is real
     evidence about specific concepts, even when the overall score
     isn't a new high. The hub's weaknessMap() reads this instead of
     spreading a quiz's single overall score across every area the
     quiz happens to touch. */
  var blank={checks:{},activities:{},best:{},flags:{},lastSection:null,areaStats:{},progressEpoch:0,progressSnapshot:null,telemetry:{checkpointAttempts:{},quizAttempts:{},sectionsReported:{},modulesReported:{},activitiesReported:{}}};
  try{var raw=storeGet(KEY),parsed=raw?JSON.parse(raw):null;
      var out=parsed?Object.assign(blank,parsed):blank;
      if(!out.telemetry||typeof out.telemetry!=='object')out.telemetry={checkpointAttempts:{},quizAttempts:{},sectionsReported:{},modulesReported:{},activitiesReported:{}};
      ['checkpointAttempts','quizAttempts','sectionsReported','modulesReported','activitiesReported'].forEach(function(k){if(!out.telemetry[k]||typeof out.telemetry[k]!=='object')out.telemetry[k]={};});
      /* Existing v1 activity completions predate telemetry; mark them as already reported so migration does not fabricate historical learning events. */
      if(parsed&&!parsed.telemetry){out.telemetry.migratedLegacy=true;Object.keys(out.activities||{}).forEach(function(k){if(out.activities[k]!==null&&out.activities[k]!==undefined)out.telemetry.activitiesReported[k]=1;});}
      return out;}catch(e){return blank;}
}
function saveState(){try{
  if(!state.telemetry)state.telemetry={checkpointAttempts:{},quizAttempts:{},sectionsReported:{},modulesReported:{},activitiesReported:{}};
  if(!state.telemetry.activitiesReported)state.telemetry.activitiesReported={};
  Object.keys(state.activities||{}).forEach(function(k){
    var v=state.activities[k];
    if(v!==null&&v!==undefined&&!state.telemetry.activitiesReported[k]){
      state.telemetry.activitiesReported[k]=1;
      if(typeof LearningRecord!=='undefined'){
        var secKey=null;
        if(typeof SECTION_REQ!=='undefined')Object.keys(SECTION_REQ).some(function(s){if(SECTION_REQ[s]&&SECTION_REQ[s].activity===k){secKey=s;return true;}return false;});
        LearningRecord.activityCompleted(k,v,secKey);
      }
    }
  });
  var raw=JSON.stringify(state);storeSet(KEY,raw);
}catch(e){}}
var state=loadState();
