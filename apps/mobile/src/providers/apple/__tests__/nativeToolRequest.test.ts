import { serializeAppleRequest } from '../serializeRequest';

// The SDK registers tools separately from the task output schema; JSON choices are not tools.
test('serializes SDK tool parameters independently of the current answer schema', () => {
  const request = serializeAppleRequest({
    messages: [{ role: 'user', content: 'Read synthetic evidence.' }],
    tools: [
      {
        name: 'read_records',
        description: 'Read records',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
    ],
    toolChoice: 'required',
    responseFormat: { name: 'Answer', schema: { type: 'string' } },
  });
  expect(request.nativeTools).toMatchObject([
    {
      name: 'read_records',
      parameters: {
        kind: 'object',
        properties: [{ name: 'query', schema: { kind: 'string' } }],
      },
    },
  ]);
  expect(request.nativeResponseSchema).toEqual({ kind: 'string' });
  expect(request.nativeToolChoice).toBe('required');
});

test('carries call identity and validated results separately for callback matching', () => {
  const call = {
    id: 'bridge-owned-1',
    name: 'read_records',
    arguments: { query: 'test' },
  };
  const request = serializeAppleRequest({
    messages: [
      { role: 'user', content: 'Read synthetic evidence.' },
      { role: 'assistant', content: '', toolCalls: [call] },
      {
        role: 'tool',
        toolCallId: call.id,
        result: { sourceIds: ['source-1'] },
      },
    ],
  });
  expect(request.nativeToolCalls).toEqual([call]);
  expect(request.nativeToolResults).toEqual([
    { toolCallId: call.id, result: { sourceIds: ['source-1'] } },
  ]);
});
