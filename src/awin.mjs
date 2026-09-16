const env = process.env;
const API_URL = 'https://api.awin.com';
const TOKEN = env.AWIN_API_TOKEN || '';
const PUBLISHER_ID = env.AWIN_PUBLISHER_ID || '';
const countryCode = (env.AWIN_COUNTRY_CODE || 'BR').toUpperCase();

async function awinGet(path) {
  if (!TOKEN) throw new Error('AWIN_API_TOKEN ainda não configurado.');
  const response = await fetch(`${API_URL}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Awin HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}
async function awinPost(path, body) {
  if (!TOKEN) throw new Error('AWIN_API_TOKEN ainda não configurado.');
  const response = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Awin HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}
export async function getPublisherInfo() {
  if (!TOKEN) return { configured: false, publishers: [], errors: ['AWIN_API_TOKEN ainda não configurado.'] };
  try {
    const data = await awinGet('/accounts?type=publisher');
    const publishers = Array.isArray(data) ? data : (data.accounts ?? data.publisher ?? data.publishers ?? []);
    return { configured: true, publishers, errors: [] };
  } catch (error) { return { configured: false, publishers: [], errors: [error.message] }; }
}
function resolvePublisherId(publishers) {
  if (PUBLISHER_ID) return PUBLISHER_ID;
  const publisher = publishers.find(p => String(p.accountType || '').toLowerCase() === 'publisher') || publishers[0];
  return publisher?.accountId ? String(publisher.accountId) : '';
}
export async function getProgrammes(publisherId) {
  if (!publisherId) throw new Error('AWIN_PUBLISHER_ID não encontrado.');
  return awinGet(`/publishers/${encodeURIComponent(publisherId)}/programmes?countryCode=${encodeURIComponent(countryCode)}`);
}
async function getPromotionPage(publisherId, { membership = 'joined', status = 'active', region = true, type = 'all', page = 1 } = {}) {
  const filters = { membership, status, type };
  if (region) filters.regionCodes = [countryCode];
  return awinPost(`/publisher/${encodeURIComponent(publisherId)}/promotions`, { filters, pagination: { page, pageSize: 200 } });
}
function unwrapOffers(data) {
  return Array.isArray(data) ? data : (data?.offers ?? data?.promotions ?? []);
}
function offerKey(offer) {
  return String(offer?.promotionId ?? offer?.id ?? `${offer?.advertiser?.id ?? ''}:${offer?.title ?? ''}:${offer?.startDate ?? ''}`);
}
export async function getOffers(publisherId) {
  if (!publisherId) throw new Error('AWIN_PUBLISHER_ID não encontrado.');
  const errors = [];
  const checks = [
    { label: 'joined-BR-active', membership: 'joined', status: 'active', region: true },
    { label: 'joined-BR-expiring', membership: 'joined', status: 'expiringSoon', region: true },
    { label: 'all-BR-active', membership: 'all', status: 'active', region: true },
    { label: 'all-BR-expiring', membership: 'all', status: 'expiringSoon', region: true },
    { label: 'joined-global-active', membership: 'joined', status: 'active', region: false }
  ];
  const offers = [];
  const seen = new Set();
  for (const check of checks) {
    try {
      const page = await getPromotionPage(publisherId, check);
      for (const offer of unwrapOffers(page)) {
        const key = offerKey(offer);
        if (seen.has(key)) continue;
        seen.add(key);
        offers.push({ ...offer, _query: check.label, joined: Boolean(offer?.advertiser?.joined) });
      }
    } catch (error) { errors.push(`Awin ${check.label}: ${error.message}`); }
  }
  return { offers, errors, checks };
}
export async function discoverAwin() {
  if (!TOKEN) return { authenticated: false, publisherId: null, publishers: [], programmes: [], offers: [], errors: ['Awin API ainda não configurada.'] };
  const errors = [];
  const publisher = await getPublisherInfo();
  if (publisher.errors.length) return { authenticated: false, publisherId: null, publishers: [], programmes: [], offers: [], errors: publisher.errors };
  const publisherId = resolvePublisherId(publisher.publishers);
  if (!publisherId) return { authenticated: true, publisherId: null, publishers: publisher.publishers, programmes: [], offers: [], errors: ['Não foi possível identificar o Publisher ID.'] };
  let programmes = [];
  try { programmes = await getProgrammes(publisherId); } catch (error) { errors.push(`Awin programas: ${error.message}`); }
  let offerResult = { offers: [], errors: [] };
  try { offerResult = await getOffers(publisherId); } catch (error) { errors.push(`Awin ofertas: ${error.message}`); }
  errors.push(...offerResult.errors);
  const normalizedProgrammes = Array.isArray(programmes) ? programmes : (programmes?.programmes ?? []);
  const normalizedOffers = offerResult.offers;
  const joinedProgrammes = normalizedProgrammes.filter(p => {
    const status = String(p?.membership?.status ?? p?.status ?? p?.relationship ?? '').toLowerCase();
    return Boolean(p?.joined || p?.membership?.joined || ['joined','active'].includes(status));
  }).length;
  return {
    authenticated: true,
    publisherId,
    publishers: publisher.publishers,
    programmes: normalizedProgrammes,
    joinedProgrammes,
    offers: normalizedOffers,
    joinedOffers: normalizedOffers.filter(o => o.joined),
    voucherOffers: normalizedOffers.filter(o => String(o?.type || '').toLowerCase() === 'voucher'),
    promotionOffers: normalizedOffers.filter(o => String(o?.type || '').toLowerCase() === 'promotion'),
    errors,
    diagnostics: { queries: offerResult.checks, totalOffers: normalizedOffers.length, joinedOffers: normalizedOffers.filter(o => o.joined).length }
  };
}
