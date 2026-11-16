const STORAGE_KEY = 'daylight.daily.v1';

// Original little notes, written for Daylight. IDs are their stable array positions.
export const DAILY_NOTES = Object.freeze([
  'You can begin again at any point in the day.',
  'A little done with care is still a little done.',
  'Leave some space in your day for being a person.',
  'You do not have to earn a quiet moment.',
  'The next small step is enough to begin with.',
  'An ordinary day can hold something lovely.',
  'Try a softer pace. You are still moving.',
  'Not everything needs your attention at once.',
  'Make a cup of something warm. Let the day meet you there.',
  'You are allowed to be a work in progress.',
  'A pause is part of the rhythm, too.',
  'Choose one thing to care for, then give it a little time.',
  'Some days are for growing. Some are for keeping the roots watered.',
  'You can set down what does not belong to this moment.',
  'A small kindness to yourself can change the shape of a day.',
  'There is room for a fresh page, even after a messy morning.',
  'You do not need a perfect plan to take a useful step.',
  'Let today be lived, not only measured.',
  'Take the gentle route when you can.',
  'One cleared corner can make a little room in your mind.',
  'Your pace does not have to look like anyone else’s.',
  'Notice one good thing before you look for the next thing to fix.',
  'Rest can be a thoughtful choice.',
  'Bring your attention back kindly. As often as you need.',
  'Small efforts have a way of finding each other over time.',
  'It is okay to make this simpler.',
  'A breath, a sip, a stretch. Small things can bring you back.',
  'Some progress is quiet enough that only you can see it.',
  'Give the important things a little room, not all the room.',
  'You are here. That is a place to start.',
  'You can care about something without carrying it every minute.',
  'Make a little space for something that has no purpose except joy.',
  'The day is not a test you have to pass.',
  'Let one small promise to yourself be enough for now.',
  'A task can wait while you look out of the window.',
  'What is one thing you could make easier for yourself today?',
  'You can be proud of the things that took you effort.',
  'A slower moment can help you notice where you want to go.',
  'There is no need to fill every empty space.',
  'It is okay to choose a smaller version of the plan.',
  'Return to what matters, with a little less hurry.',
  'Leave tomorrow a kind note, not a heavier list.',
  'A little laughter belongs in the plan, too.',
  'You can make room for both effort and ease.',
  'Tend to this hour. The whole week can wait a moment.',
  'A gentle beginning is still a beginning.',
  'Some things become clearer after a short walk.',
  'You are allowed to finish the day with things unfinished.',
]);

let state = null;
let mount = null;
let notify = () => {};
let siteUrl = '';
let cleanup = null;
let activeDialog = null;
let returnFocus = null;
let storageBlocked = false;

export function dayKey(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Choose a valid day.');
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function validTime(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function plain(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value))); }
function noteId(value) { return Number.isInteger(value) && value >= 0 && value < DAILY_NOTES.length; }

/** A date selects the same original note on every device, without a network request. */
export function noteIndexForDay(key) {
  if (!validDay(key)) throw new Error('Choose a valid day.');
  const count = Math.floor(Date.parse(`${key}T12:00:00Z`) / 86400000);
  return ((count % DAILY_NOTES.length) + DAILY_NOTES.length) % DAILY_NOTES.length;
}
export function freshDaily(date = new Date()) {
  const day = dayKey(date);
  return {version:1,day,current:noteIndexForDay(day),favorites:[],reminder:{enabled:false,time:'09:00',lastShownDay:null}};
}
export function validateDaily(input) {
  if (!plain(input) || input.version !== 1 || !validDay(input.day) || !noteId(input.current)) throw new Error('Invalid daily note backup.');
  if (!Array.isArray(input.favorites) || input.favorites.length > DAILY_NOTES.length || input.favorites.some(value=>!noteId(value)) || new Set(input.favorites).size !== input.favorites.length) throw new Error('Invalid saved notes.');
  const reminder = input.reminder;
  if (!plain(reminder) || typeof reminder.enabled !== 'boolean' || !validTime(reminder.time) || !(reminder.lastShownDay === null || validDay(reminder.lastShownDay))) throw new Error('Invalid daily reminder.');
  return {version:1,day:input.day,current:input.current,favorites:[...input.favorites],reminder:{enabled:reminder.enabled,time:reminder.time,lastShownDay:reminder.lastShownDay}};
}
function load() {
  if (state) return;
  state = freshDaily();
  try { if (typeof localStorage !== 'undefined') { const raw=localStorage.getItem(STORAGE_KEY); if(raw)state=validateDaily(JSON.parse(raw)); } }
  catch {storageBlocked=true;notify('The saved daily notes could not be read. They have not been overwritten. Restore a backup to recover them.');}
}
function persist() {
  if(storageBlocked)return false;
  try{const snapshot=validateDaily(state);if(typeof localStorage!=='undefined')localStorage.setItem(STORAGE_KEY,JSON.stringify(snapshot));return true;}
  catch{notify('This browser could not save your notes. A planner backup will keep a copy.');return false;}
}
function ensureDay(date = new Date()) {
  const today=dayKey(date);
  if(state.day===today)return false;
  state.day=today;state.current=noteIndexForDay(today);persist();return true;
}
export function getDaily() {load();ensureDay();return validateDaily(state);}
export function restoreDaily(input) {const next=validateDaily(input);state=next;storageBlocked=false;ensureDay();persist();if(mount)render();}

/** Pure reminder decision: one local-calendar nudge, at or after the chosen time. */
export function reminderIsDue(reminder,date=new Date()) {
  if(!reminder?.enabled || !validTime(reminder.time))return false;
  const today=dayKey(date),minute=date.getHours()*60+date.getMinutes();
  const [hour,minutes]=reminder.time.split(':').map(Number);
  return reminder.lastShownDay!==today && minute >= hour*60+minutes;
}

export function escapeIcsText(text) {return String(text).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
function foldIcsLine(line) {
  const encoder=new TextEncoder();let out='',part='',size=0;
  for(const char of line){const length=encoder.encode(char).length;if(size+length>75){out+=part+'\r\n';part=' ';size=1;}part+=char;size+=length;}
  return out+part;
}
/** A floating local-time recurring event keeps the selected clock time in a calendar. */
export function makeReminderCalendar({time='09:00',url='',now=new Date()}={}) {
  if(!validTime(time)||!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('Choose a valid reminder time.');
  const [hours,minutes]=time.split(':').map(Number),start=new Date(now);
  start.setHours(hours,minutes,0,0);if(start<=now)start.setDate(start.getDate()+1);
  const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const localStart=`${dayKey(start).replaceAll('-','')}T${String(hours).padStart(2,'0')}${String(minutes).padStart(2,'0')}00`;
  const description=`A little space, a lighter day. Pause, take a breath, and choose one small thing.${url?`\nOpen Daylight: ${url}`:''}`;
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Daylight//A gentle nudge//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:daylight-nudge-${now.getTime()}@daylight.local`,`DTSTAMP:${stamp}`,`DTSTART:${localStart}`,'DURATION:PT5M','RRULE:FREQ=DAILY',`SUMMARY:${escapeIcsText('A gentle moment with Daylight')}`,`DESCRIPTION:${escapeIcsText(description)}`,'BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY',`DESCRIPTION:${escapeIcsText('A gentle reminder: make a little space for yourself.')}`,'END:VALARM','END:VEVENT','END:VCALENDAR'];
  return lines.map(foldIcsLine).join('\r\n')+'\r\n';
}

function el(tag,cls,text) {const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
function button(text,cls,action,label) {const b=el('button',cls,text);b.type='button';if(action)b.onclick=action;if(label)b.setAttribute('aria-label',label);return b;}
const heartSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20C-4 10 5 1 12 8 19 1 28 10 12 20Z"/></svg>';
const envelopeSvg='<svg viewBox="0 0 74 62" aria-hidden="true"><path class="daily-envelope-shadow" d="M7 56h61"/><g class="daily-letter"><path d="M20 9h35v37H20Z"/><circle class="daily-letter-sun" cx="38" cy="23" r="6"/><path class="daily-letter-rule" d="M29 35h17M32 39h11"/></g><path class="daily-envelope-back" d="m11 26 26-18 26 18v27H11Z"/><path class="daily-envelope-paper" d="m11 26 26 18 26-18v27H11Z"/><path class="daily-envelope-seam" d="m11 53 20-15m32 15L43 38"/><circle class="daily-envelope-seal" cx="37" cy="44" r="3"/></svg>';

function render() {
  if(!mount)return;
  const strip=el('section','daily-strip');strip.setAttribute('aria-label','Your daily encouragement');
  const art=el('div','daily-envelope');art.innerHTML=envelopeSvg;
  const copy=el('div','daily-copy');const eyebrow=el('div','daily-eyebrow','A SMALL NOTE FOR TODAY');
  const quote=el('p','daily-thought',DAILY_NOTES[state.current]);quote.id='daily-thought';quote.setAttribute('aria-live','polite');
  copy.append(eyebrow,quote);
  const actions=el('div','daily-actions');
  const isFavorite=state.favorites.includes(state.current),favoriteLabel=isFavorite?'Unsave this thought':'Save this thought';
  const favourite=button('','daily-icon-button daily-favorite',toggleFavorite,favoriteLabel);favourite.innerHTML=heartSvg;favourite.title=favoriteLabel;
  favourite.setAttribute('aria-pressed',String(isFavorite));
  const next=button('↻','daily-icon-button',nextNote,'Another comforting thought');next.title='Another thought';
  const saved=button('Saved','daily-text-button',openSaved);saved.setAttribute('aria-label',`Saved thoughts, ${state.favorites.length}`);
  const nudge=button('A gentle nudge ↗','daily-nudge-button',openReminder);nudge.title='Daily reminder settings';
  actions.append(favourite,next,saved,nudge);strip.append(art,copy,actions);mount.replaceChildren(strip);
}
function nextNote() {
  ensureDay();state.current=(state.current+1)%DAILY_NOTES.length;persist();
  const thought=mount.querySelector('.daily-thought');thought.textContent=DAILY_NOTES[state.current];
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches)thought.animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:350,easing:'ease-out'});
  syncFavorite();mount.querySelector('.daily-envelope').classList.remove('daily-letter-arrived');requestAnimationFrame(()=>mount.querySelector('.daily-envelope')?.classList.add('daily-letter-arrived'));
}
function syncFavorite() {
  const saved=state.favorites.includes(state.current),b=mount.querySelector('.daily-favorite');b.setAttribute('aria-pressed',String(saved));b.setAttribute('aria-label',saved?'Unsave this thought':'Save this thought');b.title=saved?'Unsave this thought':'Save this thought';
  mount.querySelector('.daily-text-button').setAttribute('aria-label',`Saved thoughts, ${state.favorites.length}`);
}
function toggleFavorite() {
  const index=state.favorites.indexOf(state.current);
  if(index<0)state.favorites.push(state.current);else state.favorites.splice(index,1);
  persist();syncFavorite();notify(index<0?'A small thought, kept for later.':'Thought removed from your saved collection.');
}
function closeDialog() {activeDialog?.close();}
function makeDialog(title) {
  activeDialog?.close();
  const dialog=el('dialog','daily-dialog');activeDialog=dialog;
  const head=el('div','daily-dialog-head'),heading=el('h2','',title);heading.id='daily-dialog-title';dialog.setAttribute('aria-labelledby',heading.id);
  const close=button('×','daily-dialog-close',closeDialog,'Close');head.append(heading,close);dialog.append(head);
  dialog.addEventListener('close',()=>{dialog.remove();if(activeDialog===dialog)activeDialog=null;returnFocus?.isConnected&&returnFocus.focus({preventScroll:true});});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  return dialog;
}
function showDialog(dialog) {returnFocus=document.activeElement;document.body.append(dialog);dialog.showModal();}
function openSaved() {
  const dialog=makeDialog('Thoughts to come back to.');dialog.append(el('p','daily-dialog-intro','Little words you wanted to keep.'));
  const list=el('div','daily-saved-list');
  if(!state.favorites.length)list.append(el('p','daily-empty','Tap the heart beside a thought to keep it here.'));
  for(const id of [...state.favorites].reverse()) {
    const row=el('div','daily-saved-row'),quote=el('p','',DAILY_NOTES[id]);
    const remove=button('×','daily-remove-note',()=>{state.favorites=state.favorites.filter(value=>value!==id);persist();row.remove();syncFavorite();if(!state.favorites.length)list.append(el('p','daily-empty','A little room for new thoughts.'));},`Remove saved thought: ${DAILY_NOTES[id]}`);
    row.append(quote,remove);list.append(row);
  }
  dialog.append(list);showDialog(dialog);
}
function openReminder() {
  const dialog=makeDialog('A gentle nudge.');dialog.append(el('p','daily-dialog-intro','A small invitation to pause, check in, and come back to yourself.'));
  const form=el('form','daily-reminder-form');
  const timeLabel=el('label','daily-time-label','A good time for you');const time=el('input','daily-time-input');time.type='time';time.value=state.reminder.time;time.required=true;timeLabel.append(time);
  const toggleLabel=el('label','daily-toggle-label');const toggle=el('input');toggle.type='checkbox';toggle.checked=state.reminder.enabled;const toggleCopy=el('span');toggleCopy.append(el('strong','','Show a daily nudge'),el('small','','While Daylight is open. One quiet message each day.'));toggleLabel.append(toggle,toggleCopy);
  const save=el('button','daily-primary-button','Save my nudge');save.type='submit';
  form.append(timeLabel,toggleLabel,save);
  form.onsubmit=event=>{event.preventDefault();if(!validTime(time.value))return;const now=new Date(),wasEnabled=state.reminder.enabled;state.reminder.enabled=toggle.checked;state.reminder.time=time.value;
    if(toggle.checked&&!wasEnabled&&reminderIsDue(state.reminder,now))state.reminder.lastShownDay=dayKey(now);
    persist();closeDialog();notify(toggle.checked?'Your daily nudge is on while Daylight stays open.':'Your daily nudge is off. The daily note is always here.');};
  const calendar=el('div','daily-calendar-section');calendar.append(el('h3','','For a reminder when Daylight is closed'),el('p','','Download a daily calendar reminder, then import it into your calendar. It uses the time you choose above.'));
  const download=button('Add to calendar ↗','daily-calendar-button',()=>{
    if(!validTime(time.value)){time.reportValidity();return;}
    const text=makeReminderCalendar({time:time.value,url:siteUrl}),blob=new Blob([text],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download='daylight-daily-reminder.ics';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Import this calendar file to turn on your daily reminder.');
  });calendar.append(download,el('p','daily-calendar-note','Calendar reminders are managed by your calendar app after import.'));
  dialog.append(form,calendar);showDialog(dialog);
}
function tick() {
  if(!state)return;
  const now=new Date();if(ensureDay(now))render();
  if(reminderIsDue(state.reminder,now)) {state.reminder.lastShownDay=dayKey(now);persist();notify(`A gentle nudge: ${DAILY_NOTES[noteIndexForDay(dayKey(now))]}`);}
}

/** Mount a compact daily-note strip. No permissions or external scheduler are used. */
export function initDaily(root,{toast=()=>{},siteUrl:providedUrl=''}={}) {
  cleanup?.();mount=root;notify=toast;siteUrl=providedUrl;load();ensureDay();render();syncFavorite();
  const onStorage=event=>{if(event.key!==STORAGE_KEY||!event.newValue)return;try{const snapshot=validateDaily(JSON.parse(event.newValue));state=snapshot;storageBlocked=false;ensureDay();render();syncFavorite();}catch{notify('A daily-note update from another tab could not be read.');}};
  const visible=()=>{if(!document.hidden)tick();};
  const timer=setInterval(tick,15000);document.addEventListener('visibilitychange',visible);window.addEventListener('focus',tick);window.addEventListener('storage',onStorage);
  tick();
  cleanup=()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',tick);window.removeEventListener('storage',onStorage);activeDialog?.close();cleanup=null;};
  return cleanup;
}
