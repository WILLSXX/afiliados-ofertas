import fs from 'node:fs';
import { discoverMercadoLivre, formatMercadoLivre } from './mercadolivre.mjs';

const result = await discoverMercadoLivre();
const { offers, errors, authenticated } = result;
const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const lines = [
  '# Ofertas Mercado Livre — candidatos',
  '',
  `Atualizado em: ${now}`,
  '',
  `Status da API: ${authenticated ? 'AUTENTICADA' : 'AGUARDANDO ML_ACCESS_TOKEN'}`,
  '',
  '> Estes são candidatos encontrados automaticamente. Antes de divulgar, gere o link de afiliado pelo Gerador de Links/Barra de Afiliados oficial do Mercado Livre.',
  ''
];

if (errors.length) {
  lines.push('## Diagnóstico');
  lines.push('');
  for (const error of errors) lines.push(`- ${error}`);
  lines.push('');
}

if (!offers.length) {
  lines.push(authenticated ? 'Nenhum candidato atingiu os filtros atuais.' : 'Nenhum candidato foi processado porque a API precisa de autenticação.');
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
fs.writeFileSync('ofertas-mercadolivre.json', JSON.stringify({ generatedAt: new Date().toISOString(), authenticated, errors, offers }, null, 2), 'utf8');

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const summaryLines = [
    '# 🔎 Ofertas Mercado Livre',
    '',
    `Atualizado em: ${now}`,
    '',
    `**Status da API:** ${authenticated ? 'AUTENTICADA' : 'AGUARDANDO ML_ACCESS_TOKEN'}`,
    ''
  ];

  if (errors.length) {
    summaryLines.push('## Diagnóstico');
    for (const error of errors) summaryLines.push(`- ${error}`);
    summaryLines.push('');
  }

  summaryLines.push(offers.length ? `**${offers.length} candidatos encontrados.**` : (authenticated ? '**Nenhum candidato atingiu os filtros atuais.**' : '**Nenhuma busca processada: falta autenticação da API.**'));
  summaryLines.push('');

  for (const [index, offer] of offers.entries()) {
    summaryLines.push(`## ${index + 1}. ${offer.title}`);
    summaryLines.push(`- 💰 **Preço:** R$ ${offer.price.toFixed(2).replace('.', ',')}${offer.discount ? ` — **${offer.discount}% OFF**` : ''}`);
    summaryLines.push(`- 🏪 **Vendedor:** ${offer.seller || 'Mercado Livre'}`);
    summaryLines.push(`- ⭐ **Reputação:** ${offer.sellerReputation || 'não informado'}`);
    summaryLines.push(`- 🚚 **Frete:** ${offer.shipping}`);
    summaryLines.push(`- 🛒 [Abrir produto](${offer.permalink})`);
    summaryLines.push('');
  }

  summaryLines.push('> ⚠️ Os links acima são links de produto. Gere o link de afiliado no Portal/Barra oficial antes de divulgar.');
  fs.appendFileSync(summary, summaryLines.join('\n') + '\n', 'utf8');
}

console.log(`Mercado Livre: ${offers.length} candidatos encontrados.`);
if (errors.length) console.log(`Mercado Livre: ${errors.length} diagnóstico(s) registrado(s).`);
console.log('Arquivos gerados: ofertas-mercadolivre.md e ofertas-mercadolivre.json');
