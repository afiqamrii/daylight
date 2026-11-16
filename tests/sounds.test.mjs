import test from 'node:test';
import assert from 'node:assert/strict';
import {freshSounds,validateSounds,soundDeadline,soundSecondsLeft,SOUND_PRESETS,getSounds,restoreSounds} from '../dist/sounds.mjs';

test('sound snapshots are independent and never retain playback or timer deadlines',()=>{
  const source=freshSounds();source.playing=true;source.deadline=Date.now()+900000;
  const clean=validateSounds(source);assert.equal('playing' in clean,false);assert.equal('deadline' in clean,false);
  clean.channels.rain.volume=3;assert.equal(source.channels.rain.volume,45);
  assert.deepEqual(validateSounds(freshSounds()),freshSounds());
});
test('sound imports reject invalid channel bounds, structures, and sleep durations',()=>{
  for(const mutate of [s=>s.channels.rain.volume=-1,s=>s.channels.brown.volume=101,s=>s.channels.chimes.volume=NaN,s=>s.channels.rain.volume=2.5,s=>s.channels.brown.enabled='yes',s=>delete s.channels.chimes,s=>s.sleepMinutes=5,s=>s.version=2]){const data=freshSounds();mutate(data);assert.throws(()=>validateSounds(data));}
  for(const data of [null,[],{}])assert.throws(()=>validateSounds(data));
});
test('each sound preset is a valid independent mix with an audible enabled channel',()=>{
  for(const preset of Object.values(SOUND_PRESETS)){const value=validateSounds({...freshSounds(),channels:preset.channels});assert.ok(Object.values(value.channels).some(c=>c.enabled&&c.volume>0));value.channels.rain.volume=99;assert.notEqual(preset.channels.rain.volume,99);}
});
test('sleep deadlines use elapsed wall time and stop after a suspended background interval',()=>{
  const now=1000000,end=soundDeadline(15,now);assert.equal(end,1900000);
  assert.equal(soundSecondsLeft(end,now),900);assert.equal(soundSecondsLeft(end,now+12345),888);
  assert.equal(soundSecondsLeft(end,end),0);assert.equal(soundSecondsLeft(end,end+3600000),0);
  assert.equal(soundDeadline(0,now),null);assert.equal(soundSecondsLeft(null,now),null);
  assert.throws(()=>soundDeadline(7,now));assert.throws(()=>soundDeadline(15,NaN));
});
test('restoring sound settings validates and exports preferences without creating audio',()=>{
  const previous=globalThis.AudioContext;let created=0;
  globalThis.AudioContext=class{constructor(){created++;}};
  try{const data=freshSounds();data.channels.chimes={enabled:true,volume:63};data.sleepMinutes=30;restoreSounds(data);assert.deepEqual(getSounds(),data);assert.equal(created,0);const bad={...data,sleepMinutes:1};assert.throws(()=>restoreSounds(bad));assert.deepEqual(getSounds(),data);}
  finally{if(previous===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=previous;}
});

test('sound restore reports save failure while retaining the restored preferences in memory',()=>{
  const previous=globalThis.localStorage;let raw=null,fail=false;
  globalThis.localStorage={getItem:()=>raw,setItem:(key,value)=>{if(fail)throw new Error('Storage quota exceeded');raw=value;}};
  try{
    const first=freshSounds();assert.equal(restoreSounds(first),true);assert.deepEqual(JSON.parse(raw),first);
    fail=true;const restored={...freshSounds(),sleepMinutes:60};restored.channels.rain.volume=72;
    assert.equal(restoreSounds(restored),false);
    assert.deepEqual(getSounds(),restored,'the restored mix remains available for export');
    assert.deepEqual(JSON.parse(raw),first,'failed persistence keeps the prior saved mix');
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});

test('audio starts only on play, schedules its fade in audio time and closes on pagehide',async()=>{
  const module=await import(`../dist/sounds.mjs?lifecycle=${Date.now()}`);
  const originals={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,AudioContext:globalThis.AudioContext,Option:globalThis.Option};
  const events=new Map(),contexts=[],saved=[];
  class Element {
    constructor(){this.children=[];this.attributes={};this.dataset={};this.className='';this.style={setProperty(){}};this.classList={toggle(){}};}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(key,value){this.attributes[key]=value;}
    find(cls){if(this.className.split(' ').includes(cls))return this;for(const child of this.children){const match=child.find?.(cls);if(match)return match;}return null;}
  }
  class Param {
    constructor(){this.value=0;this.events=[];}
    setValueAtTime(value,time){this.events.push(['set',value,time]);this.value=value;}
    linearRampToValueAtTime(value,time){this.events.push(['ramp',value,time]);}
    exponentialRampToValueAtTime(value,time){this.events.push(['exponential',value,time]);}
    setTargetAtTime(value,time,constant){this.events.push(['target',value,time,constant]);}
    cancelScheduledValues(time){this.events.push(['cancel',time]);}
  }
  class AudioNode {
    constructor(){this.gain=new Param();this.frequency=new Param();this.Q=new Param();this.stopped=false;}
    connect(){}disconnect(){}start(){this.started=true;}stop(){this.stopped=true;}
  }
  class Context {
    constructor(){this.state='suspended';this.sampleRate=100;this.currentTime=7;this.destination={};this.gains=[];this.sources=[];contexts.push(this);}
    async resume(){this.state='running';}
    createGain(){const node=new AudioNode();this.gains.push(node);return node;}
    createBufferSource(){const node=new AudioNode();this.sources.push(node);return node;}
    createBiquadFilter(){return new AudioNode();}
    createOscillator(){return new AudioNode();}
    createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
    async close(){this.state='closed';}
  }
  let cleanup;
  try{
    globalThis.document={createElement:()=>new Element(),addEventListener(){},removeEventListener(){}};
    globalThis.window={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
    globalThis.Option=class extends Element{constructor(label,value){super();this.textContent=label;this.value=value;}};
    globalThis.AudioContext=Context;
    const settings={...freshSounds(),sleepMinutes:15,playing:true,deadline:123};
    globalThis.localStorage={getItem:()=>JSON.stringify(settings),setItem:(key,value)=>saved.push(JSON.parse(value))};
    const root=new Element();cleanup=module.initSounds(root);
    assert.equal(contexts.length,0,'restoring a saved mix must not autoplay');
    assert.equal(root.find('sound-corner').dataset.playing,'false');
    root.find('sound-preset').onclick();
    assert.equal(contexts.length,0,'choosing a preset while paused must not autoplay');
    await root.find('sound-play-button').onclick();
    assert.equal(contexts.length,1);assert.equal(contexts[0].state,'running');
    assert.equal(root.find('sound-corner').dataset.playing,'true');
    const ramps=contexts[0].gains[0].gain.events.filter(event=>event[0]==='ramp');
    const final=ramps.at(-1);assert.equal(final[1],0);assert.ok(final[2]>906&&final[2]<=907,'audio automation fades at the deadline without depending on the JS interval');
    assert.equal(contexts[0].sources.length,2);assert.ok(contexts[0].sources.every(source=>source.started));
    events.get('pagehide')();assert.equal(contexts[0].state,'closed');assert.ok(contexts[0].sources.every(source=>source.stopped));
    assert.equal(root.find('sound-corner').dataset.playing,'false');
    await root.find('sound-play-button').onclick();assert.equal(contexts.length,2);
    module.restoreSounds(freshSounds());assert.equal(contexts[1].state,'closed');assert.equal(root.find('sound-corner').dataset.playing,'false');
    for(const value of saved){assert.equal('playing' in value,false);assert.equal('deadline' in value,false);}
  }finally{cleanup?.();for(const [key,value] of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
