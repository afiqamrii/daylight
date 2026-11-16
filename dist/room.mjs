const KEY='daylight.room.v1';
let settings={version:1,warm:false},scene=null;
export function validateRoom(value){if(!value||value.version!==1||typeof value.warm!=='boolean')throw new Error('Invalid room settings.');return {version:1,warm:value.warm};}
export function getRoom(){try{const raw=localStorage.getItem(KEY);return raw?validateRoom(JSON.parse(raw)):{...settings};}catch{return {...settings};}}
export function restoreRoom(value){settings=validateRoom(value);let saved=true;try{localStorage.setItem(KEY,JSON.stringify(settings));}catch{saved=false;}paintLight();return saved;}
function paintLight(){scene?.classList.toggle('is-warm',settings.warm);document.querySelector('#desk-light')?.setAttribute('aria-pressed',String(settings.warm));}
const destinations=[
  ['◷','My day','Tasks, priorities, and a plan that fits','today','#task-panel'],
  ['◉','Focus timer','One thing at a time, for 15, 25, or 50 minutes','today','.focus-card'],
  ['↳','Personal notes','Give a loose thought a place to land','today','#notes'],
  ['◌','Habits & a little check-in','Water, breathing, mood, and daily rituals','rituals','#rituals-content'],
  ['♫','Sound corner','Rain, warm noise, chimes, and a sleep timer','rituals','#sounds-content'],
  ['⌁','Momo & little joys','Your cat companion, decision jar, and sketchpad','joys','#joys-view'],
  ['⚄','A little game','Memory, Number Garden, and Lanterns','games','#games-view'],
  ['▤','Reading shelf','Books, pages, and small reading progress','shelf','#shelf-view'],
  ['↗','Saved links & happy moments','Keep useful places and things worth remembering','shelf','#shelf-view'],
  ['☁','Ask Kumo','Planning, smaller steps, and a little company','helper','#helper-view'],
];
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
export function initRoom({openSpace,focusNow}){
  scene=document.querySelector('#desk-scene');settings=getRoom();paintLight();
  document.querySelector('#desk-light').onclick=()=>{settings={version:1,warm:!settings.warm};paintLight();try{localStorage.setItem(KEY,JSON.stringify(settings));}catch{}};
  document.querySelector('#hero-focus').onclick=focusNow;
  const motion=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover:hover)');
  const reset=()=>{scene.style.setProperty('--tilt-x','0deg');scene.style.setProperty('--tilt-y','0deg');};
  scene.addEventListener('pointermove',e=>{if(motion.matches||!fine.matches)return;const r=scene.getBoundingClientRect();scene.style.setProperty('--tilt-x',`${(0.5-(e.clientY-r.top)/r.height)*7}deg`);scene.style.setProperty('--tilt-y',`${((e.clientX-r.left)/r.width-.5)*9}deg`);});
  scene.addEventListener('pointerleave',reset);motion.addEventListener('change',reset);
  addEventListener('storage',e=>{if(e.key===KEY||e.key===null){settings=getRoom();paintLight();}});
  const dialog=make('dialog','room-search');dialog.setAttribute('aria-labelledby','room-search-title');const heading=make('div','room-search-head'),title=make('h2','','What would feel useful?');title.id='room-search-title';const close=make('button','room-search-close','×');close.type='button';close.setAttribute('aria-label','Close quick find');close.onclick=()=>dialog.close();heading.append(title,close);
  const input=make('input');input.type='search';input.placeholder='Try “rain”, “books”, or “focus”…';input.setAttribute('aria-label','Search your spaces');input.maxLength=100;
  const results=make('div','room-search-results');dialog.append(heading,input,results);document.body.append(dialog);let previousFocus,pendingDestination=null;
  function render(){results.replaceChildren();const query=input.value.trim().toLowerCase();const list=destinations.filter(item=>item.slice(1,3).join(' ').toLowerCase().includes(query));if(!list.length){results.append(make('p','room-search-empty','Nothing here yet. Try a simpler word.'));return;}for(const [symbol,name,description,space,selector] of list){const b=make('button','room-search-result');b.type='button';const art=make('span','',symbol);art.setAttribute('aria-hidden','true');const copy=make('span');copy.append(make('strong','',name),make('small','',description));b.append(art,copy,make('span','','↗'));b.onclick=()=>{pendingDestination={space,selector};dialog.close();};results.append(b);}}
  function open(){if(document.querySelector('dialog[open]'))return;previousFocus=document.activeElement;pendingDestination=null;input.value='';render();dialog.showModal();input.focus();}
  input.oninput=render;input.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}else if(e.key==='Enter'){e.preventDefault();results.querySelector('button')?.click();}};
  results.onkeydown=e=>{if(!['ArrowDown','ArrowUp'].includes(e.key))return;const all=[...results.querySelectorAll('button')],index=all.indexOf(document.activeElement);if(index<0)return;e.preventDefault();all[(index+(e.key==='ArrowDown'?1:all.length-1))%all.length]?.focus();};
  dialog.addEventListener('close',()=>{
    const destination=pendingDestination;pendingDestination=null;
    if(!destination){if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});return;}
    openSpace(destination.space);
    const target=document.querySelector(destination.selector)||document.querySelector(`[data-space="${destination.space}"]`);
    if(!target)return;
    target.scrollIntoView({behavior:motion.matches?'instant':'smooth',block:'center'});
    if(!target.matches('input,textarea,select,button,a[href],[tabindex]'))target.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
  });dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
  document.querySelector('#quick-find').onclick=open;document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open();}});
}
