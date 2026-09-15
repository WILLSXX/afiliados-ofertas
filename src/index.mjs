import crypto from 'node:crypto';
import fs from 'node:fs';

const API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

const env = process.env;
const keywords = (env.KEYWORDS || 'ssd,memoria ram,monitor gamer,fone bluetooth,roteador').split(',').map(s => s.trim()).filter(Boolean);
const MIN_DISCOUNT = Number(env.MIN_DISCOUNT || 0);
const MIN_RATING = Number(env.MIN_RATING || 4.5);
const MIN_SALES = Number(env.MIN_SALES || 50);
const MAX_OFFERS = Number(env.MAX_OFFERS || 5);
const subIds = (env.SUB_ID || 'telegram,ofertas,tech').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);

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
  const discount = percentRate(p.priceDiscountRate);
  const rating = Number(p.ratingStar || 0);
  const sales = Number(p.sales || 0);
  const commission = percentRate(p.commissionRate);
  return Math.round(Math.min(discount, 60) * 0.45 + Math.min(rating / 5 * 20, 20) * 0.2 + Math.min(Math.log10(sales + 1) * 10, 20) * 0.15 + Math.min(commission, 20) * 0.2);
}

function eligible(p) {
  const discount = percentRate(p.priceDiscountRate);
  const rating = Number(p.ratingStar || 0);
  const sales = Number(p.sales || 0);
  return discount >= MIN_DISCOUNT && rating >= MIN_RATING && sales >= MIN_SALES && p.offerLink;
}

function formatOffer(p) {
  const discount = Math.round(percentRate(p.priceDiscountRate));
  const commission = percentRate(p.commissionRate).toFixed(1);
  const price = money(p.priceMin);
  const subId = subIds.length ? `\n🏷️ Sub-ID: ${subIds.join('/')}` : '';
  return `🔥 ${p.productName}\n\n💰 ${price}  |  ${discount}% OFF\n⭐ ${Number(p.ratingStar || 0).toFixed(1)}  |  🛒 ${Number(p.sales || 0)} vendas\n💵 Comissão estimada: ${commission}%${subId}\n\n🛒 COMPRAR AGORA:\n${p.offerLink}\n\n⚠️ Preço e estoque podem mudar sem aviso.`;
}

function buildMarkdown(offers, errors) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const lines = [
    '# Ofertas Shopee',
    '',
    `Atualizado em: ${now}`,
    '',
    `Filtros: ${MIN_DISCOUNT}% OFF | nota >= ${MIN_RATING} | vendas >= ${MIN_SALES} | máximo ${MAX_OFFERS}`,
    ''
  ];

  if (errors.length) {
    lines.push('## Diagnóstico', '', ...errors.map(error => `- ${error}`), '');
  }

  if (!offers.length) {
    lines.push(env.SHOPEE_APP_ID && env.SHOPEE_SECRET ? 'Nenhuma oferta atingiu os filtros atuais.' : 'Credenciais Shopee ainda não configuradas.');
    return lines.join('\n');
  }

  offers.forEach((offer, index) => {
    lines.push(`## ${index + 1}. ${offer.productName}`);
    lines.push('');
    lines.push(`- **Preço:** ${money(offer.priceMin)}`);
    lines.push(`- **Desconto:** ${Math.round(percentRate(offer.priceDiscountRate))}%`);
    lines.push(`- **Nota:** ${Number(offer.ratingStar || 0).toFixed(1)}`);
    lines.push(`- **Vendas:** ${Number(offer.sales || 0)}`);
    lines.push(`- **Comissão:** ${percentRate(offer.commissionRate).toFixed(1)}%`);
    lines.push(`- **Pontuação:** ${offer.score}/100`);
    lines.push(`- **Link afiliado:** ${offer.offerLink}`);
    lines.push('');
    lines.push('**Mensagem pronta:**', '', '```text', formatOffer(offer), '```', '', '---', '');
  });

  return lines.join('\n');
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
  const errors = [];

  if (!env.SHOPEE_APP_ID || !env.SHOPEE_SECRET) {
    const message = 'SHOPEE_APP_ID/SHOPEE_SECRET ainda não configurados.';
    errors.push(message);
    console.log('MODO CONFIGURAÇÃO: credenciais Shopee ainda não configuradas.');
    console.log('Quando a Shopee liberar App ID + Secret, basta adicioná-los aos Secrets do GitHub.');
  }

  const all = [];
  if (env.SHOPEE_APP_ID && env.SHOPEE_SECRET) {
    for (const keyword of keywords) {
      try {
        const products = await getProducts(keyword);
        for (const p of products) if (eligible(p)) all.push({ ...p, keyword, score: score(p) });
      } catch (error) {
        const message = `Falha em ${keyword}: ${error.message}`;
        errors.push(message);
        console.error(message);
      }
    }
  }

  const unique = [...new Map(all.map(p => [String(p.itemId), p])).values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OFFERS);

  console.log(`Ofertas elegíveis: ${unique.length}`);
  for (const p of unique) console.log(`\n${formatOffer(p)}`);

  fs.writeFileSync('ofertas-shopee.md', buildMarkdown(unique, errors), 'utf8');
  fs.writeFileSync('ofertas-shopee.json', JSON.stringify({ generatedAt: new Date().toISOString(), authenticated: Boolean(env.SHOPEE_APP_ID && env.SHOPEE_SECRET), errors, offers: unique }, null, 2), 'utf8');

  const summary = env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const summaryLines = [
      '# 🛍️ Ofertas Shopee',
      '',
      `Atualizado em: ${now}`,
      '',
      `**Status da API:** ${env.SHOPEE_APP_ID && env.SHOPEE_SECRET ? 'CONFIGURADA' : 'AGUARDANDO CREDENCIAIS'}`,
      '',
      unique.length ? `**${unique.length} ofertas elegíveis.**` : '**Nenhuma oferta elegível nesta execução.**',
      ''
    ];
    if (errors.length) {
      summaryLines.push('## Diagnóstico');
      for (const error of errors) summaryLines.push(`- ${error}`);
      summaryLines.push('');
    }
    for (const [index, offer] of unique.entries()) {
      summaryLines.push(`## ${index + 1}. ${offer.productName}`);
      summaryLines.push(`- 💰 **Preço:** ${money(offer.priceMin)} — **${Math.round(percentRate(offer.priceDiscountRate))}% OFF**`);
      summaryLines.push(`- ⭐ **Nota:** ${Number(offer.ratingStar || 0).toFixed(1)} | 🛒 **Vendas:** ${Number(offer.sales || 0)}`);
      summaryLines.push(`- 💵 **Comissão estimada:** ${percentRate(offer.commissionRate).toFixed(1)}%`);
      summaryLines.push(`- 🛒 [Abrir oferta](${offer.offerLink})`);
      summaryLines.push('');
    }
    fs.appendFileSync(summary, summaryLines.join('\n') + '\n', 'utf8');
  }

  if (unique.length && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    await publishTelegram(formatOffer(unique[0]));
    console.log('Oferta principal publicada no Telegram.');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
