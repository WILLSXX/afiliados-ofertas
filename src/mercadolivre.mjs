const env = process.env;
const API = 'https://api.mercadolibre.com';
const SITE_ID = 'MLB';
const keywords = (env.ML_KEYWORDS || env.KEYWORDS || 'celular,smart tv,notebook,ssd,memoria ram,monitor,fone bluetooth,roteador,power bank,ferramentas,casa,moda')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX = Number(env.ML_MAX_OFFERS || 10);
const MIN_DISCOUNT = Number(env.ML_MIN_DISCOUNT || 0);
const ACCESS_TOKEN = env.ML_ACCESS_TOKEN || '';
const CATALOG_LIMIT = Number(env.ML_CATALOG_LIMIT || 5);
const HIGHLIGHT_LIMIT = Number(env.ML_HIGHLIGHT_LIMIT || 20);
const MAX_CATEGORIES_PER_KEYWORD = Number(env.ML_MAX_CATEGORIES_PER_KEYWORD || 2);
const PROMOTION_CHECKS = Number(env.ML_PROMOTION_CHECKS || 8);

const PROMOTION_TYPES = new Set([
  'DEAL', 'MARKETPLACE_CAMPAIGN', 'DOD', 'LIGHTNING', 'VOLUME',
  'PRICE_DISCOUNT', 'PRE_NEGOTIATED', 'SELLER_CAMPAIGN', 'SMART',
  'PRICE_MATCHING', 'UNHEALTHY_STOCK', 'SELLER_COUPON_CAMPAIGN'
]);

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
  const response = await fetch(`${API}/users/me`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` }
  });
  if (!response.ok) return { configured: true, valid: false, error: await readError(response) };
  const data = await response.json();
  return { configured: true, valid: true, userId: data.id };
}

async function searchCatalog(keyword) {
  return mlGet(`/products/search?status=active&site_id=${SITE_ID}&q=${encodeURIComponent(keyword)}&limit=${CATALOG_LIMIT}`);
}

async function predictCategories(keyword) {
  return mlGet(`/sites/${SITE_ID}/domain_discovery/search?limit=3&q=${encodeURIComponent(keyword)}`);
}

async function getHighlights(categoryId) {
  return mlGet(`/highlights/${SITE_ID}/category/${encodeURIComponent(categoryId)}`);
}

async function getProduct(productId) {
  return mlGet(`/products/${encodeURIComponent(productId)}`);
}

async function getProductItems(productId) {
  try {
    const result = await mlGet(`/products/${encodeURIComponent(productId)}/items?limit=100`);
    return result.results || [];
  } catch {
    return [];
  }
}

async function getFullItem(itemId) {
  return mlGet(`/items/${encodeURIComponent(itemId)}`);
}

async function getPromotions(itemId) {
  try {
    const result = await mlGet(`/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`);
    if (!Array.isArray(result)) return [];
    return result
      .filter(p => PROMOTION_TYPES.has(String(p.type || '')))
      .filter(p => ['active', 'started', 'candidate'].includes(String(p.status || '').toLowerCase()))
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

function reputation(item) {
  return item.seller?.seller_reputation?.level_id || item.seller?.reputation_level_id || '';
}

function normalize(item, keyword, source, rank = null, promotions = []) {
  const price = Number(item.price || 0);
  const original = Number(item.original_price || 0);
  const discount = original > price ? Math.round((1 - price / original) * 100) : 0;
  const promoTypes = [...new Set(promotions.map(p => p.type).filter(Boolean))];
  const coupon = promotions.find(p => p.type === 'SELLER_COUPON_CAMPAIGN');
  return {
    id: item.id,
    keyword,
    source,
    rank,
    title: item.title || 'Produto Mercado Livre',
    price,
    originalPrice: original || null,
    discount,
    currency: item.currency_id,
    permalink: item.permalink || null,
    thumbnail: item.thumbnail || null,
    seller: item.seller?.nickname || '',
    sellerReputation: reputation(item),
    condition: item.condition || null,
    availableQuantity: item.available_quantity ?? null,
    soldQuantity: item.sold_quantity ?? null,
    shipping: item.shipping?.free_shipping === true ? 'grátis' : 'pago/variável',
    promotions,
    promotionTypes: promoTypes,
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
  const discountPoints = Math.min(item.discount, 60);
  const reputationPoints = item.sellerReputation === '5_green' || item.sellerReputation === 'GREEN' ? 15 : item.sellerReputation === '4_light_green' ? 10 : 5;
  const stockPoints = item.availableQuantity > 0 ? 15 : 0;
  const shippingPoints = item.shipping === 'grátis' ? 10 : 0;
  const salesPoints = item.soldQuantity > 0 ? 10 : 0;
  const promotionPoints = item.hasPromotion ? 20 : 0;
  const couponPoints = item.couponCode || item.couponPercentage || item.couponAmount ? 15 : 0;
  const rankPoints = Number.isFinite(Number(item.rank)) ? Math.max(0, 20 - Number(item.rank)) : 0;
  return Math.min(100, Math.round(discountPoints + reputationPoints + stockPoints + shippingPoints + salesPoints + promotionPoints + couponPoints + rankPoints));
}

export async function discoverMercadoLivre() {
  const errors = [];
  const offers = [];
  const stats = {
    catalogProducts: 0,
    categories: 0,
    highlightEntries: 0,
    itemCandidates: 0,
    productCandidates: 0,
    userProductCandidates: 0,
    catalogItemCandidates: 0,
    validProducts: 0,
    discountedProducts: 0,
    promotedItems: 0,
    couponItems: 0,
    winners: 0
  };

  const token = await validateToken();
  if (!token.valid) {
    if (token.error) errors.push(`Token do Mercado Livre inválido ou ausente: ${token.error}`);
    return { offers: [], errors, authenticated: false, tokenConfigured: token.configured, tokenUserId: null, stats, fallbackUsed: false, minDiscount: MIN_DISCOUNT };
  }

  const seenItems = new Set();
  const seenCategories = new Set();
  let promotionChecks = 0;

  for (const keyword of keywords) {
    try {
      const [catalog, predicted] = await Promise.all([
        searchCatalog(keyword),
        predictCategories(keyword).catch(() => [])
      ]);
      const products = catalog.results || [];
      stats.catalogProducts += products.length;

      const categories = [];
      for (const p of predicted || []) if (p.category_id) categories.push(p.category_id);
      for (const p of products) if (p.category_id) categories.push(p.category_id);

      for (const categoryId of [...new Set(categories)].slice(0, MAX_CATEGORIES_PER_KEYWORD)) {
        if (seenCategories.has(categoryId)) continue;
        seenCategories.add(categoryId);
        stats.categories++;

        let highlight;
        try {
          highlight = await getHighlights(categoryId);
        } catch (error) {
          errors.push(`Falha no ranking ${categoryId}: ${error.message}`);
          continue;
        }

        const entries = Array.isArray(highlight.content) ? highlight.content.slice(0, HIGHLIGHT_LIMIT) : [];
        stats.highlightEntries += entries.length;

        for (const entry of entries) {
          try {
            if (!entry?.id) continue;

            if (entry.type === 'USER_PRODUCT') {
              stats.userProductCandidates++;
              continue;
            }

            if (entry.type === 'ITEM') {
              stats.itemCandidates++;
              if (seenItems.has(entry.id)) continue;
              const item = await getFullItem(entry.id);
              seenItems.add(entry.id);
              let promotions = [];
              if (promotionChecks < PROMOTION_CHECKS) {
                promotionChecks++;
                promotions = await getPromotions(entry.id);
              }
              const normalized = normalize(item, keyword, 'highlight_item', entry.position, promotions);
              if (!valid(normalized)) continue;
              normalized.score = score(normalized);
              stats.validProducts++;
              if (normalized.discount > 0) stats.discountedProducts++;
              if (normalized.hasPromotion) stats.promotedItems++;
              if (normalized.couponCode || normalized.couponPercentage || normalized.couponAmount) stats.couponItems++;
              if (normalized.discount >= MIN_DISCOUNT || normalized.hasPromotion) stats.winners++;
              offers.push(normalized);
              continue;
            }

            if (entry.type === 'PRODUCT') {
              stats.productCandidates++;
              const product = await getProduct(entry.id);
              let candidates = await getProductItems(entry.id);
              if (!candidates.length && product.buy_box_winner?.item_id) candidates = [{ item_id: product.buy_box_winner.item_id, ...product.buy_box_winner }];

              for (const candidate of candidates.slice(0, 5)) {
                if (!candidate.item_id || seenItems.has(candidate.item_id)) continue;
                const item = await getFullItem(candidate.item_id).catch(() => null);
                if (!item) continue;
                seenItems.add(candidate.item_id);
                let promotions = [];
                if (promotionChecks < PROMOTION_CHECKS) {
                  promotionChecks++;
                  promotions = await getPromotions(candidate.item_id);
                }
                const normalized = normalize(item, keyword, 'highlight_product', entry.position, promotions);
                if (!valid(normalized)) continue;
                normalized.score = score(normalized);
                stats.validProducts++;
                if (normalized.discount > 0) stats.discountedProducts++;
                if (normalized.hasPromotion) stats.promotedItems++;
                if (normalized.couponCode || normalized.couponPercentage || normalized.couponAmount) stats.couponItems++;
                if (normalized.discount >= MIN_DISCOUNT || normalized.hasPromotion) stats.winners++;
                offers.push(normalized);
                break;
              }
            }
          } catch (error) {
            console.error(`Falha processando ${entry.id}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      errors.push(`Falha no Mercado Livre (${keyword}): ${error.message}`);
    }
  }

  // Complemento pelo catálogo oficial.
  for (const keyword of keywords) {
    try {
      const catalog = await searchCatalog(keyword);
      for (const product of (catalog.results || []).slice(0, CATALOG_LIMIT)) {
        const candidates = await getProductItems(product.id);
        stats.catalogItemCandidates += candidates.length;
        for (const candidate of candidates.slice(0, 3)) {
          if (!candidate.item_id || seenItems.has(candidate.item_id)) continue;
          const item = await getFullItem(candidate.item_id).catch(() => null);
          if (!item) continue;
          seenItems.add(candidate.item_id);
          const normalized = normalize(item, keyword, 'catalog_item', null, []);
          if (!valid(normalized)) continue;
          normalized.score = score(normalized);
          stats.validProducts++;
          if (normalized.discount > 0) stats.discountedProducts++;
          offers.push(normalized);
        }
      }
    } catch {
      // Complementar; não interromper a descoberta principal.
    }
  }

  const unique = [...new Map(offers.map(item => [item.id, item])).values()]
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
  else if (types.has('SELLER_CAMPAIGN')) lines.push('🏷️ Campanha do vendedor');
  return lines.join('\n');
}

export function formatMercadoLivre(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = item.discount ? ` | ${item.discount}% OFF` : '';
  const promotion = promotionText(item);
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}${promotion ? `\n\n${promotion}` : ''}\n🚚 Frete: ${item.shipping}\n🏪 Vendedor: ${item.seller || 'Mercado Livre'}\n\n🛒 LINK DO PRODUTO:\n${item.permalink}\n\n⚠️ Converta este link no Gerador de Links oficial do Portal de Afiliados antes de divulgar.`;
}
