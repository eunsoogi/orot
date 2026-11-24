import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { RecentMediaRow } from '../../routes/recentSourceReader';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import type { ConversationSender } from '../conversationSessionTypes';
import type { ConversationSessions } from '../conversationSessions';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { useConversationRecordingAttachment } from '../useConversationRecordingAttachment';

const mockRead = jest.fn<Promise<readonly RecentMediaRow[]>, []>();
const mockProtected = jest.fn<Promise<boolean>, []>();
const mockRootListeners = new Set<(visible: boolean) => void>();
const mockSubscribe = (listener: (visible: boolean) => void) => {
  mockRootListeners.add(listener);
  return () => {
    mockRootListeners.delete(listener);
  };
};
jest.mock('../../routes/recentSourceReader', () => ({
  loadRecentSourceMaterial: (...args: []) => mockRead(...args),
}));
jest.mock('../conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: mockProtected,
    subscribe: () => () => {},
  }),
}));
jest.mock('../ConversationSessionsContext', () => ({
  useRootConversationVisibilitySubscription: () => mockSubscribe,
}));
jest.mock('../useConversationEntryIntent', () => ({
  conversationEntryForSession: () => undefined,
}));
jest.mock('../entryIntentSender', () => ({
  entryIntentSender: (_store: unknown, _id: number, send: unknown) => send,
}));
function fixture() {
  const selected: RecentMediaRow = {
    kind: 'audio_recording',
    id: 'selected',
    key: 'selected',
    title: 'Synthetic recording',
    createdAt: '2026-02-01T00:00:00.000Z',
  };
  const shared = new Set<() => void>();
  const snapshot = {
    activeId: 1,
    sessions: [{ id: 1, draft: 'What was said?', busy: false }],
  };
  const send = jest.fn<Promise<unknown>, [number, ConversationSender]>();
  send.mockImplementation(async (_id, sender) =>
    sender('What was said?', [], new AbortController().signal),
  );
  const store = {
    continuous: false,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      shared.add(listener);
      return () => {
        shared.delete(listener);
      };
    },
    photoDrafts: {
      get: () => ({ status: 'empty' }),
      subscribe: () => () => {},
    },
    send,
  } as unknown as ConversationSessions;
  return { store, selected, send };
}
const oldState = AppState.currentState;
beforeEach(() => {
  AppState.currentState = 'active';
  mockRead.mockReset();
  mockProtected.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  AppState.currentState = oldState;
});
const onSend = () =>
  jest
    .fn<
      ReturnType<ConversationScreenProps['onSend']>,
      Parameters<ConversationScreenProps['onSend']>
    >()
    .mockResolvedValue({ status: 'no_evidence' });

test('one explicit selected audio ID is bound only to the admitted send', async () => {
  const { store, selected } = fixture();
  mockRead.mockResolvedValue([
    selected,
    { ...selected, id: 'photo', key: 'photo', kind: 'medical_document' },
  ]);
  const { result } = await renderHook(() =>
    useConversationRecordingAttachment({
      store,
      id: 1,
      modelRevision: 4,
      ordinary: true,
      routeKey: 'root',
    }),
  );
  expect(mockRead).not.toHaveBeenCalled();
  const provider = onSend();
  expect(result.current.dispatch(provider)).toBe(false);
  await act(async () => {
    result.current.openPicker();
  });
  expect(result.current.page.rows).toEqual([selected]);
  await act(async () => {
    await result.current.pick(selected);
  });
  expect(result.current.selected).toBe(selected);
  let release!: () => void;
  provider.mockImplementation(
    async (_question, _history, _signal, observer) => {
      expect(observer?.selectedRecordingTranscript?.isCurrent()).toBe(true);
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return { status: 'no_evidence' };
    },
  );
  await act(async () => {
    expect(result.current.dispatch(provider)).toBe(true);
    expect(result.current.dispatch(provider)).toBe(true);
  });
  expect(result.current.selected).toBeNull();
  const scope = provider.mock.calls[0]![3]?.selectedRecordingTranscript;
  expect(provider).toHaveBeenCalledTimes(1);
  expect(Object.keys(scope!)).toEqual(['sourceId', 'signal', 'isCurrent']);
  expect(scope?.sourceId).toBe('selected');
  expect(scope?.isCurrent()).toBe(true);
  await act(async () => release());
  expect(scope?.isCurrent()).toBe(false);
  expect(result.current.dispatch(provider)).toBe(false);
});

test('root away and back in one batch invalidates a held list response', async () => {
  const { store, selected } = fixture();
  let release!: () => void;
  mockRead.mockImplementation(
    () =>
      new Promise(done => {
        release = () => done([selected]);
      }),
  );
  const { result } = await renderHook(() =>
    useConversationRecordingAttachment({
      store,
      id: 1,
      modelRevision: 4,
      ordinary: true,
      routeKey: 'root',
    }),
  );
  await act(async () => {
    result.current.openPicker();
  });
  expect(result.current.page.loading).toBe(true);
  await act(async () => {
    mockRootListeners.forEach(listener => {
      listener(false);
      listener(true);
    });
    release();
  });
  expect(result.current.open).toBe(false);
  expect(result.current.page.rows).toEqual([]);
});

test('deleting the selected source revokes a started observer, while unrelated deletion does not', async () => {
  const { store, selected } = fixture();
  mockRead.mockResolvedValue([selected]);
  const { result } = await renderHook(() =>
    useConversationRecordingAttachment({
      store,
      id: 1,
      modelRevision: 4,
      ordinary: true,
      routeKey: 'root',
    }),
  );
  await act(async () => {
    result.current.openPicker();
  });
  await act(async () => {
    await result.current.pick(selected);
  });
  const provider = onSend();
  let release!: () => void;
  provider.mockImplementation(
    () =>
      new Promise(resolve => {
        release = () => resolve({ status: 'no_evidence' });
      }),
  );
  await act(async () => {
    result.current.dispatch(provider);
  });
  const sent = provider.mock.calls[0]![3]?.selectedRecordingTranscript;
  await act(async () => notifyLocalSourceDeleted('local', new Set(['decoy'])));
  expect([sent?.isCurrent(), sent?.signal.aborted]).toEqual([true, false]);
  await act(async () =>
    notifyLocalSourceDeleted('local', new Set([selected.key])),
  );
  expect([sent?.isCurrent(), sent?.signal.aborted]).toEqual([false, true]);
  await act(async () => release());
});

test('positive protection is required again before forwarding, and a new model cannot inherit the draft', async () => {
  const { store, selected } = fixture();
  mockRead.mockResolvedValue([selected]);
  const view = await renderHook(
    ({ modelRevision }: { modelRevision: number }) =>
      useConversationRecordingAttachment({
        store,
        id: 1,
        ordinary: true,
        modelRevision,
        routeKey: 'root',
      }),
    { initialProps: { modelRevision: 4 } },
  );
  await act(async () => {
    view.result.current.openPicker();
  });
  await act(async () => {
    await view.result.current.pick(selected);
  });
  const provider = onSend();
  mockProtected.mockResolvedValueOnce(false);
  await act(async () => {
    view.result.current.dispatch(provider);
  });
  expect(provider).not.toHaveBeenCalled();
  expect(view.result.current.selected).toBeNull();
  await act(async () => {
    view.result.current.openPicker();
  });
  await act(async () => {
    await view.result.current.pick(selected);
  });
  expect(view.result.current.selected?.key).toBe(selected.key);
  await view.rerender({ modelRevision: 5 });
  expect(view.result.current.selected).toBeNull();
  expect(view.result.current.dispatch(provider)).toBe(false);
});
