import type { EvidenceReference } from '@orot/agent-runtime';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import { restoreConversationParentSource } from '../restoreConversationParentSource';
import { captureConversationSources } from '../captureConversationSources';
import { bindConversationSources } from '../conversationSourceBindings';
import { createBoundConversationCaptureOwner } from '../boundConversationCapture';
import { fingerprint } from '../evidenceUtils';

async function fixture() {
  const f = await diverseHistoryProfileFixture(1, false);
  const registry = f.input.registry;
  const saved = (await f.storage.read('turn-0'))!;
  await f.storage.append({ ...saved, id: 'outer', sources: [], citations: [] });
  const outer = (await f.storage.read('outer'))!;
  const original: EvidenceReference = {
    sourceKind: 'generated_artifact',
    sourceId: saved.id,
    evidenceId: saved.id,
    sourceRevision: fingerprint(saved),
    evidenceRevision: fingerprint(saved),
    locator: { kind: 'generated_artifact', type: 'conversation_turn' },
    effectiveTime: null,
    reviewState: 'unreviewed',
  };
  const alias = await restoreConversationParentSource(
    {
      kind: 'generated_conversation',
      reference: original,
      id: saved.id,
      revision: fingerprint(saved),
    },
    registry,
    await f.input.loadLocalData(),
    new AbortController().signal,
    async () => ({ revision: fingerprint(saved), sourceStatus: 'current' }),
  );
  const owner = createBoundConversationCaptureOwner({
    storage: f.storage,
    registry,
  });
  const bind = (reference: EvidenceReference) =>
    bindConversationSources({
      citations: [reference],
      parentId: outer.id,
      parentRevision: fingerprint(outer),
      storage: f.storage,
      registry,
      captureOwner: owner,
    })![0]!;
  return {
    ...f,
    registry,
    saved,
    outer,
    original,
    alias: alias!.reference,
    bind,
  };
}

test.each([
  'outer-delete',
  'outer-change',
  'outer-hide',
  'inner-delete',
  'abort',
  'sql-error',
] as const)(
  'bound capture fences %s after other source hydration',
  async mutation => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      const bound = f.bind(f.alias);
      const later = f.registry.add({
        reference: {
          ...f.original,
          sourceKind: 'personal_record',
          sourceId: 'later',
          evidenceId: 'later',
        },
        content: '',
        validate: async () => true,
        readSource: async () => {
          if (mutation === 'outer-delete')
            await f.database.execute(
              "DELETE FROM conversation_artifacts WHERE id='outer'",
            );
          if (mutation === 'outer-change')
            await f.database.execute(
              "UPDATE conversation_artifacts SET result_json=json_set(result_json,'$.answer','changed') WHERE id='outer'",
            );
          if (mutation === 'outer-hide')
            await f.database.execute(
              "UPDATE conversation_artifact_sessions SET hidden=1 WHERE id='session'",
            );
          if (mutation === 'inner-delete')
            await f.repository.delete('health_observation', 'inside');
          if (mutation === 'abort') controller.abort();
          if (mutation === 'sql-error')
            jest
              .spyOn(f.storage, 'readMany')
              .mockRejectedValue(new Error('synthetic SQL failure'));
          return {
            status: 'available',
            document: { sourceKind: 'personal_record', records: [] },
          };
        },
      });
      await expect(
        captureConversationSources(
          [bound, later],
          f.registry,
          controller.signal,
        ),
      ).rejects.toThrow();
    } finally {
      jest.restoreAllMocks();
      f.close();
    }
  },
);

test('nested wrappers preserve exact inner identity and both outer fences on every operation', async () => {
  const f = await fixture();
  try {
    const nested = f.bind(f.bind(f.alias));
    const first = await captureConversationSources(
      [nested],
      f.registry,
      new AbortController().signal,
    );
    expect(first.sources[0]).toMatchObject({
      kind: 'generated_conversation',
      id: f.saved.id,
      revision: fingerprint(f.saved),
    });
    expect(
      await captureConversationSources(
        [nested],
        f.registry,
        new AbortController().signal,
      ),
    ).toEqual(first);
    await f.database.execute(
      "DELETE FROM conversation_artifacts WHERE id='outer'",
    );
    await expect(
      captureConversationSources(
        [nested],
        f.registry,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});

test.each(['unavailable', 'changed'] as const)(
  'unsupported inner source is re-read at finish when it becomes %s without a DB change',
  async status => {
    const f = await fixture();
    let changed = false;
    try {
      const inner = f.registry.add({
        reference: f.original,
        content: '',
        validate: async () => true,
        readSource: async () => {
          if (changed && status === 'unavailable')
            return { status: 'unavailable' };
          return {
            status: 'available',
            document: {
              sourceKind: 'generated_artifact',
              metadata: {
                id: f.saved.id,
                type: 'conversation_turn',
                revision: fingerprint(f.saved),
                originFeature: 'record_conversation',
                originSession: 'session',
                createdAt: f.saved.createdAt,
                eventTime: null,
                providerId: 'synthetic',
                modelId: 'synthetic',
                completion: 'complete',
                review: 'unreviewed',
              },
              conversation: { question: 'Synthetic', answer: 'Synthetic' },
              sources: [],
              sourceStatus: changed ? 'changed' : 'current',
            },
          };
        },
      });
      const later = f.registry.add({
        reference: {
          ...f.original,
          sourceKind: 'personal_record',
          sourceId: 'later',
          evidenceId: 'later',
        },
        content: '',
        validate: async () => true,
        readSource: async () => {
          changed = true;
          return {
            status: 'available',
            document: { sourceKind: 'personal_record', records: [] },
          };
        },
      });
      await expect(
        captureConversationSources(
          [f.bind(inner), later],
          f.registry,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(fingerprint(await f.storage.read('outer'))).toBe(
        fingerprint(f.outer),
      );
    } finally {
      f.close();
    }
  },
);
