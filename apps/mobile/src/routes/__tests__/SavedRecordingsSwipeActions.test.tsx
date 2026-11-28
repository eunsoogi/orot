import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import {
  AppState,
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
const nativeModule = NativeModules.RecordingModule;
const originalAppState = AppState.currentState;

afterEach(() => {
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
  const reveal = async () => {
    const handler = responder.mock.lastCall?.[0];
    if (!handler) throw new Error('Expected the stock row gesture responder');
    const event = {} as GestureResponderEvent;
    const swipe = {
      dx: -180,
      dy: 0,
      numberActiveTouches: 1,
    } as PanResponderGestureState;
    expect(handler.onMoveShouldSetPanResponderCapture?.(event, swipe)).toBe(
      true,
    );
    await act(() => {
      handler.onPanResponderRelease?.(event, swipe);
    });
  };
  return { isCurrent, service, alert, reveal };
}

test('reveals separate Share and Delete tiles outside the translated rounded card without invoking either', async () => {
  const share = jest.fn(async () => 'cancelled');
  NativeModules.RecordingModule = { shareRecordingAudio: share };
  const { reveal, service, alert } = await mount();
  expect(screen.queryByTestId(`recording-share-${id}`)).toBeNull();
  await reveal();
  const lane = screen.getByTestId(`recording-delete-slot-${id}`);
  const content = screen.getByTestId(`recording-row-content-${id}`);
  expect(content.parent?.parent).toBe(lane.parent?.parent);
  expect(StyleSheet.flatten(content.props.style).borderRadius).toBe(20);
  expect(StyleSheet.flatten(lane.props.style).backgroundColor).toBeUndefined();
  expect(StyleSheet.flatten(lane.parent?.props.style)).toMatchObject({
    position: 'absolute',
    width: 132,
    right: 0,
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
