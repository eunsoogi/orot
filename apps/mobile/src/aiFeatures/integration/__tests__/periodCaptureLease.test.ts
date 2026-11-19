import {
  healthContextFixture,
  window,
  signal,
} from '../testSupport/healthContextPersistenceFixture';
import {
  capturedPeriodReader,
  createCapturePeriodReads,
} from '../conversationPeriodReadLease';
import {
  registerConversationReadOperation,
  withConversationReadOperation,
} from '../conversationReadOperation';
import { registerHealthContextReadOwner } from '../../../healthEvidence/healthContext/healthContextReadOperation';
import type { AiFeatureLocalData } from '../localData';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';

async function fixture() {
  const f = await healthContextFixture();
  // This unit exercises only the owned read/summary adapter; no feature services use it.
  const data = { readHealthContext: f.read } as AiFeatureLocalData;
  const factory = jest.fn(async () => {
    throw new Error('Unused summary');
  });
  registerConversationReadOperation(data, factory);
  const transaction = f.database.transaction.bind(f.database);
  let calculations = 0;
  let queue = Promise.resolve();
  f.database.transaction = work => {
    const next = queue.then(() =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = (...args) => {
          if (/WITH days\(/.test(args[0])) calculations++;
          return execute(...args);
        };
        await work(tx);
      }),
    );
    queue = next.catch(() => undefined);
    return next;
  };
  await f.repository.put('health_observation', {
    ...f.inside,
    id: 'outside',
    effectiveAt: '2028-01-01T00:00:00Z',
  });
  return {
    ...f,
    data,
    factory,
    calculations: () => calculations,
    close: () => {
      f.database.transaction = transaction;
      f.close();
    },
  };
}

test('active hydration cannot open a capture lease; disposed hydration lends only a fresh lifetime', async () => {
  const f = await fixture();
  const capture = createCapturePeriodReads(signal);
  let proxy: HealthContextReader | undefined;
  try {
    await withConversationReadOperation(
      f.data,
      async data => {
        proxy = data.readHealthContext!;
        const issued = capturedPeriodReader(proxy);
        expect(capture.forReader(proxy, f.registry, issued)).toBe(proxy);
        await proxy(window, ['measurements'], signal);
      },
      signal,
    );
    expect(f.calculations()).toBe(2);
    const scoped = capture.forReader(
      proxy!,
      f.registry,
      capturedPeriodReader(proxy!),
    );
    await scoped(window, ['measurements'], signal);
    expect(f.calculations()).toBe(4); // Never reuses the ended hydration cache.
    await scoped(window, ['measurements'], signal);
    expect(f.calculations()).toBe(4);
    capture.dispose();
    await scoped(window, ['measurements'], signal);
    expect(f.calculations()).toBe(6);
  } finally {
    capture.dispose();
    f.close();
  }
});

test.each(['read', 'summary', 'registration'] as const)(
  'late data %s change revokes escaped proxy calculation authority',
  async change => {
    const f = await fixture();
    const capture = createCapturePeriodReads(signal);
    let proxy: HealthContextReader | undefined;
    try {
      await withConversationReadOperation(
        f.data,
        async data => {
          proxy = data.readHealthContext!;
        },
        signal,
      );
      const scoped = capture.forReader(
        proxy!,
        f.registry,
        capturedPeriodReader(proxy!),
      );
      await scoped(window, ['measurements'], signal);
      const deny = jest.fn(async () => {
        throw new Error('Late reader');
      });
      if (change === 'read') Object.assign(f.data, { readHealthContext: deny });
      if (change === 'summary')
        f.data.summaryArtifactDiscovery = async () => {
          throw new Error('Late summary');
        };
      if (change === 'registration')
        registerConversationReadOperation(f.data, f.factory);
      if (change === 'read') {
        await expect(scoped(window, ['measurements'], signal)).rejects.toThrow(
          'Late reader',
        );
        expect(deny).toHaveBeenCalledTimes(1);
      } else {
        await scoped(window, ['measurements'], signal);
        expect(f.calculations()).toBe(4); // Original raw fallback, not old scoped report.
      }
    } finally {
      capture.dispose();
      f.close();
    }
  },
);

test('raw factory re-registration revokes both unopened and open issuance', async () => {
  const f = await fixture();
  const first = createCapturePeriodReads(signal),
    second = createCapturePeriodReads(signal);
  const issued = capturedPeriodReader(f.read);
  try {
    const scoped = first.forReader(f.read, f.registry, issued);
    await scoped(window, ['measurements'], signal);
    const replacement = jest.fn(() => f.read);
    registerHealthContextReadOwner(f.read, f.database, replacement);
    expect(second.forReader(f.read, f.registry, issued)).toBe(f.read);
    await scoped(window, ['measurements'], signal);
    expect(f.calculations()).toBe(4);
    expect(replacement).not.toHaveBeenCalled();
  } finally {
    first.dispose();
    second.dispose();
    f.close();
  }
});

test('two capture scopes and ordinary live reads never borrow each other cache; foreign registry falls back', async () => {
  const f = await fixture();
  const a = createCapturePeriodReads(signal),
    b = createCapturePeriodReads(signal);
  const issued = capturedPeriodReader(f.read);
  try {
    const one = a.forReader(f.read, f.registry, issued),
      two = b.forReader(f.read, f.registry, issued);
    await Promise.all([
      one(window, ['measurements'], signal),
      two(window, ['measurements'], signal),
      f.read(window, ['measurements'], signal),
    ]);
    expect(f.calculations()).toBe(6);
    expect(a.forReader(f.read, {}, issued)).toBe(f.read);
    await f.repository.delete('health_observation', f.inside.id);
    expect(
      (await one(window, ['measurements'], signal)).deletionGeneration,
    ).not.toBe(f.report.deletionGeneration);
  } finally {
    a.dispose();
    b.dispose();
    f.close();
  }
});

test('abort clears a request and already-aborted scope cannot open any lease', async () => {
  const f = await fixture();
  const controller = new AbortController();
  const scope = createCapturePeriodReads(controller.signal);
  try {
    const read = scope.forReader(
      f.read,
      f.registry,
      capturedPeriodReader(f.read),
    );
    await read(window, ['measurements'], signal);
    controller.abort();
    expect(
      scope.forReader(f.read, f.registry, capturedPeriodReader(f.read)),
    ).toBe(f.read);
    const closed = createCapturePeriodReads(controller.signal);
    expect(
      closed.forReader(f.read, f.registry, capturedPeriodReader(f.read)),
    ).toBe(f.read);
    closed.dispose();
    await f.repository.delete('health_observation', f.inside.id);
    expect(
      (await read(window, ['measurements'], signal)).deletionGeneration,
    ).not.toBe(f.report.deletionGeneration);
  } finally {
    scope.dispose();
    f.close();
  }
});
