const env = process.env;
const API_URL = 'https://creatorsapi.amazon';
const TOKEN_URL = env.AMAZON_TOKEN_URL || 'https://api.amazon.com/auth/o2/token';
const MARKETPLACE = 'www.amazon.com.br';
const PARTNER_TAG = env.AMAZON_PARTNER_TAG || '';
const keywords = (env.AMAZON_KEYWORDS || env.KEYWORDS || 'ssd,memoria ram,monitor gamer,fone bluetooth,roteador,teclado mecanico').split(',').map(s => s.trim()).filter(Boolean);

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ --';
}

function configured() {
  return Boolean(env.AMAZON_CLIENT_ID && env.AMAZON_CLIENT_SECRET && env.AMAZON_VERSION && PARTNER_TAG);
}

async function getAccessToken() {
  if (!configured()) throw new Error('Credenciais da Amazon Creators API ainda não configuradas.');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.AMAZON_CLIENT_ID,
      client_secret: env.AMAZON_CLIENT_SECRET,
      scope: 'creatorsapi::default'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Amazon token HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

async function searchItems(token, keyword) {
  const response = await fetch(`${API_URL}/catalog/v1/searchItems`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-marketplace': MARKETPLACE
    },
    body: JSON.stringify({
      keywords: keyword,
      partnerTag: PARTNER_TAG,
      marketplace: MARKETPLACE,
      itemCount: 10,
      resources: [
        'images.primary.medium',
        'itemInfo.title',
        'offersV2.listings.price',
        'offersV2.listings.savingBasis',
        'offersV2.listings.savings'
      ]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Amazon SearchItems HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.searchResult?.items || [];
}

function normalize(item, keyword) {
  const listing = item.offersV2?.listings?.[0];
  const price = listing?.price?.amount != null ? Number(listing.price.amount) : null;
  const basis = listing?.savingBasis?.amount != null ? Number(listing.savingBasis.amount) : null;
  const saving = listing?.savings?.amount != null ? Number(listing.savings.amount) : null;
  const discount = basis && price && basis > price ? Math.round((1 - price / basis) * 100) : (saving && basis ? Math.round((saving / basis) * 100) : 0);
  return {
    keyword,
    asin: item.asin || '',
    title: item.itemInfo?.title?.displayValue || 'Produto Amazon',
    price,
    originalPrice: basis,
    discount,
    image: item.images?.primary?.medium?.url || null,
    permalink: item.detailPageURL || null,
    partnerTag: PARTNER_TAG,
    source: 'amazon_creators_api'
  };
}

export async function discoverAmazon() {
  const errors = [];
  if (!configured()) return { authenticated: false, offers: [], errors: ['Amazon Creators API ainda não configurada.'], keywords };
  try {
    const token = await getAccessToken();
    const collected = [];
    for (const keyword of keywords) {
      try {
        const items = await searchItems(token, keyword);
        for (const item of items) collected.push(normalize(item, keyword));
      } catch (error) {
        errors.push(`Amazon (${keyword}): ${error.message}`);
      }
    }
    const unique = [...new Map(collected.filter(x => x.asin).map(x => [x.asin, x])).values()]
      .sort((a, b) => b.discount - a.discount || (a.price ?? Infinity) - (b.price ?? Infinity));
    return { authenticated: true, offers: unique.slice(0, Number(env.AMAZON_MAX_OFFERS || 10)), errors, keywords };
  } catch (error) {
    return { authenticated: false, offers: [], errors: [error.message], keywords };
  }
}

export function formatAmazon(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = item.discount ? ` | ${item.discount}% OFF` : '';
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}\n\n🛒 COMPRAR AGORA:\n${item.permalink}\n\n⚠️ Preço, estoque e oferta podem mudar sem aviso.`;
}
