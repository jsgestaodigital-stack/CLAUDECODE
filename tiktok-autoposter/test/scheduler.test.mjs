import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeNextRun, isWithinActiveHours, pickNext, previewQueue, mergeScan, countPostedToday, isLinkReady, productKeyOf, migrate, newCatalogKey } from '../lib/scheduler.js';
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
  catalog: {
    A: { key: 'A', displayName: 'A', configured: true, productId: '111111' },
    B: { key: 'B', displayName: 'B', configured: true, productQuery: 'Produto B' },
    C: { key: 'C', displayName: 'C', enabled: false, configured: true, productId: '333333' },
    D: { key: 'D', displayName: 'D', configured: false },
  },
  folders: {
    a: { folder: 'a', catalogKey: 'A' },
    b: { folder: 'b', catalogKey: 'B' },
    c: { folder: 'c', catalogKey: 'C' },
    d: { folder: 'd', catalogKey: 'D' },
    e: { folder: 'e', catalogKey: null },
  },
  videos: {
    'a/1.mp4': { path: 'a/1.mp4', folder: 'a', status: 'pending' },
    'a/2.mp4': { path: 'a/2.mp4', folder: 'a', status: 'pending' },
    'a/10.mp4': { path: 'a/10.mp4', folder: 'a', status: 'pending' },
    'b/1.mp4': { path: 'b/1.mp4', folder: 'b', status: 'posted' },
    'b/2.mp4': { path: 'b/2.mp4', folder: 'b', status: 'pending' },
    'c/1.mp4': { path: 'c/1.mp4', folder: 'c', status: 'pending' },
    'd/1.mp4': { path: 'd/1.mp4', folder: 'd', status: 'pending' },
    'e/1.mp4': { path: 'e/1.mp4', folder: 'e', status: 'pending' },
  },
  runtime: { lastProduct: 'A' },
});

test('pickNext: rodízio por produto do catálogo, ignora pausados/sem link/sem produto, ordem natural', () => {
  const st = mkState();
  assert.equal(pickNext(st).video.path, 'b/2.mp4');
  const q = previewQueue(st, 10).map((x) => x.video.path);
  assert.deepEqual(q, ['b/2.mp4', 'a/1.mp4', 'a/2.mp4', 'a/10.mp4']);
  assert.ok(isLinkReady(st.catalog.A) && isLinkReady(st.catalog.B) && !isLinkReady(st.catalog.D));
});

test('produto próprio do vídeo tem prioridade sobre o da pasta', () => {
  const st = mkState();
  st.videos['e/1.mp4'].catalogKey = 'B';      // pasta sem produto, vídeo com produto B
  st.videos['a/2.mp4'].catalogKey = 'B';      // vídeo da pasta A usando o produto B
  assert.equal(productKeyOf(st, st.videos['e/1.mp4']), 'B');
  assert.equal(productKeyOf(st, st.videos['a/2.mp4']), 'B');
  assert.equal(productKeyOf(st, st.videos['a/1.mp4']), 'A');
  const q = previewQueue(st, 10);
  const byB = q.filter((x) => x.product === 'B').map((x) => x.video.path).sort();
  assert.deepEqual(byB, ['a/2.mp4', 'b/2.mp4', 'e/1.mp4']);
  for (let i = 1; i < q.length; i++) if (q.filter((x) => x.product === 'A').length && q.filter((x) => x.product === 'B').length > 1) break;
  // produto removido do catálogo → vídeo volta a usar o da pasta
  delete st.catalog.B;
  assert.equal(productKeyOf(st, st.videos['a/2.mp4']), 'A');
  assert.equal(productKeyOf(st, st.videos['e/1.mp4']), null);
});

test('duas pastas com o mesmo produto: não repete o produto em seguida', () => {
  const st = mkState();
  st.folders.e.catalogKey = 'A';
  st.videos['e/2.mp4'] = { path: 'e/2.mp4', folder: 'e', status: 'pending' };
  const prods = previewQueue(st, 10).map((x) => x.product);
  for (let i = 1; i < prods.length; i++) {
    const rest = new Set(prods.slice(i));
    if (rest.size > 1) assert.notEqual(prods[i], prods[i - 1], prods.join(','));
  }
});

test('linkProduct desligado: produto sem link entra, sem produto não', () => {
  const st = mkState();
  const off = previewQueue({ ...st, settings: { ...DEFAULT_SETTINGS, linkProduct: false } }, 20).map((x) => x.product);
  assert.ok(off.includes('D') && !off.includes('C'));
  assert.ok(!previewQueue({ ...st, settings: { ...DEFAULT_SETTINGS, linkProduct: false } }, 20).some((x) => x.video.path === 'e/1.mp4'));
});

test('pickNext returns null when nothing pending', () => {
  const st = mkState();
  for (const v of Object.values(st.videos)) v.status = 'posted';
  assert.equal(pickNext(st), null);
});

test('mergeScan: cria pastas sem produto, marca sumidos, mantém publicados', () => {
  const st = mkState();
  const r = mergeScan(st, [
    { path: 'a/1.mp4', product: 'a', name: '1.mp4', size: 1 },
    { path: 'novo-produto/x.mp4', product: 'novo-produto', name: 'x.mp4', size: 2 },
  ]);
  assert.equal(r.added, 1);
  assert.equal(r.folders['novo-produto'].catalogKey, null);
  assert.equal(r.folders.a.catalogKey, 'A');
  assert.equal(r.videos['novo-produto/x.mp4'].folder, 'novo-produto');
  assert.equal(r.videos['a/2.mp4'].status, 'missing');
  assert.equal(r.videos['b/1.mp4'].status, 'posted');
  assert.equal(r.videos['b/1.mp4'].gone, true);
  const r2 = mergeScan({ ...st, videos: r.videos, folders: r.folders }, [{ path: 'a/2.mp4', product: 'a', name: '2.mp4' }]);
  assert.equal(r2.videos['a/2.mp4'].status, 'pending');
});

test('migração da versão antiga (produto por pasta)', () => {
  const old = {
    products: {
      'fone-x': { folder: 'fone-x', displayName: 'Fone X', productUrl: 'https://www.tiktok.com/view/product/1234567', productId: '1234567', configured: true, niche: 'eletronicos', recentCaptions: ['a'], enabled: true },
      'sem-nada': { folder: 'sem-nada', displayName: 'Sem nada', niche: 'geral', configured: false },
    },
    videos: { 'fone-x/1.mp4': { path: 'fone-x/1.mp4', product: 'fone-x', status: 'pending' } },
    runtime: { lastProduct: 'fone-x' },
  };
  const { changed, state } = migrate(old);
  assert.ok(changed);
  const key = state.folders['fone-x'].catalogKey;
  assert.equal(key, 'id_1234567');
  assert.equal(state.catalog[key].displayName, 'Fone X');
  assert.equal(state.catalog[key].niche, 'eletronicos');
  assert.deepEqual(state.catalog[key].recentCaptions, ['a']);
  assert.equal(state.folders['sem-nada'].catalogKey, null);
  assert.equal(Object.keys(state.catalog).length, 1);
  assert.equal(state.videos['fone-x/1.mp4'].folder, 'fone-x');
  assert.equal(state.runtime.lastProduct, key);
  assert.equal(pickNext({ ...state, settings: DEFAULT_SETTINGS }).video.path, 'fone-x/1.mp4');
  assert.equal(migrate(state).changed, false);
  assert.equal(newCatalogKey({ productId: '987654' }), 'id_987654');
  assert.match(newCatalogKey({}), /^p_/);
});

test('countPostedToday', () => {
  const now = new Date(2026, 0, 2, 12).getTime();
  const h = [{ status: 'posted', ts: now - 3600e3 }, { status: 'failed', ts: now }, { status: 'posted', ts: now - 86400e3 }];
  assert.equal(countPostedToday(h, now), 1);
});

test('ordem inteligente: alterna gancho, corpo e CTA (G#C#A#)', async () => {
  const { variantOf } = await import('../lib/scheduler.js');
  assert.deepEqual(variantOf('LENÇOL/LENCOL_G1C2A1_1711_179.mp4'), { g: 1, c: 2, a: 1 });
  assert.equal(variantOf('a/video-01.mp4'), null);
  const videos = {};
  for (const g of [1, 2, 3, 4]) for (const c of [1, 2, 3]) for (const a of [1, 2]) {
    const p = `l/LENCOL_G${g}C${c}A${a}_1711.mp4`;
    videos[p] = { path: p, folder: 'l', status: 'pending' };
  }
  const st = {
    settings: { ...DEFAULT_SETTINGS, videoOrder: 'smart' }, runtime: {},
    catalog: { L: { key: 'L', configured: true, productId: '123456' } },
    folders: { l: { folder: 'l', catalogKey: 'L' } }, videos,
  };
  const q = previewQueue(st, 24).map((x) => variantOf(x.video.path));
  assert.equal(q.length, 24);
  for (let i = 1; i < q.length; i++) assert.notEqual(q[i].g, q[i - 1].g, `gancho repetido em seguida na posição ${i}`);
  // os 4 primeiros usam os 4 ganchos diferentes
  assert.equal(new Set(q.slice(0, 4).map((x) => x.g)).size, 4);
  // continua espalhando considerando o que já foi postado
  videos['l/LENCOL_G1C1A1_1711.mp4'].status = 'posted';
  videos['l/LENCOL_G1C1A1_1711.mp4'].postedAt = 1;
  assert.notEqual(variantOf(pickNext(st).video.path).g, 1);
});

// ---------- modo agendamento ----------
import { nextSlot, parseSessionTimes, computeNextSession, sessionHorizon, sessionLoad, countForDay } from '../lib/scheduler.js';

const SCH = { intervalMinutes: 60, jitterMinutes: 0, activeStartHour: 8, activeEndHour: 23, maxPerDay: 4, sessionTimes: '09:00, 14:00, 20:00', sessionJitterMinutes: 0 };
const at = (h, m = 0, d = 19) => new Date(2026, 10, d, h, m).getTime();

test('parseSessionTimes aceita formatos variados e ordena', () => {
  assert.deepEqual(parseSessionTimes('20:30, 9h; 14 ,9:00, 25:00, xx'), [{ h: 9, m: 0 }, { h: 14, m: 0 }, { h: 20, m: 30 }]);
});

test('nextSlot: múltiplos de 5 min, pelo menos 20 min no futuro, intervalo respeitado', () => {
  const now = at(14, 7);
  const a = nextSlot({ lastSlotAt: null, now, settings: SCH, history: [] });
  assert.ok(a >= now + 20 * 60000);
  assert.equal(new Date(a).getMinutes() % 5, 0);
  const b = nextSlot({ lastSlotAt: a, now, settings: SCH, history: [] });
  assert.equal(b - a, 60 * 60000);
});

test('nextSlot: fora da faixa de horário pula para a manhã seguinte', () => {
  const s = nextSlot({ lastSlotAt: at(22, 30), now: at(20), settings: SCH, history: [] });
  assert.equal(new Date(s).getDate(), 20);
  assert.equal(new Date(s).getHours(), 8);
});

test('nextSlot: limite por dia conta pelo dia de publicação', () => {
  const history = [10, 11, 12, 13].map((h) => ({ status: 'scheduled', publishAt: at(h), ts: at(9) }));
  assert.equal(countForDay(history, at(15)), 4);
  const s = nextSlot({ lastSlotAt: at(13), now: at(9), settings: SCH, history });
  assert.equal(new Date(s).getDate(), 20);
});

test('sessões: próxima sessão e horizonte até a sessão seguinte + folga', () => {
  assert.equal(computeNextSession(at(10), SCH), at(14));
  assert.equal(computeNextSession(at(21), SCH), at(9, 0, 20));
  assert.equal(sessionHorizon(at(14, 5), SCH), at(21, 30));
  const load = sessionLoad({ ...SCH, maxPerDay: 99 });
  assert.deepEqual(load.sessions.map((x) => x.needed), [5, 6, 4]);
});
