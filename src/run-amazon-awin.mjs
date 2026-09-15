import fs from 'node:fs';
import { discoverAmazon, formatAmazon } from './amazon.mjs';
import { discoverAwin } from './awin.mjs';

function buildReport(amazon, awin) {
  const lines = ['# Amazon + Awin', '', `Atualizado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, ''];

  lines.push('## Amazon');
  lines.push(`- API configurada: ${amazon.authenticated ? 'SIM' : 'NÃO'}`);
  lines.push(`- Ofertas encontradas: ${amazon.offers.length}`);
  if (amazon.errors.length) lines.push(...amazon.errors.map(e => `- ${e}`));
  for (const [i, offer] of amazon.offers.slice(0, 10).entries()) {
    lines.push(`### ${i + 1}. ${offer.title}`);
    lines.push(`- Preço: ${offer.price ?? '--'} | Desconto: ${offer.discount}%`);
    lines.push(`- ASIN: ${offer.asin}`);
    lines.push(`- Link: ${offer.permalink || '--'}`);
    lines.push('');
  }

  lines.push('## Awin');
  lines.push(`- API configurada: ${awin.authenticated ? 'SIM' : 'NÃO'}`);
  lines.push(`- Publishers detectados: ${awin.publishers.length}`);
  lines.push(`- Programas consultados: ${awin.programmes.length}`);
  lines.push(`- Ofertas/vouchers consultados: ${awin.offers.length}`);
  if (awin.errors.length) lines.push(...awin.errors.map(e => `- ${e}`));

  return lines.join('\n');
}

const amazon = await discoverAmazon();
const awin = await discoverAwin();

console.log(`Amazon: ${amazon.authenticated ? 'CONFIGURADA' : 'PENDENTE'} | ${amazon.offers.length} ofertas`);
console.log(`Awin: ${awin.authenticated ? 'CONFIGURADA' : 'PENDENTE'} | ${awin.offers.length} ofertas`);

if (amazon.offers.length) {
  console.log('\nPrimeira oferta Amazon:\n');
  console.log(formatAmazon(amazon.offers[0]));
}

fs.writeFileSync('ofertas-amazon-awin.md', buildReport(amazon, awin), 'utf8');
fs.writeFileSync('ofertas-amazon-awin.json', JSON.stringify({ generatedAt: new Date().toISOString(), amazon, awin }, null, 2), 'utf8');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, buildReport(amazon, awin) + '\n', 'utf8');
}
