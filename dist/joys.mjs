const STORAGE_KEY = 'daylight.joys.v1';
const INKS = Object.freeze([{name:'Charcoal',value:'#46443e'},{name:'Brick',value:'#9b6559'},{name:'Moss',value:'#828b70'},{name:'Ochre',value:'#bb9c60'}]);
const CAT_MOODS = ['content','happy','playful','sleepy'];
const MAX_STROKES = 200;
let state = freshJoys();
let rootNode = null;
let say = () => {};
let view = {};
let catTimer = null;
let pickTimer = null;
let resizeObserver = null;
let currentStroke = null;
let activePointer = null;
let undoActions = [];
let selectedInk = INKS[0].value;
let erasing = false;
let isPicking = false;
let storageBlocked = false;
let lastStored = null;
let storageListener = null;
let catRevision = 0;

export function freshJoys() {
  return {version:1,cat:{mood:'content',pets:0},options:'Make a cup of tea\nRead a few pages\nTake a little walk',lastPick:'',strokes:[]};
}

function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value)));
}
function boundedText(value,max) { return typeof value === 'string' && value.length <= max; }
function boundedNumber(value,min,max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
const clone = value => JSON.parse(JSON.stringify(value));

/** Validate a portable snapshot without invoking any browser APIs. */
export function validateJoys(input) {
  if (!plain(input) || input.version !== 1 || !plain(input.cat)) throw new Error('Invalid Little joys backup.');
  if (!CAT_MOODS.includes(input.cat.mood) || !Number.isInteger(input.cat.pets) || !boundedNumber(input.cat.pets,0,999999)) throw new Error('Invalid companion data.');
  if (!boundedText(input.options,6000) || !boundedText(input.lastPick,200)) throw new Error('Invalid decision jar.');
  if (!Array.isArray(input.strokes) || input.strokes.length > MAX_STROKES) throw new Error('Too many sketch strokes.');
  let pointCount = 0;
  const strokes = input.strokes.map(stroke => {
    if (!plain(stroke) || !INKS.some(ink=>ink.value===stroke.color) || typeof stroke.erase !== 'boolean' || !boundedNumber(stroke.width,0.001,0.1) || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > 2000) throw new Error('Invalid sketch stroke.');
    pointCount += stroke.points.length;
    if (pointCount > 50000) throw new Error('The sketch has too many points.');
    const points = stroke.points.map(point => {
      if (!plain(point) || !boundedNumber(point.x,0,1) || !boundedNumber(point.y,0,1)) throw new Error('Invalid sketch point.');
      return {x:point.x,y:point.y};
    });
    return {color:stroke.color,erase:stroke.erase,width:stroke.width,points};
  });
  return {version:1,cat:{mood:input.cat.mood,pets:input.cat.pets},options:input.options,lastPick:input.lastPick,strokes};
}

export function getJoys() { syncStored(true);return clone(state); }

export function restoreJoys(input) {
  state = validateJoys(input);
  storageBlocked = false;
  undoActions = [];
  currentStroke = null;
  activePointer = null;
  clearTimeout(catTimer);
  catRevision++;
  clearTimeout(pickTimer);
  isPicking = false;
  persist();
  renderState();
}

export function parseChoices(text) {
  if (typeof text !== 'string') throw new Error('Write two or more options.');
  const choices = text.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  if (choices.length < 2 || choices.length > 30) throw new Error('Add between 2 and 30 options, one on each line.');
  if (choices.some(value=>value.length>200)) throw new Error('Keep each option under 200 characters.');
  return choices;
}

function persist() {
  if (storageBlocked) return false;
  try { const serialized=JSON.stringify(state);localStorage.setItem(STORAGE_KEY,serialized);lastStored=serialized;return true; }
  catch { if (view.saveNote) view.saveNote.textContent = 'Storage is unavailable. Download a backup to keep your little joys.'; return false; }
}

function cancelPick() {
  clearTimeout(pickTimer);
  pickTimer=null;
  isPicking=false;
}

// Read the current stored snapshot immediately before every mutation, rather than
// relying only on asynchronous storage events. A cat click cannot save a stale sketch.
function syncStored(render=false) {
  if(typeof localStorage==='undefined')return;
  try {
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw===lastStored)return;
    const next=raw?validateJoys(JSON.parse(raw)):freshJoys();
    if(JSON.stringify(next.cat)!==JSON.stringify(state.cat)){clearTimeout(catTimer);catRevision++;}
    if(next.options!==state.options||next.lastPick!==state.lastPick)cancelPick();
    if(JSON.stringify(next.strokes)!==JSON.stringify(state.strokes))undoActions=[];
    state=next;lastStored=raw;storageBlocked=false;
    // currentStroke is deliberately separate: an incoming update never drops
    // the line currently under the user's pointer.
    if(render)renderState();
  }catch{
    storageBlocked=true;
    if(view.saveNote)view.saveNote.textContent='Saved Little joys data could not be read and has not been overwritten. Restore a backup to recover it.';
  }
}

function changeState(change) {
  syncStored();
  change(state);
  const saved=persist();
  renderState();
  return saved;
}

function node(tag,className,text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text,className,fn) {
  const element = node('button',className,text);
  element.type = 'button';
  element.addEventListener('click',fn);
  return element;
}
function card(number,title,description) {
  const section = node('section','joy-card');
  const heading = node('div','joy-heading');
  heading.append(node('span','joy-index',number),node('h2','joy-title',title));
  section.append(heading,node('p','joy-description',description));
  return section;
}

export function initJoys(root,{toast}={}) {
  rootNode = root;
  say = typeof toast === 'function' ? toast : () => {};
  resizeObserver?.disconnect();
  clearTimeout(catTimer);
  clearTimeout(pickTimer);
  if(storageListener)window.removeEventListener('storage',storageListener);
  storageBlocked = false;
  try { const raw = localStorage.getItem(STORAGE_KEY); state = raw ? validateJoys(JSON.parse(raw)) : freshJoys();lastStored=raw; }
  catch { state = freshJoys(); storageBlocked = true; }
  const grid = node('div','joy-grid');
  grid.append(buildCat(),buildJar(),buildSketch());
  rootNode.replaceChildren(grid);
  const footer = node('p','joy-save-note','Small things, saved on this device. A little joy is useful, too.');
  rootNode.append(footer);
  view.saveNote = footer;
  if (storageBlocked) footer.textContent = 'Saved Little joys data could not be read and has not been overwritten. Restore a backup to recover it.';
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(view.canvas);
  } else window.addEventListener('resize',resizeCanvas);
  renderState();
  requestAnimationFrame(resizeCanvas);
  storageListener=event=>{if(event.key===STORAGE_KEY||event.key===null)syncStored(true);};
  window.addEventListener('storage',storageListener);
  return () => {resizeObserver?.disconnect();clearTimeout(catTimer);clearTimeout(pickTimer);window.removeEventListener('storage',storageListener);window.removeEventListener('resize',resizeCanvas);};
}

function buildCat() {
  const section = card('01','A little company','Meet Momo. Very small. Very good at doing nothing.');
  section.classList.add('joy-cat-card');
  const scene = node('div','joy-cat-scene');
  const caption = node('span','joy-cat-label','MOMO / YOUR DESK COMPANION');
  const tap = button('','joy-cat-tap',()=>interactCat('happy'));
  tap.setAttribute('aria-label','Pet Momo the cat');
  // This illustration is a fixed local SVG; no saved or user text is inserted as markup.
  tap.innerHTML = `<svg class="joy-cat" viewBox="0 0 300 190" role="img" aria-label="A round cream cat sitting beside a little plant"><g class="joy-plant" stroke="#838b73" stroke-width="1.6" fill="none"><path d="M251 144v-33m0 13c-12-1-14-9-10-13 8-1 12 5 10 13Zm0-3c1-12 9-17 14-12 0 9-7 13-14 12Z"/><path d="m241 143 3 22h16l3-22Z" fill="#e7dfce" stroke="#ab9b80"/></g><ellipse class="joy-cat-shadow" cx="143" cy="168" rx="72" ry="7" fill="#e9e4d9" stroke="none"/><g class="joy-cat-body"><path class="joy-cat-tail" d="M191 151c38 18 55-9 31-19-10-4-15 7-5 10" fill="none" stroke="#c2ae89" stroke-width="11" stroke-linecap="round"/><path d="M90 124c-16 15-20 39-3 43 13 2 90 2 103-1 16-6 6-33-8-44" fill="#eadfca" stroke="#71695b" stroke-width="1.8"/><path d="m87 86-2-44 32 19c17-5 35-4 49 0l29-19-3 45c18 28 10 61-47 63-57 0-75-31-58-64Z" fill="#f2e8d6" stroke="#71695b" stroke-width="1.8"/><path d="m92 68-1-13 14 9m69 0 13-9-1 14" fill="#d9b9a7" stroke="none"/><path d="m128 62 6 14m8-16 1 15m10-14-4 14" stroke="#c8b695" stroke-width="4" stroke-linecap="round"/><g class="joy-cat-eyes" fill="#655e53" stroke="none"><ellipse cx="117" cy="105" rx="3.1" ry="4"/><ellipse cx="167" cy="105" rx="3.1" ry="4"/></g><g class="joy-cat-sleep-eyes" stroke="#655e53" stroke-width="2" fill="none"><path d="m110 106 7 3 7-3m36 0 7 3 7-3"/></g><path d="m139 116 4 3 4-3" stroke="#b48a79" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M143 120v4m0 0c-4 4-8 3-9 0m9 0c4 4 8 3 9 0" stroke="#71695b" stroke-width="1.5" fill="none" stroke-linecap="round"/><g stroke="#aa9c85" stroke-width="1.2"><path d="m100 115-20-4m20 10-21 2m103-8 20-4m-20 10 21 2"/></g><g class="joy-cat-blush" fill="#d4a694" opacity=".6" stroke="none"><ellipse cx="108" cy="119" rx="8" ry="4"/><ellipse cx="178" cy="119" rx="8" ry="4"/></g><path d="M121 155v13m44-13v13" stroke="#a4967e" stroke-width="1.5"/></g><g class="joy-cat-hearts" fill="#b78275" stroke="none"><path d="M84 50C64 34 77 25 84 34c7-9 20 0 0 16Z"/><path d="M206 79c-13-10-5-17 0-11 5-6 13 1 0 11Z"/></g><g class="joy-cat-zzz" fill="#9b8f7c" stroke="none" font-family="sans-serif"><text x="199" y="66" font-size="15">z</text><text x="216" y="48" font-size="20">z</text></g><g class="joy-cat-toy"><path d="M45 156c12-8 22 11 36-2" fill="none" stroke="#ac8174" stroke-width="1.5"/><circle cx="42" cy="157" r="12" fill="#bf9888" stroke="#9b7666" stroke-width="1.3"/><path d="m32 151 19 10m-20-4 16 9m-4-21-5 22" fill="none" stroke="#dfc0af" stroke-width="1"/></g></svg>`;
  const bubble = node('p','joy-cat-message','Momo is happy you’re here.');
  bubble.setAttribute('aria-live','polite');
  scene.append(caption,tap,bubble);
  const controls = node('div','joy-cat-controls');
  const pet = button('Pet Momo','joy-button',()=>interactCat('happy'));
  const play = button('Play a little','joy-button',()=>interactCat('playful'));
  const nap = button('Take a nap','joy-button',()=>interactCat(state.cat.mood==='sleepy'?'content':'sleepy'));
  controls.append(pet,play,nap);
  section.append(scene,controls);
  view.catScene = scene; view.catMessage = bubble; view.napButton = nap;
  return section;
}

function interactCat(mood) {
  clearTimeout(catTimer);
  changeState(next=>{next.cat.mood=mood;if(mood==='happy')next.cat.pets=Math.min(999999,next.cat.pets+1);});
  const revision=++catRevision;
  if (mood === 'happy' || mood === 'playful') catTimer = setTimeout(()=>{
    syncStored(true);
    if(revision!==catRevision)return;
    changeState(next=>{next.cat.mood='content';});
  },5000);
}
function renderCat() {
  if (!view.catScene) return;
  view.catScene.dataset.mood = state.cat.mood;
  view.catMessage.textContent = {content:'Momo is happy you’re here.',happy:'A little purr. A very good moment.',playful:'The important business of chasing a ball.',sleepy:'A tiny nap. You’re allowed to rest, too.'}[state.cat.mood];
  view.napButton.textContent = state.cat.mood === 'sleepy' ? 'Wake gently' : 'Take a nap';
  view.napButton.setAttribute('aria-pressed',String(state.cat.mood === 'sleepy'));
}

function buildJar() {
  const section = card('02','Let the jar choose','For small decisions that take up too much space.');
  section.classList.add('joy-jar-card');
  const label = node('label','joy-field-label','Your options, one per line');
  label.htmlFor = 'joy-options';
  const options = node('textarea','joy-options');
  options.id = 'joy-options'; options.maxLength = 6000; options.rows = 4;
  options.placeholder = 'A cup of tea\nA short walk\nA little music';
  options.addEventListener('input',()=>{const value=options.value;cancelPick();changeState(next=>{next.options=value;next.lastPick='';});});
  const lower = node('div','joy-jar-bottom');
  const jar = node('div','joy-jar-illustration');
  jar.setAttribute('aria-hidden','true');
  jar.innerHTML = '<svg viewBox="0 0 60 66"><path d="M18 9h24v9l7 8v29c0 4-4 7-8 7H19c-4 0-8-3-8-7V26l7-8Z" fill="#ede8db" stroke="#a99d85" stroke-width="1.3"/><path d="M17 9h26V4H17Zm1 9h24" fill="#c8b99c" stroke="#a99d85" stroke-width="1.3"/><path d="m18 31 17-4 5 15-17 5Zm10 18 16-6 4 11-15 6Z" fill="#fdfbf4" stroke="#d3c8b3" stroke-width="1.2"/><path d="m22 35 10-2m2 17 8-3" stroke="#c3b298" stroke-width="1.2"/></svg>';
  const result = node('div','joy-jar-result');result.setAttribute('aria-live','polite');
  const resultLabel = node('span','joy-result-label','A LITTLE NUDGE');
  const resultText = node('strong','joy-result-text','What will it be?');
  result.append(resultLabel,resultText);
  lower.append(jar,result);
  const pick = button('Pick something for me','joy-button joy-button-solid',pickChoice);
  section.append(label,options,lower,pick);
  view.options = options; view.jar = jar; view.jarResult = resultText; view.pickButton = pick;
  return section;
}
function randomIndex(length) {
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    const limit = Math.floor(4294967296/length)*length;
    do { globalThis.crypto.getRandomValues(buffer); } while (buffer[0]>=limit);
    return buffer[0]%length;
  }
  return Math.floor(Math.random()*length);
}
function pickChoice() {
  if (isPicking) return;
  let choices;
  try { choices=parseChoices(view.options.value); }
  catch (error) { say(error.message);view.options.focus();return; }
  const options=view.options.value;
  changeState(next=>{next.options=options;});
  isPicking=true;view.pickButton.disabled=true;view.jar.classList.add('joy-shaking');view.jarResult.textContent='A little shake…';
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  pickTimer=setTimeout(()=>{
    syncStored(true);
    if(!isPicking||state.options!==options)return;
    isPicking=false;changeState(next=>{next.lastPick=choices[randomIndex(choices.length)];});
  },reduced?100:700);
}
function renderJarResult() {
  if (!view.jarResult) return;
  view.jarResult.textContent=state.lastPick||'What will it be?';
  view.jar.classList.toggle('joy-shaking',isPicking);
  view.pickButton.disabled=isPicking;
}

function buildSketch() {
  const section=card('03','A little room to doodle','No good or bad drawings here. Just leave a mark.');
  section.classList.add('joy-sketch-card');
  const toolbar=node('div','joy-sketch-toolbar');
  const palette=node('div','joy-palette');palette.setAttribute('role','group');palette.setAttribute('aria-label','Ink colour');
  view.inks=[];
  INKS.forEach(ink=>{const swatch=button('','joy-swatch',()=>{selectedInk=ink.value;erasing=false;renderDrawingTools();});swatch.style.setProperty('--joy-ink',ink.value);swatch.setAttribute('aria-label',`${ink.name} ink`);swatch.title=`${ink.name} ink`;swatch.dataset.ink=ink.value;palette.append(swatch);view.inks.push(swatch);});
  const eraser=button('Eraser','joy-tool-button',()=>{erasing=!erasing;renderDrawingTools();});eraser.setAttribute('aria-pressed','false');
  const undo=button('Undo','joy-tool-button',undoDrawing);
  const clear=button('Clear','joy-tool-button',clearDrawing);
  const save=button('Save picture ↗','joy-tool-button joy-save-picture',savePicture);
  toolbar.append(palette,eraser,undo,clear,save);
  const frame=node('div','joy-canvas-frame');
  const canvas=node('canvas','joy-canvas');
  canvas.setAttribute('aria-label','Freehand sketchpad. Draw with a mouse, touch, or pen. Use the controls above to change ink, erase, undo, clear, or save.');
  canvas.setAttribute('role','img');
  canvas.textContent='Freehand sketchpad for mouse, touch, or pen. Your browser must support canvas.';
  const hint=node('span','joy-canvas-hint','a small mark is a perfectly good start.');
  hint.setAttribute('aria-hidden','true');
  frame.append(canvas,hint);
  const footer=node('div','joy-sketch-footer');
  const status=node('span','joy-sketch-status','Ready for your first mark.');status.setAttribute('aria-live','polite');
  footer.append(node('span','','MOUSE, TOUCH, OR PEN'),status);
  section.append(toolbar,frame,footer);
  view.canvas=canvas;view.canvasHint=hint;view.eraser=eraser;view.undo=undo;view.clear=clear;view.sketchStatus=status;
  canvas.addEventListener('pointerdown',startStroke);
  canvas.addEventListener('pointermove',moveStroke);
  canvas.addEventListener('pointerup',finishStroke);
  canvas.addEventListener('pointercancel',finishStroke);
  canvas.addEventListener('lostpointercapture',()=>{if(currentStroke)commitStroke();});
  return section;
}
function renderState() {
  if (!rootNode) return;
  renderCat();view.options.value=state.options;renderJarResult();renderDrawingTools();resizeCanvas();
}
function renderDrawingTools() {
  if (!view.canvas) return;
  view.inks.forEach(swatch=>swatch.setAttribute('aria-pressed',String(!erasing&&swatch.dataset.ink===selectedInk)));
  view.eraser.setAttribute('aria-pressed',String(erasing));
  view.undo.disabled=!undoActions.length&&!state.strokes.length;
  view.clear.disabled=!state.strokes.length;
  view.canvas.classList.toggle('joy-is-erasing',erasing);
  view.canvasHint.hidden=Boolean(state.strokes.length||currentStroke);
  view.sketchStatus.textContent=state.strokes.length?`${state.strokes.length} ${state.strokes.length===1?'stroke':'strokes'} · saved on this device`:'Ready for your first mark.';
}
function resizeCanvas() {
  if (!view.canvas) return;
  const rect=view.canvas.getBoundingClientRect();
  if (!rect.width||!rect.height) return;
  const dpr=Math.min(globalThis.devicePixelRatio||1,3);
  const width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
  if (view.canvas.width!==width||view.canvas.height!==height) {view.canvas.width=width;view.canvas.height=height;}
  drawAll();
}
function drawStroke(context,stroke,width,height) {
  if (!stroke.points.length) return;
  context.save();context.globalCompositeOperation=stroke.erase?'destination-out':'source-over';
  context.strokeStyle=stroke.color;context.fillStyle=stroke.color;context.lineWidth=stroke.width*width;context.lineCap='round';context.lineJoin='round';
  context.beginPath();
  if (stroke.points.length===1) {const p=stroke.points[0];context.arc(p.x*width,p.y*height,context.lineWidth/2,0,Math.PI*2);context.fill();}
  else {stroke.points.forEach((p,i)=>i?context.lineTo(p.x*width,p.y*height):context.moveTo(p.x*width,p.y*height));context.stroke();}
  context.restore();
}
function drawAll() {
  const canvas=view.canvas;if (!canvas) return;
  const context=canvas.getContext('2d');if (!context) return;
  context.clearRect(0,0,canvas.width,canvas.height);
  state.strokes.forEach(stroke=>drawStroke(context,stroke,canvas.width,canvas.height));
  if(currentStroke)drawStroke(context,currentStroke,canvas.width,canvas.height);
}
function pointFor(event) {
  const rect=view.canvas.getBoundingClientRect();
  return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
}
function startStroke(event) {
  if(activePointer!==null||event.button>0)return;
  syncStored(true);
  if(state.strokes.length>=MAX_STROKES){say('This little page is full. Save your picture, then clear it for a fresh page.');return;}
  const points=state.strokes.reduce((n,stroke)=>n+stroke.points.length,0);
  if(points>=48000){say('This page has lots of lovely detail. Save it, then start a fresh page.');return;}
  event.preventDefault();activePointer=event.pointerId;
  const width=view.canvas.getBoundingClientRect().width;
  currentStroke={color:selectedInk,erase:erasing,width:Math.max(.001,Math.min(.1,(erasing?20:2.5)/width)),points:[pointFor(event)]};
  view.canvas.setPointerCapture(event.pointerId);view.canvasHint.hidden=true;drawAll();
}
function moveStroke(event) {
  if(!currentStroke||event.pointerId!==activePointer)return;
  event.preventDefault();
  const events=typeof event.getCoalescedEvents==='function'?event.getCoalescedEvents():[event];
  for(const entry of events.length?events:[event]) {
    if(currentStroke.points.length>=2000)break;
    const point=pointFor(entry),last=currentStroke.points.at(-1);
    if(Math.abs(point.x-last.x)+Math.abs(point.y-last.y)>.001)currentStroke.points.push(point);
  }
  drawAll();
}
function finishStroke(event) {
  if(!currentStroke||event.pointerId!==activePointer)return;
  event.preventDefault();const pointer=activePointer;commitStroke();
  if(view.canvas.hasPointerCapture(pointer))view.canvas.releasePointerCapture(pointer);
}
function commitStroke() {
  if(!currentStroke)return;
  const stroke=currentStroke;currentStroke=null;activePointer=null;
  const saved=changeState(next=>{
    if(next.strokes.length>=MAX_STROKES||next.strokes.reduce((sum,item)=>sum+item.points.length,0)+stroke.points.length>50000){say('Another tab filled this page. Save the drawing before adding more.');return;}
    next.strokes.push(stroke);undoActions.push({type:'stroke'});undoActions=undoActions.slice(-30);
  });
  if(!saved)view.sketchStatus.textContent='Drawing is in memory. Download a backup to keep it.';
}
function undoDrawing() {
  if(currentStroke)commitStroke();
  changeState(next=>{const previous=undoActions.pop();if(previous?.type==='clear')next.strokes=previous.strokes;else next.strokes.pop();});
}
function clearDrawing() {
  if(currentStroke)commitStroke();if(!state.strokes.length)return;
  changeState(next=>{undoActions.push({type:'clear',strokes:next.strokes});undoActions=undoActions.slice(-30);next.strokes=[];});
  say('A fresh page. Undo will bring your drawing back.');
}
function savePicture() {
  if(currentStroke)commitStroke();
  const output=document.createElement('canvas');output.width=1400;output.height=Math.round(1400*(view.canvas.height/view.canvas.width));
  const context=output.getContext('2d');if(!context){say('This browser could not create a picture. Your sketch is still saved.');return;}
  state.strokes.forEach(stroke=>drawStroke(context,stroke,output.width,output.height));
  context.globalCompositeOperation='destination-over';context.fillStyle='#fcfaf5';context.fillRect(0,0,output.width,output.height);
  const download=blob=>{if(!blob){say('This browser could not create a picture. Try downloading a planner backup.');return;}const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='daylight-little-doodle.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Your little drawing is ready to keep.');};
  if(output.toBlob)output.toBlob(download,'image/png');
  else {try{const link=node('a');link.href=output.toDataURL('image/png');link.download='daylight-little-doodle.png';document.body.append(link);link.click();link.remove();say('Your little drawing is ready to keep.');}catch{say('This browser could not save a picture. Try downloading a planner backup.');}}
}
