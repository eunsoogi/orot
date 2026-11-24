import {
  reviewOpenAiVoicePair,
  selectOpenAiVoicePair,
} from '../reviewOpenAiVoicePair';

const catalog = {
  revision: 1,
  fresh: true,
  speechIds: ['gpt-live-1.1'],
  toolIds: ['gpt-6-sol'],
  speechModel: 'gpt-live-1.1',
  backendModel: 'gpt-6-sol',
};
test.each([
  { fresh: false },
  { revision: null },
  { speechModel: undefined },
  { backendModel: undefined },
  { backendModel: 'gpt-6-luna' },
])('does not admit a stale or incomplete choice %j', overrides => {
  expect(selectOpenAiVoicePair({ ...catalog, ...overrides })).toBeUndefined();
});

test.each([
  'success',
  'deny speech',
  'deny tools',
  'abort tools',
  'change account',
] as const)(
  'publishes only after both exact settings reviews: %s',
  async scenario => {
    const pair = selectOpenAiVoicePair(catalog)!;
    const abort = new AbortController();
    let siteCurrent = true;
    const commit = jest.fn(async () => undefined);
    const review = jest
      .fn()
      .mockImplementationOnce(async () => scenario !== 'deny speech');
    review.mockImplementationOnce(async () => {
      if (scenario === 'abort tools') abort.abort();
      if (scenario === 'change account') siteCurrent = false;
      return scenario !== 'deny tools';
    });
    const result = await reviewOpenAiVoicePair({
      pair,
      signal: abort.signal,
      current: () => siteCurrent,
      review,
      commit,
    });
    expect(review.mock.calls[0]?.[0]).toMatchObject({
      modelId: 'gpt-live-1.1',
      recipient: 'OpenAI Live API',
    });
    if (scenario !== 'deny speech')
      expect(review.mock.calls[1]?.[0]).toMatchObject({
        modelId: 'gpt-6-sol',
        recipient: 'OpenAI Responses (Live)',
      });
    expect(commit).toHaveBeenCalledTimes(scenario === 'success' ? 1 : 0);
    expect(result).toBe(scenario === 'success');
  },
);
