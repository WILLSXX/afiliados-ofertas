const env = process.env;
const API_URL = 'https://creatorsapi.amazon';
const TOKEN_URL = env.AMAZON_TOKEN_URL || 'https://api.amazon.com/auth/o2/token';
const MARKETPLACE = 'www.amazon.com.br';
const PARTNER_TAG = env.AMAZON_PARTNER_TAG || '';
const keywords = (env.AMAZON_KEYWORDS || env.KEYWORDS || 'ssd,memoria ram,monitor gamer,fone bluetooth,roteador,notebook,smart tv').split(',').map(s => s.trim()).filter(Boolean);
const MIN_DISCOUNT = Number(env.AMAZON_MIN_DISCOUNT || 1);
const MIN_PRICE = Number(env.AMAZON_MIN_PRICE || 0);
const MAX_OFFERS = Number(env.AMAZON_MAX_OFFERS || 10);

const blockedNonProductPatterns = [
  /\b(servi[cç]o|curso|ebook|e-book|assinatura|software|licen[cç]a digital|arquivo digital)\b/i
];

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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.AMAZON_CLIENT_ID, client_secret: env.AMAZON_CLIENT_SECRET, scope: 'creatorsapi::default' })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Amazon token HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}
async function searchItems(token, keyword) {
  const response = await fetch(`${API_URL}/catalog/v1/searchItems`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-marketplace': MARKETPLACE },
    body: JSON.stringify({ keywords: keyword, partnerTag: PARTNER_TAG, marketplace: MARKETPLACE, itemCount: 10, resources: [
      'images.primary.medium', 'itemInfo.title', 'offersV2.listings.price', 'offersV2.listings.savingBasis', 'offersV2.listings.savings'
    ] })
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
    keyword, asin: item.asin || '', title: item.itemInfo?.title?.displayValue || 'Produto Amazon', price,
    originalPrice: basis, discount, image: item.images?.primary?.medium?.url || null,
    permalink: item.detailPageURL || null, partnerTag: PARTNER_TAG, source: 'amazon_creators_api'
  };
}
function eligible(item) {
  return Boolean(item.asin && item.permalink && Number.isFinite(item.price) && item.price >= MIN_PRICE && item.discount >= MIN_DISCOUNT &&
    String(item.title || '').length >= 8 && !blockedNonProductPatterns.some(rx => rx.test(item.title)));
}
function titleKey(title) {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(novo|original|oferta|frete gratis|menor preco|imperdivel)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 10).join(' ');
}
export async function discoverAmazon() {
  const errors = [];
  const stats = { candidates: 0, accepted: 0, rejected: 0, duplicates: 0 };
  if (!configured()) return { authenticated: false, offers: [], errors: ['Amazon Creators API ainda não configurada.'], keywords, stats };
  try {
    const token = await getAccessToken();
    const collected = [];
    for (const keyword of keywords) {
      try {
        const items = await searchItems(token, keyword);
        for (const raw of items) {
          stats.candidates++;
          const item = normalize(raw, keyword);
          if (eligible(item)) collected.push(item);
          else stats.rejected++;
        }
      } catch (error) { errors.push(`Amazon (${keyword}): ${error.message}`); }
    }
    const unique = [];
    const seen = new Set();
    for (const item of collected.sort((a, b) => b.discount - a.discount || a.price - b.price)) {
      if (seen.has(item.asin)) continue;
      const key = titleKey(item.title);
      if (key && unique.some(existing => titleKey(existing.title) === key)) { stats.duplicates++; continue; }
      seen.add(item.asin); unique.push({ ...item, score: Math.min(100, item.discount) });
    }
    stats.accepted = unique.length;
    return { authenticated: true, offers: unique.slice(0, MAX_OFFERS), errors, keywords, stats };
  } catch (error) {
    return { authenticated: false, offers: [], errors: [error.message], keywords, stats };
  }
}
export function formatAmazon(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)} | ${item.discount}% OFF\n\n🛒 COMPRAR AGORA:\n${item.permalink}\n\n⚠️ Preço, estoque e oferta podem mudar sem aviso.`;
}
