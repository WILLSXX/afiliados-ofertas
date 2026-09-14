import fs from 'node:fs';
import { discoverMercadoLivre, formatMercadoLivre } from './mercadolivre.mjs';

const result = await discoverMercadoLivre();
const { offers, errors, authenticated, stats, fallbackUsed, minDiscount } = result;
const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const lines = [
  '# Ofertas Mercado Livre — candidatos',
  '',
  `Atualizado em: ${now}`,
  '',
  `Status da API: ${authenticated ? 'AUTENTICADA' : 'AGUARDANDO ML_ACCESS_TOKEN'}`,
  '',
  `Diagnóstico da busca: ${stats.catalogProducts} produtos de catálogo → ${stats.winners} anúncios vencedores → ${stats.validProducts} produtos válidos → ${stats.discountedProducts} com pelo menos ${minDiscount}% OFF.`,
  '',
  '> Estes são candidatos encontrados automaticamente. Antes de divulgar, gere o link de afiliado pelo Gerador de Links/Barra de Afiliados oficial do Mercado Livre.',
  ''
];

if (fallbackUsed) {
  lines.push('> ℹ️ Não houve candidatos com o desconto mínimo. Foram exibidos os melhores candidatos válidos como fallback para não deixar a busca vazia. Confirme o preço/oferta no anúncio antes de divulgar.');
  lines.push('');
}

if (errors.length) {
  lines.push('## Diagnóstico');
  lines.push('');
  for (const error of errors) lines.push(`- ${error}`);
  lines.push('');
}

if (!offers.length) {
  lines.push(authenticated ? 'Nenhum candidato válido foi encontrado nesta execução.' : 'Nenhum candidato foi processado porque a API precisa de autenticação.');
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
    if (offer.fallback) lines.push('- **Status:** FALLBACK — sem desconto mínimo detectado');
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
fs.writeFileSync('ofertas-mercadolivre.json', JSON.stringify({ generatedAt: new Date().toISOString(), authenticated, errors, stats, fallbackUsed, minDiscount, offers }, null, 2), 'utf8');

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const summaryLines = [
    '# 🔎 Ofertas Mercado Livre',
    '',
    `Atualizado em: ${now}`,
    '',
    `**Status da API:** ${authenticated ? 'AUTENTICADA' : 'AGUARDANDO ML_ACCESS_TOKEN'}`,
    '',
    `**Diagnóstico:** ${stats.catalogProducts} produtos de catálogo → ${stats.winners} anúncios vencedores → ${stats.validProducts} válidos → ${stats.discountedProducts} com pelo menos ${minDiscount}% OFF.`,
    ''
  ];

  if (errors.length) {
    summaryLines.push('## Diagnóstico');
    for (const error of errors) summaryLines.push(`- ${error}`);
    summaryLines.push('');
  }

  if (fallbackUsed) {
    summaryLines.push('> ℹ️ O desconto mínimo não encontrou candidatos. Os melhores candidatos válidos foram usados como fallback; confirme a oferta antes de divulgar.');
    summaryLines.push('');
  }

  summaryLines.push(offers.length ? `**${offers.length} candidatos encontrados.**` : (authenticated ? '**Nenhum candidato válido foi encontrado nesta execução.**' : '**Nenhuma busca processada: falta autenticação da API.**'));
  summaryLines.push('');

  for (const [index, offer] of offers.entries()) {
    summaryLines.push(`## ${index + 1}. ${offer.title}`);
    summaryLines.push(`- 💰 **Preço:** R$ ${offer.price.toFixed(2).replace('.', ',')}${offer.discount ? ` — **${offer.discount}% OFF**` : ''}`);
    summaryLines.push(`- 🏪 **Vendedor:** ${offer.seller || 'Mercado Livre'}`);
    summaryLines.push(`- ⭐ **Reputação:** ${offer.sellerReputation || 'não informado'}`);
    summaryLines.push(`- 🚚 **Frete:** ${offer.shipping}`);
    if (offer.fallback) summaryLines.push('- ⚠️ **Fallback:** desconto mínimo não detectado');
    summaryLines.push(`- 🛒 [Abrir produto](${offer.permalink})`);
    summaryLines.push('');
  }

  summaryLines.push('> ⚠️ Os links acima são links de produto. Gere o link de afiliado no Portal/Barra oficial antes de divulgar.');
  fs.appendFileSync(summary, summaryLines.join('\n') + '\n', 'utf8');
}

console.log(`Mercado Livre: ${offers.length} candidatos encontrados.`);
console.log(`Diagnóstico: ${stats.catalogProducts} produtos de catálogo, ${stats.winners} vencedores, ${stats.validProducts} válidos, ${stats.discountedProducts} com desconto >= ${minDiscount}%.`);
if (fallbackUsed) console.log('Fallback ativado: não houve candidatos com o desconto mínimo.');
if (errors.length) console.log(`Mercado Livre: ${errors.length} diagnóstico(s) registrado(s).`);
console.log('Arquivos gerados: ofertas-mercadolivre.md e ofertas-mercadolivre.json');
