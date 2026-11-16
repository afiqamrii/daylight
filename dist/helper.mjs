import {freshHelper,validateHelper,identifyHelper,mergeHelper,helperId,replyLocally,buildAIMessages} from './helper-core.mjs';
export {validateHelper} from './helper-core.mjs';
const KEY='daylight.helper.v1';
let state=freshHelper(),root=null,api={},view={},worker=null,ready=false,loading=false,busy=false,mode='helper',streamMessage=null,streamNode=null,loadTimeout=null,replyTimeout=null,blocked=false;
let lastStored=null,generation=0,activeReply=null,stopTimeout=null,checkpointTimeout=null,cleanup=null,contextDirty=false;
let presentation=null,revealTimer=null,thoughtTimer=null,replyPhase='';
const actionsByMessage=new Map();
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,cls,action)=>{const b=node('button',cls,text);b.type='button';b.onclick=action;return b;};
const snapshot=()=>JSON.parse(JSON.stringify(state));
export const getHelper=()=>{syncStored(true);return snapshot();};
function syncStored(render=false){
  if(typeof localStorage==='undefined')return true;
  try{
    const raw=localStorage.getItem(KEY);if(raw===lastStored)return true;
    const next=raw?identifyHelper(JSON.parse(raw)):freshHelper();
    if(next.chatId!==state.chatId){
      disableAI(false);state=next;lastStored=raw;blocked=false;contextDirty=false;actionsByMessage.clear();
      if(root)renderHistory();return false;
    }
    const localContext=state.context;state=mergeHelper(state,next);if(contextDirty)state.context=localContext;
    if(streamMessage)streamMessage=state.messages.find(message=>message.id===streamMessage.id)||null;
    lastStored=raw;blocked=false;if(render&&root)renderHistory();return true;
  }catch{blocked=true;api.toast?.('Kumo’s saved chat could not be read. It has not been overwritten. Restore a backup to recover it.');return false;}
}
function persist(replace=false){
  if(blocked)return false;
  if(!replace&&!syncStored())return false;
  try{const raw=JSON.stringify(state);localStorage.setItem(KEY,raw);lastStored=raw;contextDirty=false;return true;}
  catch{api.toast?.('Kumo could not save this conversation. Download a backup to keep it.');return false;}
}
export function restoreHelper(data){
  const next=identifyHelper(data);disableAI(false);state={...next,chatId:helperId()};
  state.messages.forEach(message=>{if(message.pending){message.pending=false;message.text||='This reply was interrupted. Ask again whenever you’re ready.';message.updatedAt=Math.max(Date.now(),message.updatedAt+1);}});
  actionsByMessage.clear();blocked=false;contextDirty=false;persist(true);if(root)renderHistory();
}
function addMessage(role,text,kind,pending=false,expectedChat=null){
  syncStored(true);
  if(expectedChat&&state.chatId!==expectedChat)return null;
  const stamp=Math.max(Date.now(),...state.messages.map(message=>Date.parse(message.at)+1));
  const msg={id:helperId(),role,text,mode:kind,at:new Date(stamp).toISOString(),updatedAt:stamp,...(pending?{pending:true}:{})};
  state.messages.push(msg);state.messages=state.messages.slice(-60);persist();return state.messages.find(message=>message.id===msg.id)||null;
}
function touch(message){message.updatedAt=Math.max(Date.now(),message.updatedAt+1);}
function context(){return state.context?api.getContext?.():null;}
function cloud(){const frame=node('div','helper-cloud');frame.setAttribute('aria-hidden','true');frame.innerHTML='<svg viewBox="0 0 180 145"><ellipse cx="90" cy="125" rx="48" ry="5" fill="#e8e1d4" stroke="none"/><g class="helper-cloud-body"><path d="M43 101C15 97 19 63 42 60c0-29 42-39 53-16 26-18 51 0 47 23 28 13 18 40-6 40H54Z" fill="#f8f3e5" stroke="#a89b83" stroke-width="1.5"/><g class="helper-eyes" fill="#786b58" stroke="none"><ellipse cx="69" cy="79" rx="2.8" ry="3.5"/><ellipse cx="108" cy="79" rx="2.8" ry="3.5"/></g><path d="M83 90q6 7 12 0" fill="none" stroke="#9e8070" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="60" cy="89" rx="7" ry="3" fill="#dfbcab" stroke="none"/><ellipse cx="117" cy="89" rx="7" ry="3" fill="#dfbcab" stroke="none"/><path d="m69 109-3 8m44-8 3 8" stroke="#a89b83" stroke-width="2" stroke-linecap="round"/></g><path class="helper-spark" d="M147 26v14m-7-7h14" stroke="#bca889" stroke-width="1.5"/></svg>';return frame;}

export function initHelper(target,options={}){
  cleanup?.();root=target;api=options;blocked=false;
  try{const saved=localStorage.getItem(KEY);state=saved?identifyHelper(JSON.parse(saved)):freshHelper();lastStored=saved;if(!saved)persist(true);}catch{blocked=true;}
  const layout=node('div','helper-layout');const aside=node('aside','helper-side');
  const intro=node('section','helper-intro');intro.append(node('span','helper-kicker','A LITTLE COMPANY'),cloud(),node('h2','','Hello, I’m Kumo.'),node('p','','A soft place to think out loud. Let’s make the next step a little easier.'));
  const card=node('div','helper-capabilities');for(const [symbol,title,description] of [['◷','Find a little focus','A realistic plan from your own tasks.'],['↳','Make the big thing smaller','Turn a stuck moment into a first step.'],['◯','Come back to yourself','A quiet reset or a little encouragement.']]){const row=node('div','helper-capability');row.append(node('span','',symbol));const copy=node('div');copy.append(node('strong','',title),node('p','',description));row.append(copy);card.append(row);}intro.append(card);aside.append(intro);
  const ai=node('section','helper-ai-card');ai.append(node('span','helper-kicker','OPTIONAL · NO API KEY'),node('h3','','A little AI, on your device.'),node('p','','For open-ended conversation, download a small language model. Your messages are processed here, on your device.'));
  ai.append(node('p','helper-backend-hint','A compatible GPU gives faster replies; a smaller CPU model is used otherwise. CPU replies may be slower.'));
  const details=node('details','helper-ai-details');details.append(node('summary','','What happens when I enable it?'),node('p','','The first setup can download several hundred MB from the model provider and caches them in this browser. Internet is needed for setup; no paid API or account is required. The model is small and can make mistakes.'));
  const link=node('a','','How browser AI works ↗');link.href='https://webllm.mlc.ai/docs/user/get_started.html';link.target='_blank';link.rel='noopener noreferrer';details.append(link);ai.append(details);
  const compatibility=node('label','helper-compatibility');view.compatibility=node('input');view.compatibility.type='checkbox';const compatibilityCopy=node('span');compatibilityCopy.append(node('strong','','Use compatibility mode'),node('small','','Use the smaller CPU model if AI has trouble starting.'));compatibility.append(view.compatibility,compatibilityCopy);ai.append(compatibility);
  view.progress=node('progress','helper-progress');view.progress.max=1;view.progress.value=0;view.progress.hidden=true;view.progress.setAttribute('aria-label','On-device AI download progress');
  view.aiStatus=node('p','helper-ai-status','Lightweight helper is ready.');view.aiStatus.setAttribute('role','status');view.enable=button('Enable on-device AI','helper-primary',enableAI);view.cancel=button('Cancel download','helper-quiet',()=>disableAI());view.cancel.hidden=true;
  view.errorDetails=node('details','helper-ai-details');view.errorDetails.hidden=true;view.errorText=node('p');view.errorDetails.append(node('summary','','Technical details'),view.errorText);
  ai.append(view.progress,view.aiStatus,view.enable,view.cancel,view.errorDetails);aside.append(ai);
  const chat=node('section','helper-chat');const header=node('div','helper-chat-header');const identity=node('div','helper-identity');
  const avatar=node('span','helper-avatar');avatar.setAttribute('aria-hidden','true');avatar.innerHTML='<svg viewBox="0 0 64 52" aria-hidden="true"><path class="helper-avatar-cloud" d="M14 39C2 37 3 23 14 22c0-13 17-17 23-7 12-8 23 0 20 11 11 6 6 18-5 18H19Z" fill="#f7f0df" stroke="#a89b83" stroke-width="1.4"/><g class="helper-avatar-eyes" fill="#786b58" stroke="none"><ellipse cx="25" cy="29" rx="1.5" ry="1.8"/><ellipse cx="41" cy="29" rx="1.5" ry="1.8"/></g><path class="helper-avatar-smile" d="M30 35q3 4 7 0" fill="none" stroke="#9e8070" stroke-width="1.3" stroke-linecap="round"/><g fill="#dfbcab" stroke="none"><ellipse cx="20" cy="34" rx="3" ry="1.5"/><ellipse cx="46" cy="34" rx="3" ry="1.5"/></g></svg>';
  identity.append(avatar);const identityCopy=node('div');identityCopy.append(node('strong','','Kumo'));view.modeLabel=node('span','helper-mode-label','Lightweight helper · ready now');identityCopy.append(view.modeLabel);identity.append(identityCopy);
  const clear=button('New chat','helper-quiet',newChat);header.append(identity,clear);
  view.log=node('div','helper-messages');view.log.setAttribute('role','log');view.log.setAttribute('aria-label','Conversation with Kumo');view.log.setAttribute('aria-live','off');
  view.announce=node('span','sr-only');view.announce.setAttribute('role','status');
  const prompts=node('div','helper-prompts');[['Plan my day','Help me plan my day'],['A smaller first step','Break my next task down'],['A quiet reset','I feel overwhelmed'],['My little wins','Review my progress']].forEach(([label,prompt])=>prompts.append(button(label,'helper-prompt',()=>sendMessage(prompt))));
  const contextLabel=node('label','helper-context');view.context=node('input');view.context.type='checkbox';view.context.checked=state.context;view.context.onchange=()=>{const checked=view.context.checked;syncStored(true);state.context=checked;view.context.checked=checked;contextDirty=true;persist();};contextLabel.append(view.context,node('span','','Use my day as context'),node('small','','Tasks & habit counts only. Notes and journal stay private.'));
  const form=node('form','helper-composer');view.input=node('textarea');view.input.rows=2;view.input.maxLength=1200;view.input.placeholder='What would feel useful right now?';view.input.setAttribute('aria-label','Message Kumo');view.send=node('button','helper-send','↑');view.send.type='submit';view.send.setAttribute('aria-label','Send message');form.append(view.input,view.send);form.onsubmit=e=>{e.preventDefault();if(busy){stopReply();return;}sendMessage(view.input.value);};view.input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!busy)sendMessage(view.input.value);}};
  const footer=node('div','helper-chat-footer');view.modeSwitch=node('select');view.modeSwitch.setAttribute('aria-label','Kumo conversation mode');view.modeSwitch.add(new Option('Lightweight helper','helper'));view.modeSwitch.add(new Option('On-device AI','ai'));view.modeSwitch.options[1].disabled=true;view.modeSwitch.onchange=()=>{mode=view.modeSwitch.value;updateStatus();};footer.append(view.modeSwitch,node('span','','Your conversation stays in this browser.'));
  chat.append(header,view.log,view.announce,prompts,contextLabel,form,footer);layout.append(aside,chat);root.replaceChildren(layout);renderHistory();updateStatus();
  if(blocked)api.toast?.('Kumo’s saved chat could not be read. Restore a backup to recover it.');
  const onStorage=event=>{if(event.key!==KEY&&event.key!==null)return;const sameChat=syncStored(true);if(sameChat&&!blocked&&JSON.stringify(state)!==lastStored)persist();};
  const onHide=()=>{clearTimeout(checkpointTimeout);checkpointTimeout=null;if(streamMessage){touch(streamMessage);persist();}};
  const onFocus=()=>syncStored(true);
  window.addEventListener('storage',onStorage);window.addEventListener('pagehide',onHide);window.addEventListener('focus',onFocus);
  cleanup=()=>{onHide();disableAI(false);window.removeEventListener('storage',onStorage);window.removeEventListener('pagehide',onHide);window.removeEventListener('focus',onFocus);cleanup=null;};
  return cleanup;
}
function newChat(){if(busy){api.toast?.('Finish or stop this reply first.');return;}syncStored(true);const previous=snapshot();restoreHelper({...freshHelper(),context:state.context});api.toast?.('A fresh conversation.',()=>restoreHelper(previous));}
function renderHistory(){
  if(!view.log)return;
  view.log.replaceChildren();view.context.checked=state.context;
  if(!state.messages.length){const welcome=node('div','helper-welcome');welcome.append(node('span','helper-welcome-mark','☁'),node('h3','','You can start anywhere.'),node('p','','A busy mind, a big task, or just a little hello. I’m here for the small things.'));view.log.append(welcome);}
  state.messages.forEach(msg=>{const bubble=appendBubble(msg,actionsByMessage.get(msg.id)||[]);if(streamMessage?.id===msg.id){streamMessage=msg;streamNode=bubble;paintReply();}});view.log.scrollTop=view.log.scrollHeight;
}
function appendBubble(msg,actions=[]){
  const row=node('div',`helper-message helper-${msg.role}`);const byline=node('div','helper-byline',msg.role==='user'?'YOU':msg.mode==='ai'?'KUMO · ON-DEVICE AI':'KUMO · LIGHTWEIGHT HELPER');const text=node('div','helper-message-text',msg.text||(msg.role==='assistant'?'This reply was interrupted or is still running in another tab. Ask again whenever you’re ready.':''));row.append(byline,text);
  if(actions.length)row.append(actionButtons(actions));
  view.log.append(row);return text;
}
function actionButtons(actions){
  const tools=node('div','helper-message-actions');actions.forEach(action=>{const b=button(action.applied?'Added to your day ✓':action.label,'helper-action',()=>{
    if(action.type==='ask'){sendMessage(action.prompt);return;}
    if(action.type==='space'){api.openSpace?.(action.space);return;}
    if(action.type==='focus'){api.focusTask?.(action.taskId);return;}
    if(action.type==='add'){const success=api.addTasks?.(action.tasks);if(success!==false){action.applied=true;b.disabled=true;b.textContent='Added to your day ✓';}}
  });b.disabled=Boolean(action.applied);tools.append(b);});return tools;
}
function reducedMotion(){return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);}
function setBusy(value){busy=value;if(view.send){view.send.disabled=false;view.send.textContent=value?'■':'↑';view.send.setAttribute('aria-label',value?'Stop reply':'Send message');view.input.disabled=value;view.modeSwitch.disabled=value;}updateStatus();}
function sendMessage(text){
  text=String(text||'').trim().slice(0,1200);syncStored(true);if(!text||busy)return;view.input.value='';
  const user=addMessage('user',text,'user');if(!user)return;if(view.log.querySelector('.helper-welcome'))view.log.replaceChildren();appendBubble(user);setBusy(true);view.log.scrollTop=view.log.scrollHeight;
  const kind=mode==='ai'&&ready&&worker?'ai':'helper';
  const reply={generation:++generation,chatId:state.chatId,userId:user.id,kind};activeReply=reply;
  streamMessage=addMessage('assistant','',kind,true,reply.chatId);if(!streamMessage||activeReply!==reply)return;
  presentation={target:'',done:false,stopped:false,actions:[]};replyPhase='thinking';streamNode=appendBubble(streamMessage);paintReply();view.log.scrollTop=view.log.scrollHeight;updateStatus();view.announce.textContent='Kumo is preparing a reply.';
  if(!reducedMotion())thoughtTimer=setTimeout(()=>{if(replyIsCurrent(reply)&&!streamMessage?.text){replyPhase='finding';paintReply();updateStatus();}},350);
  if(kind==='ai'){const history=state.messages.filter(message=>message.id!==streamMessage.id);worker.postMessage({type:'chat',messages:buildAIMessages(history,context())});return;}
  const prepare=()=>{syncStored(true);if(!replyIsCurrent(reply))return;const response=replyLocally(text,context());queueReply(response.text,true,response.actions);};
  if(reducedMotion())prepare();else replyTimeout=setTimeout(prepare,600);
}
function replyIsCurrent(reply=activeReply){return Boolean(reply&&activeReply===reply&&reply.generation===generation&&reply.chatId===state.chatId&&state.messages.some(message=>message.id===reply.userId));}
function paintReply(){
  if(!streamNode||!streamMessage)return;
  if(presentation?.stopped){streamNode.classList.remove('helper-typing','helper-reveal-caret');streamNode.textContent=streamMessage.text||'Stopping this reply…';return;}
  const writing=Boolean(streamMessage.text);
  streamNode.classList.toggle('helper-typing',!writing);streamNode.classList.toggle('helper-reveal-text',writing);streamNode.classList.toggle('helper-reveal-caret',writing&&busy&&!presentation?.stopped&&!reducedMotion());
  if(writing){streamNode.textContent=streamMessage.text;return;}
  const dots=node('span','helper-thought-indicator');dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)dots.append(node('span','helper-thought-dot'));
  streamNode.replaceChildren(dots,node('span','helper-thought-label',replyPhase==='finding'?'Finding a small next step…':'Thinking quietly…'));
}
function queueReply(text,done=false,actions=[]){
  if(!replyIsCurrent()||!presentation||presentation.stopped)return;
  presentation.target=String(text||'').slice(0,6000);presentation.done=done||presentation.done;
  if(done)presentation.actions=actions;
  if(reducedMotion()){clearTimeout(revealTimer);revealTimer=null;revealStep();}
  else if(!revealTimer)revealTimer=setTimeout(revealStep,50);
}
function revealStep(){
  revealTimer=null;syncStored(true);if(!replyIsCurrent()||!presentation||presentation.stopped||!streamMessage)return;
  const target=Array.from(presentation.target),shown=Array.from(streamMessage.text).length;
  const count=reducedMotion()?target.length:Math.min(target.length,shown+3);
  const next=target.slice(0,count).join('');
  if(next!==streamMessage.text){
    const nearBottom=view.log.scrollHeight-view.log.scrollTop-view.log.clientHeight<100;
    streamMessage.text=next;touch(streamMessage);replyPhase='writing';clearTimeout(thoughtTimer);paintReply();updateStatus();
    if(nearBottom)view.log.scrollTop=view.log.scrollHeight;
    if(!checkpointTimeout)checkpointTimeout=setTimeout(()=>{checkpointTimeout=null;checkpoint();},400);
  }
  if(count===target.length&&presentation.done){finishReply(true,true);view.announce.textContent='Kumo has replied.';view.input.focus({preventScroll:true});return;}
  if(count<target.length)revealTimer=setTimeout(revealStep,50);
}
function finishReply(save=true,completed=false){
  clearTimeout(replyTimeout);clearTimeout(stopTimeout);clearTimeout(checkpointTimeout);clearTimeout(revealTimer);clearTimeout(thoughtTimer);checkpointTimeout=null;revealTimer=null;thoughtTimer=null;
  const nearBottom=view.log&&view.log.scrollHeight-view.log.scrollTop-view.log.clientHeight<100;
  if(completed&&streamMessage&&presentation?.actions.length){actionsByMessage.set(streamMessage.id,presentation.actions);streamNode?.parentElement?.append(actionButtons(presentation.actions));}
  generation++;activeReply=null;
  if(streamMessage){streamMessage.pending=false;streamMessage.text||='Reply stopped. We can try again whenever you like.';touch(streamMessage);streamNode?.classList.remove('helper-typing','helper-reveal-caret');if(streamNode)streamNode.textContent=streamMessage.text;}
  streamMessage=null;streamNode=null;presentation=null;replyPhase='';setBusy(false);if(save)persist();
  if(nearBottom)view.log.scrollTop=view.log.scrollHeight;
}
function stopReply(){
  clearTimeout(replyTimeout);clearTimeout(revealTimer);clearTimeout(thoughtTimer);revealTimer=null;thoughtTimer=null;
  const modelStillRunning=activeReply?.kind==='ai'&&!presentation?.done;
  if(presentation){presentation.stopped=true;presentation.target=streamMessage?.text||'';presentation.actions=[];}
  if(streamMessage){touch(streamMessage);persist();paintReply();}updateStatus();
  if(worker&&busy&&streamMessage&&replyIsCurrent()&&modelStillRunning){
    worker.postMessage({type:'stop'});view.send.disabled=true;view.modeLabel.textContent='Finishing this thought…';
    clearTimeout(stopTimeout);stopTimeout=setTimeout(()=>{disableAI();if(view.aiStatus)view.aiStatus.textContent='The reply was stopped. Lightweight helper is ready.';},2500);return;
  }
  finishReply();
}
function checkpoint(){clearTimeout(checkpointTimeout);checkpointTimeout=null;if(streamMessage&&replyIsCurrent())persist();}
function updateStatus(){
  root?.classList.toggle('helper-thinking',busy&&replyPhase!=='writing'&&!presentation?.stopped);root?.classList.toggle('helper-writing',busy&&replyPhase==='writing'&&!presentation?.stopped);
  if(!view.modeLabel)return;view.modeLabel.textContent=busy?(replyPhase==='writing'?'Writing a little thought…':replyPhase==='finding'?'Finding a small next step…':'Thinking quietly…'):mode==='ai'&&ready?'On-device AI · running locally':'Lightweight helper · ready now';view.modeSwitch.value=mode;view.modeSwitch.options[1].disabled=!ready;view.enable.textContent=ready?'Turn off AI & free memory':loading?'Preparing your little AI…':'Enable on-device AI';view.enable.disabled=loading||busy;view.compatibility.disabled=loading||ready||busy;view.cancel.hidden=!loading;view.progress.hidden=!loading;
}
function loadWatchdog(){clearTimeout(loadTimeout);loadTimeout=setTimeout(()=>{disableAI();view.aiStatus.textContent='The download took too long. You can try again; the lightweight helper is still ready.';},180000);}
async function enableAI(){
  if(ready){disableAI();return;}if(loading)return;
  loading=true;view.aiStatus.title='';view.aiStatus.textContent='Preparing a local model. The first download can take a few minutes.';view.errorDetails.hidden=true;view.progress.value=0;updateStatus();loadWatchdog();
  try{worker=new Worker(new URL('./helper-worker.mjs',import.meta.url),{type:'module'});const instance=worker;worker.onerror=()=>{if(worker===instance)modelError('The local AI worker could not start. A browser or network restriction may be blocking it.');};worker.onmessage=({data})=>{
    if(worker!==instance)return;
    if(data.type==='progress'){loadWatchdog();view.progress.value=Math.max(0,Math.min(1,data.progress||0));view.aiStatus.textContent=`${Math.round((data.progress||0)*100)}% · ${String(data.text).slice(0,140)}`;}
    else if(data.type==='ready'){clearTimeout(loadTimeout);loading=false;ready=true;mode='ai';const label=String(data.label||data.model||'On-device AI').slice(0,100),backend=String(data.backend||'').slice(0,30);view.aiStatus.textContent=`${label}${backend?` · ${backend}`:''} is ready on this device. No API key needed.`;updateStatus();api.toast?.('Kumo’s on-device AI is ready. Say a little hello.');}
    else if(data.type==='token'&&streamNode&&streamMessage){
      syncStored(true);if(worker!==instance||!replyIsCurrent()||!streamMessage)return;
      queueReply(data.text);
    }
    else if(data.type==='done'){
      syncStored(true);if(worker!==instance||!replyIsCurrent())return;
      clearTimeout(stopTimeout);
      if(presentation?.stopped){finishReply();view.announce.textContent='Reply stopped.';return;}
      queueReply(String(data.text||'')||presentation?.target||'I couldn’t find the words that time. Try a shorter message.',true);
    }
    else if(data.type==='error')modelError(data.message);
  };worker.postMessage({type:'load',forceCPU:Boolean(view.compatibility.checked)});}catch(error){modelError(error.message);}
}
function modelError(message){
  const wasReply=busy,replyChat=activeReply?.chatId;disableAI();view.aiStatus.textContent='On-device AI couldn’t run here. The lightweight helper is still available.';
  const reason=String(message||'');
  if(/out of memory|\boom\b|memory limit|allocation fail/i.test(reason))view.aiStatus.textContent='The model may not have enough available memory. Close other graphics-heavy tabs and try again, or use the lightweight helper.';
  else if(/device lost|shader|pipeline|wgsl/i.test(reason))view.aiStatus.textContent='The GPU may not support this model or may have run out of memory. Try again to use an available model, or keep using the lightweight helper.';
  else if(/webgpu|available.*gpu|gpu.*device|requestadapter/i.test(reason))view.aiStatus.textContent='This browser could not provide a usable GPU. Retry to use the smaller CPU model, or keep using the lightweight helper.';
  else if(/fetch|network|download|cache|indexeddb|storage/i.test(reason))view.aiStatus.textContent='The model download or browser cache may be blocked or interrupted. Check your connection and try again; cached model files can be reused. The lightweight helper is ready.';
  let details=String(message||'Unknown model error').replace(/https?:\/\/[^\s]+/g,url=>url.split('?')[0]).slice(0,500);
  if(/Planner context:|You are Kumo|["'](?:content|messages)["']\s*:/.test(details))details='The model could not process this input. Try a shorter message or a fresh conversation.';
  view.aiStatus.title=details;view.errorText.textContent=details;view.errorDetails.hidden=false;
  if(wasReply){const msg=addMessage('assistant','The local model ran into a problem. I’ve switched back to lightweight helper mode, where I can still help with your tasks and your day.','helper',false,replyChat);if(msg)appendBubble(msg);view.log.scrollTop=view.log.scrollHeight;}
  api.toast?.('On-device AI couldn’t run. Kumo’s lightweight helper still works.');
}
function disableAI(save=true){clearTimeout(loadTimeout);worker?.terminate();worker=null;ready=false;loading=false;mode='helper';finishReply(save);if(view.aiStatus)view.aiStatus.textContent='Lightweight helper is ready. Cached model files can be reused next time.';updateStatus();}
