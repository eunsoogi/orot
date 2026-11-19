import {
  registerConversationReadOperation,
  withConversationReadOperation,
} from '../conversationReadOperation';
import type { AiFeatureLocalData } from '../localData';
import type { HealthContextReader } from '../../../healthEvidence/healthContext/reader';
import {
  healthContextFixture,
  signal,
  window,
} from '../testSupport/healthContextPersistenceFixture';
import {
  createCapturePeriodReads,
  capturedPeriodReader,
} from '../conversationPeriodReadLease';

test.each(['foreign', 'replacement'] as const)(
  '%s scope cannot inject a stale report into strict callbacks',
  async mode => {
    const f = await healthContextFixture();
    const genuine = createCapturePeriodReads(signal);
    const fake = jest.fn(async () => f.report);
    const scope =
      mode === 'foreign' ? { forReader: () => fake, dispose() {} } : genuine;
    if (mode === 'replacement')
      Object.assign(genuine, { forReader: () => fake });
    await f.repository.delete('health_observation', f.inside.id);
    try {
      expect(
        (await f.registry.readSource(f.item, signal, scope)).status,
      ).not.toBe('available');
      expect(fake).not.toHaveBeenCalled();
    } finally {
      genuine.dispose();
      f.close();
    }
  },
);

test.each(['forged', 'mismatched', 'replaced'] as const)(
  '%s issuance cannot confer another reader authority',
  async mode => {
    const a = await healthContextFixture(),
      b = await healthContextFixture();
    const scope = createCapturePeriodReads(signal);
    const fake = jest.fn(async () => a.report);
    const issuance =
      mode === 'forged'
        ? {
            key: {},
            current: () => true,
            open: () => ({ read: fake, dispose() {} }),
          }
        : capturedPeriodReader(mode === 'mismatched' ? b.read : a.read)!;
    if (mode === 'replaced')
      Object.assign(issuance, { open: () => ({ read: fake, dispose() {} }) });
    try {
      await a.repository.delete('health_observation', a.inside.id);
      const reader = scope.forReader(a.read, a.registry, issuance);
      expect(reader).toBe(a.read);
      expect(
        (await reader(window, ['measurements'], signal)).deletionGeneration,
      ).not.toBe(a.report.deletionGeneration);
      expect(fake).not.toHaveBeenCalled();
    } finally {
      scope.dispose();
      a.close();
      b.close();
    }
  },
);

test('mutating a returned proxy issuance cannot recertify its private factory record', async () => {
  const f = await healthContextFixture();
  const scope = createCapturePeriodReads(signal);
  const data = { readHealthContext: f.read } as AiFeatureLocalData;
  registerConversationReadOperation(data, async () => {
    throw new Error('Unused');
  });
  let proxy: HealthContextReader | undefined;
  await withConversationReadOperation(data, async scoped => {
    proxy = scoped.readHealthContext!;
  });
  const old = capturedPeriodReader(proxy!)!;
  const fake = jest.fn(async () => f.report);
  Object.assign(old, { open: () => ({ read: fake, dispose() {} }) });
  try {
    await f.repository.delete('health_observation', f.inside.id);
    const fresh = capturedPeriodReader(proxy!)!;
    expect(fresh).not.toBe(old);
    const read = scope.forReader(proxy!, f.registry, fresh);
    expect(
      (await read(window, ['measurements'], signal)).deletionGeneration,
    ).not.toBe(f.report.deletionGeneration);
    expect(fake).not.toHaveBeenCalled();
  } finally {
    scope.dispose();
    f.close();
  }
});
