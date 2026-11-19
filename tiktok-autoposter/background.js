// Service worker: agenda, escolhe o próximo vídeo, abre o TikTok Studio e coordena a postagem.
import { DEFAULT_SETTINGS, DEFAULT_LABELS, mergeLabels } from './lib/defaults.js';
import {
  computeNextRun, countPostedToday, pickNext, mergeScan, isWithinActiveHours, isLinkReady, productBlocked, linkKey,
  migrate, productKeyOf, itemOf, newCatalogKey, hash, nextSlot, computeNextSession, sessionHorizon, ceilToStep,
} from './lib/scheduler.js';
import { generateCaption, rememberCaption } from './lib/captions.js';
import { mergeShowcase } from './lib/showcase.js';
import { firstUrl } from './lib/productlink.js';

const MIN = 60 * 1000;
const JOB_TIMEOUT_MS = 35 * MIN;     // limite total de uma postagem
const JOB_SILENCE_MS = 6 * MIN;      // sem nenhum sinal da página por esse tempo = travou
const HISTORY_LIMIT = 800;

// ---------- estado ----------
async function load() {
  const s = await chrome.storage.local.get(['settings', 'catalog', 'folders', 'products', 'videos', 'history', 'runtime']);
  const settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  settings.labels = mergeLabels(settings.labels);
  // 1.7: a ordem antiga padrão ("pelo nome") vira a ordem inteligente uma única vez
  if (!settings.orderV2) {
    if (settings.videoOrder === 'name') settings.videoOrder = 'smart';
    settings.orderV2 = true;
    await chrome.storage.local.set({ settings });
  }
  // 1.7.1: a aba do TikTok passa a abrir na frente (as teclas de comando precisam da página visível)
  if (!settings.fgV2) {
    settings.foregroundTab = true;
    settings.fgV2 = true;
    await chrome.storage.local.set({ settings });
  }
  // 2.0: passa a agendar pelo próprio TikTok (abre o TikTok Studio só poucas vezes por dia)
  if (!settings.schedV2) {
    settings.publishMode = 'schedule';
    settings.schedV2 = true;
    await chrome.storage.local.set({ settings });
  }
  let state = {
    settings,
    catalog: s.catalog,
    folders: s.folders,
    products: s.products,
    videos: s.videos || {},
    history: s.history || [],
    runtime: { running: false, nextRunAt: null, currentJob: null, lastProduct: null, consecutiveFailures: 0, ...(s.runtime || {}) },
  };
  // versão antiga: 1 produto por pasta → catálogo de produtos + pastas
  const m = migrate(state);
  if (m.changed) {
    state = m.state;
    await save({ catalog: state.catalog, folders: state.folders, videos: state.videos, runtime: state.runtime });
    await chrome.storage.local.remove('products');
  }
  delete state.products;
  return state;
}

const save = (patch) => chrome.storage.local.set(patch);
const saveAll = (state, extra = {}) => save({ runtime: state.runtime, history: state.history, videos: state.videos, catalog: state.catalog, folders: state.folders, ...extra });

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
  // capturas de tela ocupam espaço: guarda só as 15 mais recentes
  let shots = 0;
  state.history = state.history.map((h) => (h.shot && ++shots > 15 ? { ...h, shot: null } : h));
}

const fmtEntries = (entries) => (entries || []).map((e) => (typeof e === 'string' ? e : `${new Date(e.t).toLocaleTimeString('pt-BR')} [${e.s || '-'}] ${e.m}`));

// Captura a tela da aba do TikTok (para o registro de erros e dos testes).
async function screenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https:\/\/www\.tiktok\.com\//.test(tab.url || '')) return null;
    let restore = null;
    if (!tab.active) {
      const [act] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      restore = act?.id || null;
      await chrome.tabs.update(tabId, { active: true });
      await sleep(800);
    }
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
    if (restore) chrome.tabs.update(restore, { active: true }).catch(() => {});
    return url;
  } catch (e) {
    log('screenshot', e?.message || e);
    return null;
  }
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
    // "display" mantém a tela ligada: com a tela desligada o Windows economiza energia na rede e no
    // Chrome, e a página do TikTok pode nem carregar de madrugada
    if (rt?.running && settings?.keepAwake !== false) chrome.power.requestKeepAwake(settings?.keepScreenOn !== false ? 'display' : 'system');
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
  const scheduled = today.filter((h) => h.status === 'scheduled').length;
  const failed = today.filter((h) => h.status === 'failed').length;
  const check = Object.values(state.videos).filter((v) => v.status === 'unconfirmed').length;
  const pending = Object.values(state.videos).filter((v) => v.status === 'pending').length;
  const lines = [
    `📊 Resumo de hoje`,
    s.publishMode === 'schedule' ? `🗓 Agendados hoje no TikTok: ${scheduled}` : `✅ Publicados: ${posted}`,
    `❌ Falhas: ${failed}`,
    check ? `⚠️ Para conferir no TikTok: ${check}` : null,
    `🎬 Vídeos na fila: ${pending}`,
    rt.running ? `▶️ Rodando${s.publishMode === 'schedule'
      ? (rt.nextSessionAt ? ` — próxima sessão ~${hm(rt.nextSessionAt)}` : '')
      : (rt.nextRunAt ? ` — próximo post ~${hm(rt.nextRunAt)}` : '')}` : '⏸ Pausado',
  ].filter(Boolean);
  telegramSend(s.telegramToken, s.telegramChatId, lines.join('\n')).catch((e) => log('telegram summary', e));
}

const hm = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayHm = (ts) => {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? 'hoje' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hm(ts)}`;
};

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
  state.folders = merged.folders;
  state.runtime.folderName = res.folderName;
  state.runtime.lastScanAt = Date.now();
  const restored = await maybeRestore(state);
  return { ok: true, added: merged.added, missing: merged.missing, total: res.files.length, restored };
}

// ---------- cópia de segurança na pasta de vídeos ----------
// Assim uma instalação nova da extensão (ou outro computador) recupera tudo ao escolher a pasta.
function backupPayload(state) {
  const videos = {};
  for (const [p, v] of Object.entries(state.videos)) {
    if (v.status !== 'pending' || v.catalogKey) videos[p] = { status: v.status, postedAt: v.postedAt || null, catalogKey: v.catalogKey || null };
  }
  const folders = {};
  for (const [k, f] of Object.entries(state.folders)) folders[k] = { catalogKey: f.catalogKey || null };
  return { app: 'autoposter-tiktok-shop', kind: 'auto-backup', version: 3, settings: state.settings, catalog: state.catalog, folders, videos };
}

async function maybeBackup(state) {
  if (!state.runtime.folderName || !Object.keys(state.catalog || {}).length) return;
  const payload = backupPayload(state);
  const sig = String(hash(JSON.stringify(payload)));
  if (sig === state.runtime.backupSig) return;
  try {
    const r = await offscreen('write-backup', { json: JSON.stringify({ ...payload, savedAt: new Date().toISOString() }, null, 1) });
    if (r.ok) {
      state.runtime.backupSig = sig;
      state.runtime.backupAt = Date.now();
      state.runtime.backupError = null;
    } else {
      state.runtime.backupError = r.code === 'NO_WRITE' ? 'no-write' : r.error;
    }
    await save({ runtime: state.runtime });
  } catch (e) {
    log('backup', e);
  }
}

// Instalação nova (catálogo vazio) + cópia de segurança na pasta → restaura tudo.
async function maybeRestore(state) {
  if (Object.keys(state.catalog || {}).length) return false;
  let r;
  try { r = await offscreen('read-backup'); } catch (_) { return false; }
  const b = r?.data;
  if (!b || b.app !== 'autoposter-tiktok-shop' || !b.catalog || !Object.keys(b.catalog).length) return false;
  state.catalog = b.catalog;
  if (b.settings) {
    state.settings = { ...DEFAULT_SETTINGS, ...b.settings };
    state.settings.labels = mergeLabels(state.settings.labels);
  }
  for (const [k, f] of Object.entries(b.folders || {})) {
    if (state.folders[k] && f.catalogKey && state.catalog[f.catalogKey]) state.folders[k] = { ...state.folders[k], catalogKey: f.catalogKey };
  }
  for (const [p, v] of Object.entries(b.videos || {})) {
    const cur = state.videos[p];
    if (!cur) continue;
    state.videos[p] = { ...cur, status: cur.status === 'missing' ? 'missing' : v.status || cur.status, postedAt: v.postedAt || cur.postedAt, ...(v.catalogKey && state.catalog[v.catalogKey] ? { catalogKey: v.catalogKey } : {}) };
  }
  state.runtime.restoredAt = Date.now();
  state.runtime.backupSig = null;
  await save({ settings: state.settings });
  log('configurações restauradas da cópia de segurança da pasta');
  return true;
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
    if (state.runtime.session) state.runtime.session.tabId = null;
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
  if (!rt.currentJob) await maybeBackup(state);
  await maybeDailySummary(state);

  if (rt.currentJob) {
    const job = rt.currentJob;
    const lastSignal = job.lastProgressAt || job.startedAt;
    if (!job.contentStarted && now - job.startedAt > 4 * MIN) {
      await abortJob(state, 'A página do TikTok não chegou a funcionar (não carregou ou ficou congelada). Não é problema do vídeo.', { infra: true });
    } else if (now - job.startedAt > JOB_TIMEOUT_MS) {
      await abortJob(state, 'Tempo limite excedido (35 min).');
    } else if (now - lastSignal > JOB_SILENCE_MS) {
      await abortJob(state, 'A página do TikTok parou de responder.');
    }
    return;
  }
  // vídeos agendados cujo horário já passou: o TikTok publicou → "publicado"
  if (markScheduledAsPosted(state, now)) await save({ videos: state.videos });
  if (!rt.running) return;
  if (state.settings.publishMode === 'schedule') return scheduleTick(state, now);
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

function markScheduledAsPosted(state, now) {
  let changed = false;
  for (const [p, v] of Object.entries(state.videos)) {
    if (v.status === 'scheduled' && v.scheduledFor && v.scheduledFor <= now) {
      state.videos[p] = { ...v, status: 'posted', postedAt: v.scheduledFor };
      changed = true;
    }
  }
  return changed;
}

// ---------- modo agendamento: sessões ----------
// Fora das sessões nada é aberto. Numa sessão, a extensão agenda um vídeo por vez (na mesma aba),
// com uma pausa humana entre eles, até cobrir o período até a próxima sessão.
async function scheduleTick(state, now) {
  const rt = state.runtime;
  const s = state.settings;
  const ses = rt.session;
  if (ses) {
    if (now < (ses.nextJobAt || 0)) return;
    if (ses.done >= ses.max) return endSession(state, `limite de ${ses.max} vídeos por sessão`);
    const slot = nextSlot({ lastSlotAt: rt.lastSlotAt, now, settings: s, history: state.history, leadMin: 35 });
    if (!slot || slot > ses.until) return endSession(state, `agenda coberta até ${dayHm(rt.lastSlotAt || now)}`);
    const r = await startJob(state, { scheduleAt: slot, sessionId: ses.id });
    // sem vídeo / produto sem link / pasta sem acesso: termina a sessão (a próxima tenta de novo)
    if (!r.ok && !rt.currentJob) return endSession(state, r.error || 'nada para agendar', { quiet: true });
    return;
  }
  if (!rt.nextSessionAt) {
    rt.nextSessionAt = computeNextSession(now, s) || now + 60 * MIN;
    await save({ runtime: rt });
    return;
  }
  if (now < rt.nextSessionAt) return;
  await beginSession(state, now);
}

async function beginSession(state, now = Date.now()) {
  const rt = state.runtime;
  const s = state.settings;
  rt.session = {
    id: crypto.randomUUID(), startedAt: now, until: sessionHorizon(now, s),
    max: Math.max(1, Math.min(20, Number(s.perSessionMax) || 6)), done: 0, failed: 0, slots: [], nextJobAt: now, tabId: null,
  };
  rt.nextSessionAt = null;
  await save({ runtime: rt });
  log('sessão iniciada, cobrir até', new Date(rt.session.until).toString());
  return scheduleTick(state, now);
}

async function endSession(state, reason, { quiet = false, nextAt = null } = {}) {
  const rt = state.runtime;
  const ses = rt.session;
  if (!ses) return;
  rt.session = null;
  const now = Date.now();
  rt.nextSessionAt = nextAt || computeNextSession(now, state.settings) || now + 60 * MIN;
  if (ses.tabId && state.settings.closeTabAfter) setTimeout(() => closeTikTokTab(ses.tabId), 3000);
  if (ses.done || ses.failed) {
    const times = (ses.slots || []).map(hm).join(', ');
    addHistory(state, {
      status: 'session', productName: 'Sessão de agendamento',
      step: `${ses.done} vídeo(s) agendado(s)${times ? ` para ${times}` : ''}${ses.failed ? ` · ${ses.failed} falha(s)` : ''} · fim: ${reason}`,
      durationMs: now - ses.startedAt,
    });
    if (state.settings.telegramEnabled && state.settings.telegramEachPost && !quiet) {
      telegramFromSettings(`🗓 Sessão concluída: ${ses.done} vídeo(s) agendado(s)${times ? ` (${times})` : ''}. Próxima sessão ~${dayHm(rt.nextSessionAt)}.`);
    }
  }
  log('sessão encerrada:', reason);
  await saveAll(state);
  syncPower(rt, state.settings);
}

// ---------- execução de uma postagem ----------
async function startJob(state, { dryRun, videoPath, manual, scheduleAt, sessionId } = {}) {
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
    const key = productKeyOf(state, v);
    if (!key) {
      await saveAll(state);
      return { ok: false, error: 'Esse vídeo ainda não tem produto. Escolha o produto da pasta ou do vídeo na tela Vídeos.' };
    }
    pick = { product: key, video: v };
  } else if (rt.retry && state.videos[rt.retry.path]?.status === 'pending'
    && !productBlocked(itemOf(state, state.videos[rt.retry.path]), state.settings)) {
    const v = state.videos[rt.retry.path];
    pick = { product: productKeyOf(state, v), video: v };
  } else {
    rt.retry = null;
    pick = pickNext(state);
  }

  if (!pick) {
    rt.nextRunAt = Date.now() + 15 * MIN;
    const already = state.history[0]?.status === 'idle';
    if (!already) {
      addHistory(state, { status: 'idle', error: 'Nenhum vídeo pendente com produto configurado. Adicione vídeos na pasta ou escolha o produto das pastas.' });
      if (rt.running) notify('AutoPoster: fila vazia', 'Não há vídeos pendentes para postar.');
    }
    await saveAll(state);
    return { ok: false, error: 'Nenhum vídeo pendente com produto configurado.' };
  }

  const product = state.catalog[pick.product];
  if (product?.enabled === false && videoPath) {
    await saveAll(state);
    return { ok: false, error: `O produto "${product.displayName}" está pausado.` };
  }
  if (product?.unavailable && videoPath && !dryRun && state.settings.linkProduct) {
    await saveAll(state);
    return { ok: false, error: `O produto "${product.displayName}" está indisponível na vitrine (sem estoque). Reative em Produtos quando voltar.` };
  }
  if (state.settings.linkProduct && !isLinkReady(product)) {
    const msg = `Configure o link do produto "${product?.displayName || pick.product}" antes de postar (Produtos → Editar).`;
    if (!videoPath && rt.running) {
      rt.retry = null;
      rt.nextRunAt = Date.now() + MIN;
    }
    await saveAll(state);
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
    folder: pick.video.folder,
    product: pick.product,
    productName: product.displayName,
    linkProduct: !!state.settings.linkProduct,
    productId: state.settings.linkProduct ? String(product.productId || '').trim() : '',
    productLink: state.settings.linkProduct && product.productId ? (firstUrl(product.productUrl) || '') : '',
    productQuery: state.settings.linkProduct ? String(product.productQuery || '').trim() : '',
    linkKey: linkKey(product),
    productLabel: (product.productLabel || product.displayName || '').slice(0, 30),
    caption,
    captionMeta: { body: cap.body, hashtags: cap.hashtags, hook: cap.hook },
    brandedContent: !!state.settings.brandedContent,
    speed: state.settings.speed || 'human',
    log: [],
    dryRun: !!dryRun,
    attempt,
    manual: !!manual,
    // modo agendamento: horário de publicação a escolher em "Agendar" (null = publicar agora)
    scheduleAt: scheduleAt || (dryRun && state.settings.publishMode === 'schedule' ? ceilToStep(Date.now() + 75 * MIN) : null),
    sessionId: sessionId || null,
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
  await saveAll(state);
  log('start job', job.path, dryRun ? '(teste)' : '');

  try {
    // testes e "Postar agora" abrem na frente (para você acompanhar); os automáticos seguem a configuração
    const { labels, ...jobForPage } = job;
    const reuse = sessionId && rt.session?.id === sessionId ? rt.session.tabId : null;
    await openTikTokTab(state, job, !!(state.settings.foregroundTab || dryRun || videoPath || job.manual), { type: 'run-job', job: { ...jobForPage, labels } }, reuse);
  } catch (e) {
    await finishJob(state, { ok: false, error: 'Falha ao abrir o TikTok Studio: ' + (e.message || e), step: job.step, jobId: job.id, infra: true });
    return { ok: false, error: String(e.message || e) };
  }
  return { ok: true, jobId: job.id };
}

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'tempo esgotado')), ms))]);

function jobLog(job, m) {
  job.log = [...(job.log || []), { t: Date.now(), s: 'Abrindo o TikTok Studio', m }].slice(-500);
}

// Abre a aba do TikTok Studio e entrega a tarefa ao script da página, registrando cada passo.
// Se a página não carregar, recarrega uma vez. Tudo com tempo-limite, para nada ficar pendurado.
async function openTikTokTab(state, job, active, message, reuseTabId = null) {
  const rt = state.runtime;
  let tab = null;
  if (reuseTabId) {
    // na sessão de agendamento, o próximo vídeo usa a mesma aba (como quem clica em "Carregar" de novo)
    try {
      const old = await chrome.tabs.get(reuseTabId);
      if (/^https:\/\/www\.tiktok\.com\//.test(old.url || '')) {
        await cdpRelease(reuseTabId);
        tab = await chrome.tabs.update(reuseTabId, { url: state.settings.uploadUrl, ...(active ? { active: true } : {}) });
        await sleep(2000);
      }
    } catch (_) { tab = null; }
  }
  if (!tab) tab = await chrome.tabs.create({ url: state.settings.uploadUrl, active });
  job.tabId = tab.id;
  jobLog(job, tab.id === reuseTabId ? 'mesma aba da sessão: abrindo o formulário de upload de novo' : `aba criada (${active ? 'na frente' : 'em segundo plano'})`);
  rt.currentJob = job;
  await save({ runtime: rt });
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {}); // o Chrome não descarta a aba para economizar memória
  try {
    await waitTabComplete(tab.id, 90 * 1000);
  } catch (e) {
    if (/fechada/.test(e.message)) throw e;
    jobLog(job, 'a página não terminou de carregar em 90s → recarregando a aba');
    await save({ runtime: rt });
    await chrome.tabs.reload(tab.id);
    await waitTabComplete(tab.id, 75 * 1000);
  }
  const t = await chrome.tabs.get(tab.id);
  if (!/^https:\/\/www\.tiktok\.com\//.test(t.url || '')) throw new Error(`a aba não abriu o TikTok (endereço: ${(t.url || '?').slice(0, 80)}) — sem internet?`);
  jobLog(job, `página carregada: ${t.url.slice(0, 90)}`);
  await sleep(2500 + Math.random() * 2500);
  await withTimeout(chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/tiktok.js'] }), 30000, 'a página não aceitou o script (congelada)');
  jobLog(job, 'script da extensão injetado na página');
  await withTimeout(chrome.tabs.sendMessage(tab.id, message), 20000, 'a página não respondeu (congelada)');
  jobLog(job, 'tarefa entregue à página');
  await save({ runtime: rt });
}

function refillExhausted(state) {
  const pendingBy = {};
  for (const v of Object.values(state.videos)) if (v.status === 'pending') pendingBy[productKeyOf(state, v)] = true;
  for (const [key, p] of Object.entries(state.catalog)) {
    if (p.enabled === false || pendingBy[key]) continue;
    for (const v of Object.values(state.videos)) {
      // só recoloca vídeos que ainda existem na pasta
      if (productKeyOf(state, v) === key && v.status === 'posted' && !v.gone) state.videos[v.path] = { ...v, status: 'pending', cycle: (v.cycle || 1) + 1 };
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
async function abortJob(state, reason, extra = {}) {
  const job = state.runtime.currentJob;
  if (!job) return;
  if (job.tabId) {
    try { await withTimeout(chrome.tabs.sendMessage(job.tabId, { type: 'abort-job' }), 5000, ''); } catch (_) { /* página já fechada */ }
  }
  await finishJob(state, { ok: false, error: reason, step: job.step, jobId: job.id, aborted: true, ...extra });
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
  if (job.type === 'sync') return finishSync(state, result);
  // registro: o que a página mandou no final (com os passos de abertura da aba na frente),
  // ou o que foi chegando durante a postagem
  const opening = fmtEntries((job.log || []).filter((e) => e && e.s === 'Abrindo o TikTok Studio'));
  result.log = result.log && result.log.length ? [...opening, ...result.log] : fmtEntries(job.log);
  if (job.tabId && (!result.ok || job.dryRun) && !result.infra) result.shot = await withTimeout(screenshot(job.tabId), 8000, '').catch(() => null);
  rt.currentJob = null;
  if (job.tabId) cdpRelease(job.tabId);
  rt.recentJobs = [{ id: job.id, path: job.path, product: job.product, productName: job.productName, caption: job.caption, captionMeta: job.captionMeta, dryRun: job.dryRun, scheduleAt: job.scheduleAt || null }, ...(rt.recentJobs || [])].slice(0, 5);
  const s = state.settings;
  const v = state.videos[job.path];
  const product = state.catalog[job.product];
  const now = Date.now();
  const durationMs = now - job.startedAt;
  // postagem feita dentro de uma sessão de agendamento ainda ativa
  const ses = job.sessionId && rt.session?.id === job.sessionId ? rt.session : null;
  const humanGap = () => Math.round((2 + Math.random() * 3) * MIN); // pausa de 2 a 5 min entre vídeos da sessão
  if (ses && job.tabId) ses.tabId = job.tabId;

  // Produto "Indisponível" na vitrine: marca no catálogo e deixa os vídeos dele na fila.
  if (!result.ok && result.unavailable && product) {
    state.catalog[job.product] = { ...product, unavailable: true, unavailableAt: now };
  }

  if (job.dryRun) {
    addHistory(state, {
      status: result.ok ? 'dry-run' : 'failed', dryRun: true, product: job.product, productName: job.productName,
      video: job.path, caption: job.caption, error: result.error, step: result.step, diag: result.diag, durationMs, log: result.log,
      linkedProduct: result.linkedProduct, shot: result.shot, pageError: result.pageError,
    });
    rt.lastTestAt = now;
    rt.lastTestOk = !!result.ok;
    if (result.ok && product && job.linkProduct) {
      state.catalog[job.product] = { ...product, linkTestedAt: now, linkTestedKey: job.linkKey, linkTestedMatch: result.linkedProduct || null };
    }
    await saveAll(state);
    notify(result.ok ? 'Teste concluído ✅' : 'Teste falhou ❌', result.ok ? 'Tudo preenchido. A aba ficou aberta para você conferir (nada foi publicado).' : `${result.step}: ${result.error}`);
    return;
  }

  // Problema para abrir/rodar a página (internet, computador economizando energia, página congelada):
  // não é culpa do vídeo — não marca o vídeo, não conta para a pausa e tenta de novo com espera crescente.
  if (!result.ok && result.infra && !job.contentStarted) {
    if (job.tabId) closeTikTokTab(job.tabId);
    rt.infraFailures = (rt.infraFailures || 0) + 1;
    const waitMin = Math.min(5 * rt.infraFailures, 30);
    addHistory(state, {
      status: 'failed', infra: true, product: job.product, productName: job.productName, video: job.path, caption: job.caption,
      error: `${result.error} Não é problema do vídeo: ele continua na fila. Nova tentativa em ${waitMin} min.`, step: result.step || job.step, durationMs, log: result.log, shot: result.shot,
    });
    rt.retry = null;
    if (rt.running) rt.nextRunAt = now + waitMin * MIN;
    if (ses) {
      ses.tabId = null;
      await endSession(state, 'o TikTok não abriu', { quiet: true, nextAt: now + waitMin * MIN });
    }
    await saveAll(state);
    syncPower(rt, s);
    if (rt.infraFailures === 1 || rt.infraFailures % 6 === 0) {
      notify('AutoPoster: o TikTok não abriu', `${result.error} Vou tentar de novo em ${waitMin} min (tentativa ${rt.infraFailures}). Confira a internet e se o computador está ligado com a tela acesa.`);
    }
    return;
  }

  if (!result.ok && result.unavailable) {
    if (job.tabId && !ses) rt.staleTabId = job.tabId;
    if (ses) ses.nextJobAt = now + MIN;
    addHistory(state, {
      status: 'failed', product: job.product, productName: job.productName, video: job.path, caption: job.caption,
      error: result.error, step: result.step, diag: result.diag, durationMs, attempt: job.attempt, log: result.log, linkedProduct: result.linkedProduct, shot: result.shot,
    });
    rt.retry = null;
    if (rt.running) rt.nextRunAt = now + 2 * MIN; // segue com os outros produtos
    await saveAll(state);
    syncPower(rt, s);
    notify('AutoPoster: produto indisponível', `"${job.productName}" está sem estoque na sua vitrine. Os vídeos dele ficam na fila; reative o produto quando voltar.`);
    return;
  }

  if (!result.ok && result.loggedOut) {
    // Sessão do TikTok caiu: não é culpa do vídeo. Pausa tudo até você entrar de novo.
    if (job.tabId) rt.staleTabId = job.tabId;
    addHistory(state, {
      status: 'failed', product: job.product, productName: job.productName, video: job.path,
      error: 'Você não está logado no TikTok neste Chrome. Entre na sua conta e clique em Iniciar.', step: result.step, diag: result.diag, durationMs, log: result.log, shot: result.shot,
    });
    rt.retry = null;
    if (ses) await endSession(state, 'TikTok deslogado', { quiet: true });
    if (rt.running) {
      rt.running = false;
      rt.nextRunAt = null;
      rt.nextSessionAt = null;
      rt.pausedReason = 'logged-out';
    }
    await save({ runtime: rt, history: state.history });
    syncPower(rt, s);
    notify('AutoPoster pausado: TikTok deslogado 🔒', 'Entre na sua conta do TikTok neste Chrome e clique em Iniciar no painel.');
    return;
  }

  const scheduledAt = result.ok && job.scheduleAt ? (Number(result.scheduledAt) || job.scheduleAt) : null;
  if (result.ok) {
    if (v) {
      state.videos[job.path] = scheduledAt
        ? { ...v, status: 'scheduled', scheduledFor: scheduledAt, postedAt: scheduledAt, caption: job.caption }
        : { ...v, status: 'posted', postedAt: now, caption: job.caption };
    }
    if (product) {
      state.catalog[job.product] = {
        ...product, lastPostedAt: now,
        ...rememberCaption(product, { text: job.caption, ...(job.captionMeta || {}) }),
        ...(job.linkProduct ? { linkTestedAt: now, linkTestedKey: job.linkKey, linkTestedMatch: result.linkedProduct || product.linkTestedMatch || null } : {}),
      };
    }
    rt.lastProduct = job.product;
    rt.consecutiveFailures = 0;
    rt.infraFailures = 0;
    rt.lastPostAt = now;
    addHistory(state, {
      status: scheduledAt ? 'scheduled' : 'posted', publishAt: scheduledAt || now, product: job.product, productName: job.productName, video: job.path,
      caption: job.caption, durationMs, url: result.url, attempt: job.attempt, log: result.log, linkedProduct: result.linkedProduct,
    });
    if (scheduledAt) {
      rt.lastSlotAt = Math.max(rt.lastSlotAt || 0, scheduledAt);
      if (ses) {
        ses.done++;
        ses.slots = [...(ses.slots || []), scheduledAt];
        ses.nextJobAt = now + humanGap();
      }
    } else if (rt.running && s.publishMode !== 'schedule') rt.nextRunAt = computeNextRun(now, s);
    if (s.telegramEnabled && s.telegramEachPost && !ses) {
      telegramFromSettings(`${scheduledAt ? `🗓 Agendado para ${dayHm(scheduledAt)}` : '✅ Publicado'}: ${job.productName} (${job.path.split('/').pop()})${result.linkedProduct ? `\n🛒 ${result.linkedProduct.slice(0, 80)}` : ''}`);
    }
  } else if (result.clickedPublish || (result.aborted && job.step === 'Publicando')) {
    // Falhou DEPOIS de clicar em Publicar: o vídeo pode ter saído. Não tenta de novo (evita post duplicado).
    if (job.tabId && !result.aborted && !ses) rt.staleTabId = job.tabId;
    if (v) state.videos[job.path] = { ...v, status: 'unconfirmed', failedAt: now, lastError: result.error, ...(job.scheduleAt ? { scheduledFor: result.scheduledAt || job.scheduleAt } : {}) };
    // pode ter sido agendado: o próximo horário não encosta neste
    if (job.scheduleAt) rt.lastSlotAt = Math.max(rt.lastSlotAt || 0, result.scheduledAt || job.scheduleAt);
    if (ses) ses.nextJobAt = now + humanGap();
    addHistory(state, {
      status: 'unconfirmed', product: job.product, productName: job.productName, video: job.path, caption: job.caption,
      error: result.error + (job.scheduleAt ? ' — confira em "Publicações" no TikTok Studio se o vídeo ficou agendado.' : ' — confira em "Meus posts" no TikTok Studio se o vídeo saiu.'), step: result.step, diag: result.diag, durationMs, attempt: job.attempt, log: result.log,
      linkedProduct: result.linkedProduct, shot: result.shot,
    });
    rt.retry = null;
    if (rt.running && s.publishMode !== 'schedule') rt.nextRunAt = computeNextRun(now, s);
    notify('AutoPoster: confira o último post', `Cliquei em ${job.scheduleAt ? 'Agendar' : 'Publicar'}, mas não vi a confirmação (${job.productName}). Confira no TikTok Studio; não vou repetir esse vídeo.`);
  } else {
    if (job.tabId && !result.aborted && !ses) rt.staleTabId = job.tabId;
    if (ses) ses.failed = (ses.failed || 0) + 1;
    rt.consecutiveFailures = (rt.consecutiveFailures || 0) + 1;
    const willRetry = job.attempt <= (s.maxRetries ?? 1);
    if (!willRetry && v) state.videos[job.path] = { ...v, status: 'failed', failedAt: now, lastError: result.error };
    addHistory(state, {
      status: 'failed', product: job.product, productName: job.productName, video: job.path, caption: job.caption,
      error: result.error, step: result.step, diag: result.diag, durationMs, attempt: job.attempt, willRetry, log: result.log,
      linkedProduct: result.linkedProduct, shot: result.shot, pageError: result.pageError,
    });
    if (rt.running) {
      if (rt.consecutiveFailures >= (s.pauseAfterFailures || 3)) {
        if (ses) await endSession(state, 'pausado após falhas seguidas', { quiet: true });
        rt.running = false;
        rt.nextRunAt = null;
        rt.nextSessionAt = null;
        rt.pausedReason = 'failures';
        notify('AutoPoster pausado ⚠️', `${rt.consecutiveFailures} falhas seguidas. Último erro: ${result.error}`);
      } else {
        rt.retry = willRetry ? { path: job.path, attempt: job.attempt } : null;
        rt.nextRunAt = now + (willRetry ? 3 : 10) * MIN;
        if (ses) ses.nextJobAt = now + (willRetry ? 3 : 2) * MIN;
        notify('AutoPoster: falha ao postar', `${result.step || ''}: ${result.error}${willRetry ? ' — vou tentar de novo em 3 min.' : ''}`);
      }
    }
  }
  await saveAll(state);
  syncPower(rt, s);

  // na sessão, a aba continua aberta para o próximo vídeo (é fechada no fim da sessão)
  if (job.tabId && !ses && (result.ok ? s.closeTabAfter : false)) {
    setTimeout(() => closeTikTokTab(job.tabId), 4000);
  }
}

// ---------- teclado de verdade (protocolo de automação do Chrome) ----------
// O editor de legenda do TikTok só aceita digitação real: texto "simulado" ou não é registrado
// (o post sai com o nome do arquivo) ou trava a página ("Ocorreu um erro"). Aqui as teclas são
// enviadas pelo próprio Chrome, idênticas às de um teclado.
const KEYS = {
  // "commands" faz o Chrome executar a edição mesmo quando a tecla de atalho não chega à página
  selectAll: { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] }, // Ctrl+A
  backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, commands: ['deleteBackward'] },
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  end: { key: 'End', code: 'End', windowsVirtualKeyCode: 35, modifiers: 2 }, // Ctrl+End
};
// Deixa a aba visível dentro do Chrome (sem roubar o foco de outros programas, a menos que a janela esteja minimizada).
async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) await chrome.tabs.update(tabId, { active: true });
    const win = await chrome.windows.get(tab.windowId);
    if (win.state === 'minimized') await chrome.windows.update(tab.windowId, { state: 'normal' });
  } catch (_) { /* aba fechada */ }
}

// O depurador fica ligado na aba durante a postagem inteira (a faixa "AutoPoster está depurando
// este navegador" aparece uma vez, sem mexer no layout no meio dos cliques). Só o domínio de
// entrada (mouse/teclado) é usado: nada de scripts injetados por ele.
const attached = new Set();
chrome.debugger.onDetach.addListener((src) => { if (src.tabId) attached.delete(src.tabId); });
async function cdpAttach(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(String(e?.message))) throw e;
  }
  attached.add(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
}
async function cdpRelease(tabId) {
  if (!tabId) return;
  const was = attached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch (_) { if (was) log('detach'); }
}
const attachError = (e) => `não consegui usar o mouse/teclado do Chrome (${e.message}). Feche as Ferramentas do desenvolvedor (F12) nessa aba, se estiverem abertas.`;

async function cdpType(tabId, actions) {
  if (!tabId) return { ok: false, error: 'aba desconhecida' };
  const target = { tabId };
  try { await cdpAttach(tabId); } catch (e) { return { ok: false, error: attachError(e) }; }
  try {
    // Teclas de comando (Ctrl+A, Backspace, Enter) só valem com a página "em foco":
    // traz a aba para a frente no Chrome e liga o modo de foco do próprio Chrome.
    await focusTab(tabId);
    await chrome.debugger.sendCommand(target, 'Page.bringToFront').catch(() => {});
    await sleep(250);
    for (const a of actions) {
      if (a.text) {
        await chrome.debugger.sendCommand(target, 'Input.insertText', { text: a.text });
      } else if (a.key) {
        const k = KEYS[a.key];
        if (!k) continue;
        const { text, ...rest } = k;
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...rest, ...(text ? { text, unmodifiedText: text } : {}) });
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...rest });
      }
      if (a.wait) await sleep(a.wait);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'falha ao digitar: ' + (e.message || e) };
  }
}

// Mouse de verdade: o ponteiro percorre o caminho, para em cima do alvo, pressiona e solta.
// Para o site, é idêntico a uma pessoa usando o mouse (eventos "confiáveis").
async function cdpMouse(tabId, { points = [], x, y, hover = 200, hold = 90, wheel = null }) {
  if (!tabId) return { ok: false, error: 'aba desconhecida' };
  const target = { tabId };
  try { await cdpAttach(tabId); } catch (e) { return { ok: false, error: attachError(e) }; }
  try {
    await focusTab(tabId);
    const zoom = await chrome.tabs.getZoom(tabId).catch(() => 1) || 1;
    const Z = (n) => Math.round(n * zoom * 100) / 100;
    for (const p of points) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Z(p.x), y: Z(p.y), button: 'none', buttons: 0 });
      await sleep(Math.max(5, Math.min(120, p.w || 20)));
    }
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Z(x), y: Z(y), button: 'none', buttons: 0 });
    if (wheel) {
      for (const dy of wheel.deltas || []) {
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: Z(x), y: Z(y), deltaX: 0, deltaY: dy, button: 'none', buttons: 0 });
        await sleep(40 + Math.random() * 90);
      }
      return { ok: true };
    }
    await sleep(Math.max(30, Math.min(1500, hover)));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: Z(x), y: Z(y), button: 'left', buttons: 1, clickCount: 1 });
    await sleep(Math.max(30, Math.min(400, hold)));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: Z(x), y: Z(y), button: 'left', buttons: 0, clickCount: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'falha no clique: ' + (e.message || e) };
  }
}

// ---------- importar a vitrine ----------
async function startSync(state) {
  const rt = state.runtime;
  if (rt.currentJob) return { ok: false, error: 'Espere a postagem em andamento terminar.' };
  const scan = await rescan(state);
  if (!scan.ok) return { ok: false, error: scan.error || 'Não foi possível ler a pasta de vídeos.' };
  const v = Object.values(state.videos).filter((x) => x.status !== 'missing').sort((a, b) => (a.size || 0) - (b.size || 0))[0];
  if (!v) return { ok: false, error: 'Coloque pelo menos um vídeo na pasta: ele é usado só para abrir o formulário (nada é publicado).' };
  const job = {
    id: crypto.randomUUID(), type: 'sync', path: v.path, productName: 'Vitrine', startedAt: Date.now(), lastProgressAt: Date.now(),
    step: 'Abrindo o TikTok Studio', labels: state.settings.labels, speed: state.settings.speed || 'human', log: [],
  };
  rt.currentJob = job;
  await saveAll(state);
  try {
    await openTikTokTab(state, job, true, { type: 'run-sync', job });
  } catch (e) {
    await finishSync(state, { ok: false, error: 'Falha ao abrir o TikTok Studio: ' + (e.message || e), jobId: job.id });
    return { ok: false, error: String(e.message || e) };
  }
  return { ok: true, jobId: job.id };
}

async function finishSync(state, result) {
  const rt = state.runtime;
  const job = rt.currentJob;
  if (!job || job.type !== 'sync' || (result.jobId && result.jobId !== job.id)) return;
  result.log = result.log && result.log.length ? result.log : fmtEntries(job.log);
  if (!result.ok && job.tabId) result.shot = await screenshot(job.tabId);
  rt.currentJob = null;
  if (job.tabId) cdpRelease(job.tabId);
  const now = Date.now();
  let msg;
  if (result.ok) {
    const { added, updated } = mergeShowcase(state.catalog, result.items, now);
    const unavailable = (result.items || []).filter((i) => i.status === 'indisponivel').length;
    rt.lastSyncAt = now;
    msg = `${(result.items || []).length} produtos na vitrine · ${added} novos no catálogo · ${updated} atualizados${unavailable ? ` · ${unavailable} indisponíveis` : ''}`;
    addHistory(state, { status: 'sync', productName: 'Vitrine importada', error: null, step: msg, log: result.log, durationMs: now - job.startedAt });
    if (job.tabId) setTimeout(() => closeTikTokTab(job.tabId), 1500);
    notify('Vitrine importada ✅', msg, { telegram: false });
  } else {
    addHistory(state, { status: 'failed', productName: 'Importar vitrine', error: result.error, step: result.step, diag: result.diag, log: result.log, shot: result.shot, durationMs: now - job.startedAt });
    notify('Importar vitrine falhou ❌', `${result.step || ''}: ${result.error}`, { telegram: false });
  }
  await saveAll(state);
  return { ok: !!result.ok, message: msg };
}

// Resultado que chegou depois de a extensão ter desistido da postagem (tempo esgotado etc.).
// Se a página diz que publicou, registra como publicado para o vídeo não ser postado de novo.
async function lateResult(state, result) {
  const rec = (state.runtime.recentJobs || []).find((j) => j.id === result.jobId);
  if (!rec || rec.dryRun || !result.ok) return;
  const v = state.videos[rec.path];
  const now = Date.now();
  const at = rec.scheduleAt ? (Number(result.scheduledAt) || rec.scheduleAt) : null;
  if (v) state.videos[rec.path] = at ? { ...v, status: 'scheduled', scheduledFor: at, postedAt: at, caption: rec.caption } : { ...v, status: 'posted', postedAt: now, caption: rec.caption };
  if (at) state.runtime.lastSlotAt = Math.max(state.runtime.lastSlotAt || 0, at);
  const product = state.catalog[rec.product];
  if (product) state.catalog[rec.product] = { ...product, lastPostedAt: now, ...rememberCaption(product, { text: rec.caption, ...(rec.captionMeta || {}) }) };
  if (state.runtime.retry?.path === rec.path) state.runtime.retry = null;
  addHistory(state, { status: at ? 'scheduled' : 'posted', publishAt: at || now, product: rec.product, productName: rec.productName, video: rec.path, caption: rec.caption, url: result.url, log: result.log, linkedProduct: result.linkedProduct, late: true });
  await saveAll(state);
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
        job.contentStarted = true;
        await save({ runtime: state.runtime });
      }
    });
    return false;
  }
  if (msg.type === 'job-log') {
    locked(async () => {
      const state = await load();
      const job = state.runtime.currentJob;
      if (job && job.id === msg.jobId) {
        job.log = [...(job.log || []), ...(msg.entries || [])].slice(-500);
        job.lastProgressAt = Date.now();
        job.contentStarted = true;
        await save({ runtime: state.runtime });
      }
    });
    return false;
  }
  if (msg.type === 'focus-tab') {
    focusTab(sender.tab?.id).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'cdp-mouse') {
    cdpMouse(sender.tab?.id, msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === 'cdp-type') {
    cdpType(sender.tab?.id, msg.actions || []).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === 'sleep') {
    // espera feita aqui para não sofrer o atraso de timers de abas em segundo plano
    setTimeout(() => sendResponse(true), Math.min(Math.max(Number(msg.ms) || 0, 0), 60000));
    return true;
  }
  if (msg.type === 'sync-result') {
    locked(async () => finishSync(await load(), msg));
    return false;
  }
  if (msg.type === 'job-result') {
    locked(async () => finishJob(await load(), msg));
    return false;
  }
  if (msg.type === 'cmd') {
    locked(async () => {
      const r = await command(msg.name, msg.payload || {});
      // depois de qualquer mudança, atualiza a cópia de segurança na pasta (só grava se algo mudou)
      if (!['ping', 'export', 'inspect', 'telegram-test', 'telegram-find-chat'].includes(msg.name)) await maybeBackup(await load());
      return r;
    })
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
    case 'ping':
      return { ok: true };
    case 'start': {
      rt.running = true;
      rt.consecutiveFailures = 0;
      rt.infraFailures = 0;
      rt.pausedReason = null;
      rt.nextRunAt = Date.now() + MIN;
      rt.session = null;
      if (state.settings.publishMode === 'schedule') {
        // se a agenda já cobre até a próxima sessão, espera por ela; senão agenda já
        const nextBase = computeNextSession(Date.now(), { ...state.settings, sessionJitterMinutes: 0 });
        const covered = rt.lastSlotAt && nextBase && rt.lastSlotAt >= nextBase;
        rt.nextSessionAt = covered ? computeNextSession(Date.now(), state.settings) : Date.now() + MIN;
      }
      await save({ runtime: rt });
      await ensureAlarm();
      syncPower(rt, state.settings);
      return { ok: true, nextSessionAt: rt.nextSessionAt || null };
    }
    case 'session-now':
      if (rt.currentJob) return { ok: false, error: 'Espere a postagem em andamento terminar.' };
      if (state.settings.publishMode !== 'schedule') return { ok: false, error: 'O modo agendamento está desligado.' };
      if (!rt.running) {
        rt.running = true;
        rt.consecutiveFailures = 0;
        rt.pausedReason = null;
        await ensureAlarm();
        syncPower(rt, state.settings);
      }
      if (!rt.session) await beginSession(state);
      return { ok: true };
    case 'pause':
      if (rt.session) await endSession(state, 'pausado por você', { quiet: true });
      rt.running = false;
      rt.nextRunAt = null;
      rt.nextSessionAt = null;
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
      const data = await chrome.storage.local.get(['settings', 'catalog', 'folders', 'videos']);
      return { ok: true, data: { app: 'autoposter-tiktok-shop', version: 2, exportedAt: new Date().toISOString(), ...data } };
    }
    case 'import': {
      const d = p.data || {};
      if (d.app !== 'autoposter-tiktok-shop' || (typeof d.catalog !== 'object' && typeof d.products !== 'object')) return { ok: false, error: 'Esse arquivo não é um backup do AutoPoster.' };
      const settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
      settings.labels = mergeLabels(settings.labels);
      rt.running = false;
      rt.nextRunAt = null;
      rt.retry = null;
      // backups da versão 1 (produto por pasta) são convertidos
      const m = migrate({ catalog: d.catalog, folders: d.folders, products: d.products, videos: d.videos || state.videos, runtime: rt });
      await save({ settings, catalog: m.state.catalog || {}, folders: m.state.folders || {}, videos: m.state.videos || {}, runtime: rt });
      await chrome.storage.local.remove('products');
      syncPower(rt, settings);
      return { ok: true, products: Object.keys(m.state.catalog || {}).length };
    }
    case 'post-now':
      return startJob(state, { dryRun: false, videoPath: p.path, manual: true });
    case 'sync-showcase':
      return startSync(state);
    case 'dry-run':
      return startJob(state, { dryRun: true, videoPath: p.path });
    case 'cancel-job':
      if (rt.currentJob) await abortJob(state, 'Cancelado por você.');
      return { ok: true };
    case 'rescan': {
      const r = await rescan(state);
      if (r.ok) await saveAll(state);
      return r;
    }
    case 'save-settings': {
      const settings = { ...state.settings, ...p.settings };
      await save({ settings });
      if (rt.running && rt.nextRunAt && p.reschedule && settings.publishMode !== 'schedule') {
        rt.nextRunAt = computeNextRun(Date.now(), settings);
      }
      // trocou de modo ou os horários das sessões: recalcula a próxima sessão
      if (rt.running && !rt.session && settings.publishMode === 'schedule'
        && (state.settings.publishMode !== 'schedule' || state.settings.sessionTimes !== settings.sessionTimes || !rt.nextSessionAt)) {
        rt.nextSessionAt = computeNextSession(Date.now(), settings);
      }
      if (settings.publishMode !== 'schedule' && rt.session) await endSession(state, 'modo agendamento desligado', { quiet: true });
      if (rt.running && settings.publishMode !== 'schedule' && !rt.nextRunAt) rt.nextRunAt = Date.now() + MIN;
      await save({ runtime: rt });
      return { ok: true };
    }
    // Cria ou edita um produto do catálogo. Opcionalmente já liga a uma pasta / vídeos.
    case 'catalog-save': {
      const data = { ...(p.data || {}) };
      const id = String(data.productId || '').trim();
      const dup = id && Object.values(state.catalog).find((c) => c.key !== p.key && String(c.productId || '') === id);
      if (dup) return { ok: false, error: `Esse produto já está no catálogo como "${dup.displayName}".`, existingKey: dup.key };
      const prev = p.key ? state.catalog[p.key] : null;
      if (p.key && !prev) return { ok: false, error: 'Produto não encontrado.' };
      const key = prev ? p.key : newCatalogKey(data);
      const next = { niche: 'geral', enabled: true, createdAt: Date.now(), ...(prev || {}), ...data, key };
      if (!next.displayName) next.displayName = next.productQuery || (id ? `Produto ${id.slice(-6)}` : 'Produto');
      next.configured = !!(String(next.productId || '').trim() || String(next.productQuery || '').trim());
      if (!prev || linkKey(next) !== linkKey(prev)) next.linkTestedAt = null;
      state.catalog[key] = next;
      if (p.assignFolder && state.folders[p.assignFolder]) state.folders[p.assignFolder] = { ...state.folders[p.assignFolder], catalogKey: key };
      for (const path of p.assignPaths || []) if (state.videos[path]) state.videos[path] = { ...state.videos[path], catalogKey: key };
      await saveAll(state);
      return { ok: true, key };
    }
    case 'catalog-delete': {
      if (!state.catalog[p.key]) return { ok: false, error: 'Produto não encontrado.' };
      if (rt.currentJob?.product === p.key) return { ok: false, error: 'Esse produto está sendo postado agora. Tente de novo em instantes.' };
      delete state.catalog[p.key];
      let folders = 0;
      let videos = 0;
      for (const [k, f] of Object.entries(state.folders)) if (f.catalogKey === p.key) { state.folders[k] = { ...f, catalogKey: null }; folders++; }
      for (const [k, v] of Object.entries(state.videos)) if (v.catalogKey === p.key) { const { catalogKey, ...rest } = v; state.videos[k] = rest; videos++; }
      if (rt.lastProduct === p.key) rt.lastProduct = null;
      if (rt.retry && !productKeyOf(state, state.videos[rt.retry.path])) rt.retry = null;
      await saveAll(state);
      return { ok: true, folders, videos };
    }
    // Liga uma pasta (ou vídeos) a um produto do catálogo. catalogKey vazio = sem produto / igual à pasta.
    case 'assign': {
      const key = p.catalogKey && state.catalog[p.catalogKey] ? p.catalogKey : null;
      if (p.catalogKey && !key) return { ok: false, error: 'Produto não encontrado.' };
      if (p.folder) {
        if (!state.folders[p.folder]) return { ok: false, error: 'Pasta não encontrada.' };
        state.folders[p.folder] = { ...state.folders[p.folder], catalogKey: key };
      }
      for (const path of p.paths || []) {
        const v = state.videos[path];
        if (!v) continue;
        if (key) state.videos[path] = { ...v, catalogKey: key };
        else { const { catalogKey, ...rest } = v; state.videos[path] = rest; }
      }
      await saveAll(state);
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
