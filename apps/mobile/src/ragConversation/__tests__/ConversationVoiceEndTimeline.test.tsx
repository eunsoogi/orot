import { render, screen } from '@testing-library/react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationRestoredMessages } from '../conversationRestoredMessages';
import { conversationHistoryPayload } from '../conversationHistoryPayload';
import type { DisplayMessage } from '../conversationDisplayMessage';
import type { RetainedConversationTask } from '../conversationTaskState';

const time = '2026-11-20T18:00:00.000Z';
const receipt: RetainedConversationTask = {
  id: 'voice-end:call-1',
  createdAt: time,
  revision: 1,
  task: { kind: 'voice_end', durationSeconds: 134 },
};
function renderRows(
  messages: readonly DisplayMessage[],
  cards: readonly RetainedConversationTask[] = [receipt],
) {
  return (
    <NavigationMotionContext.Provider value={true}>
      <ConversationTranscriptMessages
        messages={messages}
        voiceEndCards={cards}
        instructions={undefined}
        replyFocus={undefined}
        onLayout={() => {}}
        messageProps={{ onOpenSource: () => {}, onLinkError: () => {} }}
      />
    </NavigationMotionContext.Provider>
  );
}

test('a first voice-only Conversation shows the owned marker before later text without provider history', async () => {
  const live = { ...receipt, liveAfterMessageId: null };
  const view = await render(renderRows([], [live]));
  expect(screen.getByText('2분 14초')).toBeTruthy();
  const messages = [
    { id: 1, role: 'user', content: 'Later synthetic question' },
  ] as const;
  await view.rerender(renderRows(messages, [live]));
  const tree = JSON.stringify(view.toJSON());
  expect(tree.indexOf('conversation-voice-end-marker')).toBeLessThan(
    tree.indexOf('Later synthetic question'),
  );
  expect(conversationHistoryPayload(messages, 'Different draft')).toEqual([
    { role: 'user', content: 'Later synthetic question' },
  ]);
});

test('restored equal timestamps keep each authored pair intact and mixed marker order', async () => {
  let id = 0;
  const turns = [
    {
      question: 'Question before the marker',
      answer: 'Answer before the marker',
      citations: [],
      voiceTimelineOrder: { createdAt: time, id: 'aa-turn' },
    },
    {
      question: 'Question after the marker',
      answer: 'Answer after the marker',
      citations: [],
      voiceTimelineOrder: { createdAt: time, id: 'zz-turn' },
    },
  ];
  const messages = conversationRestoredMessages(turns, [[], []], () => --id);
  const view = await render(renderRows(messages));
  const tree = JSON.stringify(view.toJSON());
  const marker = tree.indexOf('conversation-voice-end-marker');
  expect(tree.indexOf('Answer before the marker')).toBeLessThan(marker);
  expect(tree.indexOf('Question after the marker')).toBeGreaterThan(marker);
  expect(screen.queryAllByTestId('conversation-voice-end-marker')).toHaveLength(
    1,
  );
});

test('a live marker stays after its stable message anchor when older history prepends', async () => {
  const live = { ...receipt, liveAfterMessageId: 6 };
  const earlier = { id: 6, role: 'user', content: 'Before ending' } as const;
  const next = { id: 7, role: 'user', content: 'After ending' } as const;
  const view = await render(renderRows([earlier, next], [live]));
  await view.rerender(
    renderRows(
      [
        {
          id: -3,
          restoredHistory: true,
          role: 'user',
          content: 'Restored earlier',
        },
        earlier,
        next,
      ],
      [live],
    ),
  );
  const tree = JSON.stringify(view.toJSON());
  const marker = tree.indexOf('conversation-voice-end-marker');
  expect(tree.indexOf('Before ending')).toBeLessThan(marker);
  expect(tree.indexOf('After ending')).toBeGreaterThan(marker);
});
