const { validateResponse, FALLBACK_RESPONSE } = require('./orchestrator-v3/contract-validator');
const { routeDomain } = require('./orchestrator-v3/domain-router');
const { handlePanino, extractIngredients } = require('./orchestrator-v3/panino-handler');
const { handleMenu } = require('./orchestrator-v3/menu-handler');
const { logExecution } = require('./orchestrator-v3/logger');

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}

function parseBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === 'object') {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const startedAt = Date.now();

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: JSON_HEADERS,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    const validated = validateResponse({
      ok: false,
      cartUpdates: [],
      reply: 'Metodo non consentito.'
    });

    return jsonResponse(405, validated);
  }

  try {
    const parsedBody = parseBody(event.body);
    if (!parsedBody || typeof parsedBody !== 'object') {
      const invalidBodyResponse = validateResponse({
        ok: false,
        cartUpdates: [],
        reply: 'Body richiesta non valido.'
      });

      logExecution({
        domain: 'MENU',
        intent: 'info',
        ingredientsDetected: [],
        executionTimeMs: Date.now() - startedAt,
        status: 'error',
        error: 'invalid_body'
      });

      return jsonResponse(200, invalidBodyResponse);
    }

    const message = String(parsedBody.message || parsedBody.prompt || '').trim();
    if (!message) {
      const missingMessageResponse = validateResponse({
        ok: false,
        cartUpdates: [],
        reply: 'Messaggio mancante.'
      });

      return jsonResponse(200, missingMessageResponse);
    }

    const routing = routeDomain(message);
    const response = routing.domain === 'PANINO'
      ? handlePanino({ message, intent: routing.intent })
      : handleMenu({ message, intent: routing.intent });

    const validatedResponse = validateResponse(response);

    logExecution({
      domain: routing.domain,
      intent: routing.intent,
      ingredientsDetected: routing.domain === 'PANINO' ? extractIngredients(message) : [],
      executionTimeMs: Date.now() - startedAt,
      status: validatedResponse.ok ? 'success' : 'error',
      error: validatedResponse.ok ? null : validatedResponse.reply
    });

    return jsonResponse(200, validatedResponse);
  } catch (error) {
    const fallback = validateResponse(FALLBACK_RESPONSE);

    logExecution({
      domain: 'MENU',
      intent: 'info',
      ingredientsDetected: [],
      executionTimeMs: Date.now() - startedAt,
      status: 'error',
      error: error && error.message ? error.message : 'unknown_error'
    });

    return jsonResponse(200, fallback);
  }
};
