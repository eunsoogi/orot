import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import { appColors } from '../../layout/appColors';

/** Exercise cold hydration rather than marking rendered rows restored by hand. */
test('keeps a visible divider between hydrated history and all four choices through a new turn', async () => {
  let store!: ConversationSessions;
  let attached = false;
  const options = {
    retention: {
      attachExisting: async () => {
        attached = true;
      },
      activeIdentity: () => (attached ? 'synthetic-session' : null),
      activeLease: () => null,
      beginTurn: async () => undefined,
      invalidate: () => {},
    } as never,
    restoreSession: async () => [
      {
        question: 'Synthetic old question',
        answer: 'Synthetic old answer',
        citations: [],
      },
    ],
  };
  function Capture() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onOpenDailyReport={jest.fn()}
        retainedActions={{
          possibilities: jest.fn(),
          visitQuestions: jest.fn(),
          healthSummary: jest.fn(),
        }}
        onSend={async () => ({
          status: 'answer',
          answer: 'Synthetic new answer',
          citations: [],
        })}
      />
    );
  }
  const mount = () =>
    render(
      <ConversationSessionsProvider options={options}>
        <Capture />
      </ConversationSessionsProvider>,
    );
  // A fresh provider models the app being closed and opened again.
  const first = await mount();
  await first.unmount();
  await mount();
  await act(() =>
    store.attachExisting('synthetic-session', 0, '2026-11-17T00:00:00Z'),
  );
  expect(screen.getByText('Synthetic old answer')).toBeTruthy();
  const divider = screen.getByTestId('conversation-choices-divider');
  expect(divider).toHaveStyle({
    height: 1,
    flexShrink: 0,
    alignSelf: 'stretch',
    backgroundColor: appColors.border,
  });
  expect(divider.props.pointerEvents).toBe('none');
  expect(divider.props.accessible).toBe(false);
  expect(
    within(screen.getByTestId('conversation-quick-choices')).getAllByRole(
      'button',
    ),
  ).toHaveLength(4);
  const serialized = () => JSON.stringify(screen.toJSON());
  expect(serialized().indexOf('Synthetic old answer')).toBeLessThan(
    serialized().indexOf('conversation-choices-divider'),
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Synthetic new question',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(screen.getAllByTestId('conversation-choices-divider')).toHaveLength(1);
  expect(serialized().indexOf('conversation-choices-divider')).toBeLessThan(
    serialized().indexOf('Synthetic new question'),
  );
});
