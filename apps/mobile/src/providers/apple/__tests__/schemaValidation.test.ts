import { serializeAppleRequest } from '../serializeRequest';

describe('Apple native request validation', () => {
  it('rejects unsupported schema keywords and non-text inputs before native inference', () => {
    expect(() =>
      serializeAppleRequest({
        messages: [{ role: 'user', content: 'Generate.' }],
        responseFormat: {
          name: 'unsafe',
          schema: { type: 'string', pattern: '.*' },
        },
      }),
    ).toThrow('unsupported JSON Schema keyword');

    expect(() =>
      serializeAppleRequest({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', data: new Uint8Array(), mediaType: 'image/png' },
            ],
          },
        ],
      }),
    ).toThrow('text input only');
  });

  it('rejects schema combinations and constraints the native guided schema cannot preserve', () => {
    expect(() =>
      serializeAppleRequest({
        messages: [{ role: 'user', content: 'Generate.' }],
        responseFormat: {
          name: 'ambiguous',
          schema: {
            type: 'object',
            properties: {},
            anyOf: [{ type: 'string' }],
          },
        },
      }),
    ).toThrow('cannot be represented');

    expect(() =>
      serializeAppleRequest({
        messages: [{ role: 'user', content: 'Generate.' }],
        responseFormat: {
          name: 'invalid',
          schema: { type: 'object', properties: {}, required: ['missing'] },
        },
      }),
    ).toThrow('Required schema property is missing');

    expect(() =>
      serializeAppleRequest({
        messages: [{ role: 'user', content: 'Generate.' }],
        responseFormat: {
          name: 'range',
          schema: {
            type: 'array',
            items: { type: 'string' },
            minItems: 3,
            maxItems: 1,
          },
        },
      }),
    ).toThrow('invalid item range');
  });
});
