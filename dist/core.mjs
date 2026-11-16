const PRIORITY = Object.freeze({ high: 0, normal: 1, low: 2 });
const MAX_TIMESTAMP = 8.64e15;

/** Create fresh, independent planner state. */
export function defaultState() {
  return {
    version: 1,
    tasks: [],
    sessions: [],
    notes: '',
    capacity: 120,
    timer: { taskId: null, totalSeconds: 1500, remainingSeconds: 1500, endAt: null },
  };
}

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path, 'expected a plain object');
  return value;
}

function text(value, path, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    fail(path, `expected ${allowEmpty ? 'text' : 'nonempty text'} up to ${maximum} characters`);
  }
  return value;
}

function number(value, path, minimum, maximum, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    fail(path, `expected ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}`);
  }
  return value;
}

function date(value, path, nullable = false) {
  if (nullable && value === null) return null;
  // ISO timestamps include a zone, so a backup means the same instant on another device.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(path, 'expected an ISO date and time');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(path, 'invalid date');
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const days = new Date(Date.UTC(year === 0 ? 400 : year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > days) fail(path, 'invalid calendar date');
  return parsed.toISOString();
}

function id(value, path, nullable = false) {
  return nullable && value === null ? null : text(value, path, 160);
}

function array(value, path, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `expected a list of at most ${maximum} items`);
  return value;
}

/** Validate local state or a backup and return a clean copy containing known fields only. */
export function validateState(input) {
  const source = object(input, 'Backup');
  if (source.version !== 1) fail('Backup version', 'this backup is not supported');
  const seenTasks = new Set();
  const tasks = array(source.tasks, 'Tasks', 2000).map((entry, index) => {
    const path = `Task ${index + 1}`;
    object(entry, path);
    const taskId = id(entry.id, `${path} ID`);
    if (seenTasks.has(taskId)) fail(path, 'duplicate task ID');
    seenTasks.add(taskId);
    if (typeof entry.priority !== 'string' || !Object.hasOwn(PRIORITY, entry.priority)) fail(path, 'invalid priority');
    if (entry.bucket !== 'today' && entry.bucket !== 'later') fail(path, 'invalid task list');
    if (typeof entry.done !== 'boolean') fail(path, 'invalid completion status');
    return {
      id: taskId,
      title: text(entry.title, `${path} title`, 300),
      minutes: number(entry.minutes, `${path} duration`, 5, 480, true),
      priority: entry.priority,
      bucket: entry.bucket,
      done: entry.done,
      createdAt: date(entry.createdAt, `${path} created date`),
      completedAt: date(entry.completedAt, `${path} completed date`, true),
    };
  });
  const seenSessions = new Set();
  const sessions = array(source.sessions, 'Sessions', 10000).map((entry, index) => {
    const path = `Session ${index + 1}`;
    object(entry, path);
    const sessionId = id(entry.id, `${path} ID`);
    if (seenSessions.has(sessionId)) fail(path, 'duplicate session ID');
    seenSessions.add(sessionId);
    return {
      id: sessionId,
      taskId: id(entry.taskId, `${path} task ID`, true),
      taskTitle: text(entry.taskTitle, `${path} task title`, 300, true),
      minutes: number(entry.minutes, `${path} duration`, Number.MIN_VALUE, 480),
      at: date(entry.at, `${path} date`),
    };
  });
  const rawTimer = object(source.timer, 'Timer');
  const totalSeconds = number(rawTimer.totalSeconds, 'Timer duration', 1, 3600, true);
  const seconds = number(rawTimer.remainingSeconds, 'Timer remaining time', 0, 3600, true);
  const taskId = id(rawTimer.taskId, 'Timer task ID', true);
  const endAt = rawTimer.endAt === null ? null : number(rawTimer.endAt, 'Timer ending time', 0, MAX_TIMESTAMP, true);
  return {
    version: 1,
    tasks,
    sessions,
    notes: text(source.notes, 'Notes', 20000, true),
    capacity: number(source.capacity, 'Daily time', 5, 1440, true),
    timer: {
      taskId: taskId === null || seenTasks.has(taskId) ? taskId : null,
      totalSeconds,
      remainingSeconds: Math.min(seconds, totalSeconds),
      endAt,
    },
  };
}

/** Greedily select pending today tasks in priority/creation order without overbooking. */
export function planTasks(tasks, budget) {
  if (!Number.isFinite(budget) || budget <= 0) return [];
  let available = budget;
  const sorted = tasks
    .filter(task => !task.done && task.bucket === 'today' && Number.isFinite(task.minutes) && task.minutes > 0)
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const importance = (PRIORITY[a.task.priority] ?? 1) - (PRIORITY[b.task.priority] ?? 1);
      const chronological = new Date(a.task.createdAt).getTime() - new Date(b.task.createdAt).getTime();
      return importance || chronological || a.index - b.index;
    });
  const plan = [];
  for (const { task } of sorted) {
    if (task.minutes <= available) {
      plan.push(task);
      available -= task.minutes;
    }
  }
  return plan;
}

/** Derive time from an absolute deadline so background tabs and reloads remain accurate. */
export function remainingSeconds(timer, now = Date.now()) {
  const total = Number.isFinite(timer.totalSeconds) ? Math.max(0, timer.totalSeconds) : 0;
  const remaining = timer.endAt !== null && Number.isFinite(timer.endAt)
    ? Math.ceil((timer.endAt - now) / 1000)
    : timer.remainingSeconds;
  return Math.min(total, Math.max(0, Number.isFinite(remaining) ? Math.ceil(remaining) : 0));
}

export function localDayKey(date = new Date()) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid day');
  return `${String(parsed.getFullYear()).padStart(4, '0')}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

export function formatMinutes(minutes) {
  const rounded = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${remainder}m`;
}
