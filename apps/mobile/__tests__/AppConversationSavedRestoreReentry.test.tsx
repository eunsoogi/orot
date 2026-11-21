import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import App from '../App';
import * as boot from '../src/aiFeatures/integration/conversationSessionOptions';
import * as conversations from '../src/ragConversation/conversationSessions';
import { conversationSavedHistoryDisplayOption } from '../src/aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { setup } from '../src/ragConversation/testSupport/continuousSessionFixture';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../src/storage/localDataClearEvents';

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
function gate() {
  let release = () => {};
  const promise = new Promise<void>(done => {
    release = done;
  });
  return { release, promise };
}

afterEach(() => jest.restoreAllMocks());

test.each([
  'same',
  'changed',
  'relinked',
  'stop',
  'clear',
  'deleted',
  'rapid',
] as const)(
  'initial saved page stays private while root tab authority is pending [%s]',
  async scenario => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    const f = await setup();
    const signal = new AbortController().signal;
    const a = await f.options.continuousSession(signal);
    const answerA = 'A owned synthetic archived answer';
    const answerB = 'B owned synthetic archived answer';
    let nextLeaseId: string | undefined;
    async function save(lease: typeof a, text: string) {
      await f.storage.append({
        id: `answer-${lease.id}`,
        sessionId: lease.id,
        createdAt: lease.updatedAt,
        question: 'Synthetic archived question',
        answer: text,
        modelId: lease.model.modelId,
        providerId: lease.model.providerId,
        status: 'complete',
        sources: [],
        citations: [],
        delivery: {
          submittedAt: lease.updatedAt,
          acceptedAt: lease.updatedAt,
          readAt: lease.updatedAt,
        },
        initialResponse: {
          callId: 'opening-synthetic',
          text: 'Persisted opening',
        },
      });
    }
    await save(a, answerA);
    const firstStorage = gate();
    const firstSettled = gate();
    const holdAuthority = gate();
    const holdNewest = gate();
    const actual = conversationSavedHistoryDisplayOption(async () => f.storage);
    let reads = 0;
    const read = jest.fn<ReturnType<typeof actual>, Parameters<typeof actual>>(
      async (...args) => {
        const first = reads++ === 0;
        const page = await actual(...args);
        if (first) {
          firstSettled.release();
          await firstStorage.promise;
        }
        return page;
      },
    );
    let credentialEpoch = 0;
    let authorityCalls = 0;
    const authority = jest.fn(async (requestSignal: AbortSignal) => {
      const owner = credentialEpoch;
      const attempt = ++authorityCalls;
      if (attempt === 2 && scenario !== 'changed' && scenario !== 'relinked')
        await holdAuthority.promise;
      if (attempt === 3 && scenario === 'rapid') await holdNewest.promise;
      const target = await f.options.continuousSession(requestSignal);
      if (target.model.modelId === 'b' && nextLeaseId !== target.id) {
        nextLeaseId = target.id;
        await save(target, answerB);
      }
      return { ...target, selectionCurrent: () => owner === credentialEpoch };
    });
    const strict = jest.fn(async () => {
      throw new Error('Strict restoration cannot serve archive display');
    });
    let store: conversations.ConversationSessions | undefined;
    const create = conversations.createConversationSessions;
    jest
      .spyOn(conversations, 'createConversationSessions')
      .mockImplementation(options => {
        const created = create(options);
        if (options?.readSavedHistoryDisplay === read) store = created;
        return created;
      });
    jest.spyOn(boot, 'createConversationSessionOptions').mockReturnValue({
      ...f.options,
      continuousSession: authority,
      restoreSession: strict,
      restoreSessionPage: strict,
      readSavedHistoryDisplay: read,
    });
    const rawHas = (answer: string) =>
      store!
        .getSnapshot()
        .sessions.some(session =>
          session.savedHistoryDisplay?.some(
            ({ row }) => row.kind === 'answer' && row.answer === answer,
          ),
        );
    const away = async () => {
      await fireEvent.press(screen.getByTestId('navigation-tab-records'));
      expect(await screen.findByTestId('records-title')).toBeTruthy();
    };
    const enter = async () => {
      await fireEvent.press(screen.getByTestId('navigation-tab-conversation'));
      expect(await screen.findByTestId('rag-conversation-screen')).toBeTruthy();
    };
    let app: Awaited<ReturnType<typeof render>> | undefined;
    try {
      app = await render(<App />);
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      await firstSettled.promise;
      const firstSignal = read.mock.calls[0]![2];
      await away();
      expect(firstSignal.aborted).toBe(false);
      await act(async () => firstStorage.release());
      expect(rawHas(answerA)).toBe(false);
      if (scenario === 'changed' || scenario === 'deleted') f.select('b');
      if (scenario === 'relinked') credentialEpoch++;
      await enter();
      if (scenario === 'changed' || scenario === 'relinked') {
        await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        expect(firstSignal.aborted).toBe(true);
        expect(read.mock.calls[1]![0]).toBe(
          scenario === 'changed' ? nextLeaseId : a.id,
        );
        expect(
          await screen.findByText(scenario === 'changed' ? answerB : answerA),
        ).toBeTruthy();
        if (scenario === 'changed') expect(rawHas(answerA)).toBe(false);
      } else {
        await waitFor(() => expect(authority).toHaveBeenCalledTimes(2));
        expect(firstSignal.aborted).toBe(false);
        expect(rawHas(answerA)).toBe(false);
        if (
          scenario === 'stop' ||
          scenario === 'clear' ||
          scenario === 'deleted'
        ) {
          await act(async () => {
            if (scenario === 'stop')
              store!.cancel(store!.getSnapshot().activeId);
            if (scenario === 'clear') notifyLocalDataCleared();
            if (scenario === 'deleted') notifyLocalSourceDeleted('local');
          });
          expect(firstSignal.aborted).toBe(true);
          await act(async () => holdAuthority.release());
          expect(rawHas(answerA)).toBe(false);
          if (scenario === 'deleted') {
            expect(await screen.findByText(answerB)).toBeTruthy();
            expect(read).toHaveBeenCalledTimes(2);
          } else expect(read).toHaveBeenCalledTimes(1);
        } else {
          if (scenario === 'rapid') {
            await away();
            await enter();
            await waitFor(() => expect(authority).toHaveBeenCalledTimes(3));
            await act(async () => holdAuthority.release());
            expect(rawHas(answerA)).toBe(false);
            await act(async () => holdNewest.release());
          } else await act(async () => holdAuthority.release());
          expect(await screen.findByText(answerA)).toBeTruthy();
          expect(
            screen.getByTestId('conversation-message-receipt').props
              .accessibilityLabel,
          ).toContain('읽음');
          expect(screen.getByText('Persisted opening')).toBeTruthy();
          expect(read).toHaveBeenCalledTimes(1);
          expect(firstSignal.aborted).toBe(false);
        }
      }
      expect(strict).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        firstStorage.release();
        holdAuthority.release();
        holdNewest.release();
      });
      await app?.unmount();
      if (original) Object.defineProperty(AppState, 'currentState', original);
      f.store.dispose();
      f.close();
    }
  },
  15000,
);
