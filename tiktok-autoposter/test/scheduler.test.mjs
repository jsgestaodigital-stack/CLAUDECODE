import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeNextRun, isWithinActiveHours, pickNext, previewQueue, mergeScan, countPostedToday, isLinkReady } from '../lib/scheduler.js';
import { DEFAULT_SETTINGS } from '../lib/defaults.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('active hours', () => {
  const d = (h) => new Date(2026, 0, 1, h, 30);
  assert.ok(isWithinActiveHours(d(3), 0, 24));
  assert.ok(isWithinActiveHours(d(9), 8, 23));
  assert.ok(!isWithinActiveHours(d(23), 8, 23));
  assert.ok(isWithinActiveHours(d(1), 18, 2));
  assert.ok(!isWithinActiveHours(d(10), 18, 2));
});

test('next run = interval ± jitter, capped jitter', () => {
  const s = { ...DEFAULT_SETTINGS, intervalMinutes: 60, jitterMinutes: 8, activeStartHour: 0, activeEndHour: 24 };
  const base = new Date(2026, 0, 1, 10, 0).getTime();
  assert.equal(computeNextRun(base, s, () => 0.5), base + 60 * 60000);
  assert.equal(computeNextRun(base, s, () => 0), base + 52 * 60000);
  assert.equal(computeNextRun(base, s, () => 1), base + 68 * 60000);
  const s5 = { ...s, intervalMinutes: 5 };
  const r = computeNextRun(base, s5, () => 0);
  assert.ok(r >= base + 2 * 60000 && r <= base + 5 * 60000);
});

test('next run jumps to start of active window', () => {
  const s = { ...DEFAULT_SETTINGS, intervalMinutes: 60, jitterMinutes: 0, activeStartHour: 8, activeEndHour: 22 };
  const base = new Date(2026, 0, 1, 21, 30).getTime();
  const r = new Date(computeNextRun(base, s, () => 0.5));
  assert.equal(r.getDate(), 2); assert.equal(r.getHours(), 8);
});

const mkState = () => ({
  settings: DEFAULT_SETTINGS,
  products: {
    a: { folder: 'a', displayName: 'A', configured: true, productQuery: '111' },
    b: { folder: 'b', displayName: 'B', configured: true, productQuery: '222' },
    c: { folder: 'c', displayName: 'C', enabled: false, configured: true, productQuery: '333' },
    d: { folder: 'd', displayName: 'D', configured: false, productQuery: '' },
  },
  videos: {
    'a/1.mp4': { path: 'a/1.mp4', product: 'a', status: 'pending' },
    'a/2.mp4': { path: 'a/2.mp4', product: 'a', status: 'pending' },
    'a/10.mp4': { path: 'a/10.mp4', product: 'a', status: 'pending' },
    'b/1.mp4': { path: 'b/1.mp4', product: 'b', status: 'posted' },
    'b/2.mp4': { path: 'b/2.mp4', product: 'b', status: 'pending' },
    'c/1.mp4': { path: 'c/1.mp4', product: 'c', status: 'pending' },
    'd/1.mp4': { path: 'd/1.mp4', product: 'd', status: 'pending' },
  },
  runtime: { lastProduct: 'a' },
});

test('pickNext rotates products, skips disabled, natural sort', () => {
  const st = mkState();
  assert.equal(pickNext(st).video.path, 'b/2.mp4');
  const q = previewQueue(st, 10).map((x) => x.video.path);
  assert.deepEqual(q, ['b/2.mp4', 'a/1.mp4', 'a/2.mp4', 'a/10.mp4']);
});

test('products without a configured link are never picked (unless linking is off)', () => {
  const st = mkState();
  const all = previewQueue(st, 20).map((x) => x.product);
  assert.ok(!all.includes('d'));
  assert.ok(isLinkReady(st.products.a) && !isLinkReady(st.products.d));
  const off = previewQueue({ ...st, settings: { ...DEFAULT_SETTINGS, linkProduct: false } }, 20).map((x) => x.product);
  assert.ok(off.includes('d') && !off.includes('c'));
});

test('pickNext returns null when nothing pending', () => {
  const st = mkState();
  for (const v of Object.values(st.videos)) v.status = 'posted';
  assert.equal(pickNext(st), null);
});

test('mergeScan creates products, marks missing, keeps posted', () => {
  const st = mkState();
  const r = mergeScan(st, [
    { path: 'a/1.mp4', product: 'a', name: '1.mp4', size: 1 },
    { path: 'novo-produto/x.mp4', product: 'novo-produto', name: 'x.mp4', size: 2 },
  ]);
  assert.equal(r.added, 1);
  assert.equal(r.products['novo-produto'].displayName, 'Novo produto');
  assert.equal(r.products['novo-produto'].configured, false);
  assert.equal(r.videos['a/2.mp4'].status, 'missing');
  assert.equal(r.videos['b/1.mp4'].status, 'posted');
  const r2 = mergeScan({ ...st, videos: r.videos, products: r.products }, [{ path: 'a/2.mp4', product: 'a', name: '2.mp4' }]);
  assert.equal(r2.videos['a/2.mp4'].status, 'pending');
});

test('countPostedToday', () => {
  const now = new Date(2026, 0, 2, 12).getTime();
  const h = [{ status: 'posted', ts: now - 3600e3 }, { status: 'failed', ts: now }, { status: 'posted', ts: now - 86400e3 }];
  assert.equal(countPostedToday(h, now), 1);
});
