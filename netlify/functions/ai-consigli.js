exports.handler = async () => ({
  statusCode: 410,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ok: false,
    code: 'DEPRECATED_ENDPOINT',
    error: 'Endpoint deprecato. Usa /.netlify/functions/openai-suggestion con metodo POST.'
  })
});
