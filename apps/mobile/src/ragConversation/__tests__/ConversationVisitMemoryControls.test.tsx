import { fireEvent, render, screen } from '@testing-library/react-native';
import { appointment } from '../../agent/visitQuestions/testing/persistenceFixtures';
import { ConversationVisitQuestionCard } from '../../aiFeatures/integration/ConversationVisitQuestionCard';
import { createInlineVisitReview } from '../../nextVisitQuestions/inlineVisitReview';
import { theme } from '../../nextVisitQuestions/testSupport/fixtures';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { GeneratedReportBookmarkContext } from '../GeneratedReportBookmark';
import type { DisplayMessage } from '../conversationDisplayMessage';
import type { ConversationSessions } from '../conversationSessions';

test('the real Visit transcript retains question actions but not a Memory bookmark button', async () => {
  const regenerate = jest.fn();
  const message: DisplayMessage = {
    id: 1,
    role: 'assistant',
    content: 'Synthetic visit reply.',
    retainedTurnId: 'synthetic-prior-artifact',
    visitQuestions: {
      appointment,
      review: createInlineVisitReview(
        'synthetic-visit',
        [],
        [
          {
            identity: { id: 'generated-candidate' },
            questionText: '합성 진료 질문을 물어볼까요?',
            rationale: '합성 근거',
            priority: 'important',
            citations: [],
          },
        ],
        [],
        () => 'generated-candidate',
      ),
      validateSource: async () => true,
    },
  };
  const store = {
    getSnapshot: () => ({ sessions: [{ id: 1, messages: [message] }] }),
  } as unknown as ConversationSessions;
  await render(
    // A legacy provider cannot reintroduce its removed action into the transcript.
    <GeneratedReportBookmarkContext.Provider value={{ sessionId: 1 }}>
      <ConversationTranscriptMessages
        messages={[message]}
        instructions={undefined}
        replyFocus={undefined}
        onLayout={() => {}}
        messageProps={{
          onOpenSource: jest.fn(),
          onLinkError: jest.fn(),
          renderVisitQuestions: displayed => (
            <ConversationVisitQuestionCard
              message={displayed}
              sessionId={1}
              store={store}
              operations={{
                save: jest.fn(),
                ...({} as Omit<
                  React.ComponentProps<
                    typeof ConversationVisitQuestionCard
                  >['operations'],
                  'save'
                >),
              }}
              services={{
                resolveSource: jest.fn(),
                registerVisitQuestionSource: jest.fn(),
              }}
              onOpenSource={jest.fn()}
              theme={theme}
              onRegenerate={regenerate}
            />
          ),
        }}
      />
    </GeneratedReportBookmarkContext.Provider>,
  );
  expect(screen.getByTestId('inline-visit-save')).toBeTruthy();
  expect(
    screen.queryByTestId('conversation-bookmark-visit-questions'),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId('inline-visit-regenerate'));
  expect(regenerate).toHaveBeenCalledTimes(1);
});
