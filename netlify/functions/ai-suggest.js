const OpenAI = require('openai');
const fs = require('node:fs');
const path = require('node:path');
const CENTS_TO_EUROS = 100;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  try {
    const { message } = JSON.parse(event.body || '{}');

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing message' })
      };
    }

    const repoRoot = path.resolve(__dirname, '..', '..');
    const catalogCandidates = [
      path.join(repoRoot, 'public', 'data', 'catalog.json'),
      path.join(repoRoot, 'public', 'data', 'menu.json'),
      path.join(repoRoot, 'data', 'catalog.json')
    ];
    const catalogPath = catalogCandidates.find((candidate) => fs.existsSync(candidate));
    if (!catalogPath) {
      throw new Error(`Catalog file not found in: ${catalogCandidates.join(', ')}`);
    }
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const pizzaList = (catalog.menu || [])
      .filter((item) => item.active !== false)
      .map((item) => {
        const price = Number(item.base_price_cents || 0) / CENTS_TO_EUROS;
        const category = item.category || (Array.isArray(item.tags) && item.tags[0]) || 'pizza';
        return `${item.name} (€${price.toFixed(2)}, categoria: ${category})`;
      })
      .join(', ');

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    const response = await client.responses.create({
      model: 'gpt-5-2-mini',
      input: `Sei il consulente vendite della pizzeria AL DOGE.
Menu disponibile: ${pizzaList}

Cliente dice: "${message}"

Regole:
- Suggerisci solo pizze presenti nel menu disponibile
- Suggerisci massimo 3 pizze e senza ripetizioni
- Sii breve (massimo 4 righe) e commerciale
- Se opportuno, proponi anche una bibita`
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reply: response.output_text
      })
    };
  } catch (error) {
    console.error('AI ERROR:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
