import crypto from 'node:crypto';

const API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

const env = process.env;
const keywords = (env.KEYWORDS || 'ssd,memoria ram,monitor gamer,fone bluetooth,roteador').split(',').map(s => s.trim()).filter(Boolean);
const MIN_DISCOUNT = Number(env.MIN_DISCOUNT || 20);
const MIN_RATING = Number(env.MIN_RATING || 4.5);
const MIN_SALES = Number(env.MIN_SALES || 50);
const MAX_OFFERS = Number(env.MAX_OFFERS || 5);
const subIds = (env.SUB_ID || 'telegram,ofertas,tech').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ --';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function signPayload(appId, timestamp, payload, secret) {
  return crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
}

async function shopeeRequest(query) {
  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) {
    throw new Error('SHOPEE_APP_ID/SHOPEE_SECRET ainda não configurados.');
  }

  const body = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(env.SHOPEE_APP_ID, timestamp, body, env.SHOPEE_SECRET);

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `SHA256 Credential=${env.SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}`
    },
    body
  });

  const json = await response.json();
  if (!response.ok || json.errors?.length) {
    const message = json.errors?.map(e => e.message).join('; ') || `HTTP ${response.status}`;
    throw new Error(`Shopee API: ${message}`);
  }
  return json.data;
}

async function getProducts(keyword) {
  const safeKeyword = JSON.stringify(keyword);
  const query = `query { productOfferV2(keyword: ${safeKeyword}, listType: 0, sortType: 5, page: 1, limit: 50) { nodes { itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate sales ratingStar commissionRate commission shopId shopName shopType } pageInfo { page limit hasNextPage } } }`;
  const data = await shopeeRequest(query);
  return data.productOfferV2?.nodes || [];
}

function score(p) {
  const discount = Number(p.priceDiscountRate || 0) * 100;
  const rating = Number(p.ratingStar || 0);
  const sales = Number(p.sales || 0);
  const commission = Number(p.commissionRate || 0) * 100;
  return Math.round(Math.min(discount, 60) * 0.45 + Math.min(rating / 5 * 20, 20) * 0.2 + Math.min(Math.log10(sales + 1) * 10, 20) * 0.15 + Math.min(commission, 20) * 0.2);
}

function eligible(p) {
  const discount = Number(p.priceDiscountRate || 0) * 100;
  const rating = Number(p.ratingStar || 0);
  const sales = Number(p.sales || 0);
  return discount >= MIN_DISCOUNT && rating >= MIN_RATING && sales >= MIN_SALES && p.offerLink;
}

function formatOffer(p) {
  const discount = Math.round(Number(p.priceDiscountRate || 0) * 100);
  const commission = (Number(p.commissionRate || 0) * 100).toFixed(1);
  const price = money(p.priceMin);
  return `🔥 ${p.productName}\n\n💰 ${price}  |  ${discount}% OFF\n⭐ ${Number(p.ratingStar || 0).toFixed(1)}  |  🛒 ${Number(p.sales || 0)} vendas\n💵 Comissão estimada: ${commission}%\n\n🛒 COMPRAR AGORA:\n${p.offerLink}\n\n⚠️ Preço e estoque podem mudar sem aviso.`;
}

async function publishTelegram(text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: false })
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  return true;
}

async function main() {
  console.log(`Iniciando busca: ${keywords.join(', ')}`);
  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) {
    console.log('MODO CONFIGURAÇÃO: credenciais Shopee ainda não configuradas.');
    console.log('Quando a Shopee liberar App ID + Secret, basta adicioná-los aos Secrets do GitHub.');
    return;
  }

  const all = [];
  for (const keyword of keywords) {
    try {
      const products = await getProducts(keyword);
      for (const p of products) if (eligible(p)) all.push({ ...p, keyword, score: score(p) });
    } catch (error) {
      console.error(`Falha em ${keyword}:`, error.message);
    }
  }

  const unique = [...new Map(all.map(p => [String(p.itemId), p])).values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OFFERS);

  console.log(`Ofertas elegíveis: ${unique.length}`);
  for (const p of unique) console.log(`\n${formatOffer(p)}`);

  if (unique.length && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await publishTelegram(formatOffer(unique[0]));
    console.log('Oferta principal publicada no Telegram.');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
