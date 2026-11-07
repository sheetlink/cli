// End to end: the real CLI against a mock SheetLink API (no network, no real banks).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ITEMS } from './fixtures.js';

const run = promisify(execFile);
const CLI = new URL('../src/index.js', import.meta.url).pathname;

let server, url;
const state = { items: [], busy: new Set(), calls: [] };

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && req.url === '/api/items') {
        return json(200, { items: state.items.map(i => ({ item_id: i.item_id, institution_name: i.institution_name, accounts: i.accounts, account_filter: { excluded: [] } })) });
      }
      if (req.method === 'POST' && req.url === '/api/sync') {
        const b = JSON.parse(body);
        state.calls.push(b);
        if (state.busy.has(b.item_id)) return json(409, { detail: 'A sync for this item is already in progress' });
        const item = state.items.find(i => i.item_id === b.item_id);
        return json(200, { accounts: item.accounts, transactions: item.transactions, tier: 'max', days_available: 730 });
      }
      json(404, { detail: 'not found' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function reset(items = ITEMS) {
  state.items = structuredClone(items);
  state.busy = new Set();
  state.calls = [];
}

async function cli(args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sheetlink-home-'));
  const env = { ...process.env, HOME: home, SHEETLINK_API_KEY: 'sl_test', SHEETLINK_API_URL: url };
  delete env.SHEETLINK_OUTPUT;
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, 'sync', ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sheetlink-out-'));

test('SQLite: first run pulls the full window, the next pulls since the last stored date minus 30 days', async () => {
  reset();
  const db = `sqlite://${path.join(tmpdir(), 'f.db')}`;
  const first = await cli(['--output', db]);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(state.calls.map(c => c.start_date ?? null), [null, null]);

  state.calls = [];
  const second = await cli(['--output', db]);
  assert.equal(second.code, 0, second.stderr);
  // Chase: checking's latest is 10-01 (older than the card's 10-06), so 10-01 minus 30 days.
  assert.deepEqual(Object.fromEntries(state.calls.map(c => [c.item_id, c.start_date])),
    { 'item-chase': '2026-09-01', 'item-ally': '2026-09-02' });
  assert.match(second.stderr, /last stored date minus 30 days/);

  state.calls = [];
  await cli(['--output', db, '--full']);
  assert.deepEqual(state.calls.map(c => c.start_date ?? null), [null, null]);

  state.calls = [];
  await cli(['--output', db, '--from', '2026-10-04']);
  assert.deepEqual(state.calls.map(c => c.start_date), ['2026-10-04', '2026-10-04']);
});

test('SQLite: a bank with an account that has nothing stored yet gets the full window', async () => {
  reset();
  const db = `sqlite://${path.join(tmpdir(), 'f.db')}`;
  await cli(['--output', db]);
  state.items[0].accounts.push({ account_id: 'acc-new-savings', name: 'Business Savings', mask: '7751', type: 'depository' });
  state.calls = [];
  await cli(['--output', db]);
  assert.deepEqual(Object.fromEntries(state.calls.map(c => [c.item_id, c.start_date ?? null])),
    { 'item-chase': null, 'item-ally': '2026-09-02' });
});

test('JSON and CSV still pull the full window every run', async () => {
  reset();
  await cli(['--output', 'json']);
  await cli(['--output', 'csv', '--file', path.join(tmpdir(), 't.csv')]);
  assert.ok(state.calls.every(c => c.start_date === undefined));
});

test('a bank already syncing in another run is skipped, and the rest is written', async () => {
  reset();
  state.busy.add('item-ally');
  const db = path.join(tmpdir(), 'f.db');
  const r = await cli(['--output', `sqlite://${db}`]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /Ally Bank: already syncing in another run \(skipped\)/);
  assert.doesNotMatch(r.stderr, /API error/);
  assert.ok(fs.existsSync(db));
});

test('every bank already syncing: nothing to do, exit 0', async () => {
  reset();
  state.busy = new Set(['item-chase', 'item-ally']);
  const r = await cli(['--output', 'json']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /Nothing to do this time/);
});

test('Beancount: a second run appends nothing', async () => {
  reset();
  const file = path.join(tmpdir(), 'bank.beancount');
  const a = await cli(['--output', 'beancount', '--file', file]);
  assert.equal(a.code, 0, a.stderr);
  assert.match(a.stderr, /4 new transactions appended/);
  const before = fs.readFileSync(file, 'utf8');
  const b = await cli(['--output', 'beancount', '--file', file]);
  assert.match(b.stderr, /0 new transactions appended \(4 already there\)/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a bad --account-map path exits with a clear message', async () => {
  reset();
  const r = await cli(['--output', 'beancount', '--file', path.join(tmpdir(), 'b.beancount'), '--account-map', '/nope/map.json']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Couldn't read --account-map/);
});
