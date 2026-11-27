import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useConversationHistoryUserTurnFollow } from '../conversationHistoryUserTurn';
import { ConversationSteeringComposer } from '../ConversationSteeringComposer';
import { createConversationSessions } from '../conversationSessions';
import { conversationWorkflowContinuationFixture } from '../../storage/testSupport/conversationWorkflowContinuationFixture';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { createConversationOperationJournal } from '../../storage/conversationOperationJournal';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';
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

function textOrder(tree: unknown): string {
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(textOrder).join('|');
  if (tree && typeof tree === 'object' && 'children' in tree)
    return textOrder(tree.children);
  return '';
}

test('a real admitted instruction becomes the newest user bubble and reappears once after owned restore', async () => {
  const { connection, requests: storage } =
    await conversationWorkflowContinuationFixture();
  const store = createConversationSessions();
  try {
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
      draft: 'Synthetic steering instruction',
      busy: true,
    };
    const owner = createConversationSteeringOwner(
      () => session,
      (_id, change) => {
        session = { ...session, ...change };
      },
    );
    owner.bind(1, steering, () => true);
    let submitted: Promise<void> | undefined;
    const ordinary = jest.fn();
    const stop = jest.fn();
    const composer = await render(
      <ConversationSteeringComposer
        session={session}
        store={{ ...store, steer: id => (submitted = owner.submit(id)) }}
        onChangeText={jest.fn()}
        onSend={ordinary}
        onCancel={stop}
      />,
    );
    await act(async () => {
      const send = screen.getByTestId('rag-conversation-send');
      if (send.props.onComposerPress) await fireEvent(send, 'composerPress');
      else await fireEvent.press(send);
      if (!submitted)
        throw new Error('Steering did not reach its request owner.');
      await submitted;
    });
    await composer.unmount();
    expect(ordinary).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(session.draft).toBe('');
    expect(session.steeringInstructions).toEqual([
      expect.objectContaining({ submittedHere: true }),
    ]);
    const initial: DisplayMessage[] = [
      { id: 1, role: 'user', content: retained.question },
      {
        id: 2,
        role: 'assistant',
        content: 'Synthetic unfinished output',
        streaming: true,
      },
    ];
    const mounted = await render(
      rows(initial, session.steeringInstructions, 2),
    );
    let text = textOrder(mounted.toJSON());
    expect(text.indexOf('Synthetic unfinished output')).toBeLessThan(
      text.indexOf('Synthetic steering instruction'),
    );
    expect(screen.getAllByTestId('conversation-steering-message')).toHaveLength(
      1,
    );

    const operationId = 'bounded-revision';
    const bound = await steering.bind(operationId, {
      messages: [{ role: 'user', content: retained.question }],
    });
    expect(bound?.messages).toHaveLength(2);
    const identity = {
      operationId,
      input: JSON.stringify(bound),
      evidenceReferences: [],
    };
    await journal.loadOrCreate(identity);
    const claim = await journal.begin({ ...identity, revision: 0 });
    if (claim.status !== 'claimed') throw new Error('Synthetic claim failed.');
    await journal.complete({
      ...identity,
      claim: claim.claim,
      result: 'Synthetic receipt',
    });
    await expect(steering.acknowledge(operationId)).resolves.toBe(true);
    await mounted.rerender(
      rows(
        [
          initial[0],
          {
            ...initial[1],
            previousOutputs: ['Synthetic unfinished output'],
            content: retained.answer,
          },
        ],
        session.steeringInstructions,
        2,
      ),
    );
    text = textOrder(mounted.toJSON());
    expect(text.indexOf('Synthetic unfinished output')).toBeLessThan(
      text.indexOf('Synthetic steering instruction'),
    );
    expect(text.indexOf('Synthetic steering instruction')).toBeLessThan(
      text.indexOf(retained.answer),
    );
    expect(screen.getAllByTestId('conversation-steering-message')).toHaveLength(
      1,
    );
    owner.dropActive(1);
    await storage.append(retained);

    const load = conversationSavedHistoryDisplayOption(async () => storage);
    const restored = await load(
      retained.sessionId,
      0,
      new AbortController().signal,
    );
    await mounted.rerender(
      rows(
        savedHistoryTranscript(
          restored.rows.map(row => ({ row, questionId: -1, answerId: -2 })),
          [],
        ),
      ),
    );
    expect(screen.getAllByTestId('conversation-steering-message')).toHaveLength(
      1,
    );
    expect(textOrder(mounted.toJSON())).toContain(
      'Synthetic steering instruction',
    );
    await storage.deleteSession(retained.sessionId);
    const removed = await load(
      retained.sessionId,
      0,
      new AbortController().signal,
    ).catch(() => ({ rows: [] }));
    expect(removed.rows).toEqual([]);
  } finally {
    store.dispose();
    connection.close();
  }
});

test('no active target does not paint an old steering queue on a different conversation', async () => {
  await render(
    rows(
      [{ id: 2, role: 'user', content: 'Unrelated current request' }],
      [{ id: 'closed', text: 'Stale steering', sequence: 1, status: 'queued' }],
    ),
  );
  expect(screen.queryByText('Stale steering')).toBeNull();
});

test('a newly admitted steering follow event is consumed once without reset on receipts', async () => {
  const follows = { current: false };
  const offset: { current: number | null } = { current: 21 };
  function Probe({ id }: { id?: string }) {
    useConversationHistoryUserTurnFollow(1, [], follows, offset, id);
    return null;
  }
  const mounted = await render(<Probe />);
  expect(follows.current).toBe(false);
  await mounted.rerender(<Probe id="just-submitted" />);
  expect(follows.current).toBe(true);
  expect(offset.current).toBeNull();
  follows.current = false;
  offset.current = 42;
  await mounted.rerender(<Probe id="just-submitted" />);
  expect(follows.current).toBe(false);
  expect(offset.current).toBe(42);
});
