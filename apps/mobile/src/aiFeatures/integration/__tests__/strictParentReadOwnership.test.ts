import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import { createConversationPageHydration } from '../conversationPageHydration';
import type { ConversationArtifact } from '../../../storage/conversationArtifactCodec';

/** Graph-only native marker selects strict hydration; the authoritative DB stays unchanged. */
test.each([
  'custom',
  'late',
  'foreign',
  'storage',
  'alternating',
  'foreign-data',
] as const)(
  'strict parent retains %s reader policy instead of bypassing it',
  async variant => {
    const f = await diverseHistoryProfileFixture(2, true);
    try {
      const data = await f.input.loadLocalData();
      const graph = await f.storage.readManyWithAncestry(['turn-1']);
      const ancestry = new Map(graph.ancestry);
      ancestry.set('turn-0', {
        ...ancestry.get('turn-0')!,
        submittedInput: {} as NonNullable<
          ConversationArtifact['submittedInput']
        >,
      });
      const denied = jest.fn(async () => null);
      if (variant === 'alternating') {
        let calls = 0;
        data.conversationArtifactDiscovery = async () =>
          ++calls === 1 ? { ...f.discovery, read: denied } : f.discovery;
      }
      if (variant === 'foreign-data') {
        const summary = data.summaryArtifactDiscovery!;
        const foreign = {
          ...data,
          summaryArtifactDiscovery: async (
            registry: Parameters<typeof summary>[0],
          ) => ({ ...(await summary(registry)), read: denied }),
        };
        const discovery = createConversationArtifactDiscovery({
          database: f.database,
          storage: f.storage,
          registry: f.input.registry,
          data: foreign,
        });
        data.conversationArtifactDiscovery = async () => discovery;
      }
      if (variant === 'custom') f.discovery.read = denied;
      if (variant === 'foreign') {
        data.conversationArtifactDiscovery = async () => ({
          ...f.discovery,
          read: denied,
        });
      }
      if (variant === 'storage') f.storage.read = jest.fn(async () => null);
      if (variant === 'late') {
        const summary = data.summaryArtifactDiscovery!;
        data.summaryArtifactDiscovery = async registry => {
          // Replacement happens during initial strict hydration, after admission.
          f.discovery.read = denied;
          return summary(registry);
        };
      }
      const reads = {
        read: jest.fn(
          async (id: string) => (await f.storage.readMany([id]))[0] ?? null,
        ),
      };
      const hydrate = createConversationPageHydration(
        {
          storage: f.storage,
          registry: f.input.registry,
          data,
          signal: new AbortController().signal,
        },
        ancestry,
        reads,
      );
      expect(await hydrate('turn-1')).toBeNull();
      if (variant === 'storage') expect(f.storage.read).toHaveBeenCalled();
      else if (variant === 'foreign-data') expect(denied).toHaveBeenCalled();
      else expect(denied).toHaveBeenCalledWith('turn-0', expect.anything());
      if (variant !== 'late') expect(reads.read).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);

// Even owned initial reads cannot publish native-gated or interrupted hydration.
test.each(['cancel', 'treatment'] as const)(
  'owned strict parent withholds %s',
  async mode => {
    const f = await diverseHistoryProfileFixture(2, true);
    try {
      const data = await f.input.loadLocalData();
      const graph = await f.storage.readManyWithAncestry(['turn-1']);
      const ancestry = new Map(graph.ancestry);
      ancestry.set('turn-0', {
        ...ancestry.get('turn-0')!,
        submittedInput: {} as NonNullable<
          ConversationArtifact['submittedInput']
        >,
      });
      const controller = new AbortController();
      const reads = {
        read: jest.fn(async (id: string) => {
          const value = await f.storage.read(id);
          if (mode === 'cancel') controller.abort();
          // A treatment-specific reopen proof is intentionally absent in generic hydration.
          return value && mode === 'treatment'
            ? {
                ...value,
                treatmentContext: {} as NonNullable<
                  ConversationArtifact['treatmentContext']
                >,
              }
            : value;
        }),
      };
      const hydrate = createConversationPageHydration(
        {
          storage: f.storage,
          registry: f.input.registry,
          data,
          signal: controller.signal,
        },
        ancestry,
        reads,
      );
      expect(await hydrate('turn-1')).toBeNull();
      expect(reads.read).toHaveBeenCalledTimes(1);
    } finally {
      f.close();
    }
  },
);
