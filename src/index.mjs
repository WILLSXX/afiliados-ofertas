import crypto from 'node:crypto';
import fs from 'node:fs';

const API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';
const env = process.env;
const keywords = (env.KEYWORDS || 'celular,smart tv,notebook,ssd,memoria ram,monitor gamer,fone bluetooth,fone gamer,teclado mecanico,mouse gamer,placa de video,roteador wifi,power bank,ferramentas,impressora,air fryer,cafeteira,aspirador')
  .split(',').map(s => s.trim()).filter(Boolean);
const MIN_DISCOUNT = Number(env.MIN_DISCOUNT || 15);
const MIN_RATING = Number(env.MIN_RATING || 4.6);
const MIN_SALES = Number(env.MIN_SALES || 150);
const MIN_PRICE = Number(env.MIN_PRICE || 49.9);
const MIN_SCORE = Number(env.MIN_SCORE || 72);
const MIN_COMMISSION = Number(env.MIN_COMMISSION || 3);
const MAX_OFFERS = Number(env.MAX_OFFERS || 10);
const MAX_PER_KEYWORD = Number(env.SHOPEE_MAX_PER_KEYWORD || 2);
const MAX_PER_SHOP = Number(env.SHOPEE_MAX_PER_SHOP || 1);
const subIds = (env.SUB_ID || 'telegram,ofertas,tech').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

const keywordWeights = {
  celular: 1.35, 'smart tv': 1.3, notebook: 1.35, ssd: 1.3, 'memoria ram': 1.25,
  'monitor gamer': 1.2, 'fone bluetooth': 1.05, 'fone gamer': 1.1, 'teclado mecanico': 1.05,
  'mouse gamer': 1.0, 'placa de video': 1.3, 'roteador wifi': 1.0, 'power bank': 0.95,
  ferramentas: 1.0, impressora: 1.05, 'air fryer': 1.0, cafeteira: 0.95, aspirador: 1.0
};

const requiredPatterns = {
  celular: /\b(celular|smartphone|iphone|galaxy|redmi|poco|motorola|moto\s?[a-z0-9]+)/i,
  'smart tv': /\b(smart\s*tv|televis[aã]o|tv)\b/i,
  notebook: /\b(notebook|laptop)\b/i,
  ssd: /\b(ssd|nvme|sata)\b/i,
  'memoria ram': /\b(mem[óo]ria\s*(ram)?|ddr[2345])\b/i,
  'monitor gamer': /\bmonitor\b/i,
  'fone bluetooth': /\b(fone|earbuds?|headset)\b/i,
  'fone gamer': /\b(fone|headset|gaming)\b/i,
  'teclado mecanico': /\bteclado\b/i,
  'mouse gamer': /\bmouse\b/i,
  'placa de video': /\b(placa\s+de\s+v[ií]deo|rtx|gtx|radeon|geforce|rx\s?\d+)\b/i,
  'roteador wifi': /\b(roteador|mesh|wi-?fi)\b/i,
  'power bank': /\b(power\s*bank|carregador\s+port[aá]til|bateria\s+externa)\b/i,
  ferramentas: /\b(furadeira|parafusadeira|esmerilhadeira|serra|mult[ií]metro|ferramenta|kit\s+ferramentas)\b/i,
  impressora: /\b(impressora|multifuncional)\b/i,
  'air fryer': /\b(air\s*fryer|fritadeira)\b/i,
  cafeteira: /\b(cafeteira|espresso|expresso)\b/i,
  aspirador: /\b(aspirador|rob[oô]\s+aspirador)\b/i
};

const blockedTitlePatterns = [
  /\b(est[aá]tua|boneco|brinquedo|enfeite|decora[cç][aã]o|chaveiro|adesivo|lembrancinha)\b/i,
  /\b(capa|pel[ií]cula|case|suporte|adaptador|cabo|hub usb|carregador)\b/i,
  /\b(refil|cartucho|toner|reposi[cç][aã]o|pe[cç]a de reposi[cç][aã]o|somente a pe[cç]a)\b/i,
  /\b(compat[ií]vel|para iphone|para celular|para notebook|para roteador|para tv)\b/i,
  /\b(adesivo|pel[uú]cia|fantasia|miniatura|organizador|porta[- ]?celular)\b/i,
  /\bkit\s+\d{2,}\b/i
];

const secondaryAccessoryPatterns = [
  /\b(suporte|adaptador|case|capa|hub|cabo|pel[ií]cula|mousepad|apoio)\b/i
];

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
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `SHA256 Credential=${env.SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}`
    },
    body
  });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(`Shopee API: ${json.errors?.map(e => e.message).join('; ') || `HTTP ${response.status}`}`);
  return json.data;
}
async function getProducts(keyword) {
  const safeKeyword = JSON.stringify(keyword);
  const query = `query { productOfferV2(keyword: ${safeKeyword}, listType: 0, sortType: 5, page: 1, limit: 60) { nodes { itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate sales ratingStar commissionRate commission shopId shopName shopType } pageInfo { page limit hasNextPage } } }`;
  const data = await shopeeRequest(query);
  return data.productOfferV2?.nodes || [];
}
function titleQuality(p) {
  const title = String(p.productName || '').trim();
  const keyword = String(p.keyword || '').toLowerCase();
  if (title.length < 20) return -4;
  if (blockedTitlePatterns.some(rx => rx.test(title))) return -35;
  const required = requiredPatterns[keyword];
  if (required && !required.test(title)) return -18;
  let bonus = 0;
  if (required?.test(title)) bonus += 10;
  if (/\b\d+(?:gb|tb|mb|w|hz|mah|wh|mm|pol|polegadas|kg|l)\b/i.test(title)) bonus += 6;
  if (/\b(samsung|apple|xiaomi|motorola|kingston|sandisk|corsair|logitech|razer|intel|amd|nvidia|philips|lg|electrolux|mondial|epson|canon|hp|acer|lenovo|asus|dell|tcl|jbl|edifier|wd|seagate)\b/i.test(title)) bonus += 6;
  if (secondaryAccessoryPatterns.some(rx => rx.test(title))) bonus -= 8;
  return bonus;
}
function score(p) {
  const discount = Math.min(percentRate(p.priceDiscountRate), 50);
  const rating = Number(p.ratingStar || 0);
  const sales = Number(p.sales || 0);
  const commission = percentRate(p.commissionRate);
  const price = Number(p.priceMin || 0);
  const demand = Math.min(Math.log10(sales + 1) * 5, 12);
  const ratingBonus = Math.max(0, Math.min(15, rating / 5 * 15));
  const commissionBonus = Math.min(10, commission * 0.65);
  const commercial = price >= 100 ? 6 : price >= 70 ? 5 : 3;
  return Math.max(0, Math.min(100, Math.round(
    Math.min(42, discount * 0.95) + ratingBonus + demand + commissionBonus + commercial + keywordWeights[String(p.keyword || '').toLowerCase()] * 4 + titleQuality(p)
  )));
}
function eligible(p) {
  const discount = percentRate(p.priceDiscountRate);
  const rating = Number(p.ratingStar || 0);
  const sales = Number(p.sales || 0);
  const price = Number(p.priceMin || 0);
  const commission = percentRate(p.commissionRate);
  const title = String(p.productName || '').trim();
  if (!p.offerLink || !p.itemId || !title) return false;
  if (discount < MIN_DISCOUNT || rating < MIN_RATING || sales < MIN_SALES) return false;
  if (price < MIN_PRICE || commission < MIN_COMMISSION) return false;
  if (blockedTitlePatterns.some(rx => rx.test(title))) return false;
  const keyword = String(p.keyword || '').toLowerCase();
  if (requiredPatterns[keyword] && !requiredPatterns[keyword].test(title)) return false;
  return score(p) >= MIN_SCORE;
}
function titleKey(title) {
  return String(title || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(kit|promo|oferta|original|novo|imperdivel|frete gratis)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').slice(0, 9).join(' ');
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
  const lines = ['# Ofertas Shopee', '', `Atualizado em: ${now}`, '', `Buscas: ${keywords.length} | candidatos aceitos: ${stats.accepted} | rejeitados: ${stats.rejectedQuality} | duplicados removidos: ${stats.duplicates} | máximo final: ${MAX_OFFERS}`, `Filtros: ${MIN_DISCOUNT}% OFF | nota >= ${MIN_RATING} | vendas >= ${MIN_SALES} | preço >= ${money(MIN_PRICE)} | comissão >= ${MIN_COMMISSION}% | score >= ${MIN_SCORE} | 1 oferta por loja`, ''];
  if (errors.length) lines.push('## Diagnóstico', '', ...errors.map(error => `- ${error}`), '');
  if (!offers.length) { lines.push('Nenhuma oferta atingiu os filtros atuais.'); return lines.join('\n'); }
  offers.forEach((offer, index) => {
    lines.push(`## ${index + 1}. ${offer.productName}`, '', `- **Preço:** ${money(offer.priceMin)}`, `- **Desconto:** ${Math.round(percentRate(offer.priceDiscountRate))}%`, `- **Nota:** ${Number(offer.ratingStar || 0).toFixed(1)}`, `- **Vendas:** ${Number(offer.sales || 0)}`, `- **Comissão:** ${percentRate(offer.commissionRate).toFixed(1)}%`, `- **Palavra-chave:** ${offer.keyword}`, `- **Loja:** ${offer.shopName || '--'}`, `- **Pontuação de qualidade:** ${offer.score}/100`, `- **Link afiliado:** ${offer.offerLink}`, '', '**Mensagem pronta:**', '', '```text', formatOffer(offer), '```', '', '---', '');
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
  const stats = { keywords: keywords.length, accepted: 0, rejectedQuality: 0, duplicates: 0 };
  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) errors.push('SHOPEE_APP_ID/SHOPEE_SECRET ainda não configurados.');
  if (env.SHOPEE_APP_ID && env.SHOPEE_SECRET) {
    for (const keyword of keywords) {
      try {
        const products = await getProducts(keyword);
        for (const p of products) {
          const candidate = { ...p, keyword };
          if (eligible(candidate)) all.push({ ...candidate, score: score(candidate) });
          else stats.rejectedQuality++;
        }
      } catch (error) {
        errors.push(`Falha em ${keyword}: ${error.message}`);
        console.error(errors.at(-1));
      }
    }
  }
  stats.accepted = all.length;
  const unique = [];
  const seenIds = new Set();
  const seenTitles = new Set();
  for (const item of [...all].sort((a, b) => b.score - a.score || percentRate(b.priceDiscountRate) - percentRate(a.priceDiscountRate) || Number(b.sales || 0) - Number(a.sales || 0))) {
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
    const k = String(item.keyword || '').toLowerCase();
    const shop = String(item.shopId || item.shopName || item.itemId);
    if ((keywordCount.get(k) || 0) >= MAX_PER_KEYWORD) continue;
    if ((shopCount.get(shop) || 0) >= MAX_PER_SHOP) continue;
    selected.push(item);
    keywordCount.set(k, (keywordCount.get(k) || 0) + 1);
    shopCount.set(shop, (shopCount.get(shop) || 0) + 1);
    if (selected.length >= MAX_OFFERS) break;
  }
  console.log(`Candidatos aceitos por qualidade: ${all.length}`);
  console.log(`Duplicados/similares removidos: ${stats.duplicates}`);
  console.log(`Ofertas finais diversificadas: ${selected.length}`);
  for (const p of selected) console.log(`\n${formatOffer(p)}`);
  fs.writeFileSync('ofertas-shopee.md', buildMarkdown(selected, errors, stats), 'utf8');
  fs.writeFileSync('ofertas-shopee.json', JSON.stringify({ generatedAt: new Date().toISOString(), authenticated: Boolean(env.SHOPEE_APP_ID && env.SHOPEE_SECRET), errors, stats, offers: selected }, null, 2), 'utf8');
  if (env.GITHUB_STEP_SUMMARY) {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const summary = [`# 🛍️ Ofertas Shopee`, '', `Atualizado em: ${now}`, '', `**${stats.accepted} candidatos aceitos** → **${selected.length} ofertas finais após filtros de qualidade e diversidade**.`, `**Filtros:** ${MIN_DISCOUNT}% OFF | nota >= ${MIN_RATING} | vendas >= ${MIN_SALES} | preço >= ${money(MIN_PRICE)} | comissão >= ${MIN_COMMISSION}% | score >= ${MIN_SCORE}.`, ''];
    for (const [index, offer] of selected.entries()) summary.push(`## ${index + 1}. ${offer.productName}`, `- 💰 **Preço:** ${money(offer.priceMin)} — **${Math.round(percentRate(offer.priceDiscountRate))}% OFF**`, `- ⭐ **Nota:** ${Number(offer.ratingStar || 0).toFixed(1)} | 🛒 **Vendas:** ${Number(offer.sales || 0)}`, `- 💵 **Comissão:** ${percentRate(offer.commissionRate).toFixed(1)}% | 🔎 **Busca:** ${offer.keyword}`, `- 📊 **Qualidade:** ${offer.score}/100`, `- 🛒 [Abrir oferta](${offer.offerLink})`, '');
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n', 'utf8');
  }
  if (selected.length && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) await publishTelegram(formatOffer(selected[0]));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
