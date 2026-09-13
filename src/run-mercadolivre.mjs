import { discoverMercadoLivre, formatMercadoLivre } from './mercadolivre.mjs';

const offers = await discoverMercadoLivre();
console.log(`Mercado Livre: ${offers.length} candidatos encontrados.`);
for (const offer of offers) {
  console.log(`\n${formatMercadoLivre(offer)}`);
}

if (!offers.length) {
  console.log('\nNenhum candidato atingiu os filtros atuais.');
}
