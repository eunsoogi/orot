import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState, ScrollView } from 'react-native';
import App from '../App';
import * as sessionOptions from '../src/aiFeatures/integration/conversationSessionOptions';
import { setup } from '../src/ragConversation/testSupport/continuousSessionFixture';
import type { ConversationHistoryPage } from '../src/ragConversation/conversationHistoryPage';
import {
  at,
  fixture as savedArchive,
  sessionId,
} from '../src/ragConversation/testSupport/savedHistoryDisplayFixture';
import { notifyLocalDataCleared } from '../src/storage/localDataClearEvents';

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function deferredPage() {
  let settle!: (page: ConversationHistoryPage) => void;
  const promise = new Promise<ConversationHistoryPage>(resolve => {
    settle = resolve;
  });
  return {
    promise,
    settle: (answer: string) =>
      settle({
        turns: [{ question: '합성 질문', answer, citations: [] }],
        taskCards: [],
        nextCursor: null,
      }),
  };
}

afterEach(() => jest.restoreAllMocks());

test.each(['same', 'changed'] as const)(
  're-entry during initial restore admits only the fresh active owner [%s]',
  async selection => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const fixture = await setup();
    const old = deferredPage();
    const fresh = deferredPage();
    let calls = 0;
    const read = jest.fn((_id: string, _signal: AbortSignal) =>
      calls++ === 0 ? old.promise : fresh.promise,
    );
    jest
      .spyOn(sessionOptions, 'createConversationSessionOptions')
      .mockReturnValue({
        ...fixture.options,
        restoreSessionPage: read,
      });
    const app = await render(<App />);
    const oldAnswer = '취소한 합성 응답';
    const newAnswer = '현재 소유자의 합성 응답';
    try {
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      const [firstId, firstSignal] = read.mock.calls[0]!;
      expect(screen.getByTestId('conversation-history-restoring')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('navigation-tab-records'));
      expect(await screen.findByTestId('records-title')).toBeTruthy();
      expect(firstSignal.aborted).toBe(false);
      if (selection === 'changed') fixture.select('b');
      await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
      expect(await screen.findByTestId('rag-conversation-screen')).toBeTruthy();
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      const [freshId, freshSignal] = read.mock.calls[1]!;
      expect(freshId === firstId).toBe(selection === 'same');
      expect(freshSignal).not.toBe(firstSignal);
      expect(freshSignal.aborted).toBe(false);
      expect(firstSignal.aborted).toBe(true);
      expect(screen.getByTestId('conversation-history-restoring')).toBeTruthy();
      await act(async () => old.settle(oldAnswer));
      expect(screen.queryByText(oldAnswer)).toBeNull();
      await act(async () => fresh.settle(newAnswer));
      expect(await screen.findByText(newAnswer)).toBeTruthy();
      expect(screen.queryByText(oldAnswer)).toBeNull();
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => {
        old.settle(oldAnswer);
        fresh.settle(newAnswer);
      });
      await app.unmount();
      if (original) Object.defineProperty(AppState, 'currentState', original);
      fixture.store.dispose();
      fixture.close();
    }
  },
);

test('keeps the settled transcript and draft across root tabs without another model or archive read', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const f = await savedArchive(1);
  const answer = 'Synthetic saved answer 0';
  const draft = '보내지 않은 합성 초안';
  let releaseLookup!: () => void;
  const blocked = new Promise<void>(resolve => {
    releaseLookup = resolve;
  });
  let firstResolution = true;
  const lookup = jest.fn(async () => {
    if (!firstResolution) await blocked;
    firstResolution = false;
    return {
      id: sessionId,
      version: 0,
      updatedAt: at(0),
      model: { providerId: 'fixture-provider', modelId: 'fixture-model' },
    };
  });
  const read = jest.fn(f.reader);
  jest
    .spyOn(sessionOptions, 'createConversationSessionOptions')
    .mockReturnValue({
      continuousSession: lookup,
      readSavedHistoryDisplay: read,
      retention: f.retention,
      restoreSession: f.strict,
      restoreSessionPage: f.strict,
    });
  const app = await render(<App />);
  try {
    expect(await screen.findByText(answer)).toBeTruthy();
    const scroll = screen.getByTestId('rag-conversation-history');
    await fireEvent(scroll, 'scrollBeginDrag');
    await fireEvent.scroll(scroll, {
      nativeEvent: {
        contentOffset: { x: 0, y: 220 },
        contentSize: { width: 320, height: 1000 },
        layoutMeasurement: { width: 320, height: 360 },
      },
    });
    await fireEvent(scroll, 'scrollEndDrag');
    const jump = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const follow = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
    jump.mockClear();
    follow.mockClear();

    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      draft,
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('navigation-tab-records'));
    expect(await screen.findByTestId('records-title')).toBeTruthy();
    expect(screen.queryByText(answer)).toBeNull();
    expect(
      screen.getByText(answer, { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(
      screen.getByTestId('rag-conversation-history', {
        includeHiddenElements: true,
      }),
    ).toBe(scroll);
    await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
    // A redundant new lookup would still be blocked on the first accessible render.
    expect(await screen.findByTestId('rag-conversation-history')).toBe(scroll);
    expect(screen.getByText(answer)).toBeTruthy();
    expect(screen.getByTestId('rag-conversation-history')).toBe(scroll);
    expect(screen.getByTestId('rag-conversation-input')).toHaveDisplayValue(
      draft,
    );
    expect(screen.queryByTestId('conversation-history-restoring')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(jump).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();

    // An actual privacy invalidation still wins while Chat is hidden.
    await fireEvent.press(screen.getByTestId('navigation-tab-records'));
    await act(async () => notifyLocalDataCleared());
    await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
    expect(screen.queryByText(answer)).toBeNull();
    expect(f.strict).not.toHaveBeenCalled();
    expect(f.forbidden).not.toHaveBeenCalled();
  } finally {
    await act(async () => releaseLookup());
    await app.unmount();
    if (original) Object.defineProperty(AppState, 'currentState', original);
    f.f.close();
  }
});
