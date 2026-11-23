import { t } from '../../i18n';
import { lazyConversationContinuationStore } from '../../aiFeatures/integration/lazyConversationContinuationStore';
import { conversationRestoredMessages } from '../../ragConversation/conversationRestoredMessages';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { conversationWorkflowContinuationFixture as fixture } from '../testSupport/conversationWorkflowContinuationFixture';

test.each([
  ['background-paused', 'background-paused'],
  ['decision-required', 'decision-required'],
  [undefined, 'decision-required'],
] as const)(
  'reads the persisted %s pause after startup recovery',
  async (reason, expected) => {
    const f = await fixture();
    try {
      const state = {
        ...f.state,
        phase: 'revised_response' as const,
        awaitingAuthorization: 'model-2',
      };
      await f.persisted.checkpointer.put(
        f.config,
        { ...f.checkpoint, id: '0002', channel_values: state },
        { source: 'loop', step: 1, parents: {} },
        {},
      );
      const lazy = lazyConversationContinuationStore(async () => ({
        ...f.persisted,
        // The storage fixture has already initialized this live store.
        initialize: async () => {},
      }));
      await lazy.initialize(f.options, new AbortController().signal);
      await lazy.paused(state, reason);

      const restarted = createConversationArtifactStorage(
        f.connection.database,
      );
      await restarted.interruptRecoveredRequests();
      const rows = await restarted.listInterruptedRequests('session', 0);
      expect(rows).toEqual([
        expect.objectContaining({
          id: 'request',
          interruptionReason: expected,
        }),
      ]);
      const messages = conversationRestoredMessages(
        rows.map(row => ({
          question: row.question,
          answer: '',
          citations: [],
          interrupted: true,
          interruptionReason: row.interruptionReason,
          toolMessageId: row.id,
          coldResume: { attempt: 2 },
        })),
        [[]],
        (() => {
          let id = 0;
          return () => ++id;
        })(),
      );
      expect(messages[1]?.activity).toBe(
        t(`conversationInterruption.${expected}`),
      );

      await restarted.interruptRequest(
        'request',
        'session',
        0,
        'interrupted',
        'user-stopped',
      );
      await expect(lazy.paused(state, 'background-paused')).rejects.toThrow();
      expect(await restarted.listInterruptedRequests('session', 0)).toEqual([
        expect.objectContaining({
          id: 'request',
          interruptionReason: 'user-stopped',
        }),
      ]);
    } finally {
      f.connection.close();
    }
  },
);
