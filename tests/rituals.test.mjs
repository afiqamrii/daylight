import test from 'node:test';
import assert from 'node:assert/strict';
import {getRituals,validateRituals} from '../dist/rituals.mjs';

test('ritual snapshots are safe to import without a browser and independent',()=>{
  const first=getRituals();assert.equal(first.habits.length,3);first.habits[0].title='Changed';
  assert.equal(getRituals().habits[0].title,'Read a few pages');
  assert.deepEqual(validateRituals(getRituals()),getRituals());
});
test('daily history and note text survive a round trip',()=>{
  const data=getRituals();data.days['2026-11-16']={habits:['read'],cups:4,mood:5,note:'Tea & <a little quiet>'};
  assert.deepEqual(validateRituals(JSON.parse(JSON.stringify(data))),data);
});
test('ritual import rejects unsafe size, numbers, dates and duplicate identifiers',()=>{
  for(const change of [d=>d.cupGoal=0,d=>d.cupGoal=21,d=>d.habits.push({...d.habits[0]}),d=>d.habits[0].title='x'.repeat(101),d=>d.days['2026-02-30']={habits:[],cups:1,mood:1,note:''},d=>d.days['2026-11-16']={habits:[],cups:-1,mood:7,note:''}]){
    const data=getRituals();change(data);assert.throws(()=>validateRituals(data));
  }
});
