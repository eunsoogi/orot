import { describe, expect, it } from '@jest/globals';
import { CompletedContinuationCache } from '../src/completed-continuation';
import { prepareRequest } from '../src/request-mapper';

const call = { id: 'synthetic-call', name: 'synthetic_tool', arguments: {} };

function matchedCache(item: unknown) {
  const cache = new CompletedContinuationCache();
  cache.settle(new Map(), [call], { text: '', continuationItems: [JSON.stringify(item)] });
  return cache;
}

// Synthetic bridge mapping only; never invoke a provider or native transport.
describe('native request validation boundary', () => {
  it('maps a valid tool follow-up larger than the native builder byte cutoff', () => {
    const mapped = prepareRequest('synthetic-model', {
      messages: [
        { role: 'user', content: 'Synthetic request' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [call],
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
            toolCalls: [call],
          },
        ],
      },
      matchedCache({ type: 'function_call' }),
    );
    expect(mapped.ok).toBe(false);
  });
});

it.each(['[]', 'null', '4', '"text"', '{'])(
  'rejects native-invalid continuation arguments %s',
  (argumentsJSON) => {
    const mapped = prepareRequest(
      'synthetic-model',
      {
        messages: [{ role: 'assistant', content: '', toolCalls: [call] }],
      },
      matchedCache({
        type: 'function_call',
        id: 'synthetic-item',
        call_id: call.id,
        name: call.name,
        arguments: argumentsJSON,
      }),
    );
    expect(mapped.ok).toBe(false);
  },
);
