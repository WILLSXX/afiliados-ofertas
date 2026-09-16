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
    lines.push(`### ${i + 1}. ${offer.title}`, `- Preço: ${offer.price ?? '--'} | Desconto: ${offer.discount}%`, `- ASIN: ${offer.asin}`, `- Link: ${offer.permalink || '--'}`, '');
  }
  lines.push('## Awin');
  lines.push(`- API configurada: ${awin.authenticated ? 'SIM' : 'NÃO'}`);
  lines.push(`- Publishers detectados: ${awin.publishers.length}`);
  lines.push(`- Programas consultados: ${awin.programmes.length}`);
  lines.push(`- Programas identificados como associados: ${awin.joinedProgrammes ?? 0}`);
  lines.push(`- Promoções/vouchers consultados: ${awin.offers.length}`);
  lines.push(`- Ofertas de programas associados: ${awin.joinedOffers?.length ?? 0}`);
  lines.push(`- Promoções: ${awin.promotionOffers?.length ?? 0} | Vouchers: ${awin.voucherOffers?.length ?? 0}`);
  lines.push(`- Links de tracking gerados: ${awin.trackingLinks?.generated ?? 0}/${awin.trackingLinks?.attempted ?? 0}`);
  if (awin.offers?.length) {
    lines.push('', '### Amostra das ofertas Awin');
    for (const [i, offer] of awin.offers.slice(0, 10).entries()) {
      lines.push(`#### ${i + 1}. ${offer.title || 'Oferta sem título'}`);
      lines.push(`- **Anunciante:** ${offer.advertiser?.name || '--'}`);
      lines.push(`- **Tipo:** ${offer.type || '--'} | **Associado:** ${offer.joined ? 'SIM' : 'NÃO'}`);
      lines.push(`- **Validade:** ${offer.startDate || '--'} → ${offer.endDate || '--'}`);
      lines.push(`- **Cupom:** ${offer.voucher?.code || 'não disponível'}`);
      lines.push(`- **Link de rastreamento:** ${offer.affiliateTrackingUrl || offer.urlTracking || offer.url || '--'}`);
      lines.push('');
    }
  }
  if (awin.errors.length) lines.push('### Diagnóstico', '', ...awin.errors.map(e => `- ${e}`), '');
  if (!awin.offers?.length) lines.push('', '> Nenhuma promoção/voucher foi retornado pela API nos testes de associação/região. O relatório registra os diagnósticos para a próxima execução.');
  return lines.join('\n');
}

const amazon = await discoverAmazon();
const awin = await discoverAwin();
console.log(`Amazon: ${amazon.authenticated ? 'CONFIGURADA' : 'PENDENTE'} | ${amazon.offers.length} ofertas`);
console.log(`Awin: ${awin.authenticated ? 'CONFIGURADA' : 'PENDENTE'} | ${awin.offers.length} ofertas | ${awin.joinedOffers?.length ?? 0} associadas | ${awin.promotionOffers?.length ?? 0} promoções | ${awin.voucherOffers?.length ?? 0} vouchers | tracking=${awin.trackingLinks?.generated ?? 0}/${awin.trackingLinks?.attempted ?? 0}`);
if (amazon.offers.length) { console.log('\nPrimeira oferta Amazon:\n'); console.log(formatAmazon(amazon.offers[0])); }
if (awin.offers.length) {
  console.log('\nPrimeiras ofertas Awin:');
  for (const offer of awin.offers.slice(0, 5)) console.log(`- ${offer.advertiser?.name || '--'} | ${offer.type || '--'} | ${offer.title || '--'} | associado=${offer.joined ? 'sim' : 'não'} | tracking=${offer.affiliateTrackingUrl ? 'sim' : 'não'}`);
}
const report = buildReport(amazon, awin);
fs.writeFileSync('ofertas-amazon-awin.md', report, 'utf8');
fs.writeFileSync('ofertas-amazon-awin.json', JSON.stringify({ generatedAt: new Date().toISOString(), amazon, awin }, null, 2), 'utf8');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n', 'utf8');
