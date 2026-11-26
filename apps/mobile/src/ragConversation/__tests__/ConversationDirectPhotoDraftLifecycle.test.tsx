import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';
import { conversationExecutionNative } from '../conversationExecutionNative';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import { directPhotoComposerFixture } from '../testSupport/directPhotoComposerFixture';

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));
jest.mock('../conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test.each([
  'ordinary',
  'lock',
  'late lock',
  'unknown',
  'replaced route',
  'pending send',
] as const)(
  'resumes only a settled same-owner photo after positive protection: %s',
  async mode => {
    jest.clearAllMocks();
    let owner = true;
    let releaseProtection = () => {};
    const held = new Promise<boolean>(resolve => {
      releaseProtection = () => resolve(true);
    });
    const protection = jest.fn(async () =>
      mode === 'late lock' ? held : mode === 'unknown' ? null : true,
    );
    const nativeListeners = new Set<
      (event: ConversationExecutionEvent) => void
    >();
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      protectedDataAvailable: protection,
      subscribe(listener) {
        nativeListeners.add(listener);
        return () => {
          nativeListeners.delete(listener);
        };
      },
      begin: async () => true,
      end: () => {},
      isActive: async () => true,
    });
    const f = await directPhotoComposerFixture({
      isEntryCurrent: () => owner && AppState.currentState === 'active',
      ownsDraftRoute: () => owner,
      holdGrant: mode === 'pending send',
    });
    const oldPhase = AppState.currentState;
    AppState.currentState = 'active';
    const callbacks = new Set<(phase: AppStateStatus) => void>();
    const subscribe = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        callbacks.add(listener);
        return {
          remove: () => {
            callbacks.delete(listener);
          },
        };
      });
    const phase = async (next: AppStateStatus) => {
      await act(() => {
        AppState.currentState = next;
        for (const callback of callbacks) callback(next);
      });
    };
    try {
      const view = await render(f.view);
      await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
      expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
      if (mode === 'pending send') {
        await fireEvent.press(screen.getByTestId('rag-conversation-send'));
        expect(ports.grant).toHaveBeenCalledTimes(1);
      }
      await phase('inactive');
      await phase('background');
      expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
      if (mode === 'replaced route') owner = false;
      if (mode === 'lock')
        await act(() => {
          for (const notify of nativeListeners)
            notify({ kind: 'protectedData', available: false });
        });
      await phase('active');
      if (mode === 'late lock') {
        expect(screen.queryByTestId('conversation-photo-preview')).toBeNull();
        await act(() => {
          for (const notify of nativeListeners)
            notify({ kind: 'protectedData', available: false });
          releaseProtection();
        });
      }
      if (mode === 'pending send') await act(() => f.release());
      expect(Boolean(screen.queryByTestId('conversation-photo-preview'))).toBe(
        mode === 'ordinary',
      );
      await view.unmount();
      expect(nativeListeners.size).toBe(0);
      expect(f.start).not.toHaveBeenCalled();
      expect(ports.authorization).toHaveBeenCalledTimes(
        mode === 'pending send' ? 1 : 0,
      );
    } finally {
      AppState.currentState = oldPhase;
      subscribe.mockRestore();
      f.close();
    }
  },
);
