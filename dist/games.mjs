const KEY='daylight.games.v1';
const DIRECTIONS=['up','down','left','right'];
const GAME_NAMES=['memory','merge','lanterns'];
const MAX_SCORE=1000000000000;
const OBJECTS=['Tea','Leaf','Cat','Book','Sun','Flower','Fish','Moon'];
const PICTURES=[
  '<path d="M7 13h23v10c0 7-5 11-12 11S7 30 7 23V13Zm23 3h4c7 0 7 12-4 12M5 38h29M13 8c-4-4 4-4 0-8m9 8c-4-4 4-4 0-8"/>',
  '<path d="M8 36 29 13M12 31C-1 10 23 5 36 5c1 15-5 35-24 26Zm9-11 10 1m-11 0-2-10"/>',
  '<path d="m9 15-1-10 10 7h8l10-7-1 11c10 20-35 25-26-1Z"/><path d="M15 21h1m13 0h1m-9 5 2 2 2-2m-2 2v3m-10-5-9-2m9 7-9 2m27-7 9-2m-9 7 9 2"/>',
  '<path d="M22 12C14 6 7 8 3 9v27c6-2 13-1 19 3 6-4 13-5 19-3V9c-4-1-11-3-19 3Zm0 0v27M8 15l8 2M8 23l8 2m12-8 8-2m-8 10 8-2"/>',
  '<circle cx="22" cy="22" r="10"/><path d="M22 1v5m0 32v5M1 22h5m32 0h5M7 7l4 4m22 22 4 4M7 37l4-4m22-22 4-4"/>',
  '<path d="M22 14C10-7 1 14 14 22-7 34 14 43 22 30c12 21 21 0 8-8C51 10 30 1 22 14Z"/><circle cx="22" cy="22" r="5"/>',
  '<path d="M33 13 42 7v30l-9-6C15 48-9 24 3 17 13 5 25 6 33 13Z"/><path d="M29 13c-5 6-5 12 0 19"/><circle cx="13" cy="20" r="1"/><path d="m16 32-4 6m5-24-5-6"/>',
  '<path d="M32 5C10-4-5 27 16 38c12 7 24-1 26-11C22 34 10 16 32 5Z"/><path d="M35 7v8m-4-4h8"/>'
];
const plain=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v)));
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const copy=v=>JSON.parse(JSON.stringify(v));
let state,rootNode,toast=()=>{},selected='memory',view={},hideTimer=null,ticker=null,storageListener=null,storageBlocked=false,lastStoredRaw=null;

function random(){if(globalThis.crypto?.getRandomValues){const a=new Uint32Array(1);globalThis.crypto.getRandomValues(a);return a[0]/4294967296;}return Math.random();}
function shuffle(list){const result=[...list];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
const isTile=v=>v===0||(integer(v,2,1073741824)&&Number.isInteger(Math.log2(v)));
function validBoard(board){return Array.isArray(board)&&board.length===16&&board.every(isTile);}

/** A pure 2048 move: a tile can merge only once in each direction. */
export function moveBoard(board,direction){
  if(!validBoard(board)||!DIRECTIONS.includes(direction))throw new Error('Invalid number board or direction.');
  const output=Array(16).fill(0);let score=0;
  for(let line=0;line<4;line++){
    const indices=Array.from({length:4},(_,n)=>direction==='left'?line*4+n:direction==='right'?line*4+3-n:direction==='up'?n*4+line:(3-n)*4+line);
    const values=indices.map(i=>board[i]).filter(Boolean),merged=[];
    for(let i=0;i<values.length;i++){
      if(values[i]===values[i+1]&&values[i]<1073741824){const value=values[i]*2;merged.push(value);score+=value;i++;}
      else merged.push(values[i]);
    }
    indices.forEach((index,n)=>output[index]=merged[n]||0);
  }
  return {board:output,score,moved:output.some((value,i)=>value!==board[i])};
}
export function canMove(board){return validBoard(board)&&DIRECTIONS.some(direction=>moveBoard(board,direction).moved);}
export function toggleLanterns(cells,index){
  if(!Array.isArray(cells)||cells.length!==25||!cells.every(v=>typeof v==='boolean')||!integer(index,0,24))throw new Error('Invalid lantern board.');
  const next=[...cells],row=Math.floor(index/5),col=index%5;
  [index,...(row>0?[index-5]:[]),...(row<4?[index+5]:[]),...(col>0?[index-1]:[]),...(col<4?[index+1]:[])].forEach(i=>next[i]=!next[i]);
  return next;
}
export function scrambleLanterns(indices){
  let cells=Array(25).fill(false);
  for(const index of indices)cells=toggleLanterns(cells,index);
  return cells;
}
function addTile(board){const next=[...board],empty=next.map((v,i)=>v?null:i).filter(v=>v!==null);if(empty.length)next[empty[Math.floor(random()*empty.length)]]=random()<.9?2:4;return next;}
function newMemory(best=null){return {cards:shuffle([...Array(8).keys(),...Array(8).keys()]),revealed:[],matched:[],moves:0,startedAt:null,elapsedMs:0,best};}
function newMerge(best=0){return {board:addTile(addTile(Array(16).fill(0))),score:0,best,undo:null,celebrated:false};}
function newLanterns(wins=0){let cells=scrambleLanterns(Array.from({length:12},()=>Math.floor(random()*25)));if(!cells.some(Boolean))cells=toggleLanterns(cells,12);return {cells,initial:[...cells],moves:0,wins,solved:false};}
export function freshGames(){return {version:1,memory:newMemory(),merge:newMerge(),lanterns:newLanterns()};}

export function validateGames(input){
  if(!plain(input)||input.version!==1||!plain(input.memory)||!plain(input.merge)||!plain(input.lanterns))throw new Error('Invalid game backup.');
  const m=input.memory;
  if(!Array.isArray(m.cards)||m.cards.length!==16||!m.cards.every(v=>integer(v,0,7))||Array.from({length:8},(_,i)=>m.cards.filter(v=>v===i).length).some(v=>v!==2))throw new Error('Invalid memory cards.');
  const validIndices=(v,max)=>Array.isArray(v)&&v.length<=max&&v.every(i=>integer(i,0,15))&&new Set(v).size===v.length;
  if(!validIndices(m.revealed,2)||!validIndices(m.matched,16)||m.matched.length%2||m.revealed.some(i=>m.matched.includes(i)))throw new Error('Invalid memory selections.');
  for(let value=0;value<8;value++){const count=m.matched.filter(i=>m.cards[i]===value).length;if(count!==0&&count!==2)throw new Error('Invalid memory matches.');}
  if(!integer(m.moves,0,1000000)||!integer(m.elapsedMs,0,315360000000)||!(m.startedAt===null||integer(m.startedAt,0,8640000000000000)))throw new Error('Invalid memory progress.');
  let best=null;if(m.best!==null){if(!plain(m.best)||!integer(m.best.moves,8,1000000)||!integer(m.best.elapsedMs,0,315360000000))throw new Error('Invalid memory best.');best={moves:m.best.moves,elapsedMs:m.best.elapsedMs};}
  const g=input.merge;
  if(!validBoard(g.board)||!integer(g.score,0,MAX_SCORE)||!integer(g.best,0,MAX_SCORE)||typeof g.celebrated!=='boolean')throw new Error('Invalid number game.');
  let undo=null;if(g.undo!==null){if(!plain(g.undo)||!validBoard(g.undo.board)||!integer(g.undo.score,0,MAX_SCORE))throw new Error('Invalid number undo.');undo={board:[...g.undo.board],score:g.undo.score};}
  const l=input.lanterns;
  if(![l.cells,l.initial].every(v=>Array.isArray(v)&&v.length===25&&v.every(n=>typeof n==='boolean'))||!integer(l.moves,0,1000000)||!integer(l.wins,0,1000000)||typeof l.solved!=='boolean'||l.solved===l.cells.some(Boolean))throw new Error('Invalid lantern puzzle.');
  return {version:1,memory:{cards:[...m.cards],revealed:[...m.revealed],matched:[...m.matched],moves:m.moves,startedAt:m.startedAt,elapsedMs:m.elapsedMs,best},merge:{board:[...g.board],score:g.score,best:Math.max(g.best,g.score),undo,celebrated:g.celebrated},lanterns:{cells:[...l.cells],initial:[...l.initial],moves:l.moves,wins:l.wins,solved:l.solved}};
}
/** Apply a single game's mutation to the latest snapshot, retaining every other game. */
export function mergeGameChange(latest,game,mutate,expected=null){
  if(!GAME_NAMES.includes(game)||typeof mutate!=='function')throw new Error('Invalid game update.');
  const snapshot=validateGames(latest),before=JSON.stringify(snapshot[game]);
  if(expected!==null&&before!==expected)return {snapshot,applied:false,conflict:true};
  const result=mutate(snapshot[game]);
  if(result===false)return {snapshot,applied:false,conflict:false};
  if(result!==undefined)snapshot[game]=result;
  const clean=validateGames(snapshot);
  return {snapshot:clean,applied:JSON.stringify(clean[game])!==before,conflict:false};
}
function readLatest(){
  if(storageBlocked)return state;
  try{
    const raw=localStorage.getItem(KEY);
    if(raw===lastStoredRaw)return state;
    const latest=raw?validateGames(JSON.parse(raw)):freshGames();
    lastStoredRaw=raw;
    return latest;
  }catch{storageBlocked=true;if(view.saved)view.saved.textContent='Saved games could not be read. Your current games remain in memory; make a backup to keep them.';return state;}
}
function syncLatest(){
  const before=JSON.stringify(state?.memory);state=readLatest();
  renderAll();if(before!==JSON.stringify(state?.memory))scheduleMemoryHide();
}
function commitGame(game,mutate,expected=null){
  const oldMemory=JSON.stringify(state.memory);
  const result=mergeGameChange(readLatest(),game,mutate,expected);
  state=result.snapshot;
  if(result.applied)persist();
  renderAll();
  if(oldMemory!==JSON.stringify(state.memory))scheduleMemoryHide();
  return result;
}
function replaceWithUndo(game,create,message){
  let previous;
  const result=commitGame(game,current=>{previous=copy(current);return create(current);});
  if(!result.applied)return;
  const expected=JSON.stringify(state[game]);
  toast(message,()=>{const undone=commitGame(game,()=>previous,expected);if(undone.conflict)toast('This game has changed since then. Your newer progress is safe.');});
}
export function getGames(){if(state)syncLatest();return copy(state||freshGames());}
export function restoreGames(input){state=validateGames(input);storageBlocked=false;clearTimeout(hideTimer);persist();renderAll();scheduleMemoryHide();}
function persist(){if(storageBlocked)return false;try{const raw=JSON.stringify(state);localStorage.setItem(KEY,raw);lastStoredRaw=raw;return true;}catch{if(view.saved)view.saved.textContent='Games are in memory. Make a backup to keep them.';return false;}}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function btn(text,cls,fn){const n=el('button',cls,text);n.type='button';n.onclick=fn;return n;}
function metric(label){const n=el('div','game-metric');const value=el('strong','','0');n.append(value,el('span','',label));return {node:n,value};}
function stage(title,tag,copyText){const section=el('section','game-stage');const story=el('div','game-story');story.append(el('span','game-eyebrow',tag),el('h2','game-title',title),el('p','game-copy',copyText));const board=el('div','game-board-space');section.append(story,board);return {section,story,board};}

export function initGames(root,{toast:notify}={}){
  rootNode=root;toast=typeof notify==='function'?notify:()=>{};clearTimeout(hideTimer);clearInterval(ticker);if(storageListener)window.removeEventListener('storage',storageListener);storageBlocked=false;
  try{const raw=localStorage.getItem(KEY);state=raw?validateGames(JSON.parse(raw)):freshGames();lastStoredRaw=raw;}catch{state=freshGames();storageBlocked=true;}
  const nav=el('div','game-selector');nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Choose a game');
  view={};
  const names=[['memory','01','Memory'],['merge','02','Number garden'],['lanterns','03','Lanterns']];
  for(const [key,number,label]of names){const b=btn('','game-tab',()=>selectGame(key));b.dataset.game=key;b.id=`game-tab-${key}`;b.setAttribute('role','tab');b.setAttribute('aria-controls',`game-panel-${key}`);b.append(el('span','',number),document.createTextNode(label));b.onkeydown=e=>{let i=names.findIndex(v=>v[0]===key);if(e.key==='ArrowRight')i=(i+1)%3;else if(e.key==='ArrowLeft')i=(i+2)%3;else return;e.preventDefault();selectGame(names[i][0]);nav.children[i].focus();};nav.append(b);}
  const panels=el('div','game-panels');view.panels={memory:buildMemory(),merge:buildMerge(),lanterns:buildLanterns()};
  for(const [name,panel]of Object.entries(view.panels)){panel.id=`game-panel-${name}`;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`game-tab-${name}`);panels.append(panel);}
  const saved=el('p','game-saved','A quiet place to play. Your progress stays in this browser.');view.saved=saved;
  root.replaceChildren(nav,panels,saved);view.nav=nav;
  if(storageBlocked)saved.textContent='Saved game data could not be read and has not been overwritten. Restore a backup to recover it.';
  renderAll();selectGame(selected);scheduleMemoryHide();ticker=setInterval(renderMemoryTime,1000);
  storageListener=event=>{if(event.key!==KEY&&event.key!==null)return;storageBlocked=false;syncLatest();};
  window.addEventListener('storage',storageListener);
  return()=>{clearInterval(ticker);clearTimeout(hideTimer);window.removeEventListener('storage',storageListener);};
}
function selectGame(name){selected=name;for(const [key,panel]of Object.entries(view.panels)){panel.hidden=key!==name;}for(const b of view.nav.children){const active=b.dataset.game===name;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}}

function buildMemory(){
  const {section,story,board}=stage('Familiar little things.','A MOMENT FOR YOUR MEMORY','Turn over two tiles. Find the matching everyday objects, one pair at a time. There’s no hurry.');
  const metrics=el('div','game-metrics');view.memoryMoves=metric('moves');view.memoryTime=metric('time');view.memoryPairs=metric('pairs');metrics.append(view.memoryMoves.node,view.memoryTime.node,view.memoryPairs.node);story.append(metrics);
  view.memoryBest=el('p','game-best','Best round —');story.append(view.memoryBest);
  const controls=el('div','game-story-actions');controls.append(btn('A fresh round','game-button',()=>replaceWithUndo('memory',current=>newMemory(current.best),'Sixteen little tiles. A fresh start.')));story.append(controls);
  story.append(el('p','game-key-hint','Use Tab or arrow keys to move between tiles. Enter turns one over.'));
  const grid=el('div','game-memory-grid');grid.setAttribute('aria-label','Memory cards');view.memoryTiles=[];
  for(let i=0;i<16;i++){const tile=btn('','game-memory-tile',()=>flipMemory(i));tile.onkeydown=e=>gridKeys(e,i,4,view.memoryTiles);view.memoryTiles.push(tile);grid.append(tile);}
  view.memoryMessage=el('p','game-board-message','Find a pair. Then another.');view.memoryMessage.setAttribute('role','status');board.append(grid,view.memoryMessage);return section;
}
function gridKeys(e,i,width,buttons){const offsets={ArrowUp:-width,ArrowDown:width,ArrowLeft:-1,ArrowRight:1};if(!(e.key in offsets))return;e.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,i+offsets[e.key]))].focus();}
function elapsedMemory(m=state.memory){return Math.min(315360000000,m.elapsedMs+(m.startedAt===null?0:Math.max(0,Date.now()-m.startedAt)));}
function clockText(ms){const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
function renderMemoryTime(){if(view.memoryTime&&state)view.memoryTime.value.textContent=clockText(elapsedMemory());}
function flipMemory(index){
  commitGame('memory',m=>{
    if(m.matched.includes(index)||m.revealed.includes(index)||m.revealed.length===2||m.matched.length===16)return false;
    if(m.startedAt===null)m.startedAt=Date.now();m.revealed.push(index);
    if(m.revealed.length===2){m.moves=Math.min(1000000,m.moves+1);const [a,b]=m.revealed;if(m.cards[a]===m.cards[b]){m.matched.push(a,b);m.revealed=[];if(m.matched.length===16){m.elapsedMs=elapsedMemory(m);m.startedAt=null;if(!m.best||m.moves<m.best.moves||(m.moves===m.best.moves&&m.elapsedMs<m.best.elapsedMs))m.best={moves:m.moves,elapsedMs:m.elapsedMs};}}}
  });
}
function scheduleMemoryHide(){
  clearTimeout(hideTimer);
  if(state?.memory.revealed.length!==2)return;
  const expected=JSON.stringify(state.memory);
  hideTimer=setTimeout(()=>commitGame('memory',m=>{m.revealed=[];},expected),1000);
}
function renderMemory(){if(!view.memoryTiles)return;const m=state.memory;view.memoryTiles.forEach((tile,index)=>{const matched=m.matched.includes(index),shown=matched||m.revealed.includes(index);tile.classList.toggle('game-is-revealed',shown);tile.classList.toggle('game-is-matched',matched);tile.setAttribute('aria-label',shown?`${OBJECTS[m.cards[index]]}${matched?', matched':''}, tile ${index+1}`:`Hidden tile ${index+1}`);tile.setAttribute('aria-pressed',String(shown));tile.innerHTML=shown?`<svg viewBox="0 0 44 44" aria-hidden="true">${PICTURES[m.cards[index]]}</svg>`:'<span class="game-memory-back" aria-hidden="true">✳</span>';});view.memoryMoves.value.textContent=String(m.moves);view.memoryPairs.value.textContent=`${m.matched.length/2}/8`;renderMemoryTime();view.memoryBest.textContent=m.best?`Best round · ${m.best.moves} moves · ${clockText(m.best.elapsedMs)}`:'A good round starts with a single tile.';view.memoryMessage.textContent=m.matched.length===16?'All eight pairs, together again. Nicely done.':m.revealed.length===2?'Not this pair. A little look, then try again.':m.matched.length?`${m.matched.length/2} ${m.matched.length===2?'pair found':'pairs found'}. Keep a little picture in your mind.`:'Find a pair. Then another.';}

function buildMerge(){
  const {section,story,board}=stage('Numbers, growing slowly.','NUMBER GARDEN · 2048','Slide the tiles. Matching numbers join into one. Make 2048, or simply see how far a little patience goes.');
  const metrics=el('div','game-metrics');view.mergeScore=metric('score');view.mergeBest=metric('best');metrics.append(view.mergeScore.node,view.mergeBest.node);story.append(metrics);
  const actions=el('div','game-story-actions');const undo=btn('Undo a move','game-button',()=>commitGame('merge',g=>{if(!g.undo)return false;g.board=[...g.undo.board];g.score=g.undo.score;g.undo=null;}));view.mergeUndo=undo;
  actions.append(undo,btn('New garden','game-button game-button-quiet',()=>replaceWithUndo('merge',current=>newMerge(current.best),'A little space for new numbers.')));story.append(actions);
  const pad=el('div','game-direction-pad');pad.setAttribute('role','group');pad.setAttribute('aria-label','Move number tiles');for(const [dir,label]of [['up','↑'],['left','←'],['down','↓'],['right','→']]){const b=btn(label,`game-direction game-direction-${dir}`,()=>playMove(dir));b.setAttribute('aria-label',`Move tiles ${dir}`);pad.append(b);}story.append(pad,el('p','game-key-hint','Focus the board to use arrow keys or W A S D. On a phone, swipe the board or use the arrows.'));
  const grid=el('div','game-merge-grid');grid.tabIndex=0;grid.setAttribute('role','group');grid.setAttribute('aria-label','Number garden board. Arrow keys or W A S D move tiles.');view.mergeTiles=[];for(let i=0;i<16;i++){const tile=el('div','game-number-tile');view.mergeTiles.push(tile);grid.append(tile);}grid.onkeydown=e=>{if(rootNode?.hidden||section.hidden||document.querySelector('dialog[open]'))return;const direction={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',a:'left',s:'down',d:'right'}[e.key]||{W:'up',A:'left',S:'down',D:'right'}[e.key];if(!direction)return;e.preventDefault();playMove(direction);};
  let start=null;grid.onpointerdown=e=>{if(e.button>0)return;start={x:e.clientX,y:e.clientY,id:e.pointerId};grid.setPointerCapture(e.pointerId);};grid.onpointerup=e=>{if(!start||start.id!==e.pointerId)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;if(Math.max(Math.abs(dx),Math.abs(dy))>24)playMove(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');};grid.onpointercancel=()=>start=null;
  view.mergeMessage=el('p','game-board-message','A small beginning. Plenty of possibility.');view.mergeMessage.setAttribute('role','status');board.append(grid,view.mergeMessage);return section;
}
function playMove(direction){let celebrate=false;commitGame('merge',g=>{const result=moveBoard(g.board,direction);if(!result.moved)return false;g.undo={board:[...g.board],score:g.score};g.board=addTile(result.board);g.score=Math.min(MAX_SCORE,g.score+result.score);g.best=Math.max(g.best,g.score);celebrate=!g.celebrated&&g.board.some(v=>v>=2048);if(celebrate)g.celebrated=true;});if(celebrate){view.mergeMessage.textContent='2048. A very lovely milestone. You can keep growing.';toast('You made 2048. A little patience goes a long way.');}}
function renderMerge(){if(!view.mergeTiles)return;const g=state.merge;view.mergeTiles.forEach((tile,i)=>{const n=g.board[i];tile.textContent=n?String(n):'';tile.dataset.level=n?String(Math.min(12,Math.log2(n))):'0';tile.setAttribute('aria-label',`${n||'Empty'}, row ${Math.floor(i/4)+1}, column ${i%4+1}`);});view.mergeScore.value.textContent=String(g.score);view.mergeBest.value.textContent=String(g.best);view.mergeUndo.disabled=!g.undo;view.mergeMessage.textContent=!canMove(g.board)?'A full garden. Undo your last move, or begin again.':g.board.some(v=>v>=2048)?'You made 2048. Keep growing, if you like.':g.score?'One small move can make a little more room.':'A small beginning. Plenty of possibility.';}

function buildLanterns(){
  const {section,story,board}=stage('Let the evening settle.','LANTERNS · A SMALL LOGIC PUZZLE','Tap a lantern to switch it and its neighbours. Turn every light off to give this little street a quiet night.');
  const metrics=el('div','game-metrics');view.lanternMoves=metric('moves');view.lanternLit=metric('lit');view.lanternWins=metric('nights settled');metrics.append(view.lanternMoves.node,view.lanternLit.node,view.lanternWins.node);story.append(metrics);
  const actions=el('div','game-story-actions');actions.append(btn('Start this one over','game-button',()=>replaceWithUndo('lanterns',current=>({...current,cells:[...current.initial],moves:0,solved:!current.initial.some(Boolean)}),'Back to this puzzle’s first lantern.')),btn('Another little street','game-button game-button-quiet',()=>replaceWithUndo('lanterns',current=>newLanterns(current.wins),'A new, solvable little puzzle.')));story.append(actions,el('p','game-key-hint','Each tap changes a small cross: the lantern, plus the one above, below, left, and right. Every new puzzle has a solution.'));
  const grid=el('div','game-lantern-grid');grid.setAttribute('aria-label','Five by five lantern puzzle');view.lanternTiles=[];
  for(let i=0;i<25;i++){const tile=btn('','game-lantern',()=>playLantern(i));tile.innerHTML='<svg viewBox="0 0 30 38" aria-hidden="true"><path d="M15 1v5M8 7h14v3H8zM8 28h14v3H8zM15 31v5"/><path class="game-lantern-paper" d="M8 10c-7 7-7 11 0 18h14c7-7 7-11 0-18Z"/><path d="M15 11v16m-5-16c-3 6-3 10 0 16m10-16c3 6 3 10 0 16"/></svg>';tile.onkeydown=e=>gridKeys(e,i,5,view.lanternTiles);view.lanternTiles.push(tile);grid.append(tile);}view.lanternMessage=el('p','game-board-message','A small cross of light. A small moment to think.');view.lanternMessage.setAttribute('role','status');board.append(grid,view.lanternMessage);return section;
}
function playLantern(index){commitGame('lanterns',l=>{if(l.solved)return false;l.cells=toggleLanterns(l.cells,index);l.moves=Math.min(1000000,l.moves+1);if(!l.cells.some(Boolean)){l.solved=true;l.wins=Math.min(1000000,l.wins+1);}});}
function renderLanterns(){if(!view.lanternTiles)return;const l=state.lanterns;view.lanternTiles.forEach((tile,index)=>{tile.classList.toggle('game-lantern-lit',l.cells[index]);tile.setAttribute('aria-pressed',String(l.cells[index]));tile.setAttribute('aria-label',`Lantern row ${Math.floor(index/5)+1}, column ${index%5+1}: ${l.cells[index]?'lit':'off'}`);tile.setAttribute('aria-disabled',String(l.solved));});view.lanternMoves.value.textContent=String(l.moves);view.lanternLit.value.textContent=String(l.cells.filter(Boolean).length);view.lanternWins.value.textContent=String(l.wins);view.lanternMessage.textContent=l.solved?'All quiet. You gave this little street a good night.':'A small cross of light. A small moment to think.';}
function renderAll(){renderMemory();renderMerge();renderLanterns();}
