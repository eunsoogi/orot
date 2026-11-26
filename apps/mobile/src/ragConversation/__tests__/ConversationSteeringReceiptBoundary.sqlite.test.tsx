import { render, screen } from '@testing-library/react-native';
import { conversationWorkflowContinuationFixture } from '../../storage/testSupport/conversationWorkflowContinuationFixture';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { createConversationOperationJournal } from '../../storage/conversationOperationJournal';
import { createConversationSteeringOwner } from '../conversationSteeringOwner';
import { createEmptyConversation } from '../conversationEmptySession';
import type { DisplayMessage } from '../conversationDisplayMessage';

const retained = {
  id: 'request',
  sessionId: 'session',
  createdAt: '2026-11-14T00:00:00.000Z',
  question: 'Synthetic question',
  answer: 'Synthetic answer continues',
  status: 'complete' as const,
  providerId: 'synthetic',
  modelId: 'synthetic',
  sources: [],
  citations: [],
};

function rows(
  messages: readonly DisplayMessage[],
  instructions?: DisplayMessage['steeringInstructions'],
  pendingId?: number,
) {
  return (
    <ConversationTranscriptMessages
      messages={messages}
      pendingId={pendingId}
      instructions={instructions}
      onLayout={() => {}}
      replyFocus={undefined}
      messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
    />
  );
}

test('an applied live receipt becomes Read without waiting for the independent view read', async () => {
  const { connection } = await conversationWorkflowContinuationFixture();
  const journal = await createConversationOperationJournal(
    connection.database,
    {
      requestId: retained.id,
      sessionId: retained.sessionId,
      sessionVersion: 0,
      operationRunId: 'run',
    },
    async () => true,
  );
  const steering = journal.steering!;
  let session = {
    ...createEmptyConversation(1),
    draft: 'Synthetic follow-up',
    busy: true,
  };
  const owner = createConversationSteeringOwner(
    () => session,
    (_id, change) => {
      session = { ...session, ...change };
    },
  );
  let release!: () => void;
  let ready!: () => void;
  const readHeld = new Promise<void>(done => {
    ready = done;
  });
  let holdApplied = true;
  owner.bind(
    1,
    {
      ...steering,
      async list() {
        const snapshot = await steering.list();
        if (holdApplied && snapshot.some(row => row.status === 'applied')) {
          ready();
          await new Promise<void>(done => {
            release = done;
          });
          holdApplied = false;
        }
        return snapshot;
      },
    },
    () => true,
  );
  try {
    await owner.submit(1);
    const id = session.steeringInstructions![0]!.id;
    const operationId = 'live-operation';
    const identity = {
      operationId,
      input: 'synthetic',
      evidenceReferences: [],
    };
    await journal.loadOrCreate(identity);
    expect((await journal.begin({ ...identity, revision: 0 })).status).toBe(
      'claimed',
    );
    expect(await steering.beginLive!(operationId, id)).toBe(true);
    expect(await steering.settleLive!(operationId, id, 'accepted')).toBe(true);
    const messages: DisplayMessage[] = [
      {
        id: 5,
        role: 'assistant',
        content: 'Synthetic in-flight',
        streaming: true,
      },
    ];
    const view = await render(rows(messages, session.steeringInstructions, 5));
    expect(screen.queryByText(/읽음/)).toBeNull();
    expect(await steering.settleLive!('wrong-operation', id, 'applied')).toBe(
      false,
    );
    const observed = steering.settleLive!(operationId, id, 'applied');
    await readHeld;
    expect((await steering.list()).find(row => row.id === id)).toMatchObject({
      status: 'applied',
      readAt: expect.any(String),
    });
    expect(session.steeringInstructions![0]!.status).toBe('applied');
    await view.rerender(rows(messages, session.steeringInstructions, 5));
    expect(screen.getByText(/읽음/)).toBeTruthy();
    expect(await steering.settleLive!(operationId, id, 'applied')).toBe(false);
    expect(await steering.settleLive!(operationId, id, 'failed')).toBe(false);
    release();
    expect(await observed).toBe(true);
    await view.rerender(rows(messages, session.steeringInstructions, 5));
    expect(screen.getByText(/읽음/)).toBeTruthy();
    await view.unmount();
  } finally {
    owner.dispose();
    await connection.database.closeAsync?.();
  }
});
