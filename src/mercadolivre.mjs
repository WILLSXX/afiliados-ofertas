const env = process.env;
const API = 'https://api.mercadolibre.com';
const SITE_ID = 'MLB';
const keywords = (env.ML_KEYWORDS || env.KEYWORDS || 'celular,smart tv,notebook,ssd,memoria ram,monitor,fone bluetooth,roteador,power bank,ferramentas,casa,moda')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX = Number(env.ML_MAX_OFFERS || 10);
const MIN_DISCOUNT = Number(env.ML_MIN_DISCOUNT || 0);
const ACCESS_TOKEN = env.ML_ACCESS_TOKEN || '';
const SEARCH_LIMIT = Number(env.ML_SEARCH_LIMIT || 40);
const DETAIL_CHECKS = Number(env.ML_DETAIL_CHECKS || 12);
const CATALOG_LIMIT = Number(env.ML_CATALOG_LIMIT || 5);
const PROMOTION_TYPES = new Set(['DEAL','MARKETPLACE_CAMPAIGN','DOD','LIGHTNING','VOLUME','PRICE_DISCOUNT','PRE_NEGOTIATED','SELLER_CAMPAIGN','SMART','PRICE_MATCHING','UNHEALTHY_STOCK','SELLER_COUPON_CAMPAIGN']);

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ --';
}
async function readError(response) {
  const body = await response.text().catch(() => '');
  return `Mercado Livre HTTP ${response.status}${body ? ` — ${body.slice(0, 180)}` : ''}`;
}
async function mlGet(path) {
  const headers = { Accept: 'application/json' };
  if (ACCESS_TOKEN) headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
  const response = await fetch(`${API}${path}`, { headers });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
async function validateToken() {
  if (!ACCESS_TOKEN) return { configured: false, valid: false, error: 'ML_ACCESS_TOKEN não configurado.' };
  const response = await fetch(`${API}/users/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` } });
  if (!response.ok) return { configured: true, valid: false, error: await readError(response) };
  const data = await response.json();
  return { configured: true, valid: true, userId: data.id };
}
async function searchItems(keyword) {
  return mlGet(`/sites/${SITE_ID}/search?q=${encodeURIComponent(keyword)}&limit=${SEARCH_LIMIT}`);
}
async function getFullItem(itemId) {
  return mlGet(`/items/${encodeURIComponent(itemId)}`);
}
async function searchCatalog(keyword) {
  return mlGet(`/products/search?status=active&site_id=${SITE_ID}&q=${encodeURIComponent(keyword)}&limit=${CATALOG_LIMIT}`);
}
async function getCatalogItems(productId) {
  try {
    const result = await mlGet(`/products/${encodeURIComponent(productId)}/items?limit=100`);
    return result.results || [];
  } catch {
    return [];
  }
}
async function getPromotions(itemId) {
  try {
    const result = await mlGet(`/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`);
    if (!Array.isArray(result)) return [];
    return result
      .filter(p => PROMOTION_TYPES.has(String(p.type || '')))
      .filter(p => ['active','started','candidate'].includes(String(p.status || '').toLowerCase()))
      .map(p => ({
        type: p.type,
        status: p.status,
        name: p.name || '',
        couponCode: p.coupon_code || null,
        fixedPercentage: Number.isFinite(Number(p.fixed_percentage)) ? Number(p.fixed_percentage) : null,
        fixedAmount: Number.isFinite(Number(p.fixed_amount)) ? Number(p.fixed_amount) : null,
        minPurchaseAmount: Number.isFinite(Number(p.min_purchase_amount)) ? Number(p.min_purchase_amount) : null,
        maxPurchaseAmount: Number.isFinite(Number(p.max_purchase_amount)) ? Number(p.max_purchase_amount) : null
      }));
  } catch {
    return [];
  }
}
function signals(item) {
  const values = [];
  for (const key of ['deal_ids','promotion_ids','promotion_id','promotion_type','promotion_types','tags']) {
    const value = item?.[key];
    if (Array.isArray(value)) values.push(...value.map(String));
    else if (value) values.push(String(value));
  }
  return [...new Set(values)];
}
function reputation(item) {
  return item.seller?.seller_reputation?.level_id || item.seller?.reputation_level_id || '';
}
function normalize(item, keyword, source, rank = null, promotions = []) {
  const price = Number(item.price || 0);
  const original = Number(item.original_price || item.base_price || 0);
  const discount = original > price && original > 0 ? Math.round((1 - price / original) * 100) : 0;
  const promoTypes = [...new Set([...promotions.map(p => p.type), ...signals(item)])].filter(Boolean);
  const coupon = promotions.find(p => p.type === 'SELLER_COUPON_CAMPAIGN');
  return {
    id: item.id, keyword, source, rank,
    title: item.title || 'Produto Mercado Livre', price,
    originalPrice: original || null, discount,
    currency: item.currency_id, permalink: item.permalink || null,
    thumbnail: item.thumbnail || null,
    seller: item.seller?.nickname || '', sellerReputation: reputation(item),
    condition: item.condition || null,
    availableQuantity: item.available_quantity ?? null,
    soldQuantity: item.sold_quantity ?? null,
    shipping: item.shipping?.free_shipping === true ? 'grátis' : 'pago/variável',
    promotions, promotionTypes: promoTypes,
    hasPromotion: promotions.length > 0 || promoTypes.length > 0,
    couponCode: coupon?.couponCode || null,
    couponPercentage: coupon?.fixedPercentage || null,
    couponAmount: coupon?.fixedAmount || null,
    affiliateLink: null,
    affiliateStatus: 'PENDENTE_GERACAO_NO_PORTAL'
  };
}
function valid(item) {
  return Boolean(item.permalink && item.price > 0 && (item.condition === 'new' || !item.condition) && item.availableQuantity !== 0);
}
function score(item) {
  const discount = Math.min(Math.max(item.discount, 0), 60);
  const promo = item.hasPromotion ? 20 : 0;
  const coupon = item.couponCode || item.couponPercentage || item.couponAmount ? 15 : 0;
  const stock = item.availableQuantity > 0 ? 10 : 0;
  const shipping = item.shipping === 'grátis' ? 10 : 0;
  const sales = item.soldQuantity > 0 ? 5 : 0;
  const rank = Number.isFinite(Number(item.rank)) ? Math.max(0, 15 - Number(item.rank)) : 0;
  return Math.min(100, Math.round(discount + promo + coupon + stock + shipping + sales + rank));
}
export async function discoverMercadoLivre() {
  const errors = [];
  const collected = [];
  const stats = {
    searchRequests: 0, searchItems: 0, searchValid: 0, detailChecks: 0,
    catalogProducts: 0, catalogItems: 0, validProducts: 0,
    discountedProducts: 0, promotedItems: 0, couponItems: 0
  };
  const token = await validateToken();
  if (!token.valid) {
    if (token.error) errors.push(`Token do Mercado Livre inválido ou ausente: ${token.error}`);
    return { offers: [], errors, authenticated: false, tokenConfigured: token.configured, tokenUserId: null, stats, fallbackUsed: false, minDiscount: MIN_DISCOUNT };
  }
  const seen = new Set();
  for (const keyword of keywords) {
    try {
      stats.searchRequests++;
      const result = await searchItems(keyword);
      const items = result.results || [];
      stats.searchItems += items.length;
      for (const [index, raw] of items.entries()) {
        if (!raw?.id || seen.has(raw.id) || !raw.price) continue;
        seen.add(raw.id);
        let item = raw;
        if (stats.detailChecks < DETAIL_CHECKS) {
          stats.detailChecks++;
          item = await getFullItem(raw.id).catch(() => raw);
        }
        const promotions = collected.length < DETAIL_CHECKS ? await getPromotions(item.id) : [];
        const normalized = normalize(item, keyword, 'direct_search', index + 1, promotions);
        if (!valid(normalized)) continue;
        stats.searchValid++;
        stats.validProducts++;
        if (normalized.discount > 0) stats.discountedProducts++;
        if (normalized.hasPromotion) stats.promotedItems++;
        if (normalized.couponCode || normalized.couponPercentage || normalized.couponAmount) stats.couponItems++;
        collected.push({ ...normalized, score: score(normalized) });
      }
    } catch (error) {
      errors.push(`Busca direta (${keyword}): ${error.message}`);
    }
  }
  if (collected.length < MAX) {
    for (const keyword of keywords) {
      try {
        const catalog = await searchCatalog(keyword);
        const products = catalog.results || [];
        stats.catalogProducts += products.length;
        for (const product of products) {
          const candidates = await getCatalogItems(product.id);
          stats.catalogItems += candidates.length;
          for (const candidate of candidates.slice(0, 5)) {
            const itemId = candidate?.item_id;
            if (!itemId || seen.has(itemId)) continue;
            seen.add(itemId);
            const item = await getFullItem(itemId).catch(() => null);
            if (!item) continue;
            const normalized = normalize(item, keyword, 'catalog_item', null, []);
            if (!valid(normalized)) continue;
            stats.validProducts++;
            if (normalized.discount > 0) stats.discountedProducts++;
            collected.push({ ...normalized, score: score(normalized) });
            if (collected.length >= MAX * 4) break;
          }
          if (collected.length >= MAX * 4) break;
        }
        if (collected.length >= MAX * 4) break;
      } catch (error) {
        errors.push(`Catálogo (${keyword}): ${error.message}`);
      }
    }
  }
  const unique = [...new Map(collected.map(item => [item.id, item])).values()]
    .filter(valid)
    .sort((a, b) => b.score - a.score || b.discount - a.discount)
    .slice(0, MAX);
  return { offers: unique, errors, authenticated: true, tokenConfigured: true, tokenUserId: token.userId || null, stats, fallbackUsed: false, minDiscount: MIN_DISCOUNT };
}
function promotionText(item) {
  const lines = [];
  if (item.couponPercentage) lines.push(`🎟️ Cupom: ${item.couponPercentage}% OFF`);
  else if (item.couponAmount) lines.push(`🎟️ Cupom: ${money(item.couponAmount)} OFF`);
  if (item.couponCode) lines.push(`🏷️ Código: ${item.couponCode}`);
  const types = new Set(item.promotionTypes || []);
  if (types.has('LIGHTNING')) lines.push('⚡ Oferta relâmpago');
  else if (types.has('DOD')) lines.push('🔥 Oferta do dia');
  else if (types.has('DEAL')) lines.push('🔥 Oferta Mercado Livre');
  else if (types.has('VOLUME')) lines.push('📦 Desconto por quantidade');
  return lines.join('\n');
}
export function formatMercadoLivre(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = item.discount ? ` | ${item.discount}% OFF` : '';
  const promotion = promotionText(item);
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}${promotion ? `\n\n${promotion}` : ''}\n🚚 Frete: ${item.shipping}\n🏪 Vendedor: ${item.seller || 'Mercado Livre'}\n\n🛒 LINK DO PRODUTO:\n${item.permalink}\n\n⚠️ Converta este link no Gerador de Links oficial do Portal de Afiliados antes de divulgar.`;
}
