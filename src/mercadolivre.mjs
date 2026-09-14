const env = process.env;
const API = 'https://api.mercadolibre.com';
const keywords = (env.ML_KEYWORDS || env.KEYWORDS || 'ssd,memoria ram,monitor gamer,fone bluetooth,roteador,teclado mecanico').split(',').map(s => s.trim()).filter(Boolean);
const MAX = Number(env.ML_MAX_OFFERS || 10);
const MIN_DISCOUNT = Number(env.ML_MIN_DISCOUNT || 15);
const ACCESS_TOKEN = env.ML_ACCESS_TOKEN || '';
const CATALOG_LIMIT = Number(env.ML_CATALOG_LIMIT || 10);
const ENABLE_FALLBACK = String(env.ML_FALLBACK || 'true').toLowerCase() === 'true';

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

async function getCatalogWinner(productId) {
  const product = await mlGet(`/products/${encodeURIComponent(productId)}`);
  const winnerId = product.buy_box_winner?.item_id || product.buy_box_winner?.item?.id || null;
  if (!winnerId) return null;

  const item = await mlGet(`/items/${encodeURIComponent(winnerId)}`);
  return { product, item };
}

function reputationLevel(item) {
  const level = item.seller?.seller_reputation?.level_id || '';
  if (level) return level;

  const status = String(item.seller?.seller_reputation?.power_seller_status || '').toLowerCase();
  if (status) return '5_green';
  return '';
}

function normalize(item, keyword, product = null) {
  const price = Number(item.price || 0);
  const original = Number(item.original_price || 0);
  const discount = original > price && original > 0 ? Math.round((1 - price / original) * 100) : 0;
  const seller = item.seller?.nickname || '';
  const reputation = reputationLevel(item);
  const title = item.title || product?.name || product?.family_name || 'Produto Mercado Livre';

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
    condition: item.condition,
    availableQuantity: item.available_quantity,
    soldQuantity: item.sold_quantity ?? null,
    shipping: item.shipping?.free_shipping === true ? 'grátis' : 'pago/variável',
    acceptsMercadoPago: item.accepts_mercadopago,
    affiliateLink: null,
    affiliateStatus: 'PENDENTE_GERACAO_NO_PORTAL'
  };
}

function score(item) {
  const discountPoints = Math.min(item.discount, 60);
  const reputationPoints = item.sellerReputation === '5_green' ? 15 : item.sellerReputation === '4_light_green' ? 10 : 5;
  const stockPoints = Number(item.availableQuantity || 0) > 0 ? 15 : 0;
  const shippingPoints = item.shipping === 'grátis' ? 10 : 0;
  const salesPoints = Math.min(Number(item.soldQuantity || 0) > 0 ? 10 : 0, 10);
  return Math.round(Math.min(100, discountPoints + reputationPoints + stockPoints + shippingPoints + salesPoints));
}

function basicEligible(item) {
  return Boolean(
    item.permalink &&
    item.price > 0 &&
    item.condition === 'new' &&
    item.availableQuantity !== 0
  );
}

function eligible(item) {
  return basicEligible(item) && item.discount >= MIN_DISCOUNT;
}

export async function discoverMercadoLivre() {
  const all = [];
  const fallback = [];
  const errors = [];
  const stats = { catalogProducts: 0, winners: 0, validProducts: 0, discountedProducts: 0 };
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
          const winner = await getCatalogWinner(product.id);
          if (!winner) continue;
          stats.winners++;

          const item = normalize(winner.item, keyword, winner.product);
          if (!basicEligible(item)) continue;
          stats.validProducts++;

          if (item.discount >= MIN_DISCOUNT) stats.discountedProducts++;
          const candidate = { ...item, score: score(item) };

          if (eligible(item)) all.push(candidate);
          else if (ENABLE_FALLBACK) fallback.push(candidate);
        } catch (error) {
          console.error(`Falha no detalhe do produto ${product.id} (${keyword}): ${error.message}`);
        }
      }
    } catch (error) {
      const message = `Falha no Mercado Livre (${keyword}): ${error.message}`;
      errors.push(message);
      console.error(message);
    }
  }

  let selected = all;
  let fallbackUsed = false;

  if (!selected.length && ENABLE_FALLBACK) {
    fallbackUsed = fallback.length > 0;
    selected = fallback;
  }

  const unique = [...new Map(selected.map(item => [item.id, item])).values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX)
    .map(item => ({ ...item, fallback: fallbackUsed && item.discount < MIN_DISCOUNT }));

  return {
    offers: unique,
    errors,
    authenticated: token.valid,
    tokenConfigured: token.configured,
    tokenUserId: token.userId || null,
    stats,
    fallbackUsed,
    minDiscount: MIN_DISCOUNT
  };
}

export function formatMercadoLivre(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = item.discount ? ` | ${item.discount}% OFF` : '';
  const notice = item.fallback
    ? '\n⚠️ Candidato de fallback: não foi detectado desconto suficiente pela API. Confirme o preço/oferta no anúncio antes de divulgar.'
    : '';
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}\n🚚 Frete: ${item.shipping}\n🏪 Vendedor: ${item.seller || 'Mercado Livre'}\n\n🛒 LINK DO PRODUTO:\n${item.permalink}${notice}\n\n⚠️ O link acima ainda precisa ser convertido no Gerador de Links do Portal de Afiliados do Mercado Livre antes da divulgação.`;
}
