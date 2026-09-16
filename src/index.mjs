import crypto from 'node:crypto';
import fs from 'node:fs';

const API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';
const env = process.env;
const keywords = (env.KEYWORDS || 'celular,smart tv,notebook,ssd,memoria ram,monitor gamer,fone bluetooth,fone gamer,teclado mecanico,mouse gamer,placa de video,roteador wifi,power bank,ferramentas,impressora,air fryer,cafeteira,casa')
  .split(',').map(s => s.trim()).filter(Boolean);
const MIN_DISCOUNT = Number(env.MIN_DISCOUNT || 0);
const MIN_RATING = Number(env.MIN_RATING || 4.5);
const MIN_SALES = Number(env.MIN_SALES || 50);
const MAX_OFFERS = Number(env.MAX_OFFERS || 10);
const MAX_PER_KEYWORD = Number(env.SHOPEE_MAX_PER_KEYWORD || 3);
const MAX_PER_SHOP = Number(env.SHOPEE_MAX_PER_SHOP || 2);
const subIds = (env.SUB_ID || 'telegram,ofertas,tech').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

const keywordWeights = {
  celular: 1.25, 'smart tv': 1.2, notebook: 1.25, ssd: 1.2, 'memoria ram': 1.2,
  'monitor gamer': 1.2, 'fone bluetooth': 1.05, 'fone gamer': 1.05, 'teclado mecanico': 1.0,
  'mouse gamer': 1.0, 'placa de video': 1.2, 'roteador wifi': 1.0, 'power bank': 0.95,
  ferramentas: 1.0, impressora: 1.0, 'air fryer': 1.0, cafeteira: 0.9, casa: 0.8
};

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ --';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
  const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `SHA256 Credential=${env.SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}` }, body });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(`Shopee API: ${json.errors?.map(e => e.message).join('; ') || `HTTP ${response.status}`}`);
  return json.data;
}
async function getProducts(keyword) {
  const safeKeyword = JSON.stringify(keyword);
  const query = `query { productOfferV2(keyword: ${safeKeyword}, listType: 0, sortType: 5, page: 1, limit: 50) { nodes { itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate sales ratingStar commissionRate commission shopId shopName shopType } pageInfo { page limit hasNextPage } } }`;
  const data = await shopeeRequest(query);
  return data.productOfferV2?.nodes || [];
}
function score(p) {
  const discount = percentRate(p.priceDiscountRate);
  const rating = Number(p.ratingStar || 0);
  const sales = Number(p.sales || 0);
  const commission = percentRate(p.commissionRate);
  const demand = Math.min(Math.log10(sales + 1) * 10, 20);
  const relevance = keywordWeights[String(p.keyword || '').toLowerCase()] || 0.8;
  const price = Number(p.priceMin || 0);
  const commercial = price >= 50 ? 5 : price >= 20 ? 2 : 0;
  return Math.round(Math.min(60, discount) * 0.35 + Math.min(rating / 5 * 20, 20) * 0.15 + demand * 0.2 + Math.min(commission, 20) * 0.15 + commercial + relevance * 5);
}
function eligible(p) {
  return percentRate(p.priceDiscountRate) >= MIN_DISCOUNT && Number(p.ratingStar || 0) >= MIN_RATING && Number(p.sales || 0) >= MIN_SALES && p.offerLink;
}
function formatOffer(p) {
  const discount = Math.round(percentRate(p.priceDiscountRate));
  const commission = percentRate(p.commissionRate).toFixed(1);
  const price = money(p.priceMin);
  const subId = subIds.length ? `\n🏷️ Sub-ID: ${subIds.join('/')}` : '';
  return `🔥 ${p.productName}\n\n💰 ${price}  |  ${discount}% OFF\n⭐ ${Number(p.ratingStar || 0).toFixed(1)}  |  🛒 ${Number(p.sales || 0)} vendas\n💵 Comissão estimada: ${commission}%${subId}\n\n🛒 COMPRAR AGORA:\n${p.offerLink}\n\n⚠️ Preço e estoque podem mudar sem aviso.`;
}
function buildMarkdown(offers, errors, stats) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const lines = ['# Ofertas Shopee', '', `Atualizado em: ${now}`, '', `Buscas: ${keywords.length} palavras-chave | candidatos elegíveis: ${stats.eligible} | máximo final: ${MAX_OFFERS}`, `Filtros: ${MIN_DISCOUNT}% OFF | nota >= ${MIN_RATING} | vendas >= ${MIN_SALES}`, ''];
  if (errors.length) lines.push('## Diagnóstico', '', ...errors.map(error => `- ${error}`), '');
  if (!offers.length) { lines.push('Nenhuma oferta atingiu os filtros atuais.'); return lines.join('\n'); }
  offers.forEach((offer, index) => {
    lines.push(`## ${index + 1}. ${offer.productName}`, '', `- **Preço:** ${money(offer.priceMin)}`, `- **Desconto:** ${Math.round(percentRate(offer.priceDiscountRate))}%`, `- **Nota:** ${Number(offer.ratingStar || 0).toFixed(1)}`, `- **Vendas:** ${Number(offer.sales || 0)}`, `- **Comissão:** ${percentRate(offer.commissionRate).toFixed(1)}%`, `- **Palavra-chave:** ${offer.keyword}`, `- **Loja:** ${offer.shopName || '--'}`, `- **Pontuação:** ${offer.score}/100`, `- **Link afiliado:** ${offer.offerLink}`, '', '**Mensagem pronta:**', '', '```text', formatOffer(offer), '```', '', '---', '');
  });
  return lines.join('\n');
}
async function publishTelegram(text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: false }) });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  return true;
}
async function main() {
  console.log(`Iniciando busca Shopee: ${keywords.join(', ')}`);
  const errors = [];
  const all = [];
  const stats = { keywords: keywords.length, eligible: 0 };
  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) errors.push('SHOPEE_APP_ID/SHOPEE_SECRET ainda não configurados.');
  if (env.SHOPEE_APP_ID && env.SHOPEE_SECRET) {
    for (const keyword of keywords) {
      try {
        const products = await getProducts(keyword);
        for (const p of products) if (eligible(p)) all.push({ ...p, keyword, score: score({ ...p, keyword }) });
      } catch (error) { errors.push(`Falha em ${keyword}: ${error.message}`); console.error(errors.at(-1)); }
    }
  }
  stats.eligible = all.length;
  const unique = [...new Map(all.map(p => [String(p.itemId), p])).values()].sort((a, b) => b.score - a.score || percentRate(b.priceDiscountRate) - percentRate(a.priceDiscountRate));
  const selected = [];
  const keywordCount = new Map();
  const shopCount = new Map();
  for (const item of unique) {
    const k = String(item.keyword || '').toLowerCase();
    const shop = String(item.shopId || item.shopName || item.itemId);
    if ((keywordCount.get(k) || 0) >= MAX_PER_KEYWORD) continue;
    if ((shopCount.get(shop) || 0) >= MAX_PER_SHOP) continue;
    selected.push(item);
    keywordCount.set(k, (keywordCount.get(k) || 0) + 1);
    shopCount.set(shop, (shopCount.get(shop) || 0) + 1);
    if (selected.length >= MAX_OFFERS) break;
  }
  console.log(`Candidatos elegíveis: ${all.length}`);
  console.log(`Ofertas finais diversificadas: ${selected.length}`);
  for (const p of selected) console.log(`\n${formatOffer(p)}`);
  fs.writeFileSync('ofertas-shopee.md', buildMarkdown(selected, errors, stats), 'utf8');
  fs.writeFileSync('ofertas-shopee.json', JSON.stringify({ generatedAt: new Date().toISOString(), authenticated: Boolean(env.SHOPEE_APP_ID && env.SHOPEE_SECRET), errors, stats, offers: selected }, null, 2), 'utf8');
  if (env.GITHUB_STEP_SUMMARY) {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const summary = [`# 🛍️ Ofertas Shopee`, '', `Atualizado em: ${now}`, '', `**${stats.eligible} candidatos elegíveis** → **${selected.length} ofertas finais diversificadas**.`, ''];
    for (const [index, offer] of selected.entries()) summary.push(`## ${index + 1}. ${offer.productName}`, `- 💰 **Preço:** ${money(offer.priceMin)} — **${Math.round(percentRate(offer.priceDiscountRate))}% OFF**`, `- ⭐ **Nota:** ${Number(offer.ratingStar || 0).toFixed(1)} | 🛒 **Vendas:** ${Number(offer.sales || 0)}`, `- 💵 **Comissão:** ${percentRate(offer.commissionRate).toFixed(1)}% | 🔎 **Busca:** ${offer.keyword}`, `- 🛒 [Abrir oferta](${offer.offerLink})`, '');
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n', 'utf8');
  }
  if (selected.length && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) await publishTelegram(formatOffer(selected[0]));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
