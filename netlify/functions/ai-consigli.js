function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

exports.handler = async () => jsonResponse(410, {
  ok: false,
  code: 'DEPRECATED_ENDPOINT',
  error: 'Endpoint deprecato. Usa /.netlify/functions/openai-suggestion.'
});
