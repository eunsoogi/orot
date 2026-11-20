import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { View } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import { createAiFeatureServices } from '../../aiFeatures/integration/featureServices';
import { t } from '../../i18n';

test('native Send event without a provider retains the unsent draft and visible local recovery across route return', async () => {
  let finish!: (value: null) => void;
  const retry = new Promise<null>(resolve => {
    finish = resolve;
  });
  const load = jest
    .fn<Promise<null>, []>()
    .mockResolvedValue(null)
    .mockResolvedValueOnce(null)
    .mockReturnValueOnce(retry);
  const ragRunner = jest.fn();
  const authorize = jest.fn();
  const services = createAiFeatureServices(
    { authorize },
    {
      selectedAi: {
        selectionStore: { load, clear: jest.fn(), save: jest.fn() },
      },
      ragRunner,
    },
  );
  const onSend = jest.fn(services.sendRagMessage);
  const options = services.conversationSessionOptions();
  const app = (conversation: boolean) => (
    <ConversationSessionsProvider options={options}>
      {conversation ? (
        <ConversationScreen
          onSend={onSend}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
        />
      ) : (
        <View testID="settings-substitute" />
      )}
    </ConversationSessionsProvider>
  );
  const view = await render(app(true));
  await waitFor(() =>
    expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(
      true,
    ),
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'test\n',
  );
  await waitFor(() =>
    expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(
      false,
    ),
  );
  expect(
    screen.getByTestId('rag-conversation-input').props.onSubmitEditing,
  ).toBeUndefined();
  await fireEvent(screen.getByTestId('rag-conversation-send'), 'composerPress');
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('rag-conversation-cancel')).toBeTruthy();
  expect(screen.queryByTestId('rag-conversation-error')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'test\n',
  );
  await act(async () => {
    finish(null);
  });
  const localError = t('ragConversation.preflight.failed');
  const assertLocalRecovery = () => {
    expect(screen.getByTestId('rag-conversation-error').props.children).toBe(
      localError,
    );
    expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
      'test\n',
    );
    expect(screen.queryByTestId('conversation-message-body')).toBeNull();
    expect(
      screen.queryByText(t('ragConversation.failureProviderConfiguration')),
    ).toBeNull();
    expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    expect(ragRunner).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  };
  await waitFor(assertLocalRecovery);
  await view.rerender(app(false));
  expect(screen.getByTestId('settings-substitute')).toBeTruthy();
  await view.rerender(app(true));
  await waitFor(assertLocalRecovery);
});
