import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateCaption, rememberCaption, pickHashtags, previewSeries, spin, parseTemplates, parseHashtags, NICHES, BROAD_HASHTAGS } from '../lib/captions.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const tagsOf = (text) => (text.split('\n\n')[1] || '').split(' ').filter(Boolean);

test('spintax, templates, hashtag parsing', () => {
  assert.equal(spin('{a|b} {c|d}', seq(0, 0.9)), 'a d');
  assert.equal(spin('x {produto} y'), 'x {produto} y');
  assert.equal(spin('{a|{b|c}}', seq(0.9, 0.9)), 'c');
  assert.deepEqual(parseTemplates('um\n---\ndois\n\n----\ntrês'), ['um', 'dois', 'três']);
  assert.deepEqual(parseHashtags('#a, b ##c #a #Casa!'), ['#a', '#b', '#c', '#casa']);
});

test('every niche has enough tags and benefits', () => {
  for (const [k, n] of Object.entries(NICHES)) {
    assert.ok(n.tags.length >= 8, k);
    assert.ok(n.benefits.length >= 5, k);
    for (const t of n.tags) assert.match(t, /^#[a-z0-9]+$/, `${k}: ${t}`);
  }
});

test('5 unique hashtags: 3 do nicho + 2 amplas', () => {
  const p = { displayName: 'Escova Secadora', niche: 'cabelo' };
  for (let i = 0; i < 200; i++) {
    const tags = pickHashtags(p, 5);
    assert.equal(tags.length, 5);
    assert.equal(new Set(tags).size, 5);
    assert.equal(tags.filter((t) => NICHES.cabelo.tags.includes(t)).length, 3);
    assert.equal(tags.filter((t) => BROAD_HASHTAGS.includes(t)).length, 2);
  }
});

test('consecutive posts change only 1–2 hashtags', () => {
  const p = { displayName: 'Organizador', niche: 'casa' };
  let last = pickHashtags(p, 5);
  for (let i = 0; i < 300; i++) {
    const next = pickHashtags(p, 5, last);
    const kept = next.filter((t) => last.includes(t)).length;
    assert.equal(next.length, 5);
    assert.equal(new Set(next).size, 5);
    assert.ok(kept === 3 || kept === 4, `kept ${kept}`);
    assert.equal(next.filter((t) => BROAD_HASHTAGS.includes(t)).length, 2);
    last = next;
  }
});

test('custom hashtags are used as the niche pool', () => {
  const p = { displayName: 'X', niche: 'casa', hashtags: '#um #dois #tres #quatro' };
  const tags = pickHashtags(p, 5);
  assert.equal(tags.filter((t) => ['#um', '#dois', '#tres', '#quatro'].includes(t)).length, 3);
});

test('captions vary, mention product, no repeats in a long series', () => {
  const p = { displayName: 'Fone Bluetooth X', niche: 'eletronicos', benefits: 'bateria de 30 horas\ncancelamento de ruído' };
  const series = previewSeries(p, { hashtagsCount: 5 }, 40);
  const bodies = series.map((s) => s.body);
  assert.equal(new Set(bodies).size, 40, 'all 40 captions different');
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    assert.match(s.body, /Fone Bluetooth X/);
    assert.match(s.body, /carrinho/i);
    assert.equal(tagsOf(s.text).length, 5);
    assert.ok(!/\{|\}/.test(s.text), 'no leftover braces: ' + s.text);
    assert.ok(!/undefined|null/.test(s.text));
    if (i > 0) {
      assert.notEqual(s.hook, series[i - 1].hook, 'hook changes every post');
      const kept = s.hashtags.filter((t) => series[i - 1].hashtags.includes(t)).length;
      assert.ok(kept >= 3 && kept <= 4);
    }
  }
  assert.ok(bodies.some((b) => /bateria de 30 horas|cancelamento de ruído/i.test(b)), 'uses own benefits');
});

test('sidecar text wins; keeps its own hashtags', () => {
  const p = { displayName: 'X', niche: 'geral' };
  assert.equal(generateCaption(p, {}, { sidecarText: 'Meu texto #proprio' }).text, 'Meu texto #proprio');
  const r = generateCaption(p, { hashtagsCount: 5 }, { sidecarText: 'Texto do {produto}' });
  assert.match(r.text, /^Texto do X\n\n/);
  assert.equal(r.hashtags.length, 5);
});

test('custom templates are used and resolved', () => {
  const p = { displayName: 'Garrafa', captions: 'Compre {produto} {já|agora}\n---\n{produto} é demais', niche: 'fitness' };
  for (let i = 0; i < 30; i++) {
    const r = generateCaption(p, { hashtagsCount: 5 });
    assert.match(r.body, /^(Compre Garrafa (já|agora)|Garrafa é demais)$/);
  }
});

test('rememberCaption keeps last 20', () => {
  let p = { displayName: 'X' };
  for (let i = 0; i < 30; i++) p = { ...p, ...rememberCaption(p, { text: 't' + i, body: 'b' + i, hashtags: ['#a'], hook: 'h' }) };
  assert.equal(p.recentCaptions.length, 20);
  assert.equal(p.recentCaptions[0], 'b29');
  assert.equal(p.lastCaption, 't29');
});

test('0 hashtags setting works', () => {
  const r = generateCaption({ displayName: 'X' }, { hashtagsCount: 0 });
  assert.ok(!r.text.includes('#'));
});

test('placeholders com acento/maiúscula, desconhecidos removidos, "$" literal, spintax nos benefícios', () => {
  const p = { displayName: 'Fone X', benefits: 'som {alto|forte}\nR$& barato' };
  for (let i = 0; i < 50; i++) {
    const r = generateCaption(p, { hashtagsCount: 5 }, { sidecarText: '{Produto} — {benefício} {preco}!' });
    assert.ok(!/[{}]/.test(r.text), r.text);
    assert.match(r.body, /^Fone X — (som (alto|forte)|R\$& barato)!$/);
  }
  for (let i = 0; i < 50; i++) {
    const r = generateCaption(p, { hashtagsCount: 5 });
    assert.ok(!/[{}]/.test(r.text), r.text);
    assert.ok(!/r\{|\$`/.test(r.text), r.text);
  }
});

test('"#1" no nome não conta como hashtag; texto com hashtag ganha só as que faltam', () => {
  const r = generateCaption({ displayName: 'Produto #1 de vendas' }, { hashtagsCount: 5 });
  assert.equal(r.text.split('\n\n')[1].split(' ').length, 5);
  const t = generateCaption({ displayName: 'X', captions: 'Compre {produto} #minhatag' }, { hashtagsCount: 5 });
  const tags = t.text.match(/#\p{L}[\p{L}\p{N}_]*/gu);
  assert.equal(tags.length, 5);
  assert.equal(new Set(tags).size, 5);
});

test('siglas e marcas mantêm maiúsculas', () => {
  const p = { displayName: 'Luminária', benefits: 'LED colorido\niPhone compatível' };
  const bodies = previewSeries(p, { hashtagsCount: 5 }, 30).map((s) => s.body).join(' ');
  assert.ok(!/\blED\b/.test(bodies));
  assert.ok(bodies.includes('LED') || bodies.includes('iPhone'));
});
