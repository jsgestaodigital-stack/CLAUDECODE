// Funções puras de agendamento, escolha do próximo vídeo e montagem da legenda.
// Não usam APIs do Chrome, então podem ser testadas com Node.


const MIN = 60 * 1000;

export function isWithinActiveHours(date, startHour, endHour) {
  const h = date.getHours();
  if (startHour === endHour || (startHour === 0 && endHour >= 24)) return true;
  if (startHour < endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour; // faixa que atravessa a meia-noite (ex.: 18h–2h)
}

function nextActiveStart(date, startHour) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  d.setHours(startHour);
  if (d <= date) d.setDate(d.getDate() + 1);
  return d;
}

// Calcula o próximo horário de postagem a partir de `fromTs`.
export function computeNextRun(fromTs, settings, rand = Math.random) {
  const interval = Number(settings.intervalMinutes) || 60;
  const jitterMax = Math.min(Number(settings.jitterMinutes) || 0, Math.floor(interval / 3));
  const jitter = (rand() * 2 - 1) * jitterMax;
  let ts = fromTs + Math.max(2, interval + jitter) * MIN;
  const d = new Date(ts);
  if (!isWithinActiveHours(d, settings.activeStartHour, settings.activeEndHour)) {
    ts = nextActiveStart(d, settings.activeStartHour).getTime() + Math.floor(rand() * Math.max(1, jitterMax)) * MIN;
  }
  return Math.round(ts);
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Publicações de um dia: as publicadas na hora e as agendadas para aquele dia (pelo horário de publicação).
export function countForDay(history, dayTs) {
  const start = startOfDay(dayTs);
  const end = start + 24 * 60 * MIN;
  return (history || []).filter((h) => {
    if (h.status !== 'posted' && h.status !== 'scheduled') return false;
    const t = h.publishAt || h.ts;
    return t >= start && t < end;
  }).length;
}
export function countPostedToday(history, now = Date.now()) {
  return countForDay(history, now);
}

// ---------------------------------------------------------------------------------------------
// Modo agendamento
//   As SESSÕES são os poucos momentos do dia em que a extensão abre o TikTok Studio (horários
//   escolhidos por você). Em cada sessão ela agenda os próximos vídeos nos HORÁRIOS DE PUBLICAÇÃO,
//   que seguem o intervalo, a variação, o horário permitido e o limite por dia.
// ---------------------------------------------------------------------------------------------
export const SLOT_STEP_MIN = 5;   // o seletor de hora do TikTok anda de 5 em 5 minutos
export const MIN_LEAD_MIN = 20;   // o TikTok exige pelo menos 15 min de antecedência
export const SESSION_COVER_MIN = 90; // cada sessão cobre até a próxima sessão + esta folga

export function ceilToStep(ts, stepMin = SLOT_STEP_MIN) {
  const step = stepMin * MIN; // fusos do Brasil são horas cheias: múltiplos de 5 min batem com o relógio
  return Math.ceil(ts / step) * step;
}

// "09:00, 14h, 20:30" → [{h:9,m:0}, {h:14,m:0}, {h:20,m:30}] (ordenado, sem repetidos)
export function parseSessionTimes(text) {
  const out = [];
  for (const part of String(text || '').split(/[,;\s]+/)) {
    const m = part.trim().match(/^(\d{1,2})(?:[:hH.](\d{2})?)?$/);
    if (!m) continue;
    const h = Number(m[1]);
    const mi = Number(m[2] || 0);
    if (h > 23 || mi > 59) continue;
    if (!out.some((x) => x.h === h && x.m === mi)) out.push({ h, m: mi });
  }
  return out.sort((a, b) => a.h - b.h || a.m - b.m);
}
export const fmtSessionTimes = (list) => list.map((x) => `${String(x.h).padStart(2, '0')}:${String(x.m).padStart(2, '0')}`).join(', ');

// Próximo horário de sessão (sem a variação) estritamente depois de fromTs.
export function nextSessionBase(fromTs, settings) {
  const times = parseSessionTimes(settings.sessionTimes);
  if (!times.length) return null;
  for (let day = 0; day < 3; day++) {
    for (const t of times) {
      const d = new Date(fromTs);
      d.setDate(d.getDate() + day);
      d.setHours(t.h, t.m, 0, 0);
      if (d.getTime() > fromTs) return d.getTime();
    }
  }
  return null;
}

// Próxima sessão com a variação aleatória (0 a N min depois do horário).
export function computeNextSession(fromTs, settings, rand = Math.random) {
  const base = nextSessionBase(fromTs, settings);
  if (base == null) return null;
  const j = Math.max(0, Math.min(60, Number(settings.sessionJitterMinutes) || 0));
  return base + Math.round(rand() * j * MIN);
}

// Até quando uma sessão iniciada em `now` deve deixar posts agendados.
export function sessionHorizon(now, settings) {
  const next = nextSessionBase(now + 30 * MIN, settings) ?? now + 8 * 60 * MIN;
  return next + SESSION_COVER_MIN * MIN;
}

// Próximo horário de publicação: último agendado + intervalo ± variação, arredondado para
// 5 min, com antecedência mínima, dentro do horário permitido e respeitando o limite por dia.
export function nextSlot({ lastSlotAt, now = Date.now(), settings, history = [], leadMin = MIN_LEAD_MIN, rand = Math.random }) {
  const interval = Math.max(5, Number(settings.intervalMinutes) || 60);
  const jitterMax = Math.min(Number(settings.jitterMinutes) || 0, Math.floor(interval / 3));
  const earliest = now + leadMin * MIN;
  let t = lastSlotAt ? lastSlotAt + (interval + (rand() * 2 - 1) * jitterMax) * MIN : earliest;
  if (t < earliest) t = earliest;
  if (lastSlotAt && t < lastSlotAt + SLOT_STEP_MIN * MIN) t = lastSlotAt + SLOT_STEP_MIN * MIN;
  // arredonda para o múltiplo de 5 min mais próximo (sem ficar antes do mínimo)
  const step = SLOT_STEP_MIN * MIN;
  const min = Math.max(earliest, lastSlotAt ? lastSlotAt + step : 0);
  t = Math.round(t / step) * step;
  if (t < min) t = ceilToStep(min);
  const maxPerDay = Number(settings.maxPerDay) || 999;
  for (let i = 0; i < 40; i++) {
    const d = new Date(t);
    if (!isWithinActiveHours(d, settings.activeStartHour, settings.activeEndHour)) {
      t = ceilToStep(nextActiveStart(d, settings.activeStartHour).getTime() + Math.floor(rand() * Math.max(1, jitterMax)) * MIN);
      continue;
    }
    if (countForDay(history, t) >= maxPerDay) {
      const tomorrow = new Date(t);
      tomorrow.setHours(24, 0, 0, 0);
      t = isWithinActiveHours(tomorrow, settings.activeStartHour, settings.activeEndHour)
        ? ceilToStep(tomorrow.getTime() + Math.floor(rand() * Math.max(1, jitterMax)) * MIN)
        : ceilToStep(nextActiveStart(tomorrow, settings.activeStartHour).getTime() + Math.floor(rand() * Math.max(1, jitterMax)) * MIN);
      continue;
    }
    return t;
  }
  return null;
}

// Estima quantos vídeos cada sessão precisa agendar para não ficar buraco até a próxima.
// Devolve [{ at:{h,m}, needed }] — usado no painel para avisar quando o máximo por sessão é pouco.
export function sessionLoad(settings) {
  const times = parseSessionTimes(settings.sessionTimes);
  const interval = Math.max(5, Number(settings.intervalMinutes) || 60);
  const maxPerDay = Number(settings.maxPerDay) || 999;
  const out = [];
  let perDay = 0;
  times.forEach((t, i) => {
    const n = times[(i + 1) % times.length];
    let gap = (n.h * 60 + n.m) - (t.h * 60 + t.m);
    if (gap <= 0) gap += 24 * 60;
    let needed = 0;
    for (let m = 0; m < gap; m += interval) {
      const h = Math.floor(((t.h * 60 + t.m + m) % (24 * 60)) / 60);
      if (isWithinActiveHours(new Date(2000, 0, 1, h), settings.activeStartHour, settings.activeEndHour)) needed++;
    }
    perDay += needed;
    out.push({ at: t, next: n, gapMin: gap, needed });
  });
  return { sessions: out, perDay: Math.min(perDay, maxPerDay) };
}

// Variação do vídeo pelo nome do arquivo: G = gancho, C = corpo, A = CTA (ex.: LENCOL_G1C2A1.mp4).
export function variantOf(path) {
  const name = String(path || '').split('/').pop();
  const m = name.match(/G(\d+)[\s_-]*C(\d+)[\s_-]*A(\d+)/i);
  return m ? { g: Number(m[1]), c: Number(m[2]), a: Number(m[3]) } : null;
}

// Ordem "espalhada": escolhe o vídeo mais diferente dos últimos postados do mesmo produto —
// primeiro um gancho diferente, depois um corpo diferente, depois um CTA diferente.
// Empates: o gancho que menos apareceu até agora; depois o nome do arquivo.
export function pickSpread(candidates, recent, usage = {}) {
  const weights = [1, 0.6, 0.35, 0.2];
  const score = (v) => {
    const x = variantOf(v.path);
    if (!x) return 0;
    let p = 0;
    recent.slice(0, weights.length).forEach((r, i) => {
      if (!r) return;
      p += weights[i] * ((x.g === r.g ? 100 : 0) + (x.c === r.c ? 10 : 0) + (x.a === r.a ? 1 : 0));
    });
    return p;
  };
  const used = (v) => usage[variantOf(v.path)?.g] || 0;
  return [...candidates].sort((a, b) => score(a) - score(b) || used(a) - used(b)
    || a.path.localeCompare(b.path, 'pt-BR', { numeric: true }))[0];
}

function sortVideos(videos, order, rand) {
  const list = [...videos];
  if (order === 'random') {
    // ordem aleatória estável por vídeo (usa hash do caminho), para a fila não "pular" a cada render
    const key = (v) => hash(v.path + (v.shuffleSeed || ''));
    return list.sort((a, b) => key(a) - key(b));
  }
  return list.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));
}

// ---------------------------------------------------------------------------------------------
// Modelo de dados
//   catalog[key]  = produto do catálogo (link, ID, nome, nicho, legendas, memória de legendas…)
//   folders[name] = subpasta da pasta de vídeos → { folder, displayName, catalogKey }
//   videos[path]  = { path, folder, name, status, catalogKey? (produto só deste vídeo) … }
// O produto de um vídeo é o dele próprio (catalogKey) ou, se não tiver, o da pasta.
// ---------------------------------------------------------------------------------------------

// Identifica a configuração do link (para saber se o teste ainda vale depois de uma edição).
export function linkKey(item) {
  return `${String(item?.productId || '').trim()}|${String(item?.productQuery || '').trim()}`;
}

export function isLinkReady(item) {
  return !!(item && item.configured && (String(item.productId || '').trim() || String(item.productQuery || '').trim()));
}

export function productBlocked(item, settings) {
  if (!item || item.enabled === false) return true;
  if (settings?.linkProduct !== false && item.unavailable) return true; // indisponível na vitrine (sem estoque)
  return settings?.linkProduct !== false && !isLinkReady(item);
}

export function productKeyOf(state, video) {
  if (!video) return null;
  const own = video.catalogKey && state.catalog?.[video.catalogKey] ? video.catalogKey : null;
  if (own) return own;
  const fk = state.folders?.[video.folder]?.catalogKey;
  return fk && state.catalog?.[fk] ? fk : null;
}

export function itemOf(state, video) {
  const k = productKeyOf(state, video);
  return k ? state.catalog[k] : null;
}

export function newCatalogKey(data = {}) {
  const id = String(data.productId || '').trim();
  if (id) return 'id_' + id;
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Converte o formato antigo (1 produto por pasta em `products`) para catálogo + pastas.
export function migrate(state) {
  if (state.catalog && state.folders) return { changed: false, state };
  const catalog = { ...(state.catalog || {}) };
  const folders = { ...(state.folders || {}) };
  const old = state.products || {};
  const map = {};
  for (const [folder, p] of Object.entries(old)) {
    const hasConfig = p.configured || p.productUrl || p.productId || p.productQuery || p.benefits || p.captions || p.hashtags || (p.niche && p.niche !== 'geral');
    let key = null;
    if (hasConfig) {
      key = newCatalogKey(p);
      if (catalog[key]) key = key + '_' + Object.keys(catalog).length;
      const { folder: _f, ...rest } = p;
      catalog[key] = { ...rest, key, createdAt: p.createdAt || Date.now() };
    }
    map[folder] = key;
    folders[folder] = { folder, displayName: prettifyFolderName(folder), catalogKey: key, createdAt: p.createdAt || Date.now() };
  }
  const videos = {};
  for (const [path, v] of Object.entries(state.videos || {})) {
    const { product, ...rest } = v;
    videos[path] = { ...rest, folder: v.folder || product };
  }
  const runtime = { ...(state.runtime || {}) };
  if (runtime.lastProduct && map[runtime.lastProduct] !== undefined) runtime.lastProduct = map[runtime.lastProduct];
  return { changed: true, state: { ...state, catalog, folders, videos, runtime } };
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Retorna { product (chave do catálogo), video } do próximo post, ou null.
// Regras: só vídeos pendentes com produto ativo e link configurado; evita repetir o último
// produto; entre os candidatos, escolhe o que está há mais tempo sem postar (rodízio).
export function pickNext(state, opts = {}) {
  const { catalog = {}, videos = {}, runtime = {}, settings = {} } = state;
  const exclude = new Set(opts.excludePaths || []);
  const byProduct = new Map();
  for (const v of Object.values(videos)) {
    if (v.status !== 'pending' || exclude.has(v.path)) continue;
    const key = productKeyOf(state, v);
    if (!key || productBlocked(catalog[key], settings)) continue;
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(v);
  }
  if (byProduct.size === 0) return null;

  const lastProduct = opts.lastProduct ?? runtime.lastProduct;
  let candidates = [...byProduct.keys()];
  if (candidates.length > 1 && lastProduct) candidates = candidates.filter((c) => c !== lastProduct);

  const lastPosted = opts.lastPostedAt || {};
  candidates.sort((a, b) => {
    const la = lastPosted[a] ?? catalog[a]?.lastPostedAt ?? 0;
    const lb = lastPosted[b] ?? catalog[b]?.lastPostedAt ?? 0;
    return la - lb || a.localeCompare(b);
  });
  const product = candidates[0];
  const list = byProduct.get(product);
  let video;
  if ((settings.videoOrder || 'smart') === 'smart' && list.some((v) => variantOf(v.path))) {
    // últimos postados deste produto (do mais recente ao mais antigo), mais os simulados na prévia
    const posted = Object.values(videos)
      .filter((v) => (v.status === 'posted' || v.status === 'scheduled') && productKeyOf(state, v) === product && variantOf(v.path))
      .sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
    const recent = [...(opts.recentByProduct?.[product] || []), ...posted.map((v) => variantOf(v.path))];
    const usage = {};
    for (const r of recent) usage[r.g] = (usage[r.g] || 0) + 1;
    video = pickSpread(list, recent, usage);
  } else {
    video = sortVideos(list, settings.videoOrder === 'smart' ? 'name' : settings.videoOrder)[0];
  }
  return { product, video };
}

// Simula os próximos N posts (para mostrar a fila no painel).
export function previewQueue(state, n = 8) {
  const out = [];
  const exclude = [];
  let lastProduct = state.runtime?.lastProduct;
  const lastPostedAt = {};
  const recentByProduct = {};
  let t = Date.now();
  for (let i = 0; i < n; i++) {
    const pick = pickNext(state, { excludePaths: exclude, lastProduct, lastPostedAt, recentByProduct });
    if (!pick) break;
    out.push(pick);
    exclude.push(pick.video.path);
    lastProduct = pick.product;
    lastPostedAt[pick.product] = ++t;
    const x = variantOf(pick.video.path);
    if (x) recentByProduct[pick.product] = [x, ...(recentByProduct[pick.product] || [])];
  }
  return out;
}

export function prettifyFolderName(folder) {
  const s = String(folder).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Junta o resultado de uma varredura da pasta com o índice atual de vídeos e pastas.
export function mergeScan(state, files, now = Date.now()) {
  const videos = { ...(state.videos || {}) };
  const folders = { ...(state.folders || {}) };
  const seen = new Set();
  let added = 0;
  for (const f of files) {
    seen.add(f.path);
    if (!folders[f.product]) {
      folders[f.product] = { folder: f.product, displayName: prettifyFolderName(f.product), catalogKey: null, createdAt: now };
    }
    const prev = videos[f.path];
    if (!prev) {
      videos[f.path] = {
        path: f.path, folder: f.product, name: f.name, size: f.size,
        lastModified: f.lastModified, hasTxt: !!f.hasTxt, status: 'pending', addedAt: now,
      };
      added++;
    } else {
      videos[f.path] = {
        ...prev, size: f.size, lastModified: f.lastModified, hasTxt: !!f.hasTxt, gone: false,
        status: prev.status === 'missing' ? 'pending' : prev.status,
      };
    }
  }
  let missing = 0;
  for (const [path, v] of Object.entries(videos)) {
    const done = v.status === 'posted' || v.status === 'scheduled';
    if (!seen.has(path) && v.status !== 'missing' && !done) {
      videos[path] = { ...v, status: 'missing' };
      missing++;
    } else if (!seen.has(path) && done && !v.gone) {
      videos[path] = { ...v, gone: true };
    }
  }
  return { videos, folders, added, missing };
}
