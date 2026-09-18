const env = process.env;
const API = 'https://api.mercadolibre.com';
const SITE_ID = 'MLB';
const keywords = (env.ML_KEYWORDS || env.KEYWORDS || 'celular,smart tv,notebook,ssd,memoria ram,monitor,fone bluetooth,roteador,power bank,ferramentas,impressora,tablet,smartwatch,mouse gamer,teclado mecanico,placa de video,headset gamer,air fryer,cafeteira,aspirador')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX = Number(env.ML_MAX_OFFERS || 10);
const MIN_DISCOUNT = Number(env.ML_MIN_DISCOUNT || 1);
const MIN_PRICE = Number(env.ML_MIN_PRICE || 0);
const MAX_PER_SELLER = Number(env.ML_MAX_PER_SELLER || 2);
const ACCESS_TOKEN = env.ML_ACCESS_TOKEN || '';
const CATALOG_LIMIT = Number(env.ML_CATALOG_LIMIT || 5);
const ITEMS_PER_PRODUCT = Number(env.ML_ITEM_LIMIT || env.ML_ITEMS_PER_PRODUCT || 20);
const DETAIL_CHECKS = Number(env.ML_DETAIL_CHECKS || 12);
const PROMOTION_TYPES = new Set(['DEAL','MARKETPLACE_CAMPAIGN','DOD','LIGHTNING','VOLUME','PRICE_DISCOUNT','PRE_NEGOTIATED','SELLER_CAMPAIGN','SMART','PRICE_MATCHING','UNHEALTHY_STOCK','SELLER_COUPON_CAMPAIGN']);

const blockedNonProductPatterns = [
  /\b(servi[cç]o|curso|aula|ebook|e-book|assinatura|software|licen[cç]a digital|arquivo digital)\b/i,
  /\b(somente frete|consultoria)\b/i
];

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
async function searchCatalog(keyword) {
  return mlGet(`/products/search?status=active&site_id=${SITE_ID}&q=${encodeURIComponent(keyword)}&limit=${CATALOG_LIMIT}`);
}
async function getCatalogProduct(productId) {
  try { return await mlGet(`/products/${encodeURIComponent(productId)}`); } catch { return null; }
}
async function getCatalogItems(productId) {
  const result = await mlGet(`/products/${encodeURIComponent(productId)}/items?limit=${ITEMS_PER_PRODUCT}`);
  return Array.isArray(result.results) ? result.results : [];
}
async function getFullItem(itemId) { return mlGet(`/items/${encodeURIComponent(itemId)}`); }
async function getPromotions(itemId) {
  try {
    const result = await mlGet(`/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`);
    if (!Array.isArray(result)) return [];
    return result.filter(p => PROMOTION_TYPES.has(String(p.type || '')))
      .filter(p => ['active','started','candidate'].includes(String(p.status || '').toLowerCase()))
      .map(p => ({
        type: p.type, status: p.status, name: p.name || '', couponCode: p.coupon_code || null,
        fixedPercentage: Number.isFinite(Number(p.fixed_percentage)) ? Number(p.fixed_percentage) : 0,
        fixedAmount: Number.isFinite(Number(p.fixed_amount)) ? Number(p.fixed_amount) : 0
      }));
  } catch { return []; }
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
  return item?.seller?.seller_reputation?.level_id || item?.seller?.reputation_level_id || item?.seller_reputation?.level_id || '';
}
function cleanTitle(rawTitle, fallback = 'Produto Mercado Livre') {
  const title = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  return title || fallback;
}
function normalize(item, keyword, source, rank = null, promotions = [], catalog = null) {
  const price = Number(item.price || 0);
  const original = Number(item.original_price || item.base_price || 0);
  const directDiscount = original > price && original > 0 ? Math.round((1 - price / original) * 100) : 0;
  const coupon = promotions.find(p => p.type === 'SELLER_COUPON_CAMPAIGN');
  const couponPct = Number(coupon?.fixedPercentage || 0);
  const couponAmount = Number(coupon?.fixedAmount || 0);
  const couponPctFromAmount = price > 0 && couponAmount > 0 ? (couponAmount / price) * 100 : 0;
  const effectiveDiscount = Math.max(directDiscount, couponPct, couponPctFromAmount);
  const catalogName = catalog?.name || catalog?.family_name || '';
  const title = cleanTitle(item.title || catalogName);
  return {
    id: item.id || item.item_id, keyword, source, rank, title,
    price, originalPrice: original || null, discount: directDiscount, effectiveDiscount,
    currency: item.currency_id || catalog?.currency_id || 'BRL',
    permalink: item.permalink || catalog?.permalink || null,
    thumbnail: item.thumbnail || catalog?.pictures?.[0]?.url || catalog?.pictures?.[0]?.secure_url || null,
    seller: item?.seller?.nickname || 'Mercado Livre', sellerReputation: reputation(item),
    condition: item.condition || 'new', availableQuantity: item.available_quantity ?? null,
    soldQuantity: item.sold_quantity ?? null,
    shipping: item.shipping?.free_shipping === true || item.shipping?.tags?.includes('mandatory_free_shipping') ? 'grátis' : 'pago/variável',
    promotions, promotionTypes: [...new Set([...promotions.map(p => p.type), ...signals(item)])].filter(Boolean),
    hasPromotion: promotions.length > 0, couponCode: coupon?.couponCode || null,
    couponPercentage: couponPct || null, couponAmount: couponAmount || null,
    affiliateLink: null, affiliateStatus: 'PENDENTE_GERACAO_NO_PORTAL'
  };
}
function score(item) {
  const discount = Math.min(Math.max(item.effectiveDiscount || 0, 0), 80);
  const shipping = item.shipping === 'grátis' ? 5 : 0;
  const sales = Number(item.soldQuantity || 0);
  const salesBonus = sales > 0 ? Math.min(12, Math.log10(sales + 1) * 5) : 0;
  const couponBonus = item.couponCode || item.couponPercentage || item.couponAmount ? 10 : 0;
  return Math.max(0, Math.min(100, Math.round(discount + shipping + salesBonus + couponBonus)));
}
function hasRealBenefit(item) {
  return Number(item.effectiveDiscount || 0) >= MIN_DISCOUNT;
}
function valid(item) {
  const title = String(item.title || '');
  return Boolean(
    item.id && item.price >= MIN_PRICE && item.permalink &&
    (item.condition === 'new' || !item.condition) &&
    (item.availableQuantity == null || item.availableQuantity > 0) &&
    !blockedNonProductPatterns.some(rx => rx.test(title)) &&
    hasRealBenefit(item)
  );
}
function titleKey(title) {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(novo|original|oferta|frete gratis|menor preco|imperdivel)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 10).join(' ');
}
export async function discoverMercadoLivre() {
  const errors = [];
  const collected = [];
  const stats = { searchRequests: 0, searchItems: 0, catalogProducts: 0, catalogItems: 0, validProducts: 0, discountedProducts: 0, rejectedQuality: 0, duplicates: 0 };
  const token = await validateToken();
  if (!token.valid) return { offers: [], errors: token.error ? [token.error] : [], authenticated: false, stats, minDiscount: MIN_DISCOUNT };
  const seen = new Set();
  for (const keyword of keywords) {
    stats.searchRequests++;
    try {
      const catalogResponse = await searchCatalog(keyword);
      const products = Array.isArray(catalogResponse.results) ? catalogResponse.results : [];
      stats.catalogProducts += products.length;
      for (const [productIndex, productSummary] of products.entries()) {
        const product = await getCatalogProduct(productSummary.id) || productSummary;
        const items = await getCatalogItems(product.id).catch(() => []);
        stats.catalogItems += items.length;
        for (const [itemIndex, candidate] of items.entries()) {
          const itemId = candidate?.item_id || candidate?.id;
          if (!itemId || seen.has(itemId)) { stats.duplicates++; continue; }
          seen.add(itemId);
          let item = { ...candidate, id: itemId };
          if ((stats.detailChecks || 0) < DETAIL_CHECKS) {
            stats.detailChecks = (stats.detailChecks || 0) + 1;
            item = await getFullItem(itemId).catch(() => item);
          }
          const promotions = await getPromotions(itemId);
          const normalized = normalize(item, keyword, 'catalog_items', productIndex * 100 + itemIndex + 1, promotions, product);
          stats.searchItems++;
          if (normalized.effectiveDiscount > 0) stats.discountedProducts++;
          if (!valid(normalized)) { stats.rejectedQuality++; continue; }
          stats.validProducts++;
          collected.push({ ...normalized, score: score(normalized) });
          if (collected.length >= MAX * 8) break;
        }
        if (collected.length >= MAX * 8) break;
      }
    } catch (error) { errors.push(`Catálogo (${keyword}): ${error.message}`); }
    if (collected.length >= MAX * 8) break;
  }
  const ranked = [...new Map(collected.map(item => [item.id, item])).values()]
    .sort((a, b) => b.score - a.score || b.effectiveDiscount - a.effectiveDiscount || a.price - b.price);
  const unique = [];
  const seenTitles = new Set();
  for (const item of ranked) {
    const key = titleKey(item.title);
    if (key && seenTitles.has(key)) { stats.duplicates++; continue; }
    if (key) seenTitles.add(key);
    unique.push(item);
  }
  const selected = [];
  const sellerCount = new Map();
  for (const item of unique) {
    const seller = String(item.seller || item.id);
    if ((sellerCount.get(seller) || 0) >= MAX_PER_SELLER) continue;
    selected.push(item);
    sellerCount.set(seller, (sellerCount.get(seller) || 0) + 1);
    if (selected.length >= MAX) break;
  }
  return { offers: selected, errors, authenticated: true, tokenConfigured: true, tokenUserId: token.userId || null, stats, minDiscount: MIN_DISCOUNT, minPrice: MIN_PRICE };
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
  return lines.join('\n');
}
export function formatMercadoLivre(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = `${Math.round(item.effectiveDiscount || 0)}% OFF`;
  const promotion = promotionText(item);
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)} | ${discount}${promotion ? `\n\n${promotion}` : ''}\n🚚 Frete: ${item.shipping}\n🏪 Vendedor: ${item.seller || 'Mercado Livre'}\n\n🛒 LINK DO PRODUTO:\n${item.permalink}\n\n⚠️ Gere o link de afiliado no portal oficial antes de divulgar.`;
}
