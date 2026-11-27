import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState, AccessibilityInfo } from 'react-native';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';
import { conversationExecutionNative } from '../conversationExecutionNative';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import { directPhotoComposerFixture } from '../testSupport/directPhotoComposerFixture';
import { syntheticDirectJPEG } from '../../aiFeatures/integration/testSupport/directPhotoSendFixture';

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
  'return',
  'background-complete',
  'expiry',
  'lock',
  'denied',
  'single-denied',
  'user-stop',
  'owner-reset',
  'grant-replaced',
  'owner-dispose',
  'terminal-unproved',
  'closed-before-native',
] as const)(
  'accepted direct group follows one actual short lease through tab and phase: %s',
  async mode => {
    const initialPhase = AppState.currentState;
    const motion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    AppState.currentState = 'active';
    const subscribers = new Set<(e: ConversationExecutionEvent) => void>();
    const begin = jest.fn(
      async () => mode !== 'denied' && mode !== 'single-denied',
    );
    const end = jest.fn();
    const work = jest.fn();
    let protectedNow: boolean | null = true;
    let holdFinalProtection = false;
    let protectionWasHeld = false;
    let releaseProtection = () => {};
    const heldProtection = new Promise<boolean>(resolve => {
      releaseProtection = () => resolve(true);
    });
    const emit = (event: ConversationExecutionEvent) => {
      for (const listener of subscribers) listener(event);
    };
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () =>
        AppState.currentState === 'active' ? 'active' : 'background',
      protectedDataAvailable: async () => {
        if (holdFinalProtection) {
          holdFinalProtection = false;
          protectionWasHeld = true;
          return heldProtection;
        }
        return protectedNow;
      },
      subscribe(listener) {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
      begin,
      end,
      work,
      isActive: async () => {
        if (mode === 'closed-before-native') holdFinalProtection = true;
        return mode !== 'denied';
      },
    });
    const f = await directPhotoComposerFixture({ hold: true });
    jest
      .mocked(ports.pick)
      .mockResolvedValue(
        mode === 'single-denied'
          ? syntheticDirectJPEG
          : [syntheticDirectJPEG, '/9j/C//Z'],
      );
    const view = await render(f.view);
    let next: Awaited<ReturnType<typeof render>> | undefined;
    try {
      await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        'Owned caption',
      );
      await fireEvent.press(screen.getByTestId('rag-conversation-send'));
      if (mode === 'closed-before-native') {
        await waitFor(() => expect(protectionWasHeld).toBe(true));
        // A late positive probe cannot start a new native send after scene unmount.
        await view.unmount();
        await act(() => releaseProtection());
        expect(f.start).not.toHaveBeenCalled();
        expect(end).toHaveBeenCalledTimes(1);
        next = await render(f.renderView());
        expect(screen.queryByText(/전송 중/u)).toBeNull();
        expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
          'Owned caption',
        );
        return;
      }
      await waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
      expect(begin).toHaveBeenCalledTimes(1);
      expect(work).not.toHaveBeenCalled();
      expect(screen.getAllByText(/전송 중/u)).toHaveLength(1);
      expect(
        screen.getAllByTestId('conversation-sent-photo-image'),
      ).toHaveLength(mode === 'single-denied' ? 1 : 2);
      await view.unmount();
      await act(() => {
        AppState.currentState = 'background';
        emit({ kind: 'phase' });
      });
      if (mode === 'denied' || mode === 'single-denied') {
        expect(f.cancel).toHaveBeenCalledWith(f.requestId());
      } else {
        expect(f.cancel).not.toHaveBeenCalled();
      }
      if (mode === 'expiry') {
        const id = (begin.mock.calls as unknown as [string][])[0]![0];
        await act(() => emit({ kind: 'expired', requestId: id }));
      }
      if (mode === 'lock') {
        protectedNow = false;
        await act(() => emit({ kind: 'protectedData', available: false }));
      }
      if (mode === 'owner-dispose') {
        await act(() => f.store.dispose());
        await waitFor(() =>
          expect(f.cancel).toHaveBeenCalledWith(f.requestId()),
        );
        expect(end).toHaveBeenCalledTimes(1);
        return;
      }
      if (mode === 'owner-reset') await act(() => f.store.invalidateAll());
      if (mode === 'grant-replaced') await act(() => f.retire());
      if (mode === 'terminal-unproved') {
        protectedNow = null;
        await act(() => f.completePhoto());
      }
      if (mode === 'background-complete') await act(() => f.completePhoto());
      await act(() => {
        AppState.currentState = 'active';
        emit({ kind: 'foreground' });
      });
      next = await render(f.view);
      if (mode === 'background-complete') {
        expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
        expect(screen.queryByText(/전송 중/u)).toBeNull();
        expect(f.cancel).not.toHaveBeenCalled();
      } else if (mode === 'user-stop') {
        expect(screen.getAllByText(/전송 중/u)).toHaveLength(1);
        await fireEvent.changeText(
          screen.getByTestId('rag-conversation-input'),
          'New independent draft',
        );
        await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
        await waitFor(() =>
          expect(f.cancel).toHaveBeenCalledWith(f.requestId()),
        );
        expect(screen.queryByText(/전송 중/u)).toBeNull();
        expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
          'New independent draft',
        );
        await act(() => f.completePhoto());
        expect(screen.queryByText('합성 이미지 설명')).toBeNull();
      } else if (mode === 'return') {
        expect(screen.getAllByText(/전송 중/u)).toHaveLength(1);
        expect(
          screen.getAllByTestId('conversation-sent-photo-image'),
        ).toHaveLength(2);
        await act(() => f.completePhoto());
        expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
        expect(f.cancel).not.toHaveBeenCalled();
      } else {
        expect(screen.queryByText(/전송 중/u)).toBeNull();
        expect(
          screen.queryByTestId('conversation-sent-photo-image'),
        ).toBeNull();
        if (mode !== 'terminal-unproved')
          expect(f.cancel).toHaveBeenCalledWith(f.requestId());
        expect(screen.queryByText('합성 이미지 설명')).toBeNull();
        expect(Boolean(screen.queryByText('사진 전송이 중단됐어요.'))).toBe(
          mode === 'expiry' || mode === 'single-denied',
        );
      }
      expect(f.start).toHaveBeenCalledTimes(1);
      expect(f.ordinary).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledTimes(
        mode === 'denied' || mode === 'single-denied' ? 0 : 1,
      );
    } finally {
      await next?.unmount();
      f.close();
      AppState.currentState = initialPhase;
      motion.mockRestore();
    }
  },
);
