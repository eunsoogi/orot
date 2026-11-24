import { createTypedHeartRateDispatch } from '../typedHeartRateReusePolicy';
import { guardTypedHeartRateProvider } from '../typedHeartRateProviderGuard';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple } from '../featureServiceFixtures';
import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';

const fixtureSource = {
  acquire: () => ({ current: () => true, dispose: () => {} }),
  reprove: async () => true,
};
const reference = {
  sourceKind: 'personal_record',
  sourceId: 'typed',
  evidenceId: 'typed',
  sourceRevision: 'revision',
  evidenceRevision: 'revision',
  locator: {
    kind: 'health_context_period',
    window: { typedHeartRateCategory: 'resting_heart_rate' },
  },
  effectiveTime: null,
  reviewState: 'unknown',
} as const;

test('one actual model disclosure and no borrowed scope after selection changes', async () => {
  const generate = jest.fn(async () =>
    providerSuccess({ text: 'synthetic', finishReason: 'stop' as const }),
  );
  const registry = new LocalEvidenceReferenceRegistry();
  const dispatch = createTypedHeartRateDispatch();
  const guarded = guardTypedHeartRateProvider({ ...apple.provider, generate }, dispatch);
  const payload = {
    messages: [{ role: 'user', content: 'synthetic' }],
    modelId: apple.modelId,
  } as unknown as LanguageModelRequest;
  const signal = new AbortController().signal;
  expect(await guarded.generate(payload, { signal })).toMatchObject({ ok: true });
  let current = true;
  dispatch.bind(
    reference,
    () => current,
    async () => current,
    fixtureSource,
  );
  expect(await dispatch.revalidate(registry, [reference], signal)).toBe(true);
  expect(
    await dispatch.revalidate(registry, [{ ...reference, sourceId: 'different' }], signal),
  ).toBe(false);
  expect(await guarded.generate(payload, { signal })).toMatchObject({ ok: true });
  expect(await guarded.generate(payload, { signal })).toMatchObject({ ok: false });
  expect(generate).toHaveBeenCalledTimes(2);
  current = false;
  expect(await dispatch.revalidate(registry, [reference], signal)).toBe(false);
  const separate = createTypedHeartRateDispatch();
  expect(await separate.revalidate(registry, [reference], signal)).toBe(false);
  const another = {
    ...reference,
    sourceId: 'walking',
    evidenceId: 'walking',
    locator: {
      kind: 'health_context_period',
      window: { typedHeartRateCategory: 'walking_heart_rate_average' },
    },
  };
  separate.bind(
    another,
    () => true,
    async () => true,
    fixtureSource,
  );
  expect(await separate.revalidate(registry, [another], signal)).toBe(true);
  expect(
    await guardTypedHeartRateProvider({ ...apple.provider, generate }, separate).generate(payload, {
      signal,
    }),
  ).toMatchObject({ ok: true });
  expect(generate).toHaveBeenCalledTimes(3);
});

test('recipient replacement during dispatch consumes authority without provider execution', async () => {
  const generate = jest.fn();
  const dispatch = createTypedHeartRateDispatch();
  let current = true;
  dispatch.bind(
    reference,
    () => current,
    async () => {
      current = false;
      return true;
    },
    fixtureSource,
  );
  const guarded = guardTypedHeartRateProvider({ ...apple.provider, generate }, dispatch);
  const request = {} as LanguageModelRequest;
  expect(await guarded.generate(request)).toMatchObject({ ok: false });
  current = true;
  expect(await guarded.generate(request)).toMatchObject({ ok: false });
  expect(generate).not.toHaveBeenCalled();
});

test('stream starts its first next synchronously under the same source witness', async () => {
  const started = jest.fn();
  const dispose = jest.fn();
  const dispatch = createTypedHeartRateDispatch();
  let current = true;
  const order: string[] = [];
  dispatch.bind(
    reference,
    () => true,
    async () => true,
    {
      acquire: () => ({
        current: () => {
          order.push('epoch-current');
          return current;
        },
        dispose,
      }),
      reprove: async () => true,
    },
  );
  const guarded = guardTypedHeartRateProvider(
    {
      ...apple.provider,
      async *stream() {
        order.push('provider-first-next');
        started();
        yield providerSuccess({ type: 'text_delta', text: 'synthetic' } as const);
      },
    },
    dispatch,
  );
  const request = {} as LanguageModelRequest;
  const iterator = guarded.stream!(request)[Symbol.asyncIterator]();
  expect(await iterator.next()).toMatchObject({ value: { ok: true } });
  expect(order).toEqual(['epoch-current', 'provider-first-next']);
  await iterator.return?.();
  expect(dispose).toHaveBeenCalledTimes(1);
  current = false;
  expect(await guarded.stream!(request)[Symbol.asyncIterator]().next()).toMatchObject({
    value: { ok: false },
  });
  expect(started).toHaveBeenCalledTimes(1);
});
