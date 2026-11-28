import { createManualHistoryRepository } from '@orot/storage';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState, PanResponder, Share } from 'react-native';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { SqlCipherRagEmbeddingStorage } from '../../storage/ragEmbeddingStorage';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';
import { unifySavedMemories } from '../unifiedSavedMemories';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../ragConversation/conversationExecutionNative');
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));
jest.mock('../../storage/ragEmbeddingStorage', () => ({
  SqlCipherRagEmbeddingStorage: {
    forCallerTransaction: jest
      .fn()
      .mockResolvedValue({ deleteEvidence: jest.fn() }),
  },
}));

test.each([
  'share',
  'cancel',
  'delete',
  'superseded',
  'locked-share',
  'locked-delete',
] as const)(
  'saved Memory row only acts after selecting its revealed icon: %s',
  async action => {
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    const f = await healthContextFixture();
    const pan = jest.spyOn(PanResponder, 'create');
    jest.clearAllMocks();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const share = jest.spyOn(Share, 'share').mockResolvedValue({
      action: Share.dismissedAction,
      activityType: undefined,
    });
    const listeners = new Set<
      Parameters<
        NonNullable<ReturnType<typeof conversationExecutionNative>>['subscribe']
      >[0]
    >();
    jest.mocked(conversationExecutionNative).mockReturnValue({
      currentPhase: () => 'active',
      bridgeAvailable: true,
      end() {},
      begin: async () => false,
      isActive: async () => false,
      protectedDataAvailable: async () => true,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    });
    try {
      const repository = createManualHistoryRepository(f.database);
      jest
        .mocked(openLocalStorage)
        .mockResolvedValue({ manualHistory: repository } as Awaited<
          ReturnType<typeof openLocalStorage>
        >);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
      const original = await repository.create({
        kind: 'note',
        title: 'Synthetic memory',
        details: 'An exact synthetic note.\nSecond line.',
        effectiveDate: { status: 'unknown' },
      });
      let release: (() => void) | undefined;
      let held = false;
      const load = async () => {
        if (held)
          await new Promise<void>(resolve => {
            release = resolve;
          });
        return unifySavedMemories([], await repository.list());
      };
      const route = { isCurrent: () => true, subscribe: () => () => {} };
      await render(<SavedMemoryBrowser load={load} ownership={route} />);
      const id = 'manual-history:' + original.id;
      await screen.findByTestId('saved-memory-entry-' + id);
      expect(screen.getByTestId('saved-memory-swipe-' + id)).toBeVisible();
      const shareID = 'saved-memory-share-' + id;
      const deleteID = 'saved-memory-delete-' + id;
      const responder = pan.mock.calls.at(-1)![0];
      const event = {} as Parameters<
        NonNullable<typeof responder.onPanResponderRelease>
      >[0];
      const gesture = { dx: -92, dy: 1, numberActiveTouches: 1 } as Parameters<
        NonNullable<typeof responder.onPanResponderRelease>
      >[1];
      expect(screen.queryByTestId(shareID)).toBeNull();
      await act(() => responder.onPanResponderMove?.(event, gesture));
      expect(screen.queryByTestId(shareID)).toBeNull();
      await act(() => responder.onPanResponderRelease?.(event, gesture));
      expect(await screen.findByTestId(shareID)).toBeEnabled();
      expect(await screen.findByTestId(deleteID)).toBeEnabled();
      expect(share).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
      expect(await repository.list()).toEqual([original]);
      expect(screen.queryByText('공유')).toBeNull();

      if (action === 'share' || action === 'locked-share') {
        held = action === 'locked-share';
        await fireEvent.press(screen.getByTestId(shareID));
        if (held) {
          await waitFor(() => expect(release).toBeDefined());
          await act(() => {
            listeners.forEach(listener =>
              listener({ kind: 'protectedData', available: false }),
            );
            release?.();
          });
          expect(share).not.toHaveBeenCalled();
        } else {
          await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
          expect(share).toHaveBeenCalledWith({ message: original.details });
        }
        expect(await repository.list()).toEqual([original]);
        return;
      }

      await fireEvent.press(screen.getByTestId(deleteID));
      expect(await repository.list()).toEqual([original]);
      const buttons = alert.mock.calls.at(-1)?.[2];
      if (action === 'cancel') {
        await act(() =>
          buttons?.find(button => button.style === 'cancel')?.onPress?.(),
        );
        expect(await repository.list()).toEqual([original]);
        return;
      }
      if (action === 'locked-delete') {
        await act(() => {
          listeners.forEach(listener =>
            listener({ kind: 'protectedData', available: false }),
          );
        });
        await act(async () => {
          await buttons
            ?.find(button => button.style === 'destructive')
            ?.onPress?.();
        });
        expect(await repository.list()).toEqual([original]);
        expect(
          SqlCipherRagEmbeddingStorage.forCallerTransaction,
        ).not.toHaveBeenCalled();
        return;
      }
      const corrected =
        action === 'superseded'
          ? await repository.correct(original.id, {
              kind: 'note',
              title: 'Synthetic correction',
              details: 'Replacement must survive a stale action.',
              effectiveDate: { status: 'unknown' },
            })
          : undefined;
      const confirm = buttons?.find(
        button => button.style === 'destructive',
      )?.onPress;
      await act(async () => {
        const first = confirm?.();
        confirm?.();
        await first;
      });
      expect(await repository.list()).toEqual(corrected ? [corrected] : []);
      if (corrected) {
        expect(screen.getByRole('alert')).toBeVisible();
        expect(
          SqlCipherRagEmbeddingStorage.forCallerTransaction,
        ).not.toHaveBeenCalled();
      } else {
        expect(screen.queryByTestId('saved-memory-entry-' + id)).toBeNull();
        expect(
          SqlCipherRagEmbeddingStorage.forCallerTransaction,
        ).toHaveBeenCalledTimes(1);
      }
    } finally {
      AppState.currentState = previous;
      jest.restoreAllMocks();
      jest.clearAllMocks();
      f.close();
    }
  },
);
