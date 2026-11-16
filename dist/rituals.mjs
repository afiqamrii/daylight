const STORAGE_KEY = 'daylight.rituals.v1';
const MOODS = ['A little low', 'Quiet', 'Somewhere in between', 'Good', 'Lovely'];
const MOOD_SHORT = ['Low', 'Quiet', 'Okay', 'Good', 'Lovely'];
let state = null;
let mount = null;
let notify = () => {};
let cleanup = null;
let breathingStart = null;
let breathingFrame = null;
let renderedDay = null;
let saveProblemShown = false;
let storageBlocked = false;

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function freshState() {
  return { version: 1, habits: [
    { id: 'read', title: 'Read a few pages' },
    { id: 'stretch', title: 'Stretch a little' },
    { id: 'tidy', title: 'Tidy one small corner' },
  ], cupGoal: 8, days: {} };
}
function blankDay() { return { habits: [], cups: 0, mood: null, note: '' }; }
function plain(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${path} must be an object.`);
}
function string(value, max, path, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(`${path} is invalid.`);
  return value;
}
function integer(value, min, max, path) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${path} is invalid.`);
  return value;
}
function validDayKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const value = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === key;
}

/** Check a ritual backup without touching browser state. */
export function validateRituals(input) {
  plain(input, 'Rituals');
  if (input.version !== 1) throw new Error('This ritual backup version is not supported.');
  if (!Array.isArray(input.habits) || input.habits.length > 20) throw new Error('Choose up to 20 rituals.');
  const ids = new Set();
  const habits = input.habits.map(habit => {
    plain(habit, 'Habit');
    const id = string(habit.id, 100, 'Habit ID');
    if (ids.has(id)) throw new Error('Habit IDs must be unique.');
    ids.add(id);
    return { id, title: string(habit.title, 100, 'Habit title') };
  });
  const cupGoal = integer(input.cupGoal, 1, 20, 'Cup goal');
  plain(input.days, 'Ritual history');
  const entries = Object.entries(input.days);
  if (entries.length > 365) throw new Error('Ritual history can contain up to 365 days.');
  const days = {};
  for (const [key, day] of entries) {
    if (!validDayKey(key)) throw new Error('A ritual history date is invalid.');
    plain(day, 'Day');
    if (!Array.isArray(day.habits) || day.habits.length > 200) throw new Error('Daily habit history is invalid.');
    const completed = day.habits.map(id => string(id, 100, 'Completed habit ID'));
    if (new Set(completed).size !== completed.length) throw new Error('A completed habit is repeated.');
    days[key] = {
      habits: completed,
      cups: integer(day.cups, 0, 99, 'Daily cups'),
      mood: day.mood === null ? null : integer(day.mood, 1, 5, 'Mood'),
      note: string(day.note, 500, 'Mood note', true),
    };
  }
  return { version: 1, habits, cupGoal, days };
}

function trimHistory() {
  const keys = Object.keys(state.days).sort();
  while (keys.length > 365) delete state.days[keys.shift()];
}
function currentDay() {
  const key = todayKey();
  if (!state.days[key]) state.days[key] = blankDay();
  trimHistory();
  return state.days[key];
}
function persist() {
  if (storageBlocked) { saveProblemShown = true; return false; }
  trimHistory();
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveProblemShown = false;
    return true;
  } catch {
    if (!saveProblemShown) notify('Your rituals are open, but this browser could not save them. Make a backup to keep your changes.');
    saveProblemShown = true;
    return false;
  }
}
function load() {
  if (state) return;
  state = freshState();
  try {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = validateRituals(JSON.parse(saved));
  } catch {
    storageBlocked = true;
    saveProblemShown = true;
    notify('Your saved rituals could not be opened and have not been overwritten. Restore a backup to recover them; new changes stay in memory.');
  }
}

/** Return an independent snapshot suitable for the main app's backup file. */
export function getRituals() {
  load();
  trimHistory();
  return JSON.parse(JSON.stringify(state));
}

/** Validate first, then replace ritual storage and refresh the mounted view. */
export function restoreRituals(data) {
  const next = validateRituals(data);
  stopBreathing(false);
  state = next;
  storageBlocked = false;
  persist();
  if (mount) render();
}

function element(tag, className = '', text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}
function button(text, className, action, label = null) {
  const el = element('button', className, text);
  el.type = 'button';
  if (label) el.setAttribute('aria-label', label);
  if (action) el.addEventListener('click', action);
  return el;
}
function card(number, title, subtitle) {
  const el = element('section', 'ritual-card');
  const head = element('div', 'ritual-card-heading');
  const copy = element('div');
  copy.append(element('span', 'ritual-kicker', `RITUAL ${number}`), element('h2', 'ritual-title', title));
  head.append(copy, element('span', 'ritual-index', number));
  el.append(head, element('p', 'ritual-subtitle', subtitle));
  return el;
}
function shortDate(key) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${key}T12:00:00`));
}
function weekKeys() {
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() - 6 + i);
    return todayKey(day);
  });
}

function renderHabits() {
  const el = card('01', 'Small things, often.', 'A few gentle promises to yourself.');
  el.classList.add('ritual-habits-card');
  const day = currentDay();
  const keys = weekKeys();
  const list = element('div', 'ritual-habit-list');
  if (!state.habits.length) list.append(element('p', 'ritual-empty', 'Start with one small thing you would like to return to.'));
  for (const habit of state.habits) {
    const row = element('div', 'ritual-habit-row');
    const checked = day.habits.includes(habit.id);
    const check = button(checked ? '✓' : '', 'ritual-check', () => {
      const active = currentDay();
      const exists = active.habits.includes(habit.id);
      active.habits = exists ? active.habits.filter(id => id !== habit.id) : [...active.habits.slice(-199), habit.id];
      persist();
      replaceCard('.ritual-habits-card', renderHabits());
      mount.querySelector(`[data-habit-id="${CSS.escape(habit.id)}"]`)?.focus();
    }, `${checked ? 'Uncheck' : 'Complete'} ${habit.title}`);
    check.setAttribute('aria-pressed', String(checked));
    check.dataset.habitId = habit.id;
    const content = element('div', 'ritual-habit-content');
    const name = element('span', `ritual-habit-name${checked ? ' ritual-is-done' : ''}`, habit.title);
    const dots = element('div', 'ritual-habit-dots');
    dots.setAttribute('aria-label', `Last seven days for ${habit.title}`);
    for (const key of keys) {
      const done = (state.days[key]?.habits || []).includes(habit.id);
      const dot = element('span', `ritual-day-dot${done ? ' ritual-day-done' : ''}${key === todayKey() ? ' ritual-day-current' : ''}`);
      dot.title = `${shortDate(key)}: ${done ? 'completed' : 'not completed'}`;
      dot.setAttribute('aria-label', dot.title);
      dots.append(dot);
    }
    content.append(name, dots);
    const actions = element('div', 'ritual-habit-actions');
    const edit = button('↗', 'ritual-icon-button', () => editHabit(row, habit), `Edit ${habit.title}`);
    edit.dataset.habitEdit = habit.id;
    const remove = button('×', 'ritual-icon-button', () => {
      const index = state.habits.findIndex(item => item.id === habit.id);
      state.habits.splice(index, 1);
      persist();
      replaceCard('.ritual-habits-card', renderHabits());
      focusHabit(state.habits[Math.min(index, state.habits.length - 1)]?.id);
      notify('A little space, made.', () => {
        if (state.habits.length >= 20 || state.habits.some(item => item.id === habit.id)) return;
        state.habits.splice(index, 0, habit);
        persist();
        replaceCard('.ritual-habits-card', renderHabits());
        focusHabit(habit.id);
      });
    }, `Remove ${habit.title}`);
    actions.append(edit, remove);
    row.append(check, content, actions);
    list.append(row);
  }
  const footer = element('div', 'ritual-habit-footer');
  const completed = state.habits.filter(habit => day.habits.includes(habit.id)).length;
  footer.append(element('span', '', `${completed} of ${state.habits.length} today`), element('span', '', 'Dots remember your last 7 days'));
  const form = element('form', 'ritual-add-habit');
  const input = element('input', 'ritual-input');
  input.placeholder = 'Add a small ritual…';
  input.maxLength = 100;
  input.required = true;
  input.setAttribute('aria-label', 'New daily ritual');
  input.disabled = state.habits.length >= 20;
  const add = button('+', 'ritual-add-button', null, 'Add daily ritual');
  add.type = 'submit';
  add.disabled = input.disabled;
  form.append(input, add);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title || state.habits.length >= 20) { input.focus(); return; }
    state.habits.push({ id: globalThis.crypto?.randomUUID?.() || `habit-${Date.now()}-${Math.random().toString(36).slice(2)}`, title });
    persist();
    replaceCard('.ritual-habits-card', renderHabits());
    mount.querySelector('.ritual-add-habit input').focus();
  });
  el.append(list, footer, form);
  return el;
}

function editHabit(row, habit) {
  const form = element('form', 'ritual-habit-edit');
  const input = element('input', 'ritual-input');
  input.value = habit.title;
  input.maxLength = 100;
  input.required = true;
  input.setAttribute('aria-label', 'Edit ritual name');
  const save = button('Save', 'ritual-small-button');
  save.type = 'submit';
  const finishEdit = () => { replaceCard('.ritual-habits-card', renderHabits()); focusHabit(habit.id, true); };
  const cancel = button('Cancel', 'ritual-text-button', finishEdit);
  form.append(input, save, cancel);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!input.value.trim()) return;
    habit.title = input.value.trim();
    persist();
    finishEdit();
  });
  input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); finishEdit(); } });
  row.replaceChildren(form);
  input.focus();
  input.select();
}

function renderWater() {
  const el = card('02', 'A sip. A small pause.', 'Keep count, at your own pace.');
  el.classList.add('ritual-water-card');
  const day = currentDay();
  const scene = element('div', 'ritual-water-scene');
  const cupWrap = element('div', 'ritual-cup-wrap');
  const cup = element('div', 'ritual-cup');
  cup.setAttribute('role', 'img');
  cup.setAttribute('aria-label', `${day.cups} of ${state.cupGoal} cups`);
  const fill = element('div', 'ritual-cup-fill');
  fill.style.height = `${Math.min(100, day.cups / state.cupGoal * 100)}%`;
  const face = element('div', 'ritual-cup-face');
  face.setAttribute('aria-hidden', 'true');
  face.append(element('i'), element('i'), element('span'));
  cup.append(fill, face);
  cupWrap.append(cup, element('span', 'ritual-cup-handle'), element('div', 'ritual-cup-shadow'));
  const progress = element('div', 'ritual-water-progress');
  const number = element('div', 'ritual-water-count', String(day.cups));
  number.append(element('span', '', ` / ${state.cupGoal}`));
  progress.append(number, element('span', 'ritual-water-caption', day.cups >= state.cupGoal ? 'Your little goal, reached.' : 'cups enjoyed today'));
  const actions = element('div', 'ritual-water-actions');
  const minus = button('−', 'ritual-circle-button', () => changeCups(-1), 'Remove one cup');
  const plus = button('+', 'ritual-circle-button ritual-cup-add', () => changeCups(1), 'Add one cup');
  minus.disabled = day.cups === 0;
  plus.disabled = day.cups === 99;
  actions.append(minus, plus);
  progress.append(actions);
  scene.append(cupWrap, progress);
  const goal = element('label', 'ritual-water-goal', 'Your daily goal');
  const input = element('input', 'ritual-input');
  input.type = 'number';
  input.min = '1';
  input.max = '20';
  input.step = '1';
  input.value = state.cupGoal;
  input.setAttribute('aria-label', 'Daily cup goal');
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > 20) { input.value = state.cupGoal; notify('Choose a cup goal from 1 to 20.'); return; }
    state.cupGoal = value;
    persist();
    // Updating the existing card keeps keyboard focus in the goal input.
    updateWaterDisplay();
  });
  goal.append(input, element('span', '', 'cups'));
  el.append(scene, goal, element('p', 'ritual-footnote', 'A cup is whatever cup you use. Make this yours.'));
  return el;
}
function changeCups(change) {
  const day = currentDay();
  day.cups = Math.max(0, Math.min(99, day.cups + change));
  persist();
  updateWaterDisplay();
}
function updateWaterDisplay() {
  const day = currentDay();
  // Keep the same cup node so its water level visibly changes.
  const card = mount?.querySelector('.ritual-water-card');
  if (!card) return;
  card.querySelector('.ritual-cup-fill').style.height = `${Math.min(100, day.cups / state.cupGoal * 100)}%`;
  card.querySelector('.ritual-cup').setAttribute('aria-label', `${day.cups} of ${state.cupGoal} cups`);
  const count = card.querySelector('.ritual-water-count');
  count.replaceChildren(document.createTextNode(String(day.cups)), element('span', '', ` / ${state.cupGoal}`));
  card.querySelector('.ritual-water-caption').textContent = day.cups >= state.cupGoal ? 'Your little goal, reached.' : 'cups enjoyed today';
  card.querySelector('[aria-label="Remove one cup"]').disabled = day.cups === 0;
  card.querySelector('[aria-label="Add one cup"]').disabled = day.cups === 99;
}

function renderBreathing() {
  const el = card('03', 'Come back to now.', 'One quiet minute. Nothing else to do.');
  el.classList.add('ritual-breath-card');
  const scene = element('div', 'ritual-breath-scene');
  const orbit = element('div', 'ritual-breath-orbit');
  const circle = element('div', 'ritual-breath-circle');
  const instruction = element('span', 'ritual-breath-instruction', 'Settle in');
  instruction.setAttribute('aria-live', 'polite');
  const time = element('span', 'ritual-breath-time', '60 seconds, just for you');
  circle.append(instruction, time);
  orbit.append(circle);
  scene.append(orbit);
  const controls = element('div', 'ritual-breath-controls');
  const start = button('Begin a quiet minute', 'ritual-primary-button ritual-breath-start', () => {
    if (breathingStart !== null) { stopBreathing(true); return; }
    breathingStart = Date.now();
    start.textContent = 'Finish this pause';
    circle.classList.add('ritual-breath-active');
    tickBreathing();
  });
  controls.append(start, element('p', 'ritual-footnote', 'In for 4 seconds · out for 6 · repeat gently'));
  el.append(scene, controls);
  return el;
}
function tickBreathing() {
  const card = mount?.querySelector('.ritual-breath-card');
  if (!card || breathingStart === null) return;
  const elapsed = Math.max(0, Date.now() - breathingStart);
  if (elapsed >= 60000) {
    stopBreathing(false);
    card.querySelector('.ritual-breath-instruction').textContent = 'A little lighter';
    card.querySelector('.ritual-breath-time').textContent = 'One minute, well spent';
    notify('A quiet minute, just for you.');
    return;
  }
  const phase = elapsed % 10000;
  const inhale = phase < 4000;
  const text = inhale ? 'Breathe in' : 'Breathe out';
  const instruction = card.querySelector('.ritual-breath-instruction');
  if (instruction.textContent !== text) instruction.textContent = text;
  card.querySelector('.ritual-breath-time').textContent = `${Math.ceil((60000 - elapsed) / 1000)} seconds remaining`;
  const progress = inhale ? phase / 4000 : 1 - (phase - 4000) / 6000;
  card.querySelector('.ritual-breath-circle').style.setProperty('--ritual-breath-scale', String(0.82 + progress * 0.18));
  breathingFrame = requestAnimationFrame(tickBreathing);
}
function stopBreathing(resetText = true) {
  if (breathingFrame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(breathingFrame);
  breathingFrame = null;
  breathingStart = null;
  const card = mount?.querySelector('.ritual-breath-card');
  if (!card) return;
  const circle = card.querySelector('.ritual-breath-circle');
  circle.classList.remove('ritual-breath-active');
  circle.style.removeProperty('--ritual-breath-scale');
  card.querySelector('.ritual-breath-start').textContent = 'Begin a quiet minute';
  if (resetText) {
    card.querySelector('.ritual-breath-instruction').textContent = 'Settle in';
    card.querySelector('.ritual-breath-time').textContent = '60 seconds, just for you';
  }
}

function moodFace(value) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ritual-face');
  const add = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  };
  add('circle', { cx: 20, cy: 20, r: 17 });
  add('circle', { cx: 14, cy: 17, r: 0.9, fill: 'currentColor', stroke: 'none' });
  add('circle', { cx: 26, cy: 17, r: 0.9, fill: 'currentColor', stroke: 'none' });
  const mouths = ['M14 28 Q20 21 26 28', 'M15 26 Q20 24 25 26', 'M15 25 H25', 'M14 24 Q20 31 26 24', 'M13 23 Q20 35 27 23 Z'];
  add('path', { d: mouths[value - 1] });
  if (value === 5) { add('path', { d: 'M9 22 H11 M29 22 H31', opacity: .45 }); }
  return svg;
}
function renderMood() {
  const el = card('04', 'How are you, really?', 'No right answer. Just a little check-in.');
  el.classList.add('ritual-mood-card');
  const day = currentDay();
  const choices = element('div', 'ritual-mood-choices');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'How you feel today');
  MOODS.forEach((label, index) => {
    const choice = button('', 'ritual-mood-choice', () => {
      const active = currentDay();
      active.mood = active.mood === index + 1 ? null : index + 1;
      persist();
      for (const [i, item] of [...choices.children].entries()) item.setAttribute('aria-pressed', String(active.mood === i + 1));
      updateMoodHistory(el);
    }, label);
    choice.setAttribute('aria-pressed', String(day.mood === index + 1));
    choice.append(moodFace(index + 1), element('span', '', MOOD_SHORT[index]));
    choices.append(choice);
  });
  const label = element('label', 'ritual-note-label', 'A sentence for today');
  const note = element('textarea', 'ritual-mood-note');
  note.placeholder = 'What made today feel like today?';
  note.maxLength = 500;
  note.rows = 3;
  note.value = day.note;
  label.append(note);
  const status = element('div', 'ritual-note-status', 'Saved here, just for you.');
  note.addEventListener('input', () => {
    currentDay().note = note.value;
    persist();
    status.textContent = saveProblemShown ? 'Could not save. Make a backup to keep this note.' : 'A little piece of today, saved.';
    updateMoodHistory(el);
  });
  const history = element('details', 'ritual-mood-history');
  const summary = element('summary', '', 'Recent little moments');
  history.append(summary, element('div', 'ritual-mood-history-list'));
  el.append(choices, label, status, history);
  updateMoodHistory(el);
  return el;
}
function updateMoodHistory(card) {
  const list = card.querySelector('.ritual-mood-history-list');
  if (!list) return;
  list.replaceChildren();
  const keys = weekKeys().reverse().filter(key => state.days[key] && (state.days[key].mood !== null || state.days[key].note.trim()));
  if (!keys.length) { list.append(element('p', 'ritual-empty', 'Your last 7 days will collect here, one moment at a time.')); return; }
  for (const key of keys) {
    const day = state.days[key];
    const row = element('div', 'ritual-history-row');
    const heading = element('div', 'ritual-history-heading');
    heading.append(element('span', '', key === todayKey() ? 'Today' : shortDate(key)), element('span', '', day.mood === null ? 'A little note' : MOODS[day.mood - 1]));
    row.append(heading);
    if (day.note.trim()) row.append(element('p', '', day.note));
    list.append(row);
  }
}
function replaceCard(selector, replacement) {
  mount?.querySelector(selector)?.replaceWith(replacement);
}
function focusHabit(id, edit = false) {
  const target = id ? mount?.querySelector(`[data-habit-${edit ? 'edit' : 'id'}="${CSS.escape(id)}"]`) : null;
  (target || mount?.querySelector('.ritual-add-habit input'))?.focus({ preventScroll: true });
}
function render() {
  if (!mount) return;
  stopBreathing(true);
  renderedDay = todayKey();
  currentDay();
  const heading = element('div', 'ritual-page-heading');
  const copy = element('div');
  copy.append(element('span', 'ritual-kicker', 'THE LITTLE THINGS'), element('h1', '', 'A gentler kind of progress.'), element('p', '', 'Small rituals for an ordinary, lovely day.'));
  heading.append(copy, element('span', 'ritual-page-mark', '日々'));
  const grid = element('div', 'ritual-grid');
  grid.append(renderHabits(), renderWater(), renderBreathing(), renderMood());
  const footer = element('p', 'ritual-page-footnote', storageBlocked ? 'Saved rituals need attention and have not been overwritten. Restore a backup to recover them. New changes stay in memory.' : 'A fresh page each day. Your little moments stay here.');
  if (storageBlocked) footer.setAttribute('role', 'status');
  mount.replaceChildren(heading, grid, footer);
}

/** Mount the rituals panel and return a cleanup function. Browser-only, safe to import in Node. */
export function initRituals(root, { toast = () => {} } = {}) {
  if (!root?.replaceChildren) throw new Error('Choose a root element for rituals.');
  cleanup?.();
  mount = root;
  notify = toast;
  load();
  render();
  const refreshDay = () => {
    if (todayKey() !== renderedDay) { render(); persist(); }
  };
  const onStorage = event => {
    if (event.key !== STORAGE_KEY) return;
    try { state = event.newValue ? validateRituals(JSON.parse(event.newValue)) : freshState(); storageBlocked = false; saveProblemShown = false; render(); }
    catch { storageBlocked = true; saveProblemShown = true; notify('Another tab sent a ritual update that could not be read. Restore a backup before saving more changes.'); }
  };
  const interval = setInterval(refreshDay, 30000);
  window.addEventListener('focus', refreshDay);
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', refreshDay);
  cleanup = () => {
    clearInterval(interval);
    stopBreathing(false);
    window.removeEventListener('focus', refreshDay);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', refreshDay);
    cleanup = null;
  };
  return cleanup;
}
