import { compileResponseSchema } from '../schema';

test('preserves author field order and semantic names/descriptions for native guided choices', () => {
  const schema = compileResponseSchema([], {
    title: 'Task response',
    description:
      'Choose the response supported by the task and current evidence.',
    anyOf: [
      {
        title: 'Evidence request',
        description: 'Only use when more evidence is necessary.',
        type: 'object',
        properties: {
          type: {
            title: 'Response kind',
            type: 'string',
            enum: ['request_evidence'],
            description: 'Select the action before its payload.',
          },
          need: {
            type: 'string',
            description: 'Why the current evidence is insufficient.',
          },
        },
        required: ['type', 'need'],
        additionalProperties: false,
      },
    ],
  });
  expect(schema).toMatchObject({
    kind: 'union',
    name: expect.stringContaining('Taskresponse'),
    description:
      'Choose the response supported by the task and current evidence.',
    choices: [
      {
        kind: 'object',
        name: expect.stringContaining('Evidencerequest'),
        description: 'Only use when more evidence is necessary.',
        properties: [
          {
            name: 'type',
            description: 'Select the action before its payload.',
            schema: {
              kind: 'enum',
              name: expect.stringContaining('Responsekind'),
              description: 'Select the action before its payload.',
              values: ['request_evidence'],
            },
          },
          { name: 'need' },
        ],
      },
    ],
  });
});

test('keeps same-title siblings distinct and preserves unsupported schema rejection', () => {
  const schema = compileResponseSchema([], {
    type: 'object',
    properties: {
      first: { title: 'Shared', type: 'object', properties: {} },
      second: { title: 'Shared', type: 'object', properties: {} },
    },
  });
  if (schema?.kind !== 'object') throw new Error('Expected object');
  const names = schema.properties.map(property =>
    'name' in property.schema ? property.schema.name : '',
  );
  expect(new Set(names).size).toBe(2);
  expect(() =>
    compileResponseSchema([], { type: 'string', pattern: 'x' }),
  ).toThrow();
});
