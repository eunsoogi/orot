import type { EvidenceReference } from '@orot/agent-runtime';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import { restoreConversationParentSource } from '../restoreConversationParentSource';
import { captureConversationSources } from '../captureConversationSources';
import { fingerprint } from '../evidenceUtils';
import { bindConversationSources } from '../conversationSourceBindings';
import {
  conversationHistorySources,
  conversationHistoryIsCurrent,
} from '../conversationHistorySources';

async function fixture() {
  const f = await diverseHistoryProfileFixture(1, false);
  const saved = (await f.storage.read('turn-0'))!;
  const revision = fingerprint(saved);
  const original: EvidenceReference = {
    sourceKind: 'generated_artifact',
    sourceId: saved.id,
    evidenceId: saved.id,
    sourceRevision: revision,
    evidenceRevision: revision,
    locator: { kind: 'generated_artifact', type: 'conversation_turn' },
    effectiveTime: null,
    reviewState: 'unreviewed',
  };
  const data = await f.input.loadLocalData();
  const alias = await restoreConversationParentSource(
    {
      kind: 'generated_conversation',
      reference: original,
      id: saved.id,
      revision,
    },
    f.input.registry,
    data,
    new AbortController().signal,
    async () => ({ revision, sourceStatus: 'current' }),
  );
  return {
    ...f,
    registry: f.input.registry,
    saved,
    original,
    data,
    alias: alias!.reference,
  };
}

/** The final batch fence must follow non-generated hydration, not just its own reads. */
test.each(['delete', 'abort', 'database-error'] as const)(
  'capture rejects %s during later non-generated source hydration',
  async mode => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      const personal = f.registry.add({
        reference: {
          ...f.original,
          sourceKind: 'personal_record',
          sourceId: 'unrelated',
          evidenceId: 'unrelated',
        },
        content: '',
        validate: async () => true,
        readSource: async () => {
          if (mode === 'delete')
            await f.repository.delete('health_observation', 'inside');
          else if (mode === 'abort') controller.abort();
          else
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
          [f.alias, personal],
          f.registry,
          controller.signal,
        ),
      ).rejects.toThrow();
      if (mode !== 'delete') {
        jest.restoreAllMocks();
        expect(
          (
            await captureConversationSources(
              [f.alias],
              f.registry,
              new AbortController().signal,
            )
          ).sources,
        ).toHaveLength(1);
      }
    } finally {
      jest.restoreAllMocks();
      f.close();
    }
  },
);

test('a bound outer-parent alias cannot acquire batch authority from the same generated locator', async () => {
  const f = await fixture();
  try {
    const prepare = jest.spyOn(f.discovery.captureOwner!, 'prepare');
    const read = jest.fn(async () => null);
    const bound = bindConversationSources({
      citations: [f.alias],
      parentId: 'removed-outer',
      parentRevision: 'old',
      storage: { read },
      registry: f.registry,
    })!;
    await expect(
      captureConversationSources(
        bound,
        f.registry,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(read).toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    // The unwrapped registration remains available through its own checked owner.
    expect(
      (
        await captureConversationSources(
          [f.alias],
          f.registry,
          new AbortController().signal,
        )
      ).sources,
    ).toHaveLength(1);
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('history batch rechecks its session after unsupported validators run', async () => {
  const f = await fixture();
  try {
    const version = (await f.storage.activeSessionVersion('session'))!;
    const history = await conversationHistorySources({
      session: { id: 'session', version },
      retainedHistory: [{ id: f.saved.id, question: f.saved.question }],
      data: f.data,
      registry: f.registry,
      signal: new AbortController().signal,
    });
    let replaced = false;
    jest
      .spyOn(f.storage, 'activeSessionVersion')
      .mockImplementation(async () => version + (replaced ? 1 : 0));
    const fallback = f.registry.add({
      reference: {
        ...f.original,
        sourceId: 'validator',
        evidenceId: 'validator',
      },
      content: '',
      readSource: async () => {
        throw new Error('Must use original validator, not read fallback.');
      },
      validate: async () => {
        replaced = true;
        return true;
      },
    });
    expect(
      await conversationHistoryIsCurrent(
        f.registry,
        [...history.references, fallback],
        new AbortController().signal,
      ),
    ).toBe(false);
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('native-owned batches use live strict readers again after later hydration without trusting DB-only freshness', async () => {
  const f = await fixture();
  try {
    const initial = f.storage.readManyWithAncestry.bind(f.storage);
    jest
      .spyOn(f.storage, 'readManyWithAncestry')
      .mockImplementation(async ids => {
        const graph = await initial(ids);
        // Only a graph copy is marked native to prove fallback selection. This is
        // not a native/device test and never invents a consent or a medical document.
        const ancestry = new Map(graph.ancestry);
        ancestry.set('native-probe', {
          ...f.saved,
          submittedInput: {} as NonNullable<typeof f.saved.submittedInput>,
        });
        return { ...graph, ancestry };
      });
    let nativeUnavailable = false;
    const read = f.discovery.read.bind(f.discovery);
    const strict = jest
      .spyOn(f.discovery, 'read')
      .mockImplementation((id, signal) =>
        nativeUnavailable ? Promise.resolve(null) : read(id, signal),
      );
    const fallback = f.registry.add({
      reference: {
        ...f.original,
        sourceKind: 'personal_record',
        sourceId: 'later-source',
        evidenceId: 'later-source',
      },
      content: '',
      validate: async () => true,
      readSource: async () => {
        nativeUnavailable = true;
        return {
          status: 'available',
          document: { sourceKind: 'personal_record', records: [] },
        };
      },
    });
    await expect(
      captureConversationSources(
        [f.alias, fallback],
        f.registry,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(strict.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(fingerprint(await f.storage.read(f.saved.id))).toBe(
      fingerprint(f.saved),
    );
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});
