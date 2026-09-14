const env = process.env;
const API = 'https://api.mercadolibre.com';
const keywords = (env.ML_KEYWORDS || env.KEYWORDS || 'celular,smart tv,notebook,ssd,memoria ram,monitor,fone bluetooth,roteador,power bank,ferramentas,casa,moda').split(',').map(s => s.trim()).filter(Boolean);
const MAX = Number(env.ML_MAX_OFFERS || 10);
const MIN_DISCOUNT = Number(env.ML_MIN_DISCOUNT || 0);
const ACCESS_TOKEN = env.ML_ACCESS_TOKEN || '';
const CATALOG_LIMIT = Number(env.ML_CATALOG_LIMIT || 5);
const ITEM_LIMIT = Number(env.ML_ITEM_LIMIT || 10);
const PROMOTION_CHECKS_PER_PRODUCT = Number(env.ML_PROMOTION_CHECKS_PER_PRODUCT || 2);

const PROMOTION_TYPES = new Set([
  'DEAL', 'MARKETPLACE_CAMPAIGN', 'DOD', 'LIGHTNING', 'VOLUME',
  'PRICE_DISCOUNT', 'PRE_NEGOTIATED', 'SELLER_CAMPAIGN', 'SMART',
  'PRICE_MATCHING', 'UNHEALTHY_STOCK', 'SELLER_COUPON_CAMPAIGN'
]);

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ --';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function readError(response) {
  const body = await response.text().catch(() => '');
  const suffix = body ? ` — ${body.slice(0, 180)}` : '';
  return `Mercado Livre HTTP ${response.status}${suffix}`;
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
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`
    }
  });

  if (!response.ok) {
    return { configured: true, valid: false, error: await readError(response) };
  }

  const data = await response.json();
  return { configured: true, valid: true, userId: data.id };
}

async function searchCatalog(keyword) {
  const query = encodeURIComponent(keyword);
  return mlGet(`/products/search?status=active&site_id=MLB&q=${query}&limit=${CATALOG_LIMIT}`);
}

async function getCatalogOffers(productId) {
  const encodedId = encodeURIComponent(productId);
  const result = await mlGet(`/products/${encodedId}/items?limit=${ITEM_LIMIT}`);
  return result.results || [];
}

async function getFullItem(itemId) {
  return mlGet(`/items/${encodeURIComponent(itemId)}`);
}

async function getItemPromotions(itemId) {
  try {
    const result = await mlGet(`/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`);
    if (!Array.isArray(result)) return [];

    return result
      .filter(promo => PROMOTION_TYPES.has(String(promo.type || '')))
      .filter(promo => ['active', 'started'].includes(String(promo.status || '').toLowerCase()))
      .map(promo => ({
        type: promo.type,
        status: promo.status,
        name: promo.name || '',
        promotionId: promo.id || promo.promotion_id || null,
        couponCode: promo.coupon_code || null,
        fixedPercentage: Number.isFinite(Number(promo.fixed_percentage)) ? Number(promo.fixed_percentage) : null,
        fixedAmount: Number.isFinite(Number(promo.fixed_amount)) ? Number(promo.fixed_amount) : null,
        minPurchaseAmount: Number.isFinite(Number(promo.min_purchase_amount)) ? Number(promo.min_purchase_amount) : null,
        maxPurchaseAmount: Number.isFinite(Number(promo.max_purchase_amount)) ? Number(promo.max_purchase_amount) : null,
        startDate: promo.start_date || null,
        finishDate: promo.finish_date || null,
        price: Number.isFinite(Number(promo.price)) ? Number(promo.price) : null,
        originalPrice: Number.isFinite(Number(promo.original_price)) ? Number(promo.original_price) : null
      }));
  } catch (error) {
    // Esse endpoint é orientado ao vendedor. Para um afiliado/usuário comum
    // pode retornar 403/404; isso não deve interromper a descoberta.
    return [];
  }
}

function reputationLevel(item) {
  const level = item.seller?.seller_reputation?.level_id || item.seller?.reputation_level_id || '';
  if (level) return level;

  const status = String(item.seller?.seller_reputation?.power_seller_status || '').toLowerCase();
  if (status) return '5_green';
  return '';
}

function extractPromotionSignals(candidate = {}, item = {}) {
  const values = [];
  for (const source of [candidate, item]) {
    for (const key of ['deal_ids', 'promotion_ids', 'promotion_id', 'promotion_type', 'promotion_types']) {
      const value = source?.[key];
      if (Array.isArray(value)) values.push(...value.map(String));
      else if (value) values.push(String(value));
    }
  }
  return [...new Set(values)];
}

function normalize(item, keyword, product = null, candidate = {}, promotions = []) {
  const price = Number(item.price || 0);
  const original = Number(item.original_price || 0);
  const discount = original > price && original > 0 ? Math.round((1 - price / original) * 100) : 0;
  const seller = item.seller?.nickname || '';
  const reputation = reputationLevel(item);
  const title = item.title || product?.name || product?.family_name || 'Produto Mercado Livre';

  const activePromotions = promotions.filter(Boolean);
  const coupon = activePromotions.find(promo => promo.type === 'SELLER_COUPON_CAMPAIGN');
  const promotionTypes = [...new Set(activePromotions.map(promo => promo.type).concat(extractPromotionSignals(candidate, item)))];

  return {
    id: item.id,
    catalogProductId: product?.id || null,
    keyword,
    title,
    price,
    originalPrice: original || null,
    discount,
    currency: item.currency_id,
    permalink: item.permalink,
    thumbnail: item.thumbnail,
    seller,
    sellerReputation: reputation,
    condition: item.condition || item.item_condition,
    availableQuantity: item.available_quantity,
    soldQuantity: item.sold_quantity ?? null,
    shipping: item.shipping?.free_shipping === true ? 'grátis' : 'pago/variável',
    acceptsMercadoPago: item.accepts_mercadopago,
    promotionTypes,
    promotions: activePromotions,
    hasPromotion: activePromotions.length > 0 || promotionTypes.length > 0,
    couponCode: coupon?.couponCode || null,
    couponPercentage: coupon?.fixedPercentage || null,
    couponAmount: coupon?.fixedAmount || null,
    couponMinPurchase: coupon?.minPurchaseAmount || null,
    couponMaxPurchase: coupon?.maxPurchaseAmount || null,
    affiliateLink: null,
    affiliateStatus: 'PENDENTE_GERACAO_NO_PORTAL'
  };
}

function score(item) {
  const discountPoints = Math.min(Math.max(item.discount, 0), 60);
  const reputationPoints = item.sellerReputation === '5_green' ? 15 : item.sellerReputation === '4_light_green' ? 10 : 5;
  const stockPoints = Number(item.availableQuantity || 0) > 0 ? 15 : 0;
  const shippingPoints = item.shipping === 'grátis' ? 10 : 0;
  const salesPoints = Number(item.soldQuantity || 0) > 0 ? 10 : 0;
  const promotionPoints = item.hasPromotion ? 20 : 0;
  const couponPoints = item.couponCode || item.couponPercentage || item.couponAmount ? 15 : 0;
  return Math.round(Math.min(100, discountPoints + reputationPoints + stockPoints + shippingPoints + salesPoints + promotionPoints + couponPoints));
}

function basicEligible(item) {
  return Boolean(
    item.permalink &&
    item.price > 0 &&
    (item.condition === 'new' || !item.condition) &&
    item.availableQuantity !== 0
  );
}

function eligible(item) {
  return basicEligible(item) && item.discount >= MIN_DISCOUNT;
}

export async function discoverMercadoLivre() {
  const all = [];
  const errors = [];
  const stats = {
    catalogProducts: 0,
    catalogPagesChecked: 0,
    competitorItems: 0,
    discountedItems: 0,
    promotionChecks: 0,
    promotedItems: 0,
    couponItems: 0,
    winners: 0,
    validProducts: 0,
    discountedProducts: 0
  };
  const token = await validateToken();

  if (!token.configured) {
    errors.push(token.error);
  } else if (!token.valid) {
    errors.push(`Token do Mercado Livre inválido ou sem autorização: ${token.error}`);
  }

  for (const keyword of keywords) {
    try {
      const result = await searchCatalog(keyword);
      const products = result.results || [];
      stats.catalogProducts += products.length;

      for (const product of products) {
        try {
          stats.catalogPagesChecked++;
          const candidates = await getCatalogOffers(product.id);
          stats.competitorItems += candidates.length;

          const uniqueCandidates = [...new Map(candidates
            .filter(candidate => candidate.item_id)
            .map(candidate => [candidate.item_id, candidate])).values()]
            .sort((a, b) => {
              const discountA = Number(a.original_price) > Number(a.price) ? (1 - Number(a.price) / Number(a.original_price)) : 0;
              const discountB = Number(b.original_price) > Number(b.price) ? (1 - Number(b.price) / Number(b.original_price)) : 0;
              return discountB - discountA || Number(a.price || Infinity) - Number(b.price || Infinity);
            });

          for (const candidate of uniqueCandidates.slice(0, 5)) {
            try {
              const fullItem = await getFullItem(candidate.item_id);
              let promotions = [];
              if (stats.promotionChecks < Number.POSITIVE_INFINITY) {
                // Consulta promoções para uma pequena amostra por página para manter
                // a execução rápida. O endpoint é best-effort.
                const checkedForProduct = [...all].filter(item => item.catalogProductId === product.id).length;
                if (checkedForProduct < PROMOTION_CHECKS_PER_PRODUCT) {
                  stats.promotionChecks++;
                  promotions = await getItemPromotions(candidate.item_id);
                }
              }

              const item = normalize(fullItem, keyword, product, candidate, promotions);
              if (!basicEligible(item)) continue;

              stats.validProducts++;
              if (item.discount > 0) stats.discountedItems++;
              if (item.discount >= MIN_DISCOUNT && item.discount > 0) stats.discountedProducts++;
              if (item.hasPromotion) stats.promotedItems++;
              if (item.couponCode || item.couponPercentage || item.couponAmount) stats.couponItems++;

              all.push({ ...item, score: score(item) });

              // Uma oportunidade realmente promocional já representa bem esta página.
              if (item.hasPromotion || item.discount > 0) {
                stats.winners++;
                break;
              }
            } catch (error) {
              console.error(`Falha no anúncio ${candidate.item_id} (${keyword}): ${error.message}`);
            }
          }
        } catch (error) {
          console.error(`Falha na página de produto ${product.id} (${keyword}): ${error.message}`);
        }
      }
    } catch (error) {
      const message = `Falha no Mercado Livre (${keyword}): ${error.message}`;
      errors.push(message);
      console.error(message);
    }
  }

  const unique = [...new Map(all.map(item => [item.id, item])).values()]
    .sort((a, b) => b.score - a.score || b.discount - a.discount)
    .slice(0, MAX);

  return {
    offers: unique,
    errors,
    authenticated: token.valid,
    tokenConfigured: token.configured,
    tokenUserId: token.userId || null,
    stats,
    fallbackUsed: false,
    minDiscount: MIN_DISCOUNT
  };
}

function promotionText(item) {
  const lines = [];
  if (item.couponPercentage) lines.push(`🎟️ Cupom: ${item.couponPercentage}% OFF${item.couponMinPurchase ? ` acima de ${money(item.couponMinPurchase)}` : ''}`);
  else if (item.couponAmount) lines.push(`🎟️ Cupom: ${money(item.couponAmount)} OFF${item.couponMinPurchase ? ` acima de ${money(item.couponMinPurchase)}` : ''}`);
  if (item.couponCode) lines.push(`🏷️ Código: ${item.couponCode}`);

  const knownTypes = item.promotions?.map(p => p.type).filter(Boolean) || [];
  const uniqueTypes = [...new Set(knownTypes)];
  if (uniqueTypes.includes('LIGHTNING')) lines.push('⚡ Oferta relâmpago');
  else if (uniqueTypes.includes('DOD')) lines.push('🔥 Oferta do dia');
  else if (uniqueTypes.includes('DEAL')) lines.push('🔥 Oferta Mercado Livre');
  else if (uniqueTypes.includes('VOLUME')) lines.push('📦 Desconto por quantidade');

  return lines.join('\n');
}

export function formatMercadoLivre(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = item.discount ? ` | ${item.discount}% OFF` : '';
  const promotion = promotionText(item);
  const promotionBlock = promotion ? `\n\n${promotion}` : '';
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}${promotionBlock}\n🚚 Frete: ${item.shipping}\n🏪 Vendedor: ${item.seller || 'Mercado Livre'}\n\n🛒 LINK DO PRODUTO:\n${item.permalink}\n\n⚠️ O link acima ainda precisa ser convertido no Gerador de Links do Portal de Afiliados do Mercado Livre antes da divulgação.`;
}
