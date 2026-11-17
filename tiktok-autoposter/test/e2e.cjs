// Teste ponta a ponta: carrega a extensão num Chromium, conecta uma pasta de vídeos de teste
// pelo próprio painel e faz postagens completas contra uma simulação do TikTok Studio.
// Uso: xvfb-run -a node test/e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const EXT = path.resolve(__dirname, '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-studio.html'), 'utf8');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// Servidor HTTPS local que responde no lugar de www.tiktok.com (o Chromium é apontado para ele).
let pageBody = MOCK;
const telegram = [];
function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttap-cert-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=www.tiktok.com 2>/dev/null`);
  const srv = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    if (host === 'vt.tiktok.com') { // link curto de compartilhamento → redireciona para o produto
      res.writeHead(302, { location: 'https://www.tiktok.com/view/product/1729384756999?region=BR' });
      return res.end();
    }
    if (host === 'api.telegram.org') { // API do Telegram simulada
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        telegram.push({ path: req.url, body: body ? JSON.parse(body) : null });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.url.endsWith('/getUpdates')
          ? { ok: true, result: [{ message: { chat: { id: 4242, first_name: 'Teste' }, text: 'oi' } }] }
          : { ok: true, result: {} }));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url.startsWith('/view/product/')) { // página do produto (para ler o nome)
      const id = req.url.split('/')[3].split('?')[0];
      return res.end(`<html><head><meta property="og:title" content="Produto Teste ${id} - TikTok Shop"></head><body></body></html>`);
    }
    res.end(pageBody);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

let passed = 0;
function assert(cond, msg) { if (!cond) throw new Error('FALHOU: ' + msg); passed++; console.log('  ✓', msg); }
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  let r;
  const srv = await startServer();
  const port = srv.address().port;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttap-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-proxy-server',
      `--host-resolver-rules=MAP www.tiktok.com:443 127.0.0.1:${port}, MAP vt.tiktok.com:443 127.0.0.1:${port}, MAP api.telegram.org:443 127.0.0.1:${port}`, '--ignore-certificate-errors'],
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];
  console.log('Extensão carregada:', extId);

  const dash = await ctx.newPage();
  dash.on('pageerror', (e) => errors.push('painel: ' + e.message));
  dash.on('console', (m) => m.type() === 'error' && errors.push('painel console: ' + m.text()));
  dash.on('dialog', (d) => d.accept());
  await dash.goto(`chrome-extension://${extId}/dashboard/index.html`);
  await dash.waitForSelector('#btnToggle');

  const get = (keys) => dash.evaluate((k) => chrome.storage.local.get(k), keys);
  const cmd = (name, payload) => dash.evaluate(([n, p]) => chrome.runtime.sendMessage({ type: 'cmd', name: n, payload: p }), [name, payload]);
  const waitHistory = async (pred, ms = 150000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const { history = [] } = await get(['history']);
      const h = history.find(pred);
      if (h) return h;
      await sleep(800);
    }
    throw new Error('tempo esgotado esperando o histórico');
  };
  const nextTikTokPage = () => ctx.waitForEvent('page', { timeout: 30000 });

  console.log('0) Visual inicial (tema escuro padrão)');
  assert((await dash.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'tema escuro por padrão');
  assert(await dash.isVisible('#setupCard'), 'mostra a configuração em 4 passos');
  await dash.screenshot({ path: path.join(SHOTS, '01-inicio.png') });

  console.log('1) Conectar a pasta pelo botão do painel');
  const VIDEO_BYTES = 9 * 1024 * 1024 + 123; // > 2 pedaços de 4 MB
  await dash.evaluate(async (size) => {
    const root = await navigator.storage.getDirectory();
    const vids = await root.getDirectoryHandle('Videos TikTok', { create: true });
    const mk = async (dir, name, bytes, text) => {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      if (text != null) await w.write(text);
      else { const b = new Uint8Array(bytes); b[0] = 7; b[bytes - 1] = 9; await w.write(b); }
      await w.close();
    };
    const fone = await vids.getDirectoryHandle('fone-bluetooth-x', { create: true });
    await mk(fone, 'v01.mp4', size);
    await mk(fone, 'v02.mp4', 1000);
    await mk(fone, 'v02.txt', 0, 'Legenda própria do v02 #teste');
    await mk(fone, 'v03.mp4', 1500);
    const esc = await vids.getDirectoryHandle('escova-secadora', { create: true });
    await mk(esc, 'a1.mp4', 2000);
    await mk(esc, 'a2.mp4', 2100);
    const amb = await vids.getDirectoryHandle('kit-ambiguo', { create: true });
    await mk(amb, 'k1.mp4', 1200);
    const sem = await vids.getDirectoryHandle('sem-link', { create: true });
    await mk(sem, 's1.mp4', 1200);
    // O seletor de pasta do Windows não pode ser automatizado: devolvemos esta pasta no lugar dele.
    window.showDirectoryPicker = async () => vids;
  }, VIDEO_BYTES);
  await dash.click('[data-setup="pick"]');
  await dash.waitForFunction(() => document.querySelector('#folderBox')?.textContent.includes('Videos TikTok'));
  let st = await get(['videos', 'folders', 'catalog']);
  assert(Object.keys(st.videos).length === 7 && Object.keys(st.folders).length === 4, '7 vídeos em 4 pastas');
  assert(Object.values(st.folders).every((f) => !f.catalogKey) && !Object.keys(st.catalog).length, 'pastas começam sem produto (nada entra na fila)');
  await dash.waitForFunction(() => document.querySelector('#upcoming').textContent.includes('Ligue as pastas'));
  assert(true, 'fila vazia avisa para ligar as pastas a produtos');
  assert(await dash.isVisible('#navQueueBadge'), 'menu Vídeos mostra pastas sem produto');
  await dash.screenshot({ path: path.join(SHOTS, '01b-pasta.png') });

  console.log('2) Catálogo: adicionar produtos colando o link');
  await dash.click('[data-view="products"]');
  await dash.waitForSelector('#productsGrid [data-new-product]');
  assert(true, 'catálogo vazio mostra "Adicionar produto"');
  async function fillProduct(extra) {
    await dash.waitForSelector('#productDlg[open]');
    if (extra.link) {
      await dash.fill('#productForm [name="productUrl"]', extra.link);
      await dash.waitForFunction(() => /✓ ID do produto|✗/.test(document.querySelector('#pdLinkStatus').textContent), null, { timeout: 15000 });
    }
    if (extra.waitTitle) await dash.waitForFunction(() => document.querySelector('#productForm [name="displayName"]').value !== '', null, { timeout: 15000 });
    if (extra.query) await dash.fill('#productForm [name="productQuery"]', extra.query);
    if (extra.name) await dash.fill('#productForm [name="displayName"]', extra.name);
    if (extra.label) await dash.fill('#productForm [name="productLabel"]', extra.label);
    if (extra.niche) await dash.selectOption('#pdNiche', extra.niche);
    if (extra.benefits) await dash.fill('#productForm [name="benefits"]', extra.benefits);
    if (extra.shot) await dash.screenshot({ path: path.join(SHOTS, extra.shot) });
    await dash.click('#pdSave');
    await dash.waitForSelector('#productDlg:not([open])', { state: 'attached' });
    await sleep(500);
  }
  // Fone: só Ctrl+V do link → ID e nome preenchidos sozinhos; depois ajusta nome/nicho/benefícios
  await dash.click('#btnNewProduct');
  await dash.waitForSelector('#productDlg[open]');
  await dash.fill('#productForm [name="productUrl"]', 'Olha esse: https://www.tiktok.com/view/product/1729384756123?region=BR&u_code=xyz');
  await dash.waitForFunction(() => document.querySelector('#productForm [name="displayName"]').value.includes('Produto Teste 1729384756123'), null, { timeout: 15000 });
  assert((await dash.textContent('#pdLinkStatus')).includes('1729384756123'), 'colou o link → ID detectado');
  assert(true, 'nome do produto preenchido sozinho a partir do link');
  await fillProduct({ query: 'Fone Bluetooth X Pro Max', name: 'Fone Bluetooth X', label: 'Fone Bluetooth X Pro', niche: 'eletronicos', benefits: 'bateria de 30 horas\ncancelamento de ruído', shot: '03-produto.png' });
  await dash.click('#btnNewProduct');
  await fillProduct({ query: 'ambiguo', name: 'Kit ambiguo' });
  // link curto de compartilhamento (vt.tiktok.com): segue o redirecionamento e acha o ID; cancelar não salva
  await dash.click('#btnNewProduct');
  await dash.waitForSelector('#productDlg[open]');
  await dash.fill('#productForm [name="productUrl"]', 'https://vt.tiktok.com/ZSabc123/');
  await dash.waitForFunction(() => /✓ ID do produto|✗/.test(document.querySelector('#pdLinkStatus').textContent), null, { timeout: 15000 });
  const shortStatus = await dash.textContent('#pdLinkStatus');
  assert(shortStatus.includes('1729384756999'), 'link curto vt.tiktok.com resolvido: ' + shortStatus.trim());
  await dash.click('#productForm button[value="cancel"]:not(.x)');
  await sleep(300);
  // o mesmo link de novo → avisa que já existe
  await dash.click('#btnNewProduct');
  await fillProduct({ link: 'https://www.tiktok.com/view/product/1729384756123' });
  st = await get(['catalog']);
  const FONE = 'id_1729384756123';
  const fone = st.catalog[FONE];
  assert(fone.productUrl === 'https://www.tiktok.com/view/product/1729384756123?region=BR&u_code=xyz', 'guardou só o endereço do link (sem o texto colado junto)');
  assert(Object.keys(st.catalog).length === 2, 'catálogo com 2 produtos (cancelado e duplicado não entram)');
  assert(fone && fone.configured && fone.productUrl.includes('/product/') && fone.niche === 'eletronicos' && fone.benefits.includes('30 horas'), 'produto salvo com link, ID, nicho e benefícios');
  const KIT = Object.values(st.catalog).find((c) => c.displayName === 'Kit ambiguo').key;

  console.log('2b) Ligar pastas aos produtos (tela Vídeos)');
  await dash.click('[data-view="queue"]');
  await dash.selectOption('select[data-assign-folder="fone-bluetooth-x"]', FONE);
  await sleep(400);
  await dash.selectOption('select[data-assign-folder="kit-ambiguo"]', KIT);
  await sleep(400);
  // escova: "+ Novo produto" direto do seletor da pasta → cria e já liga
  await dash.selectOption('select[data-assign-folder="escova-secadora"]', '__new__');
  await fillProduct({ query: 'Escova Secadora Rotativa', name: 'Escova secadora', niche: 'cabelo' });
  for (let i = 0; i < 30 && !(await get(['folders'])).folders['escova-secadora'].catalogKey; i++) await sleep(500);
  st = await get(['catalog', 'folders']);
  const ESC = st.folders['escova-secadora'].catalogKey;
  assert(st.folders['fone-bluetooth-x'].catalogKey === FONE && st.folders['kit-ambiguo'].catalogKey === KIT, 'pastas ligadas pelo seletor');
  assert(ESC && st.catalog[ESC].displayName === 'Escova secadora', '"+ Novo produto" no seletor criou e ligou o produto');
  assert(!st.folders['sem-link'].catalogKey, 'pasta "sem-link" continua sem produto');
  await dash.screenshot({ path: path.join(SHOTS, '02b-pastas.png') });
  await dash.click('[data-view="products"]');
  await dash.screenshot({ path: path.join(SHOTS, '02-produtos.png') });

  console.log('3) Botão "Postar agora" do topo (produto + conteúdo de marca)');
  await cmd('save-settings', { settings: { closeTabAfter: false, uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload?draft=1' } });
  await dash.click('[data-view="overview"]');
  let pp = nextTikTokPage();
  await dash.click('#btnNow');
  let tt = await pp;
  tt.on('pageerror', (e) => errors.push('tiktok: ' + e.message));
  await dash.waitForSelector('#jobCard:not([hidden])');
  await sleep(3000);
  await dash.screenshot({ path: path.join(SHOTS, '04-postando.png') });
  let h = await waitHistory((x) => x.status === 'posted' || x.status === 'failed');
  if (h.status !== 'posted') console.log(JSON.stringify(h, null, 2));
  assert(h.status === 'posted', `publicado: ${h.video}`);
  let res = await tt.evaluate(() => window.__result);
  assert(res.events.includes('draft-discarded'), 'descartou o aviso de rascunho');
  assert(res.fileType === 'video/mp4', 'tipo video/mp4');
  const prodName = { fone: 'Fone Bluetooth X', escova: 'Escova secadora', kit: 'Kit ambiguo' }[h.video.split('-')[0]];
  assert(res.caption.includes(prodName), `legenda cita o produto (${prodName})`);
  assert((res.caption.match(/#[\p{L}\p{N}_]+/gu) || []).length === 5, '5 hashtags');
  assert(res.pickedText && res.pickedText.toLowerCase().includes(String(res.searched).toLowerCase()), `escolheu o resultado certo da busca: "${res.pickedText}" (não o 1º da lista)`);
  assert(res.disclose === 'true' && res.branded === true && res.own === false, '"Conteúdo de marca" marcado (e "Sua marca" não)');
  assert(res.posted, 'clicou em Publicar e confirmou');
  assert(h.linkedProduct && h.linkedProduct.toLowerCase().includes(String(res.searched).toLowerCase()), 'histórico registra qual produto foi vinculado');
  console.log('    Legenda:\n    ' + res.caption.replace(/\n/g, '\n    '));

  console.log('4) Postar v01 (9 MB) pela lista de vídeos');
  st = await get(['videos']);
  if (st.videos['fone-bluetooth-x/v01.mp4'].status === 'posted') await cmd('set-video-status', { paths: ['fone-bluetooth-x/v01.mp4'], status: 'pending' });
  await dash.click('[data-view="queue"]');
  await dash.waitForSelector('[data-post="fone-bluetooth-x/v01.mp4"]');
  pp = nextTikTokPage();
  const t4 = Date.now();
  await dash.click('[data-post="fone-bluetooth-x/v01.mp4"]');
  tt = await pp;
  h = await waitHistory((x) => x.ts > t4 && x.video === 'fone-bluetooth-x/v01.mp4' && (x.status === 'posted' || x.status === 'failed'));
  res = await tt.evaluate(() => window.__result);
  assert(h.status === 'posted', 'v01 publicado');
  assert(res.fileName === 'v01.mp4' && res.fileSize === VIDEO_BYTES, `arquivo chegou inteiro (${res.fileSize} bytes)`);
  assert(res.firstByte === 7 && res.lastByte === 9, 'conteúdo do arquivo íntegro');
  assert(/^https:.*1729384756123/.test(res.searches[0]) && res.pickedText.includes('1729384756123'), 'colou o link do produto na busca e escolheu o item com o ID certo');
  assert(res.productLabel === 'Fone Bluetooth X Pro', 'nome do link preenchido');
  assert(/Fone Bluetooth X/.test(res.caption) && !/v01/.test(res.caption), 'legenda sem o nome do arquivo');

  console.log('5) Segurança do link: busca ambígua NÃO publica');
  pp = nextTikTokPage();
  await cmd('set-video-status', { paths: ['kit-ambiguo/k1.mp4'], status: 'pending' });
  r = await cmd('post-now', { path: 'kit-ambiguo/k1.mp4' });
  tt = await pp;
  h = await waitHistory((x) => x.video === 'kit-ambiguo/k1.mp4' && x.status === 'failed');
  res = await tt.evaluate(() => window.__result);
  assert(/parecidos|ID/.test(h.error), `falhou com aviso claro: "${h.error.slice(0, 90)}…"`);
  assert(!res.posted, 'nada foi publicado com produto duvidoso');

  console.log('6) Segurança do link: produto sem link não posta');
  r = await cmd('post-now', { path: 'sem-link/s1.mp4' });
  assert(!r.ok && /produto/i.test(r.error), 'recusou vídeo sem produto: ' + r.error);

  console.log('7) Teste sem publicar (botão do produto)');
  await dash.click('[data-view="products"]');
  await dash.waitForSelector(`[data-test-prod="${ESC}"]`);
  pp = nextTikTokPage();
  await dash.click(`[data-test-prod="${ESC}"]`);
  tt = await pp;
  h = await waitHistory((x) => x.dryRun);
  res = await tt.evaluate(() => window.__result);
  assert(h.status === 'dry-run' && h.video.startsWith('escova-secadora/'), 'teste concluído no produto certo');
  assert(!res.posted, 'teste não publicou');
  st = await get(['catalog', 'videos']);
  assert(st.catalog[ESC].linkTestedAt, 'produto marcado como "link conferido"');
  assert(st.videos[h.video].status === 'pending', 'vídeo do teste continua pendente');
  await dash.waitForFunction(() => document.querySelector('#productsGrid').textContent.includes('Link conferido'));
  await dash.screenshot({ path: path.join(SHOTS, '05-produtos-testados.png') });

  console.log('8) Legenda própria via .txt');
  pp = nextTikTokPage();
  await cmd('post-now', { path: 'fone-bluetooth-x/v02.mp4' });
  tt = await pp;
  h = await waitHistory((x) => x.video === 'fone-bluetooth-x/v02.mp4');
  res = await tt.evaluate(() => window.__result);
  assert(h.status === 'posted' && res.caption.trim() === 'Legenda própria do v02 #teste', 'usou o texto do .txt');

  console.log('8b) Lista com <input> escondido + [role=radio] (sem duplicar resultados)');
  await cmd('save-settings', { settings: { uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload?roleradio=1' } });
  pp = nextTikTokPage();
  r = await cmd('dry-run', { path: 'fone-bluetooth-x/v03.mp4' });
  tt = await pp;
  h = await waitHistory((x) => x.dryRun && x.video === 'fone-bluetooth-x/v03.mp4');
  res = await tt.evaluate(() => window.__result);
  if (h.status !== 'dry-run') console.log(JSON.stringify(h, null, 2));
  assert(h.status === 'dry-run' && res.pickedText.includes('1729384756123'), 'escolheu o produto certo com controles duplicados');

  console.log('8c) Publicar sem confirmação → "verificar", sem nova tentativa (evita post duplicado)');
  await cmd('save-settings', { settings: { uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload?noconfirm=1' } });
  pp = nextTikTokPage();
  await cmd('post-now', { path: 'fone-bluetooth-x/v03.mp4' });
  tt = await pp;
  h = await waitHistory((x) => x.video === 'fone-bluetooth-x/v03.mp4' && !x.dryRun, 240000);
  st = await get(['videos', 'runtime']);
  assert(h.status === 'unconfirmed', 'marcado como "verificar no TikTok"');
  assert(st.videos['fone-bluetooth-x/v03.mp4'].status === 'unconfirmed' && !st.runtime.retry, 'não será repetido automaticamente');
  await dash.click('[data-view="overview"]');
  await dash.waitForSelector('[data-goto-queue="unconfirmed"]');
  await dash.click('[data-goto-queue="unconfirmed"]');
  await dash.click('[data-mark-posted="fone-bluetooth-x/v03.mp4"]');
  await sleep(500);
  assert((await get(['videos'])).videos['fone-bluetooth-x/v03.mp4'].status === 'posted', 'botão "Saiu, marcar publicado" funciona');

  console.log('8d) Cancelar fecha a aba e nada é publicado');
  await cmd('save-settings', { settings: { uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload?slow=1' } });
  await dash.click('[data-view="overview"]');
  pp = nextTikTokPage();
  await cmd('post-now', { path: 'escova-secadora/a2.mp4' });
  tt = await pp;
  await dash.waitForSelector('#jobCard:not([hidden])');
  await dash.waitForFunction(() => /envio terminar/.test(document.querySelector('#jobStep').textContent), null, { timeout: 60000 });
  const closed = new Promise((ok) => tt.once('close', ok));
  await dash.click('#btnCancel');
  await Promise.race([closed, sleep(10000)]);
  assert(tt.isClosed(), 'aba do TikTok fechada ao cancelar');
  h = await waitHistory((x) => x.video === 'escova-secadora/a2.mp4');
  st = await get(['videos', 'runtime']);
  assert(h.status === 'failed' && /Cancelado/.test(h.error) && !st.runtime.currentJob, 'cancelado registrado');
  assert(st.videos['escova-secadora/a2.mp4'].status === 'pending', 'vídeo continua na fila');
  await cmd('save-settings', { settings: { uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload?draft=1' } });

  console.log('8e) Produto só de um vídeo + remover produto do catálogo');
  await dash.click('[data-view="queue"]');
  await dash.click('#queueFilter [data-f="all"]');
  await dash.selectOption('select[data-assign-video="sem-link/s1.mp4"]', FONE);
  await sleep(400);
  st = await get(['videos', 'folders']);
  assert(st.videos['sem-link/s1.mp4'].catalogKey === FONE && !st.folders['sem-link'].catalogKey, 'vídeo usa o produto escolhido, pasta continua sem');
  await dash.selectOption('select[data-assign-video="sem-link/s1.mp4"]', '');
  await sleep(400);
  assert(!(await get(['videos'])).videos['sem-link/s1.mp4'].catalogKey, 'voltou a usar o produto da pasta');
  await dash.selectOption('select[data-assign-folder="sem-link"]', '__new__');
  await fillProduct({ link: 'https://www.tiktok.com/view/product/5550001112223', waitTitle: true });
  for (let i = 0; i < 30 && !(await get(['folders'])).folders['sem-link'].catalogKey; i++) await sleep(500);
  st = await get(['catalog', 'folders']);
  const TMP = st.folders['sem-link'].catalogKey;
  if (!(TMP === 'id_5550001112223' && st.catalog[TMP]?.displayName.includes('Produto Teste'))) console.log('DEBUG', TMP, JSON.stringify(st.catalog[TMP] || Object.keys(st.catalog)), await dash.textContent('#toast'));
  assert(TMP === 'id_5550001112223' && st.catalog[TMP].displayName.includes('Produto Teste'), 'novo produto pelo seletor só com o link (nome automático)');
  await dash.click('[data-view="products"]');
  await dash.click(`[data-delete-prod="${TMP}"]`);
  await sleep(600);
  st = await get(['catalog', 'folders']);
  assert(!st.catalog[TMP] && !st.folders['sem-link'].catalogKey, 'produto removido e a pasta ficou sem produto');

  console.log('9) Configurações pela tela');
  await dash.click('[data-view="settings"]');
  await dash.click('#intervalSeg [data-v="30"]');
  await dash.fill('#settingsForm [name="maxPerDay"]', '20');
  await dash.click('#settingsForm button[type="submit"]');
  await dash.waitForFunction(() => document.querySelector('#saveMsg').textContent.startsWith('Salvo'));
  st = await get(['settings']);
  assert(st.settings.intervalMinutes === 30 && st.settings.maxPerDay === 20, 'intervalo e limite salvos');
  await dash.screenshot({ path: path.join(SHOTS, '06-configuracoes.png'), fullPage: true });
  await dash.click('#intervalSeg [data-v="60"]');
  await dash.click('#settingsForm button[type="submit"]');
  await sleep(500);
  assert((await get(['settings'])).settings.intervalMinutes === 60, 'voltou para 60 min');

  console.log('10) Lista de vídeos: pular e voltar para a fila');
  await dash.click('[data-view="queue"]');
  await dash.click('#queueFilter [data-f="pending"]');
  await dash.click('[data-skip="sem-link/s1.mp4"]');
  await sleep(500);
  assert((await get(['videos'])).videos['sem-link/s1.mp4'].status === 'skipped', 'pulado');
  await dash.click('#queueFilter [data-f="skipped"]');
  await dash.click('[data-requeue="sem-link/s1.mp4"]');
  await sleep(500);
  assert((await get(['videos'])).videos['sem-link/s1.mp4'].status === 'pending', 'voltou para a fila');
  await dash.click('#queueFilter [data-f="all"]');
  await dash.screenshot({ path: path.join(SHOTS, '07-videos.png') });

  console.log('11) Modo automático: Iniciar → o alarme dispara e posta sozinho');
  await cmd('set-video-status', { paths: ['kit-ambiguo/k1.mp4'], status: 'skipped' });
  await dash.click('[data-view="overview"]');
  await dash.click('#btnToggle');
  await sleep(600);
  let rt = (await get(['runtime'])).runtime;
  assert(rt.running && rt.nextRunAt > Date.now(), 'iniciado, próximo post agendado');
  const countPosted = async () => (await get(['history'])).history.filter((x) => x.status === 'posted').length;
  const before = await countPosted();
  await cmd('set-next-run', { ts: Date.now() - 1000 });
  const end = Date.now() + 180000;
  let after = before;
  while (Date.now() < end && after === before) { await sleep(1500); after = await countPosted(); }
  assert(after === before + 1, 'postou sozinho pelo agendador');
  rt = (await get(['runtime'])).runtime;
  const mins = (rt.nextRunAt - Date.now()) / 60000;
  assert(mins > 45 && mins < 70, `próximo post reagendado para daqui ~${mins.toFixed(0)} min`);
  const { catalog: products } = await get(['catalog']);
  const lastPosted = (await get(['history'])).history.find((x) => x.status === 'posted');
  assert(products[lastPosted.product].lastHashtags.length === 5 && products[lastPosted.product].recentCaptions.length >= 1, 'memória de legendas/hashtags salva no produto');
  await dash.waitForTimeout(800);
  await dash.screenshot({ path: path.join(SHOTS, '08-rodando.png') });
  await dash.click('#sideToggle');
  await sleep(500);
  assert(!(await get(['runtime'])).runtime.running, 'pausado pelo botão da barra lateral');

  console.log('12) Variação entre posts do mesmo produto');
  const fonePosts = (await get(['history'])).history.filter((x) => x.status === 'posted' && x.product === 'fone-bluetooth-x' && !x.caption.includes('#teste'));
  if (fonePosts.length >= 2) {
    const tags = (c) => c.split('\n\n')[1].split(' ');
    const [a, b] = fonePosts;
    const kept = tags(a.caption).filter((t) => tags(b.caption).includes(t)).length;
    assert(a.caption.split('\n\n')[0] !== b.caption.split('\n\n')[0], 'textos diferentes entre posts');
    assert(kept >= 3 && kept <= 4, `hashtags: ${kept} mantidas, ${5 - kept} trocadas`);
  }

  console.log('12b) Busca pelo ID não funciona → plano B pelo nome, conferido');
  await cmd('save-settings', { settings: { uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload?noidsearch=1' } });
  await cmd('set-video-status', { paths: ['fone-bluetooth-x/v02.mp4'], status: 'pending' });
  pp = nextTikTokPage();
  await cmd('dry-run', { path: 'fone-bluetooth-x/v02.mp4' });
  tt = await pp;
  h = await waitHistory((x) => x.dryRun && x.video === 'fone-bluetooth-x/v02.mp4');
  res = await tt.evaluate(() => window.__result);
  if (h.status !== 'dry-run') console.log(JSON.stringify(h, null, 2));
  assert(h.status === 'dry-run' && res.searches.length === 3 && res.searches[1] === '1729384756123' && res.searches[2] === 'Fone Bluetooth X Pro Max' && res.pickedText.includes('Fone Bluetooth X Pro Max'), 'tentou o link, depois o ID e achou pelo nome');
  await cmd('save-settings', { settings: { uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload?draft=1' } });

  console.log('13) TikTok deslogado → pausa e avisa, vídeo continua na fila');
  pageBody = '<h1>Entrar no TikTok</h1><p>Usar telefone / e-mail / nome de usuário</p>';
  await cmd('save-settings', { settings: { telegramEnabled: true, telegramToken: '123:ABC', telegramChatId: '4242' } });
  await cmd('start');
  await cmd('post-now', { path: 'escova-secadora/a2.mp4' });
  h = await waitHistory((x) => x.video === 'escova-secadora/a2.mp4' && x.status === 'failed' && /logado/.test(x.error), 150000);
  st = await get(['runtime', 'videos']);
  assert(!st.runtime.running && st.runtime.pausedReason === 'logged-out', 'pausou com motivo "deslogado"');
  assert(st.videos['escova-secadora/a2.mp4'].status !== 'failed', 'vídeo não foi marcado como falho');
  await dash.click('[data-view="overview"]');
  await dash.waitForFunction(() => document.querySelector('#banner').textContent.includes('deslogado'));
  assert(true, 'painel mostra aviso de TikTok deslogado');
  await sleep(1500);
  assert(telegram.some((m) => m.body && /deslogado/.test(m.body.text) && m.body.chat_id === '4242'), 'aviso enviado ao Telegram');
  pageBody = MOCK;

  console.log('13b) Telegram e backup pela tela de configurações');
  await dash.click('[data-view="settings"]');
  assert(await dash.isVisible('#tgFields'), 'campos do Telegram aparecem quando ligado');
  await dash.fill('#settingsForm [name="telegramChatId"]', '');
  await dash.click('#btnTgFind');
  await dash.waitForFunction(() => document.querySelector('#settingsForm [name="telegramChatId"]').value === '4242');
  assert(true, '"Descobrir meu chat ID" preencheu o chat');
  const tgBefore = telegram.length;
  await dash.click('#btnTgTest');
  await sleep(1500);
  assert(telegram.length === tgBefore + 1 && /Teste/.test(telegram[telegram.length - 1].body.text), 'mensagem de teste enviada');
  await dash.click('#settingsForm button[type="submit"]');
  await sleep(500);
  const exp = await cmd('export');
  assert(exp.ok && exp.data.catalog[FONE].productId === '1729384756123' && exp.data.folders['fone-bluetooth-x'].catalogKey === FONE, 'backup exportado com catálogo e pastas');
  await cmd('catalog-save', { key: FONE, data: { productUrl: '', productId: '', productQuery: '' } });
  assert(!(await get(['catalog'])).catalog[FONE].configured, 'link apagado');
  const imp = await cmd('import', { data: exp.data });
  assert(imp.ok && (await get(['catalog'])).catalog[FONE].productId === '1729384756123', 'backup importado restaurou o link');
  await dash.click('[data-view="help"]');
  const [download] = await Promise.all([dash.waitForEvent('download'), dash.click('#btnExport')]);
  assert(/autoposter-backup-.*\.json/.test(download.suggestedFilename()), 'botão Exportar baixa o arquivo ' + download.suggestedFilename());

  console.log('14) Histórico, ajuda e tema claro');
  await dash.click('[data-view="history"]');
  await dash.click('#histFilter [data-f="failed"]');
  assert((await dash.$$('#historyList .act')).length >= 2, 'filtro de falhas');
  await dash.click('#histFilter [data-f="all"]');
  await dash.screenshot({ path: path.join(SHOTS, '09-historico.png') });
  await dash.click('[data-view="help"]');
  await dash.screenshot({ path: path.join(SHOTS, '10-ajuda.png') });
  await dash.click('[data-theme-set="light"]');
  assert((await dash.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'tema claro');
  await dash.click('[data-view="overview"]');
  await dash.mouse.move(700, 500);
  await sleep(600);
  await dash.screenshot({ path: path.join(SHOTS, '11-claro.png') });
  await dash.reload();
  await dash.waitForSelector('#btnToggle');
  assert((await dash.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'tema lembrado após recarregar');
  await dash.click('[data-theme-set="dark"]');

  assert(errors.length === 0, 'sem erros de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`\nTODOS OS ${passed} TESTES PASSARAM`);
  await ctx.close();
  srv.close();
}

main().catch((e) => {
  console.error('\n' + (e.stack || e));
  process.exit(1);
});
