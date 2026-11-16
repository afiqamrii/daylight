import test from 'node:test';
import assert from 'node:assert/strict';
import {moveBoard,canMove,toggleLanterns,scrambleLanterns,freshGames,validateGames,mergeGameChange} from '../dist/games.mjs';
const board=(row)=>[...row,...Array(12).fill(0)];

test('number tiles merge once per move and count score',()=>{
  assert.deepEqual(moveBoard(board([2,2,2,2]),'left'),{board:board([4,4,0,0]),score:8,moved:true});
  assert.deepEqual(moveBoard(board([2,2,4,0]),'left').board,board([4,4,0,0]));
  assert.deepEqual(moveBoard(board([4,4,8,8]),'right').board,board([0,0,8,16]));
});
test('vertical moves preserve lanes and input is immutable',()=>{
  const input=[2,0,4,0,2,0,4,0,4,0,0,0,4,0,0,0],before=[...input];
  assert.deepEqual(moveBoard(input,'up').board,[4,0,8,0,8,0,0,0,0,0,0,0,0,0,0,0]);
  assert.deepEqual(moveBoard(input,'down').board,[0,0,0,0,0,0,0,0,4,0,0,0,8,0,8,0]);
  assert.deepEqual(input,before);
});
test('blocked moves do not spawn tiles or change score',()=>{
  const input=[2,4,2,4,4,2,4,2,2,4,2,4,4,2,4,2];
  for(const direction of ['up','down','left','right'])assert.deepEqual(moveBoard(input,direction),{board:input,score:0,moved:false});
  assert.equal(canMove(input),false);assert.equal(canMove(board([2,4,2,4])),true);
});
test('lantern toggles a cross without wrapping edge rows',()=>{
  const original=Array(25).fill(false),corner=toggleLanterns(original,0);
  assert.deepEqual(corner.map((v,i)=>v?i:null).filter(v=>v!==null),[0,1,5]);
  assert.deepEqual(toggleLanterns(corner,0),original);
  assert.equal(original.some(Boolean),false);
  assert.equal(toggleLanterns(original,12).filter(Boolean).length,5);
});
test('generated lantern scramble can always be solved by reversing its valid moves',()=>{
  const moves=[1,6,3,14,12,24,20,5,18];let cells=scrambleLanterns(moves);
  for(const move of [...moves].reverse())cells=toggleLanterns(cells,move);
  assert.equal(cells.some(Boolean),false);
});
test('fresh games validate and use independent arrays',()=>{
  const a=freshGames(),b=freshGames();assert.deepEqual(validateGames(a),a);
  a.merge.board[0]=128;assert.notDeepEqual(a.merge.board,b.merge.board);
  assert.equal(a.memory.cards.length,16);assert.equal(a.lanterns.initial.some(Boolean),true);
});
test('backup validation rejects malformed tiles, pairs and lantern states',()=>{
  for(const mutate of [g=>g.merge.board[0]=3,g=>g.memory.cards[0]=8,g=>g.memory.matched=[0],g=>g.lanterns.cells[0]='yes',g=>g.lanterns.solved=true]){
    const state=freshGames();mutate(state);assert.throws(()=>validateGames(state));
  }
  assert.throws(()=>moveBoard(Array(16).fill(0),'diagonal'));
});

test('a stale memory hide merges into the latest snapshot without erasing another game',()=>{
  const original=freshGames();
  original.memory.cards=[0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7];
  original.memory.revealed=[0,1];original.memory.moves=1;original.memory.startedAt=1000;
  const expected=JSON.stringify(original.memory);
  const latest=validateGames(original);
  latest.merge.board=[128,64,32,16,...Array(12).fill(0)];latest.merge.score=100;latest.merge.best=100;
  latest.lanterns.cells=toggleLanterns(latest.lanterns.cells,12);latest.lanterns.moves=1;latest.lanterns.solved=!latest.lanterns.cells.some(Boolean);
  const result=mergeGameChange(latest,'memory',memory=>{memory.revealed=[];},expected);
  assert.equal(result.applied,true);
  assert.deepEqual(result.snapshot.memory.revealed,[]);
  assert.deepEqual(result.snapshot.merge,latest.merge);
  assert.deepEqual(result.snapshot.lanterns,latest.lanterns);
  assert.deepEqual(latest.memory.revealed,[0,1],'read/merge does not mutate the incoming snapshot');
});

test('old asynchronous memory actions are rejected after memory changes elsewhere',()=>{
  const original=freshGames();original.memory.revealed=[0,1];
  const expected=JSON.stringify(original.memory),latest=validateGames(original);
  latest.memory.revealed=[2];latest.memory.moves=1;
  let callbackRan=false;
  const result=mergeGameChange(latest,'memory',memory=>{callbackRan=true;memory.revealed=[];},expected);
  assert.equal(result.applied,false);assert.equal(result.conflict,true);assert.equal(callbackRan,false);
  assert.deepEqual(result.snapshot.memory.revealed,[2]);
});

test('number-game actions operate on the latest board and preserve other games',()=>{
  const latest=freshGames();latest.merge.board=board([8,8,4,0]);latest.merge.score=40;latest.merge.best=40;
  const result=mergeGameChange(latest,'merge',game=>{const next=moveBoard(game.board,'left');game.undo={board:[...game.board],score:game.score};game.board=next.board;game.score+=next.score;});
  assert.deepEqual(result.snapshot.merge.board,board([16,4,0,0]));
  assert.equal(result.snapshot.merge.score,56);assert.equal(result.snapshot.merge.best,56);
  assert.deepEqual(result.snapshot.memory,latest.memory);assert.deepEqual(result.snapshot.lanterns,latest.lanterns);
});

test('current, best, and previous number scores reject invalid bounds',()=>{
  for(const bad of [-1,1.5,Infinity,1000000000001]){
    for(const field of ['score','best','previous']){
      const snapshot=freshGames();
      if(field==='previous')snapshot.merge.undo={board:[...snapshot.merge.board],score:bad};
      else snapshot.merge[field]=bad;
      assert.throws(()=>validateGames(snapshot));
    }
  }
});
