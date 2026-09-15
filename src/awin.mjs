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

export async function getPublisherInfo() {
  if (!TOKEN) return { configured: false, publishers: [], errors: ['AWIN_API_TOKEN ainda não configurado.'] };
  try {
    const data = await awinGet('/publishers');
    return { configured: true, publishers: Array.isArray(data) ? data : (data.publisher ?? data.publishers ?? []), errors: [] };
  } catch (error) {
    return { configured: false, publishers: [], errors: [error.message] };
  }
}

export async function getProgrammes() {
  if (!PUBLISHER_ID) throw new Error('AWIN_PUBLISHER_ID ainda não configurado.');
  return awinGet(`/publishers/${encodeURIComponent(PUBLISHER_ID)}/programmes?countryCode=${encodeURIComponent(countryCode)}`);
}

export async function getOffers() {
  if (!PUBLISHER_ID) throw new Error('AWIN_PUBLISHER_ID ainda não configurado.');
  return awinGet(`/publisher/${encodeURIComponent(PUBLISHER_ID)}/promotions`);
}

export async function discoverAwin() {
  if (!TOKEN) return { authenticated: false, publishers: [], programmes: [], offers: [], errors: ['Awin API ainda não configurada.'] };
  const errors = [];
  const publisher = await getPublisherInfo();
  if (publisher.errors.length) return { authenticated: false, publishers: [], programmes: [], offers: [], errors: publisher.errors };
  if (!PUBLISHER_ID) return { authenticated: true, publishers: publisher.publishers, programmes: [], offers: [], errors: ['Informe AWIN_PUBLISHER_ID.'] };
  let programmes = [];
  let offers = [];
  try { programmes = await getProgrammes(); } catch (error) { errors.push(`Awin programas: ${error.message}`); }
  try { offers = await getOffers(); } catch (error) { errors.push(`Awin ofertas: ${error.message}`); }
  return { authenticated: true, publishers: publisher.publishers, programmes: Array.isArray(programmes) ? programmes : [], offers: Array.isArray(offers) ? offers : (offers?.offers ?? []), errors };
}
