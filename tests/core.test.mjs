import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, validateState, planTasks, remainingSeconds, localDayKey, formatMinutes } from '../dist/core.mjs';

function task(overrides = {}) {
  return { id: 'task-1', title: 'A task', minutes: 25, priority: 'normal', bucket: 'today', done: false, createdAt: '2026-11-16T09:00:00.000Z', completedAt: null, ...overrides };
}

test('default state is valid and independent', () => {
  const one = defaultState();
  const two = defaultState();
  one.tasks.push(task());
  one.timer.remainingSeconds = 100;
  assert.equal(two.tasks.length, 0);
  assert.equal(two.timer.remainingSeconds, 1500);
  assert.deepEqual(validateState(two), two);
});

test('plan honors priority, skips oversized work and never changes the source', () => {
  const tasks = [
    task({ id: 'normal', minutes: 25 }),
    task({ id: 'large', priority: 'high', minutes: 90 }),
    task({ id: 'small', priority: 'high', minutes: 15 }),
    task({ id: 'low', priority: 'low', minutes: 10 }),
    task({ id: 'done', priority: 'high', done: true }),
    task({ id: 'later', priority: 'high', bucket: 'later' }),
  ];
  const before = structuredClone(tasks);
  const plan = planTasks(tasks, 50);
  assert.deepEqual(plan.map(t => t.id), ['small', 'normal', 'low']);
  assert.equal(plan.reduce((sum, t) => sum + t.minutes, 0), 50);
  assert.deepEqual(tasks, before);
});

test('equal priorities use creation date and fit exact boundaries', () => {
  const later = task({ id: 'later', createdAt: '2026-11-17T09:00:00Z' });
  const older = task({ id: 'older' });
  assert.deepEqual(planTasks([later, older], 25).map(t => t.id), ['older']);
  for (const budget of [-10, 0, 24, NaN, Infinity]) assert.deepEqual(planTasks([older], budget), []);
});

test('import projects known properties and preserves text as inert data', () => {
  const raw = defaultState();
  raw.tasks = [task({ title: '<img src=x onerror=alert(1)>', extra: 'discard' })];
  raw.notes = '<script>alert(1)</script>';
  raw.extra = 'discard';
  raw.timer.taskId = 'missing-task';
  const clean = validateState(raw);
  assert.equal(clean.tasks[0].title, raw.tasks[0].title);
  assert.equal(clean.notes, raw.notes);
  assert.equal(Object.hasOwn(clean, 'extra'), false);
  assert.equal(Object.hasOwn(clean.tasks[0], 'extra'), false);
  assert.equal(clean.timer.taskId, null);
  assert.notEqual(clean.tasks[0], raw.tasks[0]);
});

test('invalid structures, limits, duplicate IDs and dates are rejected', () => {
  const mutations = [
    s => { s.version = 2; },
    s => { s.tasks = 'tasks'; },
    s => { s.tasks = Array.from({ length: 2001 }, (_, i) => task({ id: String(i) })); },
    s => { s.tasks = [task(), task()]; },
    s => { s.tasks = [task({ priority: 'constructor' })]; },
    s => { s.tasks = [task({ priority: ['high'] })]; },
    s => { s.tasks = [task({ minutes: '25' })]; },
    s => { s.tasks = [task({ minutes: 4 })]; },
    s => { s.tasks = [task({ minutes: 481 })]; },
    s => { s.tasks = [task({ title: ' ' })]; },
    s => { s.tasks = [task({ done: 1 })]; },
    s => { s.tasks = [task({ bucket: 'inbox' })]; },
    s => { s.tasks = [task({ createdAt: '2026-02-30T09:00:00Z' })]; },
    s => { s.tasks = [task({ createdAt: 'yesterday' })]; },
    s => { s.notes = 'x'.repeat(20001); },
    s => { s.capacity = Infinity; },
    s => { s.timer.endAt = '123'; },
    s => { s.timer.remainingSeconds = -1; },
  ];
  for (const mutate of mutations) {
    const state = defaultState();
    mutate(state);
    assert.throws(() => validateState(state));
  }
  assert.throws(() => validateState(null));
  assert.throws(() => validateState(new Date()));
});

test('sessions validate independently of deleted tasks and support shortened duration', () => {
  const raw = defaultState();
  raw.sessions = [{ id: 'session-1', taskId: 'deleted', taskTitle: 'Past task', minutes: 2.5, at: '2026-11-16T17:00:00+08:00' }];
  assert.equal(validateState(raw).sessions[0].at, '2026-11-16T09:00:00.000Z');
  raw.sessions.push({ ...raw.sessions[0] });
  assert.throws(() => validateState(raw), /duplicate session/);
});

test('running timer survives reload, background delay and deadline crossing', () => {
  const now = 1_800_000_000_000;
  const state = defaultState();
  state.timer.endAt = now + 1500_000;
  const reloaded = validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(remainingSeconds(reloaded.timer, now + 90_000), 1410);
  assert.equal(remainingSeconds(reloaded.timer, now + 90_001), 1410);
  assert.equal(remainingSeconds(reloaded.timer, now + 1499_999), 1);
  assert.equal(remainingSeconds(reloaded.timer, now + 1800_000), 0);
  assert.equal(remainingSeconds(reloaded.timer, now - 5000), 1500);
});

test('paused timer ignores wall clock and imports clamp remaining time', () => {
  const state = defaultState();
  state.timer.totalSeconds = 900;
  state.timer.remainingSeconds = 1200;
  const reloaded = validateState(state);
  assert.equal(reloaded.timer.remainingSeconds, 900);
  assert.equal(remainingSeconds({ ...reloaded.timer, remainingSeconds: 123 }, Date.now() + 999_999), 123);
});

test('day keys follow local calendar boundaries', () => {
  const localMidnight = new Date(2026, 10, 16, 0, 0, 0);
  assert.equal(localDayKey(localMidnight), '2026-11-16');
  assert.equal(localDayKey(new Date(localMidnight.getTime() - 1)), '2026-11-15');
  assert.equal(localDayKey(new Date(2026, 0, 2, 23, 59)), '2026-01-02');
  assert.throws(() => localDayKey(new Date(NaN)));
});

test('durations stay compact and handle boundaries', () => {
  assert.equal(formatMinutes(0), '0m');
  assert.equal(formatMinutes(25), '25m');
  assert.equal(formatMinutes(60), '1h');
  assert.equal(formatMinutes(90), '1h 30m');
  assert.equal(formatMinutes(120), '2h');
  assert.equal(formatMinutes(59.6), '1h');
  assert.equal(formatMinutes(-5), '0m');
});
