import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractProductId, resolveProductLink, isShortLink, extractTitle } from '../lib/productlink.js';

const ID = '1729384756123456789';

test('extrai o ID de vários formatos de link', () => {
  const cases = [
    ID,
    ` ${ID} `,
    `https://www.tiktok.com/view/product/${ID}?region=BR&locale=pt-BR`,
    `https://shop.tiktok.com/view/product/${ID}`,
    `https://shop.tiktok.com/br/pdp/escova-secadora-3-em-1/${ID}`,
    `https://www.tiktok.com/shop/pdp/${ID}?source=x`,
    `https://affiliate.tiktok.com/something?product_id=${ID}&x=1`,
    `Confira este produto: https://www.tiktok.com/view/product/${ID}?u_code=abc veja`,
    `https://www.tiktok.com/view/product/${ID}/`,
  ];
  for (const c of cases) assert.equal(extractProductId(c), ID, c);
});

test('não inventa ID', () => {
  for (const c of ['', 'escova secadora', 'https://vt.tiktok.com/ZSabc123/', 'https://www.tiktok.com/@loja/video/12345', '12345']) {
    assert.equal(extractProductId(c), null, c);
  }
});

test('link curto: segue o redirecionamento', async () => {
  assert.ok(isShortLink('https://vt.tiktok.com/ZSabc123/'));
  const fake = async (url) => ({ url: `https://www.tiktok.com/view/product/${ID}?_r=1`, text: async () => '' });
  const r = await resolveProductLink('https://vt.tiktok.com/ZSabc123/', fake);
  assert.equal(r.id, ID);
  assert.equal(r.via, 'redirect');
});

test('link curto: lê o ID de dentro da página quando o endereço final não tem', async () => {
  const fake = async () => ({ url: 'https://www.tiktok.com/xyz', text: async () => `<script>{"product_id":"${ID}"}</script>` });
  const r = await resolveProductLink('https://vm.tiktok.com/ZMabc/', fake);
  assert.equal(r.id, ID);
});

test('erros claros', async () => {
  assert.match((await resolveProductLink('')).error, /Cole/);
  assert.match((await resolveProductLink('https://mercadolivre.com.br/x')).error, /TikTok/);
  const fail = async () => { throw new Error('offline'); };
  assert.match((await resolveProductLink('https://vt.tiktok.com/ZS1/', fail)).error, /offline/);
  const none = async () => ({ url: 'https://www.tiktok.com/', text: async () => '<html></html>' });
  assert.match((await resolveProductLink('https://vt.tiktok.com/ZS1/', none)).error, /não achei o ID/);
});

test('lê o nome do produto da página', async () => {
  assert.equal(extractTitle('<meta property="og:title" content="Escova Secadora 3 em 1 &amp; Modeladora - TikTok Shop">'), 'Escova Secadora 3 em 1 & Modeladora');
  assert.equal(extractTitle('<title>Fone Bluetooth X | TikTok</title>'), 'Fone Bluetooth X');
  assert.equal(extractTitle('<title>TikTok - Make Your Day</title>'), null);
  const fake = async () => ({ url: `https://www.tiktok.com/view/product/${ID}`, text: async () => '<title>Kit Organizador 6 peças | TikTok Shop</title>' });
  const r = await resolveProductLink(`https://www.tiktok.com/view/product/${ID}`, fake, { wantTitle: true });
  assert.equal(r.id, ID);
  assert.equal(r.title, 'Kit Organizador 6 peças');
  const r2 = await resolveProductLink('https://vt.tiktok.com/ZS1/', fake);
  assert.equal(r2.title, 'Kit Organizador 6 peças');
});
