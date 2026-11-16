const KEY = 'daylight.shelf.v1';
const LIMITS = Object.freeze({ books: 100, links: 100, moments: 200 });
let state = null, mount = null, notify = () => {}, view = {}, filter = 'reading', cleanup = null;
let lastStored = null, storageBlocked = false, storageWarning = false;

export function freshShelf() { return { version: 1, books: [], links: [], moments: [], pickedMomentId: null }; }
function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be an object.`);
}
function text(value, limit, label, empty = false) {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())) throw new Error(`${label} is invalid.`);
  return value;
}
function whole(value, low, high, label) {
  if (!Number.isInteger(value) || value < low || value > high) throw new Error(`${label} must be between ${low} and ${high}.`);
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('An item ID is invalid.');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('An item date is invalid.');
  const date = new Date(value), [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year === 0 ? 400 : year, month, 0)).getUTCDate();
  if (!Number.isFinite(date.getTime()) || month < 1 || month > 12 || day < 1 || day > daysInMonth) throw new Error('An item date is invalid.');
  return date.toISOString();
}
export function normalizeShelfUrl(value) {
  text(value, 2000, 'Website address');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Use a complete website address starting with https:// or http://.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Use an http:// or https:// link without sign-in details.');
  if (url.href.length > 2000) throw new Error('Keep website addresses under 2,000 characters.');
  return url.href;
}
export function readingStatus(book) { return book.current === book.pages ? 'finished' : 'reading'; }
export function pickShelfMoment(moments, previousId = null, random = Math.random) {
  if (!moments.length) return null;
  const choices = moments.length > 1 ? moments.filter(moment => moment.id !== previousId) : moments;
  const amount = random();
  const index = Number.isFinite(amount) ? Math.max(0, Math.min(choices.length - 1, Math.floor(amount * choices.length))) : 0;
  return choices[index].id;
}

/** Validate a portable shelf backup and keep only the known, bounded fields. */
export function validateShelf(input) {
  plain(input, 'Shelf');
  if (input.version !== 1) throw new Error('This shelf backup version is not supported.');
  const result = freshShelf();
  const seen = new Set();
  for (const kind of ['books', 'links', 'moments']) {
    if (!Array.isArray(input[kind]) || input[kind].length > LIMITS[kind]) throw new Error(`Your shelf can hold up to ${LIMITS[kind]} ${kind}.`);
    result[kind] = input[kind].map(item => {
      plain(item, 'Shelf item');
      const id = identifier(item.id);
      if (seen.has(id)) throw new Error('Shelf item IDs must be unique.');
      seen.add(id);
      const createdAt = timestamp(item.createdAt);
      if (kind === 'books') {
        const pages = whole(item.pages, 1, 20000, 'Total pages');
        return { id, title: text(item.title, 180, 'Book title'), author: text(item.author, 120, 'Author', true), pages, current: whole(item.current, 0, pages, 'Current page'), createdAt };
      }
      if (kind === 'links') return { id, title: text(item.title, 180, 'Link title'), url: normalizeShelfUrl(item.url), createdAt };
      return { id, text: text(item.text, 280, 'Little moment'), createdAt };
    });
  }
  if (input.pickedMomentId !== null) identifier(input.pickedMomentId);
  result.pickedMomentId = result.moments.some(item => item.id === input.pickedMomentId) ? input.pickedMomentId : null;
  return result;
}

function storageMessage(message) {
  if (!storageWarning) notify(message);
  storageWarning = true;
}
function load() {
  if (state) return;
  state = freshShelf();
  if (typeof localStorage === 'undefined') return;
  try { const raw = localStorage.getItem(KEY); if (raw) state = validateShelf(JSON.parse(raw)); lastStored = raw; }
  catch { storageBlocked = true; storageMessage('Your saved shelf could not be opened and has not been overwritten. Restore a backup to recover it. New changes stay in memory.'); }
}
function syncStored(render = false) {
  load();
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === lastStored && !storageBlocked) return;
    const next = raw ? validateShelf(JSON.parse(raw)) : freshShelf();
    state = next; lastStored = raw; storageBlocked = false; storageWarning = false;
    if (render) renderAll(true);
  } catch { storageBlocked = true; storageMessage('A saved shelf update could not be read. The original is safe. Restore a backup before saving more changes.'); }
}
function persist() {
  if (storageBlocked) return false;
  try {
    const raw = JSON.stringify(state);
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, raw);
    lastStored = raw; storageWarning = false; return true;
  } catch { storageMessage('This browser could not save your shelf. Download a backup to keep your changes.'); return false; }
}
function change(update, focusKey = null) {
  syncStored();
  update(state);
  const saved = persist();
  renderAll(false, focusKey);
  if (!saved) updateStorageNote();
  return saved;
}
export function getShelf() { syncStored(true); return JSON.parse(JSON.stringify(state)); }
export function restoreShelf(input) {
  const next = validateShelf(input);
  state = next; storageBlocked = false; storageWarning = false;
  const saved = persist(); renderAll(); return saved;
}

function el(tag, className = '', value = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value) element.textContent = value;
  return element;
}
function button(value, className, action, label = null) {
  const element = el('button', className, value); element.type = 'button';
  if (action) element.addEventListener('click', action);
  if (label) element.setAttribute('aria-label', label);
  return element;
}
function inputField(labelText, key, { placeholder = '', max = 180, type = 'text', optional = false, min, value } = {}) {
  const label = el('label', 'shelf-field', labelText);
  const input = el('input', 'shelf-input'); input.type = type; input.dataset.focusKey = key; input.placeholder = placeholder; input.required = !optional;
  if (type === 'number') { input.min = String(min ?? 0); input.max = String(max); input.step = '1'; }
  else input.maxLength = max;
  if (value !== undefined) input.value = String(value);
  label.append(input); return { label, input };
}
function card(number, title, description, className) {
  const section = el('section', `shelf-card ${className}`), header = el('div', 'shelf-card-heading'), copy = el('div');
  const heading = el('h2', 'shelf-card-title', title); heading.id = `shelf-heading-${number}`; section.setAttribute('aria-labelledby', heading.id);
  copy.append(el('span', 'shelf-eyebrow', `A PLACE FOR ${number === '01' ? 'STORIES' : number === '02' ? 'DISCOVERIES' : 'GOOD THINGS'}`), heading);
  header.append(copy, el('span', 'shelf-index', number)); section.append(header, el('p', 'shelf-card-description', description)); return section;
}
function makeId() { return globalThis.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function shortDate(value) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value)); }
function status(value) { if (view.announce) view.announce.textContent = value; }
function findFocus(key) { return key ? [...mount.querySelectorAll('[data-focus-key]')].find(element => element.dataset.focusKey === key) : null; }
function savedFocus() {
  const active = document.activeElement;
  if (!mount?.contains(active) || !active.dataset.focusKey) return null;
  return { key: active.dataset.focusKey, value: active.tagName === 'INPUT' ? active.value : null };
}
function renderAll(preserveDraft = false, focusKey = null) {
  if (!mount) return;
  const focused = savedFocus();
  renderBooks(); renderLinks(); renderMoments(); updateStorageNote();
  const key = focusKey || focused?.key;
  const target = findFocus(key);
  if (target) {
    if (preserveDraft && focused?.value !== null && focused?.key === key && target.tagName === 'INPUT') target.value = focused.value;
    if (document.activeElement !== target) target.focus({ preventScroll: true });
  } else if (focused && key) {
    const fallback = key.startsWith('link-') ? view.linkTitle : key.startsWith('moment-') ? view.momentInput : view.bookTitle;
    fallback?.focus({ preventScroll: true });
  }
}
function updateStorageNote() {
  if (!view.storageNote) return;
  view.storageNote.textContent = storageBlocked ? 'Saved shelf needs attention and has not been overwritten. Restore a backup to recover it; new changes stay in memory.' : storageWarning ? 'Your shelf is in memory. Download a backup to keep it.' : 'A few things worth keeping. Saved in this browser.';
}

function buildBooks() {
  const section = card('01', 'Stories, slowly.', 'Keep your place. A few pages still count.', 'shelf-books-card');
  const scene = el('div', 'shelf-book-scene'); scene.setAttribute('aria-hidden', 'true');
  for (const [name, shade] of [['ONE', 'brick'], ['PAGE', 'paper'], ['AT A', 'sage'], ['TIME', 'ochre']]) { const spine = el('div', `shelf-scene-book shelf-scene-${shade}`); spine.append(el('span', '', name), el('i')); scene.append(spine); }
  scene.append(el('div', 'shelf-wooden-ledge')); section.append(scene);
  const tabs = el('div', 'shelf-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Reading shelf');
  view.bookTabs = [];
  for (const name of ['reading', 'finished']) {
    const tab = button(name === 'reading' ? 'Reading' : 'Finished', 'shelf-tab', () => { filter = name; renderBooks(); }, `${name === 'reading' ? 'Reading' : 'Finished'} books`);
    tab.id = `shelf-tab-${name}`; tab.dataset.filter = name; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'shelf-book-panel');
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); filter = event.key === 'Home' ? 'reading' : event.key === 'End' ? 'finished' : filter === 'reading' ? 'finished' : 'reading';
      renderBooks(); view.bookTabs.find(item => item.dataset.filter === filter).focus();
    });
    tabs.append(tab); view.bookTabs.push(tab);
  }
  view.bookList = el('div', 'shelf-book-list'); view.bookList.id = 'shelf-book-panel'; view.bookList.setAttribute('role', 'tabpanel');
  const details = el('details', 'shelf-add-details'); details.open = true; details.append(el('summary', '', 'Add a book'));
  const form = el('form', 'shelf-book-form');
  const title = inputField('Book title', 'book-title', { placeholder: 'A story you want to return to' });
  const author = inputField('Author · optional', 'book-author', { max: 120, optional: true, placeholder: 'Who wrote it?' });
  const pages = inputField('Total pages', 'book-total', { type: 'number', min: 1, max: 20000, value: 200 });
  const current = inputField('Your current page', 'book-current', { type: 'number', min: 0, max: 20000, value: 0 });
  const columns = el('div', 'shelf-field-pair'); columns.append(pages.label, current.label);
  const submit = button('Put it on my shelf  +', 'shelf-primary'); submit.type = 'submit';
  form.append(title.label, author.label, columns, submit); details.append(form); section.append(tabs, view.bookList, details);
  view.bookTitle = title.input; view.bookSubmit = submit;
  current.input.addEventListener('input', () => current.input.setCustomValidity(''));
  pages.input.addEventListener('input', () => { current.input.max = pages.input.value || '20000'; current.input.setCustomValidity(''); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = title.input.value.trim(), total = Number(pages.input.value), progress = Number(current.input.value);
    if (!name) { title.input.focus(); return; }
    if (!Number.isInteger(total) || total < 1 || total > 20000 || !Number.isInteger(progress) || progress < 0 || progress > total) { current.input.setCustomValidity('Choose a current page between 0 and the total pages.'); current.input.reportValidity(); return; }
    let added = false;
    change(next => {
      if (next.books.length >= LIMITS.books) { notify('Your shelf holds 100 books. Remove one or make a backup before adding more.'); return; }
      next.books.push({ id: makeId(), title: name, author: author.input.value.trim(), pages: total, current: progress, createdAt: new Date().toISOString() }); added = true;
    });
    if (!added) return;
    title.input.value = ''; author.input.value = ''; current.input.value = '0';
    filter = progress === total ? 'finished' : 'reading'; renderBooks(); title.input.focus(); status('A new story, on your shelf.');
  });
  return section;
}

function renderBooks() {
  const all = state.books, books = all.filter(book => readingStatus(book) === filter);
  view.bookTabs.forEach(tab => {
    const active = tab.dataset.filter === filter, count = all.filter(book => readingStatus(book) === tab.dataset.filter).length;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    tab.textContent = `${tab.dataset.filter === 'reading' ? 'Reading' : 'Finished'} · ${count}`;
  });
  view.bookList.setAttribute('aria-labelledby', `shelf-tab-${filter}`); view.bookList.replaceChildren();
  view.bookSubmit.disabled = state.books.length >= LIMITS.books;
  if (!books.length) { view.bookList.append(el('p', 'shelf-empty', filter === 'reading' ? 'Your next chapter can begin right here.' : 'Finished stories will find a home here. Take your time.')); return; }
  for (const [index, book] of books.entries()) {
    const row = el('article', 'shelf-book-row');
    const cover = el('div', `shelf-mini-book shelf-book-color-${all.indexOf(book) % 5}`); cover.setAttribute('aria-hidden', 'true');
    cover.append(el('span', 'shelf-cover-rule'), el('span', 'shelf-cover-title', book.title.slice(0, 55)), el('span', 'shelf-cover-imprint', 'a little at a time'));
    const content = el('div', 'shelf-book-content'); content.append(el('h3', 'shelf-book-title', book.title));
    if (book.author) content.append(el('p', 'shelf-book-author', book.author));
    const track = el('progress', 'shelf-reading-progress'); track.max = book.pages; track.value = book.current; track.setAttribute('aria-label', `${book.title}: ${book.current} of ${book.pages} pages`);
    content.append(track, el('p', 'shelf-progress-label', book.current === book.pages ? `${book.pages} pages, a whole little world.` : `${book.current} of ${book.pages} pages · ${Math.round(book.current / book.pages * 100)}%`));
    const form = el('form', 'shelf-page-form'), label = el('label', '', 'Page');
    const page = el('input', 'shelf-page-input'); page.type = 'number'; page.min = '0'; page.max = String(book.pages); page.step = '1'; page.required = true; page.value = String(book.current); page.dataset.focusKey = `book-page-${book.id}`; page.setAttribute('aria-label', `Current page of ${book.title}`);
    const save = button('Save place', 'shelf-small-button'); save.type = 'submit'; save.dataset.focusKey = `book-save-${book.id}`;
    label.append(page); form.append(label, save);
    form.addEventListener('submit', event => {
      event.preventDefault(); const value = Number(page.value);
      if (!Number.isInteger(value) || value < 0 || value > book.pages) { page.reportValidity(); return; }
      change(next => { const current = next.books.find(item => item.id === book.id); if (current) current.current = Math.min(current.pages, value); });
      status(value === book.pages ? 'Last page turned. A story, finished.' : 'Your place is saved.');
    });
    const actions = el('div', 'shelf-book-actions');
    const finish = button(book.current === book.pages ? 'Read again' : 'Finish book', 'shelf-text-button', () => {
      let previous;
      change(next => { const current = next.books.find(item => item.id === book.id); if (!current) return; previous = current.current; current.current = current.current === current.pages ? 0 : current.pages; });
      if (previous === undefined) return;
      notify(previous === book.pages ? 'Back to the first page.' : 'A whole story, finished. Lovely.', () => change(next => { const current = next.books.find(item => item.id === book.id); if (current) current.current = Math.min(current.pages, previous); }));
    }); finish.dataset.focusKey = `book-finish-${book.id}`;
    const remove = button('×', 'shelf-remove', () => deleteItem('books', book.id, `book-page-${books[Math.min(index + 1, books.length - 1)]?.id}`, 'book-title'), `Remove ${book.title}`); remove.dataset.focusKey = `book-remove-${book.id}`;
    actions.append(finish, remove); content.append(form, actions); row.append(cover, content); view.bookList.append(row);
  }
}

function buildLinks() {
  const section = card('02', 'Good things, found.', 'A small collection of places to come back to.', 'shelf-links-card');
  view.linkList = el('div', 'shelf-link-list');
  const form = el('form', 'shelf-link-form');
  const title = inputField('Give it a name', 'link-title', { placeholder: 'An article, recipe, little discovery…' });
  const url = inputField('Website address', 'link-url', { type: 'url', max: 2000, placeholder: 'https://example.com/something-good' });
  const submit = button('Keep this link  +', 'shelf-secondary'); submit.type = 'submit'; form.append(title.label, url.label, submit);
  url.input.addEventListener('input', () => url.input.setCustomValidity(''));
  form.addEventListener('submit', event => {
    event.preventDefault(); const name = title.input.value.trim(); if (!name) { title.input.focus(); return; }
    let href; try { href = normalizeShelfUrl(url.input.value); } catch (error) { url.input.setCustomValidity(error.message); url.input.reportValidity(); return; }
    let added = false;
    change(next => { if (next.links.length >= LIMITS.links) { notify('Your shelf holds 100 links. Remove one before adding another.'); return; } next.links.push({ id: makeId(), title: name, url: href, createdAt: new Date().toISOString() }); added = true; });
    if (added) { title.input.value = ''; url.input.value = ''; title.input.focus(); status('A good find, kept for later.'); }
  });
  section.append(view.linkList, form); view.linkTitle = title.input; view.linkSubmit = submit; return section;
}
function renderLinks() {
  view.linkList.replaceChildren(); view.linkSubmit.disabled = state.links.length >= LIMITS.links;
  if (!state.links.length) view.linkList.append(el('p', 'shelf-empty', 'Found something lovely? Give it a little home.'));
  for (const link of [...state.links].reverse()) {
    const row = el('div', 'shelf-link-row'), anchor = el('a', 'shelf-link');
    anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.dataset.focusKey = `link-open-${link.id}`;
    const mark = el('span', 'shelf-bookmark', '↗'); mark.setAttribute('aria-hidden', 'true');
    const copy = el('span', 'shelf-link-copy'); copy.append(el('strong', '', link.title), el('small', '', new URL(link.url).hostname.replace(/^www\./, '')));
    const hint = el('span', 'shelf-visually-hidden', ' (opens in a new tab)'); anchor.append(mark, copy, hint);
    const remove = button('×', 'shelf-remove', () => deleteItem('links', link.id, 'link-title'), `Remove saved link ${link.title}`); remove.dataset.focusKey = `link-remove-${link.id}`;
    row.append(anchor, remove); view.linkList.append(row);
  }
}

function buildMoments() {
  const section = card('03', 'A jar of little moments.', 'For the ordinary things you’d like to remember.', 'shelf-moments-card');
  const scene = el('div', 'shelf-moment-scene'), jar = el('div', 'shelf-jar'); jar.setAttribute('aria-hidden', 'true');
  jar.append(el('span', 'shelf-jar-lid'), el('i', 'shelf-jar-paper shelf-jar-paper-one'), el('i', 'shelf-jar-paper shelf-jar-paper-two'), el('i', 'shelf-jar-paper shelf-jar-paper-three'), el('span', 'shelf-jar-label', 'good things'));
  const invitation = el('div', 'shelf-jar-invitation'); invitation.append(el('p', '', 'Some days, a small memory is enough.'));
  view.pick = button('Pick a little moment ↗', 'shelf-text-button', () => {
    change(next => { next.pickedMomentId = pickShelfMoment(next.moments, next.pickedMomentId); });
    if (state.pickedMomentId) status('A little moment, rediscovered.');
  }); invitation.append(view.pick); scene.append(jar, invitation);
  view.picked = el('div', 'shelf-picked-moment'); view.picked.setAttribute('aria-live', 'polite');
  const form = el('form', 'shelf-moment-form'), label = el('label', 'shelf-field', 'One good thing, however small');
  const input = el('textarea', 'shelf-moment-input'); input.rows = 3; input.maxLength = 280; input.required = true; input.placeholder = 'Warm tea. A kind message. Light on the kitchen floor.'; input.dataset.focusKey = 'moment-input'; label.append(input);
  const bottom = el('div', 'shelf-moment-form-bottom'); view.momentCounter = el('span', 'shelf-character-count', '0 / 280');
  const submit = button('Put it in the jar  +', 'shelf-primary'); submit.type = 'submit'; bottom.append(view.momentCounter, submit); form.append(label, bottom);
  input.addEventListener('input', () => { view.momentCounter.textContent = `${input.value.length} / 280`; });
  form.addEventListener('submit', event => {
    event.preventDefault(); const value = input.value.trim(); if (!value) { input.focus(); return; }
    let added = false;
    change(next => { if (next.moments.length >= LIMITS.moments) { notify('Your jar holds 200 moments. Make a backup or remove one before adding more.'); return; } const id = makeId(); next.moments.push({ id, text: value, createdAt: new Date().toISOString() }); next.pickedMomentId = id; added = true; });
    if (added) { input.value = ''; view.momentCounter.textContent = '0 / 280'; input.focus(); status('A small good thing, kept.'); }
  });
  const collection = el('details', 'shelf-collection'); view.collectionSummary = el('summary'); view.momentList = el('div', 'shelf-moment-list'); collection.append(view.collectionSummary, view.momentList);
  section.append(scene, view.picked, form, collection); view.momentInput = input; view.momentSubmit = submit; return section;
}
function renderMoments() {
  view.pick.disabled = !state.moments.length; view.momentSubmit.disabled = state.moments.length >= LIMITS.moments;
  const picked = state.moments.find(moment => moment.id === state.pickedMomentId);
  view.picked.replaceChildren(); view.picked.hidden = !picked;
  if (picked) view.picked.append(el('span', 'shelf-paper-pin'), el('p', '', picked.text), el('span', 'shelf-moment-date', shortDate(picked.createdAt)));
  view.collectionSummary.textContent = `Your little collection · ${state.moments.length}`; view.momentList.replaceChildren();
  if (!state.moments.length) view.momentList.append(el('p', 'shelf-empty', 'Your jar is ready for its first little moment.'));
  for (const moment of [...state.moments].reverse()) {
    const row = el('div', 'shelf-moment-row'), copy = el('div'); copy.append(el('span', 'shelf-moment-date', shortDate(moment.createdAt)), el('p', '', moment.text));
    const remove = button('×', 'shelf-remove', () => deleteItem('moments', moment.id, 'moment-input'), `Remove moment: ${moment.text}`); remove.dataset.focusKey = `moment-remove-${moment.id}`;
    row.append(copy, remove); view.momentList.append(row);
  }
}
function deleteItem(kind, id, focusKey, fallback = focusKey) {
  let removed = null, position = 0, wasPicked = false;
  change(next => {
    position = next[kind].findIndex(item => item.id === id); if (position < 0) return;
    [removed] = next[kind].splice(position, 1); wasPicked = next.pickedMomentId === id;
    if (wasPicked) next.pickedMomentId = null;
  }, findFocus(focusKey) ? focusKey : fallback);
  if (!removed) return;
  notify(kind === 'books' ? 'Book removed from your shelf.' : kind === 'links' ? 'Saved link removed.' : 'Moment removed from the jar.', () => {
    change(next => {
      if (next[kind].some(item => item.id === removed.id)) return;
      if (next[kind].length >= LIMITS[kind]) { notify('There is no room to undo yet. Remove another item first.'); return; }
      next[kind].splice(Math.min(position, next[kind].length), 0, removed);
      if (wasPicked) next.pickedMomentId = removed.id;
    }, kind === 'books' ? `book-page-${removed.id}` : kind === 'links' ? `link-open-${removed.id}` : `moment-remove-${removed.id}`);
  });
}

/** Mount a responsive, local-only shelf. Importing this module requires no browser APIs. */
export function initShelf(root, { toast = () => {} } = {}) {
  if (!root?.replaceChildren) throw new Error('Choose a root element for the shelf.');
  cleanup?.(); mount = root; notify = toast; load();
  const heading = el('div', 'shelf-page-heading'), copy = el('div'); copy.append(el('span', 'shelf-eyebrow', 'THINGS WORTH KEEPING'), el('h1', '', 'Make yourself a little shelf.'), el('p', '', 'Stories, good finds, and moments that stay.'));
  const mark = el('span', 'shelf-heading-mark', '本'); mark.setAttribute('aria-hidden', 'true'); heading.append(copy, mark);
  const grid = el('div', 'shelf-grid'); grid.append(buildBooks(), buildLinks(), buildMoments());
  view.storageNote = el('p', 'shelf-storage-note'); view.announce = el('span', 'shelf-visually-hidden'); view.announce.setAttribute('role', 'status');
  mount.replaceChildren(heading, grid, view.storageNote, view.announce); renderAll();
  const onStorage = event => { if (event.key === KEY || event.key === null) syncStored(true); };
  const onFocus = () => syncStored(true);
  window.addEventListener('storage', onStorage); window.addEventListener('focus', onFocus);
  cleanup = () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); cleanup = null; };
  return cleanup;
}
