// Produtos lidos da vitrine de afiliado do TikTok Studio → catálogo da extensão.
import { guessNiche, shortProductName } from './captions.js';

// Junta os produtos lidos da vitrine com o catálogo (sem apagar o que você já configurou).
export function mergeShowcase(catalog, items, now = Date.now()) {
  let added = 0;
  let updated = 0;
  for (const it of items || []) {
    if (!it.id) continue;
    const existing = Object.values(catalog).find((c) => String(c.productId || '') === it.id);
    const showcase = { name: it.name, price: it.price, stock: it.stock, status: it.status, syncedAt: now };
    const unavailable = it.status === 'indisponivel';
    if (existing) {
      catalog[existing.key] = {
        ...existing, showcase, unavailable,
        productQuery: existing.productQuery || it.name.slice(0, 60),
        configured: true,
      };
      updated++;
    } else {
      const key = 'id_' + it.id;
      const displayName = shortProductName(it.name);
      catalog[key] = {
        key, displayName, productId: it.id, productUrl: '', productQuery: it.name.slice(0, 60), productLabel: '', // vazio = nome sugerido pelo TikTok
        niche: guessNiche(it.name), benefits: '', hashtags: '', captions: '', enabled: true, configured: true,
        fromShowcase: true, showcase, unavailable, createdAt: now,
      };
      added++;
    }
  }
  return { added, updated };
}
