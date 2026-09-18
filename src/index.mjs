import crypto from 'node:crypto';
import fs from 'node:fs';

const API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';
const env = process.env;
const keywords = (env.KEYWORDS || 'celular,smart tv,notebook,ssd,memoria ram,monitor gamer,fone bluetooth,fone gamer,teclado mecanico,mouse gamer,placa de video,roteador wifi,power bank,ferramentas,impressora,air fryer,cafeteira,aspirador')
  .split(',').map(s => s.trim()).filter(Boolean);

// Objetivo do projeto: reunir ofertas reais. Qualquer desconto positivo pode entrar.
const MIN_DISCOUNT = Number(env.MIN_DISCOUNT || 1);
const MAX_OFFERS = Number(env.MAX_OFFERS || 10);
const MAX_PER_KEYWORD = Number(env.SHOPEE_MAX_PER_KEYWORD || 2);
const MAX_PER_SHOP = Number(env.SHOPEE_MAX_PER_SHOP || 2);
const subIds = (env.SUB_ID || 'telegram,ofertas,tech').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

const blockedNonProductPatterns = [
  /\b(servi[cç]o|curso|aula|ebook|e-book|assinatura|software|licen[cç]a digital|arquivo digital)\b/i,
  /\b(amostra grátis|somente frete|consultoria)\b/i
];

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ --';
}
function percentRate(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}
function signPayload(appId, timestamp, payload, secret) {
  return crypto.createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`).digest('hex');
}
async function shopeeRequest(query) {
  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) throw new Error('SHOPEE_APP_ID/SHOPEE_SECRET ainda não configurados.');
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
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.errors?.length) {
    throw new Error(`Shopee API: ${json.errors?.map(e => e.message).join('; ') || `HTTP ${response.status}`}`);
  }
  return json.data;
}
async function getProducts(keyword) {
  const safeKeyword = JSON.stringify(keyword);
  const query = `query { productOfferV2(keyword: ${safeKeyword}, listType: 0, sortType: 5, page: 1, limit: 50) { nodes { itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate sales ratingStar commissionRate commission shopId shopName shopType } pageInfo { page limit hasNextPage } } }`;
  const data = await shopeeRequest(query);
  return data.productOfferV2?.nodes || [];
}
function isDeal(item) {
  const discount = percentRate(item.priceDiscountRate);
  const title = String(item.productName || '').replace(/\s+/g, ' ').trim();
  return Boolean(item.offerLink && item.itemId && title && discount >= MIN_DISCOUNT && !blockedNonProductPatterns.some(rx => rx.test(title)));
}
function score(item) {
  const discount = percentRate(item.priceDiscountRate);
  const rating = Number(item.ratingStar || 0);
  const sales = Number(item.sales || 0);
  const commission = percentRate(item.commissionRate);
  const ratingBonus = rating > 0 ? Math.min(20, rating / 5 * 20) : 0;
  const salesBonus = sales > 0 ? Math.min(12, Math.log10(sales + 1) * 5) : 0;
  const commissionBonus = Math.min(8, commission * 0.5);
  return Math.max(0, Math.min(100, Math.round(Math.min(60, discount * 1.2) + ratingBonus + salesBonus + commissionBonus)));
}
function titleKey(title) {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(kit|promo|oferta|original|novo|imperdivel|frete gratis)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 10).join(' ');
}
function formatOffer(item) {
  const discount = Math.round(percentRate(item.priceDiscountRate));
  const commission = percentRate(item.commissionRate).toFixed(1);
  const subId = subIds.length ? `\n🏷️ Sub-ID: ${subIds.join('/')}` : '';
  return `🔥 ${item.productName}\n\n💰 ${money(item.priceMin)} | ${discount}% OFF\n⭐ ${Number(item.ratingStar || 0).toFixed(1)} | 🛒 ${Number(item.sales || 0)} vendas\n💵 Comissão estimada: ${commission}%${subId}\n\n🛒 COMPRAR AGORA:\n${item.offerLink}\n\n⚠️ Preço e estoque podem mudar sem aviso.`;
}
function buildMarkdown(offers, errors, stats) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const lines = [
    '# Ofertas Shopee', '',
    `Atualizado em: ${now}`, '',
    `Buscas: ${keywords.length} | ofertas encontradas: ${offers.length} | rejeitadas: ${stats.rejected} | duplicados: ${stats.duplicates}`,
    `Regra: qualquer desconto >= ${MIN_DISCOUNT}%. Não exige nota, vendas, preço ou comissão mínima.`, ''
  ];
  if (errors.length) lines.push('## Diagnóstico', '', ...errors.map(error => `- ${error}`), '');
  if (!offers.length) { lines.push('Nenhuma oferta encontrada com desconto no momento.'); return lines.join('\n'); }
  offers.forEach((offer, index) => lines.push(
    `## ${index + 1}. ${offer.productName}`, '',
    `- **Preço:** ${money(offer.priceMin)}`,
    `- **Desconto:** ${Math.round(percentRate(offer.priceDiscountRate))}%`,
    `- **Nota:** ${Number(offer.ratingStar || 0).toFixed(1)}`,
    `- **Vendas:** ${Number(offer.sales || 0)}`,
    `- **Comissão:** ${percentRate(offer.commissionRate).toFixed(1)}%`,
    `- **Palavra-chave:** ${offer.keyword}`,
    `- **Loja:** ${offer.shopName || '--'}`,
    `- **Pontuação de ordem:** ${offer.score}/100`,
    `- **Link afiliado:** ${offer.offerLink}`,
    '', '---', ''
  ));
  return lines.join('\n');
}

async function main() {
  console.log(`Iniciando feed Shopee: ${keywords.join(', ')}`);
  const errors = [];
  const candidates = [];
  const stats = { accepted: 0, rejected: 0, duplicates: 0 };

  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) {
    errors.push('SHOPEE_APP_ID/SHOPEE_SECRET ainda não configurados.');
  } else {
    for (const keyword of keywords) {
      try {
        const products = await getProducts(keyword);
        for (const product of products) {
          const item = { ...product, keyword };
          if (isDeal(item)) candidates.push({ ...item, score: score(item) });
          else stats.rejected++;
        }
      } catch (error) {
        errors.push(`Falha em ${keyword}: ${error.message}`);
        console.error(errors.at(-1));
      }
    }
  }

  stats.accepted = candidates.length;
  const unique = [];
  const seenIds = new Set();
  const seenTitles = new Set();
  for (const item of candidates.sort((a, b) => b.score - a.score || percentRate(b.priceDiscountRate) - percentRate(a.priceDiscountRate) || Number(b.sales || 0) - Number(a.sales || 0))) {
    const id = String(item.itemId);
    const key = titleKey(item.productName);
    if (seenIds.has(id) || (key && seenTitles.has(key))) { stats.duplicates++; continue; }
    seenIds.add(id);
    if (key) seenTitles.add(key);
    unique.push(item);
  }

  const selected = [];
  const keywordCount = new Map();
  const shopCount = new Map();
  for (const item of unique) {
    const keyword = String(item.keyword || '').toLowerCase();
    const shop = String(item.shopId || item.shopName || item.itemId);
    if ((keywordCount.get(keyword) || 0) >= MAX_PER_KEYWORD) continue;
    if ((shopCount.get(shop) || 0) >= MAX_PER_SHOP) continue;
    selected.push(item);
    keywordCount.set(keyword, (keywordCount.get(keyword) || 0) + 1);
    shopCount.set(shop, (shopCount.get(shop) || 0) + 1);
    if (selected.length >= MAX_OFFERS) break;
  }

  const report = buildMarkdown(selected, errors, stats);
  fs.writeFileSync('ofertas-shopee.md', report, 'utf8');
  fs.writeFileSync('ofertas-shopee.json', JSON.stringify({ generatedAt: new Date().toISOString(), authenticated: Boolean(env.SHOPEE_APP_ID && env.SHOPEE_SECRET), errors, stats, offers: selected }, null, 2), 'utf8');
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, report + '\n', 'utf8');
  console.log(`Shopee: ${selected.length} ofertas finais.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
