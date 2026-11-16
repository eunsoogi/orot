import { providerSuccess } from '@orot/model-runtime';
import { generateContextualInitialReply } from '../src/multiAgent/contextualInitialReply';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';

function fixture(verdict = 'ALLOW') {
  const f = standardSearchFixture(true);
  const controller = new AbortController();
  const onObservation = jest.fn();
  const authorize = jest.fn(async () => 'authorized' as const);
  f.provider.generate
    .mockReset()
    .mockResolvedValueOnce(
      providerSuccess({
        text: '요청의 흐름을 살펴볼게요.',
        toolCalls: [],
        finishReason: 'complete',
      }),
    )
    .mockResolvedValueOnce(
      providerSuccess({ text: verdict, toolCalls: [], finishReason: 'complete' }),
    );
  return {
    ...f,
    controller,
    onObservation,
    input: {
      provider: f.provider,
      execution: f.options.execution,
      request: 'synthetic private request',
      consent: { authorize },
      signal: controller.signal,
      validate: (text: string) => text,
      onObservation,
    },
  };
}

test.each(['ALLOW', 'DENY'])(
  'reports review %s without candidate or request text',
  async (verdict) => {
    const f = fixture(verdict);
    const result = await generateContextualInitialReply(f.input);
    expect(result).toBe(verdict === 'ALLOW' ? '요청의 흐름을 살펴볼게요.' : undefined);
    expect(f.onObservation.mock.calls.at(-1)).toEqual([
      'opening_review',
      verdict === 'ALLOW' ? 'completed' : 'invalid_output',
    ]);
    expect(f.provider.generate).toHaveBeenCalledTimes(2);
    expect(f.input.consent.authorize).toHaveBeenCalledTimes(2);
    const observed = JSON.stringify(f.onObservation.mock.calls);
    expect(observed).not.toContain(f.input.request);
    expect(observed).not.toContain('요청의 흐름');
  },
);

test('local rejection is distinguished from semantic review failure without another call', async () => {
  const f = fixture();
  expect(
    await generateContextualInitialReply({ ...f.input, validate: () => undefined }),
  ).toBeUndefined();
  expect(f.onObservation.mock.calls.at(-1)).toEqual(['opening_validate', 'invalid_output']);
  expect(f.provider.generate).toHaveBeenCalledTimes(1);
});

test.each(['timeout', 'cancelled'] as const)(
  'distinguishes %s while still releasing the final task',
  async (kind) => {
    jest.useFakeTimers();
    try {
      const f = fixture();
      f.provider.generate.mockReset().mockImplementation(() => new Promise(() => {}));
      const pending = generateContextualInitialReply(f.input);
      await jest.advanceTimersByTimeAsync(1);
      if (kind === 'cancelled') f.controller.abort();
      else await jest.advanceTimersByTimeAsync(10_000);
      expect(await pending).toBeUndefined();
      expect(f.onObservation.mock.calls.at(-1)).toEqual(['opening_generate', kind]);
      expect(f.provider.generate).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  },
);

test.each(['sync', 'async'] as const)(
  'a %s failing observer cannot change calls or approved prose',
  async (kind) => {
    const f = fixture();
    f.onObservation.mockImplementation(() => {
      if (kind === 'sync') throw new Error('synthetic private sink error');
      return Promise.reject(new Error('synthetic private sink error'));
    });
    expect(await generateContextualInitialReply(f.input)).toBe('요청의 흐름을 살펴볼게요.');
    expect(f.provider.generate).toHaveBeenCalledTimes(2);
    expect(f.input.consent.authorize).toHaveBeenCalledTimes(2);
  },
);
