import { useSyncExternalStore } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { ConversationHistory } from '../ConversationHistory';
import { createConversationSessions } from '../conversationSessions';
import type { RagConversationObserver } from '../service';

/** The same owning request drives receipts and dots; a local wait cannot fabricate AI processing. */
test('waiting dots do not imply read, a generated opening shows read before final text, Stop fences late signals', async () => {
  const sessions = createConversationSessions();
  const Harness = () => {
    const state = useSyncExternalStore(
      sessions.subscribe,
      sessions.getSnapshot,
    );
    const s = state.sessions[0];
    return (
      <ConversationHistory
        messages={s.messages}
        pendingMessage={s.pendingMessage}
        requestSessionId={s.id}
        requestActivity={s.requestActivity}
        error=""
        onOpenSource={() => {}}
        onLinkError={() => {}}
      />
    );
  };
  await render(<Harness />);
  let observer!: RagConversationObserver;
  let finish!: () => void;
  let work!: Promise<void>;
  await act(async () => {
    sessions.setDraft(1, 'Synthetic request');
    work = sessions.send(1, async (_q, _h, _s, o) => {
      observer = o!;
      await new Promise<void>(r => {
        finish = r;
      });
      return { status: 'answer', answer: 'Synthetic answer', citations: [] };
    });
  });
  expect(screen.getByTestId('conversation-message-receipt')).toHaveTextContent(
    /전송 중/,
  );
  expect(screen.queryByText('준비 중')).toBeNull();
  expect(
    screen.queryAllByTestId('rag-conversation-activity-dot', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(3);
  await act(async () => {
    observer.onTaskStreamEvent!({
      type: 'initial_response',
      callId: 'synthetic-opening',
      text: 'Synthetic opening',
    });
  });
  expect(screen.getByTestId('conversation-message-receipt')).toHaveTextContent(
    /읽음/,
  );
  expect(screen.getByText('Synthetic opening')).toBeTruthy();
  expect(screen.queryByTestId('conversation-response-waiting')).toBeNull();
  expect(
    screen.getAllByTestId('rag-conversation-activity-dot', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(3);
  expect(
    screen.getByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }).props.accessibilityElementsHidden,
  ).toBe(true);
  const readAt =
    sessions.getSnapshot().sessions[0].messages[0].delivery?.readAt;
  await act(async () => {
    sessions.cancel(1);
    observer.onProviderReceipt!('response_started');
    finish();
    await work;
  });
  expect(sessions.getSnapshot().sessions[0].messages[0].delivery?.readAt).toBe(
    readAt,
  );
  expect(
    screen.queryAllByTestId('rag-conversation-activity-dot', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(0);
  sessions.dispose();
});
