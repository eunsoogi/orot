import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { t } from '../../i18n';

const event: ConversationToolEvent = {
  version: 1,
  operationRunId: 'synthetic-run',
  callId: 'tool-1',
  toolName: 'public-web-search',
  order: 1,
  status: 'started',
  inputSummary: { sourceKind: 'external_medical' },
  sources: [],
};

// Real session handlers and SQLite; inject only storage/binding failures, never provider requests.
test.each([
  'recovered',
  'recovered_failed',
  'recovered_cancelled',
  'recovered_interrupted',
  'binding_failed',
  'different_call',
  'different_run',
  'terminal_failed',
] as const)(
  'reports only unresolved retention failures: %s',
  async scenario => {
    const f = await healthContextFixture();
    let next = 0;
    const storage = createConversationArtifactStorage(f.database);
    let writes = 0;
    const adapter = {
      ...storage,
      appendToolEvent: async (
        input: Parameters<typeof storage.appendToolEvent>[0],
      ) => {
        writes += 1;
        if (
          writes === 1 ||
          scenario === 'terminal_failed' ||
          ((scenario === 'different_call' || scenario === 'different_run') &&
            input.event.callId === event.callId &&
            input.event.operationRunId === event.operationRunId)
        )
          throw new Error('Synthetic transient write failure');
        return storage.appendToolEvent(input);
      },
    };
    const sessions = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => adapter,
        onToolEventStored: async saved => {
          if (scenario === 'binding_failed' && saved.status !== 'started')
            throw new Error('Synthetic binding failure');
        },
        createId: () => `id-${++next}`,
        now: () => '2026-11-06T00:00:00.000Z',
      }),
    });
    const status =
      scenario === 'recovered_failed'
        ? 'failed'
        : scenario === 'recovered_cancelled'
          ? 'cancelled'
          : scenario === 'recovered_interrupted'
            ? 'interrupted'
            : 'completed';
    try {
      sessions.setDraft(1, 'Synthetic request');
      await sessions.send(1, async (_q, _h, _s, observer) => {
        observer!.onToolEvent!(event);
        observer!.onToolEvent!({
          ...event,
          status,
          ...(scenario === 'different_call' ? { callId: 'tool-2' } : {}),
          ...(scenario === 'different_run'
            ? { operationRunId: 'other-run' }
            : {}),
          resultSummary: { referenceCount: 0 },
        });
        return { status: 'answer', answer: 'Synthetic answer', citations: [] };
      });
      const turns = await storage.readToolTurns('id-1');
      const session = sessions.getSnapshot().sessions[0]!;
      if (scenario.startsWith('recovered')) {
        expect(turns[0]?.toolEvents).toMatchObject([
          { callId: 'tool-1', status },
        ]);
        expect(session.error).not.toBe(
          t('ragConversation.conversation.toolActivitySaveFailed'),
        );
      } else {
        expect(session.error).toBe(
          t('ragConversation.conversation.toolActivitySaveFailed'),
        );
      }
      expect(
        session.messages.some(
          message => message.content === 'Synthetic answer',
        ),
      ).toBe(true);
    } finally {
      sessions.dispose();
      f.close();
    }
  },
);
