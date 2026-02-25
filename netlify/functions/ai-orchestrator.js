let response = await client.responses.create({
  model: 'gpt-4o-mini-2024-07-18',
  input,
  tools
});

let assistantMessage = null;

while (toolsCalled.length < MAX_TOOL_CALLS) {

  const outputs = Array.isArray(response?.output) ? response.output : [];

  const toolCalls = outputs.filter(o => o.type === 'tool_call');
  const messageItem = outputs.find(o => o.type === 'message');

  // Se ci sono tool_call → eseguili
  if (toolCalls.length > 0) {

    for (const toolCall of toolCalls) {

      try {
        const output = await runToolCall(toolCall, {
          cart,
          ...parseToolArguments(toolCall.arguments)
        });

        toolsCalled.push(toolCall.name);
        finalActions.push({ tool: toolCall.name, ok: true });

        const cartUpdate = toCartUpdate(toolCall.name, output);
        if (cartUpdate) cartUpdates.push(cartUpdate);

        response = await client.responses.create({
          model: 'gpt-4o-mini-2024-07-18',
          previous_response_id: response.id,
          input: [{
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: JSON.stringify(output)
          }]
        });

      } catch (error) {

        toolsCalled.push(toolCall.name);
        finalActions.push({
          tool: toolCall.name,
          ok: false,
          error: error.message
        });

        response = await client.responses.create({
          model: 'gpt-4o-mini-2024-07-18',
          previous_response_id: response.id,
          input: [{
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: JSON.stringify({ error: error.message })
          }]
        });
      }
    }

    continue;
  }

  // Se c'è un messaggio finale → termina
  if (messageItem) {
    assistantMessage =
      messageItem.content?.[0]?.text ||
      null;
  }

  break;
}

// Risposta finale sicura
const assistantReply =
  assistantMessage ||
  'Posso aiutarti a scegliere qualcosa dal menu o aggiungere un prodotto al carrello.';

return jsonResponse(200, normalizeClientPayload({
  ok: true,
  reply: assistantReply,
  toolsCalled,
  finalActions,
  cartUpdates,
  message: assistantReply
}));
