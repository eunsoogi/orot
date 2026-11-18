import {
  healthContextFixture,
  window,
  signal,
} from '../testSupport/healthContextPersistenceFixture';
import {
  capturedPeriodReader,
  createCapturePeriodReads,
  registerConversationPeriodReadLease,
} from '../conversationPeriodReadLease';
import {
  inheritConversationReadOperation,
  registerConversationReadOperation,
  withConversationReadOperation,
} from '../conversationReadOperation';
import type { AiFeatureLocalData } from '../localData';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';

const unused = async () => {
  throw new Error('Unused summary');
};
async function escaped(data: AiFeatureLocalData) {
  let read: HealthContextReader | undefined;
  await withConversationReadOperation(data, async scoped => {
    read = scoped.readHealthContext!;
  });
  return read!;
}

test('same owner shares only fresh capture calculations; active callers keep their own hydration', async () => {
  const f = await healthContextFixture();
  const data = { readHealthContext: f.read } as AiFeatureLocalData;
  registerConversationReadOperation(data, unused);
  const scope = createCapturePeriodReads(signal);
  const transaction = f.database.transaction.bind(f.database);
  let count = 0;
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = (...args) => {
        if (/WITH days\(/.test(args[0])) count++;
        return execute(...args);
      };
      await work(tx);
    });
  try {
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'outside-sharing',
      effectiveAt: '2028-01-01T00:00:00Z',
    });
    const a = await escaped(data);
    const first = scope.forReader(a, f.registry, capturedPeriodReader(a));
    expect(first).not.toBe(a);
    await first(window, ['measurements'], signal);
    expect(count).toBe(2);
    let b: HealthContextReader | undefined;
    await withConversationReadOperation(data, async scoped => {
      b = scoped.readHealthContext!;
      expect(scope.forReader(b, f.registry, capturedPeriodReader(b))).toBe(b);
      await b(window, ['measurements'], signal);
      expect(count).toBe(4);
    });
    await scope.forReader(b!, f.registry, capturedPeriodReader(b!))(
      window,
      ['measurements'],
      signal,
    );
    expect(count).toBe(4);
    const target = { ...data };
    inheritConversationReadOperation(data, target);
    const other = await escaped(target);
    await scope.forReader(other, f.registry, capturedPeriodReader(other))(
      window,
      ['measurements'],
      signal,
    );
    expect(count).toBe(6); // Inherited target is a distinct authority, not just the same DB.
    const deny = jest.fn(async () => {
      throw new Error('Replaced caller');
    });
    Object.assign(target, { readHealthContext: deny });
    await expect(
      scope.forReader(other, f.registry, capturedPeriodReader(other))(
        window,
        ['measurements'],
        signal,
      ),
    ).rejects.toThrow('Replaced caller');
    await first(window, ['measurements'], signal);
    expect(count).toBe(6);
    registerConversationReadOperation(data, unused);
    expect(scope.forReader(a, f.registry, capturedPeriodReader(a))).toBe(a);
    expect(scope.forReader(b!, f.registry, capturedPeriodReader(b!))).toBe(b);
    const replacement = await escaped(data);
    await scope.forReader(
      replacement,
      f.registry,
      capturedPeriodReader(replacement),
    )(window, ['measurements'], signal);
    expect(count).toBe(8);
  } finally {
    scope.dispose();
    f.database.transaction = transaction;
    f.close();
  }
});

test('re-registering the same proxy revokes earlier unopened and open issuance', async () => {
  const f = await healthContextFixture();
  const data = { readHealthContext: f.read } as AiFeatureLocalData;
  registerConversationReadOperation(data, unused);
  const scope = createCapturePeriodReads(signal);
  try {
    const proxy = await escaped(data),
      issuance = capturedPeriodReader(proxy)!;
    const open = scope.forReader(proxy, f.registry, issuance);
    await open(window, ['measurements'], signal);
    registerConversationPeriodReadLease(
      proxy,
      {},
      () => false,
      () => undefined,
    );
    expect(scope.forReader(proxy, f.registry, issuance)).toBe(proxy);
    await f.repository.delete('health_observation', f.inside.id);
    expect(
      (await open(window, ['measurements'], signal)).deletionGeneration,
    ).not.toBe(f.report.deletionGeneration);
  } finally {
    scope.dispose();
    f.close();
  }
});
