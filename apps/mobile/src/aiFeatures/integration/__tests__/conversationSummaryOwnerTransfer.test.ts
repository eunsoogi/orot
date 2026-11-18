import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { AiFeatureLocalData } from '../localData';
import {
  inheritConversationReadOperation,
  registerConversationReadOperation,
  withConversationReadOperation,
} from '../conversationReadOperation';

/** Retaining a factory function must not retain an expired report capability. */
test.each([
  'source-summary',
  'target-summary',
  'source-read',
  'target-read',
  'reregister',
  'dispose',
] as const)('escaped summary factory is strict after %s', async mode => {
  const f = await healthContextFixture();
  const source = {
    ...(createLocalEvidenceData(f.database) as AiFeatureLocalData),
  };
  const build = (
    data: AiFeatureLocalData,
    registry: LocalEvidenceReferenceRegistry,
  ) =>
    Promise.resolve(
      createSummaryArtifactDiscovery({
        database: f.database,
        storage: f.storage,
        data,
        registry,
      }),
    );
  const factory = jest.fn(build);
  const original = jest.fn((registry: LocalEvidenceReferenceRegistry) =>
    build(source, registry),
  );
  source.summaryArtifactDiscovery = original;
  registerConversationReadOperation(source, factory);
  const target = { ...source };
  const replacement = jest.fn((registry: LocalEvidenceReferenceRegistry) =>
    build(target, registry),
  );
  inheritConversationReadOperation(source, target);
  const registry = new LocalEvidenceReferenceRegistry();
  let escaped = target.summaryArtifactDiscovery!;
  const verifyFallback = async () => {
    const before = factory.mock.calls.length;
    const discovery = await escaped(registry);
    expect(factory).toHaveBeenCalledTimes(before);
    const expected = mode === 'target-summary' ? replacement : original;
    expect(expected).toHaveBeenCalledTimes(1);
    expect(expected).toHaveBeenLastCalledWith(registry);
    expect(
      await discovery.read(f.saved.id, new AbortController().signal),
    ).not.toBeNull();
    await f.repository.delete('health_observation', f.inside.id);
    expect(
      await discovery.read(f.saved.id, new AbortController().signal),
    ).toBeNull();
  };
  try {
    await f.storage.append(f.saved);
    await withConversationReadOperation(target, async scoped => {
      escaped = scoped.summaryArtifactDiscovery!;
      await escaped(registry);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenLastCalledWith(scoped, registry);
      expect(original).not.toHaveBeenCalled();
      if (mode === 'source-summary')
        source.summaryArtifactDiscovery = replacement;
      if (mode === 'target-summary')
        target.summaryArtifactDiscovery = replacement;
      if (mode === 'source-read')
        source.readHealthContext = (...args) => f.read(...args);
      if (mode === 'target-read')
        target.readHealthContext = (...args) => f.read(...args);
      if (mode === 'reregister')
        registerConversationReadOperation(source, factory);
      if (mode !== 'dispose') await verifyFallback();
    });
    if (mode === 'dispose') await verifyFallback();
  } finally {
    f.close();
  }
});
