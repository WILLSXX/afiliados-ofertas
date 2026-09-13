const env = process.env;
const API = 'https://api.mercadolibre.com';
const keywords = (env.ML_KEYWORDS || env.KEYWORDS || 'ssd,memoria ram,monitor gamer,fone bluetooth,roteador,teclado mecanico').split(',').map(s => s.trim()).filter(Boolean);
const MAX = Number(env.ML_MAX_OFFERS || 10);
const MIN_DISCOUNT = Number(env.ML_MIN_DISCOUNT || 15);

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ --';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function search(keyword) {
  const url = `${API}/sites/MLB/search?q=${encodeURIComponent(keyword)}&limit=50&sort=relevance`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Mercado Livre HTTP ${response.status}`);
  return response.json();
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
  const discount = Math.min(item.discount, 60);
  const reputation = item.sellerReputation === '5_green' ? 15 : item.sellerReputation === '4_light_green' ? 10 : 5;
  const stock = Number(item.availableQuantity || 0) > 0 ? 10 : 0;
  const shipping = item.shipping === 'grátis' ? 10 : 0;
  return Math.round(discount * 0.6 + reputation * 0.2 + stock * 0.1 + shipping * 0.1);
}

function eligible(item) {
  return Boolean(item.permalink && item.price > 0 && item.condition === 'new' && item.availableQuantity !== 0 && item.discount >= MIN_DISCOUNT);
}

export async function discoverMercadoLivre() {
  const all = [];
  for (const keyword of keywords) {
    try {
      const result = await search(keyword);
      for (const raw of result.results || []) {
        const item = normalize(raw, keyword);
        if (eligible(item)) all.push({ ...item, score: score(item) });
      }
    } catch (error) {
      console.error(`Falha no Mercado Livre (${keyword}): ${error.message}`);
    }
  }

  const unique = [...new Map(all.map(item => [item.id, item])).values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX);

  return unique;
}

export function formatMercadoLivre(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = item.discount ? ` | ${item.discount}% OFF` : '';
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}\n🚚 Frete: ${item.shipping}\n🏪 Vendedor: ${item.seller || 'Mercado Livre'}\n\n🛒 LINK DO PRODUTO:\n${item.permalink}\n\n⚠️ O link acima ainda precisa ser convertido no Gerador de Links do Portal de Afiliados do Mercado Livre antes da divulgação.`;
}
