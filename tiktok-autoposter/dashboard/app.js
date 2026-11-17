import { DEFAULT_SETTINGS, DEFAULT_LABELS } from '../lib/defaults.js';
import { previewQueue, countPostedToday, isLinkReady, productBlocked } from '../lib/scheduler.js';
import { previewSeries, NICHES } from '../lib/captions.js';
import { getRootHandle, saveRootHandle, permissionState } from '../lib/fsaccess.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;

let S = { settings: DEFAULT_SETTINGS, products: {}, videos: {}, history: [], runtime: {} };
let folderPerm = 'none';
let folderName = null;
let view = 'overview';
let settingsDirty = false;
const ui = { queueFilter: 'pending', queueProduct: '', queueSearch: '', histFilter: 'all' };

const TITLES = {
  overview: ['Visão geral', 'Acompanhe as postagens automáticas no seu TikTok.'],
  products: ['Produtos', 'Configure o link do TikTok Shop e as legendas de cada produto.'],
  queue: ['Vídeos', 'Todos os vídeos encontrados na sua pasta.'],
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
  const s = await chrome.storage.local.get(['settings', 'products', 'videos', 'history', 'runtime']);
  const settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
  settings.labels = { ...DEFAULT_LABELS, ...(settings.labels || {}) };
  S = { settings, products: s.products || {}, videos: s.videos || {}, history: s.history || [], runtime: s.runtime || {} };
}

async function refreshFolder() {
  try {
    const h = await getRootHandle();
    folderName = h?.name || null;
    folderPerm = h ? await permissionState(h) : 'none';
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
  unconfirmed: ['Verificar no TikTok', 'warn'],
};
const pill = (st) => `<span class="pill ${STATUS[st]?.[1] || ''}">${STATUS[st]?.[0] || esc(st)}</span>`;

// ---------- passos de configuração ----------
function setupSteps() {
  const prods = Object.values(S.products);
  const ready = prods.filter((p) => p.enabled !== false && isLinkReady(p));
  const vids = Object.values(S.videos).filter((v) => v.status !== 'missing').length;
  const tested = !!S.history.find((h) => h.status === 'dry-run' || h.status === 'posted');
  return [
    {
      done: !!folderName && folderPerm === 'granted' && vids > 0,
      title: 'Escolher a pasta',
      text: folderName ? (folderPerm === 'granted' ? `${vids} vídeos em “${folderName}”` : 'Reautorize o acesso à pasta') : 'Uma subpasta para cada produto',
      btn: folderName && folderPerm !== 'granted' ? ['reauth', 'Reautorizar'] : ['pick', folderName ? 'Trocar pasta' : 'Escolher pasta'],
    },
    {
      done: ready.length > 0,
      title: 'Configurar os links',
      text: prods.length ? `${ready.length} de ${prods.filter((p) => p.enabled !== false).length} produtos com link` : 'Aparece depois de escolher a pasta',
      btn: ['goto:products', 'Abrir produtos'],
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

  const needs = Object.values(S.products).filter((p) => p.enabled !== false && !isLinkReady(p)).length;
  const pb = $('#navProdBadge');
  pb.hidden = !needs || !S.settings.linkProduct;
  pb.textContent = needs;
  pb.title = `${needs} produto(s) sem link configurado`;
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
  } else if (!S.runtime.running && S.runtime.consecutiveFailures >= (S.settings.pauseAfterFailures || 3)) {
    html = `<div class="banner err">${icon('alert')}<div class="grow"><b>Pausado após ${S.runtime.consecutiveFailures} falhas seguidas</b><span class="muted small">Veja o motivo no Histórico, faça um teste e depois clique em Iniciar.</span></div><button class="btn small" data-goto="history">Ver histórico</button></div>`;
  } else if (Object.values(S.videos).some((v) => v.status === 'unconfirmed')) {
    const n = Object.values(S.videos).filter((v) => v.status === 'unconfirmed').length;
    html = `<div class="banner warn">${icon('alert')}<div class="grow"><b>${n} post${n > 1 ? 's' : ''} para conferir</b><span class="muted small">Cliquei em Publicar mas não vi a confirmação. Veja em “Meus posts” do TikTok Studio se saiu e marque na lista de vídeos. Esses vídeos não são repetidos automaticamente.</span></div><button class="btn small" data-goto-queue="unconfirmed">Ver vídeos</button></div>`;
  } else if (S.runtime.running && S.settings.linkProduct && !previewQueue(S, 1).length && Object.keys(S.videos).length) {
    html = `<div class="banner warn">${icon('alert')}<div class="grow"><b>Nada para postar agora</b><span class="muted small">Não há vídeos pendentes em produtos ativos com link configurado.</span></div><button class="btn small" data-goto="products">Ver produtos</button></div>`;
  }
  el.innerHTML = html;
}

function stats() {
  const vids = Object.values(S.videos);
  const pending = vids.filter((v) => v.status === 'pending' && !productBlocked(S.products[v.product], S.settings)).length;
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
    $('#setupCount').textContent = `${steps.filter((s) => s.done).length} de 4 concluídos`;
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
  const withQueue = new Set(Object.values(S.videos).filter((v) => v.status === 'pending' && !productBlocked(S.products[v.product], S.settings)).map((v) => v.product)).size;
  $('#stProducts').textContent = `de ${withQueue} produto${withQueue === 1 ? '' : 's'}`;
  $('#stFails').textContent = st.fails;
  $('#stTotal').textContent = `${st.posted} publicados no total`;
  tickCountdown();

  const job = S.runtime.currentJob;
  $('#jobCard').hidden = !job;
  if (job) {
    $('#jobTitle').textContent = `${job.dryRun ? 'Testando (sem publicar)' : 'Postando'}: ${job.productName || job.product} — ${job.path.split('/').pop()}`;
    $('#jobStep').textContent = job.step || '';
    const idx = Math.max(0, JOB_STEPS.indexOf(job.step));
    $('#jobBar').style.width = `${Math.round(((idx + 1) / JOB_STEPS.length) * 100)}%`;
  }

  // pasta
  const files = Object.values(S.videos).filter((v) => v.status !== 'missing');
  const size = files.reduce((a, v) => a + (v.size || 0), 0);
  $('#folderBox').innerHTML = folderName
    ? `<div class="folder"><div class="folder-icon">${icon('folder')}</div><div class="grow"><b>${esc(folderName)}</b>
        <div class="muted small">${Object.keys(S.products).length} produtos · ${files.length} vídeos · ${fmtSize(size)}</div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${folderPerm === 'granted' ? `<span class="pill ok">${icon('check')}Conectada</span>` : `<span class="pill bad">${icon('lock')}Sem permissão</span>`}
        ${S.runtime.lastScanAt ? `<span class="muted small">lida às ${fmtTime(S.runtime.lastScanAt)} · relida antes de cada post</span>` : ''}</div></div></div>
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
        <div style="min-width:0"><div class="p">${esc(S.products[it.product]?.displayName || it.product)}</div><div class="f">${esc(it.video.name)}</div></div></li>`).join('')
    : `<div class="empty">${Object.keys(S.products).length ? 'Sem vídeos prontos para postar. Configure os links dos produtos ou adicione vídeos.' : 'Escolha a pasta de vídeos para montar a fila.'}</div>`;

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
    const tech = h.diag || h.log ? `<details><summary>Detalhes técnicos</summary><pre class="diag">${esc(JSON.stringify({ etapas: h.log, ...(h.diag || {}) }, null, 2))}</pre></details>` : '';
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
  const entries = Object.values(S.products).sort((a, b) => (isLinkReady(a) - isLinkReady(b)) || a.displayName.localeCompare(b.displayName, 'pt-BR'));
  if (!entries.length) {
    $('#productsGrid').innerHTML = `<div class="empty" style="grid-column:1/-1">Nenhum produto ainda. Escolha a pasta de vídeos (uma subpasta por produto).<br><button class="btn primary" data-act="pick">${icon('folder')}Escolher pasta</button></div>`;
    return;
  }
  $('#productsGrid').innerHTML = entries.map((p) => {
    const vids = Object.values(S.videos).filter((v) => v.product === p.folder);
    const c = (s) => vids.filter((v) => v.status === s).length;
    const total = vids.filter((v) => v.status !== 'missing').length || 1;
    const pct = Math.round((c('posted') / total) * 100);
    const ready = isLinkReady(p);
    const off = p.enabled === false;
    let badge;
    if (off) badge = '<span class="pill">Pausado</span>';
    else if (!ready) badge = `<span class="pill warn">${icon('alert')}Falta o link</span>`;
    else if (!c('pending')) badge = '<span class="pill">Sem vídeos novos</span>';
    else badge = '<span class="pill ok">Na fila</span>';
    const tested = p.linkTestedAt && p.linkTestedQuery === p.productQuery;
    const niche = NICHES[p.niche]?.name || NICHES.geral.name;
    return `<div class="product ${off ? 'off' : ''} ${!ready && !off ? 'needs' : ''}">
      <div class="top"><div style="min-width:0"><h3>${esc(p.displayName)}</h3><div class="folder-name">📁 ${esc(p.folder)}</div></div>${badge}</div>
      <div class="bar" title="${pct}% publicado"><i style="width:${pct}%"></i></div>
      <div class="counts"><div><b>${c('pending')}</b>pendentes</div><div><b>${c('posted')}</b>publicados</div><div><b>${c('failed')}</b>falhas</div></div>
      <div class="linkbox">
        <div class="row">${icon('cart')}${ready ? `Busca: <b>${esc(p.productQuery)}</b>` : '<span style="color:var(--yellow)">Link não configurado</span>'}</div>
        ${ready ? `<div class="row">${icon('shield')}${tested ? `<span style="color:var(--green)">Link conferido ${fmtWhen(p.linkTestedAt)}</span>` : '<span class="muted">Ainda não testado — faça um teste</span>'}</div>` : ''}
        ${tested && p.linkTestedMatch ? `<div class="row muted small" title="${esc(p.linkTestedMatch)}">↳ ${esc(p.linkTestedMatch.slice(0, 60))}</div>` : ''}
        <div class="row">${icon('hash')}${esc(niche)}${p.hashtags?.trim() ? ' + hashtags próprias' : ''}</div>
      </div>
      <div class="btns">
        <button class="btn small ${ready ? '' : 'primary'}" data-edit="${esc(p.folder)}">${ready ? 'Editar' : 'Configurar link'}</button>
        ${ready && c('pending') ? `<button class="btn small" data-test-prod="${esc(p.folder)}">${icon('flask')}Testar</button>` : ''}
        <button class="btn small ghost" data-toggle-prod="${esc(p.folder)}">${off ? 'Ativar' : 'Pausar'}</button>
      </div>
    </div>`;
  }).join('');
}

function renderQueue() {
  const sel = $('#queueProduct');
  const opts = ['<option value="">Todos os produtos</option>', ...Object.values(S.products).map((p) => `<option value="${esc(p.folder)}">${esc(p.displayName)}</option>`)].join('');
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  sel.value = ui.queueProduct;
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
    .filter((v) => !ui.queueProduct || v.product === ui.queueProduct)
    .filter((v) => !q || v.path.toLowerCase().includes(q))
    .sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0) || a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));

  if (!list.length) {
    $('#queueTable').innerHTML = '<tbody><tr><td><div class="empty">Nenhum vídeo aqui.</div></td></tr></tbody>';
    return;
  }
  $('#queueTable').innerHTML = `<thead><tr><th>Vídeo</th><th>Produto</th><th>Tamanho</th><th>Status</th><th><span class="sr">Ações</span></th></tr></thead><tbody>${
    list.slice(0, 500).map((v) => {
      const p = S.products[v.product];
      const blocked = v.status === 'pending' && productBlocked(p, S.settings);
      return `<tr>
      <td class="file" title="${esc(v.path)}">${esc(v.name)}${v.hasTxt ? ' <span class="pill info" title="tem legenda própria (.txt)">txt</span>' : ''}${v.lastError ? `<div class="small" style="color:var(--red);white-space:normal">${esc(v.lastError)}</div>` : ''}</td>
      <td>${esc(p?.displayName || v.product)}${blocked ? `<div class="small" style="color:var(--yellow)">${p?.enabled === false ? 'produto pausado' : 'falta configurar o link'}</div>` : ''}</td>
      <td class="muted">${v.size ? fmtSize(v.size) : ''}</td>
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

// ---------- configurações ----------
function fillSettings() {
  const f = $('#settingsForm');
  const s = S.settings;
  const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}">${String(h).padStart(2, '0')}:00${h === 24 ? ' (meia-noite)' : ''}</option>`).join('');
  f.activeStartHour.innerHTML = hours(0, 23);
  f.activeEndHour.innerHTML = hours(1, 24);
  for (const k of ['jitterMinutes', 'maxPerDay', 'hashtagsCount', 'activeStartHour', 'activeEndHour', 'videoOrder', 'onExhausted', 'maxRetries', 'pauseAfterFailures', 'uploadUrl']) f[k].value = s[k];
  for (const k of ['linkProduct', 'brandedContent', 'foregroundTab', 'closeTabAfter']) f[k].checked = !!s[k];
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
    labels: { ...DEFAULT_LABELS, ...labels },
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
let editing = null;
function openProduct(folder) {
  const p = S.products[folder];
  if (!p) return;
  editing = folder;
  const f = $('#productForm');
  $('#pdTitle').textContent = p.displayName;
  $('#pdFolder').textContent = `📁 ${p.folder}`;
  $('#pdNiche').innerHTML = Object.entries(NICHES).map(([k, n]) => `<option value="${k}">${esc(n.name)}</option>`).join('');
  for (const k of ['displayName', 'productQuery', 'productLabel', 'captions', 'hashtags', 'benefits']) f[k].value = p[k] || '';
  f.niche.value = NICHES[p.niche] ? p.niche : 'geral';
  f.enabled.checked = p.enabled !== false;
  updateProductHints();
  renderPreview();
  $('#productDlg').showModal();
  setTimeout(() => (p.productQuery ? f.displayName : f.productQuery).focus(), 50);
}
function formProduct() {
  const f = $('#productForm');
  return {
    displayName: f.displayName.value.trim() || S.products[editing]?.displayName || '',
    productQuery: f.productQuery.value.trim(),
    productLabel: f.productLabel.value.trim().slice(0, 30),
    niche: f.niche.value,
    benefits: f.benefits.value,
    captions: f.captions.value,
    hashtags: f.hashtags.value,
    enabled: f.enabled.checked,
  };
}
function updateProductHints() {
  const f = $('#productForm');
  const q = f.productQuery.value.trim();
  const hint = $('#pdQueryHint');
  if (!q) { hint.textContent = 'Obrigatório para postar com o carrinho.'; hint.style.color = 'var(--yellow)'; }
  else if (/^\d{6,}$/.test(q)) { hint.textContent = '✓ ID do produto — o jeito mais seguro.'; hint.style.color = 'var(--green)'; }
  else { hint.textContent = 'Nome: precisa corresponder a um único produto na busca. Se houver parecidos, use o ID.'; hint.style.color = ''; }
  $('#pdLabelCount').textContent = f.productLabel.value.length;
}
function renderPreview() {
  if (!editing) return;
  const p = { ...S.products[editing], ...formProduct() };
  const series = previewSeries(p, S.settings, 3);
  $('#pdPreview').innerHTML = series.map((r, i) => {
    const prev = i ? series[i - 1].hashtags : null;
    const tags = r.hashtags.map((t) => `<span class="${prev && !prev.includes(t) ? 'new' : ''}">${esc(t)}</span>`).join(' ');
    return `<div class="ex"><span class="k">Post ${i + 1}</span>${esc(r.body)}${tags ? `\n\n<span class="tags">${tags}</span>` : ''}</div>`;
  }).join('');
}

// ---------- pasta ----------
async function pickFolder() {
  try {
    const h = await window.showDirectoryPicker({ id: 'ttap-videos', mode: 'read' });
    await saveRootHandle(h);
    await refreshFolder();
    const r = await send('rescan');
    await loadState();
    if (r.ok) toast(`Pasta conectada: ${r.total} vídeos em ${Object.keys(S.products).length} produtos`);
    render();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Não foi possível abrir a pasta: ' + e.message, true);
  }
}
async function reauth() {
  const h = await getRootHandle();
  if (!h) return pickFolder();
  try { folderPerm = await permissionState(h, true); } catch (e) { toast(e.message, true); }
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
  if (!previewQueue(S, 1).length) { toast('Nada para postar: configure o link de pelo menos um produto com vídeos pendentes.', true); return; }
  if ((await send('start')).ok) toast('Iniciado! O primeiro post sai em cerca de 1 minuto.');
}
async function dryRun(path) {
  if (!path && !previewQueue(S, 1).length) { toast('Nada para testar: configure o link de um produto com vídeos pendentes.', true); return; }
  const r = await send('dry-run', path ? { path } : {});
  if (r.ok) toast('Teste: preenchendo tudo no TikTok Studio, sem publicar…');
}
async function postNow(path) {
  if (!path && !previewQueue(S, 1).length) { toast('Nada para postar: configure o link de um produto com vídeos pendentes.', true); return; }
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
  }
  if (t.dataset.act === 'pick') return pickFolder();
  if (t.dataset.act === 'reauth') return reauth();
  if (t.dataset.act === 'rescan') return rescan();
  if (t.dataset.edit) return openProduct(t.dataset.edit);
  if (t.dataset.testProd) {
    const v = previewQueue({ ...S, runtime: { ...S.runtime, lastProduct: null } }, 200).find((x) => x.product === t.dataset.testProd);
    return v ? dryRun(v.video.path) : toast('Esse produto não tem vídeos pendentes.', true);
  }
  if (t.dataset.toggleProd) {
    const p = S.products[t.dataset.toggleProd];
    return send('save-product', { folder: p.folder, data: { enabled: p.enabled === false } });
  }
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
$('#btnInspect').onclick = async () => {
  const r = await send('inspect');
  const out = $('#inspectOut');
  if (r.ok) { out.hidden = false; out.textContent = JSON.stringify(r.diag, null, 2); }
};

$('#queueProduct').onchange = (e) => { ui.queueProduct = e.target.value; renderQueue(); };
$('#queueSearch').oninput = (e) => { ui.queueSearch = e.target.value; renderQueue(); };

$('#productForm').addEventListener('input', (e) => {
  updateProductHints();
  if (!['productQuery', 'productLabel'].includes(e.target.name)) renderPreview();
});
$('#productForm').addEventListener('change', (e) => { if (e.target.name === 'niche') renderPreview(); });
$('#pdRegen').onclick = () => renderPreview();
$('#productDlg').addEventListener('close', async () => {
  if ($('#productDlg').returnValue === 'save' && editing) {
    const data = formProduct();
    const r = await send('save-product', { folder: editing, data });
    if (r.ok) toast(data.productQuery ? 'Produto salvo ✓ — faça um teste para conferir o link' : 'Produto salvo, mas sem link ele não entra na fila', !data.productQuery);
  }
  editing = null;
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
  await loadState();
  await refreshFolder();
  const hash = location.hash.slice(1);
  go(TITLES[hash] ? hash : 'overview');
  // Lê a pasta de novo ao abrir o painel, para mostrar vídeos novos
  if (folderPerm === 'granted' && !S.runtime.currentJob) send('rescan');
})();
