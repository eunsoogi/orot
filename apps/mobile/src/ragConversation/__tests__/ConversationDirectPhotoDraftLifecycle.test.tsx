import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import { AppRetainedConversationTab } from '../../routes/AppRetainedConversationTab';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
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
  'tab round trip',
  'retained records tab',
  'changed session',
  'lock off tab',
  'remove off tab',
  'reset off tab',
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
      const controller = createNavigationController<AppNavigationRoute>('root');
      const tab = (activeTab: 'conversation' | 'records') => (
        <AppRetainedConversationTab
          actions={{
            route: controller.getSnapshot().currentRoute,
            onBack: async () => false,
            onHome: async () => false,
            push: () => null,
            replace: () => null,
            registerLeaveState: () => () => {},
          }}
          activeTab={activeTab}
          renderConversation={f.renderView}
        >
          <Text>기록 탭</Text>
        </AppRetainedConversationTab>
      );
      const view = await render(
        mode === 'retained records tab' ? tab('conversation') : f.view,
      );
      await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
      const image = screen.getByTestId('conversation-photo-preview').props
        .source;
      if (mode === 'pending send') {
        await fireEvent.press(screen.getByTestId('rag-conversation-send'));
        expect(ports.grant).toHaveBeenCalledTimes(1);
      }
      const preview = () => screen.queryByTestId('conversation-photo-preview');
      if (mode === 'retained records tab') {
        owner = false;
        await view.rerender(tab('records'));
        expect(screen.getByText('기록 탭')).toBeTruthy();
        expect(preview()).toBeNull();
        owner = true;
        await view.rerender(tab('conversation'));
        expect(preview()?.props.source).toEqual(image);
      } else if (mode === 'changed session') {
        const original = f.session().id;
        await act(() => {
          f.store.create();
          f.store.select(original);
        });
        expect(preview()).toBeNull();
      } else if (mode.endsWith('off tab') || mode === 'tab round trip') {
        owner = false;
        await view.rerender(<></>);
        expect(preview()).toBeNull();
        if (mode === 'lock off tab')
          await act(() => {
            for (const notify of nativeListeners)
              notify({ kind: 'protectedData', available: false });
          });
        if (mode === 'remove off tab')
          await act(async () => {
            await f.store.remove(f.session().id);
          });
        if (mode === 'reset off tab') await act(() => f.store.invalidateAll());
        owner = true;
        await view.rerender(f.view);
        if (mode === 'tab round trip') {
          expect(preview()?.props.source).toEqual(image);
          expect(ports.pick).toHaveBeenCalledTimes(1);
        } else expect(preview()).toBeNull();
      } else {
        await phase('inactive');
        if (mode === 'ordinary') expect(preview()?.props.source).toEqual(image);
        await phase('background');
        if (mode === 'ordinary') expect(preview()?.props.source).toEqual(image);
        if (mode === 'pending send') expect(preview()).toBeNull();
      }
      if (mode === 'replaced route') {
        owner = false;
        await view.rerender(f.renderView());
      }
      if (mode === 'lock')
        await act(() => {
          for (const notify of nativeListeners)
            notify({ kind: 'protectedData', available: false });
        });
      await phase('active');
      if (mode === 'late lock') {
        expect(preview()?.props.source).toEqual(image);
        await fireEvent.press(screen.getByTestId('rag-conversation-send'));
        expect(ports.authorization).not.toHaveBeenCalled();
        await act(() => {
          for (const notify of nativeListeners)
            notify({ kind: 'protectedData', available: false });
          releaseProtection();
          for (const notify of nativeListeners)
            notify({ kind: 'protectedData', available: true });
        });
      }
      if (mode === 'pending send') await act(() => f.release());
      expect(Boolean(screen.queryByTestId('conversation-photo-preview'))).toBe(
        mode === 'ordinary' ||
          mode === 'tab round trip' ||
          mode === 'retained records tab',
      );
      await view.unmount();
      expect(nativeListeners.size).toBe(1);
      expect(f.start).not.toHaveBeenCalled();
      expect(ports.authorization).toHaveBeenCalledTimes(
        mode === 'pending send' ? 1 : 0,
      );
    } finally {
      AppState.currentState = oldPhase;
      subscribe.mockRestore();
      f.close();
      expect(nativeListeners.size).toBe(0);
    }
  },
);
