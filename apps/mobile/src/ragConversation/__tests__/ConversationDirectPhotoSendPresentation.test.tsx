import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';
import { syntheticDirectJPEG } from '../../aiFeatures/integration/testSupport/directPhotoSendFixture';
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

const caption = 'Synthetic owned photo caption';
const input = () => screen.getByTestId('rag-conversation-input');

test.each(['caption', 'group-caption', 'resume', 'lock'] as const)(
  'keeps real owned Send and foreground paint coherent: %s',
  async scenario => {
    const phase = AppState.currentState;
    AppState.currentState = 'active';
    const motion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const listeners = new Set<(phase: AppStateStatus) => void>();
    const events = new Set<(event: ConversationExecutionEvent) => void>();
    const phaseWatch = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        listeners.add(listener);
        return {
          remove: () => {
            listeners.delete(listener);
          },
        };
      });
    const transition = (next: AppStateStatus) => {
      AppState.currentState = next;
      for (const listener of [...listeners]) listener(next);
      for (const listener of [...events])
        listener({ kind: next === 'active' ? 'foreground' : 'phase' });
    };
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () =>
        AppState.currentState === 'active' ? 'active' : 'background',
      begin: async () => true,
      isActive: async () => true,
      protectedDataAvailable: async () => true,
      end: () => {},
      subscribe(listener) {
        events.add(listener);
        return () => {
          events.delete(listener);
        };
      },
    });
    const holdGrant = scenario === 'caption' || scenario === 'group-caption';
    const f = await directPhotoComposerFixture({
      hold: true,
      holdGrant,
      withWorkspace: true,
      isEntryCurrent: () => AppState.currentState === 'active',
      ownsDraftRoute: () => true,
    });
    jest
      .mocked(ports.pick)
      .mockResolvedValue(
        scenario === 'group-caption'
          ? [syntheticDirectJPEG, '/9j/C//Z']
          : syntheticDirectJPEG,
      );
    const snapshots: string[] = [];
    const stopObserving = f.store.subscribe(() => {
      const session = f.session();
      if (session.currentDisplayMessages?.some(row => row.deliveryPending))
        snapshots.push(session.draft);
    });
    const view = await render(f.renderView());
    try {
      await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
      await fireEvent.changeText(input(), caption);
      const send = screen.getByTestId('rag-conversation-send');
      expect(send.props.onComposerPress).toEqual(expect.any(Function));
      await fireEvent(send, 'composerPress');
      if (holdGrant) {
        await waitFor(() => expect(ports.grant).toHaveBeenCalled());
        expect(f.start).not.toHaveBeenCalled();
        expect(screen.getAllByText(caption)).toHaveLength(1);
        expect(input().props.value).toBe('');
        expect(snapshots[0]).toBe('');
        await fireEvent.changeText(input(), 'Keep this new edit');
        await act(() => f.release());
        await waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
        expect(f.start.mock.calls[0]?.[2].directPhoto?.text).toBe(caption);
        expect(input().props.value).toBe('Keep this new edit');
        await act(() => f.completePhoto());
        expect(await screen.findByText('합성 이미지 설명')).toBeTruthy();
        expect(input().props.value).toBe('Keep this new edit');
        return;
      }
      await waitFor(() => expect(f.start).toHaveBeenCalledTimes(1));
      expect(
        screen.getAllByTestId('conversation-sent-photo-image'),
      ).toHaveLength(1);
      await act(() => transition('background'));
      // Model the production background layout rerender without a new session snapshot.
      await view.rerender(f.renderView());
      expect(screen.queryByTestId('conversation-sent-photo-image')).toBeNull();
      if (scenario === 'lock') {
        await act(() => {
          for (const listener of [...events])
            listener({ kind: 'protectedData', available: false });
        });
        await act(() => transition('active'));
        expect(
          screen.queryByTestId('conversation-sent-photo-image'),
        ).toBeNull();
        expect(screen.queryByText(/전송 중/u)).toBeNull();
        expect(f.cancel).toHaveBeenCalledTimes(1);
        return;
      }
      const before = f.store.getSnapshot();
      await act(() => transition('active'));
      expect(f.store.getSnapshot()).toBe(before);
      expect(
        screen.getAllByTestId('conversation-sent-photo-image'),
      ).toHaveLength(1);
      expect(screen.getAllByText(caption)).toHaveLength(1);
      expect(f.cancel).not.toHaveBeenCalled();
    } finally {
      stopObserving();
      f.release();
      await view.unmount();
      f.close();
      AppState.currentState = phase;
      phaseWatch.mockRestore();
      motion.mockRestore();
    }
  },
);
