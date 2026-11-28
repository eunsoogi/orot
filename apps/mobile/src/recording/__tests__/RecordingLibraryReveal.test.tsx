import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import {
  PanResponder,
  StyleSheet,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import type { RecordingLibraryService } from '../recordingLibraryService';
import { source as recorded } from '../../transcription/testSupport/transcriptEvidenceServiceFixtures';
import {
  mockNativeDeletionAlert,
  pressNativeDeletionButton,
} from '../testSupport/nativeDeletionAlert';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('left swipe leaves an open trailing slot and never asks to delete until the button is tapped', async () => {
  if (recorded.sourceKind !== 'audio_recording') throw new Error('Bad fixture');
  const source = { ...recorded, sourceKind: 'audio_recording' as const };
  const id = source.id;
  const removal = jest.fn(async () => ({ audioCleanupPending: false }));
  const service: RecordingLibraryService = {
    list: async () => [source],
    listSummaries: async () => [
      { source, durationMs: 7_000, transcriptReviewState: 'unreviewed' },
    ],
    deleteRecording: removal,
  };
  const responder = jest.spyOn(PanResponder, 'create');
  const alert = mockNativeDeletionAlert();
  try {
    await render(
      <RecordingLibraryPanel service={service} onOpenRecording={jest.fn()} />,
    );
    const row = await screen.findByTestId(`recording-library-item-${id}`);
    const content = within(row).getByTestId(`recording-row-content-${id}`);
    const details = within(content).getByTestId(`recording-details-${id}`);
    const play = within(content).getByTestId(
      `recording-playback-list-button-${id}`,
    );
    expect(play.parent).toBe(details.parent);
    expect(content.children[0]).toBe(play);
    expect(details.children.at(-1)).toBe(
      within(details).getByTestId(`recording-row-chevron-${id}`),
    );
    expect(
      within(details).getByTestId(`recording-row-date-${id}`),
    ).toBeVisible();
    expect(
      within(details).getByTestId(`recording-row-duration-${id}`),
    ).toHaveTextContent('00:07');
    const buttonId = `recording-delete-${id}`;
    expect(screen.queryByTestId(buttonId)).toBeNull();

    const handler = responder.mock.lastCall?.[0];
    if (!handler) throw new Error('Missing actual mounted row responder');
    const event = {} as GestureResponderEvent;
    const swipe = {
      dx: -67,
      dy: 1,
      numberActiveTouches: 1,
    } as PanResponderGestureState;
    expect(handler.onMoveShouldSetPanResponderCapture?.(event, swipe)).toBe(
      true,
    );
    await act(async () => {
      handler.onPanResponderGrant?.(event, swipe);
      handler.onPanResponderMove?.(event, swipe);
      handler.onPanResponderRelease?.(event, swipe);
    });
    const slot = screen.getByTestId(`recording-delete-slot-${id}`);
    expect(
      StyleSheet.flatten(slot.props.style).paddingHorizontal,
    ).toBeGreaterThan(0);
    expect(within(slot).getByTestId(buttonId)).toHaveTextContent('삭제');
    expect(alert).not.toHaveBeenCalled();
    expect(removal).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId(buttonId));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(removal).not.toHaveBeenCalled();
    await act(async () => pressNativeDeletionButton(alert, 'cancel'));
    expect(removal).not.toHaveBeenCalled();
    expect(screen.queryByTestId(buttonId)).toBeNull();

    await fireEvent(details, 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });
    expect(await screen.findByTestId(buttonId)).toBeVisible();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(removal).not.toHaveBeenCalled();
  } finally {
    responder.mockRestore();
    alert.mockRestore();
  }
});
