import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, ScrollView, type AppStateStatus } from 'react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import { useConversationVisibility } from '../../aiFeatures/integration/useConversationVisibility';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';
import type { ConversationSessions } from '../conversationSessions';
import {
  at,
  fixture,
  sessionId,
} from '../testSupport/savedHistoryDisplayFixture';

jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));
jest.mock('../openConversationReadingPosition', () => ({
  openConversationReadingPosition: jest.fn(async () => null),
}));

const initialAppState = Object.getOwnPropertyDescriptor(
  AppState,
  'currentState',
)!;
afterEach(() => {
  Object.defineProperty(AppState, 'currentState', initialAppState);
  jest.restoreAllMocks();
});

test('keeps the same archived row and native scroll host mounted and does not reload on foreground return', async () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
    listeners.add(cb);
    return {
      remove: () => {
        listeners.delete(cb);
      },
    };
  });
  const setPhase = (state: AppStateStatus) => {
    Object.defineProperty(AppState, 'currentState', {
      value: state,
      configurable: true,
    });
    listeners.forEach(listener => listener(state));
  };
  setPhase('active');
  const f = await fixture(1);
  const fromModel = jest.fn(async () => ({
    id: sessionId,
    version: 0,
    updatedAt: at(0),
    model: { providerId: 'fixture-provider', modelId: 'fixture-model' },
  }));
  const fromStorage = jest.fn(f.reader);
  let store!: ConversationSessions;
  const ownsRoute = () => true;
  function Fixture() {
    store = useConversationSessions();
    const current = useConversationVisibility(
      () => AppState.currentState === 'active' && ownsRoute(),
      false,
      false,
    );
    const presentation = useConversationVisibility(ownsRoute, false, false);
    return (
      <ConversationScreen
        isEntryCurrent={current}
        ownsConversationPresentation={presentation}
        onOpenSource={jest.fn()}
        onBack={jest.fn()}
        onSend={jest.fn()}
      />
    );
  }
  const view = await render(
    <ConversationSessionsProvider
      options={{
        continuousSession: fromModel,
        readSavedHistoryDisplay: fromStorage,
        retention: f.retention,
        restoreSession: f.strict,
        restoreSessionPage: f.strict,
      }}
    >
      <Fixture />
    </ConversationSessionsProvider>,
  );
  try {
    const row = await screen.findByText('Synthetic saved answer 0');
    const history = screen.getByTestId('rag-conversation-history');
    await fireEvent(history, 'scrollBeginDrag');
    await fireEvent.scroll(history, {
      nativeEvent: {
        contentOffset: { x: 0, y: 220 },
        contentSize: { width: 320, height: 1000 },
        layoutMeasurement: { width: 320, height: 360 },
      },
    });
    await fireEvent(history, 'scrollEndDrag');
    const jump = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const follow = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
    jump.mockClear();
    follow.mockClear();
    const active = () => {
      const snapshot = store.getSnapshot();
      return snapshot.sessions.find(
        session => session.id === snapshot.activeId,
      );
    };
    const readyRows = active()?.savedHistoryDisplay;
    expect(readyRows).toBeDefined();
    expect(fromModel).toHaveBeenCalledTimes(1);
    expect(fromStorage).toHaveBeenCalledTimes(1);

    // A real store notification repaints the screen while iOS is still suspended.
    // A foreground-only gate here would unmount the archive first.
    for (const state of ['inactive', 'background', 'active'] as const) {
      await act(async () => {
        setPhase(state);
        store.setDraft(store.getSnapshot().activeId, state);
      });
      expect(screen.getByText('Synthetic saved answer 0')).toBe(row);
      expect(screen.getByTestId('rag-conversation-history')).toBe(history);
      expect(active()?.savedHistoryDisplay).toBe(readyRows);
      expect(screen.queryByTestId('conversation-history-restoring')).toBeNull();
    }
    expect(fromModel).toHaveBeenCalledTimes(1);
    expect(fromStorage).toHaveBeenCalledTimes(1);
    expect(jump).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();

    // A real local clear is different from suspension: existing ownership still revokes.
    await act(async () => {
      setPhase('background');
      notifyLocalDataCleared();
    });
    expect(screen.queryByText('Synthetic saved answer 0')).toBeNull();
    expect(f.strict).not.toHaveBeenCalled();
    expect(f.forbidden).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    f.f.close();
  }
});
