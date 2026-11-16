import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../dist/helper-core.mjs';
import {defaultState,localDayKey} from '../dist/core.mjs';

const KEY='daylight.helper.v1';
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this.options=[];this.value='';this.scrollTop=0;this.scrollHeight=200;this.clientHeight=200;this.className='';this.textContent='';this.hidden=false;this.disabled=false;this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(name=>!names.includes(name)).join(' ');},toggle:(name,value)=>{if(value)this.classList.add(name);else this.classList.remove(name);}};}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent||'').join('');}
  append(...children){children.forEach(child=>child.parentElement=this);this.children.push(...children);}
  replaceChildren(...children){this._text='';this.children=[];this.append(...children);}
  setAttribute(name,value){this.attributes[name]=value;}
  add(option){this.options.push(option);}
  focus(){this.focused=true;}
  querySelector(selector){const name=selector.slice(1);for(const child of this.children){if(child.className?.split(' ').includes(name))return child;const found=child.querySelector?.(selector);if(found)return found;}return null;}
}
function createTab(store=new Map(),options={}){
  const timers=[],events=new Map(),workers=[],toasts=[];
  const document={createElement:tag=>new Element(tag)};
  const sandbox={...core,document,URL,console,navigator:{gpu:options.noGPU?undefined:{}},matchMedia:()=>({matches:Boolean(options.reducedMotion)}),Option:function(label,value){this.label=label;this.value=value;},
    localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},
    window:{addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener(name,fn){events.get(name)?.delete(fn);}},
    setTimeout(fn,delay){const timer={fn,delay,canceled:false};timers.push(timer);return timer;},clearTimeout(timer){if(timer)timer.canceled=true;},
    Worker:class {constructor(){this.messages=[];this.terminated=false;workers.push(this);}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}emit(data){this.onmessage?.({data});}},
  };
  const context=vm.createContext(sandbox);
  const source=readFileSync(new URL('../dist/helper.mjs',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace(/^export \{.*;\r?\n/gm,'').replace(/^export /gm,'')
    .replaceAll('import.meta.url',"'https://daylight.example/helper.mjs'");
  vm.runInContext(`${source}\nthis.testApi={initHelper,getHelper,restoreHelper,sendMessage,newChat,stopReply,enableAI,syncStored,peek:()=>({busy,mode,ready,loading,view,streamMessage})};`,context);
  const api=context.testApi;
  api.initHelper(new Element(),{toast:(message,undo)=>toasts.push({message,undo}),getContext:()=>null});
  const run=delay=>{const pending=timers.filter(timer=>!timer.canceled&&timer.delay===delay);pending.forEach(timer=>{timer.canceled=true;timer.fn();});return pending.length;};
  return {api,store,workers,toasts,
    event(name,data={}){for(const callback of events.get(name)||[])callback(data);},
    run,
    completeReply(){run(350);run(600);for(let i=0;i<2100&&api.peek().busy;i++)if(!run(50))break;run(400);},
    reveal(ticks=1){for(let i=0;i<ticks;i++)run(50);},
  };
}

test('legacy messages gain repeatable IDs and duplicate IDs are rejected',()=>{
  const old={version:1,context:true,messages:[{role:'user',mode:'user',text:'Hello',at:'2026-11-16T00:00:00Z'}]};
  assert.deepEqual(core.identifyHelper(old),core.identifyHelper(old));
  const next=core.identifyHelper(old);next.messages.push({...next.messages[0]});assert.throws(()=>core.validateHelper(next));
});

test('message merging preserves concurrent additions and newer partial checkpoints',()=>{
  const base=core.identifyHelper({version:1,chatId:'same-chat',context:true,messages:[]});
  const message=(id,text,updatedAt)=>({id,role:'assistant',mode:'ai',text,updatedAt,at:'2026-11-16T00:00:00Z',pending:true});
  const a={...base,messages:[message('a','A message',1),message('stream','Partial reply',5)]};
  const b={...base,messages:[message('b','B message',2),message('stream','Old',3)]};
  const merged=core.mergeHelper(a,b);assert.equal(merged.messages.length,3);assert.equal(merged.messages.find(m=>m.id==='stream').text,'Partial reply');
  assert.deepEqual(core.mergeHelper(merged,merged),merged);
});

test('two tabs retain each user message and its lightweight reply',()=>{
  const store=new Map(),a=createTab(store),b=createTab(store);
  a.api.sendMessage('hello');b.api.sendMessage('thanks');a.completeReply();b.completeReply();
  a.event('storage',{key:KEY});b.event('storage',{key:KEY});
  const saved=JSON.parse(store.get(KEY));
  assert.deepEqual(saved.messages.filter(m=>m.role==='user').map(m=>m.text).sort(),['hello','thanks']);
  assert.equal(saved.messages.filter(m=>m.role==='assistant').length,2);
});

test('storage reconciliation repairs a stale write and then stops writing',()=>{
  let writes=0;
  class CountingStore extends Map {set(key,value){writes++;return super.set(key,value);}}
  const store=new CountingStore(),a=createTab(store),b=createTab(store);
  a.api.sendMessage('hello');const older=store.get(KEY);
  b.api.sendMessage('thanks');store.set(KEY,older);
  b.event('storage',{key:KEY});a.event('storage',{key:KEY});
  assert.equal(JSON.parse(store.get(KEY)).messages.filter(message=>message.role==='user').length,2);
  const stable=writes;
  a.event('storage',{key:KEY});b.event('storage',{key:KEY});
  assert.equal(writes,stable);
});

test('a chat replacement invalidates pending lightweight work',()=>{
  const store=new Map(),a=createTab(store),b=createTab(store);
  a.api.sendMessage('hello');b.api.newChat();a.completeReply();
  assert.equal(a.api.peek().busy,false);
  assert.equal(JSON.parse(store.get(KEY)).messages.length,0);
});

test('New chat Undo cancels a subsequent reply and restores only the earlier chat',()=>{
  const current=createTab();current.api.sendMessage('hello');current.completeReply();
  const earlier=current.api.getHelper().messages.map(m=>m.text);
  current.api.newChat();const undo=current.toasts.at(-1).undo;
  current.api.sendMessage('something new');undo();current.completeReply();
  assert.equal(current.api.peek().busy,false);
  assert.deepEqual(Array.from(current.api.getHelper().messages,m=>m.text),Array.from(earlier));
});

test('Stop in lightweight mode does not wait for an idle AI worker',async()=>{
  const current=createTab();await current.api.enableAI();current.workers[0].emit({type:'ready'});
  current.api.peek().view.modeSwitch.value='helper';current.api.peek().view.modeSwitch.onchange();
  current.api.sendMessage('hello');current.api.stopReply();current.completeReply();
  assert.equal(current.api.peek().busy,false);assert.equal(current.api.peek().view.send.disabled,false);
  assert.equal(current.api.getHelper().messages.length,2);assert.match(current.api.getHelper().messages.at(-1).text,/stopped/);
});

test('canceling a download ignores late ready events and leaves helper usable',async()=>{
  const current=createTab();await current.api.enableAI();const worker=current.workers[0];
  current.api.peek().view.cancel.onclick();worker.emit({type:'ready'});
  assert.equal(worker.terminated,true);assert.equal(current.api.peek().ready,false);assert.equal(current.api.peek().loading,false);
  current.api.sendMessage('hello');current.completeReply();
  assert.equal(current.api.getHelper().messages.length,2);assert.equal(current.api.peek().busy,false);
});

test('partial AI replies checkpoint, survive pagehide, and ignore replaced-worker events',async()=>{
  const current=createTab();await current.api.enableAI();const worker=current.workers[0];worker.emit({type:'ready'});
  current.api.sendMessage('A little idea');worker.emit({type:'token',text:'A first little thought'});current.reveal(8);current.run(400);
  assert.equal(JSON.parse(current.store.get(KEY)).messages.at(-1).text,'A first little thought');
  worker.emit({type:'token',text:'A first little thought, continued'});current.reveal(8);current.event('pagehide');
  assert.equal(JSON.parse(current.store.get(KEY)).messages.at(-1).text,'A first little thought, continued');
  current.api.restoreHelper(core.freshHelper());worker.emit({type:'token',text:'An obsolete token'});worker.emit({type:'done',text:'An obsolete reply'});
  assert.equal(current.api.getHelper().messages.length,0);assert.equal(current.api.peek().busy,false);
});

test('restored empty pending replies receive readable recovery text',()=>{
  const current=createTab(),backup=core.freshHelper();
  backup.messages=[{role:'assistant',mode:'ai',text:'',pending:true,at:'2026-11-16T00:00:00Z'}];
  current.api.restoreHelper(backup);
  assert.match(current.api.getHelper().messages[0].text,/interrupted/);
  assert.equal(current.api.getHelper().messages[0].pending,false);
});

test('context excludes deleted rituals from the completed count',()=>{
  const context=core.makeContext(defaultState(),{habits:[{id:'current'}],days:{[localDayKey()]:{habits:['deleted','current']}}});
  assert.equal(context.habitsDone,1);assert.equal(context.habitsTotal,1);
});

test('lightweight replies show three thinking dots, then text before actions',()=>{
  const current=createTab();current.api.sendMessage('add Read a chapter for 20 minutes');
  const view=current.api.peek().view;
  assert.equal(view.log.querySelector('.helper-thought-indicator').children.length,3);
  assert.match(view.modeLabel.textContent,/Thinking/);
  current.run(350);assert.match(view.modeLabel.textContent,/Finding/);
  current.run(600);assert.equal(current.api.getHelper().messages.at(-1).text,'');
  current.reveal();const partial=current.api.getHelper().messages.at(-1);
  assert.ok(partial.text.length>0&&partial.text.length<20);assert.equal(partial.pending,true);
  assert.match(view.modeLabel.textContent,/Writing/);assert.equal(view.log.querySelector('.helper-message-actions'),null);
  current.completeReply();assert.equal(current.api.peek().busy,false);assert.equal(current.api.getHelper().messages.at(-1).pending,false);
  assert.ok(view.log.querySelector('.helper-message-actions'));
});

test('stopping a local reveal freezes only the visible text and never adds actions',()=>{
  const current=createTab();current.api.sendMessage('add Read for 20 minutes');current.run(600);current.reveal(4);
  const visible=current.api.getHelper().messages.at(-1).text;
  current.api.stopReply();current.completeReply();
  assert.equal(current.api.getHelper().messages.at(-1).text,visible);
  assert.equal(current.api.getHelper().messages.at(-1).pending,false);
  assert.equal(current.api.peek().view.log.querySelector('.helper-message-actions'),null);
});

test('AI completion waits for the reveal queue to catch up',async()=>{
  const current=createTab();await current.api.enableAI();const worker=current.workers[0];worker.emit({type:'ready',label:'A tiny model',backend:'CPU'});
  current.api.sendMessage('hello');const reply='One small step is a lovely beginning.';
  worker.emit({type:'token',text:reply});worker.emit({type:'done',text:reply});
  assert.equal(current.api.peek().busy,true);assert.equal(current.api.getHelper().messages.at(-1).text,'');
  current.reveal();assert.ok(current.api.getHelper().messages.at(-1).text.length<reply.length);
  current.completeReply();assert.equal(current.api.peek().busy,false);assert.equal(current.api.getHelper().messages.at(-1).text,reply);
});

test('AI stop discards queued and late output while preserving the visible partial reply',async()=>{
  const current=createTab();await current.api.enableAI();const worker=current.workers[0];worker.emit({type:'ready'});
  current.api.sendMessage('hello');worker.emit({type:'token',text:'A long reply still being generated.'});current.reveal(2);
  const visible=current.api.getHelper().messages.at(-1).text;current.api.stopReply();
  assert.equal(worker.messages.at(-1).type,'stop');worker.emit({type:'token',text:'A long reply with unwanted late words.'});current.reveal(20);
  assert.equal(current.api.getHelper().messages.at(-1).text,visible);
  worker.emit({type:'done',text:'A long reply with unwanted late words.'});
  assert.equal(current.api.peek().busy,false);assert.equal(current.api.getHelper().messages.at(-1).text,visible);
});

test('reduced motion avoids artificial delay and character animation',async()=>{
  const current=createTab(new Map(),{reducedMotion:true});current.api.sendMessage('hello');
  assert.equal(current.api.peek().busy,false);assert.ok(current.api.getHelper().messages.at(-1).text.length>20);
  await current.api.enableAI();const worker=current.workers[0];worker.emit({type:'ready'});current.api.sendMessage('another thought');
  worker.emit({type:'token',text:'This complete chunk appears immediately.'});
  assert.equal(current.api.getHelper().messages.at(-1).text,'This complete chunk appears immediately.');
  worker.emit({type:'done',text:'This complete chunk appears immediately.'});assert.equal(current.api.peek().busy,false);
});

test('external restore cancels an active local reveal without leaking old characters',()=>{
  const store=new Map(),a=createTab(store),b=createTab(store);a.api.sendMessage('hello');a.run(600);a.reveal(2);
  b.api.restoreHelper(core.freshHelper());a.completeReply();
  assert.equal(a.api.peek().busy,false);assert.equal(JSON.parse(store.get(KEY)).messages.length,0);
});

test('CPU compatibility loads without WebGPU and reports the worker model safely',async()=>{
  const current=createTab(new Map(),{noGPU:true});current.api.peek().view.compatibility.checked=true;await current.api.enableAI();
  const worker=current.workers[0];assert.equal(worker.messages[0].forceCPU,true);assert.equal(current.api.peek().view.compatibility.disabled,true);
  worker.emit({type:'ready',label:'SmolLM2 · 135M',backend:'CPU'});
  assert.match(current.api.peek().view.aiStatus.textContent,/SmolLM2.*CPU/);
  assert.equal(current.api.peek().view.compatibility.disabled,true);
});

test('download failures show useful recovery help and sanitized details',async()=>{
  const current=createTab();await current.api.enableAI();current.workers[0].emit({type:'error',message:'Failed to fetch https://models.example/weights?privateToken=secret'});
  const view=current.api.peek().view;assert.match(view.aiStatus.textContent,/download.*may be blocked or interrupted/);
  assert.equal(view.errorDetails.hidden,false);assert.doesNotMatch(view.errorText.textContent,/privateToken|secret/);
  assert.equal(view.compatibility.disabled,false);
});
