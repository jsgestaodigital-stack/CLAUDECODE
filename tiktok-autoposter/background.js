// Service worker: agenda, escolhe o próximo vídeo, abre o TikTok Studio e coordena a postagem.
import { DEFAULT_SETTINGS, DEFAULT_LABELS } from './lib/defaults.js';
import {
  computeNextRun, countPostedToday, pickNext, mergeScan, isWithinActiveHours, isLinkReady, productBlocked, linkKey,
} from './lib/scheduler.js';
import { generateCaption, rememberCaption } from './lib/captions.js';

const MIN = 60 * 1000;
const JOB_TIMEOUT_MS = 35 * MIN;     // limite total de uma postagem
const JOB_SILENCE_MS = 6 * MIN;      // sem nenhum sinal da página por esse tempo = travou
const HISTORY_LIMIT = 800;

// ---------- estado ----------
async function load() {
  const s = await chrome.storage.local.get(['settings', 'products', 'videos', 'history', 'runtime']);
  const settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  settings.labels = { ...DEFAULT_LABELS, ...(settings.labels || {}) };
  return {
    settings,
    products: s.products || {},
    videos: s.videos || {},
    history: s.history || [],
    runtime: { running: false, nextRunAt: null, currentJob: null, lastProduct: null, consecutiveFailures: 0, ...(s.runtime || {}) },
  };
}

const save = (patch) => chrome.storage.local.set(patch);

// Fila de exclusão mútua: todas as alterações de estado passam por aqui, uma por vez.
let chain = Promise.resolve();
function locked(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

function log(...a) { console.log('[AutoPoster]', ...a); }

function addHistory(state, entry) {
  state.history = [{ id: crypto.randomUUID(), ts: Date.now(), ...entry }, ...state.history].slice(0, HISTORY_LIMIT);
}

// Aviso no Windows (notificação do Chrome) e, se configurado, no celular pelo Telegram.
function notify(title, message, { telegram = true } = {}) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 2 });
  if (telegram) telegramFromSettings(`${title}\n${message}`);
}

async function telegramFromSettings(text) {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings?.telegramEnabled && settings.telegramToken && settings.telegramChatId) {
      await telegramSend(settings.telegramToken, settings.telegramChatId, text);
    }
  } catch (e) { log('telegram', e); }
}

async function telegramSend(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token.trim())}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId).trim(), text: `🤖 AutoPoster\n${text}`, disable_web_page_preview: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `Telegram respondeu ${res.status}`);
  return data;
}

// Mantém o computador acordado enquanto o AutoPoster estiver rodando (a tela pode desligar).
function syncPower(rt, settings) {
  try {
    if (rt?.running && settings?.keepAwake !== false) chrome.power.requestKeepAwake('system');
    else chrome.power.releaseKeepAwake();
  } catch (_) { /* sem a permissão power */ }
}

// Resumo diário pelo Telegram.
async function maybeDailySummary(state) {
  const s = state.settings;
  const rt = state.runtime;
  if (!s.telegramEnabled || !s.telegramSummary || !s.telegramToken || !s.telegramChatId) return;
  const now = new Date();
  const day = now.toDateString();
  if (now.getHours() < Number(s.telegramSummaryHour ?? 22) || rt.lastSummaryDay === day) return;
  rt.lastSummaryDay = day;
  await save({ runtime: rt });
  const since = new Date(now); since.setHours(0, 0, 0, 0);
  const today = state.history.filter((h) => h.ts >= since.getTime());
  const posted = today.filter((h) => h.status === 'posted').length;
  const failed = today.filter((h) => h.status === 'failed').length;
  const check = Object.values(state.videos).filter((v) => v.status === 'unconfirmed').length;
  const pending = Object.values(state.videos).filter((v) => v.status === 'pending').length;
  const lines = [
    `📊 Resumo de hoje`,
    `✅ Publicados: ${posted}`,
    `❌ Falhas: ${failed}`,
    check ? `⚠️ Para conferir no TikTok: ${check}` : null,
    `🎬 Vídeos na fila: ${pending}`,
    rt.running ? `▶️ Rodando${rt.nextRunAt ? ` — próximo post ~${new Date(rt.nextRunAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}` : '⏸ Pausado',
  ].filter(Boolean);
  telegramSend(s.telegramToken, s.telegramChatId, lines.join('\n')).catch((e) => log('telegram summary', e));
}

// ---------- documento invisível (leitura dos arquivos) ----------
async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Ler os vídeos da pasta local escolhida pelo usuário para enviá-los ao TikTok Studio.',
    });
  } catch (e) {
    if (!/single offscreen|only a single/i.test(String(e?.message))) throw e;
  }
}

async function offscreen(type, payload = {}) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload });
  if (!res) throw new Error('O leitor de arquivos não respondeu.');
  return res;
}

async function rescan(state) {
  const res = await offscreen('scan');
  if (!res.ok) return res;
  const merged = mergeScan(state, res.files);
  state.videos = merged.videos;
  state.products = merged.products;
  state.runtime.folderName = res.folderName;
  state.runtime.lastScanAt = Date.now();
  return { ok: true, added: merged.added, missing: merged.missing, total: res.files.length };
}

// ---------- agendamento ----------
async function ensureAlarm() {
  const a = await chrome.alarms.get('tick');
  if (!a) chrome.alarms.create('tick', { periodInMinutes: 1, delayInMinutes: 0.1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  const s = await chrome.storage.local.get('settings');
  if (!s.settings) await save({ settings: DEFAULT_SETTINGS });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await locked(async () => {
    const state = await load();
    // IDs de abas não valem entre sessões do Chrome
    state.runtime.staleTabId = null;
    syncPower(state.runtime, state.settings);
    if (state.runtime.currentJob) state.runtime.currentJob.tabId = null;
    await save({ runtime: state.runtime });
    if (state.runtime.currentJob) {
      await finishJob(state, { ok: false, error: 'Postagem interrompida (o Chrome foi fechado ou reiniciado).', step: state.runtime.currentJob.step });
    }
  });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick') locked(tick).catch((e) => log('tick error', e));
});

chrome.action.onClicked.addListener(() => openDashboard());
chrome.notifications.onClicked.addListener((id) => { chrome.notifications.clear(id); openDashboard(); });

async function openDashboard() {
  const url = chrome.runtime.getURL('dashboard/index.html');
  const [tab] = await chrome.tabs.query({ url });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function tick() {
  const state = await load();
  const rt = state.runtime;
  const now = Date.now();
  syncPower(rt, state.settings);
  await maybeDailySummary(state);

  if (rt.currentJob) {
    const job = rt.currentJob;
    const lastSignal = job.lastProgressAt || job.startedAt;
    if (now - job.startedAt > JOB_TIMEOUT_MS) {
      await abortJob(state, 'Tempo limite excedido (35 min).');
    } else if (now - lastSignal > JOB_SILENCE_MS) {
      await abortJob(state, 'A página do TikTok parou de responder.');
    }
    return;
  }
  if (!rt.running) return;
  if (!rt.nextRunAt) {
    rt.nextRunAt = now + MIN;
    await save({ runtime: rt });
    return;
  }
  if (now < rt.nextRunAt) return;

  const s = state.settings;
  if (!isWithinActiveHours(new Date(now), s.activeStartHour, s.activeEndHour)) {
    rt.nextRunAt = computeNextRun(now, { ...s, intervalMinutes: 1 });
    await save({ runtime: rt });
    return;
  }
  if (countPostedToday(state.history, now) >= s.maxPerDay) {
    const tomorrow = new Date(now);
    tomorrow.setHours(24, Math.floor(Math.random() * 10), 0, 0);
    rt.nextRunAt = isWithinActiveHours(tomorrow, s.activeStartHour, s.activeEndHour)
      ? tomorrow.getTime()
      : computeNextRun(tomorrow.getTime(), { ...s, intervalMinutes: 1 });
    await save({ runtime: rt });
    return;
  }
  await startJob(state, { dryRun: false });
}

// ---------- execução de uma postagem ----------
async function startJob(state, { dryRun, videoPath } = {}) {
  const rt = state.runtime;
  if (rt.currentJob) return { ok: false, error: 'Já existe uma postagem em andamento.' };

  const scan = await rescan(state);
  if (!scan.ok) {
    const msg = scan.error || 'Não foi possível ler a pasta de vídeos.';
    const last = state.history[0];
    if (!(last && last.step === 'Lendo a pasta' && last.error === msg)) addHistory(state, { status: 'failed', error: msg, step: 'Lendo a pasta' });
    if (rt.running) {
      rt.nextRunAt = Date.now() + 5 * MIN;
      if ((scan.code === 'NEEDS_PERMISSION' || scan.code === 'NO_FOLDER') && Date.now() - (rt.lastFolderNotify || 0) > 60 * MIN) {
        rt.lastFolderNotify = Date.now();
        notify('AutoPoster: pasta sem acesso', msg + ' Clique aqui para abrir o painel.');
      }
    }
    await save({ runtime: rt, history: state.history });
    return { ok: false, error: msg };
  }

  // Reabastece produtos esgotados no modo "loop"
  if (state.settings.onExhausted === 'loop') refillExhausted(state);

  let pick;
  if (videoPath) {
    const v = state.videos[videoPath];
    if (!v) return { ok: false, error: 'Vídeo não encontrado.' };
    if (v.status === 'missing') return { ok: false, error: 'Esse vídeo não está mais na pasta.' };
    pick = { product: v.product, video: v };
  } else if (rt.retry && state.videos[rt.retry.path]?.status === 'pending'
    && !productBlocked(state.products[state.videos[rt.retry.path].product], state.settings)) {
    const v = state.videos[rt.retry.path];
    pick = { product: v.product, video: v };
  } else {
    rt.retry = null;
    pick = pickNext(state);
  }

  if (!pick) {
    rt.nextRunAt = Date.now() + 15 * MIN;
    const already = state.history[0]?.status === 'idle';
    if (!already) {
      addHistory(state, { status: 'idle', error: 'Nenhum vídeo pendente. Adicione vídeos na pasta ou reative produtos.' });
      if (rt.running) notify('AutoPoster: fila vazia', 'Não há vídeos pendentes para postar.');
    }
    await save({ runtime: rt, history: state.history, videos: state.videos, products: state.products });
    return { ok: false, error: 'Nenhum vídeo pendente.' };
  }

  const product = state.products[pick.product];
  if (state.settings.linkProduct && !isLinkReady(product)) {
    const msg = `Configure o link do produto "${product?.displayName || pick.product}" antes de postar (Produtos → Configurar).`;
    if (!videoPath && rt.running) {
      rt.retry = null;
      rt.nextRunAt = Date.now() + MIN;
    }
    await save({ videos: state.videos, products: state.products, runtime: rt });
    return { ok: false, error: msg };
  }
  let sidecarText = null;
  if (pick.video.hasTxt) {
    const r = await offscreen('read-sidecar', { path: pick.video.path });
    if (r.ok) sidecarText = r.text;
  }
  const cap = generateCaption(product, state.settings, {
    sidecarText,
    memory: { recent: product.recentCaptions, lastHook: product.lastHook, lastHashtags: product.lastHashtags },
  });
  const caption = cap.text;

  const attempt = rt.retry?.path === pick.video.path ? (rt.retry.attempt || 1) + 1 : 1;
  const job = {
    id: crypto.randomUUID(),
    path: pick.video.path,
    product: pick.product,
    productName: product.displayName,
    linkProduct: !!state.settings.linkProduct,
    productId: state.settings.linkProduct ? String(product.productId || '').trim() : '',
    productQuery: state.settings.linkProduct ? String(product.productQuery || '').trim() : '',
    linkKey: linkKey(product),
    productLabel: (product.productLabel || product.displayName || '').slice(0, 30),
    caption,
    captionMeta: { body: cap.body, hashtags: cap.hashtags, hook: cap.hook },
    brandedContent: !!state.settings.brandedContent,
    dryRun: !!dryRun,
    attempt,
    startedAt: Date.now(),
    lastProgressAt: Date.now(),
    step: 'Abrindo o TikTok Studio',
    labels: state.settings.labels,
  };
  // fecha a aba de uma tentativa anterior que falhou (fica aberta só até a próxima tentativa)
  if (rt.staleTabId) {
    closeTikTokTab(rt.staleTabId);
    rt.staleTabId = null;
  }
  rt.currentJob = job;
  // testes e posts manuais de outro vídeo não descartam uma nova tentativa pendente
  if (!dryRun && (!videoPath || rt.retry?.path === videoPath)) rt.retry = null;
  await save({ runtime: rt, videos: state.videos, products: state.products });
  log('start job', job.path, dryRun ? '(teste)' : '');

  try {
    const tab = await chrome.tabs.create({ url: state.settings.uploadUrl, active: !!(state.settings.foregroundTab || dryRun) });
    job.tabId = tab.id;
    rt.currentJob = job;
    await save({ runtime: rt });
    await waitTabComplete(tab.id, 90 * 1000);
    await sleep(2500 + Math.random() * 2500);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/tiktok.js'] });
    const { labels, ...jobForPage } = job;
    await chrome.tabs.sendMessage(tab.id, { type: 'run-job', job: { ...jobForPage, labels } });
  } catch (e) {
    await finishJob(state, { ok: false, error: 'Falha ao abrir o TikTok Studio: ' + (e.message || e), step: job.step, jobId: job.id });
    return { ok: false, error: String(e.message || e) };
  }
  return { ok: true, jobId: job.id };
}

function refillExhausted(state) {
  const pendingBy = {};
  for (const v of Object.values(state.videos)) if (v.status === 'pending') pendingBy[v.product] = true;
  for (const [key, p] of Object.entries(state.products)) {
    if (p.enabled === false || pendingBy[key]) continue;
    for (const v of Object.values(state.videos)) {
      // só recoloca vídeos que ainda existem na pasta
      if (v.product === key && v.status === 'posted' && !v.gone) state.videos[v.path] = { ...v, status: 'pending', cycle: (v.cycle || 1) + 1 };
    }
  }
}

// Fecha uma aba só se ela ainda for do TikTok (IDs de aba podem ser reaproveitados).
async function closeTikTokTab(tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    if (/^https:\/\/www\.tiktok\.com\//.test(t.url || t.pendingUrl || '')) await chrome.tabs.remove(tabId);
  } catch (_) { /* aba já fechada */ }
}

// Cancela a postagem em andamento: avisa a página para parar e fecha a aba,
// para que ela não publique depois de a extensão ter desistido.
async function abortJob(state, reason) {
  const job = state.runtime.currentJob;
  if (!job) return;
  if (job.tabId) {
    try { await chrome.tabs.sendMessage(job.tabId, { type: 'abort-job' }); } catch (_) { /* página já fechada */ }
  }
  await finishJob(state, { ok: false, error: reason, step: job.step, jobId: job.id, aborted: true });
  if (job.tabId) closeTikTokTab(job.tabId);
}

function waitTabComplete(tabId, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('a página demorou demais para carregar')); }, timeout);
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } };
    const onRem = (id) => { if (id === tabId) { cleanup(); reject(new Error('a aba foi fechada')); } };
    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpd);
      chrome.tabs.onRemoved.removeListener(onRem);
    }
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.onRemoved.addListener(onRem);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') { cleanup(); resolve(); } }).catch(() => {});
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function finishJob(state, result) {
  const rt = state.runtime;
  const job = rt.currentJob;
  if (!job || (result.jobId && result.jobId !== job.id)) return lateResult(state, result);
  rt.currentJob = null;
  rt.recentJobs = [{ id: job.id, path: job.path, product: job.product, productName: job.productName, caption: job.caption, captionMeta: job.captionMeta, dryRun: job.dryRun }, ...(rt.recentJobs || [])].slice(0, 5);
  const s = state.settings;
  const v = state.videos[job.path];
  const product = state.products[job.product];
  const now = Date.now();
  const durationMs = now - job.startedAt;

  if (job.dryRun) {
    addHistory(state, {
      status: result.ok ? 'dry-run' : 'failed', dryRun: true, product: job.product, productName: job.productName,
      video: job.path, caption: job.caption, error: result.error, step: result.step, diag: result.diag, durationMs, log: result.log,
      linkedProduct: result.linkedProduct,
    });
    rt.lastTestAt = now;
    rt.lastTestOk = !!result.ok;
    if (result.ok && product && job.linkProduct) {
      state.products[job.product] = { ...product, linkTestedAt: now, linkTestedKey: job.linkKey, linkTestedMatch: result.linkedProduct || null };
    }
    await save({ runtime: rt, history: state.history, products: state.products });
    notify(result.ok ? 'Teste concluído ✅' : 'Teste falhou ❌', result.ok ? 'Tudo preenchido. A aba ficou aberta para você conferir (nada foi publicado).' : `${result.step}: ${result.error}`);
    return;
  }

  if (!result.ok && result.loggedOut) {
    // Sessão do TikTok caiu: não é culpa do vídeo. Pausa tudo até você entrar de novo.
    if (job.tabId) rt.staleTabId = job.tabId;
    addHistory(state, {
      status: 'failed', product: job.product, productName: job.productName, video: job.path,
      error: 'Você não está logado no TikTok neste Chrome. Entre na sua conta e clique em Iniciar.', step: result.step, diag: result.diag, durationMs, log: result.log,
    });
    rt.retry = null;
    if (rt.running) {
      rt.running = false;
      rt.nextRunAt = null;
      rt.pausedReason = 'logged-out';
    }
    await save({ runtime: rt, history: state.history });
    syncPower(rt, s);
    notify('AutoPoster pausado: TikTok deslogado 🔒', 'Entre na sua conta do TikTok neste Chrome e clique em Iniciar no painel.');
    return;
  }

  if (result.ok) {
    if (v) state.videos[job.path] = { ...v, status: 'posted', postedAt: now, caption: job.caption };
    if (product) {
      state.products[job.product] = {
        ...product, lastPostedAt: now,
        ...rememberCaption(product, { text: job.caption, ...(job.captionMeta || {}) }),
        ...(job.linkProduct ? { linkTestedAt: now, linkTestedKey: job.linkKey, linkTestedMatch: result.linkedProduct || product.linkTestedMatch || null } : {}),
      };
    }
    rt.lastProduct = job.product;
    rt.consecutiveFailures = 0;
    rt.lastPostAt = now;
    addHistory(state, {
      status: 'posted', product: job.product, productName: job.productName, video: job.path,
      caption: job.caption, durationMs, url: result.url, attempt: job.attempt, log: result.log, linkedProduct: result.linkedProduct,
    });
    if (rt.running) rt.nextRunAt = computeNextRun(now, s);
    if (s.telegramEnabled && s.telegramEachPost) {
      telegramFromSettings(`✅ Publicado: ${job.productName} (${job.path.split('/').pop()})${result.linkedProduct ? `\n🛒 ${result.linkedProduct.slice(0, 80)}` : ''}`);
    }
  } else if (result.clickedPublish || (result.aborted && job.step === 'Publicando')) {
    // Falhou DEPOIS de clicar em Publicar: o vídeo pode ter saído. Não tenta de novo (evita post duplicado).
    if (job.tabId && !result.aborted) rt.staleTabId = job.tabId;
    if (v) state.videos[job.path] = { ...v, status: 'unconfirmed', failedAt: now, lastError: result.error };
    addHistory(state, {
      status: 'unconfirmed', product: job.product, productName: job.productName, video: job.path, caption: job.caption,
      error: result.error + ' — confira em "Meus posts" no TikTok Studio se o vídeo saiu.', step: result.step, diag: result.diag, durationMs, attempt: job.attempt, log: result.log,
      linkedProduct: result.linkedProduct,
    });
    rt.retry = null;
    if (rt.running) rt.nextRunAt = computeNextRun(now, s);
    notify('AutoPoster: confira o último post', `Cliquei em Publicar, mas não vi a confirmação (${job.productName}). Confira no TikTok Studio; não vou repetir esse vídeo.`);
  } else {
    if (job.tabId && !result.aborted) rt.staleTabId = job.tabId;
    rt.consecutiveFailures = (rt.consecutiveFailures || 0) + 1;
    const willRetry = job.attempt <= (s.maxRetries ?? 1);
    if (!willRetry && v) state.videos[job.path] = { ...v, status: 'failed', failedAt: now, lastError: result.error };
    addHistory(state, {
      status: 'failed', product: job.product, productName: job.productName, video: job.path, caption: job.caption,
      error: result.error, step: result.step, diag: result.diag, durationMs, attempt: job.attempt, willRetry, log: result.log,
    });
    if (rt.running) {
      if (rt.consecutiveFailures >= (s.pauseAfterFailures || 3)) {
        rt.running = false;
        rt.nextRunAt = null;
        rt.pausedReason = 'failures';
        notify('AutoPoster pausado ⚠️', `${rt.consecutiveFailures} falhas seguidas. Último erro: ${result.error}`);
      } else {
        rt.retry = willRetry ? { path: job.path, attempt: job.attempt } : null;
        rt.nextRunAt = now + (willRetry ? 3 : 10) * MIN;
        notify('AutoPoster: falha ao postar', `${result.step || ''}: ${result.error}${willRetry ? ' — vou tentar de novo em 3 min.' : ''}`);
      }
    }
  }
  await save({ runtime: rt, history: state.history, videos: state.videos, products: state.products });
  syncPower(rt, s);

  if (job.tabId && (result.ok ? s.closeTabAfter : false)) {
    setTimeout(() => closeTikTokTab(job.tabId), 4000);
  }
}

// Resultado que chegou depois de a extensão ter desistido da postagem (tempo esgotado etc.).
// Se a página diz que publicou, registra como publicado para o vídeo não ser postado de novo.
async function lateResult(state, result) {
  const rec = (state.runtime.recentJobs || []).find((j) => j.id === result.jobId);
  if (!rec || rec.dryRun || !result.ok) return;
  const v = state.videos[rec.path];
  const now = Date.now();
  if (v) state.videos[rec.path] = { ...v, status: 'posted', postedAt: now, caption: rec.caption };
  const product = state.products[rec.product];
  if (product) state.products[rec.product] = { ...product, lastPostedAt: now, ...rememberCaption(product, { text: rec.caption, ...(rec.captionMeta || {}) }) };
  if (state.runtime.retry?.path === rec.path) state.runtime.retry = null;
  addHistory(state, { status: 'posted', product: rec.product, productName: rec.productName, video: rec.path, caption: rec.caption, url: result.url, log: result.log, linkedProduct: result.linkedProduct, late: true });
  await save({ runtime: state.runtime, history: state.history, videos: state.videos, products: state.products });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  locked(async () => {
    const state = await load();
    const job = state.runtime.currentJob;
    if (job && job.tabId === tabId) await finishJob(state, { ok: false, error: 'A aba do TikTok foi fechada durante a postagem.', step: job.step, jobId: job.id });
  });
});

// ---------- mensagens (página do TikTok e painel) ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;

  if (msg.type === 'job-progress') {
    locked(async () => {
      const state = await load();
      const job = state.runtime.currentJob;
      if (job && job.id === msg.jobId) {
        job.step = msg.step || job.step;
        job.lastProgressAt = Date.now();
        await save({ runtime: state.runtime });
      }
    });
    return false;
  }
  if (msg.type === 'sleep') {
    // espera feita aqui para não sofrer o atraso de timers de abas em segundo plano
    setTimeout(() => sendResponse(true), Math.min(Math.max(Number(msg.ms) || 0, 0), 60000));
    return true;
  }
  if (msg.type === 'job-result') {
    locked(async () => finishJob(await load(), msg));
    return false;
  }
  if (msg.type === 'cmd') {
    locked(() => command(msg.name, msg.payload || {}))
      .then((r) => sendResponse(r || { ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }
  return false;
});

async function command(name, p) {
  const state = await load();
  const rt = state.runtime;
  switch (name) {
    case 'start':
      rt.running = true;
      rt.consecutiveFailures = 0;
      rt.pausedReason = null;
      rt.nextRunAt = Date.now() + MIN;
      await save({ runtime: rt });
      await ensureAlarm();
      syncPower(rt, state.settings);
      return { ok: true };
    case 'pause':
      rt.running = false;
      rt.nextRunAt = null;
      rt.retry = null;
      rt.pausedReason = null;
      await save({ runtime: rt });
      syncPower(rt, state.settings);
      return { ok: true };
    case 'telegram-test': {
      const t = p.token || state.settings.telegramToken;
      const c = p.chatId || state.settings.telegramChatId;
      if (!t || !c) return { ok: false, error: 'Preencha o token do bot e o chat ID.' };
      try { await telegramSend(t, c, '✅ Teste: os avisos do AutoPoster vão chegar aqui.'); return { ok: true }; } catch (e) { return { ok: false, error: 'Telegram: ' + e.message }; }
    }
    case 'telegram-find-chat': {
      const t = (p.token || '').trim();
      if (!t) return { ok: false, error: 'Cole o token do bot primeiro.' };
      try {
        const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(t)}/getUpdates`);
        const data = await res.json();
        if (!data.ok) return { ok: false, error: 'Telegram: ' + (data.description || 'token inválido') };
        const msgs = (data.result || []).map((u) => u.message || u.channel_post || u.my_chat_member).filter(Boolean);
        const last = msgs[msgs.length - 1];
        if (!last?.chat?.id) return { ok: false, error: 'Mande qualquer mensagem para o seu bot no Telegram e clique de novo.' };
        return { ok: true, chatId: String(last.chat.id), name: last.chat.first_name || last.chat.title || '' };
      } catch (e) { return { ok: false, error: 'Telegram: ' + e.message }; }
    }
    case 'export': {
      const data = await chrome.storage.local.get(['settings', 'products', 'videos']);
      return { ok: true, data: { app: 'autoposter-tiktok-shop', version: 1, exportedAt: new Date().toISOString(), ...data } };
    }
    case 'import': {
      const d = p.data || {};
      if (d.app !== 'autoposter-tiktok-shop' || typeof d.products !== 'object') return { ok: false, error: 'Esse arquivo não é um backup do AutoPoster.' };
      const settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
      settings.labels = { ...DEFAULT_LABELS, ...(settings.labels || {}) };
      rt.running = false;
      rt.nextRunAt = null;
      rt.retry = null;
      await save({ settings, products: d.products || {}, videos: d.videos || state.videos, runtime: rt });
      syncPower(rt, settings);
      return { ok: true, products: Object.keys(d.products || {}).length };
    }
    case 'post-now':
      return startJob(state, { dryRun: false, videoPath: p.path });
    case 'dry-run':
      return startJob(state, { dryRun: true, videoPath: p.path });
    case 'cancel-job':
      if (rt.currentJob) await abortJob(state, 'Cancelado por você.');
      return { ok: true };
    case 'rescan': {
      const r = await rescan(state);
      if (r.ok) await save({ videos: state.videos, products: state.products, runtime: rt });
      return r;
    }
    case 'save-settings': {
      const settings = { ...state.settings, ...p.settings };
      await save({ settings });
      if (rt.running && rt.nextRunAt && p.reschedule) {
        rt.nextRunAt = computeNextRun(Date.now(), settings);
        await save({ runtime: rt });
      }
      return { ok: true };
    }
    case 'save-product': {
      const prev = state.products[p.folder];
      if (!prev) return { ok: false, error: 'Produto não encontrado.' };
      const next = { ...prev, ...p.data, folder: p.folder };
      if ('productQuery' in p.data || 'productId' in p.data) {
        next.configured = !!(String(next.productId || '').trim() || String(next.productQuery || '').trim());
        if (linkKey(next) !== linkKey(prev)) next.linkTestedAt = null;
      }
      state.products[p.folder] = next;
      await save({ products: state.products });
      return { ok: true };
    }
    case 'set-video-status': {
      for (const path of p.paths || []) {
        const v = state.videos[path];
        if (v) state.videos[path] = { ...v, status: p.status, ...(p.status === 'pending' ? { lastError: null } : {}), ...(p.status === 'posted' && !v.postedAt ? { postedAt: Date.now() } : {}) };
      }
      await save({ videos: state.videos });
      return { ok: true };
    }
    case 'set-next-run':
      rt.nextRunAt = p.ts;
      await save({ runtime: rt });
      return { ok: true };
    case 'clear-history':
      await save({ history: [] });
      return { ok: true };
    case 'reset-all':
      await chrome.storage.local.clear();
      await save({ settings: DEFAULT_SETTINGS });
      return { ok: true };
    case 'inspect': {
      // Diagnóstico: lê os elementos visíveis de uma aba do TikTok Studio já aberta.
      const tabs = await chrome.tabs.query({ url: 'https://www.tiktok.com/tiktokstudio/*' });
      if (!tabs.length) return { ok: false, error: 'Abra o TikTok Studio (página de upload) em uma aba primeiro.' };
      const tab = tabs.find((t) => t.active) || tabs[0];
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/tiktok.js'] });
      const diag = await chrome.tabs.sendMessage(tab.id, { type: 'inspect' });
      return { ok: true, diag };
    }
    default:
      return { ok: false, error: 'Comando desconhecido: ' + name };
  }
}

ensureAlarm();
