import { registerConversationReadOperation } from '../conversationReadOperation';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import type { AiFeatureLocalData } from '../localData';
import type { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';

async function fixture() {
  const f = await diverseHistoryProfileFixture(3, true);
  const data = await f.input.loadLocalData();
  const summaries = createSymptomSummaryStorage(f.database);
  const reads: string[] = [];
  let hook: (id: string) => Promise<void> = async () => {};
  const factory = async (
    scoped: AiFeatureLocalData,
    registry: LocalEvidenceReferenceRegistry,
  ) => {
    const discovery = createSummaryArtifactDiscovery({
      database: f.database,
      storage: summaries,
      data: scoped,
      registry,
    });
    return {
      ...discovery,
      read: async (id: string, signal?: AbortSignal) => {
        reads.push(id);
        await hook(id);
        return discovery.read(id, signal);
      },
    };
  };
  data.summaryArtifactDiscovery = registry => factory(data, registry);
  registerConversationReadOperation(data, factory);
  return {
    ...f,
    data,
    reads,
    setHook(value: typeof hook) {
      hook = value;
    },
  };
}

test.each(['delete', 'cancel', 'error'] as const)(
  'capture scope preserves final %s rejection and source callback ordering',
  async mode => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      const saved = (await f.storage.read('turn-2'))!;
      let changed = false;
      f.setHook(async id => {
        if (id !== 'summary-1' || changed) return;
        changed = true;
        if (mode === 'delete')
          await f.database.execute(
            "DELETE FROM conversation_artifacts WHERE id='turn-2'",
          );
        if (mode === 'cancel') controller.abort();
        if (mode === 'error') throw new Error('Synthetic source failure');
      });
      const owner = f.discovery.captureOwner!;
      if (mode === 'delete') {
        const pending = await owner.prepare(
          [{ id: saved.id, revision: fingerprint(saved) }],
          controller.signal,
        );
        expect(await pending.finish()).toBe(false);
      } else {
        await expect(
          owner.prepare(
            [{ id: saved.id, revision: fingerprint(saved) }],
            controller.signal,
          ),
        ).rejects.toThrow();
      }
      expect(changed).toBe(true);
      expect(f.reads.slice(0, 2)).toEqual(['summary-2', 'summary-1']);
    } finally {
      f.close();
    }
  },
);

test('page scope aliases still use strict live source readers after release', async () => {
  const f = await fixture();
  try {
    const page = await f.discovery.readSession({
      sessionId: 'session',
      ids: ['turn-2'],
      signal: new AbortController().signal,
    });
    expect(page.items.map(item => item.id)).toEqual(['turn-2']);
    expect(f.reads).toEqual(['summary-2', 'summary-1', 'summary-0']);
    const source = page.items[0]!.sources[0]!;
    expect(
      (await f.input.registry.readSource(source, new AbortController().signal))
        .status,
    ).toBe('available');
    await f.database.execute('DELETE FROM health_observations WHERE id = ?', [
      f.inside.id,
    ]);
    expect(
      (await f.input.registry.readSource(source, new AbortController().signal))
        .status,
    ).not.toBe('available');
  } finally {
    f.close();
  }
});
