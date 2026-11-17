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

export function countPostedToday(history, now = Date.now()) {
  const start = startOfDay(now);
  return history.filter((h) => h.status === 'posted' && h.ts >= start).length;
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

// Um produto só pode ser postado com link se a busca do produto foi configurada pelo usuário.
// Identifica a configuração do link (para saber se o teste ainda vale depois de uma edição).
export function linkKey(product) {
  return `${String(product?.productId || '').trim()}|${String(product?.productQuery || '').trim()}`;
}

export function isLinkReady(product) {
  return !!(product && product.configured && (String(product.productId || '').trim() || String(product.productQuery || '').trim()));
}

export function productBlocked(product, settings) {
  if (!product || product.enabled === false) return true;
  return settings?.linkProduct !== false && !isLinkReady(product);
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Retorna { product, video } do próximo post, ou null se não há nada a postar.
// Regras: só produtos ativos com vídeos pendentes; evita repetir o último produto;
// entre os candidatos, escolhe o que está há mais tempo sem postar (rodízio).
export function pickNext(state, opts = {}) {
  const { products = {}, videos = {}, runtime = {}, settings = {} } = state;
  const exclude = new Set(opts.excludePaths || []);
  const byProduct = new Map();
  for (const v of Object.values(videos)) {
    if (v.status !== 'pending' || exclude.has(v.path)) continue;
    if (productBlocked(products[v.product], settings)) continue;
    if (!byProduct.has(v.product)) byProduct.set(v.product, []);
    byProduct.get(v.product).push(v);
  }
  if (byProduct.size === 0) return null;

  const lastProduct = opts.lastProduct ?? runtime.lastProduct;
  let candidates = [...byProduct.keys()];
  if (candidates.length > 1 && lastProduct) candidates = candidates.filter((c) => c !== lastProduct);

  const lastPosted = opts.lastPostedAt || {};
  candidates.sort((a, b) => {
    const la = lastPosted[a] ?? products[a]?.lastPostedAt ?? 0;
    const lb = lastPosted[b] ?? products[b]?.lastPostedAt ?? 0;
    return la - lb || a.localeCompare(b);
  });
  const product = candidates[0];
  const video = sortVideos(byProduct.get(product), settings.videoOrder)[0];
  return { product, video };
}

// Simula os próximos N posts (para mostrar a fila no painel).
export function previewQueue(state, n = 8) {
  const out = [];
  const exclude = [];
  let lastProduct = state.runtime?.lastProduct;
  const lastPostedAt = {};
  let t = Date.now();
  for (let i = 0; i < n; i++) {
    const pick = pickNext(state, { excludePaths: exclude, lastProduct, lastPostedAt });
    if (!pick) break;
    out.push(pick);
    exclude.push(pick.video.path);
    lastProduct = pick.product;
    lastPostedAt[pick.product] = ++t;
  }
  return out;
}

export function prettifyFolderName(folder) {
  const s = String(folder).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Junta o resultado de uma varredura da pasta com o índice atual de vídeos e produtos.
export function mergeScan(state, files, now = Date.now()) {
  const videos = { ...(state.videos || {}) };
  const products = { ...(state.products || {}) };
  const seen = new Set();
  let added = 0;
  for (const f of files) {
    seen.add(f.path);
    if (!products[f.product]) {
      const displayName = prettifyFolderName(f.product);
      products[f.product] = {
        folder: f.product,
        displayName,
        productUrl: '',
        productId: '',
        productQuery: '',
        productLabel: displayName.slice(0, 30),
        niche: 'geral',
        benefits: '',
        captions: '',
        hashtags: '',
        configured: false,
        enabled: true,
        createdAt: now,
      };
    }
    const prev = videos[f.path];
    if (!prev) {
      videos[f.path] = {
        path: f.path, product: f.product, name: f.name, size: f.size,
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
    if (!seen.has(path) && v.status !== 'missing' && v.status !== 'posted') {
      videos[path] = { ...v, status: 'missing' };
      missing++;
    } else if (!seen.has(path) && v.status === 'posted' && !v.gone) {
      videos[path] = { ...v, gone: true };
    }
  }
  return { videos, products, added, missing };
}
