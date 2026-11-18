import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { appColors } from '../../layout/appColors';
import { ConversationScreen } from '../ConversationScreen';

/** These fixtures prove transcript ordering and action wiring, not native geometry. */
test('keeps four guarded choices above new answers without report-selection prose', async () => {
  const summary = jest.fn();
  const report = jest.fn();
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onOpenDailyReport={report}
      retainedActions={{
        possibilities: jest.fn(),
        visitQuestions: jest.fn(),
        healthSummary: summary,
      }}
      onSend={async () => ({
        status: 'answer',
        answer: '선택한 보고서에 대한 실제 AI 응답',
        citations: [],
      })}
    />,
  );
  const choices = screen.getByTestId('conversation-quick-choices');
  expect(within(choices).getAllByRole('button')).toHaveLength(4);
  expect(choices).toHaveStyle({ paddingVertical: 20, gap: 12 });
  const divider = screen.getByTestId('conversation-choices-divider');
  expect(divider).toHaveStyle({
    marginBottom: 8,
    height: 1,
    backgroundColor: appColors.border,
  });
  expect(divider.props.accessible).toBe(false);
  expect(divider.props.pointerEvents).toBe('none');
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '합성 질문',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(screen.getByText('선택한 보고서에 대한 실제 AI 응답')).toBeTruthy();
  const serialized = JSON.stringify(screen.toJSON());
  expect(
    serialized.indexOf('선택한 보고서에 대한 실제 AI 응답'),
  ).toBeGreaterThan(serialized.indexOf('conversation-quick-choices'));
  expect(
    screen.queryByText('보고서 내용은 대화에 자동으로 전달되지 않아요.'),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  expect(report).toHaveBeenCalledTimes(1);
});
