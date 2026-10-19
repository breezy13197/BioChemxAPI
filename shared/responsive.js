(function(){
 function containTables(){document.querySelectorAll('table').forEach(function(table){
  if(table.parentElement.classList.contains('table-scroll'))return;
  var wrapper=document.createElement('div');wrapper.className='table-scroll';
  wrapper.tabIndex=0;wrapper.setAttribute('role','region');
  var caption=table.querySelector('caption');
  wrapper.setAttribute('aria-label',(caption?caption.textContent:'Data table')+' — scroll horizontally if needed');
  table.before(wrapper);wrapper.appendChild(table);
  var hint=document.createElement('div');hint.className='table-scroll-hint';
  hint.textContent='↔ Scroll table horizontally if needed';wrapper.before(hint);
 });}
 function start(){containTables();new MutationObserver(containTables).observe(document.body,{childList:true,subtree:true});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
