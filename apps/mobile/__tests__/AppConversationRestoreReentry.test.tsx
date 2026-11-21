import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import App from '../App';
import {
  deferredPage,
  mountSyntheticRestoreAppState,
} from '../test-support/syntheticRestoreAppState';
import * as sessionOptions from '../src/aiFeatures/integration/conversationSessionOptions';
import { setup } from '../src/ragConversation/testSupport/continuousSessionFixture';
import {
  registerProtectedConversationHistoryPage,
  type ReadConversationHistoryPage,
} from '../src/ragConversation/conversationHistoryPage';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../src/storage/localDataClearEvents';
import * as conversationSessions from '../src/ragConversation/conversationSessions';
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
afterEach(() => jest.restoreAllMocks());
test.each([
  'same',
  'changed',
  'background',
  'deleted',
  'local-deleted',
  'cleared',
  'stopped',
  'relinked',
  'rapid',
  'batched',
  'superseded',
] as const)(
  'visibility changes preserve an initial read only for a freshly verified owner [%s]',
  async selection => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const appState = mountSyntheticRestoreAppState(selection === 'background');
    const fixture = await setup();
    let admit!: () => void;
    const pendingAuthority = new Promise<void>(resolve => {
      admit = resolve;
    });
    let admitNewest!: () => void;
    const pendingNewest = new Promise<void>(resolve => {
      admitNewest = resolve;
    });
    let authorityChecks = 0;
    let credentialEpoch = 0;
    const authority = jest.fn(async (signal: AbortSignal) => {
      const epoch = credentialEpoch;
      authorityChecks += 1;
      if (
        authorityChecks === 2 &&
        selection !== 'changed' &&
        selection !== 'relinked' &&
        selection !== 'superseded'
      )
        await pendingAuthority;
      if (selection === 'rapid' && authorityChecks === 3) await pendingNewest;
      return {
        ...(await fixture.options.continuousSession(signal)),
        selectionCurrent: () => epoch === credentialEpoch,
      };
    });
    const old = deferredPage();
    const fresh = deferredPage();
    let calls = 0;
    const read = jest.fn<
      ReturnType<ReadConversationHistoryPage>,
      Parameters<ReadConversationHistoryPage>
    >(async (_id, signal, _cursor, admission) => {
      const page = await (calls++ === 0 ? old.promise : fresh.promise);
      if (!admission) return page;
      return { ...page, assertAdmissionCurrent: await admission.wait(signal) };
    });
    // SQLite integration separately proves the real reader behind this seam.
    registerProtectedConversationHistoryPage(read);
    let raw!: ReturnType<
      typeof conversationSessions.createConversationSessions
    >;
    const create = conversationSessions.createConversationSessions;
    jest
      .spyOn(conversationSessions, 'createConversationSessions')
      .mockImplementation(options => {
        const store = create(options);
        if (options?.restoreSessionPage === read) raw = store;
        return store;
      });
    const rawContains = (text: string) =>
      raw
        .getSnapshot()
        .sessions.some(item =>
          item.messages.some(message => message.content === text),
        );
    jest
      .spyOn(sessionOptions, 'createConversationSessionOptions')
      .mockReturnValue({
        ...fixture.options,
        continuousSession: authority,
        restoreSessionPage: read,
      });
    let app: Awaited<ReturnType<typeof render>> | undefined;
    const oldAnswer = '취소한 합성 응답';
    const newAnswer = '현재 소유자의 합성 응답';
    try {
      app = await render(<App />);
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      const [firstId, firstSignal] = read.mock.calls[0]!;
      expect(screen.getByTestId('conversation-history-restoring')).toBeTruthy();
      if (selection === 'background') {
        await appState.phase('background');
        expect(firstSignal.aborted).toBe(false);
        await act(async () => old.settle(oldAnswer));
        expect(firstSignal.aborted).toBe(false);
        await appState.phase('active');
        expect(await screen.findByText(oldAnswer)).toBeTruthy();
        expect(read).toHaveBeenCalledTimes(1);
        return;
      }
      if (selection === 'batched' || selection === 'superseded') {
        await act(async () => {
          raw.setRootConversationVisible(false);
          raw.setRootConversationVisible(true);
        });
        if (selection === 'superseded') {
          const refresh = () =>
            raw.synchronizeModel(true, 'restart-interrupted-initial-page');
          await act(refresh);
          expect(firstSignal.aborted).toBe(false);
          await act(async () => {
            credentialEpoch++;
            void refresh();
          });
        }
      } else {
        await fireEvent.press(screen.getByTestId('navigation-tab-records'));
        expect(await screen.findByTestId('records-title')).toBeTruthy();
        expect(firstSignal.aborted).toBe(false);
        if (selection === 'changed') fixture.select('b');
        if (selection === 'relinked') credentialEpoch++;
        await fireEvent.press(
          screen.getByTestId('navigation-tab-conversation'),
        );
        expect(
          await screen.findByTestId('rag-conversation-screen'),
        ).toBeTruthy();
      }
      const deletion = selection.endsWith('deleted');
      if (deletion || selection === 'cleared' || selection === 'stopped') {
        await waitFor(() => expect(authority).toHaveBeenCalledTimes(2));
        await act(async () => {
          if (selection === 'deleted') notifyLocalSourceDeleted('healthkit');
          if (selection === 'local-deleted') {
            fixture.select('b');
            notifyLocalSourceDeleted('local');
          }
          if (selection === 'cleared') notifyLocalDataCleared();
          if (selection === 'stopped') raw.cancel(raw.getSnapshot().activeId);
        });
        expect(firstSignal.aborted).toBe(true);
        await act(async () => old.settle(oldAnswer));
        await act(async () => admit());
        expect(rawContains(oldAnswer)).toBe(false);
        if (deletion) {
          await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
          const [retryId, retrySignal] = read.mock.calls[1]!;
          expect(retrySignal).not.toBe(firstSignal);
          if (selection === 'local-deleted') expect(retryId).not.toBe(firstId);
          await act(async () => fresh.settle(newAnswer));
          expect(await screen.findByText(newAnswer)).toBeTruthy();
        } else expect(read).toHaveBeenCalledTimes(1);
        return;
      }
      if (
        selection === 'same' ||
        selection === 'rapid' ||
        selection === 'batched'
      ) {
        await waitFor(() => expect(authority).toHaveBeenCalledTimes(2));
        expect(firstSignal.aborted).toBe(false);
        expect(read).toHaveBeenCalledTimes(1);
        expect(
          screen.getByTestId('conversation-history-restoring'),
        ).toBeTruthy();
        await act(async () => old.settle(oldAnswer));
        expect(rawContains(oldAnswer)).toBe(false);
        if (selection === 'rapid') {
          await fireEvent.press(screen.getByTestId('navigation-tab-records'));
          await screen.findByTestId('records-title');
          await fireEvent.press(
            screen.getByTestId('navigation-tab-conversation'),
          );
          await waitFor(() => expect(authority).toHaveBeenCalledTimes(3));
          await act(async () => admit());
          expect(rawContains(oldAnswer)).toBe(false);
          await act(async () => admitNewest());
        } else await act(async () => admit());
        expect(await screen.findByText(oldAnswer)).toBeTruthy();
        expect(firstSignal.aborted).toBe(false);
        expect(read).toHaveBeenCalledTimes(1);
        return;
      }
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      const [freshId, freshSignal] = read.mock.calls[1]!;
      if (selection === 'relinked' || selection === 'superseded')
        expect(freshId).toBe(firstId);
      else expect(freshId).not.toBe(firstId);
      expect(freshSignal).not.toBe(firstSignal);
      expect(freshSignal.aborted).toBe(false);
      expect(firstSignal.aborted).toBe(true);
      await act(async () => old.settle(oldAnswer));
      expect(screen.queryByText(oldAnswer)).toBeNull();
      await act(async () => fresh.settle(newAnswer));
      expect(await screen.findByText(newAnswer)).toBeTruthy();
      expect(rawContains(oldAnswer)).toBe(false);
    } finally {
      await act(async () => {
        admit();
        admitNewest();
        old.settle(oldAnswer);
        fresh.settle(newAnswer);
      });
      await app?.unmount();
      appState.reset();
      fixture.store.dispose();
      fixture.close();
    }
  },
);
