import { act, render, screen } from '@testing-library/react-native';
import { useSyncExternalStore } from 'react';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationHistory } from '../ConversationHistory';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}

test('a mounted source-free tool start does not block another local read with an empty lineage write', async () => {
  const sqlite = openOpSqliteFileQueue();
  const holdWrite = gate();
  const holdReply = gate();
  const storedStart = gate();
  const enteredWrite = gate();
  const storedTerminal = gate();
  const storage = createConversationArtifactStorage(sqlite.database);
  const records = createRecordRepository(sqlite.database);
  const observation = healthObservation(
    'synthetic-unrelated-observation',
    'heart_rate',
    '2026-10-01T01:00:00.000Z',
  );
  const event: ConversationToolEvent = {
    version: 1,
    operationRunId: 'synthetic-operation',
    callId: 'synthetic-tool-call',
    order: 1,
    toolName: 'local_search',
    status: 'started',
    inputSummary: { sourceKind: 'personal_record' },
    sources: [],
  };
  let nextId = 0;
  const retention = createConversationSessionRetention({
    openStorage: async () => storage,
    createId: () => 'synthetic-' + ++nextId,
    now: () => '2035-01-01T12:00:00.000Z',
    async onToolEventStored(saved) {
      if (saved.status === 'started') storedStart.release();
      else storedTerminal.release();
    },
  });
  const store = createConversationSessions({ retention });
  function History() {
    const session = useSyncExternalStore(store.subscribe, store.getSnapshot)
      .sessions[0]!;
    return (
      <ConversationHistory
        messages={session.messages}
        pendingMessage={session.pendingMessage}
        requestSessionId={session.id}
        requestActivity={session.requestActivity}
        error=""
        onOpenSource={() => {}}
        onLinkError={() => {}}
      />
    );
  }
  let send: Promise<unknown> | undefined;
  let read: Promise<unknown> | undefined;
  try {
    await runMigrations(sqlite.database);
    await records.put('health_observation', observation);
    await storage.currentGeneration();
    let lineageWrites = 0;
    sqlite.delayWorker(async query => {
      if (!query.startsWith('INSERT OR REPLACE INTO conversation_tool_lineage'))
        return;
      ++lineageWrites;
      enteredWrite.release();
      await holdWrite.wait;
    });
    const ui = await render(
      <NavigationMotionContext.Provider value>
        <History />
      </NavigationMotionContext.Provider>,
    );
    try {
      await act(async () => {
        store.setDraft(1, 'Synthetic ordinary question');
        send = store.send(1, async (_question, _history, _signal, observer) => {
          observer?.onToolEvent?.(event);
          await holdReply.wait;
          observer?.onToolEvent?.({
            ...event,
            status: 'completed',
            resultSummary: { referenceCount: 0 },
          });
          return {
            status: 'answer',
            answer: 'Synthetic ordinary answer',
            citations: [],
          };
        });
        await Promise.race([storedStart.wait, enteredWrite.wait]);
      });
      expect(
        screen.getByTestId('conversation-message-receipt'),
      ).toHaveTextContent(/전송 중/);
      read = records.get('health_observation', observation.id);
      const owner = await Promise.race([
        enteredWrite.wait.then(() => 'empty-write-blocked-fifo'),
        read.then(() => 'unrelated-read-finished'),
      ]);
      expect(owner).toBe('unrelated-read-finished');
      expect(lineageWrites).toBe(0);
      await expect(read).resolves.toMatchObject({ id: observation.id });
      const sessionId = retention.activeIdentity(1);
      if (!sessionId) throw new Error('Missing active durable session.');
      const active = await storage.readToolTurnsSnapshot(sessionId);
      expect(active.items.flatMap(turn => turn.toolEvents)).toEqual([event]);

      holdWrite.release();
      await act(async () => {
        holdReply.release();
        await storedTerminal.wait;
        await send;
      });
      expect(
        screen.getByTestId('conversation-message-receipt'),
      ).not.toHaveTextContent(/전송 중/);
      expect(lineageWrites).toBe(1);
      const completed = await storage.readToolTurnsSnapshot(sessionId);
      expect(completed.items.flatMap(turn => turn.toolEvents)).toEqual([
        { ...event, status: 'completed', resultSummary: { referenceCount: 0 } },
      ]);
    } finally {
      await act(async () => {
        holdWrite.release();
        holdReply.release();
        await send;
        await read;
      });
      await ui.unmount();
    }
  } finally {
    store.dispose();
    await sqlite.close();
  }
});
