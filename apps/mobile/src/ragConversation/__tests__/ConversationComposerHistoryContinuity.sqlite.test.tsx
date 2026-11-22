import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type {
  ConversationSender,
  ConversationSessions,
} from '../conversationSessions';
import {
  at,
  fixture,
  sessionId,
} from '../testSupport/savedHistoryDisplayFixture';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {
    resolve = finish;
  });
  return { promise, resolve };
}

test.each([
  'same owner',
  'explicit selection',
  'clear local data',
  'replacement version',
] as const)(
  'a typed Send maintains the mounted transcript only for an admitted display: %s',
  async mode => {
    const archive = await fixture(1);
    const modelGate = held<void>();
    const refreshGate = held<void>();
    const refresh = archive.retention.refreshExisting;
    const refreshProof = jest
      .spyOn(archive.retention, 'refreshExisting')
      .mockImplementation(async (...args) => {
        if (args[2] === 1) await refreshGate.promise;
        return refresh(...args);
      });
    const result = held<Awaited<ReturnType<ConversationSender>>>();
    const model = { providerId: 'fixture-provider', modelId: 'fixture-model' };
    const select = jest.fn(async () => {
      if (select.mock.calls.length > 1) {
        await modelGate.promise;
        if (mode === 'replacement version')
          return { id: sessionId, version: 1, updatedAt: at(0), model };
      }
      return { id: sessionId, version: 0, updatedAt: at(0), model };
    });
    const read = jest.fn(archive.reader);
    const send = jest.fn<
      ReturnType<ConversationSender>,
      Parameters<ConversationSender>
    >(() => result.promise);
    const jump = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const follow = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
    let store!: ConversationSessions;
    function Scene() {
      store = useConversationSessions();
      return (
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={send}
        />
      );
    }
    const view = await render(
      <ConversationSessionsProvider
        options={{
          continuousSession: select,
          readSavedHistoryDisplay: read,
          retention: archive.retention,
          restoreSession: archive.strict,
          restoreSessionPage: archive.strict,
          useProtectedPromptHistory: true,
        }}
      >
        <Scene />
      </ConversationSessionsProvider>,
    );
    const saved = 'Synthetic saved answer 0';
    try {
      const row = await screen.findByText(saved);
      const history = screen.getByTestId('rag-conversation-history');
      await fireEvent(history, 'layout', {
        nativeEvent: { layout: { height: 400 } },
      });
      await fireEvent(history, 'scrollBeginDrag');
      await fireEvent.scroll(history, {
        nativeEvent: {
          contentOffset: { x: 0, y: 180 },
          contentSize: { width: 390, height: 1000 },
          layoutMeasurement: { width: 390, height: 400 },
        },
      });
      await fireEvent(history, 'scrollEndDrag');
      jump.mockClear();
      follow.mockClear();

      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        'Synthetic typed draft',
      );
      await fireEvent(
        screen.getByTestId('rag-conversation-send'),
        'composerPress',
      );
      expect(select).toHaveBeenCalledTimes(2);
      expect(send).not.toHaveBeenCalled();
      expect(screen.getByText(saved)).toBe(row);
      expect(screen.getByTestId('rag-conversation-history')).toBe(history);
      expect(screen.queryByTestId('conversation-history-restoring')).toBeNull();
      await fireEvent(history, 'contentSizeChange', 390, 1000);
      expect(jump).not.toHaveBeenCalled();
      expect(follow).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledTimes(1);

      if (mode === 'explicit selection') {
        let recheck!: Promise<void>;
        await act(() => {
          recheck = store.synchronizeModel(true);
        });
        expect(screen.queryByText(saved)).toBeNull();
        await act(async () => {
          modelGate.resolve();
          await recheck;
        });
        expect(send).not.toHaveBeenCalled();
        expect(await screen.findByText(saved)).toBeTruthy();
        return;
      }
      if (mode === 'clear local data') {
        await act(async () => {
          notifyLocalDataCleared();
          modelGate.resolve();
        });
        expect(screen.queryByText(saved)).toBeNull();
        expect(send).not.toHaveBeenCalled();
        return;
      }
      if (mode === 'replacement version') {
        await act(async () => modelGate.resolve());
        await waitFor(() =>
          expect(
            refreshProof.mock.calls.some(([, , version]) => version === 1),
          ).toBe(true),
        );
        expect(screen.queryByText(saved)).toBeNull();
        expect(send).not.toHaveBeenCalled();
        await act(async () => refreshGate.resolve());
        expect(screen.queryByText(saved)).toBeNull();
        expect(send).not.toHaveBeenCalled();
        return;
      }
      await act(async () => modelGate.resolve());
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send.mock.calls[0]?.[0]).toBe('Synthetic typed draft');
      expect(screen.getByText(saved)).toBe(row);
      expect(screen.getByTestId('rag-conversation-history')).toBe(history);
      expect(read).toHaveBeenCalledTimes(1);
      await act(async () =>
        send.mock.calls[0]?.[3]?.onProviderReceipt?.('response_started'),
      );
      expect(screen.getAllByText('Synthetic typed draft')).toHaveLength(1);
      await act(async () => result.resolve({ status: 'insufficient' }));
      expect(screen.getByText(saved)).toBe(row);
    } finally {
      modelGate.resolve();
      refreshGate.resolve();
      refreshProof.mockRestore();
      result.resolve({ status: 'insufficient' });
      await view.unmount();
      jump.mockRestore();
      follow.mockRestore();
      archive.f.close();
    }
  },
);
