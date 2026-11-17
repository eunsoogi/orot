import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import { createConversationPageHydration } from '../conversationPageHydration';
import type { ConversationArtifact } from '../../../storage/conversationArtifactCodec';

const signal = () => new AbortController().signal;

test('parent aliases still perform strict discovery after their page graph is discarded', async () => {
  const f = await diverseHistoryProfileFixture(2, true);
  try {
    const page = await f.discovery.readSession({
      sessionId: 'session',
      signal: signal(),
    });
    const child = page.items.find(item => item.id === 'turn-1')!;
    const strict = jest.spyOn(f.discovery, 'read');
    await f.input.registry.readSource(child.sources[1]!, signal());
    expect(strict).toHaveBeenCalledWith('turn-0', expect.anything());
    await f.database.execute(
      "DELETE FROM conversation_artifacts WHERE id='turn-0'",
    );
    expect(
      (await f.input.registry.readSource(child.sources[1]!, signal())).status,
    ).not.toBe('available');
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('native-bearing ancestor snapshots select strict discovery rather than claim native proof', async () => {
  const f = await diverseHistoryProfileFixture(2, true);
  try {
    const graph = await f.storage.readManyWithAncestry(['turn-1']);
    const ancestry = new Map(graph.ancestry);
    // Only the graph copy is marked native; strict storage still returns the exact
    // authoritative parent. This detects fallback selection without faking consent.
    ancestry.set('turn-0', {
      ...ancestry.get('turn-0')!,
      submittedInput: {} as NonNullable<ConversationArtifact['submittedInput']>,
    });
    const strict = jest.spyOn(f.discovery, 'read');
    const hydrate = createConversationPageHydration(
      {
        storage: f.storage,
        registry: f.input.registry,
        data: await f.input.loadLocalData(),
        signal: signal(),
      },
      ancestry,
    );
    expect(await hydrate('turn-1')).not.toBeNull();
    expect(strict).toHaveBeenCalledWith('turn-0', expect.anything());
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('an inconsistent root graph is rejected before its aliases are published', async () => {
  const f = await diverseHistoryProfileFixture(2, true);
  try {
    const read = f.storage.readManyWithAncestry.bind(f.storage);
    jest
      .spyOn(f.storage, 'readManyWithAncestry')
      .mockImplementation(async ids => {
        const snapshot = await read(ids);
        const ancestry = new Map(snapshot.ancestry);
        ancestry.set('turn-1', {
          ...ancestry.get('turn-1')!,
          answer: 'Synthetic changed',
        });
        return { ...snapshot, ancestry };
      });
    await expect(
      f.discovery.readSession({ sessionId: 'session', signal: signal() }),
    ).rejects.toThrow('ancestry changed');
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

// Mutations after graph validation must still fail the final protected root fence.
test.each(['delete', 'change', 'hide'] as const)(
  'rejects ancestor %s during provisional hydration',
  async mutation => {
    const f = await diverseHistoryProfileFixture(2, true);
    try {
      const data = await f.input.loadLocalData();
      const discovery = data.summaryArtifactDiscovery!;
      let changed = false;
      data.summaryArtifactDiscovery = async registry => {
        const current = await discovery(registry);
        return {
          ...current,
          read: async (...args) => {
            const result = await current.read(...args);
            if (!changed) {
              changed = true;
              const sql =
                mutation === 'delete'
                  ? "DELETE FROM conversation_artifacts WHERE id='turn-0'"
                  : mutation === 'hide'
                    ? "UPDATE conversation_artifact_sessions SET hidden=1 WHERE id='session'"
                    : "UPDATE conversation_artifacts SET result_json=json_set(result_json,'$.answer','Synthetic changed') WHERE id='turn-0'";
              await f.database.execute(sql);
            }
            return result;
          },
        };
      };
      await expect(
        f.discovery.readSession({ sessionId: 'session', signal: signal() }),
      ).rejects.toThrow();
    } finally {
      f.close();
    }
  },
);

test('unknown source status propagates through the provisional parent graph', async () => {
  const f = await diverseHistoryProfileFixture(2, true);
  try {
    const data = await f.input.loadLocalData();
    const discovery = data.summaryArtifactDiscovery!;
    data.summaryArtifactDiscovery = async registry => {
      const current = await discovery(registry);
      return {
        ...current,
        read: async (...args) => {
          const result = await current.read(...args);
          return result
            ? { ...result, sourceStatus: 'unknown' as const }
            : result;
        },
      };
    };
    const page = await f.discovery.readSession({
      sessionId: 'session',
      signal: signal(),
    });
    expect(page.items).toHaveLength(2);
    expect(page.items.every(item => item.sourceStatus === 'unknown')).toBe(
      true,
    );
  } finally {
    f.close();
  }
});
