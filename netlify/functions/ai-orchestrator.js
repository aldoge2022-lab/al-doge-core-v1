try {

  const client = await createOpenAIClient();

  const tools = [
    {
      type: 'function',
      function: {
        name: 'create_custom_panino',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ingredientIds: { type: 'array', items: { type: 'string' } }
          },
          required: ['ingredientIds']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_menu_item_to_cart',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            itemId: { type: 'string' },
            qty: { type: 'number' }
          },
          required: ['itemId']
        }
      }
    }
  ];

  const input = [
    { role: 'system', content: 'Usa solo tool con ID reali del food-core.' },
    { role: 'user', content: prompt }
  ];

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

    if (toolCalls.length > 0) {

      for (const toolCall of toolCalls) {

        const output = await runToolCall(toolCall, { cart });

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
      }

      continue;
    }

    if (messageItem) {
      assistantMessage = messageItem.content?.[0]?.text || null;
    }

    break;
  }

  const assistantReply =
    assistantMessage ||
    'Posso aiutarti a scegliere qualcosa dal menu.';

  return jsonResponse(200, normalizeClientPayload({
    ok: true,
    reply: assistantReply,
    toolsCalled,
    finalActions,
    cartUpdates,
    message: assistantReply
  }));

} catch (error) {

  console.error("AI FULL ERROR:", error);

  return jsonResponse(200, normalizeClientPayload({
    cartUpdates: [],
    message: String(error?.message || error)
  }));
}
