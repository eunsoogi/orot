import type { OutboundProcessingRequest, ConsentDecision } from '../src';
import { providerSuccess } from '@orot/model-runtime';
import { generateContextualInitialReply } from '../src/multiAgent/contextualInitialReply';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';

function fixture() {
  const run = standardSearchFixture(true);
  const controller = new AbortController();
  const authorize = jest.fn(
    async (_request: OutboundProcessingRequest): Promise<ConsentDecision> => 'authorized',
  );
  run.provider.generate
    .mockResolvedValueOnce(
      providerSuccess({
        text: '요청하신 흐름을 살펴볼게요.',
        toolCalls: [],
        finishReason: 'complete',
      }),
    )
    .mockResolvedValueOnce(
      providerSuccess({ text: 'ALLOW', toolCalls: [], finishReason: 'complete' }),
    );
  return {
    run,
    controller,
    authorize,
    input: {
      provider: run.provider,
      execution: run.options.execution,
      consent: { authorize },
      request: '합성 요청의 흐름을 설명해 줘',
      signal: controller.signal,
      validate: (text: string) => text,
    },
  };
}

test('reviews model-authored contextual text with exact consent and no evidence or tools', async () => {
  const f = fixture();
  expect(await generateContextualInitialReply(f.input)).toBe('요청하신 흐름을 살펴볼게요.');
  expect(f.run.provider.generate).toHaveBeenCalledTimes(2);
  expect(f.authorize).toHaveBeenCalledTimes(2);
  const first = f.run.provider.generate.mock.calls[0]![0];
  expect(first.messages[1]?.content).toBe(f.input.request);
  expect(first.tools).toBeUndefined();
  expect(f.authorize.mock.calls[0]![0].payload).toEqual(first);
  expect(f.run.search).not.toHaveBeenCalled();
});

test('a denied preview has no provider effect and does not throw', async () => {
  const f = fixture();
  f.input.consent.authorize = async () => 'renewal_required';
  expect(await generateContextualInitialReply(f.input)).toBeUndefined();
  expect(f.run.provider.generate).not.toHaveBeenCalled();
});

test('local rejection does not spend a reviewer call', async () => {
  const f = fixture();
  expect(
    await generateContextualInitialReply({ ...f.input, validate: () => undefined }),
  ).toBeUndefined();
  expect(f.run.provider.generate).toHaveBeenCalledTimes(1);
});

test('Stop rejects a late provider result without reviewer or output', async () => {
  const f = fixture();
  f.run.provider.generate.mockReset().mockImplementation(async () => {
    f.controller.abort();
    return providerSuccess({ text: 'late', toolCalls: [], finishReason: 'complete' });
  });
  expect(await generateContextualInitialReply(f.input)).toBeUndefined();
  expect(f.run.provider.generate).toHaveBeenCalledTimes(1);
});

test('deadline releases the final task even when the provider ignores abort', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture();
    f.run.provider.generate.mockReset().mockImplementation(() => new Promise(() => {}));
    const pending = generateContextualInitialReply(f.input);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeUndefined();
    expect(f.run.provider.generate).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test('pending consent expires without provider dispatch or blocking the caller', async () => {
  jest.useFakeTimers();
  try {
    const f = fixture();
    f.input.consent.authorize = () => new Promise(() => {});
    const pending = generateContextualInitialReply(f.input);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeUndefined();
    expect(f.run.provider.generate).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
