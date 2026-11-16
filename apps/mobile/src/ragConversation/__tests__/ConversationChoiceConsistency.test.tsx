import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import { conversationChoiceActions } from '../selectConversationChoice';
import type { RagConversationOutcome } from '../service';

const labels = [
  '질병 가능성 보고서 요청하기',
  '진료 질문 준비하기',
  '내 건강 정보 요약하기',
  '오늘의 보고서 요청하기',
];

/** The same four actions survive entry selection, pending work and a remounted presentation. */
test.each([
  'conversation-open-possibilities',
  'conversation-open-visit-questions',
  'conversation-open-health-summary',
])(
  'keeps choice order and removes prompt-copy controls after %s',
  async choice => {
    let finish!: (value: RagConversationOutcome) => void;
    const send = jest.fn(
      () =>
        new Promise<RagConversationOutcome>(resolve => {
          finish = resolve;
        }),
    );
    function Content() {
      const store = useConversationSessions();
      const actions = conversationChoiceActions(store, () => true);
      return (
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={send}
          prepareVisitQuestions={send}
          onOpenDailyReport={jest.fn()}
          retainedActions={{
            possibilities: actions.onOpenDiseaseHypotheses,
            visitQuestions: actions.onOpenVisitQuestions,
            healthSummary: actions.onOpenHealthSummary,
          }}
        />
      );
    }
    const host = (visible = true) => (
      <ConversationSessionsProvider>
        {visible ? <Content /> : null}
      </ConversationSessionsProvider>
    );
    const view = await render(host());
    const expectChoices = () => {
      const choices = screen
        .getAllByRole('button')
        .filter(button => labels.includes(button.props.accessibilityLabel));
      expect(choices.map(button => button.props.accessibilityLabel)).toEqual(
        labels,
      );
      expect(
        screen.queryByTestId('conversation-intent-use-suggestion'),
      ).toBeNull();
      return choices;
    };
    expectChoices();
    await fireEvent.press(screen.getByTestId(choice));
    expect(send).toHaveBeenCalledTimes(1);
    expectChoices().forEach(button => expect(button).toBeDisabled());
    await act(async () =>
      finish({ status: 'answer', answer: 'Synthetic answer', citations: [] }),
    );
    expectChoices();
    await view.rerender(host(false));
    await view.rerender(host());
    expectChoices();
    expect(send).toHaveBeenCalledTimes(1);
  },
);
