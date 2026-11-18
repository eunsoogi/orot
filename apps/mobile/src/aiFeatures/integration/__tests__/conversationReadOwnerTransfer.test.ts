import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import type { AiFeatureLocalData } from '../localData';
import {
  inheritConversationReadOperation,
  registerConversationReadOperation,
  withConversationReadOperation,
} from '../conversationReadOperation';

async function fixture() {
  const f = await healthContextFixture();
  const source = {
    ...(createLocalEvidenceData(f.database) as AiFeatureLocalData),
  };
  const factory = (
    data: AiFeatureLocalData,
    registry: Parameters<
      NonNullable<AiFeatureLocalData['summaryArtifactDiscovery']>
    >[0],
  ) =>
    Promise.resolve(
      createSummaryArtifactDiscovery({
        database: f.database,
        storage: f.storage,
        data,
        registry,
      }),
    );
  source.summaryArtifactDiscovery = registry => factory(source, registry);
  registerConversationReadOperation(source, factory);
  return { ...f, source, factory };
}

test.each([
  'unregistered',
  'source-read',
  'source-summary',
  'target-read',
  'target-summary',
] as const)(
  'a changed or unregistered %s owner cannot transfer authority',
  async mode => {
    const f = await fixture();
    try {
      let source = f.source;
      const target = { ...source };
      if (mode === 'unregistered') source = { ...source };
      if (mode === 'source-read')
        source.readHealthContext = (...args) => f.read(...args);
      if (mode === 'source-summary')
        source.summaryArtifactDiscovery = registry =>
          f.factory(source, registry);
      if (mode === 'target-read')
        target.readHealthContext = (...args) => f.read(...args);
      if (mode === 'target-summary')
        target.summaryArtifactDiscovery = registry =>
          f.factory(target, registry);
      inheritConversationReadOperation(source, target);
      await withConversationReadOperation(target, async scoped => {
        expect(scoped).toBe(target);
      });
    } finally {
      f.close();
    }
  },
);

test.each([
  'source',
  'target',
  'source-read',
  'target-read',
  'reregister',
  'dispose',
] as const)(
  'an escaped read falls back strictly after late %s change',
  async mode => {
    const f = await fixture();
    const target = { ...f.source };
    inheritConversationReadOperation(f.source, target);
    const transaction = f.database.transaction.bind(f.database);
    let transactions = 0;
    f.database.transaction = work => {
      transactions++;
      return transaction(work);
    };
    let escaped = target.readHealthContext!;
    const replacement = jest.fn((...args: Parameters<typeof f.read>) =>
      f.read(...args),
    );
    try {
      await withConversationReadOperation(target, async scoped => {
        expect(scoped).not.toBe(target);
        escaped = scoped.readHealthContext!;
        await escaped(f.report.window, ['measurements']);
        const before = transactions;
        await escaped(f.report.window, ['measurements']);
        expect(transactions).toBe(before);
        if (mode === 'source')
          f.source.summaryArtifactDiscovery = registry =>
            f.factory(f.source, registry);
        if (mode === 'target')
          target.summaryArtifactDiscovery = registry =>
            f.factory(target, registry);
        if (mode === 'source-read') f.source.readHealthContext = replacement;
        if (mode === 'target-read') target.readHealthContext = replacement;
        if (mode === 'reregister')
          registerConversationReadOperation(f.source, f.factory);
        if (mode !== 'dispose') {
          expect(scoped.readHealthContext).toBe(target.readHealthContext);
          await escaped(f.report.window, ['measurements']);
          if (mode === 'target-read')
            expect(replacement).toHaveBeenCalledTimes(1);
          else expect(transactions).toBe(before + 1);
        }
      });
      const before = transactions;
      if (mode === 'dispose') {
        await escaped(f.report.window, ['measurements']);
        expect(transactions).toBe(before + 1);
      }
      await f.repository.delete('health_observation', f.inside.id);
      const afterDelete = await escaped(f.report.window, ['measurements']);
      expect(afterDelete.deletionGeneration).toBeGreaterThan(
        f.report.deletionGeneration,
      );
      const controller = new AbortController();
      controller.abort();
      await expect(
        escaped(f.report.window, ['measurements'], controller.signal),
      ).rejects.toThrow();
    } finally {
      f.database.transaction = transaction;
      f.close();
    }
  },
);

test('a reader from another actual database cannot inherit the source owner', async () => {
  const first = await fixture();
  const second = await fixture();
  try {
    const target = {
      ...first.source,
      readHealthContext: second.source.readHealthContext,
    };
    inheritConversationReadOperation(first.source, target);
    await withConversationReadOperation(target, async scoped => {
      expect(scoped).toBe(target);
    });
  } finally {
    first.close();
    second.close();
  }
});

test('an active inherited scope retains deletion generations and operation cancellation', async () => {
  const f = await fixture();
  const target = { ...f.source };
  const controller = new AbortController();
  inheritConversationReadOperation(f.source, target);
  try {
    await withConversationReadOperation(
      target,
      async scoped => {
        const before = await scoped.readHealthContext!(f.report.window, [
          'measurements',
        ]);
        await f.repository.delete('health_observation', f.inside.id);
        const after = await scoped.readHealthContext!(f.report.window, [
          'measurements',
        ]);
        expect(after.deletionGeneration).toBeGreaterThan(
          before.deletionGeneration,
        );
        controller.abort();
        await expect(
          scoped.readHealthContext!(f.report.window, ['measurements']),
        ).rejects.toThrow();
      },
      controller.signal,
    );
  } finally {
    f.close();
  }
});
