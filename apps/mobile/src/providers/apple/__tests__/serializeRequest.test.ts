import type { LanguageModelRequest } from '@orot/model-runtime';
import { serializeAppleRequest } from '../serializeRequest';

describe('Apple native request conversion', () => {
  it('keeps visit guidance and source identifiers in the on-device request', () => {
    const request: LanguageModelRequest = {
      messages: [
        { role: 'system', content: 'Use the record only.' },
        { role: 'user', content: 'Synthetic source-42: routine follow-up.' },
      ],
      responseFormat: {
        name: 'visit_question',
        schema: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            sourceIds: { type: 'array', items: { type: 'string', enum: ['source-42'] } },
          },
          required: ['question', 'sourceIds'],
          additionalProperties: false,
        },
      },
    };

    const result = serializeAppleRequest(request);

    expect(result.mode).toBe('structured');
    expect(result.instructions).toContain('Help prepare questions the patient can ask at a medical visit.');
    expect(result.instructions).toContain('The patient is the speaker and their clinician is the listener.');
    expect(result.instructions).toContain("Address the clinician as '선생님'");
    expect(result.instructions).toContain('Write every string in structured output in Korean.');
    expect(result.instructions).toContain('Do not diagnose or give medical or medication-change recommendations.');
    expect(result.instructions).toContain('Use the record only.');
    expect(result.prompt).toContain('Synthetic source-42');
    expect(result.schema).toMatchObject({
      kind: 'object',
      properties: [
        { name: 'question', optional: false, schema: { kind: 'string' } },
        {
          name: 'sourceIds',
          optional: false,
          schema: {
            kind: 'array',
            item: { kind: 'enum', values: ['source-42'] },
          },
        },
      ],
    });
  });

  it('gives sibling nested object schemas distinct native identities', () => {
    const result = serializeAppleRequest({
      messages: [{ role: 'user', content: 'Use both nested fields.' }],
      responseFormat: {
        name: 'VisitQuestion',
        schema: {
          type: 'object',
          properties: {
            question: {
              type: 'object',
              properties: {
                text: {
                  type: 'string',
                  description: "The patient addresses their clinician as '선생님' and asks what to discuss or check about the supplied change.",
                },
              },
              required: ['text'],
              additionalProperties: false,
            },
            source: {
              type: 'object',
              properties: { id: { type: 'integer' } },
              required: ['id'],
              additionalProperties: false,
            },
          },
          required: ['question', 'source'],
          additionalProperties: false,
        },
      },
    });

    expect(result.schema).toMatchObject({
      kind: 'object',
      properties: [
        {
          name: 'question',
          schema: {
            kind: 'object',
            properties: [{
              name: 'text',
              description: "The patient addresses their clinician as '선생님' and asks what to discuss or check about the supplied change.",
              schema: { kind: 'string' },
            }],
          },
        },
        { name: 'source', schema: { kind: 'object', properties: [{ name: 'id', schema: { kind: 'integer' } }] } },
      ],
    });
    const nestedNames = result.schema?.kind === 'object'
      ? result.schema.properties.map(property =>
        property.schema.kind === 'object' ? property.schema.name : '',
      )
      : [];
    expect(nestedNames).toEqual(['VisitQuestionField0', 'VisitQuestionField1']);
  });

  it('keeps prior tool-call and result ids in the prompt and validates tool names', () => {
    const request: LanguageModelRequest = {
      messages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 'call-7', name: 'lookup', arguments: { sourceId: 'source-42' } }] },
        { role: 'tool', toolCallId: 'call-7', result: { sourceId: 'source-42' } },
        { role: 'user', content: 'Continue.' },
      ],
      tools: [{
        name: 'lookup',
        inputSchema: {
          type: 'object',
          properties: { sourceId: { type: 'string' } },
          required: ['sourceId'],
          additionalProperties: false,
        },
      }],
    };

    const result = serializeAppleRequest(request);

    expect(result.mode).toBe('tools');
    expect(result.prompt).toContain('call-7');
    expect(result.prompt).toContain('source-42');
    expect(result.schema).toMatchObject({
      kind: 'union',
      choices: [
        {
          kind: 'object',
          properties: [
            { name: 'kind', schema: { kind: 'enum', values: ['tool_calls'] } },
            { name: 'toolCalls', schema: { kind: 'array', minimumElements: 1, maximumElements: 8 } },
          ],
        },
        { kind: 'object', properties: [{ name: 'kind' }, { name: 'text' }] },
      ],
    });
  });

  it('passes tool descriptions into the model-visible instructions', () => {
    const inputSchema = {
      type: 'object',
      properties: { sourceId: { type: 'string' } },
      required: ['sourceId'],
      additionalProperties: false,
    } as const;
    const serialize = (description: string) => serializeAppleRequest({
      messages: [{ role: 'user', content: 'Use an available tool.' }],
      tools: [{ name: 'lookup_source', description, inputSchema }],
    });

    const lookup = serialize('Find the supplied source and return its contents.');
    const archive = serialize('Archive the supplied source.');

    expect(lookup.instructions).toContain('lookup_source: Find the supplied source and return its contents.');
    expect(lookup.instructions).not.toBe(archive.instructions);
  });

  it('rejects unsupported schema keywords and non-text inputs before native inference', () => {
    expect(() => serializeAppleRequest({
      messages: [{ role: 'user', content: 'Generate.' }],
      responseFormat: {
        name: 'unsafe',
        schema: { type: 'string', pattern: '.*' },
      },
    })).toThrow('unsupported JSON Schema keyword');

    expect(() => serializeAppleRequest({
      messages: [{
        role: 'user',
        content: [{ type: 'image', data: new Uint8Array(), mediaType: 'image/png' }],
      }],
    })).toThrow('text input only');
  });

  it('rejects schema combinations and constraints the native guided schema cannot preserve', () => {
    expect(() => serializeAppleRequest({
      messages: [{ role: 'user', content: 'Generate.' }],
      responseFormat: {
        name: 'ambiguous',
        schema: { type: 'object', properties: {}, anyOf: [{ type: 'string' }] },
      },
    })).toThrow('cannot be represented');

    expect(() => serializeAppleRequest({
      messages: [{ role: 'user', content: 'Generate.' }],
      responseFormat: {
        name: 'invalid',
        schema: { type: 'object', properties: {}, required: ['missing'] },
      },
    })).toThrow('Required schema property is missing');

    expect(() => serializeAppleRequest({
      messages: [{ role: 'user', content: 'Generate.' }],
      responseFormat: {
        name: 'range',
        schema: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 1 },
      },
    })).toThrow('invalid item range');
  });
});
