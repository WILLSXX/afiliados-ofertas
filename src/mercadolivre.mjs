const env = process.env;
const API = 'https://api.mercadolibre.com';
const keywords = (env.ML_KEYWORDS || env.KEYWORDS || 'ssd,memoria ram,monitor gamer,fone bluetooth,roteador,teclado mecanico').split(',').map(s => s.trim()).filter(Boolean);
const MAX = Number(env.ML_MAX_OFFERS || 10);
const MIN_DISCOUNT = Number(env.ML_MIN_DISCOUNT || 15);
const ACCESS_TOKEN = env.ML_ACCESS_TOKEN || '';

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

async function search(keyword) {
  const url = `${API}/sites/MLB/search?q=${encodeURIComponent(keyword)}&limit=50&sort=relevance`;
  const headers = { Accept: 'application/json' };

  // A busca de anúncios pode funcionar sem autenticação. Se o endpoint
  // rejeitar o token com 403, fazemos uma segunda tentativa sem Bearer
  // para separar bloqueio da busca de problema no OAuth.
  if (ACCESS_TOKEN) headers.Authorization = `Bearer ${ACCESS_TOKEN}`;

  let response = await fetch(url, { headers });
  if (response.ok) return response.json();

  const firstError = await readError(response);

  if (response.status === 403 && ACCESS_TOKEN) {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (response.ok) return response.json();

    const secondError = await readError(response);
    throw new Error(`${firstError}; tentativa sem token: ${secondError}`);
  }

  throw new Error(firstError);
}

function normalize(item, keyword) {
  const price = Number(item.price || 0);
  const original = Number(item.original_price || 0);
  const discount = original > price && original > 0 ? Math.round((1 - price / original) * 100) : 0;
  const seller = item.seller?.nickname || '';
  const reputation = item.seller?.seller_reputation?.level_id || '';
  return {
    id: item.id,
    keyword,
    title: item.title,
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
  return Math.round(Math.min(100, discountPoints + reputationPoints + stockPoints + shippingPoints));
}

function eligible(item) {
  return Boolean(item.permalink && item.price > 0 && item.condition === 'new' && item.availableQuantity !== 0 && item.discount >= MIN_DISCOUNT);
}

export async function discoverMercadoLivre() {
  const all = [];
  const errors = [];
  const token = await validateToken();

  if (!token.configured) {
    errors.push(token.error);
  } else if (!token.valid) {
    errors.push(`Token do Mercado Livre inválido ou sem autorização: ${token.error}`);
  }

  for (const keyword of keywords) {
    try {
      const result = await search(keyword);
      for (const raw of result.results || []) {
        const item = normalize(raw, keyword);
        if (eligible(item)) all.push({ ...item, score: score(item) });
      }
    } catch (error) {
      const message = `Falha no Mercado Livre (${keyword}): ${error.message}`;
      errors.push(message);
      console.error(message);
    }
  }

  const unique = [...new Map(all.map(item => [item.id, item])).values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX);

  return {
    offers: unique,
    errors,
    authenticated: token.valid,
    tokenConfigured: token.configured,
    tokenUserId: token.userId || null
  };
}

export function formatMercadoLivre(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = item.discount ? ` | ${item.discount}% OFF` : '';
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}\n🚚 Frete: ${item.shipping}\n🏪 Vendedor: ${item.seller || 'Mercado Livre'}\n\n🛒 LINK DO PRODUTO:\n${item.permalink}\n\n⚠️ O link acima ainda precisa ser convertido no Gerador de Links do Portal de Afiliados do Mercado Livre antes da divulgação.`;
}
