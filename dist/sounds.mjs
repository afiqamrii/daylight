const STORAGE_KEY='daylight.sounds.v1';
const CHANNELS=Object.freeze([
  {id:'rain',name:'Soft rain',description:'A rainy window, without the weather.',symbol:'rain'},
  {id:'brown',name:'Warm noise',description:'A low, even hush for a busy mind.',symbol:'wave'},
  {id:'chimes',name:'Gentle chimes',description:'A few small notes, with room between.',symbol:'chime'},
]);
export const SOUND_PRESETS=Object.freeze({
  rain:{name:'Rainy window',channels:{rain:{enabled:true,volume:48},brown:{enabled:true,volume:22},chimes:{enabled:false,volume:30}}},
  focus:{name:'Quiet focus',channels:{rain:{enabled:false,volume:40},brown:{enabled:true,volume:48},chimes:{enabled:false,volume:25}}},
  tea:{name:'Tea break',channels:{rain:{enabled:true,volume:22},brown:{enabled:false,volume:30},chimes:{enabled:true,volume:50}}},
});
const MAX_GAIN=.22;
let state=null,mount=null,notify=()=>{},audio=null,master=null,playing=false,starting=false;
let graph={},voices=new Set(),chimeTimer=null,clockTimer=null,deadline=null,generation=0,cleanup=null,storageBlocked=false,lastError='';
let view={};

export function freshSounds(){return {version:1,channels:{rain:{enabled:true,volume:45},brown:{enabled:false,volume:35},chimes:{enabled:false,volume:30}},sleepMinutes:0};}
function plain(value){return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));}
export function validateSounds(input){
  if(!plain(input)||input.version!==1||!plain(input.channels))throw new Error('Invalid sound settings.');
  const channels={};
  for(const {id} of CHANNELS){const channel=input.channels[id];if(!plain(channel)||typeof channel.enabled!=='boolean'||!Number.isInteger(channel.volume)||channel.volume<0||channel.volume>100)throw new Error('Invalid sound channel.');channels[id]={enabled:channel.enabled,volume:channel.volume};}
  if(![0,15,30,60].includes(input.sleepMinutes))throw new Error('Invalid sound sleep timer.');
  return {version:1,channels,sleepMinutes:input.sleepMinutes};
}
/** Absolute deadlines do not accumulate interval drift while a tab is in the background. */
export function soundDeadline(minutes,now=Date.now()){
  if(![0,15,30,60].includes(minutes)||!Number.isFinite(now)||now<0)throw new Error('Invalid sound timer.');
  return minutes===0?null:now+minutes*60000;
}
export function soundSecondsLeft(endAt,now=Date.now()){
  if(endAt===null)return null;
  if(!Number.isFinite(endAt)||!Number.isFinite(now))throw new Error('Invalid sound deadline.');
  return Math.max(0,Math.ceil((endAt-now)/1000));
}
function load(){
  if(state)return;state=freshSounds();
  try{if(typeof localStorage!=='undefined'){const raw=localStorage.getItem(STORAGE_KEY);if(raw)state=validateSounds(JSON.parse(raw));}}
  catch{storageBlocked=true;notify('Saved sound settings could not be read. They have not been overwritten. Restore a backup to recover them.');}
}
function save(){
  if(storageBlocked)return false;
  try{const snapshot=validateSounds(state);if(typeof localStorage!=='undefined')localStorage.setItem(STORAGE_KEY,JSON.stringify(snapshot));return true;}
  catch{notify('Your sound mix is open, but this browser could not save it. A planner backup can keep a copy.');return false;}
}
export function getSounds(){load();return validateSounds(state);}
export function restoreSounds(input){const next=validateSounds(input);stopSounds();state=next;storageBlocked=false;lastError='';const saved=save();if(mount)render();return saved;}
function anySound(){return CHANNELS.some(({id})=>state.channels[id].enabled&&state.channels[id].volume>0);}
function AudioConstructor(){return globalThis.AudioContext||globalThis.webkitAudioContext;}
function currentPreset(){return Object.keys(SOUND_PRESETS).find(key=>CHANNELS.every(({id})=>state.channels[id].enabled===SOUND_PRESETS[key].channels[id].enabled&&state.channels[id].volume===SOUND_PRESETS[key].channels[id].volume))||null;}

function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function button(text,cls,action,label){const el=node('button',cls,text);el.type='button';el.onclick=action;if(label)el.setAttribute('aria-label',label);return el;}
const ICONS={rain:'<path d="M5 13a4 4 0 0 1 .8-7.9 6 6 0 0 1 11.4 0A4 4 0 0 1 19 13H5Zm2 4-1 3m6-3-1 3m6-3-1 3"/>',wave:'<path d="M2 8c3-5 6 5 10 0s7 5 10 0M2 13c3-5 6 5 10 0s7 5 10 0M2 18c3-5 6 5 10 0s7 5 10 0"/>',chime:'<path d="M12 3v4m-5 1h10M7 9v6m5-6v10m5-10v6M5 15h4m1 4h4m1-4h4"/>',play:'<path d="m9 5 10 7-10 7Z"/>',pause:'<path d="M7 5h3v14H7zm7 0h3v14h-3z"/>'};
function icon(name){return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;}

function render(){
  if(!mount)return;
  const section=node('section','sound-corner');section.setAttribute('aria-labelledby','sound-heading');
  const intro=node('div','sound-intro');intro.append(node('span','sound-eyebrow','A LITTLE ATMOSPHERE'));
  const heading=node('h2','sound-title','A softer background.');heading.id='sound-heading';intro.append(heading,node('p','sound-description','A little rain. A warm hush. A few gentle notes. Make a small soundscape of your own.'));
  const stage=node('div','sound-stage');stage.setAttribute('aria-hidden','true');
  // Decorative ceramic turntable: CSS depth and a spinning record, no heavy 3D runtime.
  stage.innerHTML='<div class="sound-shadow"></div><div class="sound-deck"><div class="sound-deck-surface"><div class="sound-platter"><div class="sound-record"><i class="sound-record-groove"></i><i class="sound-record-label"><span>日々</span></i><i class="sound-record-pin"></i></div></div><div class="sound-arm"><i></i></div><div class="sound-speaker"><i></i><i></i><i></i><i></i><i></i></div><span class="sound-deck-logo">DAYLIGHT / 01</span><span class="sound-led"></span><span class="sound-knob"></span></div></div><div class="sound-air sound-air-one"></div><div class="sound-air sound-air-two"></div>';
  const play=button('','sound-play-button',()=>playing||starting?stopSounds():startSounds(),'Play background sounds');
  const playback=node('div','sound-playback');const status=node('p','sound-status');status.setAttribute('aria-live','polite');playback.append(play,status);intro.append(stage,playback);
  const mixer=node('div','sound-mixer');const presetLabel=node('span','sound-control-label','START WITH A MOOD');const presets=node('div','sound-presets');presets.setAttribute('role','group');presets.setAttribute('aria-label','Sound mix presets');
  for(const [id,preset] of Object.entries(SOUND_PRESETS)){const b=button(preset.name,'sound-preset',()=>applyPreset(id));b.dataset.preset=id;presets.append(b);}
  mixer.append(presetLabel,presets);
  const channels=node('div','sound-channel-list');view.channelRows={};
  for(const channel of CHANNELS){
    const row=node('div','sound-channel');const toggle=button('','sound-channel-toggle',()=>changeEnabled(channel.id),`${channel.name} sound`);toggle.innerHTML=icon(channel.symbol);toggle.setAttribute('aria-pressed',String(state.channels[channel.id].enabled));
    const info=node('div','sound-channel-info');info.append(node('span','sound-channel-name',channel.name),node('span','sound-channel-description',channel.description));
    const sliderWrap=node('div','sound-volume');const slider=node('input','sound-slider');slider.type='range';slider.min='0';slider.max='100';slider.step='1';slider.value=state.channels[channel.id].volume;slider.setAttribute('aria-label',`${channel.name} volume`);const output=node('output','sound-volume-value',`${slider.value}%`);slider.id=`sound-volume-${channel.id}`;output.htmlFor=slider.id;
    slider.oninput=()=>{state.channels[channel.id].volume=Number(slider.value);save();updateChannelGains();if(playing&&!anySound())stopSounds();else synchronizeChimes();updateControls();};sliderWrap.append(slider,output);row.append(toggle,info,sliderWrap);channels.append(row);view.channelRows[channel.id]={row,toggle,slider,output};
  }
  const sleep=node('div','sound-sleep');const sleepCopy=node('div');sleepCopy.append(node('span','sound-sleep-title','Let it fade away'),node('span','sound-sleep-description','A sleep timer for your soundscape.'));
  const select=node('select','sound-sleep-select');select.setAttribute('aria-label','Sound sleep timer');for(const minutes of [0,15,30,60])select.append(new Option(minutes?`${minutes} minutes`:'No timer',String(minutes)));select.value=String(state.sleepMinutes);
  select.onchange=()=>{state.sleepMinutes=Number(select.value);save();if(playing){deadline=soundDeadline(state.sleepMinutes);scheduleFade();}updatePlayback();};sleep.append(sleepCopy,select);
  const timerLabel=node('p','sound-timer-note');timerLabel.setAttribute('aria-live','off');
  const foot=node('p','sound-footnote','Made here, on your device. No recordings to download. Audio starts only when you press play.');
  mixer.append(channels,sleep,timerLabel,foot);section.append(intro,mixer);mount.replaceChildren(section);view={...view,section,play,status,stage,presets,select,timerLabel};updateControls();
}
function updateControls(){
  if(!view.section)return;
  for(const {id} of CHANNELS){const channel=state.channels[id],elements=view.channelRows[id];elements.toggle.setAttribute('aria-pressed',String(channel.enabled));elements.row.classList.toggle('sound-channel-on',channel.enabled);elements.slider.value=String(channel.volume);elements.slider.style.setProperty('--sound-volume',`${channel.volume}%`);elements.output.textContent=`${channel.volume}%`;}
  const active=currentPreset();for(const b of view.presets.children)b.setAttribute('aria-pressed',String(b.dataset.preset===active));view.select.value=String(state.sleepMinutes);updatePlayback();
}
function updatePlayback(){
  if(!view.section)return;
  view.section.dataset.playing=String(playing);view.play.disabled=starting||!AudioConstructor();view.play.innerHTML=icon(playing?'pause':'play')+`<span>${starting?'Opening your quiet corner…':playing?'Pause the atmosphere':'Play my soundscape'}</span>`;view.play.setAttribute('aria-label',playing?'Pause background sounds':'Play background sounds');
  view.status.textContent=lastError||(!AudioConstructor()?'Sound playback is not available in this browser.':playing?'A little atmosphere, just for you.':'Quiet for now. Your mix is ready.');
  if(playing&&deadline!==null){const seconds=soundSecondsLeft(deadline);view.timerLabel.textContent=`Fades to quiet in ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}.`;}
  else view.timerLabel.textContent=state.sleepMinutes?`The ${state.sleepMinutes}-minute timer starts when you press play.`:'Your sounds can keep you company until you pause them.';
}
function changeEnabled(id){state.channels[id].enabled=!state.channels[id].enabled;save();updateChannelGains();if(playing&&!anySound())stopSounds();else synchronizeChimes();updateControls();}
function applyPreset(id){const preset=SOUND_PRESETS[id];state.channels=Object.fromEntries(CHANNELS.map(({id})=>[id,{...preset.channels[id]}]));save();updateChannelGains();synchronizeChimes();updateControls();notify(`${preset.name}. ${playing?'Your mix has changed.':'Ready when you press play.'}`);}

function noiseBuffer(context,brown=false){
  const length=Math.ceil(context.sampleRate*8),buffer=context.createBuffer(1,length,context.sampleRate),data=buffer.getChannelData(0);let previous=0;
  for(let i=0;i<length;i++){const white=Math.random()*2-1;if(brown){previous=(previous+.02*white)/1.02;data[i]=Math.max(-.85,Math.min(.85,previous*3.5));}else data[i]=white;}
  if(brown){const fade=Math.min(2048,Math.floor(length/20)),first=data[0];for(let i=0;i<fade;i++){const weight=(i+1)/fade;data[length-fade+i]=data[length-fade+i]*(1-weight)+first*weight;}}
  return buffer;
}
function makeNoise(context,id){
  const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=noiseBuffer(context,id==='brown');source.loop=true;
  filter.type='lowpass';filter.frequency.value=id==='rain'?4200:600;filter.Q.value=.4;gain.gain.value=0;
  source.connect(filter);filter.connect(gain);gain.connect(master);source.start();return {source,filter,gain};
}
function updateChannelGains(){
  if(!audio||!playing)return;
  for(const {id} of CHANNELS){const channel=state.channels[id],gain=graph[id]?.gain;if(!gain)continue;const target=channel.enabled?Math.pow(channel.volume/100,1.65)*({rain:.65,brown:.8,chimes:1}[id]):0;gain.gain.setTargetAtTime(target,audio.currentTime,.14);}
}
function scheduleFade(){
  if(!audio||!master||!playing)return;
  const left=soundSecondsLeft(deadline);if(left===0){stopSounds();return;}
  const now=audio.currentTime,gain=master.gain,current=gain.value;gain.cancelScheduledValues(now);gain.setValueAtTime(current,now);
  if(deadline!==null){const remaining=Math.max(0,(deadline-Date.now())/1000);if(remaining>.4){gain.linearRampToValueAtTime(MAX_GAIN,now+.4);gain.setValueAtTime(MAX_GAIN,now+Math.max(.4,remaining-2));}gain.linearRampToValueAtTime(0,now+remaining);}
  else gain.linearRampToValueAtTime(MAX_GAIN,now+.4);
}
function chime(){
  if(!playing||!audio||!state.channels.chimes.enabled||state.channels.chimes.volume===0)return;
  if(deadline!==null&&Date.now()>=deadline){stopSounds();return;}
  const context=audio,now=context.currentTime,notes=[523.25,587.33,659.25,783.99,880],frequency=notes[Math.floor(Math.random()*notes.length)];
  for(const [ratio,level] of [[1,.2],[2,.055],[3,.018]]){
    const oscillator=context.createOscillator(),envelope=context.createGain();oscillator.type='sine';oscillator.frequency.value=frequency*ratio;envelope.gain.setValueAtTime(0,now);envelope.gain.linearRampToValueAtTime(level,now+.018);envelope.gain.exponentialRampToValueAtTime(.0001,now+3.8);oscillator.connect(envelope);envelope.connect(graph.chimes.gain);const voice={oscillator,envelope};voices.add(voice);oscillator.onended=()=>{voices.delete(voice);oscillator.disconnect();envelope.disconnect();};oscillator.start(now);oscillator.stop(now+4);
  }
  chimeTimer=setTimeout(chime,4500+Math.random()*2600);
}
function synchronizeChimes(){clearTimeout(chimeTimer);chimeTimer=null;if(playing&&state.channels.chimes.enabled&&state.channels.chimes.volume>0)chimeTimer=setTimeout(chime,700);}
async function startSounds(){
  if(playing||starting)return;load();if(!anySound()){notify('Choose a sound and turn its volume up a little.');return;}
  const Ctor=AudioConstructor();if(!Ctor){lastError='Sound playback is not available in this browser.';updatePlayback();notify(lastError);return;}
  starting=true;lastError='';const token=++generation;updatePlayback();
  try{
    const context=new Ctor();audio=context;await context.resume();if(token!==generation)return;
    if(context.state!=='running')throw new Error('This browser paused the audio. Press play to try again.');
    master=context.createGain();master.gain.value=0;master.connect(context.destination);graph={rain:makeNoise(context,'rain'),brown:makeNoise(context,'brown'),chimes:{gain:context.createGain()}};graph.chimes.gain.gain.value=0;graph.chimes.gain.connect(master);
    starting=false;playing=true;deadline=soundDeadline(state.sleepMinutes);updateChannelGains();scheduleFade();synchronizeChimes();
    context.onstatechange=()=>{if(context!==audio)return;if(deadline!==null&&Date.now()>=deadline)stopSounds();else if(playing&&context.state!=='running'){stopSounds();notify('Your browser paused the soundscape. Press play when you are ready.');}};
    clockTimer=setInterval(()=>{if(deadline!==null&&Date.now()>=deadline){stopSounds();notify('Your soundscape has faded to quiet.');}else updatePlayback();},1000);updatePlayback();
  }catch(error){if(token!==generation)return;stopSounds();lastError=String(error?.message||'This browser could not start the soundscape.');updatePlayback();notify(lastError);}
}
/** Stop immediately and release audio resources. Settings are retained; playback is never saved. */
export function stopSounds(){
  generation++;playing=false;starting=false;deadline=null;clearTimeout(chimeTimer);clearInterval(clockTimer);chimeTimer=null;clockTimer=null;
  const context=audio;audio=null;if(context)context.onstatechange=null;
  for(const channel of Object.values(graph)){try{channel.source?.stop();}catch{}try{channel.source?.disconnect();channel.filter?.disconnect();channel.gain?.disconnect();}catch{}}
  for(const voice of voices){try{voice.oscillator.stop();voice.oscillator.disconnect();voice.envelope.disconnect();}catch{}}voices.clear();graph={};try{master?.disconnect();}catch{}master=null;
  if(context&&context.state!=='closed')context.close().catch(()=>{});updatePlayback();
}
export function initSounds(root,{toast=()=>{}}={}){
  cleanup?.();mount=root;notify=toast;load();render();
  const pageHide=()=>stopSounds();const visible=()=>{if(playing&&deadline!==null&&Date.now()>=deadline){stopSounds();notify('Your soundscape has faded to quiet.');}};
  const storage=event=>{if(event.key!==STORAGE_KEY||!event.newValue)return;try{const next=validateSounds(JSON.parse(event.newValue));stopSounds();state=next;storageBlocked=false;lastError='';render();}catch{notify('Sound settings from another tab could not be read.');}};
  window.addEventListener('pagehide',pageHide);window.addEventListener('storage',storage);document.addEventListener('visibilitychange',visible);
  cleanup=()=>{stopSounds();window.removeEventListener('pagehide',pageHide);window.removeEventListener('storage',storage);document.removeEventListener('visibilitychange',visible);cleanup=null;};return cleanup;
}
