import fs from 'node:fs';
import { discoverMercadoLivre, formatMercadoLivre } from './mercadolivre.mjs';

const offers = await discoverMercadoLivre();
const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const lines = [
  '# Ofertas Mercado Livre — candidatos',
  '',
  `Atualizado em: ${now}`,
  '',
  '> Estes são candidatos encontrados automaticamente. Antes de divulgar, gere o link de afiliado pelo Gerador de Links/Barra de Afiliados oficial do Mercado Livre.',
  ''
];

if (!offers.length) {
  lines.push('Nenhum candidato atingiu os filtros atuais.');
} else {
  offers.forEach((offer, index) => {
    lines.push(`## ${index + 1}. ${offer.title}`);
    lines.push('');
    lines.push(`- **Preço:** ${offer.originalPrice ? `De R$ ${offer.originalPrice.toFixed(2).replace('.', ',')} por ` : ''}R$ ${offer.price.toFixed(2).replace('.', ',')}`);
    lines.push(`- **Desconto:** ${offer.discount}%`);
    lines.push(`- **Vendedor:** ${offer.seller || 'Mercado Livre'}`);
    lines.push(`- **Reputação:** ${offer.sellerReputation || 'não informado'}`);
    lines.push(`- **Frete:** ${offer.shipping}`);
    lines.push(`- **Pontuação:** ${offer.score}/100`);
    lines.push(`- **Produto:** ${offer.permalink}`);
    lines.push('');
    lines.push('**Mensagem pronta:**');
    lines.push('');
    lines.push('```text');
    lines.push(formatMercadoLivre(offer));
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
  });
}

fs.writeFileSync('ofertas-mercadolivre.md', lines.join('\n'), 'utf8');
fs.writeFileSync('ofertas-mercadolivre.json', JSON.stringify({ generatedAt: new Date().toISOString(), offers }, null, 2), 'utf8');

console.log(`Mercado Livre: ${offers.length} candidatos encontrados.`);
console.log('Arquivos gerados: ofertas-mercadolivre.md e ofertas-mercadolivre.json');
