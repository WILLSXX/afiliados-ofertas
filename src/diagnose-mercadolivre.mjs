const API = 'https://api.mercadolibre.com';
const APP_ID = '2338114927381205';
const TOKEN = process.env.ML_ACCESS_TOKEN || '';

async function get(path, auth = true) {
  const headers = { Accept: 'application/json' };
  if (auth && TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const response = await fetch(`${API}${path}`, { headers });
  const text = await response.text().catch(() => '');
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

function compact(data) {
  if (data && typeof data === 'object') {
    const clone = structuredClone(data);
    for (const key of ['access_token', 'refresh_token', 'client_secret', 'secret_key']) {
      if (key in clone) clone[key] = '[OCULTO]';
    }
    return clone;
  }
  return data;
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

  const userId = me.data?.id;
  if (userId) {
    print('2. /users/{USER_ID}/applications', await get(`/users/${userId}/applications`));
  }

  print('3. /applications/{APP_ID}', await get(`/applications/${APP_ID}`));
  print('4. /applications/{APP_ID}/grants', await get(`/applications/${APP_ID}/grants`));

  // Endpoint público de referência: ajuda a separar bloqueio geral da API de bloqueio específico.
  print('5. /sites/MLB/categories', await get('/sites/MLB/categories', false));

  // Busca genérica que está retornando 403 no projeto.
  print('6. /sites/MLB/search?q=ssd', await get('/sites/MLB/search?q=ssd&limit=5&sort=relevance'));

  // Busca por vendedor, documentada oficialmente e autenticada.
  if (userId) {
    print('7. /sites/MLB/search?seller_id={USER_ID}', await get(`/sites/MLB/search?seller_id=${userId}&limit=5`));
    print('8. /users/{USER_ID}/items/search', await get(`/users/${userId}/items/search?status=active&limit=5`));
  }
}
