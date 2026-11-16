import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Separate VM contexts model independent browser tabs sharing localStorage.
// Test-only exports exercise the production handlers without changing their API.
function tab(module, storage = new Map()) {
  const timers = [];
  const document = { createElement(tag) {
    return { tag, children: [], listeners: {}, value: '', disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      append(...nodes) { this.children.push(...nodes); },
      setAttribute() {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      focus() {},
    };
  } };
  const context = vm.createContext({ document,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout(callback) { const timer = { callback, canceled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.canceled = true; },
  });
  const source = readFileSync(new URL(`../dist/${module}.mjs`, import.meta.url), 'utf8').replace(/^export /gm, '');
  const access = module === 'joys'
    ? '{getJoys,restoreJoys,freshJoys,interactCat,buildJar,pickChoice,parse:JSON.parse,setStroke:stroke=>currentStroke=stroke,peek:()=>({stroke:currentStroke,options:view.options,picking:isPicking})}'
    : '{getRituals,restoreRituals,persist,parse:JSON.parse,rollover:()=>{currentDay();return persist();}}';
  vm.runInContext(`${source}\nthis.api=${access};`, context, { filename: `${module}.mjs` });
  return { api: context.api, runTimers() { for (const timer of timers.splice(0)) if (!timer.canceled) timer.callback(); } };
}
const stroke = { color: '#46443e', erase: false, width: 0.005, points: [{ x: 0.2, y: 0.3 }] };

test('a stale second tab can pet Momo without erasing a newer drawing or jar', () => {
  const storage = new Map();
  const first = tab('joys', storage), second = tab('joys', storage);
  second.api.getJoys();
  const newer = first.api.freshJoys();
  newer.strokes = first.api.parse(JSON.stringify([stroke]));
  newer.options = 'New tea\nNew walk';
  first.api.restoreJoys(newer);
  second.api.interactCat('happy');
  const saved = JSON.parse(storage.get('daylight.joys.v1'));
  assert.deepEqual(saved.strokes, [stroke]);
  assert.equal(saved.options, 'New tea\nNew walk');
  assert.equal(saved.cat.pets, 1);
});

test('an incoming update preserves the line currently being drawn', () => {
  const storage = new Map();
  const first = tab('joys', storage), second = tab('joys', storage);
  const drawing = first.api.parse(JSON.stringify(stroke));
  first.api.setStroke(drawing);
  second.api.interactCat('sleepy');
  first.api.getJoys();
  assert.equal(first.api.peek().stroke, drawing);
  assert.equal(first.api.getJoys().cat.mood, 'sleepy');
});

test('a stale cat reset cannot wake a cat put to sleep in another tab', () => {
  const storage = new Map();
  const first = tab('joys', storage), second = tab('joys', storage);
  first.api.interactCat('happy');
  second.api.interactCat('sleepy');
  first.runTimers();
  assert.equal(JSON.parse(storage.get('daylight.joys.v1')).cat.mood, 'sleepy');
});

test('editing jar choices cancels the captured pending pick', () => {
  const current = tab('joys');
  current.api.buildJar();
  const input = current.api.peek().options;
  input.value = 'Old tea\nOld walk';
  current.api.pickChoice();
  assert.equal(current.api.peek().picking, true);
  input.value = 'New tea\nNew walk';
  input.listeners.input();
  current.runTimers();
  assert.equal(current.api.peek().picking, false);
  assert.equal(current.api.getJoys().options, 'New tea\nNew walk');
  assert.equal(current.api.getJoys().lastPick, '');
});

test('corrupt ritual storage survives rollover until explicit restore', () => {
  const raw = '{broken ritual history';
  const storage = new Map([['daylight.rituals.v1', raw]]);
  const current = tab('rituals', storage);
  const fresh = current.api.getRituals();
  assert.equal(current.api.rollover(), false);
  assert.equal(storage.get('daylight.rituals.v1'), raw);
  current.api.restoreRituals(fresh);
  assert.equal(JSON.parse(storage.get('daylight.rituals.v1')).version, 1);
  assert.equal(current.api.persist(), true);
});
