import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const APP_ID = '2338114927381205';
const REDIRECT_URI = process.env.ML_REDIRECT_URI || 'https://willsxx.github.io/afiliados-ofertas/oauth/callback.html';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

const rl = readline.createInterface({ input, output });

try {
  console.log('=== Mercado Livre OAuth — troca do code por tokens ===');
  console.log('IMPORTANTE: este script não grava nem envia seu Secret Key para o GitHub.');
  console.log(`APP ID: ${APP_ID}`);
  console.log(`Redirect URI esperada: ${REDIRECT_URI}`);
  console.log('');

  const code = (await rl.question('Cole aqui o CODE recebido na URL de retorno: ')).trim();
  const clientSecret = (await rl.question('Cole aqui a Secret Key da aplicação: ')).trim();

  if (!code || !clientSecret) {
    throw new Error('CODE e Secret Key são obrigatórios.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: APP_ID,
    client_secret: clientSecret,
    code,
    redirect_uri: REDIRECT_URI
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error(`\nFalha HTTP ${response.status}.`);
    console.error(JSON.stringify(data, null, 2));
  } else {
    console.log('\nSUCESSO: autorização convertida em tokens.');
    console.log('\nACCESS_TOKEN (temporário):');
    console.log(data.access_token || '(não retornado)');
    console.log('\nREFRESH_TOKEN (guardar com segurança):');
    console.log(data.refresh_token || '(não retornado)');
    console.log(`\nEXPIRA EM: ${data.expires_in ?? 'não informado'} segundos`);
    console.log('\nPRÓXIMO PASSO: adicionar o token apropriado aos Secrets do GitHub.');
    console.log('Não publique esses valores em issues, commits, prints ou mensagens.');
  }
} catch (error) {
  console.error(`\nErro: ${error.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
