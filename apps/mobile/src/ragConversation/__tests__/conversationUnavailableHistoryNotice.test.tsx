import { createConversationPagedRestoreState } from '../conversationPagedRestoreState';
import { createEmptyConversation } from '../conversationEmptySession';
import { render, screen } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';
import { conversationRestoredMessages } from '../conversationRestoredMessages';
import {
  conversationHistoryPayload,
  retainedHistoryTurns,
} from '../conversationHistoryPayload';
import { conversationRecoveryDraft } from '../conversationRecoveryDraft';
import { createConversationSessions } from '../conversationSessions';
import { restoreUnavailableHistoryTurns } from '../../aiFeatures/integration/restoreUnavailableHistoryTurns';
import { restoreUnavailableToolTurns } from '../../aiFeatures/integration/restoreUnavailableToolTurns';
import { t } from '../../i18n';
import type { RestoredTurn } from '../conversationRestoredTurn';

test.each(['history', 'tool'] as const)(
  '%s unavailable notice is neither an interrupted draft nor provider history',
  async kind => {
    const turns: (RestoredTurn & { toolMessageId: string })[] = [];
    if (kind === 'history')
      restoreUnavailableHistoryTurns(turns, [
        { id: 'hidden', createdAt: '2026-10-05T00:00:00Z' },
      ]);
    else
      restoreUnavailableToolTurns(turns, [
        { messageId: 'hidden', createdAt: '2026-10-05T00:00:00Z' },
      ]);
    let id = 0;
    const messages = conversationRestoredMessages(turns, [], () => ++id);
    expect(messages).toHaveLength(1);
    const notice = messages[0]!;
    expect(notice.historyUnavailable).toBe(true);
    expect(notice.incomplete).toBeUndefined();
    expect(notice.interruptionReason).toBeUndefined();
    expect(notice.activity).toBeUndefined();
    expect(notice.toolMessageId).toBe('hidden');
    expect(notice.coldResume).toBeUndefined();
    expect(conversationHistoryPayload(messages, '')).toEqual([]);
    expect(retainedHistoryTurns(messages, '')).toEqual([]);
    const store = createConversationSessions();
    const session = store.getSnapshot().sessions[0]!;
    expect(
      conversationRecoveryDraft({
        ...session,
        messages: [
          { id: 99, role: 'user', content: 'Unrelated prior question' },
          notice,
        ],
      }),
    ).toBeNull();
    store.dispose();
    const resume = jest.fn();
    await render(
      <ConversationMessage
        message={notice}
        onContinueCold={resume}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />,
    );
    expect(
      screen.getByTestId('rag-conversation-unavailable-body'),
    ).toBeTruthy();
    expect(
      screen.queryByText(t('aiActivity.draft.incompleteHeading')),
    ).toBeNull();
    expect(screen.queryByText(t('aiActivity.draft.incompleteNote'))).toBeNull();
    expect(
      screen.queryByTestId('rag-conversation-incomplete-activity'),
    ).toBeNull();
    expect(
      screen.queryByText(t('conversationInterruption.resumeAction')),
    ).toBeNull();
    expect(resume).not.toHaveBeenCalled();
  },
);

test('overlapping pages deduplicate metadata notices without hydrating steering receipts', async () => {
  let session = createEmptyConversation(1);
  const notice = {
    question: '',
    answer: 'Unavailable notice',
    citations: [],
    historyUnavailable: true as const,
    toolMessageId: 'hidden',
  };
  const read = jest
    .fn()
    .mockResolvedValueOnce({
      turns: [notice],
      taskCards: [],
      nextCursor: {
        id: 'hidden',
        createdAt: '2026-10-05T00:00:00Z',
        kind: 'turn',
        version: 0,
      },
    })
    .mockResolvedValueOnce({
      turns: [notice],
      taskCards: [],
      nextCursor: null,
    });
  const steering = jest.fn(async () => []);
  const state = createConversationPagedRestoreState({
    read,
    readSteering: steering,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
  });
  await state.start(1, 'durable');
  await state.loadOlder(1);
  expect(session.messages).toHaveLength(1);
  expect(session.messages[0]?.toolMessageId).toBe('hidden');
  expect(steering).not.toHaveBeenCalled();
  expect(conversationHistoryPayload(session.messages, '')).toEqual([]);
});
