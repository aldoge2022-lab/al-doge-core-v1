function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

exports.handler = async () => {
  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(200, { status: 'error', reason: 'OPENAI_API_KEY missing' });
  }

  try {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    await client.responses.create({
      model: 'gpt-4o-mini-2024-07-18',
      input: 'ping'
    });

    return jsonResponse(200, { status: 'ok' });
  } catch (error) {
    return jsonResponse(200, {
      status: 'error',
      reason: error?.message || 'OpenAI health check failed'
    });
  }
};
