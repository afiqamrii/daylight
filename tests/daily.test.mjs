import test from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_NOTES,dayKey,noteIndexForDay,freshDaily,validateDaily,reminderIsDue,escapeIcsText,makeReminderCalendar} from '../dist/daily.mjs';

test('daily notes are original local data with stable, calendar-based selection',()=>{
  assert.ok(DAILY_NOTES.length>=40);assert.equal(new Set(DAILY_NOTES).size,DAILY_NOTES.length);
  assert.equal(noteIndexForDay('2026-11-16'),noteIndexForDay('2026-11-16'));
  assert.equal(noteIndexForDay('2026-11-17'),(noteIndexForDay('2026-11-16')+1)%DAILY_NOTES.length);
  assert.throws(()=>noteIndexForDay('2026-02-30'));assert.throws(()=>noteIndexForDay('bad'));
  const date=new Date(2026,10,16,23,59);assert.equal(dayKey(date),'2026-11-16');
});
test('backup snapshots project known fields and reject malformed note and reminder data',()=>{
  const state=freshDaily(new Date(2026,10,16));state.favorites=[0,1];state.extra='discard';
  const clean=validateDaily(state);assert.equal(clean.extra,undefined);assert.deepEqual(clean.favorites,[0,1]);
  for(const mutate of [s=>s.current=-1,s=>s.favorites=[1,1],s=>s.favorites=[999],s=>s.reminder.time='25:00',s=>s.reminder.enabled='yes',s=>s.reminder.lastShownDay='2026-02-30']){const value=freshDaily();mutate(value);assert.throws(()=>validateDaily(value));}
  clean.favorites.push(2);assert.deepEqual(state.favorites,[0,1]);
});
test('nudges are disabled by default and occur once per local day at or after chosen time',()=>{
  const reminder=freshDaily().reminder,day=new Date(2026,10,16,9,0);
  assert.equal(reminderIsDue(reminder,day),false);reminder.enabled=true;
  assert.equal(reminderIsDue(reminder,new Date(2026,10,16,8,59)),false);
  assert.equal(reminderIsDue(reminder,day),true);
  reminder.lastShownDay='2026-11-16';assert.equal(reminderIsDue(reminder,new Date(2026,10,16,23,59)),false);
  assert.equal(reminderIsDue(reminder,new Date(2026,10,17,9,0)),true);
});
test('calendar reminders preserve local clock time and start on the next occurrence',()=>{
  const before=makeReminderCalendar({time:'09:30',url:'https://example.com/daylight',now:new Date(2026,10,16,8,0)});
  assert.match(before,/DTSTART:20261116T093000\r\n/);assert.match(before,/RRULE:FREQ=DAILY/);assert.match(before,/TRIGGER:PT0M/);
  const after=makeReminderCalendar({time:'09:30',now:new Date(2026,10,16,10,0)});
  assert.match(after,/DTSTART:20261117T093000\r\n/);assert.doesNotMatch(after,/DTSTART:.*Z/);
  const yearEnd=makeReminderCalendar({time:'09:00',now:new Date(2026,11,31,23,0)});
  assert.match(yearEnd,/DTSTART:20270101T090000/);
});
test('calendar text escaping and byte folding prevent content from adding ICS properties',()=>{
  assert.equal(escapeIcsText('a,b;c\\d\ne'),'a\\,b\\;c\\\\d\\ne');
  const ics=makeReminderCalendar({url:'https://example.com/'+ '日'.repeat(50)+'\r\nBEGIN:BAD',now:new Date(2026,10,16)});
  assert.doesNotMatch(ics,/\r\nBEGIN:BAD/);
  for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
  assert.equal(ics.endsWith('END:VCALENDAR\r\n'),true);
});

test('a valid cross-tab restoration unlocks saving after corrupt storage',async()=>{
  const {initDaily,getDaily:exportState}=await import(`../dist/daily.mjs?recovery=${Date.now()}`);
  const original={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage};
  const listeners=new Map(),writes=[];
  class Node {
    constructor(){this.children=[];this.className='';this.attributes={};}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(name,value){this.attributes[name]=value;}
    querySelector(selector){const cls=selector.slice(1);for(const child of this.children){if(child.className?.split(' ').includes(cls))return child;const found=child.querySelector?.(selector);if(found)return found;}return null;}
  }
  let cleanup;
  try {
    globalThis.document={createElement:()=>new Node(),addEventListener(){},removeEventListener(){},hidden:false};
    globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    globalThis.localStorage={getItem:()=>'{broken JSON',setItem:(key,value)=>writes.push({key,value})};
    const root=new Node();cleanup=initDaily(root);
    root.querySelector('.daily-favorite').onclick();
    assert.equal(writes.length,0,'corrupt storage stays protected');
    listeners.get('storage')({key:'daylight.daily.v1',newValue:'{"version":999}'});
    root.querySelector('.daily-favorite').onclick();
    assert.equal(writes.length,0,'an invalid external update must not unlock storage');
    const restored=freshDaily();restored.favorites=[0];
    listeners.get('storage')({key:'daylight.daily.v1',newValue:JSON.stringify(restored)});
    root.querySelector('.daily-favorite').onclick();
    assert.equal(writes.length,1,'a validated external update restores saving');
    assert.deepEqual(validateDaily(JSON.parse(writes[0].value)),exportState());
  } finally {
    cleanup?.();
    for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
});
