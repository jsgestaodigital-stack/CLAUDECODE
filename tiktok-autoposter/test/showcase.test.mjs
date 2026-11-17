import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeShowcase } from '../lib/showcase.js';
import { guessNiche, shortProductName } from '../lib/captions.js';
import { mergeLabels, DEFAULT_LABELS, DEFAULT_SETTINGS } from '../lib/defaults.js';
import { productBlocked, pickNext } from '../lib/scheduler.js';

const ITEMS = [
  { id: '1736378523664746282', name: 'Lençol + 2 Fronhas Casal|Queen|King e Solteiro +10 cores', price: 'R$ 18,10', stock: 233200, status: 'ativo' },
  { id: '1733607714192197160', name: 'Kit Lençol Cama Solteiro Casal Queen King 400 fios Micropercal', price: 'R$ 4,80', stock: 0, status: 'indisponivel' },
  { id: '1734624264740242575', name: 'Microfone Lapela Hollyland Lark A1 Combo Preto P/ iPhone e Android', price: 'R$ 349,13', stock: 2120, status: 'ativo' },
  { id: '1736199166294721746', name: 'DUNA Vestido Branco Boêmio, Sem Alças, Adequado para Férias', price: 'R$ 107,60', stock: 540, status: 'ativo' },
];

test('importar vitrine: cria produtos com ID, nome curto, nicho e situação', () => {
  const catalog = {};
  const r = mergeShowcase(catalog, ITEMS, 1000);
  assert.deepEqual(r, { added: 4, updated: 0 });
  const lencol = catalog.id_1736378523664746282;
  assert.equal(lencol.productId, '1736378523664746282');
  assert.equal(lencol.displayName, 'Lençol');
  assert.equal(lencol.niche, 'casa');
  assert.equal(lencol.configured, true);
  assert.equal(lencol.unavailable, false);
  assert.equal(lencol.showcase.price, 'R$ 18,10');
  assert.ok(lencol.productLabel.length <= 30);
  assert.equal(catalog.id_1733607714192197160.unavailable, true);
  assert.equal(catalog.id_1734624264740242575.niche, 'eletronicos');
  assert.equal(catalog.id_1736199166294721746.niche, 'moda');
  assert.equal(catalog.id_1736199166294721746.displayName, 'DUNA Vestido Branco Boêmio');
});

test('importar de novo: atualiza situação sem apagar o que você configurou', () => {
  const catalog = { mine: { key: 'mine', displayName: 'Meu lençol', productId: '1736378523664746282', niche: 'casa', benefits: 'macio', enabled: true, configured: true } };
  const r = mergeShowcase(catalog, [{ ...ITEMS[0], status: 'indisponivel', stock: 0 }], 2000);
  assert.deepEqual(r, { added: 0, updated: 1 });
  assert.equal(catalog.mine.displayName, 'Meu lençol');
  assert.equal(catalog.mine.benefits, 'macio');
  assert.equal(catalog.mine.unavailable, true);
  mergeShowcase(catalog, [ITEMS[0]], 3000);
  assert.equal(catalog.mine.unavailable, false);
  assert.equal(Object.keys(catalog).length, 1);
});

test('produto indisponível sai da fila (com vínculo de produto ligado)', () => {
  const item = { key: 'A', configured: true, productId: '123456', unavailable: true };
  assert.ok(productBlocked(item, DEFAULT_SETTINGS));
  assert.ok(!productBlocked({ ...item, unavailable: false }, DEFAULT_SETTINGS));
  const st = {
    settings: DEFAULT_SETTINGS, runtime: {},
    catalog: { A: item, B: { key: 'B', configured: true, productId: '654321' } },
    folders: { a: { folder: 'a', catalogKey: 'A' }, b: { folder: 'b', catalogKey: 'B' } },
    videos: { 'a/1.mp4': { path: 'a/1.mp4', folder: 'a', status: 'pending' }, 'b/1.mp4': { path: 'b/1.mp4', folder: 'b', status: 'pending' } },
  };
  assert.equal(pickNext(st).video.path, 'b/1.mp4');
});

test('palpite de nicho e nome curto', () => {
  assert.equal(guessNiche('Escova Secadora Rotativa 3 em 1'), 'cabelo');
  assert.equal(guessNiche('KIT 2 Softbox Luz contínua 50x70cm'), 'eletronicos');
  assert.equal(guessNiche('Panela de Pressão Elétrica'), 'cozinha');
  assert.equal(guessNiche('Coisa aleatória'), 'geral');
  assert.equal(shortProductName('Conjunto Feminino Pantalona com Top Peplum Assimétrico Elegante'), 'Conjunto Feminino Pantalona com Top Peplum');
  assert.ok(shortProductName('x'.repeat(100)).length <= 48);
});

test('textos dos botões: novos padrões (ex.: "seguinte") não somem por causa de configuração antiga', () => {
  const oldSaved = { ...DEFAULT_LABELS, next: ['proximo', 'avancar', 'next'], custom: ['meu botao'] };
  const m = mergeLabels(oldSaved);
  assert.ok(m.next.includes('seguinte'));
  assert.ok(m.next.includes('proximo'));
  assert.deepEqual(m.custom, ['meu botao']);
  assert.ok(m.cancel.includes('cancelar'));
  assert.equal(new Set(m.next).size, m.next.length);
});
