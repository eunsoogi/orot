import { AccessibilityInfo } from 'react-native';
import { useSyncExternalStore } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { ConversationHistory } from '../ConversationHistory';
import { ConversationHistoryPreview } from '../ConversationHistoryPreview';
import { createEmptyConversation } from '../conversationEmptySession';
import {
  activity,
  history,
  sent,
  user,
} from '../testSupport/conversationHistoryActivityFixture';
import { createConversationSessions } from '../conversationSessions';
import type { RagConversationObserver } from '../service';

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

/** The same owning request drives receipts and dots; a local wait cannot fabricate AI processing. */
test('dots wait for Read, a generated opening shows read before final text, Stop fences late signals', async () => {
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
  ).toHaveLength(0);
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

test('shows reply dots only after the owning user receipt is Read', async () => {
  const previous = { ...user, id: 40, content: '이전 질문' };
  const pending = { id: 44, content: '', activity: '답변 준비 중' };
  const view = await render(
    history({
      requestSessionId: 12,
      requestActivity: activity('preparing'),
      pendingMessage: pending,
      messages: [
        previous,
        {
          ...user,
          delivery: { submittedAt: sent.submittedAt },
          deliveryPending: true,
        },
      ],
    }),
  );

  const dots = () =>
    screen.queryByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    });
  const receipt = () =>
    screen.getAllByTestId('conversation-message-receipt')[1];
  expect(receipt()).not.toHaveTextContent(/읽음/);
  expect(dots()).toBeNull();

  await view.rerender(
    history({
      requestSessionId: 12,
      requestActivity: { ...activity('waiting'), responseStarted: true },
      pendingMessage: {
        ...pending,
        initialResponse: { callId: 'pending', text: '…', source: 'receipt' },
      },
      messages: [previous, { ...user, delivery: sent }],
    }),
  );
  expect(receipt()).toHaveTextContent(/보냄/);
  expect(dots()).toBeNull();
  expect(screen.queryByTestId('conversation-assistant-message')).toBeNull();

  await view.rerender(
    history({
      requestSessionId: 12,
      requestActivity: activity('waiting'),
      pendingMessage: pending,
      messages: [previous, user],
    }),
  );
  expect(receipt()).toHaveTextContent(/읽음/);
  expect(dots()).toBeTruthy();
});

test('history preview does not paint synthetic local waiting as an unread reply', async () => {
  const pending = {
    id: 44,
    content: '',
    activity: '합성 준비 중',
    initialResponse: {
      callId: 'pending',
      source: 'receipt' as const,
      text: '…',
    },
  };
  const session = {
    ...createEmptyConversation(12),
    messages: [{ ...user, delivery: sent }],
    pendingMessage: pending,
    requestActivity: activity('waiting'),
  };
  const view = await render(<ConversationHistoryPreview session={session} />);
  expect(screen.queryByTestId('conversation-assistant-message')).toBeNull();

  await view.rerender(
    <ConversationHistoryPreview
      session={{
        ...session,
        pendingMessage: { ...pending, content: '실제 부분 답변' },
        requestActivity: { ...activity('waiting'), requestId: 99 },
      }}
    />,
  );
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    '실제 부분 답변',
  );
  expect(screen.queryByText('합성 준비 중')).toBeNull();
});
