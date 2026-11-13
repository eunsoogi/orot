import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';
import {
  conversationHistoryPayload,
  retainedHistoryTurns,
} from '../conversationHistoryPayload';
import type { ConversationSession } from '../conversationSessionTypes';

test('a restored preview is visible as interrupted and never enters later provider history', async () => {
  let messages: ConversationSession['messages'] = [];
  const state = createConversationSessionRestoreState({
    update: (_id, change) => {
      if (change.messages) messages = change.messages;
    },
    read: async () => [
      {
        question: '질문',
        answer: '',
        preview: '작성 중인 답변',
        interrupted: true,
        citations: [],
        completion: 'partial',
        toolMessageId: 'request',
      },
    ],
  });
  await state.start(1, 'session');
  expect(messages[1]).toEqual(
    expect.objectContaining({ content: '작성 중인 답변', incomplete: true }),
  );
  expect(messages[1].retainedTurnId).toBeUndefined();
  expect(conversationHistoryPayload(messages, '새 질문')).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ content: '작성 중인 답변' }),
    ]),
  );
  expect(retainedHistoryTurns(messages, '새 질문')).toEqual([]);
});
