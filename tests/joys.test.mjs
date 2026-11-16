import test from 'node:test';
import assert from 'node:assert/strict';
import {freshJoys,validateJoys,parseChoices} from '../dist/joys.mjs';

test('fresh snapshots are independent and valid',()=>{
  const a=freshJoys(),b=freshJoys();a.cat.pets=12;
  assert.equal(b.cat.pets,0);assert.deepEqual(validateJoys(b),b);
});
test('backup preserves user strings as data and strips unknown fields',()=>{
  const input=freshJoys();input.options='<img src=x onerror=bad()>\nTea';input.extra='ignored';
  const result=validateJoys(input);assert.equal(result.options,input.options);assert.equal('extra' in result,false);
});
test('decision jar bounds and blank lines',()=>{
  assert.deepEqual(parseChoices(' Tea \n\nWalk\r\n'),['Tea','Walk']);
  assert.throws(()=>parseChoices('Only one'));
  assert.throws(()=>parseChoices(Array(31).fill('one').join('\n')));
  assert.throws(()=>parseChoices(`${'x'.repeat(201)}\nTea`));
});
test('rejects malformed companion and sketch backups',()=>{
  for(const invalid of [null,[],{}, {...freshJoys(),cat:{mood:'evil',pets:0}},{...freshJoys(),cat:{mood:'content',pets:-1}}])assert.throws(()=>validateJoys(invalid));
  const state=freshJoys();state.strokes=[{color:'#46443e',erase:false,width:.005,points:[{x:.1,y:.9}]}];
  assert.deepEqual(validateJoys(state),state);
  state.strokes[0].points[0].x=Infinity;assert.throws(()=>validateJoys(state));
  state.strokes[0].points[0].x=.3;state.strokes[0].color='url(evil)';assert.throws(()=>validateJoys(state));
});
test('rejects excess stroke and point counts',()=>{
  const stroke={color:'#46443e',erase:false,width:.005,points:[{x:.1,y:.9}]};
  assert.throws(()=>validateJoys({...freshJoys(),strokes:Array(201).fill(stroke)}));
  assert.throws(()=>validateJoys({...freshJoys(),strokes:[{...stroke,points:Array(2001).fill({x:0,y:0})}]}));
});
