import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { freshShelf, validateShelf, normalizeShelfUrl, readingStatus, pickShelfMoment, getShelf, restoreShelf } from '../dist/shelf.mjs';

const date = '2026-11-16T12:00:00.000Z';
const book = overrides => ({ id: 'book-1', title: 'A quiet story', author: 'Someone thoughtful', pages: 240, current: 32, createdAt: date, ...overrides });
const link = overrides => ({ id: 'link-1', title: 'A good find', url: 'https://example.com/reading', createdAt: date, ...overrides });
const moment = overrides => ({ id: 'moment-1', text: 'Sunlight across the table.', createdAt: date, ...overrides });

test('shelf defaults and import are browser-independent and do not share mutable lists', () => {
  const first = freshShelf(), second = freshShelf();
  first.books.push(book());
  assert.equal(second.books.length, 0);
  assert.deepEqual(validateShelf(second), second);
  assert.equal(getShelf().version, 1);
});

test('backup round trip preserves all three collections as inert text and strips unknown fields', () => {
  const input = { ...freshShelf(), books: [book({ title: '<img src=x onerror=alert(1)>', extra: 'discard' })], links: [link()], moments: [moment({ text: '<script>still just a memory</script>' })], pickedMomentId: 'moment-1', extra: 'discard' };
  const result = validateShelf(JSON.parse(JSON.stringify(input)));
  assert.equal(result.books[0].title, input.books[0].title);
  assert.equal(result.moments[0].text, input.moments[0].text);
  assert.equal(result.pickedMomentId, 'moment-1');
  assert.equal('extra' in result, false);
  assert.equal('extra' in result.books[0], false);
  assert.notEqual(result.books[0], input.books[0]);
});

test('website addresses normalize safely and reject executable or credential-bearing URLs', () => {
  assert.equal(normalizeShelfUrl('  https://EXAMPLE.com/a b?q=tea#book  '), 'https://example.com/a%20b?q=tea#book');
  assert.equal(normalizeShelfUrl('http://example.com'), 'http://example.com/');
  for (const invalid of ['javascript:alert(1)', 'data:text/html,hello', 'file:///secret.txt', 'ftp://example.com', '//example.com', 'example.com', 'https://person:secret@example.com', 'https://', 'x'.repeat(2001)]) {
    assert.throws(() => normalizeShelfUrl(invalid));
  }
});

test('reading status derives from valid page progress, including a one-page book', () => {
  for (const [pages, current, expected] of [[240, 0, 'reading'], [240, 239, 'reading'], [240, 240, 'finished'], [1, 0, 'reading'], [1, 1, 'finished']]) {
    const valid = validateShelf({ ...freshShelf(), books: [book({ pages, current })] });
    assert.equal(readingStatus(valid.books[0]), expected);
  }
  for (const change of [{ current: -1 }, { current: 241 }, { current: 1.5 }, { current: '32' }, { pages: 0 }, { pages: 20001 }, { pages: Infinity }]) {
    assert.throws(() => validateShelf({ ...freshShelf(), books: [book(change)] }));
  }
});

test('collection limits, duplicate IDs and malformed dates are rejected', () => {
  const cases = [
    { ...freshShelf(), books: Array.from({ length: 101 }, (_, i) => book({ id: `book-${i}` })) },
    { ...freshShelf(), links: Array.from({ length: 101 }, (_, i) => link({ id: `link-${i}` })) },
    { ...freshShelf(), moments: Array.from({ length: 201 }, (_, i) => moment({ id: `moment-${i}` })) },
    { ...freshShelf(), books: [book(), book()] },
    { ...freshShelf(), books: [book()], links: [link({ id: 'book-1' })] },
    { ...freshShelf(), books: [book({ title: ' ' })] },
    { ...freshShelf(), books: [book({ author: 'x'.repeat(121) })] },
    { ...freshShelf(), moments: [moment({ text: 'x'.repeat(281) })] },
    { ...freshShelf(), moments: [moment({ createdAt: '2026-02-30T12:00:00Z' })] },
    { ...freshShelf(), links: [link({ createdAt: 'yesterday' })] },
    { ...freshShelf(), pickedMomentId: { malicious: true } },
  ];
  for (const invalid of cases) assert.throws(() => validateShelf(invalid));
  assert.throws(() => validateShelf(null));
  assert.throws(() => validateShelf({ ...freshShelf(), books: {} }));
});

test('missing picked moments are cleared and random picks avoid the immediate previous note', () => {
  const input = { ...freshShelf(), moments: [moment(), moment({ id: 'moment-2' })], pickedMomentId: 'missing' };
  assert.equal(validateShelf(input).pickedMomentId, null);
  assert.equal(pickShelfMoment([], null, () => 0), null);
  assert.equal(pickShelfMoment(input.moments, 'moment-1', () => 0), 'moment-2');
  assert.equal(pickShelfMoment(input.moments, 'moment-2', () => 0.9999), 'moment-1');
  assert.equal(pickShelfMoment([moment()], 'moment-1', () => 1), 'moment-1');
});

test('restore validates before replacing current shelf and snapshots are independent', () => {
  const valid = { ...freshShelf(), books: [book()] };
  restoreShelf(valid);
  const snapshot = getShelf(); snapshot.books[0].current = 100;
  assert.equal(getShelf().books[0].current, 32);
  assert.throws(() => restoreShelf({ ...valid, books: [book({ current: 500 })] }));
  assert.equal(getShelf().books[0].current, 32);
});

function tab(store) {
  const context = vm.createContext({ URL, localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } });
  const source = readFileSync(new URL('../dist/shelf.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
  vm.runInContext(`${source}\nthis.api={getShelf,restoreShelf,change,parse:JSON.parse};`, context);
  return context.api;
}

test('each mutation rereads storage so a second tab preserves newer, unrelated collections', () => {
  const store = new Map(), a = tab(store), b = tab(store);
  a.getShelf(); b.getShelf();
  a.change(state => state.books.push(a.parse(JSON.stringify(book()))));
  b.change(state => state.links.push(b.parse(JSON.stringify(link()))));
  a.change(state => { state.books[0].current = 80; });
  const saved = JSON.parse(store.get('daylight.shelf.v1'));
  assert.equal(saved.books[0].current, 80);
  assert.equal(saved.links[0].title, 'A good find');
});

test('corrupt saved data survives changes until an explicit valid restore', () => {
  const broken = '{a shelf that needs recovery';
  const store = new Map([['daylight.shelf.v1', broken]]), current = tab(store);
  current.getShelf(); current.change(state => state.books.push(current.parse(JSON.stringify(book()))));
  assert.equal(store.get('daylight.shelf.v1'), broken);
  assert.equal(current.getShelf().books.length, 1);
  current.restoreShelf(current.parse(JSON.stringify(freshShelf())));
  assert.equal(JSON.parse(store.get('daylight.shelf.v1')).version, 1);
});

test('restore reports persistence success and keeps restored data usable after a failed save', () => {
  class FallibleStore extends Map {
    fail = false;
    set(key, value) { if (this.fail) throw new Error('Storage quota exceeded'); return super.set(key, value); }
  }
  const store = new FallibleStore(), current = tab(store);
  const first = { ...freshShelf(), books: [book()] };
  assert.equal(current.restoreShelf(current.parse(JSON.stringify(first))), true);
  assert.equal(JSON.parse(store.get('daylight.shelf.v1')).books[0].current, 32);
  store.fail = true;
  const changed = { ...first, books: [book({ current: 120 })] };
  assert.equal(current.restoreShelf(current.parse(JSON.stringify(changed))), false);
  assert.equal(current.getShelf().books[0].current, 120, 'the restored shelf remains available for a backup');
  assert.equal(JSON.parse(store.get('daylight.shelf.v1')).books[0].current, 32, 'the failed write must not be reported as persisted');
});
