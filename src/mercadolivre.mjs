const env = process.env;
const API = 'https://api.mercadolibre.com';
const SITE_ID = 'MLB';
const keywords = (env.ML_KEYWORDS || env.KEYWORDS || 'celular,smart tv,notebook,ssd,memoria ram,monitor,fone bluetooth,roteador,power bank,ferramentas,impressora,tablet,smartwatch,mouse gamer,teclado mecanico,placa de video,headset gamer,air fryer,cafeteira,aspirador')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX = Number(env.ML_MAX_OFFERS || 10);
const MIN_DISCOUNT = Number(env.ML_MIN_DISCOUNT || 15);
const MIN_PRICE = Number(env.ML_MIN_PRICE || 49.9);
const MIN_SCORE = Number(env.ML_MIN_SCORE || 70);
const MIN_SOLD = Number(env.ML_MIN_SOLD || 20);
const MAX_PER_SELLER = Number(env.ML_MAX_PER_SELLER || 1);
const ACCESS_TOKEN = env.ML_ACCESS_TOKEN || '';
const CATALOG_LIMIT = Number(env.ML_CATALOG_LIMIT || 5);
const ITEMS_PER_PRODUCT = Number(env.ML_ITEMS_PER_PRODUCT || 20);
const DETAIL_CHECKS = Number(env.ML_DETAIL_CHECKS || 20);
const PROMOTION_TYPES = new Set(['DEAL','MARKETPLACE_CAMPAIGN','DOD','LIGHTNING','VOLUME','PRICE_DISCOUNT','PRE_NEGOTIATED','SELLER_CAMPAIGN','SMART','PRICE_MATCHING','UNHEALTHY_STOCK','SELLER_COUPON_CAMPAIGN']);

const blockedTitlePatterns = [
  /\b(capa|pel[ií]cula|case|suporte|adaptador|cabo|hub usb|mousepad)\b/i,
  /\b(refil|cartucho|toner|reposi[cç][aã]o|pe[cç]a de reposi[cç][aã]o|somente a pe[cç]a)\b/i,
  /\b(adesivo|chaveiro|enfeite|decora[cç][aã]o|boneco|brinquedo|fantasia|miniatura)\b/i,
  /\b(compat[ií]vel|para iphone|para celular|para notebook|para roteador|para tv)\b/i,
  /\bkit\s+\d{2,}\b/i
];
const requiredPatterns = {
  celular: /\b(celular|smartphone|iphone|galaxy|redmi|poco|motorola|moto\s?[a-z0-9]+)\b/i,
  'smart tv': /\b(smart\s*tv|televis[aã]o|tv)\b/i,
  notebook: /\b(notebook|laptop)\b/i,
  ssd: /\b(ssd|nvme)\b/i,
  'memoria ram': /\b(mem[óo]ria\s*(ram)?|ddr[2345])\b/i,
  monitor: /\bmonitor\b/i,
  'fone bluetooth': /\b(fone|earbuds?|headset)\b/i,
  roteador: /\b(roteador|mesh|wi-?fi)\b/i,
  'power bank': /\b(power\s*bank|carregador\s+port[aá]til|bateria\s+externa)\b/i,
  ferramentas: /\b(furadeira|parafusadeira|esmerilhadeira|serra|mult[ií]metro|ferramenta)\b/i,
  impressora: /\b(impressora|multifuncional)\b/i,
  tablet: /\btablet\b/i,
  smartwatch: /\b(smartwatch|rel[oó]gio inteligente)\b/i,
  'mouse gamer': /\bmouse\b/i,
  'teclado mecanico': /\bteclado\b/i,
  'placa de video': /\b(placa\s+de\s+v[ií]deo|rtx|gtx|radeon|geforce|rx\s?\d+)\b/i,
  'headset gamer': /\bheadset\b/i,
  'air fryer': /\b(air\s*fryer|fritadeira)\b/i,
  cafeteira: /\b(cafeteira|espresso|expresso)\b/i,
  aspirador: /\b(aspirador|rob[oô]\s+aspirador)\b/i
};

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
async function getCatalogItems(productId, onlyDiscount = false) {
  const filter = onlyDiscount ? `&discount=${Math.max(1, MIN_DISCOUNT)}-100` : '';
  const result = await mlGet(`/products/${encodeURIComponent(productId)}/items?limit=${ITEMS_PER_PRODUCT}${filter}`);
  return Array.isArray(result.results) ? result.results : [];
}
async function getFullItem(itemId) { return mlGet(`/items/${encodeURIComponent(itemId)}`); }
async function getPromotions(itemId) {
  try {
    const result = await mlGet(`/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`);
    if (!Array.isArray(result)) return [];
    return result.filter(p => PROMOTION_TYPES.has(String(p.type || '')))
      .filter(p => ['active','started','candidate'].includes(String(p.status || '').toLowerCase()))
      .map(p => ({ type: p.type, status: p.status, name: p.name || '', couponCode: p.coupon_code || null,
        fixedPercentage: Number.isFinite(Number(p.fixed_percentage)) ? Number(p.fixed_percentage) : null,
        fixedAmount: Number.isFinite(Number(p.fixed_amount)) ? Number(p.fixed_amount) : null,
        minPurchaseAmount: Number.isFinite(Number(p.min_purchase_amount)) ? Number(p.min_purchase_amount) : null,
        maxPurchaseAmount: Number.isFinite(Number(p.max_purchase_amount)) ? Number(p.max_purchase_amount) : null }));
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
function badReputation(level) {
  return /(?:red|orange)$/i.test(String(level || ''));
}
function buildItemPermalink(itemId) {
  const id = String(itemId || '');
  return id.startsWith('MLB') ? `https://produto.mercadolivre.com.br/${id.replace(/^MLB/, 'MLB-')}` : null;
}
function cleanTitle(rawTitle, fallback = 'Produto Mercado Livre') {
  const title = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!title) return fallback;
  const tokens = title.split(' ');
  if (tokens.length <= 16) return title;
  return tokens.slice(0, 18).join(' ') + '…';
}
function sellerName(item) {
  const nickname = item?.seller?.nickname;
  if (nickname && !/^\d+$/.test(String(nickname))) return String(nickname);
  return 'Mercado Livre';
}
function keywordKey(value) {
  return String(value || '').toLowerCase().trim();
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
  const promoTypes = [...new Set([...promotions.map(p => p.type), ...signals(item)])].filter(Boolean);
  const catalogName = catalog?.name || catalog?.family_name || '';
  const preferredTitle = catalogName || item.title || '';
  return {
    id: item.id || item.item_id, keyword, source, rank,
    title: cleanTitle(preferredTitle, item.title || catalogName || 'Produto Mercado Livre'),
    price, originalPrice: original || null, discount: directDiscount, effectiveDiscount,
    currency: item.currency_id || catalog?.currency_id || 'BRL',
    permalink: item.permalink || buildItemPermalink(item.id || item.item_id) || catalog?.permalink || null,
    thumbnail: item.thumbnail || catalog?.pictures?.[0]?.url || catalog?.pictures?.[0]?.secure_url || null,
    seller: sellerName(item), sellerReputation: reputation(item), condition: item.condition || 'new',
    availableQuantity: item.available_quantity ?? null, soldQuantity: item.sold_quantity ?? null,
    shipping: item.shipping?.free_shipping === true || item.shipping?.tags?.includes('mandatory_free_shipping') ? 'grátis' : 'pago/variável',
    promotions, promotionTypes: promoTypes,
    hasPromotion: promotions.length > 0 || promoTypes.length > 0,
    couponCode: coupon?.couponCode || null, couponPercentage: couponPct || null, couponAmount: couponAmount || null,
    affiliateLink: null, affiliateStatus: 'PENDENTE_GERACAO_NO_PORTAL'
  };
}
function titleQuality(item) {
  const title = String(item.title || '');
  const keyword = keywordKey(item.keyword);
  if (title.length < 20) return -10;
  if (blockedTitlePatterns.some(rx => rx.test(title))) return -40;
  const required = requiredPatterns[keyword];
  if (required && !required.test(title)) return -20;
  let bonus = required?.test(title) ? 10 : 0;
  if (/\b(samsung|apple|xiaomi|motorola|kingston|sandisk|corsair|logitech|razer|intel|amd|nvidia|philips|lg|electrolux|mondial|epson|canon|hp|acer|lenovo|asus|dell|tcl|jbl|edifier|wd|seagate)\b/i.test(title)) bonus += 5;
  if (/\b\d+(?:gb|tb|w|hz|mah|kg|l|pol|polegadas)\b/i.test(title)) bonus += 4;
  return bonus;
}
function score(item) {
  const discount = Math.min(Math.max(item.effectiveDiscount, 0), 45);
  const promo = item.hasPromotion ? 12 : 0;
  const coupon = item.couponCode || item.couponPercentage || item.couponAmount ? 13 : 0;
  const stock = item.availableQuantity == null || item.availableQuantity > 0 ? 10 : 0;
  const shipping = item.shipping === 'grátis' ? 5 : 0;
  const sales = Number(item.soldQuantity || 0);
  const salesBonus = sales >= 100 ? 10 : sales >= MIN_SOLD ? 6 : 0;
  const rank = Number.isFinite(Number(item.rank)) ? Math.max(0, 10 - Number(item.rank) / 2) : 0;
  const sellerBonus = badReputation(item.sellerReputation) ? 0 : item.sellerReputation ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(
    discount * 0.9 + promo + coupon + stock + shipping + salesBonus + rank + sellerBonus + titleQuality(item)
  )));
}
function valid(item) {
  const discountOk = item.effectiveDiscount >= MIN_DISCOUNT || Boolean(item.couponCode || item.couponPercentage || item.couponAmount);
  const couponEnough = item.couponPercentage >= MIN_DISCOUNT || (item.couponAmount > 0 && item.price > 0 && (item.couponAmount / item.price) * 100 >= MIN_DISCOUNT);
  return Boolean(
    item.id && item.price >= MIN_PRICE &&
    (item.condition === 'new' || !item.condition) && item.permalink &&
    (item.availableQuantity == null || item.availableQuantity > 0) &&
    !badReputation(item.sellerReputation) &&
    !blockedTitlePatterns.some(rx => rx.test(String(item.title || ''))) &&
    (!requiredPatterns[keywordKey(item.keyword)] || requiredPatterns[keywordKey(item.keyword)].test(String(item.title || ''))) &&
    (discountOk && (item.discount >= MIN_DISCOUNT || couponEnough || item.hasPromotion)) &&
    score(item) >= MIN_SCORE
  );
}
function titleKey(title) {
  return String(title || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(novo|original|oferta|frete gratis|menor preco|imperdivel)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').slice(0, 9).join(' ');
}
export async function discoverMercadoLivre() {
  const errors = [];
  const collected = [];
  const stats = { searchRequests: 0, searchItems: 0, searchValid: 0, catalogProducts: 0, catalogItems: 0,
    discountedCatalogItems: 0, validProducts: 0, discountedProducts: 0, promotedItems: 0, couponItems: 0, rejectedQuality: 0, duplicates: 0 };
  const token = await validateToken();
  if (!token.valid) {
    if (token.error) errors.push(`Token do Mercado Livre inválido ou ausente: ${token.error}`);
    return { offers: [], errors, authenticated: false, tokenConfigured: token.configured, tokenUserId: null, stats, fallbackUsed: false, minDiscount: MIN_DISCOUNT };
  }
  const seen = new Set();
  for (const keyword of keywords) {
    stats.searchRequests++;
    try {
      const catalog = await searchCatalog(keyword);
      const products = Array.isArray(catalog.results) ? catalog.results : [];
      stats.catalogProducts += products.length;
      for (const [productIndex, productSummary] of products.entries()) {
        const product = await getCatalogProduct(productSummary.id) || productSummary;
        const discounted = await getCatalogItems(product.id, true).catch(() => []);
        const fallback = discounted.length ? discounted : await getCatalogItems(product.id, false).catch(() => []);
        stats.discountedCatalogItems += discounted.length;
        stats.catalogItems += fallback.length;
        for (const [itemIndex, candidate] of fallback.entries()) {
          const itemId = candidate?.item_id || candidate?.id;
          if (!itemId || seen.has(itemId)) { stats.duplicates++; continue; }
          seen.add(itemId);
          let item = { ...candidate, id: itemId };
          const shouldDetailCheck = stats.detailChecks == null ? true : stats.detailChecks < DETAIL_CHECKS;
          if (shouldDetailCheck) {
            stats.detailChecks = (stats.detailChecks || 0) + 1;
            item = await getFullItem(itemId).catch(() => item);
          }
          const promotions = await getPromotions(itemId);
          const normalized = normalize(item, keyword, 'catalog_items', productIndex * 100 + itemIndex + 1, promotions, product);
          stats.searchItems++;
          if (normalized.discount > 0 || normalized.effectiveDiscount >= MIN_DISCOUNT) stats.discountedProducts++;
          if (normalized.hasPromotion) stats.promotedItems++;
          if (normalized.couponCode || normalized.couponPercentage || normalized.couponAmount) stats.couponItems++;
          if (!valid(normalized)) { stats.rejectedQuality++; continue; }
          stats.searchValid++; stats.validProducts++;
          collected.push({ ...normalized, score: score(normalized) });
          if (collected.length >= MAX * 8) break;
        }
        if (collected.length >= MAX * 8) break;
      }
    } catch (error) { errors.push(`Catálogo (${keyword}): ${error.message}`); }
    if (collected.length >= MAX * 8) break;
  }
  const ranked = [...new Map(collected.map(item => [item.id, item])).values()]
    .sort((a, b) => b.score - a.score || b.effectiveDiscount - a.effectiveDiscount || b.soldQuantity - a.soldQuantity || a.price - b.price);
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
  return { offers: selected, errors, authenticated: true, tokenConfigured: true, tokenUserId: token.userId || null, stats,
    fallbackUsed: true, minDiscount: MIN_DISCOUNT, minPrice: MIN_PRICE, minScore: MIN_SCORE };
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
  const discount = item.effectiveDiscount ? ` | ${Math.round(item.effectiveDiscount)}% OFF efetivo` : '';
  const promotion = promotionText(item);
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}${promotion ? `\n\n${promotion}` : ''}\n🚚 Frete: ${item.shipping}\n🏪 Vendedor: ${item.seller || 'Mercado Livre'}\n⭐ Reputação: ${item.sellerReputation || 'não informado'}\n\n🛒 LINK DO PRODUTO:\n${item.permalink}\n\n⚠️ Converta este link no Gerador de Links oficial do Portal de Afiliados antes de divulgar.`;
}
