import { serializeAppleRequest } from '../serializeRequest';

test('requires an actual tool call before a task with no evidence can answer', () => {
  const result = serializeAppleRequest({
    messages: [{ role: 'user', content: 'Read the synthetic records.' }],
    toolChoice: 'required',
    tools: [
      {
        name: 'read_records',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    ],
    responseFormat: { name: 'Answer', schema: { type: 'string' } },
  });
  expect(result.schema).toMatchObject({
    kind: 'object',
    properties: [
      { name: 'kind', schema: { kind: 'enum', values: ['tool_calls'] } },
      { name: 'toolCalls', schema: { minimumElements: 1, maximumElements: 1 } },
    ],
  });
  expect(result.mode).toBe('tools');
});
