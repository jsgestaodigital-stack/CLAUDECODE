// Teste ponta a ponta do MODO AGENDAMENTO (sessões + Agendar do TikTok). Base: carrega a extensão num Chromium, conecta uma pasta de vídeos de teste
// pelo próprio painel e faz postagens completas contra uma simulação do TikTok Studio.
// Uso: xvfb-run -a node test/e2e-schedule.cjs
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
let hangPages = false; // simula o TikTok que não carrega (internet/computador "dormindo")
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
    if (hangPages && req.url.startsWith('/tiktokstudio')) return; // nunca responde
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

  console.log('S1) pasta + produto');
  await dash.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const vids = await root.getDirectoryHandle('Videos TikTok', { create: true });
    const d = await vids.getDirectoryHandle('microfone', { create: true });
    for (const n of ['MIC_G1C1A1.mp4', 'MIC_G2C1A1.mp4', 'MIC_G1C2A2.mp4']) {
      const fh = await d.getFileHandle(n, { create: true }); const w = await fh.createWritable(); await w.write(new Uint8Array(3000)); await w.close();
    }
    window.showDirectoryPicker = async () => vids;
  });
  await dash.click('[data-setup="pick"]');
  await dash.waitForFunction(() => document.querySelector('#folderBox')?.textContent.includes('Videos TikTok'));
  r = await cmd('catalog-save', { data: { productId: '1734624264740242575', displayName: 'Microfone', productQuery: 'Microfone Lapela', niche: 'eletronicos' }, assignFolder: 'microfone' });
  assert(r.ok, 'produto salvo e ligado à pasta');
  let { settings } = await get(['settings']);
  assert(settings.publishMode === 'schedule', 'modo agendamento é o padrão');
  await cmd('save-settings', { settings: { speed: 'normal', intervalMinutes: 60, jitterMinutes: 0, activeStartHour: 0, activeEndHour: 24, perSessionMax: 2, sessionTimes: '03:00' } });
  await dash.reload(); await dash.waitForSelector('#btnToggle');
  await dash.click('[data-view="settings"]');
  assert(await dash.isVisible('#sessionBox'), 'configurações mostram as sessões');
  assert((await dash.textContent('#sessionHint')).includes('sessão'), 'dica das sessões aparece');
  await dash.screenshot({ path: path.join(SHOTS, 's-config.png'), fullPage: false });
  await dash.click('[data-view="overview"]');

  console.log('S1b) zoom de 110% no TikTok (como no computador do usuário)');
  const z = await ctx.newPage();
  await z.goto('https://www.tiktok.com/tiktokstudio/upload?zoomsetup=1');
  await dash.evaluate(async () => { const [t] = await chrome.tabs.query({ url: 'https://www.tiktok.com/*' }); await chrome.tabs.setZoom(t.id, 1.1); });
  await z.close();

  console.log('S2) sessão: agenda vazia → 1º sai agora, 2º agendado ~1h depois, mesma aba');
  const pages = [];
  ctx.on('page', (p) => { if (p.url().includes('tiktok')) pages.push(p); });
  r = await cmd('session-now');
  assert(r.ok, 'sessão iniciada ' + JSON.stringify(r));
  ctx.on('page', (p) => p.on('pageerror', (e) => errors.push('tt: ' + e.message)));
  const h1 = await waitHistory((h) => h.status === 'posted' || h.status === 'scheduled' || h.status === 'failed', 240000);
  if (h1.status === 'failed') { console.log(h1.error, '\n', (h1.log || []).slice(-40).join('\n')); }
  assert(h1.status === 'posted', 'agenda vazia: 1º vídeo publicado agora');
  const log1 = (h1.log || []).join('\n');
  console.log((h1.log || []).filter((l) => /calibrado|⚠/.test(l)).join('\n'));
  assert(/calibrado/.test(log1) && /zoom\/escala 1\.1/.test(log1), 'mouse calibrado com o zoom de 110%');
  assert(!/clique simulado|caiu em/.test(log1), 'todos os cliques de verdade acertaram o alvo');
  const st1 = await get(['videos', 'runtime']);
  assert(st1.runtime.session && st1.runtime.session.done === 1, 'sessão continua (1 feito)');
  // pula a pausa humana entre vídeos
  await dash.evaluate(async () => { const { runtime } = await chrome.storage.local.get('runtime'); runtime.session.nextJobAt = Date.now(); await chrome.storage.local.set({ runtime }); });
  const h2 = await waitHistory((h) => (h.status === 'scheduled' && h.id !== h1.id) || (h.status === 'failed' && h.ts > h1.ts), 240000);
  if (h2.status === 'failed') console.log(h2.error, '\n', (h2.log || []).slice(-30).join('\n'));
  assert(h2.status === 'scheduled' && h2.publishAt - h1.publishAt >= 55 * 60000, '2º vídeo agendado ~1h depois do 1º');
  const log2 = (h2.log || []).join('\n');
  assert(/agendamento preenchido/.test(log2) && !/clique simulado|caiu em/.test(log2), 'preencheu data/hora só com cliques reais (zoom 110%)');
  assert(new Date(h2.publishAt).getMinutes() % 5 === 0, 'horário em múltiplo de 5 min');
  assert((h2.log || []).some((l) => /mesma aba/.test(l)), '2º vídeo usou a mesma aba');
  await dash.evaluate(async () => { const { runtime } = await chrome.storage.local.get('runtime'); if (runtime.session) { runtime.session.nextJobAt = Date.now(); await chrome.storage.local.set({ runtime }); } });
  const hs = await waitHistory((h) => h.status === 'session', 120000);
  assert(/2 vídeo/.test(hs.step), 'sessão encerrada com resumo: ' + hs.step);
  const st2 = await get(['runtime']);
  assert(!st2.runtime.session && st2.runtime.nextSessionAt > Date.now(), 'próxima sessão marcada');
  await dash.screenshot({ path: path.join(SHOTS, 's-overview.png') });

  console.log('S3) agenda para amanhã (calendário)');
  const d0 = new Date(Date.now() - 10 * 60000);
  await cmd('save-settings', { settings: { intervalMinutes: 1440, perSessionMax: 1, sessionTimes: `${String(d0.getHours()).padStart(2, '0')}:${String(d0.getMinutes()).padStart(2, '0')}` } });
  await dash.evaluate(async () => { const { runtime } = await chrome.storage.local.get('runtime'); runtime.lastSlotAt = Date.now(); runtime.consecutiveFailures = 0; await chrome.storage.local.set({ runtime }); });
  r = await cmd('session-now');
  const h3 = await waitHistory((h) => (h.status === 'scheduled' || h.status === 'failed') && h.ts > hs.ts, 240000);
  if (h3.status === 'failed') console.log(h3.error, '\n', (h3.log || []).slice(-30).join('\n'));
  console.log((h3.log || []).filter((l) => /calend|data/.test(l)).join('\n'));
  assert(h3.status === 'scheduled' && new Date(h3.publishAt).getDate() !== new Date().getDate(), 'agendou para o dia seguinte pelo calendário');
  assert(!errors.length, 'sem erros: ' + errors.join(' | '));
  console.log(`\nOK — ${passed} verificações`);
  await ctx.close(); srv.close(); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
