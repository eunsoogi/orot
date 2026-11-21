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
import { conversationChoiceActions } from '../selectConversationChoice';
import {
  at,
  fixture as archiveFixture,
  sessionId,
} from '../testSupport/savedHistoryDisplayFixture';
import type {
  ConversationSender,
  ConversationSessions,
} from '../conversationSessions';

function deferred<T>() {
  let resolve!: (x: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
}
function history() {
  return screen.getByTestId('rag-conversation-history');
}
function scroll(offset: number, contentHeight: number) {
  return fireEvent.scroll(history(), {
    nativeEvent: {
      contentOffset: { x: 0, y: offset },
      contentSize: { width: 390, height: contentHeight },
      layoutMeasurement: { width: 390, height: 400 },
    },
  });
}
test.each(['latest', 'earlier', 'explicit-model-check'] as const)(
  'a real choice only follows a newly measured offset when reading %s',
  async position => {
    const fixture = await archiveFixture(1);
    const modelGate = deferred<void>();
    const done = deferred<Awaited<ReturnType<ConversationSender>>>();
    let store!: ConversationSessions;
    let observer: Parameters<ConversationSender>[3];
    const sender = jest.fn<
      ReturnType<ConversationSender>,
      Parameters<ConversationSender>
    >((_question, _history, _signal, next) => {
      observer = next;
      return done.promise;
    });
    function Scene() {
      store = useConversationSessions();
      const choices = conversationChoiceActions(store, () => true);
      return (
        <ConversationScreen
          onSend={sender}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          retainedActions={{ healthSummary: choices.onOpenHealthSummary }}
        />
      );
    }
    let initial = true;
    const lookup = jest.fn(async () => {
      if (!initial) await modelGate.promise;
      initial = false;
      return {
        id: sessionId,
        version: 0,
        updatedAt: at(0),
        model: { providerId: 'fixture-provider', modelId: 'fixture-model' },
      };
    });
    const options = {
      continuousSession: lookup,
      readSavedHistoryDisplay: fixture.reader,
      retention: fixture.retention,
      restoreSession: fixture.strict,
      restoreSessionPage: fixture.strict,
      useProtectedPromptHistory: true,
    };
    const end = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
    const offset = jest.spyOn(ScrollView.prototype, 'scrollTo');
    try {
      const view = await render(
        <ConversationSessionsProvider options={options}>
          <Scene />
        </ConversationSessionsProvider>,
      );
      const answer = await screen.findByText('Synthetic saved answer 0');
      const choices = screen.getByTestId('conversation-quick-choices');
      await fireEvent(history(), 'layout', {
        nativeEvent: { layout: { height: 400 } },
      });
      await scroll(600, 1000);
      if (position === 'earlier') {
        await fireEvent(history(), 'scrollBeginDrag');
        await scroll(180, 1000);
        await fireEvent(history(), 'scrollEndDrag');
      }
      end.mockClear();
      offset.mockClear();
      await fireEvent.press(
        screen.getByTestId('conversation-open-health-summary'),
      );
      const session = () =>
        store
          .getSnapshot()
          .sessions.find(s => s.id === store.getSnapshot().activeId)!;
      const previewId = session().preparingQuickChoice?.id;
      expect(previewId).toEqual(expect.any(Number));
      expect(sender).not.toHaveBeenCalled();
      expect(lookup).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Synthetic saved answer 0')).toBe(answer);
      expect(screen.getByTestId('conversation-quick-choices')).toBe(choices);
      if (position === 'explicit-model-check') {
        let checking!: Promise<void>;
        await act(() => {
          checking = store.synchronizeModel(true);
        });
        expect(screen.queryByText('Synthetic saved answer 0')).toBeNull();
        await act(async () => {
          modelGate.resolve();
          await checking;
        });
        expect(sender).not.toHaveBeenCalled();
        expect(
          await screen.findByText('Synthetic saved answer 0'),
        ).toBeTruthy();
        await view.unmount();
        return;
      }
      await fireEvent(history(), 'contentSizeChange', 390, 1000);
      expect(end).not.toHaveBeenCalled();
      await fireEvent(history(), 'contentSizeChange', 390, 1070);
      expect(end).toHaveBeenCalledTimes(position === 'latest' ? 1 : 0);
      if (position === 'latest') await scroll(670, 1070);
      await act(async () => modelGate.resolve());
      await waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
      expect(
        session().messages.filter(row => row.id === previewId),
      ).toHaveLength(1);
      await act(async () => observer?.onProviderReceipt?.('response_started'));
      expect(
        session().messages.find(row => row.id === previewId)?.delivery?.readAt,
      ).toBeDefined();
      expect(screen.getByText('Synthetic saved answer 0')).toBe(answer);
      expect(screen.getByTestId('conversation-quick-choices')).toBe(choices);
      await fireEvent(history(), 'contentSizeChange', 390, 1070);
      expect(end).toHaveBeenCalledTimes(position === 'latest' ? 1 : 0);
      expect(offset).not.toHaveBeenCalled();
      await act(async () => done.resolve({ status: 'insufficient' }));
      await view.unmount();
    } finally {
      end.mockRestore();
      offset.mockRestore();
      modelGate.resolve();
      fixture.f.close();
    }
  },
);
