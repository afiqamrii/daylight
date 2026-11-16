import {defaultState,validateState,planTasks,remainingSeconds,localDayKey,formatMinutes} from './core.mjs';
import {initRituals,getRituals,validateRituals,restoreRituals} from './rituals.mjs';
import {initJoys,getJoys,validateJoys,restoreJoys} from './joys.mjs';
import {initGames,getGames,validateGames,restoreGames} from './games.mjs';
import {initDaily,getDaily,validateDaily,restoreDaily} from './daily.mjs';
import {initHelper,getHelper,validateHelper,restoreHelper} from './helper.mjs';
import {makeContext} from './helper-core.mjs';

const $ = (s, parent=document) => parent.querySelector(s);
const $$ = (s, parent=document) => [...parent.querySelectorAll(s)];
const STORAGE_KEY='daylight.planner.v1';
const paths={sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',headphones:'<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v8h4v-8H4m16 0h1v8h-4v-8h3"/>',feather:'<path d="m4 20 9-9M8 16c-1-5 1-11 6-12 5-2 8 0 6 5-2 5-7 8-12 7Zm5-5h5"/>',sparkles:'<path d="m10 3 2.5 6.5L19 12l-6.5 2.5L10 21l-2.5-6.5L1 12l6.5-2.5L10 3Zm9-1 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"/>',play:'<path d="m8 5 11 7-11 7Z"/>',pause:'<path d="M7 5h3v14H7zm7 0h3v14h-3z"/>',check:'<path d="m5 12 4 4L19 6"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15l-1 5Z"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',leaf:'<path d="M4 20 16 8M6 18C1 4 15 3 21 3c0 6-1 20-15 15Z"/>'};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.sun}</svg>`;
$$('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
let state=defaultState(),tab='today',storageOK=true,storageCorrupt=false,toastTimeout,toastUndo=null,lastDay=localDayKey(),notesTimeout;
let currentSpace='today',spaceTransition=null;
const spaces=['today','rituals','joys','games','helper'];let pendingSessionDialog=null;
try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)state=validateState(JSON.parse(raw));}catch(error){storageOK=false;storageCorrupt=true;}
const id=()=>globalThis.crypto?.randomUUID?.() || `d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};

function save(){
  if(storageCorrupt)return false;
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));storageOK=true;}
  catch{storageOK=false;}
  const status=$('#save-status');status.textContent=storageOK?'Saved on this device':'Not saved — make a backup';status.classList.toggle('failed',!storageOK);
  return storageOK;
}
function toast(message,undo=null){clearTimeout(toastTimeout);toastUndo=undo;$('#toast-message').textContent=message;$('#toast-action').hidden=!undo;$('#toast').hidden=false;toastTimeout=setTimeout(()=>$('#toast').hidden=true,undo?12000:6000);}
$('#toast-close').onclick=()=>$('#toast').hidden=true;
$('#toast-action').onclick=()=>{const action=toastUndo;toastUndo=null;$('#toast').hidden=true;action?.();};
function switchSpace(next,animate=true){
  if(!spaces.includes(next))next='today';
  if(next===currentSpace)return;
  const apply=()=>{currentSpace=next;$$('[data-space]').forEach(b=>{if(b.dataset.space===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$$('.space-view').forEach(panel=>panel.hidden=panel.id!==`${next}-view`);$('.space-nav').style.setProperty('--space-index',String(spaces.indexOf(next)));history.replaceState(null,'',`#${next}`);renderTimer();};
  spaceTransition?.skipTransition?.();
  if(animate&&document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches){spaceTransition=document.startViewTransition(apply);spaceTransition.finished.catch(()=>{}).finally(()=>spaceTransition=null);}else apply();
}
$$('[data-space]').forEach(b=>b.onclick=()=>switchSpace(b.dataset.space));
const focusReturn=el('button','focus-return');focusReturn.type='button';focusReturn.hidden=true;focusReturn.onclick=()=>{switchSpace('today');$('.focus-card').scrollIntoView({behavior:'smooth',block:'center'});};$('.header-actions').prepend(focusReturn);
function update(){save();render();}
function actionButton(name,label,fn,cls=''){const b=el('button',`row-action ${cls}`);b.type='button';b.innerHTML=icon(name);b.title=label;b.setAttribute('aria-label',label);b.onclick=fn;return b;}

function render(){
  const today=new Date();$('#today-date').textContent=new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(today).toUpperCase();
  const pending=state.tasks.filter(t=>!t.done&&t.bucket==='today');
  const finishedToday=state.tasks.filter(t=>t.done&&t.completedAt&&localDayKey(new Date(t.completedAt))===localDayKey());
  const minutes=state.sessions.filter(s=>localDayKey(new Date(s.at))===localDayKey()).reduce((n,s)=>n+s.minutes,0);
  $('#capacity').value=state.capacity;
  $('#task-stat').replaceChildren(document.createTextNode(String(finishedToday.length)),el('span','',`/ ${pending.length+finishedToday.length}`));
  $('#focus-stat').replaceChildren(document.createTextNode(String(Math.round(minutes))),el('span','','min'));
  const total=finishedToday.length+pending.length,pct=total?finishedToday.length/total*100:0;
  $('#progress-ring').style.background=`conic-gradient(#74865b ${pct}%,#dbe0ce ${pct}%)`;
  $('#progress-title').textContent=total&&pending.length===0?'Room to breathe':finishedToday.length?'Look at you go':'A fresh start';
  $('#progress-copy').textContent=total&&pending.length===0?'Today’s list is complete.':finishedToday.length?'One small win at a time.':'Small steps count, too.';
  $('#active-count').textContent=String(state.tasks.filter(t=>!t.done).length);
  $('#today-count').textContent=String(pending.length);$('#later-count').textContent=String(state.tasks.filter(t=>!t.done&&t.bucket==='later').length);$('#done-count').textContent=String(state.tasks.filter(t=>t.done).length);
  $('#sample-button').hidden=state.tasks.length>0;
  $$('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
  $('#task-panel').setAttribute('aria-labelledby',`tab-${tab}`);
  $('#task-form').hidden=tab==='done';
  $('#task-title').placeholder=tab==='later'?'Something for another day?':'What would you like to get done?';
  renderTasks();renderPlan();renderFocusOptions();renderTimer();
}
function renderTasks(){
  const list=$('#task-list');list.replaceChildren();
  const tasks=state.tasks.filter(t=>tab==='done'?t.done:!t.done&&t.bucket===tab);
  if(tab==='done')tasks.sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt));
  if(!tasks.length){
    const empty=el('div','empty-state');const art=el('div','empty-art');art.innerHTML=icon(tab==='done'?'check':tab==='later'?'leaf':'sun');
    const titles={today:'Start with one small thing.',later:'Save it for another day.',done:'Good things take a first step.'};
    const copy={today:'Add what’s on your mind. We’ll help you make a little space for it.',later:'Keep future ideas here, so today has a little more breathing room.',done:'Your finished tasks will land here. Every small win belongs.'};
    empty.append(art,el('h3','',titles[tab]),el('p','',copy[tab]));
    if(tab==='today'){const b=el('button','text-button','Add your first task  ↗');b.onclick=()=>$('#task-title').focus();empty.append(b);}
    list.append(empty);
  }
  for(const task of tasks){
    const row=el('div',`task-row${task.done?' completed':''}`);row.dataset.taskId=task.id;
    const check=el('button','task-check');check.type='button';check.setAttribute('aria-label',`${task.done?'Reopen':'Complete'} ${task.title}`);check.setAttribute('aria-pressed',String(task.done));if(task.done)check.innerHTML=icon('check');check.onclick=()=>toggleTask(task.id);
    const copy=el('div','task-copy');copy.append(el('span','task-name',task.title));const meta=el('div','task-meta');meta.append(el('span','',formatMinutes(task.minutes)));
    const priority=el('span',`priority-tag ${task.priority}`);priority.append(el('span','priority-dot'),document.createTextNode(task.priority==='normal'?'Normal':task.priority==='high'?'High priority':'Low priority'));meta.append(priority);copy.append(meta);
    const controls=el('div','task-controls');
    if(!task.done)controls.append(actionButton('play',`Focus on ${task.title}`,()=>selectTask(task.id),'focus-action'));
    controls.append(actionButton('edit',`Edit ${task.title}`,()=>editTask(task.id)));
    row.append(check,copy,controls);list.append(row);
  }
  $('#task-summary').textContent=tasks.length?`${tasks.length} ${tasks.length===1?'task':'tasks'} · ${formatMinutes(tasks.reduce((n,t)=>n+t.minutes,0))} ${tab==='done'?'estimated in total':'estimated'}`:tab==='today'?'A clear page. A fresh possibility.':tab==='later'?'Some things can wait.': 'Progress begins with showing up.';
}
function renderPlan(){
  const planned=planTasks(state.tasks,state.capacity),pending=state.tasks.filter(t=>!t.done&&t.bucket==='today');const used=planned.reduce((n,t)=>n+t.minutes,0);
  $('#plan-budget').textContent=`${formatMinutes(state.capacity)} available`;const list=$('#plan-list');list.replaceChildren();
  $('#plan-description').textContent=!pending.length?'Add your tasks above. We’ll suggest a realistic shortlist, starting with your highest priorities.':!planned.length?'Your tasks need a little more time. Try a smaller estimate, split a task, or increase your available minutes.':`${planned.length===1?'A good place to start':`${planned.length} small steps to move you forward`}. Higher priorities come first; everything here fits your time.`;
  planned.forEach((task,i)=>{const item=el('li','plan-item');const b=el('button','plan-focus');b.type='button';b.innerHTML=icon('play');b.setAttribute('aria-label',`Focus on ${task.title}`);b.title=`Focus on ${task.title}`;b.onclick=()=>selectTask(task.id);item.append(el('span','plan-number',String(i+1).padStart(2,'0')),el('span','plan-item-title',task.title),el('span','plan-item-time',formatMinutes(task.minutes)),b);list.append(item);});
  const note=$('#plan-note');note.hidden=!planned.length;note.textContent=`${formatMinutes(used)} planned · ${formatMinutes(state.capacity-used)} left for breathing room${pending.length>planned.length?` · ${pending.length-planned.length} ${pending.length-planned.length===1?'task stays':'tasks stay'} on your list`:''}`;
}
function renderFocusOptions(){
  const select=$('#focus-task');const current=state.timer.taskId;select.replaceChildren(new Option('An open focus session',''));
  state.tasks.filter(t=>!t.done||t.id===current).forEach(t=>select.add(new Option(t.title,t.id)));
  select.value=current||'';select.disabled=Boolean(state.timer.endAt)||remainingSeconds(state.timer)<state.timer.totalSeconds;
}
function renderTimer(){
  const seconds=remainingSeconds(state.timer),running=Boolean(state.timer.endAt),started=seconds<state.timer.totalSeconds;
  const time=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  $('#timer-display').textContent=time;$('#timer-display').setAttribute('aria-label',`${Math.floor(seconds/60)} minutes ${seconds%60} seconds remaining`);
  $('#timer-progress').style.strokeDashoffset=String(678.584*(1-seconds/(state.timer.totalSeconds||1)));
  $('#timer-caption').textContent=running?'JUST THIS MOMENT. JUST THIS THING.':started?'TAKE A BREATH. COME BACK WHEN READY.':'A LITTLE TIME, WELL SPENT';
  $('#timer-toggle-text').textContent=running?'Pause for a moment':started?'Keep going':'Start focusing';$('#timer-toggle > span:first-child').innerHTML=icon(running?'pause':'play');
  $('#timer-finish').disabled=state.timer.totalSeconds-seconds<1;
  $$('[data-duration]').forEach(b=>{b.setAttribute('aria-pressed',String(Number(b.dataset.duration)*60===state.timer.totalSeconds));b.disabled=running||started;});
  $('#focus-task').disabled=running||started;
  document.title=running?`${time} · Focus — Daylight`:'Daylight — A lighter day';
  focusReturn.hidden=!(running&&currentSpace!=='today');focusReturn.textContent=`◷ ${time} · focus`;
}
function setTab(next){tab=next;render();}
$$('[data-tab]').forEach(b=>{b.onclick=()=>setTab(b.dataset.tab);b.onkeydown=e=>{const tabs=$$('[data-tab]');let index=tabs.indexOf(b);if(e.key==='ArrowRight')index=(index+1)%tabs.length;else if(e.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else return;e.preventDefault();setTab(tabs[index].dataset.tab);tabs[index].focus();};});
$('#task-form').onsubmit=e=>{e.preventDefault();const title=$('#task-title').value.trim(),minutes=Number($('#task-minutes').value);if(!title){$('#task-title').setCustomValidity('Give this task a short name.');$('#task-title').reportValidity();return;}if(state.tasks.length>=2000){toast('Your planner is full. Export a backup, then remove older tasks.');return;}if(!Number.isInteger(minutes)||minutes<5||minutes>480)return;state.tasks.push({id:id(),title,minutes,priority:$('#task-priority').value,bucket:tab==='later'?'later':'today',done:false,createdAt:new Date().toISOString(),completedAt:null});$('#task-title').value='';update();$('#task-title').focus();toast('A little less on your mind. Task added.');};
$('#task-title').oninput=()=>$('#task-title').setCustomValidity('');
$('#capacity').onchange=()=>{const value=Number($('#capacity').value);if(!Number.isInteger(value)||value<5||value>1440){toast('Choose between 5 and 1,440 available minutes.');$('#capacity').value=state.capacity;return;}state.capacity=value;update();};
$('#capacity').oninput=()=>{const value=Number($('#capacity').value);if(Number.isInteger(value)&&value>=5&&value<=1440){state.capacity=value;save();renderPlan();}};
function celebrateAt(target){if(!target||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const rect=target.getBoundingClientRect(),burst=el('span','small-celebration');burst.setAttribute('aria-hidden','true');burst.style.left=`${rect.left+rect.width/2}px`;burst.style.top=`${rect.top+rect.height/2}px`;for(let i=0;i<7;i++){const fleck=el('i');fleck.style.setProperty('--dx',`${Math.cos(i/7*Math.PI*2)*32}px`);fleck.style.setProperty('--dy',`${Math.sin(i/7*Math.PI*2)*28-12}px`);fleck.style.setProperty('--spin',`${i*67}deg`);burst.append(fleck);}document.body.append(burst);setTimeout(()=>burst.remove(),850);}
function toggleTask(taskId){const task=state.tasks.find(t=>t.id===taskId);if(!task)return;const row=$(`[data-task-id="${CSS.escape(taskId)}"]`),index=$$('.task-row').indexOf(row);if(!task.done)celebrateAt($('.task-check',row));task.done=!task.done;task.completedAt=task.done?new Date().toISOString():null;update();const remaining=$$('.task-row .task-check');(remaining[Math.min(index,remaining.length-1)]||$('#task-title')||$(`[data-tab="${tab}"]`))?.focus({preventScroll:true});toast(task.done?'One small win. Nicely done.':'Task moved back to your list.',()=>toggleTaskSilently(taskId));}
function toggleTaskSilently(taskId){const task=state.tasks.find(t=>t.id===taskId);if(!task)return;task.done=!task.done;task.completedAt=task.done?new Date().toISOString():null;update();}
function selectTask(taskId){const t=state.tasks.find(t=>t.id===taskId);if(!t)return;if(state.timer.endAt||remainingSeconds(state.timer)<state.timer.totalSeconds){toast('Finish or reset your current session before switching tasks.');return;}state.timer.taskId=taskId;update();$('.focus-card').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});$('#timer-toggle').focus({preventScroll:true});toast(`Ready when you are: ${t.title}`);}
$('#focus-task').onchange=()=>{state.timer.taskId=$('#focus-task').value||null;save();};
$$('[data-duration]').forEach(b=>b.onclick=()=>{if(state.timer.endAt||remainingSeconds(state.timer)<state.timer.totalSeconds)return;state.timer.totalSeconds=Number(b.dataset.duration)*60;state.timer.remainingSeconds=state.timer.totalSeconds;state.timer.endAt=null;update();});
$('#timer-toggle').onclick=()=>{const timer=state.timer;if(timer.endAt){timer.remainingSeconds=remainingSeconds(timer);timer.endAt=null;if(timer.remainingSeconds===0){completeSession(false);return;}}else{if(timer.remainingSeconds<=0)timer.remainingSeconds=timer.totalSeconds;timer.endAt=Date.now()+timer.remainingSeconds*1000;}update();};
function resetTimer(){state.timer.remainingSeconds=state.timer.totalSeconds;state.timer.endAt=null;update();}
$('#timer-reset').onclick=()=>{if(state.timer.endAt||remainingSeconds(state.timer)<state.timer.totalSeconds){confirmAction('Reset this session?','The elapsed time in this session won’t be added to your focus total. Use “Finish early” if you want to keep it.','Reset timer',()=>{resetTimer();toast('Fresh timer. Fresh start.');});}else{resetTimer();toast('Ready for a fresh focus session.');}};
$('#timer-finish').onclick=()=>completeSession(true);
function completeSession(early){
  const seconds=early?state.timer.totalSeconds-remainingSeconds(state.timer):state.timer.totalSeconds;
  if(seconds<1)return;
  const task=state.tasks.find(t=>t.id===state.timer.taskId),minutes=seconds/60;
  state.sessions.push({id:id(),taskId:task?.id||null,taskTitle:task?.title||'Open focus session',minutes,at:new Date().toISOString()});
  if(state.sessions.length>10000)state.sessions=state.sessions.slice(-10000);
  resetTimer();
  const wrap=el('div','dialog-success');const heading=el('h2','',early?'Every minute counts.':'You made a little progress.');heading.id='dialog-title';dialog.setAttribute('aria-labelledby','dialog-title');wrap.append(el('span','success-sun','✳'),el('div','eyebrow small','A MOMENT WELL SPENT'),heading,el('p','',`${minutes<1?'Less than a minute':formatMinutes(Math.round(minutes))} of focus saved. ${task?`You showed up for “${task.title}”.`:'You made space for something that matters.'} Take a breath before your next step.`));
  const actions=el('div','dialog-actions');const close=el('button','secondary-button','Take a breather');close.onclick=closeDialog;actions.append(close);
  if(task&&!task.done){const done=el('button','primary-button','Mark task done');done.onclick=()=>{task.done=true;task.completedAt=new Date().toISOString();update();closeDialog();toast('Task complete. That’s a little weight lifted.');};actions.append(done);}wrap.append(actions);if(document.querySelector('dialog[open]')){pendingSessionDialog=wrap;toast('Your focus session is complete and saved. Finish what you’re editing first.');}else openDialog(wrap);
}
setInterval(()=>{if(state.timer.endAt&&remainingSeconds(state.timer)===0)completeSession(false);else renderTimer();if(lastDay!==localDayKey()){lastDay=localDayKey();render();}},500);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(state.timer.endAt&&remainingSeconds(state.timer)===0)completeSession(false);else render();}});

$('#notes').value=state.notes;
$('#notes').oninput=()=>{state.notes=$('#notes').value;$('#notes-status').textContent='Saving your thought…';clearTimeout(notesTimeout);notesTimeout=setTimeout(()=>$('#notes-status').textContent=save()?'Just for you. Saved as you type.':'Not saved. Please make a backup.',350);};
addEventListener('pagehide',()=>{clearTimeout(notesTimeout);save();});
addEventListener('storage',e=>{if(e.key!==STORAGE_KEY||!e.newValue)return;try{state=validateState(JSON.parse(e.newValue));$('#notes').value=state.notes;render();toast('Planner updated from another tab.');}catch{toast('Could not read an update from another tab. Your current view is unchanged.');}});
document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='n'&&currentSpace==='today'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#app-dialog').open){e.preventDefault();if(tab==='done')setTab('today');$('#task-title').focus();}});

const dialog=$('#app-dialog');let previousFocus;
function openDialog(content){if(!dialog.open)previousFocus=document.activeElement;$('#dialog-content').replaceChildren(content);if(!dialog.open)dialog.showModal();}
function closeDialog(){dialog.close();}
dialog.addEventListener('close',()=>previousFocus?.isConnected&&previousFocus.focus({preventScroll:true}));
document.addEventListener('close',()=>{if(pendingSessionDialog)setTimeout(()=>{if(!document.querySelector('dialog[open]')&&pendingSessionDialog){const content=pendingSessionDialog;pendingSessionDialog=null;dialog.setAttribute('aria-labelledby','dialog-title');openDialog(content);}},0);},true);
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
function dialogShell(title){const box=el('div');const heading=el('div','dialog-heading');const h=el('h2','',title);h.id='dialog-title';dialog.setAttribute('aria-labelledby','dialog-title');const close=actionButton('close','Close dialog',closeDialog,'icon-btn');heading.append(h,close);box.append(heading);return box;}
function confirmAction(title,copy,label,action,danger=false){const box=dialogShell(title);box.append(el('p','',copy));const actions=el('div','dialog-actions');const cancel=el('button','secondary-button','Keep it');cancel.onclick=closeDialog;const yes=el('button',danger?'danger-button':'primary-button',label);yes.onclick=()=>{closeDialog();action();};actions.append(cancel,yes);box.append(actions);openDialog(box);}
function editTask(taskId){
  const task=state.tasks.find(t=>t.id===taskId);if(!task)return;
  const box=dialogShell('A little adjustment');const form=el('form');
  function field(labelText,node,name){node.id=name;const label=el('label','dialog-label',labelText);label.htmlFor=name;form.append(label,node);return node;}
  const title=field('Task',el('input'),'edit-title');title.value=task.title;title.maxLength=160;title.required=true;
  const mins=field('Estimated minutes',el('input'),'edit-minutes');mins.type='number';mins.min='5';mins.max='480';mins.step='5';mins.value=task.minutes;mins.required=true;
  const priority=field('Priority',el('select'),'edit-priority');['high','normal','low'].forEach(v=>priority.add(new Option(`${v[0].toUpperCase()+v.slice(1)} priority`,v)));priority.value=task.priority;
  const bucket=field('Keep this in',el('select'),'edit-bucket');bucket.add(new Option('Today','today'));bucket.add(new Option('Later','later'));bucket.value=task.bucket;
  const actions=el('div','dialog-actions');const del=el('button','text-button','Delete task');del.type='button';del.style.marginRight='auto';del.onclick=()=>{const index=state.tasks.indexOf(task);state.tasks.splice(index,1);if(state.timer.taskId===taskId){state.timer.taskId=null;}update();closeDialog();toast('Task removed.',()=>{state.tasks.splice(index,0,task);update();});};
  const cancel=el('button','secondary-button','Cancel');cancel.type='button';cancel.onclick=closeDialog;const submit=el('button','primary-button','Save changes');submit.type='submit';actions.append(del,cancel,submit);form.append(actions);
  form.onsubmit=e=>{e.preventDefault();if(!title.value.trim()){title.setCustomValidity('Give this task a short name.');title.reportValidity();return;}title.setCustomValidity('');task.title=title.value.trim();task.minutes=Number(mins.value);task.priority=priority.value;task.bucket=bucket.value;update();closeDialog();($(`[data-task-id="${CSS.escape(taskId)}"] .task-controls button:last-child`)||$('#task-title'))?.focus({preventScroll:true});toast('A little adjustment, saved.');};title.oninput=()=>title.setCustomValidity('');box.append(form);openDialog(box);
}
$('#sample-button').onclick=()=>{if(state.tasks.length)return;const now=new Date().toISOString();state.tasks=[{title:'Make progress on one important thing',minutes:50,priority:'high',bucket:'today'},{title:'Clear a little space — desk or inbox',minutes:15,priority:'normal',bucket:'today'},{title:'Step outside for a short walk',minutes:20,priority:'normal',bucket:'today'},{title:'An idea to come back to',minutes:30,priority:'low',bucket:'later'}].map(t=>({...t,id:id(),done:false,createdAt:now,completedAt:null}));update();toast('A sample day to try. Edit any task to make it yours.',()=>{state.tasks=[];state.timer.taskId=null;update();});};

function dataDialog(){const box=dialogShell('Keep your day with you.');box.append(el('p','','Daylight saves in this browser, on this device. Make a backup to keep a copy or move your planner to another browser.'));
  const options=el('div','data-options');const download=el('button');download.append(el('strong','','Download a backup'),el('span','','Your whole space: planner, rituals, journal, sketch, games, saved thoughts, reminders, and Kumo conversations.'));download.onclick=exportData;
  const restore=el('button');restore.append(el('strong','','Restore a backup'),el('span','','Choose a Daylight JSON file. You’ll review it before replacing your planner.'));const input=el('input');input.type='file';input.accept='.json,application/json';input.hidden=true;restore.onclick=()=>input.click();input.onchange=()=>readBackup(input.files?.[0]);options.append(download,restore,input);box.append(options,el('p','dialog-footnote','Your data stays in your browser. Clearing browser storage removes it. Backups are plain text, so keep them somewhere you trust.'));openDialog(box);}
function exportData(){state.notes=$('#notes').value;const snapshot=structuredClone(state);snapshot.timer.remainingSeconds=remainingSeconds(state.timer);snapshot.timer.endAt=null;snapshot.rituals=getRituals();snapshot.joys=getJoys();snapshot.games=getGames();snapshot.daily=getDaily();snapshot.helper=getHelper();const blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`daylight-backup-${localDayKey()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Backup downloaded. A little peace of mind.');}
async function readBackup(file){if(!file)return;if(file.size>8*1024*1024){toast('This file is too large. Choose a Daylight backup under 8 MB.');return;}try{const raw=JSON.parse(await file.text()),imported=validateState(raw),rituals=raw.rituals?validateRituals(raw.rituals):null,joys=raw.joys?validateJoys(raw.joys):null,games=raw.games?validateGames(raw.games):null,daily=raw.daily?validateDaily(raw.daily):null,helper=raw.helper?validateHelper(raw.helper):null;imported.timer.remainingSeconds=remainingSeconds(imported.timer);imported.timer.endAt=null;confirmAction('Restore your little space?',`This backup has ${imported.tasks.length} tasks and ${imported.sessions.length} focus ${imported.sessions.length===1?'session':'sessions'}${rituals?', rituals and journal':''}${joys?', Little joys':''}${games?', games':''}${daily?', daily thoughts and reminders':''}${helper?', and Kumo conversations':''}. It will replace those parts of your space in this browser. Make a current backup first if you want to keep it.`,'Restore backup',()=>{state=imported;storageCorrupt=false;if(rituals)restoreRituals(rituals);if(joys)restoreJoys(joys);if(games)restoreGames(games);if(daily)restoreDaily(daily);if(helper)restoreHelper(helper);$('#notes').value=state.notes;update();toast('Your little space is back. Welcome home.');});}catch{toast('This isn’t a valid Daylight backup. Your space hasn’t changed.');}}
$('#data-button').onclick=dataDialog;$('#footer-data').onclick=dataDialog;
$('#help-button').onclick=()=>{const box=dialogShell('A calmer way to begin.');const steps=el('ol','help-steps');[['Get it out of your head','Add a task, a realistic time estimate, and a priority. Keep tomorrow’s ideas in Later.'],['Make room for what matters','Set the time you have. Your shortlist considers higher priorities first and skips tasks that won’t fit. Nothing is removed from your list.'],['Give one thing your attention','Choose a task and a 15, 25, or 50-minute focus session. Pause anytime. Finish early to record the time you spent.'],['Keep your small wins','Check off finished tasks, jot down a thought, and download a backup whenever you like.']].forEach(([a,b])=>{const li=el('li');li.append(el('strong','',a),document.createTextNode(b));steps.append(li);});box.append(steps,el('p','dialog-footnote','The timer remembers its end time across reloads. Reopen Daylight after a session ends to record it. Focus minutes count toward the day they are saved. Tasks stay on your list until you complete or move them. Press N to add a task.'));openDialog(box);};

initRituals($('#rituals-view'),{toast});
initJoys($('#joys-view'),{toast});
initGames($('#games-view'),{toast});
initDaily($('#daily-note'),{toast,siteUrl:'https://daylight-focus-afiqa-1116.noisy-ring-6807.chatgpt.site'});
initHelper($('#helper-view'),{toast,getContext:()=>makeContext(state,getRituals()),openSpace:next=>{switchSpace(next,false);$('.space-nav').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});},focusTask:taskId=>{switchSpace('today',false);selectTask(taskId);},addTasks:tasks=>{if(state.tasks.length+tasks.length>2000){toast('Your planner is full. Make a backup and remove older tasks first.');return false;}for(const task of tasks)state.tasks.push({...task,id:id(),done:false,createdAt:new Date().toISOString(),completedAt:null});update();toast(`${tasks.length===1?'A small step':'Small steps'} added to your day.`);return true;}});
render();
switchSpace(location.hash.slice(1)||'today',false);
addEventListener('hashchange',()=>switchSpace(location.hash.slice(1)||'today',false));
if(storageCorrupt){$('#save-status').textContent='Storage needs attention';$('#save-status').classList.add('failed');const box=dialogShell('Your saved data needs a hand.');box.append(el('p','','Daylight couldn’t read the saved planner. It hasn’t overwritten it. You can restore a backup or start a fresh planner in this browser.'));const actions=el('div','dialog-actions');const restore=el('button','secondary-button','Restore a backup');restore.onclick=dataDialog;const fresh=el('button','primary-button','Start fresh');fresh.onclick=()=>confirmAction('Start a fresh planner?','This replaces the unreadable Daylight data in this browser.','Start fresh',()=>{storageCorrupt=false;state=defaultState();$('#notes').value='';update();},true);actions.append(restore,fresh);box.append(actions);openDialog(box);}
else if(state.timer.endAt&&remainingSeconds(state.timer)===0)completeSession(false);
