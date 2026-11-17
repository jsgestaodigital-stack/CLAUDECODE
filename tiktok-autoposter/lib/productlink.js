// Extrai o ID do produto a partir do que o usuário colar: ID puro, link completo do produto
// ou link curto de compartilhamento (vt.tiktok.com / vm.tiktok.com), que é seguido até o destino.

const ID_PATTERNS = [
  /\/product\/(\d{6,25})(?:[/?#]|$)/i,               // tiktok.com/view/product/123..., shop.tiktok.com/view/product/123...
  /\/pdp\/(?:[^/?#]+\/)?(\d{6,25})(?:[/?#]|$)/i,      // shop.tiktok.com/.../pdp/nome-do-produto/123...
  /[?&#](?:product_?id|productId|pid|item_?id|goods_id)=(\d{6,25})/i,
  /\/item\/(\d{6,25})(?:[/?#]|$)/i,
];

const HTML_PATTERNS = [
  /"product_?id"\s*:\s*"?(\d{6,25})/i,
  /"productId"\s*:\s*"?(\d{6,25})/i,
  /\/product\/(\d{6,25})/i,
];

export function extractProductId(text) {
  const s = String(text || '').trim();
  if (/^\d{6,25}$/.test(s)) return s;
  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch (_) { /* mantém */ }
  for (const p of ID_PATTERNS) {
    const m = decoded.match(p);
    if (m) return m[1];
  }
  return null;
}

export function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

export function isShortLink(url) {
  return /^https?:\/\/(vt|vm)\.tiktok\.com\//i.test(url || '') || /^https?:\/\/(www\.)?tiktok\.com\/t\//i.test(url || '');
}

export function isTikTokUrl(url) {
  return /^https?:\/\/([a-z0-9-]+\.)*tiktok\.com\//i.test(url || '');
}

// Retorna { id, url, via } ou { id: null, error }.
// `fetchImpl` permite testar sem rede.
export async function resolveProductLink(input, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null)) {
  const raw = String(input || '').trim();
  if (!raw) return { id: null, error: 'Cole o link do produto.' };
  const direct = extractProductId(raw);
  if (direct) return { id: direct, url: firstUrl(raw), via: /^\d+$/.test(raw) ? 'id' : 'link' };

  const url = firstUrl(raw);
  if (!url) return { id: null, error: 'Isso não parece um link nem um ID de produto.' };
  if (!isTikTokUrl(url)) return { id: null, error: 'O link precisa ser do TikTok / TikTok Shop.' };
  if (!fetchImpl) return { id: null, error: 'Não foi possível abrir o link aqui. Cole o ID do produto.' };

  try {
    const res = await fetchImpl(url, { redirect: 'follow', credentials: 'omit' });
    const finalId = extractProductId(res.url);
    if (finalId) return { id: finalId, url: res.url, via: 'redirect' };
    const html = (await res.text()).slice(0, 2_000_000);
    for (const p of HTML_PATTERNS) {
      const m = html.match(p);
      if (m) return { id: m[1], url: res.url, via: 'page' };
    }
    return { id: null, error: 'Abri o link, mas não achei o ID do produto nele. Abra o produto no navegador e copie o link completo (com /product/ no endereço).' };
  } catch (e) {
    return { id: null, error: 'Não consegui abrir o link (' + (e.message || e) + '). Cole o link completo do produto.' };
  }
}
