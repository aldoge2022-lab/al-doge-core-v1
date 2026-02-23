function methodNotAllowed() {
  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' })
  };
}

function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody || '{}');
  } catch {
    return null;
  }
}

async function generateCommercialNote(orderSummary) {
  if (!process.env.XAI_API_KEY || typeof fetch !== 'function') {
    return null;
  }

  const model = process.env.XAI_MODEL || 'grok-4-1-fast-reasoning';

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Sei il consulente vendite della pizzeria AL DOGE. Scrivi massimo 3 righe persuasive. Non indicare prezzi. Non modificare mai l\'ordine.'
          },
          {
            role: 'user',
            content: `Ordine valido da accompagnare con nota commerciale: ${orderSummary}`
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('xAI HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error('xAI ERROR:', error);
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();

  try {
    const body = parseJsonBody(event.body);
    if (!body || typeof body.orderSummary !== 'string' || !body.orderSummary.trim()) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'INVALID_INPUT' })
      };
    }

    const note = await generateCommercialNote(body.orderSummary.trim());

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note: note || 'Ottima scelta: conferma ora e prepariamo tutto al meglio.'
      })
    };
  } catch {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'INTERNAL_ERROR' })
    };
  }
};

module.exports = { handler: exports.handler, generateCommercialNote };
