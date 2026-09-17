import fs from 'node:fs';

const env = process.env;
const TOKEN = env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = env.TELEGRAM_CHAT_ID || '';
const REPO = env.GITHUB_REPOSITORY || '';
const REF = env.GITHUB_REF_NAME || 'main';
const GH_TOKEN = env.GITHUB_TOKEN || '';
const STATE_PATH = 'data/telegram-sent.json';
const MAX_SEND = Number(env.TELEGRAM_MAX_SEND || 5);
const STATE_LIMIT = Number(env.TELEGRAM_STATE_LIMIT || 2000);
const STATE_TTL_DAYS = Number(env.TELEGRAM_STATE_TTL_DAYS || 14);

if (!TOKEN || !CHAT_ID) {
  console.log('Telegram não configurado. Nenhuma mensagem será enviada.');
  process.exit(0);
}

function readJson(path) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return null; }
}
function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ --';
}
function telegramText(source, offer) {
  const title = offer.title || offer.productName || 'Oferta';
  const price = money(offer.price ?? offer.priceMin);
  const discount = Number(offer.discount ?? offer.priceDiscountRate ?? 0);
  const coupon = offer.couponCode ? `\n🎟️ Cupom: ${offer.couponCode}` : '';
  const couponPct = offer.couponPercentage ? `\n🎟️ Cupom: ${offer.couponPercentage}% OFF` : '';
  const couponAmount = offer.couponAmount ? `\n🎟️ Cupom: ${money(offer.couponAmount)} OFF` : '';
  const link = offer.offerLink || offer.permalink || offer.affiliateTrackingUrl || offer.urlTracking || '';
  const oldPrice = offer.originalPrice ? `\n🏷️ De: ${money(offer.originalPrice)}` : '';
  return `🔥 ${source} — OFERTA\n\n${title}\n\n💰 ${oldPrice ? oldPrice + '\n' : ''}Por ${price}${discount > 0 ? ` | ${Math.round(discount)}% OFF` : ''}${coupon}${couponPct}${couponAmount}\n\n🛒 COMPRAR AGORA:\n${link}\n\n⚠️ Preço, estoque e promoção podem mudar sem aviso.`;
}
async function telegramSend(text) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: false })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(`Telegram HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
}
async function loadState() {
  const local = readJson(STATE_PATH);
  if (local?.sent) return local;
  if (REPO && GH_TOKEN) {
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${STATE_PATH}?ref=${encodeURIComponent(REF)}`, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
      if (response.ok) {
        const data = await response.json();
        const content = Buffer.from(data.content || '', 'base64').toString('utf8');
        return { ...(JSON.parse(content) || {}), _sha: data.sha };
      }
    } catch {}
  }
  return { version: 1, sent: {} };
}
function prune(state) {
  const cutoff = Date.now() - STATE_TTL_DAYS * 86400000;
  const entries = Object.entries(state.sent || {}).filter(([, value]) => Number(value) >= cutoff).sort((a, b) => Number(b[1]) - Number(a[1]));
  state.sent = Object.fromEntries(entries.slice(0, STATE_LIMIT));
  delete state._sha;
  return state;
}
async function saveState(state, sha = null) {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
  if (!REPO || !GH_TOKEN) return;
  const content = Buffer.from(fs.readFileSync(STATE_PATH)).toString('base64');
  const url = `https://api.github.com/repos/${REPO}/contents/${STATE_PATH}`;
  const body = { message: 'Atualizar estado de ofertas enviadas', content, branch: REF };
  if (sha) body.sha = sha;
  const response = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) console.log(`Aviso: não foi possível salvar estado no GitHub (${response.status}).`);
}
function collectOffers() {
  const result = [];
  const shopee = readJson('ofertas-shopee.json');
  for (const offer of shopee?.offers || []) result.push({ source: 'Shopee', id: `shopee:${offer.itemId}:${Math.round(Number(offer.priceDiscountRate || 0))}`, offer });
  const amazonAwin = readJson('ofertas-amazon-awin.json');
  for (const offer of amazonAwin?.amazon?.offers || []) {
    if (offer.permalink) result.push({ source: 'Amazon', id: `amazon:${offer.asin}:${Math.round(Number(offer.discount || 0))}`, offer });
  }
  for (const offer of amazonAwin?.awin?.offers || []) {
    const link = offer.affiliateTrackingUrl || offer.urlTracking;
    if (link) result.push({ source: `Awin — ${offer.advertiser?.name || 'Programa'}`, id: `awin:${offer.id || offer.title || link}`, offer: { ...offer, affiliateTrackingUrl: link } });
  }
  return result;
}

const state = prune(await loadState());
const candidates = collectOffers();
const pending = candidates.filter(item => !state.sent[item.id]).slice(0, MAX_SEND);
console.log(`Ofertas encontradas para envio: ${candidates.length}; novas: ${pending.length}.`);

for (const item of pending) {
  try {
    await telegramSend(telegramText(item.source, item.offer));
    state.sent[item.id] = Date.now();
    console.log(`Enviada: ${item.id}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    console.error(`Falha ao enviar ${item.id}: ${error.message}`);
  }
}

await saveState(prune(state), state._sha || null);
