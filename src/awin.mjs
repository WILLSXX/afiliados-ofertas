const env = process.env;
const API_URL = 'https://api.awin.com';
const TOKEN = env.AWIN_API_TOKEN || '';
const PUBLISHER_ID = env.AWIN_PUBLISHER_ID || '';
const countryCode = env.AWIN_COUNTRY_CODE || 'BR';

async function awinGet(path) {
  if (!TOKEN) throw new Error('AWIN_API_TOKEN ainda não configurado.');
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Awin HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function awinPost(path, body) {
  if (!TOKEN) throw new Error('AWIN_API_TOKEN ainda não configurado.');
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`
    },
    body: JSON.stringify(body)
  });
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
  } catch (error) {
    return { configured: false, publishers: [], errors: [error.message] };
  }
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

export async function getOffers(publisherId) {
  if (!publisherId) throw new Error('AWIN_PUBLISHER_ID não encontrado.');
  return awinPost(`/publisher/${encodeURIComponent(publisherId)}/promotions`, {
    filters: {
      membership: 'all',
      regionCodes: [countryCode],
      status: 'active',
      type: 'all'
    },
    pagination: {
      page: 1,
      pageSize: 200
    }
  });
}

export async function discoverAwin() {
  if (!TOKEN) return { authenticated: false, publisherId: null, publishers: [], programmes: [], offers: [], errors: ['Awin API ainda não configurada.'] };
  const errors = [];
  const publisher = await getPublisherInfo();
  if (publisher.errors.length) return { authenticated: false, publisherId: null, publishers: [], programmes: [], offers: [], errors: publisher.errors };

  const publisherId = resolvePublisherId(publisher.publishers);
  if (!publisherId) return { authenticated: true, publisherId: null, publishers: publisher.publishers, programmes: [], offers: [], errors: ['Não foi possível identificar o Publisher ID.'] };

  let programmes = [];
  let offers = [];
  try { programmes = await getProgrammes(publisherId); } catch (error) { errors.push(`Awin programas: ${error.message}`); }
  try { offers = await getOffers(publisherId); } catch (error) { errors.push(`Awin ofertas: ${error.message}`); }

  return {
    authenticated: true,
    publisherId,
    publishers: publisher.publishers,
    programmes: Array.isArray(programmes) ? programmes : (programmes?.programmes ?? []),
    offers: Array.isArray(offers) ? offers : (offers?.offers ?? offers?.promotions ?? []),
    errors
  };
}
