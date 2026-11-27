import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
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
  'completed in background',
  'remounted pending',
  'switcher while mounted',
  'denied lease',
  'locked',
  'expired',
  'grant absent',
  'protection unknown',
  'scene leaves during final probe',
] as const)(
  'the exact authorized single-photo send has one independent owner: %s',
  async mode => {
    jest.clearAllMocks();
    const phase = AppState.currentState;
    AppState.currentState = 'active';
    const reduceMotion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const phaseListeners = new Set<(phase: AppStateStatus) => void>();
    const watchPhase = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        phaseListeners.add(listener);
        return {
          remove: () => {
            phaseListeners.delete(listener);
          },
        };
      });
    const subscribers = new Set<(event: ConversationExecutionEvent) => void>();
    const begin = jest.fn(async (_id: string) => mode !== 'denied lease');
    const end = jest.fn();
    const work = jest.fn();
    let held = false;
    let started = false;
    let releaseProbe = () => {};
    const finalProbe = new Promise<boolean>(resolve => {
      releaseProbe = () => resolve(true);
    });
    const announce = (event: ConversationExecutionEvent) => {
      for (const listener of [...subscribers]) listener(event);
    };
    const updatePhase = (next: AppStateStatus) => {
      AppState.currentState = next;
      for (const listener of [...phaseListeners]) listener(next);
      announce({ kind: next === 'active' ? 'foreground' : 'phase' });
    };
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () =>
        AppState.currentState === 'active' ? 'active' : 'background',
      async protectedDataAvailable() {
        if (started && mode === 'scene leaves during final probe' && !held) {
          held = true;
          return finalProbe;
        }
        return mode === 'protection unknown' ? null : true;
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
      async isActive() {
        started = true;
        return mode !== 'denied lease';
      },
    });
    const fixture = await directPhotoComposerFixture({
      granted: mode !== 'grant absent',
      hold: true,
      isEntryCurrent: () => AppState.currentState === 'active',
      ownsDraftRoute: () => true,
    });
    let view = await render(fixture.renderView());
    try {
      await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        'Single original caption',
      );
      await fireEvent.press(screen.getByTestId('rag-conversation-send'));
      expect(ports.grant).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        1,
      );
      if (mode === 'scene leaves during final probe') {
        await waitFor(() => expect(held).toBe(true));
        await view.unmount();
        await act(() => releaseProbe());
        view = await render(fixture.renderView());
        expect(end).toHaveBeenCalledTimes(1);
      }
      if (
        mode === 'grant absent' ||
        mode === 'protection unknown' ||
        mode === 'scene leaves during final probe'
      ) {
        expect(fixture.start).not.toHaveBeenCalled();
        expect(screen.queryByText(/전송 중/u)).toBeNull();
        expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
          'Single original caption',
        );
        if (mode !== 'scene leaves during final probe')
          expect(begin).not.toHaveBeenCalled();
        return;
      }

      await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1));
      expect(fixture.start.mock.calls[0]?.[2].directPhoto).toEqual({
        text: 'Single original caption',
        jpegBase64: syntheticDirectJPEG,
      });
      expect(screen.getAllByText(/전송 중/u)).toHaveLength(1);
      if (mode !== 'switcher while mounted') await view.unmount();
      else await act(() => updatePhase('inactive'));
      await act(() => updatePhase('background'));
      if (mode === 'switcher while mounted') {
        expect(screen.getAllByText(/전송 중/u)).toHaveLength(1);
        expect(fixture.cancel).not.toHaveBeenCalled();
      }
      if (mode === 'locked')
        await act(() => announce({ kind: 'protectedData', available: false }));
      if (mode === 'expired')
        await act(() =>
          announce({ kind: 'expired', requestId: begin.mock.calls[0]![0] }),
        );
      if (mode === 'completed in background')
        await act(() => fixture.completePhoto());
      await act(() => updatePhase('active'));
      if (mode !== 'switcher while mounted')
        view = await render(fixture.renderView());
      if (mode === 'remounted pending' || mode === 'switcher while mounted') {
        expect(screen.getAllByText(/전송 중/u)).toHaveLength(1);
        expect(
          screen.getAllByTestId('conversation-sent-photo-image'),
        ).toHaveLength(1);
        expect(fixture.cancel).not.toHaveBeenCalled();
        await act(() => fixture.completePhoto());
      }
      if (
        mode === 'completed in background' ||
        mode === 'remounted pending' ||
        mode === 'switcher while mounted'
      ) {
        expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
        expect(fixture.cancel).not.toHaveBeenCalled();
      } else {
        expect(fixture.cancel).toHaveBeenCalledWith('image-request');
        expect(
          screen.queryByTestId('conversation-sent-photo-image'),
        ).toBeNull();
        expect(Boolean(screen.queryByText('사진 전송이 중단됐어요.'))).toBe(
          mode === 'expired' || mode === 'denied lease',
        );
        await act(() => fixture.completePhoto());
        expect(screen.queryByText('합성 이미지 설명')).toBeNull();
      }
      expect(screen.queryByText(/전송 중/u)).toBeNull();
      expect(fixture.start).toHaveBeenCalledTimes(1);
      expect(begin).toHaveBeenCalledTimes(1);
      expect(fixture.ordinary).not.toHaveBeenCalled();
      expect(work).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledTimes(mode === 'denied lease' ? 0 : 1);
    } finally {
      await view.unmount();
      fixture.close();
      AppState.currentState = phase;
      watchPhase.mockRestore();
      reduceMotion.mockRestore();
    }
  },
);
