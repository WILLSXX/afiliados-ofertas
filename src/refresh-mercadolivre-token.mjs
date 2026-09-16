import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const env = process.env;
const API = 'https://api.mercadolibre.com';
const accessToken = env.ML_ACCESS_TOKEN || '';
const refreshToken = env.ML_REFRESH_TOKEN || '';
const appId = env.ML_APP_ID || '';
const clientSecret = env.ML_CLIENT_SECRET || '';
const repo = env.GITHUB_REPOSITORY || '';

async function tokenWorks(token) {
  if (!token) return false;
  const response = await fetch(`${API}/users/me`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  return response.ok;
}

function persistSecret(name, value) {
  if (!env.GH_SECRETS_TOKEN || !repo) {
    throw new Error('GH_SECRETS_TOKEN/GITHUB_REPOSITORY ausente para persistir a rotação do token.');
  }
  execFileSync('gh', ['secret', 'set', name, '--repo', repo, '--body', value], {
    stdio: 'inherit',
    env: { ...env, GH_TOKEN: env.GH_SECRETS_TOKEN }
  });
}

async function main() {
  if (await tokenWorks(accessToken)) {
    console.log('Mercado Livre: access token válido; nenhuma renovação necessária.');
    return;
  }

  if (!refreshToken || !appId || !clientSecret) {
    console.log('Mercado Livre: access token inválido e credenciais de renovação ainda não configuradas.');
    process.exitCode = 2;
    return;
  }

  const response = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: appId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw new Error(`Refresh Mercado Livre HTTP ${response.status}: ${JSON.stringify(data).slice(0, 220)}`);
  }

  persistSecret('ML_ACCESS_TOKEN', data.access_token);
  persistSecret('ML_REFRESH_TOKEN', data.refresh_token);

  fs.appendFileSync(env.GITHUB_ENV, `ML_ACCESS_TOKEN=${data.access_token}\nML_REFRESH_TOKEN=${data.refresh_token}\n`, 'utf8');
  console.log('Mercado Livre: access token renovado e novo refresh token persistido.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
