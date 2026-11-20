import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import { createAiFeatureServices } from '../../aiFeatures/integration/featureServices';
import { t } from '../../i18n';

test('native Send event without a provider retains the unsent draft and visible local recovery across route return', async () => {
  let finish!: (value: null) => void;
  const retry = new Promise<null>(resolve => {
    finish = resolve;
  });
  let finishCancelled!: (value: null) => void;
  const cancelledRetry = new Promise<null>(resolve => {
    finishCancelled = resolve;
  });
  const load = jest
    .fn<Promise<null>, []>()
    .mockResolvedValue(null)
    .mockResolvedValueOnce(null)
    .mockReturnValueOnce(cancelledRetry)
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
  await fireEvent(
    screen.getByTestId('rag-conversation-cancel'),
    'composerPress',
  );
  await waitFor(() =>
    expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(
      false,
    ),
  );
  await act(async () => {
    finishCancelled(null);
  });
  expect(screen.queryByTestId('rag-conversation-error')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'test\n',
  );
  await fireEvent(screen.getByTestId('rag-conversation-send'), 'composerPress');
  expect(load).toHaveBeenCalledTimes(3);
  await act(async () => {
    finish(null);
  });
  const localError = t('ragConversation.preflight.failed');
  const assertLocalRecovery = () => {
    expect(screen.getByTestId('rag-conversation-error').props.children).toBe(
      localError,
    );
    expect(screen.getAllByTestId('rag-conversation-error')).toHaveLength(1);
    const composer = screen.getByTestId('rag-conversation-composer');
    const history = screen.getByTestId('rag-conversation-history');
    expect(
      within(composer).getByTestId('rag-conversation-error').props
        .accessibilityRole,
    ).toBe('alert');
    expect(within(history).queryByTestId('rag-conversation-error')).toBeNull();
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
  // The alert is part of the same measured overlay; reserve its added height
  // without dispatching a synthetic scroll or changing reader ownership.
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  try {
    await fireEvent(
      screen.getByTestId('conversation-floating-composer-overlay'),
      'layout',
      {
        nativeEvent: { layout: { height: 140, width: 390, x: 0, y: 340 } },
      },
    );
    expect(
      StyleSheet.flatten(
        screen.getByTestId('rag-conversation-history').props
          .contentContainerStyle,
      ).paddingBottom,
    ).toBeGreaterThanOrEqual(140);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollToEnd).not.toHaveBeenCalled();
  } finally {
    scrollTo.mockRestore();
    scrollToEnd.mockRestore();
  }
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'test\n',
  );
  expect(screen.getByTestId('rag-conversation-error')).toBeTruthy();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'edited test',
  );
  expect(screen.queryByTestId('rag-conversation-error')).toBeNull();
  expect(onSend).not.toHaveBeenCalled();
});

test('preflight rejected after editing does not attach the old notice to the newer draft', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<null>((_, fail) => {
    reject = fail;
  });
  const load = jest
    .fn<Promise<null>, []>()
    .mockResolvedValue(null)
    .mockResolvedValueOnce(null)
    .mockReturnValueOnce(pending);
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
  await render(
    <ConversationSessionsProvider
      options={services.conversationSessionOptions()}
    >
      <ConversationScreen
        onSend={onSend}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
      />
    </ConversationSessionsProvider>,
  );
  const edit = (draft: string) =>
    fireEvent.changeText(screen.getByTestId('rag-conversation-input'), draft);
  await edit('original draft');
  await fireEvent(screen.getByTestId('rag-conversation-send'), 'composerPress');
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('rag-conversation-cancel')).toBeTruthy();
  expect(screen.queryByTestId('rag-conversation-error')).toBeNull();

  await edit('newer draft');
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'newer draft',
  );
  await act(async () => {
    reject(new Error('synthetic selected AI load failed'));
  });
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(
    false,
  );
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'newer draft',
  );
  expect(screen.queryByTestId('rag-conversation-error')).toBeNull();
  expect(onSend).not.toHaveBeenCalled();
  expect(ragRunner).not.toHaveBeenCalled();
  expect(authorize).not.toHaveBeenCalled();
});

test('ordinary coherent request failure remains in history', async () => {
  const onSend = jest.fn(async () => ({
    status: 'failure' as const,
    kind: 'provider_configuration' as const,
  }));
  await render(
    <ConversationScreen
      onSend={onSend}
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'test',
  );
  await fireEvent(screen.getByTestId('rag-conversation-send'), 'composerPress');
  await waitFor(() =>
    expect(
      within(screen.getByTestId('rag-conversation-history')).getAllByText(
        t('ragConversation.failureProviderConfiguration'),
      ),
    ).toHaveLength(1),
  );
  expect(
    within(screen.getByTestId('rag-conversation-composer')).queryByTestId(
      'rag-conversation-error',
    ),
  ).toBeNull();
  expect(onSend).toHaveBeenCalledTimes(1);
});
