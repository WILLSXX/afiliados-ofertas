const env = process.env;
const API_URL = 'https://creatorsapi.amazon';
const TOKEN_URL = env.AMAZON_TOKEN_URL || 'https://api.amazon.com/auth/o2/token';
const MARKETPLACE = 'www.amazon.com.br';
const PARTNER_TAG = env.AMAZON_PARTNER_TAG || '';
const keywords = (env.AMAZON_KEYWORDS || env.KEYWORDS || 'ssd,memoria ram,monitor gamer,fone bluetooth,roteador,notebook,smart tv').split(',').map(s => s.trim()).filter(Boolean);
const MIN_DISCOUNT = Number(env.AMAZON_MIN_DISCOUNT || 15);
const MIN_PRICE = Number(env.AMAZON_MIN_PRICE || 49.9);
const MIN_SCORE = Number(env.AMAZON_MIN_SCORE || 60);
const MAX_OFFERS = Number(env.AMAZON_MAX_OFFERS || 10);

const blockedTitlePatterns = [
  /\b(capa|pel[ií]cula|case|suporte|adaptador|cabo|hub usb|mousepad)\b/i,
  /\b(refil|cartucho|toner|reposi[cç][aã]o|pe[cç]a de reposi[cç][aã]o|somente a pe[cç]a)\b/i,
  /\b(adesivo|chaveiro|enfeite|decora[cç][aã]o|boneco|brinquedo|miniatura)\b/i,
  /\b(compat[ií]vel|para iphone|para celular|para notebook|para roteador|para tv)\b/i,
  /\bkit\s+\d{2,}\b/i
];
const requiredPatterns = {
  ssd: /\b(ssd|nvme)\b/i,
  'memoria ram': /\b(mem[óo]ria\s*(ram)?|ddr[2345])\b/i,
  'monitor gamer': /\bmonitor\b/i,
  'fone bluetooth': /\b(fone|earbuds?|headset)\b/i,
  roteador: /\b(roteador|mesh|wi-?fi)\b/i,
  notebook: /\b(notebook|laptop)\b/i,
  'smart tv': /\b(smart\s*tv|televis[aã]o|tv)\b/i,
  celular: /\b(celular|smartphone|iphone|galaxy|redmi|poco|motorola)\b/i,
  'power bank': /\b(power\s*bank|carregador\s+port[aá]til|bateria\s+externa)\b/i
};

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
    originalPrice: basis, discount, image: item.images?.primary?.medium?.url || null, permalink: item.detailPageURL || null,
    partnerTag: PARTNER_TAG, source: 'amazon_creators_api'
  };
}
function score(item) {
  const discount = Math.min(Math.max(Number(item.discount || 0), 0), 50);
  const price = Number(item.price || 0);
  const title = String(item.title || '');
  const required = requiredPatterns[String(item.keyword || '').toLowerCase()];
  let value = Math.min(45, discount * 0.95);
  value += price >= 120 ? 10 : price >= 80 ? 8 : 4;
  value += required?.test(title) ? 15 : -15;
  if (/\b(samsung|apple|xiaomi|motorola|kingston|sandisk|corsair|logitech|razer|intel|amd|nvidia|philips|lg|electrolux|mondial|epson|canon|hp|acer|lenovo|asus|dell|tcl|jbl|edifier|wd|seagate)\b/i.test(title)) value += 6;
  if (blockedTitlePatterns.some(rx => rx.test(title))) value -= 45;
  return Math.max(0, Math.min(100, Math.round(value)));
}
function eligible(item) {
  if (!item.asin || !item.permalink || !Number.isFinite(item.price) || item.price < MIN_PRICE) return false;
  if (item.discount < MIN_DISCOUNT) return false;
  const title = String(item.title || '');
  if (title.length < 20 || blockedTitlePatterns.some(rx => rx.test(title))) return false;
  const required = requiredPatterns[String(item.keyword || '').toLowerCase()];
  if (required && !required.test(title)) return false;
  return score(item) >= MIN_SCORE;
}
function titleKey(title) {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(novo|original|oferta|frete gratis|menor preco|imperdivel)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 9).join(' ');
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
        for (const item of items) {
          stats.candidates++;
          const normalized = normalize(item, keyword);
          if (eligible(normalized)) collected.push({ ...normalized, score: score(normalized) });
          else stats.rejected++;
        }
      } catch (error) { errors.push(`Amazon (${keyword}): ${error.message}`); }
    }
    const ranked = [...new Map(collected.map(x => [x.asin, x])).values()]
      .sort((a, b) => b.score - a.score || b.discount - a.discount || a.price - b.price);
    const unique = [];
    const titles = new Set();
    for (const item of ranked) {
      const key = titleKey(item.title);
      if (key && titles.has(key)) { stats.duplicates++; continue; }
      if (key) titles.add(key);
      unique.push(item);
    }
    stats.accepted = unique.length;
    return { authenticated: true, offers: unique.slice(0, MAX_OFFERS), errors, keywords, stats };
  } catch (error) {
    return { authenticated: false, offers: [], errors: [error.message], keywords, stats };
  }
}
export function formatAmazon(item) {
  const oldPrice = item.originalPrice ? `De ${money(item.originalPrice)} por ` : '';
  const discount = item.discount ? ` | ${item.discount}% OFF` : '';
  return `🔥 ${item.title}\n\n💰 ${oldPrice}${money(item.price)}${discount}\n\n🛒 COMPRAR AGORA:\n${item.permalink}\n\n⚠️ Preço, estoque e oferta podem mudar sem aviso.`;
}
