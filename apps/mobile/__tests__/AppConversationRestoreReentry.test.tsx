import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import App from '../App';
import * as sessionOptions from '../src/aiFeatures/integration/conversationSessionOptions';
import { setup } from '../src/ragConversation/testSupport/continuousSessionFixture';
import type { ConversationHistoryPage } from '../src/ragConversation/conversationHistoryPage';

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
