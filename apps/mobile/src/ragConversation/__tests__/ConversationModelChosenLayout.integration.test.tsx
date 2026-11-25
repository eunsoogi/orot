import { render, screen, within } from '@testing-library/react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const emptyEvidence = { items: [], coverage: [], conflicts: [] };
const request = '과일 예시 세 가지를 보여 주세요.';
const fruit = ['사과', '배', '포도'];
const answer = fruit.join('\n');

test.each([
  ['model chooses native list', 'list', true],
  ['model chooses plain even for the same lines', 'plain', false],
  ['unknown choice falls back only to already-validated text', 'custom', false],
] as const)('%s in the completed ordinary transcript', async (_name, layout, list) => {
  const model = fixture();
  model.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind: 'conversation', answer, answerLayout: layout },
      citations: [],
    }),
  );
  const sessions = createConversationSessions();
  try {
    sessions.setDraft(1, request);
    await sessions.send(1, (question, previousMessages, signal) =>
      runRagConversationTurn(
        {
          ...model.options,
          question,
          previousMessages,
          loadCurrentEvidence: async () => ({
            batch: emptyEvidence,
            chunks: [],
          }),
        },
        { signal },
      ),
    );
    const messages = sessions.getSnapshot().sessions[0]!.messages;
    expect(model.generate).toHaveBeenCalledTimes(1);
    expect(messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: answer,
      citations: [],
    });
    await render(
      <ConversationTranscriptMessages
        messages={messages}
        instructions={undefined}
        replyFocus={undefined}
        onLayout={jest.fn()}
        messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
      />,
    );
    const nativeList = screen.queryByTestId('conversation-a2ui-list');
    if (list) {
      expect(nativeList).not.toBeNull();
      const region = within(screen.getByTestId('conversation-a2ui-list'));
      for (const item of fruit) {
        expect(region.getByText(item).props.allowFontScaling).toBe(true);
      }
      expect(region.queryAllByRole('button')).toHaveLength(0);
    } else {
      expect(nativeList).toBeNull();
      expect(screen.getByText(answer)).toBeTruthy();
    }
  } finally {
    sessions.dispose();
  }
});
