import { View } from 'react-native';
import { t } from '../../i18n';
import { render, fireEvent } from '@testing-library/react-native';
import { ConversationHistory } from '../ConversationHistory';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import { createEmptyConversation } from '../conversationEmptySession';
import type { ConversationSession } from '../conversationSessionTypes';

const store = {
  loadOlderHistory: jest.fn(async () => {}),
  synchronizeModel: jest.fn(async () => {}),
  retryRestore: jest.fn(),
  toolSourceSessionId: jest.fn((): string | null => null),
};
function page(state: Partial<ConversationSession>, active = true) {
  const session = { ...createEmptyConversation(1), ...state };
  return (
    <ConversationHistory
      entryChoices={<View testID="synthetic-entry-choices" />}
      {...conversationHistoryRecoveryProps(session, store, active)}
      messages={session.messages}
      pendingMessage={null}
      error={session.error}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />
  );
}

/** Observe the actual transcript surface, including unchanged retained messages. */
test('canonical selection and restore show an accessible spinner without hiding existing content', async () => {
  const messages = [
    { id: 1, role: 'assistant' as const, content: 'Synthetic retained answer' },
  ];
  const ui = await render(page({ messages, modelSelectionPending: true }));
  const spinner = ui.getByRole('progressbar', {
    name: '이전 대화를 불러오는 중이에요',
  });
  expect(spinner.props.accessibilityState).toEqual({ busy: true });
  expect(spinner.props.animating).toBe(true);
  expect(ui.getByText('Synthetic retained answer')).toBeTruthy();
  await ui.rerender(page({ messages, restoring: true }));
  expect(ui.getByTestId('conversation-history-restoring')).toBeTruthy();
  await ui.rerender(page({ messages }));
  expect(ui.queryByTestId('conversation-history-restoring')).toBeNull();
  expect(ui.getByText('Synthetic retained answer')).toBeTruthy();
});

test('empty, fast completion, failure and retry do not leave stale animation', async () => {
  const ui = await render(page({}));
  expect(ui.queryByTestId('conversation-history-restoring')).toBeNull();
  await ui.rerender(page({ restoring: true }));
  expect(ui.getByTestId('conversation-history-restoring')).toBeTruthy();
  await ui.rerender(page({ restoring: false, restoreFailed: true }));
  expect(ui.queryByTestId('conversation-history-restoring')).toBeNull();
  await fireEvent.press(
    ui.getByText(t('ragConversation.history.retryRestore')),
  );
  expect(store.retryRestore).toHaveBeenCalledWith(1);
  await ui.rerender(page({ restoring: true }));
  expect(ui.getByTestId('conversation-history-restoring')).toBeTruthy();
  await ui.rerender(page({}));
  expect(ui.queryByTestId('conversation-history-restoring')).toBeNull();
});

test.each([
  { busy: true },
  { modelSelectionPending: true, preparingSend: true },
  { retryingSave: true },
  { historyLoading: true, preparingSend: true },
  { restoring: true, quarantined: true },
  { modelSelectionPending: true, modelSelectionFailed: true },
])(
  'unrelated or protected state does not claim restoration: %j',
  async state => {
    const ui = await render(page(state));
    expect(ui.queryByTestId('conversation-history-restoring')).toBeNull();
  },
);

test('inactive owner hides the indicator and a new restore can show it again', async () => {
  const ui = await render(page({ restoring: true }));
  await ui.rerender(page({ restoring: true }, false));
  expect(ui.queryByTestId('conversation-history-restoring')).toBeNull();
  await ui.rerender(page({ restoring: true }));
  expect(ui.getByTestId('conversation-history-restoring')).toBeTruthy();
});

test('attached model refresh is not labeled as history restoration', async () => {
  store.toolSourceSessionId.mockReturnValueOnce('synthetic-attached');
  const ui = await render(page({ modelSelectionPending: true }));
  expect(ui.queryByTestId('conversation-history-restoring')).toBeNull();
});

test('cold loading occupies the transcript before entry choices', async () => {
  const ui = await render(page({ restoring: true }));
  const tree = JSON.stringify(ui.toJSON());
  expect(tree.indexOf('conversation-history-restoring')).toBeLessThan(
    tree.indexOf('synthetic-entry-choices'),
  );
  expect(tree.indexOf('synthetic-entry-choices')).toBeGreaterThan(-1);
});

test('direct contradictory restore props prefer the failure state', async () => {
  const ui = await render(
    <ConversationHistory
      messages={[]}
      pendingMessage={null}
      error=""
      restoringHistory
      restoreFailed
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  expect(ui.queryByTestId('conversation-history-restoring')).toBeNull();
});
