import { describe, expect, it } from '@jest/globals';
import { prepareRequest } from '../src/request-mapper';

// Synthetic bridge mapping only; never invoke a provider or native transport.
describe('native request validation boundary', () => {
  it('maps a valid tool follow-up larger than the native builder byte cutoff', () => {
    const mapped = prepareRequest('synthetic-model', {
      messages: [
        { role: 'user', content: 'Synthetic request' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'synthetic-call', name: 'synthetic_tool', arguments: {} }],
        },
        { role: 'tool', toolCallId: 'synthetic-call', result: { text: 'x'.repeat(1_048_577) } },
      ],
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error('Synthetic mapping failed');
    expect(JSON.stringify(mapped.value).length).toBeGreaterThan(1_048_576);
  });

  it('rejects a cached function continuation lacking native-required fields', () => {
    const mapped = prepareRequest(
      'synthetic-model',
      {
        messages: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'synthetic-call', name: 'synthetic_tool', arguments: {} }],
          },
        ],
      },
      new Map([['synthetic-call', [JSON.stringify({ type: 'function_call' })]]]),
    );
    expect(mapped.ok).toBe(false);
  });
});

it.each(['[]', 'null', '4', '"text"', '{'])(
  'rejects native-invalid continuation arguments %s',
  (argumentsJSON) => {
    const call = { id: 'synthetic-call', name: 'synthetic_tool', arguments: {} };
    const mapped = prepareRequest(
      'synthetic-model',
      {
        messages: [{ role: 'assistant', content: '', toolCalls: [call] }],
      },
      new Map([
        [
          call.id,
          [
            JSON.stringify({
              type: 'function_call',
              id: 'synthetic-item',
              call_id: call.id,
              name: call.name,
              arguments: argumentsJSON,
            }),
          ],
        ],
      ]),
    );
    expect(mapped.ok).toBe(false);
  },
);
