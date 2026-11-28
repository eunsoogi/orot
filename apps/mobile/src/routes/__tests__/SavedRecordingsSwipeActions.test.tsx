import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import {
  AppState,
  I18nManager,
  NativeModules,
  PanResponder,
  StyleSheet,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { appColors } from '../../layout/appColors';
import type { NavigationRouteActions } from '../../navigation/navigationRouteContracts';
import { RecordingSelectionProvider } from '../../recording/RecordingSelectionContext';
import {
  mockNativeDeletionAlert,
  pressNativeDeletionButton,
} from '../../recording/testSupport/nativeDeletionAlert';
import { SavedRecordingsRoute } from '../SavedRecordingsRoute';
import type { AppNavigationRoute } from '../appNavigationRoute';
import {
  createLibraryService,
  source,
} from '../testSupport/savedRecordingsRouteAdaptiveTestSupport';

jest.mock('../../recording/useAutomaticRecordingTranscription', () => ({
  useAutomaticRecordingTranscription: () => ({
    cancel: jest.fn(),
    state: null,
  }),
}));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

const id = source.id;
const clipId = `recording-library-item-${id}-action-clip`;
const nativeModule = NativeModules.RecordingModule;
const originalAppState = AppState.currentState;

beforeEach(() => jest.useFakeTimers());

afterEach(() => {
  jest.useRealTimers();
  NativeModules.RecordingModule = nativeModule;
  AppState.currentState = originalAppState;
  jest.restoreAllMocks();
});

async function mount() {
  AppState.currentState = 'active';
  const listener = jest.fn(() => jest.fn());
  const isCurrent = jest.fn(() => true);
  const actions: NavigationRouteActions<AppNavigationRoute> = {
    route: { key: 'saved-test-route', name: 'saved-recordings' },
    ownership: { isCurrent, subscribe: listener },
    onBack: jest.fn(async () => true),
    onHome: jest.fn(async () => true),
    push: jest.fn(() => null),
    replace: jest.fn(() => null),
    registerLeaveState: jest.fn(() => jest.fn()),
  };
  const service = createLibraryService();
  const responder = jest.spyOn(PanResponder, 'create');
  const alert = mockNativeDeletionAlert();
  await render(
    <RecordingSelectionProvider>
      <SavedRecordingsRoute actions={actions} libraryService={service} />
    </RecordingSelectionProvider>,
  );
  await screen.findByTestId(`recording-library-item-${id}`);
  const beginDrag = async (dx: number, dy = 0) => {
    const handler = responder.mock.lastCall?.[0];
    if (!handler) throw new Error('Expected the stock row gesture responder');
    const event = {} as GestureResponderEvent;
    const swipe = {
      dx,
      dy,
      numberActiveTouches: 1,
    } as PanResponderGestureState;
    const claimed = handler.onMoveShouldSetPanResponderCapture?.(event, swipe);
    if (claimed) {
      await act(() => {
        handler.onPanResponderGrant?.(event, swipe);
        handler.onPanResponderMove?.(event, swipe);
      });
    }
    return {
      claimed,
      release: () =>
        act(() => {
          handler.onPanResponderRelease?.(event, swipe);
        }),
      cancel: () =>
        act(() => {
          handler.onPanResponderTerminate?.(event, swipe);
        }),
    };
  };
  const reveal = async () => {
    const drag = await beginDrag(-180);
    expect(drag.claimed).toBe(true);
    await drag.release();
  };
  return { isCurrent, service, alert, reveal, beginDrag };
}

test('reveals separate Share and Delete tiles outside the translated rounded card without invoking either', async () => {
  const share = jest.fn(async () => 'cancelled');
  NativeModules.RecordingModule = { shareRecordingAudio: share };
  const { reveal, service, alert } = await mount();
  expect(screen.queryByTestId(`recording-share-${id}`)).toBeNull();
  await reveal();
  const lane = screen.getByTestId(`recording-delete-slot-${id}`);
  const content = screen.getByTestId(`recording-row-content-${id}`);
  const clip = screen.getByTestId(clipId);
  expect(content.parent?.parent).toBe(clip.parent);
  expect(lane.parent?.parent).toBe(clip);
  expect(StyleSheet.flatten(content.props.style).borderRadius).toBe(20);
  expect(StyleSheet.flatten(lane.props.style).backgroundColor).toBeUndefined();
  expect(StyleSheet.flatten(lane.parent?.props.style)).toMatchObject({
    position: 'absolute',
    width: 132,
    end: 0,
  });
  const first = within(lane).getByTestId(`recording-share-${id}`);
  const last = within(lane).getByTestId(`recording-delete-${id}`);
  expect(lane.children).toEqual([first, last]);
  for (const [action, color, symbol, accessibilityLabel] of [
    [first, appColors.primaryAction, 'square.and.arrow.up', '공유'],
    [last, appColors.dangerAction, 'trash', '녹음 삭제'],
  ] as const) {
    const tile = action.children[0];
    if (typeof tile === 'string' || !tile)
      throw new Error('Expected icon tile');
    expect(StyleSheet.flatten(tile.props.style)).toMatchObject({
      backgroundColor: color,
      width: 48,
      height: 48,
      borderRadius: 13,
    });
    expect(tile.children[0]).toHaveProp('symbolName', symbol);
    expect(tile.children[0]).toHaveProp('tintColor', '#ffffff');
    expect(action).toHaveProp('accessibilityLabel', accessibilityLabel);
    expect(action.children).toHaveLength(1);
  }
  expect(share).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  await fireEvent.press(last);
  expect(alert).toHaveBeenCalledTimes(1);
  expect(service.deleteRecording).not.toHaveBeenCalled();
  await act(() => pressNativeDeletionButton(alert, 'cancel'));
  expect(service.deleteRecording).not.toHaveBeenCalled();
});

test('exports only the explicitly tapped saved audio, never a duplicate or stale route action', async () => {
  let cancel!: (status: 'cancelled') => void;
  const share = jest.fn(
    () =>
      new Promise(resolve => {
        cancel = resolve;
      }),
  );
  const transcript = jest.fn();
  NativeModules.RecordingModule = {
    shareRecordingAudio: share,
    shareRecordingTranscript: transcript,
  };
  const { isCurrent, service, alert, reveal } = await mount();
  await reveal();
  isCurrent.mockReturnValue(false);
  await fireEvent.press(screen.getByTestId(`recording-share-${id}`));
  expect(share).not.toHaveBeenCalled();
  isCurrent.mockReturnValue(true);
  await reveal();
  AppState.currentState = 'background';
  await fireEvent.press(screen.getByTestId(`recording-share-${id}`));
  expect(share).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  await reveal();
  const button = screen.getByTestId(`recording-share-${id}`);
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(share).toHaveBeenCalledTimes(1);
  expect(share).toHaveBeenCalledWith(id);
  expect(screen.queryByTestId(`recording-share-${id}`)).toBeNull();
  expect(transcript).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(service.deleteRecording).not.toHaveBeenCalled();
  await act(() => {
    cancel('cancelled');
  });
  expect(screen.getByTestId(`recording-library-item-${id}`)).toBeVisible();
});

test('paints tiles progressively in a physical left drag without exposing actions before settlement', async () => {
  jest.replaceProperty(I18nManager, 'isRTL', true);
  const share = jest.fn(async () => 'cancelled');
  NativeModules.RecordingModule = { shareRecordingAudio: share };
  const { beginDrag, alert, service } = await mount();
  const hidden = { includeHiddenElements: true };
  const lane = () => screen.getByTestId(`recording-delete-slot-${id}`, hidden);
  const clip = () => screen.getByTestId(clipId, hidden);
  const card = () => screen.getByTestId(`recording-row-content-${id}`);
  const shareId = `recording-share-${id}`;
  expect(card().parent).toHaveStyle({ transform: [{ translateX: 0 }] });
  expect(clip()).toHaveStyle({ start: 0, width: 0, overflow: 'hidden' });
  expect(lane().parent).toHaveStyle({ start: 0, width: 132 });
  expect(lane()).toHaveStyle({ direction: 'ltr' });
  expect(screen.queryByTestId(shareId)).toBeNull();
  expect((await beginDrag(-26, 85)).claimed).toBe(false);

  const short = await beginDrag(-28);
  expect(short.claimed).toBe(true);
  expect(card().parent).toHaveStyle({ transform: [{ translateX: -28 }] });
  expect(clip()).toHaveStyle({ width: 28 });
  expect(clip()).toHaveProp('pointerEvents', 'none');
  expect(clip()).toHaveProp('accessibilityElementsHidden', true);
  expect(clip()).toHaveProp('importantForAccessibility', 'no-hide-descendants');
  await fireEvent.press(screen.getByTestId(shareId, hidden));
  await short.release();
  await act(() => jest.advanceTimersByTime(1_000));
  expect(card().parent).toHaveStyle({ transform: [{ translateX: 0 }] });
  expect(share).not.toHaveBeenCalled();

  const open = await beginDrag(-64);
  expect(card().parent).toHaveStyle({ transform: [{ translateX: -64 }] });
  expect(screen.queryByTestId(shareId)).toBeNull();
  await open.release();
  await act(() => jest.advanceTimersByTime(1_000));
  expect(clip()).toHaveStyle({ width: 132 });
  expect(card().parent).toHaveStyle({ transform: [{ translateX: -132 }] });
  expect(screen.getByTestId(shareId)).toBeVisible();
  const close = await beginDrag(65);
  expect(card().parent).toHaveStyle({ transform: [{ translateX: -67 }] });
  expect(screen.queryByTestId(shareId)).toBeNull();
  await fireEvent.press(screen.getByTestId(`recording-delete-${id}`, hidden));
  expect(alert).not.toHaveBeenCalled();
  await close.cancel();
  expect(screen.getByTestId(shareId)).toBeVisible();
  expect(share).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(service.deleteRecording).not.toHaveBeenCalled();
});
