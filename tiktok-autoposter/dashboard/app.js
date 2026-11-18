import { DEFAULT_SETTINGS, DEFAULT_LABELS, mergeLabels } from '../lib/defaults.js';
import { previewQueue, countPostedToday, isLinkReady, productBlocked, linkKey, productKeyOf, itemOf } from '../lib/scheduler.js';
import { previewSeries, NICHES } from '../lib/captions.js';
import { getRootHandle, saveRootHandle, permissionState } from '../lib/fsaccess.js';
import { resolveProductLink, extractProductId, firstUrl } from '../lib/productlink.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;

let S = { settings: DEFAULT_SETTINGS, catalog: {}, folders: {}, videos: {}, history: [], runtime: {} };
let folderPerm = 'none';
let writePerm = 'none';
let folderName = null;
let view = 'overview';
let settingsDirty = false;
const ui = { queueFilter: 'pending', queueFolder: '', queueSearch: '', histFilter: 'all' };

const TITLES = {
  overview: ['Visão geral', 'Acompanhe as postagens automáticas no seu TikTok.'],
  products: ['Produtos', 'Seu catálogo: cole o link uma vez e use o produto em quantos vídeos quiser.'],
  queue: ['Vídeos', 'Escolha o produto de cada pasta (ou de um vídeo específico) e acompanhe a fila.'],
  history: ['Histórico', 'Tudo o que foi publicado, testado ou falhou.'],
  settings: ['Configurações', 'Frequência, horários e como publicar.'],
  help: ['Ajuda', 'Passo a passo, links úteis e diagnóstico.'],
};

const JOB_STEPS = [
  'Abrindo o TikTok Studio', 'Aguardando a página de upload', 'Lendo o vídeo da pasta', 'Enviando o vídeo',
  'Escrevendo a legenda', 'Aguardando o envio terminar', 'Vinculando o produto (carrinho)', 'Marcando "Conteúdo de marca"', 'Publicando',
];

// ---------- comunicação ----------
async function send(name, payload) {
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: 'cmd', name, payload });
  } catch (e) {
    r = { ok: false, error: 'A extensão não respondeu. Recarregue a página do painel.' };
  }
  if (r && r.ok === false && r.error) toast(r.error, true);
  return r || { ok: false };
}

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), bad ? 6000 : 3200);
}

async function loadState() {
  const s = await chrome.storage.local.get(['settings', 'catalog', 'folders', 'videos', 'history', 'runtime']);
  const settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  settings.labels = mergeLabels(settings.labels);
  S = { settings, catalog: s.catalog || {}, folders: s.folders || {}, videos: s.videos || {}, history: s.history || [], runtime: s.runtime || {} };
}

async function refreshFolder() {
  try {
    const h = await getRootHandle();
    folderName = h?.name || null;
    folderPerm = h ? await permissionState(h) : 'none';
    writePerm = h ? await permissionState(h, false, 'readwrite') : 'none';
  } catch (_) {
    folderPerm = 'none';
  }
}

// ---------- formatação ----------
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function fmtWhen(ts) {
  const d = new Date(ts);
  const same = d.toDateString() === new Date().toDateString();
  const y = new Date(Date.now() - 864e5).toDateString() === d.toDateString();
  return `${same ? 'Hoje' : y ? 'Ontem' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${fmtTime(ts)}`;
}
function fmtCountdown(ms) {
  if (ms <= 0) return 'agora';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
const STATUS = {
  pending: ['Pendente', 'info'], posted: ['Publicado', 'ok'], failed: ['Falhou', 'bad'],
  skipped: ['Pulado', ''], missing: ['Sumiu da pasta', 'warn'], 'dry-run': ['Teste ok', 'violet'], idle: ['Fila vazia', 'warn'],
  unconfirmed: ['Verificar no TikTok', 'warn'], sync: ['Vitrine importada', 'ok'],
};
const pill = (st) => `<span class="pill ${STATUS[st]?.[1] || ''}">${STATUS[st]?.[0] || esc(st)}</span>`;

// ---------- ajudas do catálogo ----------
const catalogList = () => Object.values(S.catalog).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'pt-BR'));
const nameOf = (key) => S.catalog[key]?.displayName || '';
// pastas com vídeos pendentes que ainda não têm produto
function foldersWithoutProduct() {
  return Object.values(S.folders).filter((f) => !(f.catalogKey && S.catalog[f.catalogKey])
    && Object.values(S.videos).some((v) => v.folder === f.folder && v.status === 'pending' && !v.catalogKey));
}
function videosOfProduct(key) {
  return Object.values(S.videos).filter((v) => productKeyOf(S, v) === key);
}
function productOptions(selected, inheritLabel) {
  const first = inheritLabel != null
    ? `<option value="">${esc(inheritLabel)}</option>`
    : '<option value="">— escolher produto —</option>';
  const items = catalogList().map((c) => `<option value="${esc(c.key)}" ${c.key === selected ? 'selected' : ''}>${esc(c.displayName)}${isLinkReady(c) ? '' : ' (sem link)'}${c.enabled === false ? ' (pausado)' : ''}</option>`).join('');
  return first + items + '<option value="__new__">＋ Novo produto (colar link)…</option>';
}

// ---------- passos de configuração ----------
function setupSteps() {
  const ready = Object.values(S.catalog).filter((p) => p.enabled !== false && isLinkReady(p));
  const vids = Object.values(S.videos).filter((v) => v.status !== 'missing').length;
  const tested = !!S.history.find((h) => h.status === 'dry-run' || h.status === 'posted');
  const queued = previewQueue(S, 1).length > 0;
  const withVideos = Object.values(S.folders).filter((f) => Object.values(S.videos).some((v) => v.folder === f.folder && v.status !== 'missing'));
  const linked = withVideos.filter((f) => f.catalogKey && S.catalog[f.catalogKey]).length;
  return [
    {
      done: !!folderName && folderPerm === 'granted' && vids > 0,
      title: 'Escolher a pasta',
      text: folderName ? (folderPerm === 'granted' ? `${vids} vídeos em “${folderName}”` : 'Reautorize o acesso à pasta') : 'Uma subpasta para cada produto',
      btn: folderName && folderPerm !== 'granted' ? ['reauth', 'Reautorizar'] : ['pick', folderName ? 'Trocar pasta' : 'Escolher pasta'],
    },
    {
      done: ready.length > 0,
      title: 'Cadastrar produtos',
      text: ready.length ? `${ready.length} produto${ready.length > 1 ? 's' : ''} no catálogo` : 'Importe os produtos da sua vitrine de afiliado',
      btn: ['sync', 'Importar vitrine'],
    },
    {
      done: queued,
      title: 'Ligar pastas aos produtos',
      text: withVideos.length ? `${linked} de ${withVideos.length} pastas com produto` : 'Depois de escolher a pasta',
      btn: ['goto:queue', 'Escolher produtos'],
    },
    {
      done: tested,
      title: 'Fazer um teste',
      text: 'Preenche tudo no TikTok Studio, sem publicar',
      btn: ['dry', 'Testar agora'],
    },
    {
      done: !!S.runtime.running,
      title: 'Iniciar',
      text: `Um post a cada ${S.settings.intervalMinutes} min`,
      btn: ['start', 'Iniciar'],
    },
  ];
}

// ---------- render ----------
function render() {
  renderChrome();
  renderBanner();
  if (view === 'overview') renderOverview();
  if (view === 'products') renderProducts();
  if (view === 'queue') renderQueue();
  if (view === 'history') renderHistory();
}

function renderChrome() {
  const rt = S.runtime;
  const busy = !!rt.currentJob;
  for (const b of [$('#btnToggle'), $('#sideToggle')]) {
    b.innerHTML = rt.running ? `${icon('pause')}Pausar` : `${icon('play')}Iniciar`;
    b.classList.toggle('primary', !rt.running);
    b.classList.toggle('stop', !!rt.running);
  }
  $('#btnNow').disabled = busy;
  $('#btnDry').disabled = busy;
  $('#viewTitle').textContent = TITLES[view][0];
  $('#viewSub').textContent = TITLES[view][1];

  $('#sideDot').className = 'dot' + (busy ? ' busy' : rt.running ? ' on' : '');
  $('#sideState').textContent = busy ? 'Postando agora' : rt.running ? 'Rodando' : 'Pausado';
  $('#sideInfo').textContent = `A cada ${S.settings.intervalMinutes} min · ${String(S.settings.activeStartHour).padStart(2, '0')}h às ${String(S.settings.activeEndHour).padStart(2, '0')}h`;

  const needs = Object.values(S.catalog).filter((p) => p.enabled !== false && !isLinkReady(p)).length;
  const pb = $('#navProdBadge');
  pb.hidden = !needs || !S.settings.linkProduct;
  pb.textContent = needs;
  pb.title = `${needs} produto(s) sem link configurado`;
  const orphan = foldersWithoutProduct().length;
  const qb = $('#navQueueBadge');
  qb.hidden = !orphan;
  qb.textContent = orphan;
  qb.title = `${orphan} pasta(s) com vídeos e sem produto`;
  const fails = S.history.filter((h) => (h.status === 'failed' || h.status === 'unconfirmed') && h.ts > Date.now() - 864e5).length;
  const hb = $('#navHistBadge');
  hb.hidden = !fails;
  hb.textContent = fails;
  hb.title = `${fails} falha(s) nas últimas 24h`;

  const theme = document.documentElement.dataset.theme;
  $$('[data-theme-set]').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === theme));
}

function renderBanner() {
  const el = $('#banner');
  let html = '';
  if (folderName && folderPerm !== 'granted') {
    html = `<div class="banner err">${icon('lock')}<div class="grow"><b>O Chrome precisa de permissão para ler a pasta “${esc(folderName)}”</b><span class="muted small">Sem isso as postagens param. Clique em Reautorizar e, se aparecer, escolha “Permitir em todas as visitas”.</span></div><button class="btn primary small" data-act="reauth">Reautorizar pasta</button></div>`;
  } else if (folderName && folderPerm === 'granted' && writePerm !== 'granted') {
    html = `<div class="banner warn">${icon('shield')}<div class="grow"><b>Ative a cópia de segurança automática</b><span class="muted small">Com a permissão de edição da pasta, a extensão grava suas configurações e produtos no arquivo “_autoposter-config.json” dentro da pasta de vídeos. Assim, ao instalar uma versão nova, tudo volta sozinho.</span></div><button class="btn primary small" data-act="enable-backup">Ativar</button></div>`;
  } else if (S.runtime.running && S.runtime.infraFailures > 0) {
    html = `<div class="banner warn">${icon('alert')}<div class="grow"><b>O TikTok não abriu na última tentativa (${S.runtime.infraFailures}x)</b><span class="muted small">Não é problema dos vídeos. A extensão tenta de novo sozinha${S.runtime.nextRunAt ? ` por volta das ${fmtTime(S.runtime.nextRunAt)}` : ''}. Confira a internet e se o computador está ligado com a tela acesa.</span></div></div>`;
  } else if (!S.runtime.running && S.runtime.pausedReason === 'logged-out') {
    html = `<div class="banner err">${icon('lock')}<div class="grow"><b>Pausado: o TikTok está deslogado neste Chrome</b><span class="muted small">Entre na sua conta do TikTok e depois clique em Iniciar.</span></div><a class="btn small" href="https://www.tiktok.com/login" target="_blank" rel="noopener">Entrar no TikTok</a></div>`;
  } else if (!S.runtime.running && S.runtime.consecutiveFailures >= (S.settings.pauseAfterFailures || 3)) {
    html = `<div class="banner err">${icon('alert')}<div class="grow"><b>Pausado após ${S.runtime.consecutiveFailures} falhas seguidas</b><span class="muted small">Veja o motivo no Histórico, faça um teste e depois clique em Iniciar.</span></div><button class="btn small" data-goto="history">Ver histórico</button></div>`;
  } else if (Object.values(S.videos).some((v) => v.status === 'unconfirmed')) {
    const n = Object.values(S.videos).filter((v) => v.status === 'unconfirmed').length;
    html = `<div class="banner warn">${icon('alert')}<div class="grow"><b>${n} post${n > 1 ? 's' : ''} para conferir</b><span class="muted small">Cliquei em Publicar mas não vi a confirmação. Veja em “Meus posts” do TikTok Studio se saiu e marque na lista de vídeos. Esses vídeos não são repetidos automaticamente.</span></div><button class="btn small" data-goto-queue="unconfirmed">Ver vídeos</button></div>`;
  } else if (S.runtime.running && S.settings.linkProduct && !previewQueue(S, 1).length && Object.keys(S.videos).length) {
    html = `<div class="banner warn">${icon('alert')}<div class="grow"><b>Nada para postar agora</b><span class="muted small">Não há vídeos pendentes ligados a um produto ativo com link. Escolha o produto das pastas na tela Vídeos.</span></div><button class="btn small" data-goto="queue">Ver vídeos</button></div>`;
  }
  el.innerHTML = html;
}

function stats() {
  const vids = Object.values(S.videos);
  const pending = vids.filter((v) => v.status === 'pending' && !productBlocked(itemOf(S, v), S.settings)).length;
  const posted = vids.filter((v) => v.status === 'posted').length;
  const fails = S.history.filter((h) => h.status === 'failed' && h.ts > Date.now() - 864e5).length;
  return { pending, posted, fails };
}

function renderOverview() {
  // checklist
  const steps = setupSteps();
  const allDone = steps.every((s) => s.done);
  $('#setupCard').hidden = allDone;
  if (!allDone) {
    const cur = steps.findIndex((s) => !s.done);
    $('#setupCount').textContent = `${steps.filter((s) => s.done).length} de ${steps.length} concluídos`;
    $('#setupSteps').innerHTML = steps.map((s, i) => `
      <div class="sstep ${s.done ? 'done' : i === cur ? 'current' : ''}">
        <span class="num">${s.done ? '✓' : i + 1}</span>
        <b>${s.title}</b>
        <p>${esc(s.text)}</p>
        ${s.done && i !== 0 ? '' : `<button class="btn small ${i === cur ? 'primary' : ''}" data-setup="${s.btn[0]}">${s.btn[1]}</button>`}
      </div>`).join('');
  }

  const st = stats();
  $('#stToday').textContent = countPostedToday(S.history);
  $('#stTodayMax').textContent = `limite de ${S.settings.maxPerDay} por dia`;
  $('#stPending').textContent = st.pending;
  const withQueue = new Set(Object.values(S.videos).filter((v) => v.status === 'pending' && !productBlocked(itemOf(S, v), S.settings)).map((v) => productKeyOf(S, v))).size;
  $('#stProducts').textContent = `de ${withQueue} produto${withQueue === 1 ? '' : 's'}`;
  $('#stFails').textContent = st.fails;
  $('#stTotal').textContent = `${st.posted} publicados no total`;
  tickCountdown();

  const job = S.runtime.currentJob;
  $('#jobCard').hidden = !job;
  if (job) {
    $('#jobTitle').textContent = job.type === 'sync' ? 'Importando a sua vitrine do TikTok Studio (nada é publicado)' : `${job.dryRun ? 'Testando (sem publicar)' : 'Postando'}: ${job.productName || job.product} — ${job.path.split('/').pop()}`;
    $('#jobStep').textContent = job.step || '';
    const idx = Math.max(0, JOB_STEPS.indexOf(job.step));
    $('#jobBar').style.width = `${Math.round(((idx + 1) / JOB_STEPS.length) * 100)}%`;
  }

  // pasta
  const files = Object.values(S.videos).filter((v) => v.status !== 'missing');
  const size = files.reduce((a, v) => a + (v.size || 0), 0);
  $('#folderBox').innerHTML = folderName
    ? `<div class="folder"><div class="folder-icon">${icon('folder')}</div><div class="grow"><b>${esc(folderName)}</b>
        <div class="muted small">${Object.keys(S.folders).length} pastas · ${files.length} vídeos · ${fmtSize(size)}</div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${folderPerm === 'granted' ? `<span class="pill ok">${icon('check')}Conectada</span>` : `<span class="pill bad">${icon('lock')}Sem permissão</span>`}
        ${S.runtime.lastScanAt ? `<span class="muted small">lida às ${fmtTime(S.runtime.lastScanAt)} · relida antes de cada post</span>` : ''}</div>
        <div class="muted small" style="margin-top:6px">${writePerm === 'granted' ? `🛡 Cópia de segurança na pasta${S.runtime.backupAt ? `: salva às ${fmtTime(S.runtime.backupAt)}` : ' ativada'}` : '🛡 Cópia de segurança desativada (falta permissão de edição)'}</div></div></div>
       <div class="folder-actions">
        ${folderPerm !== 'granted' ? `<button class="btn primary small" data-act="reauth">${icon('lock')}Reautorizar</button>` : ''}
        <button class="btn small" data-act="rescan">${icon('refresh')}Ler pasta de novo</button>
        <button class="btn small" data-act="pick">${icon('folder')}Trocar pasta</button></div>`
    : `<div class="empty">Nenhuma pasta escolhida ainda.<br><button class="btn primary" data-act="pick">${icon('folder')}Escolher pasta</button></div>`;

  // próximos
  const q = previewQueue(S, 6);
  const interval = Number(S.settings.intervalMinutes);
  const t = S.runtime.nextRunAt && S.runtime.running ? S.runtime.nextRunAt : null;
  $('#intervalInfo').textContent = `a cada ${interval} min (±${S.settings.jitterMinutes})`;
  $('#upcoming').innerHTML = q.length
    ? q.map((it, i) => `<li><span class="n">${i + 1}</span><span class="t">${t ? '~' + fmtTime(t + i * interval * 60000) : '—'}</span>
        <div style="min-width:0"><div class="p">${esc(nameOf(it.product) || it.product)}</div><div class="f">📁 ${esc(it.video.folder)} · ${esc(it.video.name)}</div></div></li>`).join('')
    : `<div class="empty">${Object.keys(S.folders).length ? 'Sem vídeos prontos para postar. Ligue as pastas a produtos do catálogo (tela Vídeos).' : 'Escolha a pasta de vídeos para montar a fila.'}</div>`;

  $('#recent').innerHTML = historyHtml(S.history.slice(0, 5)) || '<div class="empty">Nenhuma atividade ainda.</div>';
}

function tickCountdown() {
  const rt = S.runtime;
  const el = $('#stNext');
  if (!el || view !== 'overview') return;
  if (rt.currentJob) { el.textContent = 'postando…'; $('#stNextAt').textContent = rt.currentJob.step || ''; return; }
  if (!rt.running || !rt.nextRunAt) { el.textContent = 'pausado'; $('#stNextAt').textContent = 'clique em Iniciar'; return; }
  el.textContent = fmtCountdown(rt.nextRunAt - Date.now());
  $('#stNextAt').textContent = `por volta de ${fmtTime(rt.nextRunAt)}`;
}

function historyHtml(list) {
  return list.map((h) => {
    const file = h.video ? h.video.split('/').pop() : '';
    const tech = h.diag || (h.log && h.log.length) || h.shot ? `<div style="margin-top:8px"><button class="btn small" data-log="${esc(h.id)}">${icon('info')}Ver registro${h.shot ? ' e captura de tela' : ''}</button></div>` : '';
    return `<div class="act">
      <div class="when">${fmtWhen(h.ts)}</div>
      <div>
        <div class="title">${h.productName ? `<b>${esc(h.productName)}</b> · ` : ''}<span class="muted">${esc(file)}</span>${h.attempt > 1 ? ` <span class="muted small">(tentativa ${h.attempt})</span>` : ''}</div>
        ${h.caption ? `<div class="cap">${esc(h.caption)}</div>` : ''}
        ${h.linkedProduct ? `<div class="meta">🛒 Produto vinculado: <b>${esc(h.linkedProduct)}</b></div>` : ''}
        ${h.error ? `<div class="err">${h.step ? esc(h.step) + ': ' : ''}${esc(h.error)}${h.willRetry ? ' — nova tentativa em 3 min' : ''}</div>` : ''}
        ${tech}
      </div>
      <div>${pill(h.status)}</div>
    </div>`;
  }).join('');
}

function renderProducts() {
  const entries = catalogList();
  if (!entries.length) {
    $('#productsGrid').innerHTML = `<div class="empty" style="grid-column:1/-1">Seu catálogo está vazio. Cole o link de um produto do TikTok Shop para começar.<br><button class="btn primary" data-new-product="1">${icon('cart')}Adicionar produto</button></div>`;
    return;
  }
  $('#productsGrid').innerHTML = entries.map((p) => {
    const vids = videosOfProduct(p.key);
    const c = (s) => vids.filter((v) => v.status === s).length;
    const total = vids.filter((v) => v.status !== 'missing').length;
    const pct = total ? Math.round((c('posted') / total) * 100) : 0;
    const folders = Object.values(S.folders).filter((f) => f.catalogKey === p.key).map((f) => f.folder);
    const ready = isLinkReady(p);
    const off = p.enabled === false;
    let badge;
    if (off) badge = '<span class="pill">Pausado</span>';
    else if (p.unavailable) badge = `<span class="pill bad">${icon('alert')}Indisponível</span>`;
    else if (!ready) badge = `<span class="pill warn">${icon('alert')}Falta o link</span>`;
    else if (!total) badge = '<span class="pill">Sem vídeos ligados</span>';
    else if (!c('pending')) badge = '<span class="pill">Sem vídeos novos</span>';
    else badge = '<span class="pill ok">Na fila</span>';
    const tested = p.linkTestedAt && p.linkTestedKey === linkKey(p);
    const niche = NICHES[p.niche]?.name || NICHES.geral.name;
    const safeUrl = /^https:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(p.productUrl || '') ? p.productUrl : '';
    const sc = p.showcase;
    return `<div class="product ${off ? 'off' : ''} ${(!ready || p.unavailable) && !off ? 'needs' : ''}">
      <div class="top"><div style="min-width:0"><h3>${esc(p.displayName)}</h3><div class="folder-name">${folders.length ? '📁 ' + folders.map(esc).join(' · ') : 'Nenhuma pasta ligada'}</div></div>${badge}</div>
      <div class="bar" title="${pct}% publicado"><i style="width:${pct}%"></i></div>
      <div class="counts"><div><b>${c('pending')}</b>pendentes</div><div><b>${c('posted')}</b>publicados</div><div><b>${c('failed')}</b>falhas</div></div>
      ${sc ? `<div class="muted small">🛍 Vitrine: <b style="color:var(--text)">${esc(sc.price || '—')}</b> · estoque ${sc.stock ?? '—'} · ${sc.status === 'indisponivel' ? '<span style="color:var(--red)">Indisponível</span>' : '<span style="color:var(--green)">Ativo</span>'} · lido ${fmtWhen(sc.syncedAt)}</div>` : ''}
      ${p.unavailable ? `<div class="small" style="color:var(--red)">Sem estoque na vitrine: os vídeos deste produto ficam na fila até ele voltar. <button class="link" data-reactivate="${esc(p.key)}">Já voltou — reativar</button></div>` : ''}
      <div class="linkbox">
        ${p.productId ? `<div class="row">${icon('cart')}<span>ID <b>${esc(p.productId)}</b>${safeUrl ? ` · <a href="${esc(safeUrl)}" target="_blank" rel="noopener">abrir ↗</a>` : ''}</span></div>` : ''}
        ${p.productQuery ? `<div class="row">${icon('text')}<span>Nome: <b>${esc(p.productQuery)}</b></span></div>` : ''}
        ${!ready ? `<div class="row">${icon('alert')}<span style="color:var(--yellow)">Cole o link do produto</span></div>` : !p.productId ? `<div class="row small" style="color:var(--yellow)">${icon('alert')}Sem link: só busca pelo nome</div>` : ''}
        ${ready ? `<div class="row">${icon('shield')}${tested ? `<span style="color:var(--green)">Link conferido ${fmtWhen(p.linkTestedAt)}</span>` : '<span class="muted">Ainda não testado — faça um teste</span>'}</div>` : ''}
        ${tested && p.linkTestedMatch ? `<div class="row muted small" title="${esc(p.linkTestedMatch)}">↳ ${esc(p.linkTestedMatch.slice(0, 60))}</div>` : ''}
        <div class="row">🛒<span>No carrinho: <b>${esc(p.productLabel || (sc ? (sc.name || '').slice(0, 30) : '') || 'nome sugerido pelo TikTok')}</b> <button class="link" data-edit="${esc(p.key)}">trocar</button></span></div>
        <div class="row">${icon('hash')}${esc(niche)}${p.hashtags?.trim() ? ' + hashtags próprias' : ''}</div>
      </div>
      <div class="btns">
        <button class="btn small ${ready ? '' : 'primary'}" data-edit="${esc(p.key)}">${ready ? 'Editar' : 'Colar link'}</button>
        ${ready && c('pending') ? `<button class="btn small" data-test-prod="${esc(p.key)}">${icon('flask')}Testar</button>` : ''}
        <button class="btn small ghost" data-toggle-prod="${esc(p.key)}">${off ? 'Ativar' : 'Pausar'}</button>
        <button class="btn small danger" data-delete-prod="${esc(p.key)}" aria-label="Remover ${esc(p.displayName)}">Remover</button>
      </div>
    </div>`;
  }).join('');
}

function renderFolders() {
  const folders = Object.values(S.folders).sort((a, b) => a.folder.localeCompare(b.folder, 'pt-BR', { numeric: true }));
  if (!folders.length) {
    $('#foldersBox').innerHTML = `<div class="empty">Nenhuma pasta ainda. Escolha a pasta de vídeos na Visão geral.</div>`;
    return;
  }
  $('#foldersBox').innerHTML = `<table class="table"><thead><tr><th>Pasta</th><th>Vídeos</th><th>Produto do catálogo</th><th><span class="sr">Situação</span></th></tr></thead><tbody>${
    folders.map((f) => {
      const vids = Object.values(S.videos).filter((v) => v.folder === f.folder && v.status !== 'missing');
      const pend = vids.filter((v) => v.status === 'pending').length;
      const item = f.catalogKey ? S.catalog[f.catalogKey] : null;
      const state = !item ? `<span class="pill warn">${icon('alert')}Sem produto</span>`
        : item.enabled === false ? '<span class="pill">Produto pausado</span>'
          : !isLinkReady(item) ? '<span class="pill warn">Produto sem link</span>'
            : '<span class="pill ok">Pronto</span>';
      return `<tr>
        <td class="file">📁 ${esc(f.folder)}</td>
        <td class="muted">${vids.length} (${pend} pendentes)</td>
        <td style="min-width:260px"><select data-assign-folder="${esc(f.folder)}" aria-label="Produto da pasta ${esc(f.folder)}">${productOptions(item ? f.catalogKey : '', null)}</select></td>
        <td>${state}</td></tr>`;
    }).join('')
  }</tbody></table>`;
}

function renderQueue() {
  renderFolders();
  const sel = $('#queueProduct');
  const opts = ['<option value="">Todas as pastas</option>', ...Object.values(S.folders).map((f) => `<option value="${esc(f.folder)}">📁 ${esc(f.folder)}</option>`)].join('');
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  sel.value = ui.queueFolder;
  const counts = {};
  for (const v of Object.values(S.videos)) counts[v.status] = (counts[v.status] || 0) + 1;
  counts.all = Object.keys(S.videos).length;
  $$('#queueFilter button').forEach((b) => {
    b.classList.toggle('on', b.dataset.f === ui.queueFilter);
    b.setAttribute('aria-selected', b.dataset.f === ui.queueFilter);
    const base = b.dataset.label || (b.dataset.label = b.textContent);
    b.innerHTML = `${base}<span class="count">${counts[b.dataset.f] || 0}</span>`;
  });
  $('#btnRequeueFailed').hidden = !counts.failed;

  const q = ui.queueSearch.toLowerCase();
  const list = Object.values(S.videos)
    .filter((v) => ui.queueFilter === 'all' || v.status === ui.queueFilter)
    .filter((v) => !ui.queueFolder || v.folder === ui.queueFolder)
    .filter((v) => !q || v.path.toLowerCase().includes(q))
    .sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0) || a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));

  if (!list.length) {
    $('#queueTable').innerHTML = '<tbody><tr><td><div class="empty">Nenhum vídeo aqui.</div></td></tr></tbody>';
    return;
  }
  $('#queueTable').innerHTML = `<thead><tr><th>Vídeo</th><th>Produto</th><th>Status</th><th><span class="sr">Ações</span></th></tr></thead><tbody>${
    list.slice(0, 500).map((v) => {
      const item = itemOf(S, v);
      const folderItem = S.folders[v.folder]?.catalogKey && S.catalog[S.folders[v.folder].catalogKey];
      const blocked = v.status === 'pending' && productBlocked(item, S.settings);
      const reason = !item ? 'escolha o produto' : item.enabled === false ? 'produto pausado' : 'produto sem link';
      return `<tr>
      <td class="file" title="${esc(v.path)}">${esc(v.name)}${v.hasTxt ? ' <span class="pill info" title="tem legenda própria (.txt)">txt</span>' : ''}<div class="muted small">📁 ${esc(v.folder)}${v.size ? ' · ' + fmtSize(v.size) : ''}</div>${v.lastError ? `<div class="small" style="color:var(--red);white-space:normal">${esc(v.lastError)}</div>` : ''}</td>
      <td style="min-width:220px"><select data-assign-video="${esc(v.path)}" aria-label="Produto do vídeo ${esc(v.name)}">${productOptions(v.catalogKey && S.catalog[v.catalogKey] ? v.catalogKey : '', `Igual à pasta (${folderItem ? folderItem.displayName : 'sem produto'})`)}</select>${blocked ? `<div class="small" style="color:var(--yellow)">${reason}</div>` : ''}</td>
      <td>${pill(v.status)}${v.postedAt ? `<div class="muted small">${fmtWhen(v.postedAt)}</div>` : ''}</td>
      <td><div class="row-actions">
        ${v.status === 'pending' && !blocked ? `<button class="btn small" data-post="${esc(v.path)}">Postar agora</button><button class="btn small" data-dry="${esc(v.path)}">Testar</button>` : ''}
        ${v.status === 'pending' ? `<button class="btn small ghost" data-skip="${esc(v.path)}">Pular</button>` : ''}
        ${v.status === 'unconfirmed' ? `<button class="btn small" data-mark-posted="${esc(v.path)}">Saiu, marcar publicado</button>` : ''}
        ${['failed', 'skipped', 'posted', 'unconfirmed'].includes(v.status) ? `<button class="btn small" data-requeue="${esc(v.path)}">Voltar para a fila</button>` : ''}
      </div></td></tr>`;
    }).join('')
  }</tbody>`;
}

function renderHistory() {
  $$('#histFilter button').forEach((b) => { b.classList.toggle('on', b.dataset.f === ui.histFilter); b.setAttribute('aria-selected', b.dataset.f === ui.histFilter); });
  const list = S.history.filter((h) => ui.histFilter === 'all' || h.status === ui.histFilter);
  $('#historyList').innerHTML = list.length ? `<div class="card">${historyHtml(list.slice(0, 300))}</div>` : '<div class="empty">Nada por aqui ainda.</div>';
}

// ---------- registro detalhado de uma postagem ----------
let logEntry = null;
function openLog(id) {
  const h = S.history.find((x) => x.id === id);
  if (!h) return;
  logEntry = h;
  $('#logTitle').textContent = `${STATUS[h.status]?.[0] || h.status} · ${h.productName || ''}`;
  $('#logSub').textContent = `${fmtWhen(h.ts)} · ${h.video || ''}${h.durationMs ? ` · ${Math.round(h.durationMs / 1000)}s` : ''}`;
  const d = h.diag || {};
  const lines = (h.log || []).map((l) => {
    const cls = /❌|🛑|✗/.test(l) ? 'bad' : /✅|✓/.test(l) ? 'ok' : /▶/.test(l) ? 'stepl' : '';
    return `<li class="${cls}">${esc(l)}</li>`;
  }).join('');
  $('#logBody').innerHTML = `
    ${h.error ? `<div class="log-error"><b>${esc(h.step || '')}</b><br>${esc(h.error)}</div>` : ''}
    <div class="log-summary">
      <div><b>Etapa</b>${esc(h.step || '—')}</div>
      <div><b>Produto vinculado</b>${esc(h.linkedProduct || '—')}</div>
      <div><b>Página</b>${esc(d.url || '—')}</div>
      <div><b>Tentativa</b>${h.attempt || 1}</div>
    </div>
    ${h.shot ? `<img class="log-shot" src="${h.shot}" alt="Captura da tela do TikTok no momento" title="Clique para abrir em tamanho real" id="logShot">` : '<p class="muted small">Sem captura de tela para este registro.</p>'}
    <h3>Passo a passo</h3>
    ${lines ? `<ol class="timeline">${lines}</ol>` : '<p class="muted small">Sem registro de passos.</p>'}
    ${d.pageText ? `<details><summary class="link">Texto que estava na página</summary><pre class="diag">${esc(d.pageText)}</pre></details>` : ''}
    ${h.diag ? `<details><summary class="link">Dados técnicos</summary><pre class="diag">${esc(JSON.stringify({ ...d, pageText: undefined }, null, 2))}</pre></details>` : ''}
    ${h.caption ? `<details><summary class="link">Legenda usada</summary><pre class="diag">${esc(h.caption)}</pre></details>` : ''}`;
  $('#logDlg').showModal();
  const img = $('#logShot');
  if (img) img.onclick = () => { const w = window.open(); if (w) w.document.write(`<img src="${h.shot}" style="max-width:100%">`); };
}
function logReport(h) {
  return {
    app: 'AutoPoster TikTok Shop', version: chrome.runtime.getManifest().version, generatedAt: new Date().toISOString(),
    status: h.status, when: new Date(h.ts).toISOString(), product: h.productName, video: h.video, step: h.step, error: h.error,
    linkedProduct: h.linkedProduct, attempt: h.attempt, durationMs: h.durationMs, settings: { speed: S.settings.speed, linkProduct: S.settings.linkProduct, brandedContent: S.settings.brandedContent, uploadUrl: S.settings.uploadUrl },
    log: h.log, diag: h.diag, caption: h.caption, screenshot: h.shot || null,
  };
}
$('#logClose').onclick = () => $('#logDlg').close();
$('#logCopy').onclick = async () => {
  if (!logEntry) return;
  const { screenshot, ...rest } = logReport(logEntry);
  try { await navigator.clipboard.writeText(JSON.stringify(rest, null, 2)); toast('Relatório copiado ✓ (sem a imagem — para incluir a imagem, use Baixar)'); } catch (_) { toast('Não consegui copiar. Use "Baixar relatório".', true); }
};
$('#logDownload').onclick = () => {
  if (!logEntry) return;
  const blob = new Blob([JSON.stringify(logReport(logEntry), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `autoposter-registro-${new Date(logEntry.ts).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

// ---------- configurações ----------
function fillSettings() {
  const f = $('#settingsForm');
  const s = S.settings;
  const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}">${String(h).padStart(2, '0')}:00${h === 24 ? ' (meia-noite)' : ''}</option>`).join('');
  f.activeStartHour.innerHTML = hours(0, 23);
  f.activeEndHour.innerHTML = hours(1, 24);
  for (const k of ['jitterMinutes', 'maxPerDay', 'hashtagsCount', 'activeStartHour', 'activeEndHour', 'videoOrder', 'onExhausted', 'maxRetries', 'pauseAfterFailures', 'uploadUrl', 'speed']) f[k].value = s[k];
  for (const k of ['linkProduct', 'brandedContent', 'foregroundTab', 'closeTabAfter', 'keepAwake', 'keepScreenOn', 'telegramEnabled', 'telegramEachPost', 'telegramSummary']) f[k].checked = !!s[k];
  f.telegramSummaryHour.innerHTML = hours(0, 23);
  f.telegramSummaryHour.value = s.telegramSummaryHour ?? 22;
  f.telegramToken.value = s.telegramToken || '';
  f.telegramChatId.value = s.telegramChatId || '';
  $('#tgFields').hidden = !s.telegramEnabled;
  f.labels.value = JSON.stringify(s.labels, null, 2);
  setIntervalSeg(s.intervalMinutes);
  settingsDirty = false;
}
function setIntervalSeg(v) {
  $$('#intervalSeg button').forEach((b) => { b.classList.toggle('on', Number(b.dataset.v) === Number(v)); b.setAttribute('aria-checked', Number(b.dataset.v) === Number(v)); });
  $('#intervalSeg').dataset.value = v;
  $('#intervalWarn').hidden = Number(v) >= 30;
}
const clamp = (n, lo, hi, d) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);

async function saveSettings(e) {
  e.preventDefault();
  const f = e.target;
  let labels;
  try {
    labels = JSON.parse(f.labels.value);
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) throw new Error();
  } catch (_) { toast('Os textos dos botões (Avançado) têm um erro de formatação JSON.', true); return; }
  const d = DEFAULT_SETTINGS;
  const num = (k) => Number(f[k].value);
  const settings = {
    intervalMinutes: Number($('#intervalSeg').dataset.value) || 60,
    jitterMinutes: clamp(num('jitterMinutes'), 0, 20, d.jitterMinutes),
    maxPerDay: clamp(num('maxPerDay'), 1, 288, d.maxPerDay),
    hashtagsCount: clamp(num('hashtagsCount'), 0, 10, d.hashtagsCount),
    activeStartHour: clamp(num('activeStartHour'), 0, 23, 0),
    activeEndHour: clamp(num('activeEndHour'), 1, 24, 24),
    videoOrder: f.videoOrder.value, onExhausted: f.onExhausted.value,
    maxRetries: clamp(num('maxRetries'), 0, 3, d.maxRetries),
    pauseAfterFailures: clamp(num('pauseAfterFailures'), 1, 20, d.pauseAfterFailures),
    uploadUrl: /^https:\/\/www\.tiktok\.com\//.test(f.uploadUrl.value.trim()) ? f.uploadUrl.value.trim() : d.uploadUrl,
    linkProduct: f.linkProduct.checked, brandedContent: f.brandedContent.checked,
    foregroundTab: f.foregroundTab.checked, closeTabAfter: f.closeTabAfter.checked,
    keepAwake: f.keepAwake.checked,
    keepScreenOn: f.keepScreenOn.checked,
    speed: f.speed.value === 'normal' ? 'normal' : 'human',
    telegramEnabled: f.telegramEnabled.checked,
    telegramToken: f.telegramToken.value.trim(),
    telegramChatId: f.telegramChatId.value.trim(),
    telegramEachPost: f.telegramEachPost.checked,
    telegramSummary: f.telegramSummary.checked,
    telegramSummaryHour: clamp(Number(f.telegramSummaryHour.value), 0, 23, 22),
    labels: mergeLabels(labels),
  };
  const reschedule = settings.intervalMinutes !== S.settings.intervalMinutes;
  const r = await send('save-settings', { settings, reschedule });
  if (r.ok) {
    settingsDirty = false;
    toast('Configurações salvas ✓');
    $('#saveMsg').textContent = `Salvo às ${fmtTime(Date.now())}`;
  }
}

// ---------- produto ----------
let editing = null;      // chave do produto em edição ('' = novo)
let assignAfter = null;  // { folder?, paths? } para ligar o produto novo
let linkCheck = 0;       // evita que uma checagem antiga sobrescreva a mais nova
function openProduct(key, assign = null) {
  const p = key ? S.catalog[key] : null;
  if (key && !p) return;
  editing = key || '';
  assignAfter = assign;
  linkCheck++; // respostas atrasadas de um formulário anterior não mexem neste
  const f = $('#productForm');
  f.reset();
  $('#pdTitle').textContent = p ? p.displayName : 'Novo produto';
  const usedIn = p ? Object.values(S.folders).filter((x) => x.catalogKey === p.key).map((x) => x.folder) : [];
  $('#pdFolder').textContent = assign?.folder ? `Será ligado à pasta 📁 ${assign.folder}`
    : assign?.paths ? `Será ligado ao vídeo ${assign.paths[0].split('/').pop()}`
      : usedIn.length ? `Usado em: 📁 ${usedIn.join(' · ')}` : p ? 'Ainda não está ligado a nenhuma pasta' : 'Cole o link e salve. Depois escolha o produto nas pastas (tela Vídeos).';
  $('#pdNiche').innerHTML = Object.entries(NICHES).map(([k, n]) => `<option value="${k}">${esc(n.name)}</option>`).join('');
  for (const k of ['displayName', 'productUrl', 'productId', 'productQuery', 'productLabel', 'captions', 'hashtags', 'benefits']) f[k].value = p?.[k] || '';
  if (p && !p.productUrl && !p.productId && /^\d{6,}$/.test(p.productQuery || '')) { f.productUrl.value = p.productQuery; f.productId.value = p.productQuery; f.productQuery.value = ''; }
  f.niche.value = NICHES[p?.niche] ? p.niche : 'geral';
  f.enabled.checked = p ? p.enabled !== false : true;
  $('#pdDelete').hidden = !p;
  $('#pdSave').innerHTML = `${icon('check')}${p ? 'Salvar produto' : 'Adicionar ao catálogo'}`;
  showLinkStatus();
  updateProductHints();
  renderPreview();
  $('#productDlg').showModal();
  setTimeout(() => (f.productUrl.value ? f.displayName : f.productUrl).focus(), 50);
}
function formProduct() {
  const f = $('#productForm');
  return {
    displayName: f.displayName.value.trim(),
    productUrl: firstUrl(f.productUrl.value) || f.productUrl.value.trim(), // só o endereço, sem o texto em volta
    productId: f.productId.value.trim(),
    productQuery: f.productQuery.value.trim(),
    productLabel: f.productLabel.value.trim().slice(0, 30),
    niche: f.niche.value,
    benefits: f.benefits.value,
    captions: f.captions.value,
    hashtags: f.hashtags.value,
    enabled: f.enabled.checked,
  };
}
function setLinkStatus(text, color) {
  const el = $('#pdLinkStatus');
  el.textContent = text;
  el.style.color = color || '';
}
function showLinkStatus() {
  const f = $('#productForm');
  const id = f.productId.value.trim();
  const url = f.productUrl.value.trim();
  if (id) setLinkStatus(`✓ ID do produto: ${id}`, 'var(--green)');
  else if (url) setLinkStatus('Verificando o link…', 'var(--muted)');
  else if (f.productQuery.value.trim()) setLinkStatus('Sem link: a busca será só pelo nome (menos seguro). Cole o link para garantir.', 'var(--yellow)');
  else setLinkStatus('Copie o link do produto no TikTok Shop (Ctrl+C) e cole aqui (Ctrl+V).', 'var(--muted)');
}
// Lê o ID do link colado (links curtos são abertos para descobrir o destino).
async function checkLink() {
  const f = $('#productForm');
  const url = f.productUrl.value.trim();
  const my = ++linkCheck;
  if (!url) { f.productId.value = ''; showLinkStatus(); return; }
  const wantTitle = !f.displayName.value.trim();
  const quick = extractProductId(url);
  if (quick) {
    f.productId.value = quick;
    showLinkStatus();
    if (wantTitle) resolveProductLink(url, fetch, { wantTitle: true }).then((r) => { if (my === linkCheck && $('#productDlg').open) fillTitle(r.title); });
    return quick;
  }
  f.productId.value = '';
  setLinkStatus('Abrindo o link para achar o ID do produto…', 'var(--muted)');
  const r = await resolveProductLink(url, fetch, { wantTitle });
  if (my !== linkCheck) return;
  if (r.id) { f.productId.value = r.id; showLinkStatus(); if ($('#productDlg').open) fillTitle(r.title); return r.id; }
  setLinkStatus('✗ ' + r.error, 'var(--red)');
  return null;
}
// Preenche o nome do produto a partir da página do link (só campos vazios).
function fillTitle(title) {
  if (!title) return;
  const f = $('#productForm');
  if (!f.displayName.value.trim()) f.displayName.value = title.slice(0, 60);
  if (!f.productQuery.value.trim()) f.productQuery.value = title;
  updateProductHints();
  renderPreview();
}
let linkTimer;
function updateProductHints() {
  $('#pdLabelCount').textContent = $('#productForm').productLabel.value.length;
}
function renderPreview() {
  if (editing == null) return;
  const data = formProduct();
  const p = { ...(S.catalog[editing] || {}), ...data, displayName: data.displayName || 'seu produto' };
  const series = previewSeries(p, S.settings, 3);
  $('#pdPreview').innerHTML = series.map((r, i) => {
    const prev = i ? series[i - 1].hashtags : null;
    const tags = r.hashtags.map((t) => `<span class="${prev && !prev.includes(t) ? 'new' : ''}">${esc(t)}</span>`).join(' ');
    return `<div class="ex"><span class="k">Post ${i + 1}</span>${esc(r.body)}${tags ? `\n\n<span class="tags">${tags}</span>` : ''}</div>`;
  }).join('');
}

async function deleteProduct(key) {
  const p = S.catalog[key];
  if (!p) return;
  const nf = Object.values(S.folders).filter((f) => f.catalogKey === p.key).length;
  const nv = Object.values(S.videos).filter((v) => v.catalogKey === p.key).length;
  const extra = nf || nv ? ` ${nf ? `${nf} pasta(s)` : ''}${nf && nv ? ' e ' : ''}${nv ? `${nv} vídeo(s)` : ''} ficarão sem produto e não serão postados até você escolher outro.` : '';
  if (!confirm(`Remover "${p.displayName}" do catálogo?${extra}`)) return;
  const r = await send('catalog-delete', { key: p.key });
  if (r.ok) toast('Produto removido');
}

// ---------- pasta ----------
async function pickFolder() {
  try {
    // "readwrite": além de ler os vídeos, grava a cópia de segurança das configurações na pasta
    const h = await window.showDirectoryPicker({ id: 'ttap-videos', mode: 'readwrite' });
    await saveRootHandle(h);
    await refreshFolder();
    const r = await send('rescan');
    await loadState();
    if (r.ok) toast(r.restored ? `Pasta conectada e configurações recuperadas da cópia de segurança ✓ (${Object.keys(S.catalog).length} produtos)` : `Pasta conectada: ${r.total} vídeos em ${Object.keys(S.folders).length} pastas`);
    render();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Não foi possível abrir a pasta: ' + e.message, true);
  }
}
async function reauth() {
  const h = await getRootHandle();
  if (!h) return pickFolder();
  try {
    writePerm = await permissionState(h, true, 'readwrite');
    folderPerm = writePerm === 'granted' ? 'granted' : await permissionState(h, true);
  } catch (e) { toast(e.message, true); }
  if (folderPerm === 'granted') {
    const r = await send('rescan');
    if (r.ok) toast(`Acesso liberado. ${r.total} vídeos encontrados.`);
  } else {
    toast('Permissão negada. Sem ela a extensão não consegue ler os vídeos.', true);
  }
  render();
}
async function rescan() {
  const r = await send('rescan');
  if (r.ok) toast(`${r.total} vídeos · ${r.added} novos${r.missing ? ` · ${r.missing} sumiram` : ''}`);
}

// ---------- ações ----------
async function toggleRun() {
  if (S.runtime.running) { if ((await send('pause')).ok) toast('Pausado'); return; }
  if (folderPerm !== 'granted') { toast('Conecte a pasta de vídeos primeiro.', true); return; }
  if (!previewQueue(S, 1).length) { toast('Nada para postar: ligue as pastas a produtos do catálogo (tela Vídeos).', true); return; }
  if ((await send('start')).ok) toast('Iniciado! O primeiro post sai em cerca de 1 minuto.');
}
async function dryRun(path) {
  if (!path && !previewQueue(S, 1).length) { toast('Nada para testar: ligue uma pasta com vídeos a um produto do catálogo.', true); return; }
  const r = await send('dry-run', path ? { path } : {});
  if (r.ok) toast('Teste: preenchendo tudo no TikTok Studio, sem publicar…');
}
async function postNow(path) {
  if (!path && !previewQueue(S, 1).length) { toast('Nada para postar: ligue uma pasta com vídeos a um produto do catálogo.', true); return; }
  if (!confirm('Publicar agora no TikTok?')) return;
  const r = await send('post-now', path ? { path } : {});
  if (r.ok) toast('Publicando no TikTok Studio…');
}

function go(v) {
  if (view === 'settings' && v !== 'settings' && settingsDirty && !confirm('Você tem alterações não salvas nas configurações. Sair mesmo assim?')) return;
  view = v;
  $$('.nav').forEach((n) => { n.classList.toggle('active', n.dataset.view === v); n.setAttribute('aria-current', n.dataset.view === v ? 'page' : 'false'); });
  $$('.view').forEach((s) => { s.hidden = s.id !== `view-${v}`; });
  if (v === 'settings') { fillSettings(); $('#saveMsg').textContent = ''; }
  history.replaceState(null, '', '#' + v);
  render();
  window.scrollTo({ top: 0 });
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-goto]');
  if (!t || t.disabled) return;
  if (t.matches('.nav')) return go(t.dataset.view);
  if (t.dataset.goto) return go(t.dataset.goto);
  if (t.dataset.gotoQueue) { ui.queueFilter = t.dataset.gotoQueue; return go('queue'); }
  if (t.dataset.themeSet) {
    document.documentElement.dataset.theme = t.dataset.themeSet;
    try { localStorage.setItem('ttap-theme', t.dataset.themeSet); } catch (_) { /* ok */ }
    return renderChrome();
  }
  const setup = t.dataset.setup;
  if (setup) {
    if (setup === 'pick') return pickFolder();
    if (setup === 'reauth') return reauth();
    if (setup.startsWith('goto:')) return go(setup.slice(5));
    if (setup === 'dry') return dryRun();
    if (setup === 'start') return toggleRun();
    if (setup === 'new-product') return openProduct(null);
    if (setup === 'sync') return $('#btnSync').click();
  }
  if (t.dataset.newProduct) return openProduct(null);
  if (t.dataset.deleteProd) return deleteProduct(t.dataset.deleteProd);
  if (t.dataset.act === 'pick') return pickFolder();
  if (t.dataset.act === 'reauth') return reauth();
  if (t.dataset.act === 'rescan') return rescan();
  if (t.dataset.act === 'enable-backup') {
    const h = await getRootHandle();
    if (!h) return pickFolder();
    try { writePerm = await permissionState(h, true, 'readwrite'); } catch (e) { toast(e.message, true); }
    if (writePerm === 'granted') { await send('ping'); toast('Cópia de segurança ativada ✓'); } else toast('Sem a permissão de edição a cópia de segurança não é gravada.', true);
    return render();
  }
  if (t.dataset.edit) return openProduct(t.dataset.edit);
  if (t.dataset.testProd) {
    const v = previewQueue({ ...S, runtime: { ...S.runtime, lastProduct: null } }, 200).find((x) => x.product === t.dataset.testProd);
    return v ? dryRun(v.video.path) : toast('Esse produto não tem vídeos pendentes.', true);
  }
  if (t.dataset.toggleProd) {
    const p = S.catalog[t.dataset.toggleProd];
    return p && send('catalog-save', { key: p.key, data: { enabled: p.enabled === false } });
  }
  if (t.dataset.log) return openLog(t.dataset.log);
  if (t.dataset.reactivate) return send('catalog-save', { key: t.dataset.reactivate, data: { unavailable: false } }).then((r) => r.ok && toast('Produto reativado ✓'));
  if (t.dataset.post) return postNow(t.dataset.post);
  if (t.dataset.dry) return dryRun(t.dataset.dry);
  if (t.dataset.skip) return send('set-video-status', { paths: [t.dataset.skip], status: 'skipped' });
  if (t.dataset.requeue) return send('set-video-status', { paths: [t.dataset.requeue], status: 'pending' });
  if (t.dataset.markPosted) return send('set-video-status', { paths: [t.dataset.markPosted], status: 'posted' });
  if (t.closest('#queueFilter')) { ui.queueFilter = t.dataset.f; return renderQueue(); }
  if (t.closest('#histFilter')) { ui.histFilter = t.dataset.f; return renderHistory(); }
  if (t.closest('#intervalSeg')) { settingsDirty = true; return setIntervalSeg(t.dataset.v); }
});

$('#btnToggle').onclick = toggleRun;
$('#sideToggle').onclick = toggleRun;
$('#btnNow').onclick = () => postNow();
$('#btnDry').onclick = () => dryRun();
$('#btnCancel').onclick = () => send('cancel-job');
$('#btnClearHist').onclick = async () => { if (confirm('Apagar todo o histórico?')) await send('clear-history'); };
$('#btnResetAll').onclick = async () => {
  if (confirm('Isso apaga produtos, fila, histórico e configurações (seus vídeos na pasta NÃO são apagados). Continuar?')) { await send('reset-all'); location.reload(); }
};
$('#btnResetLabels').onclick = () => { $('#settingsForm').labels.value = JSON.stringify(DEFAULT_LABELS, null, 2); settingsDirty = true; toast('Textos padrão restaurados — clique em Salvar.'); };
$('#btnRevert').onclick = () => { fillSettings(); $('#saveMsg').textContent = ''; toast('Alterações descartadas'); };
$('#btnRequeueFailed').onclick = async () => {
  const paths = Object.values(S.videos).filter((v) => v.status === 'failed').map((v) => v.path);
  if (paths.length && (await send('set-video-status', { paths, status: 'pending' })).ok) toast(`${paths.length} vídeo(s) voltaram para a fila`);
};
$('#settingsForm').addEventListener('submit', saveSettings);
$('#settingsForm').addEventListener('input', () => { settingsDirty = true; $('#saveMsg').textContent = 'Alterações não salvas'; });
$('#settingsForm').telegramEnabled.addEventListener('change', (e) => { $('#tgFields').hidden = !e.target.checked; });
$('#btnTgFind').onclick = async () => {
  const f = $('#settingsForm');
  const r = await send('telegram-find-chat', { token: f.telegramToken.value });
  if (r.ok) { f.telegramChatId.value = r.chatId; settingsDirty = true; $('#saveMsg').textContent = 'Alterações não salvas'; toast(`Chat encontrado${r.name ? ': ' + r.name : ''} ✓ — clique em Salvar`); }
};
$('#btnTgTest').onclick = async () => {
  const f = $('#settingsForm');
  const r = await send('telegram-test', { token: f.telegramToken.value, chatId: f.telegramChatId.value });
  if (r.ok) toast('Mensagem enviada ✓ — confira no Telegram');
};
$('#btnExport').onclick = async () => {
  const r = await send('export');
  if (!r.ok) return;
  const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `autoposter-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Backup exportado ✓');
};
$('#btnImport').onclick = () => $('#importFile').click();
$('#importFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { toast('Arquivo inválido.', true); return; }
  if (!confirm('Importar este backup? Produtos e configurações atuais serão substituídos e o AutoPoster ficará pausado.')) return;
  const r = await send('import', { data });
  if (r.ok) toast(`Backup importado: ${r.products} produtos ✓`);
};
$('#btnInspect').onclick = async () => {
  const r = await send('inspect');
  const out = $('#inspectOut');
  if (r.ok) { out.hidden = false; out.textContent = JSON.stringify(r.diag, null, 2); }
};

$('#queueProduct').onchange = (e) => { ui.queueFolder = e.target.value; renderQueue(); };
$('#btnNewProduct').onclick = () => openProduct(null);
$('#btnSync').onclick = async () => {
  if (folderPerm !== 'granted') { toast('Conecte a pasta de vídeos primeiro (um vídeo dela é usado só para abrir o formulário).', true); return; }
  if (!confirm('Importar a sua vitrine?\n\nA extensão vai abrir o TikTok Studio, carregar um vídeo da sua pasta só para abrir o formulário, ler todos os produtos da vitrine e fechar SEM publicar nada.')) return;
  const r = await send('sync-showcase');
  if (r.ok) toast('Lendo a sua vitrine no TikTok Studio…');
};

// Escolher o produto de uma pasta / de um vídeo
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-assign-folder], select[data-assign-video]');
  if (!sel) return;
  const folder = sel.dataset.assignFolder;
  const path = sel.dataset.assignVideo;
  if (sel.value === '__new__') {
    renderQueue(); // volta o seletor ao valor atual
    return openProduct(null, folder ? { folder } : { paths: [path] });
  }
  const r = await send('assign', folder ? { folder, catalogKey: sel.value || null } : { paths: [path], catalogKey: sel.value || null });
  if (r.ok) toast(sel.value ? `Produto: ${nameOf(sel.value)} ✓` : folder ? 'Pasta sem produto' : 'Vídeo usa o produto da pasta');
});
$('#pdDelete').onclick = () => {
  const key = editing;
  $('#productDlg').close('cancel');
  deleteProduct(key);
};
$('#queueSearch').oninput = (e) => { ui.queueSearch = e.target.value; renderQueue(); };

$('#productForm').addEventListener('input', (e) => {
  updateProductHints();
  if (e.target.name === 'productUrl') { clearTimeout(linkTimer); linkTimer = setTimeout(checkLink, 450); return; }
  if (e.target.name === 'productQuery' && !$('#productForm').productId.value) showLinkStatus();
  if (!['productQuery', 'productLabel'].includes(e.target.name)) renderPreview();
});
$('#productForm').addEventListener('change', (e) => { if (e.target.name === 'niche') renderPreview(); });
$('#pdRegen').onclick = () => renderPreview();
$('#productDlg').addEventListener('close', async () => {
  linkCheck++;
  const key = editing;
  const assign = assignAfter;
  editing = null;
  assignAfter = null;
  if ($('#productDlg').returnValue !== 'save' || key == null) return;
  const f = $('#productForm');
  if (f.productUrl.value.trim() && !f.productId.value.trim()) await checkLink();
  const data = formProduct();
  if (data.productUrl && !data.productId) {
    toast('Não consegui achar o ID nesse link. Confira o link e tente de novo.', true);
    if (!data.productQuery) return;
    data.productUrl = '';
  }
  if (!key && !data.productId && !data.productQuery && !data.displayName) { toast('Cole o link do produto para adicionar.', true); return; }
  const r = await send('catalog-save', { key: key || null, data, assignFolder: assign?.folder, assignPaths: assign?.paths });
  if (r.ok) {
    toast(data.productId || data.productQuery ? (key ? 'Produto salvo ✓' : 'Produto adicionado ao catálogo ✓') + (assign ? ' e ligado' : '') : 'Produto salvo, mas sem link ele não entra na fila', !(data.productId || data.productQuery));
  } else if (r.existingKey && assign && confirm(`Esse produto já está no catálogo como "${nameOf(r.existingKey)}". Usar ele?`)) {
    const a = await send('assign', assign.folder ? { folder: assign.folder, catalogKey: r.existingKey } : { paths: assign.paths, catalogKey: r.existingKey });
    if (a.ok) toast(`Produto: ${nameOf(r.existingKey)} ✓`);
  }
});

window.addEventListener('beforeunload', (e) => { if (settingsDirty && view === 'settings') { e.preventDefault(); e.returnValue = ''; } });

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  await loadState();
  if (changes.runtime) await refreshFolder();
  if (changes.settings && view === 'settings' && !settingsDirty) fillSettings();
  render();
});

setInterval(tickCountdown, 1000);
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden) { await refreshFolder(); render(); }
});

(async () => {
  await send('ping'); // garante que dados da versão antiga já foram convertidos
  await loadState();
  await refreshFolder();
  const hash = location.hash.slice(1);
  go(TITLES[hash] ? hash : 'overview');
  // Lê a pasta de novo ao abrir o painel, para mostrar vídeos novos
  if (folderPerm === 'granted' && !S.runtime.currentJob) send('rescan');
})();
