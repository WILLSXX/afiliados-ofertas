const API = 'https://api.mercadolibre.com';
const APP_ID = '2338114927381205';
const TOKEN = process.env.ML_ACCESS_TOKEN || '';
const USER_ID = '432200178';
const KEYWORDS = ['ssd', 'memoria ram', 'monitor gamer'];

async function get(path, auth = true) {
  const headers = { Accept: 'application/json' };
  if (auth && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const response = await fetch(`${API}${path}`, { headers });
  const text = await response.text().catch(() => '');
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, ok: response.ok, data };
}

function compact(data) {
  if (!data || typeof data !== 'object') return data;
  const clone = structuredClone(data);
  const redact = new Set([
    'access_token', 'refresh_token', 'client_secret', 'secret_key',
    'email', 'secure_email', 'identification', 'address', 'phone',
    'alternative_phone', 'first_name', 'last_name', 'context'
  ]);

  function walk(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(walk);
    for (const [key, child] of Object.entries(value)) {
      if (redact.has(key)) value[key] = '[OCULTO]';
      else value[key] = walk(child);
    }
    return value;
  }

  return walk(clone);
}

function print(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${result.status}`);
  console.log(JSON.stringify(compact(result.data), null, 2));
}

console.log('Diagnóstico oficial da API do Mercado Livre');
console.log(`APP_ID: ${APP_ID}`);
console.log(`TOKEN_CONFIGURADO: ${TOKEN ? 'SIM' : 'NÃO'}`);

if (!TOKEN) {
  console.error('ML_ACCESS_TOKEN não configurado.');
  process.exitCode = 1;
} else {
  const me = await get('/users/me');
  print('1. /users/me', me);

  print('2. /users/{USER_ID}/applications', await get(`/users/${USER_ID}/applications`));
  print('3. /applications/{APP_ID}', await get(`/applications/${APP_ID}`));
  print('4. /applications/{APP_ID}/grants', await get(`/applications/${APP_ID}/grants`));

  print('5. /sites/MLB/categories', await get('/sites/MLB/categories', false));
  print('6. /sites/MLB/search?q=ssd', await get('/sites/MLB/search?q=ssd&limit=5&sort=relevance'));
  print('7. /sites/MLB/search?seller_id={USER_ID}', await get(`/sites/MLB/search?seller_id=${USER_ID}&limit=5`));
  print('8. /users/{USER_ID}/items/search', await get(`/users/${USER_ID}/items/search?status=active&limit=5`));

  for (const keyword of KEYWORDS) {
    const q = encodeURIComponent(keyword);
    print(`9. /products/search?q=${keyword}`, await get(`/products/search?status=active&site_id=MLB&q=${q}&limit=5`));
    print(`10. /sites/MLB/domain_discovery/search?q=${keyword}`, await get(`/sites/MLB/domain_discovery/search?q=${q}&limit=3`));
  }

  const ownItems = await get(`/users/${USER_ID}/items/search?status=active&limit=1`);
  const itemId = ownItems.data?.results?.[0];
  if (itemId) print(`11. /items/${itemId}`, await get(`/items/${itemId}`));
}
