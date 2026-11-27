import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { continuousSessionOption } from '../../aiFeatures/integration/continuousSessionOption';
import { createAppleSelectionOption } from '../../providers/selection/options';
import { createConversationInitialPageAdmission } from '../conversationInitialPageAdmission';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useSyncExternalStore } from 'react';
import { t } from '../../i18n';
import { ConversationHistory } from '../ConversationHistory';
import { conversationHistoryRecoveryProps } from '../conversationHistoryRecoveryProps';
import {
  createConversationSessions,
  type ConversationSessions,
} from '../conversationSessions';
import { setup } from '../testSupport/continuousSessionFixture';

function History({ store }: { store: ConversationSessions }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const session = state.sessions.find(row => row.id === state.activeId)!;
  return (
    <ConversationHistory
      {...conversationHistoryRecoveryProps(session, store)}
      messages={session.messages}
      pendingMessage={null}
      error={session.error}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />
  );
}

test.each([true, false])(
  'blue retry of a retired first page requires the exact existing canonical pointer: %s',
  async samePointer => {
    const fixture = await setup();
    const now = '2035-01-01T00:00:00.000Z';
    const generate = jest.fn(async () => {
      throw new Error('No model invocation expected.');
    });
    const provider = new AppleFoundationModelsProvider({
      getAvailability: async () => ({ status: 'available' }),
      generate,
      async *stream() {
        throw new Error('No model invocation expected.');
      },
      cancel: jest.fn(),
    });
    const option = { ...createAppleSelectionOption('available'), provider };
    const model = { providerId: provider.id, modelId: option.modelId };
    const signal = new AbortController().signal;
    const initial = await fixture.storage.continuousSession(
      model,
      'existing',
      now,
      signal,
    );
    const selection = jest.fn(async () => ({
      status: 'ready' as const,
      selection: model,
      provider,
      modelId: option.modelId,
      option,
      remoteProcessing: false,
      recipient: 'Synthetic on-device',
    }));
    const options = continuousSessionOption(
      selection,
      async () => fixture.storage,
      () => id => (id === provider.id ? () => true : null),
    );
    const pages = {
      rows: [
        {
          id: 'synthetic-old-row',
          createdAt: now,
          kind: 'interrupted' as const,
          question: 'Synthetic saved question',
        },
      ],
      nextCursor: null,
    };
    let release!: () => void;
    const read = jest
      .fn(async () => pages)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = () => resolve(pages);
          }),
      );
    const store = createConversationSessions({
      ...fixture.options,
      ...options,
      restoreSessionPage: async () => ({
        turns: [],
        taskCards: [],
        nextCursor: null,
      }),
      readSavedHistoryDisplay: read,
    });
    const view = await render(<History store={store} />);
    let first: Promise<void> | undefined;
    try {
      await act(async () => {
        store.setRootConversationVisible(true);
        first = store.synchronizeModel();
      });
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      const localId = store.getSnapshot().activeId;
      await act(async () => {
        store.setRootConversationVisible(false);
        await store.synchronizeModel(true);
        store.setRootConversationVisible(true);
        release();
        await first;
      });
      if (!samePointer)
        await fixture.storage.continuousSession(
          { ...model, modelId: 'replaced' },
          'other',
          now,
          signal,
        );
      const validate = fixture.storage.validateWarmLease;
      let releaseProof!: () => void;
      const proof = jest
        .spyOn(fixture.storage, 'validateWarmLease')
        .mockImplementationOnce(
          (...args) =>
            new Promise(resolve => {
              releaseProof = () => resolve(validate(...args));
            }),
        );
      const retryLabel = t('ragConversation.history.retryRestore');
      await fireEvent.press(screen.getByText(retryLabel));
      expect(screen.getByTestId('conversation-history-restoring')).toBeTruthy();
      expect(screen.queryByText(retryLabel)).toBeNull();
      expect(
        store.getSnapshot().sessions.find(row => row.id === localId)
          ?.restoreFailed,
      ).toBe(true);
      const joined = store.retryRestore(localId);
      expect(store.retryRestore(localId)).toBe(joined);
      await waitFor(() => expect(proof).toHaveBeenCalledTimes(1));
      expect(read).toHaveBeenCalledTimes(1);
      await act(async () => {
        releaseProof();
        await joined;
      });
      if (samePointer) {
        expect(
          await screen.findByText('Synthetic saved question'),
        ).toBeTruthy();
        expect(read).toHaveBeenCalledTimes(2);
      } else {
        await act(async () => store.retryRestore(localId));
        expect(screen.queryByText('Synthetic saved question')).toBeNull();
        expect(
          screen.getByText(t('ragConversation.history.retryRestore')),
        ).toBeTruthy();
        expect(read).toHaveBeenCalledTimes(1);
      }
      expect(screen.queryByTestId('conversation-history-restoring')).toBeNull();
      expect(selection).toHaveBeenCalledTimes(2);
      expect(generate).not.toHaveBeenCalled();
      expect(
        Boolean(
          store.getSnapshot().sessions.find(row => row.id === localId)
            ?.restoreFailed,
        ),
      ).toBe(!samePointer);
      expect(store.getSnapshot().activeId).toBe(localId);
      expect(store.toolSourceSessionId(localId)).toBe(initial.id);
    } finally {
      await view.unmount();
      store.dispose();
      fixture.store.dispose();
      fixture.close();
    }
  },
);

test('retiring the initial root permit wakes held callers but never admits their data', async () => {
  const gate = createConversationInitialPageAdmission();
  const signal = new AbortController().signal;
  const release = gate.hold();
  const waiting = gate.wait(signal);
  gate.retire();
  release();
  await expect(waiting).rejects.toThrow(
    'Conversation restoration was cancelled.',
  );
  await expect(gate.wait(signal)).rejects.toThrow(
    'Conversation restoration was cancelled.',
  );
});
