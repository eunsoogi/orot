import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { t } from '../../i18n';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import type { RecordingLibraryService } from '../recordingLibraryService';
import { savedSource } from '../recordingScreenSupport';
import {
  confirmNativeDeletion,
  mockNativeDeletionAlert,
  pressNativeDeletionButton,
  requestLibraryRowDeletion,
} from '../testSupport/nativeDeletionAlert';

const first = { ...savedSource, id: 'swipe-first', title: 'First recording' };
const second = { ...savedSource, id: 'swipe-second', title: undefined };

function library() {
  let sources = [first, second];
  const service: RecordingLibraryService = {
    list: jest.fn(async () => sources),
    deleteRecording: jest.fn(async (id: string) => {
      sources = sources.filter(source => source.id !== id);
      return { audioCleanupPending: false };
    }),
  };
  return service;
}

function touch(
  previousX: number,
  x: number,
  previousY: number,
  y: number,
  time: number,
) {
  return {
    nativeEvent: { touches: [{}] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: time,
      touchBank: [
        {
          touchActive: true,
          startPageX: 150,
          startPageY: 50,
          previousPageX: previousX,
          previousPageY: previousY,
          currentPageX: x,
          currentPageY: y,
          previousTimeStamp: time - 1,
          currentTimeStamp: time,
        },
      ],
    },
  };
}

async function gesture(
  id: string,
  dx: number,
  dy = 0,
  cancelled = false,
  reverseX?: number,
) {
  const row = screen.getByTestId(`recording-library-item-${id}`);
  // Feed the mounted responders a single native-style touch history, with no mock gesture state.
  const initial = touch(150, 150, 50, 50, 1);
  const earlyDx = Math.sign(dx) * Math.min(Math.abs(dx) * 0.45, 18);
  const early = touch(150, 150 + earlyDx, 50, 50 + dy / 4, 2);
  const end = touch(150 + earlyDx, 150 + dx, 50 + dy / 4, 50 + dy, 3);
  let claimed = false;
  await act(() => {
    row.props.onStartShouldSetResponderCapture?.(initial);
    claimed = row.props.onMoveShouldSetResponderCapture?.(early) === true;
    if (!claimed) return;
    row.props.onResponderGrant(early);
    row.props.onResponderMove(end);
    if (reverseX !== undefined) {
      const reversal = touch(150 + dx, 150 + reverseX, 50 + dy, 50, 4);
      row.props.onResponderMove(reversal);
      row.props.onResponderRelease(reversal);
      return;
    }
    if (cancelled) row.props.onResponderTerminate(end);
    else row.props.onResponderRelease(end);
  });
  return claimed;
}

const deleteAction = (id: string) =>
  screen.queryByTestId(`recording-delete-${id}`);

beforeEach(() => jest.useFakeTimers());

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('only a released horizontal swipe reveals Delete; even a full swipe never requests deletion', async () => {
  const service = library();
  const alert = mockNativeDeletionAlert();
  const open = jest.fn();
  await render(
    <RecordingLibraryPanel service={service} onOpenRecording={open} />,
  );
  await screen.findByTestId(`recording-library-item-${first.id}`);
  expect(deleteAction(first.id)).toBeNull();
  expect(screen.getByText(t('recording.library.untitled'))).toBeVisible();
  expect(await gesture(first.id, -60, 140)).toBe(false);
  expect(await gesture(first.id, -36)).toBe(true);
  expect(deleteAction(first.id)).toBeNull();
  expect(await gesture(first.id, -110, 0, true)).toBe(true);
  expect(deleteAction(first.id)).toBeNull();

  expect(await gesture(first.id, -260)).toBe(true);
  expect(deleteAction(first.id)).toBeVisible();
  expect(alert).not.toHaveBeenCalled();
  expect(service.deleteRecording).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();

  expect(await gesture(second.id, -115)).toBe(true);
  expect(deleteAction(first.id)).toBeNull();
  expect(deleteAction(second.id)).toBeVisible();
  expect(await gesture(second.id, 110)).toBe(true);
  expect(deleteAction(second.id)).toBeNull();

  await gesture(first.id, -110);
  await fireEvent.press(
    screen.getByTestId(`recording-playback-list-button-${first.id}`),
  );
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ source: first }),
    true,
  );
  expect(deleteAction(first.id)).toBeNull();
  await gesture(first.id, -110);
  await fireEvent.press(screen.getByTestId(`recording-details-${second.id}`));
  expect(open).toHaveBeenLastCalledWith(
    expect.objectContaining({ source: second }),
    false,
  );
  expect(deleteAction(first.id)).toBeNull();
});

test('a rightward reversal closes a dragged recording even when its net movement is left', async () => {
  const service = library();
  const alert = mockNativeDeletionAlert();
  await render(<RecordingLibraryPanel service={service} />);
  await screen.findByTestId(`recording-library-item-${first.id}`);

  await gesture(first.id, -250);
  expect(deleteAction(first.id)).toBeVisible();
  await gesture(first.id, -235, 0, false, -165);
  expect(deleteAction(first.id)).toBeNull();
  expect(alert).not.toHaveBeenCalled();
  expect(service.deleteRecording).not.toHaveBeenCalled();
});

test('a new gesture can stop an overswipe rebound before it lands', async () => {
  const service = library();
  const alert = mockNativeDeletionAlert();
  const share = jest.fn();
  const item = `recording-library-item-${first.id}`;
  const card = () => screen.getByTestId(`${item}-content`);
  await render(
    <RecordingLibraryPanel service={service} onShareRecording={share} />,
  );
  await screen.findByTestId(item);

  await gesture(first.id, -300);
  expect(card()).toHaveStyle({ transform: [{ translateX: -152 }] });
  expect(deleteAction(first.id)).toBeVisible();
  expect(await gesture(first.id, 72)).toBe(true);
  await act(() => jest.advanceTimersByTime(1_000));
  expect(card()).toHaveStyle({ transform: [{ translateX: 0 }] });
  expect(deleteAction(first.id)).toBeNull();

  await gesture(first.id, -300);
  await act(() => jest.advanceTimersByTime(1_000));
  expect(card()).toHaveStyle({ transform: [{ translateX: -132 }] });
  expect(screen.getByTestId(`${item}-action-clip`)).toHaveStyle({ width: 132 });
  expect(share).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(service.deleteRecording).not.toHaveBeenCalled();
});

test('tapping Delete after swipe or accessibility reveal uses the same exact confirmation', async () => {
  const service = library();
  const alert = mockNativeDeletionAlert();
  await render(<RecordingLibraryPanel service={service} />);
  await screen.findByTestId(`recording-library-item-${first.id}`);
  await gesture(first.id, -110);
  await fireEvent.press(screen.getByTestId(`recording-delete-${first.id}`));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(deleteAction(first.id)).toBeNull();
  expect(service.deleteRecording).not.toHaveBeenCalled();
  await act(async () => pressNativeDeletionButton(alert, 'cancel'));
  expect(screen.getByTestId(`recording-library-item-${first.id}`)).toBeTruthy();

  await requestLibraryRowDeletion(second.id);
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
  expect(service.deleteRecording).not.toHaveBeenCalled();
  await confirmNativeDeletion(alert);
  await waitFor(() =>
    expect(
      screen.queryByTestId(`recording-library-item-${second.id}`),
    ).toBeNull(),
  );
  expect(service.deleteRecording).toHaveBeenCalledTimes(1);
  expect(service.deleteRecording).toHaveBeenCalledWith(second.id);
  expect(screen.getByTestId(`recording-library-item-${first.id}`)).toBeTruthy();
});

test('busy state removes an open reveal and disarms the accessibility alternative', async () => {
  const service = library();
  const alert = mockNativeDeletionAlert();
  const view = await render(<RecordingLibraryPanel service={service} />);
  await screen.findByTestId(`recording-library-item-${first.id}`);
  await gesture(first.id, -110);
  expect(deleteAction(first.id)).toBeVisible();

  await view.rerender(
    <RecordingLibraryPanel service={service} actionsDisabled />,
  );
  expect(deleteAction(first.id)).toBeNull();
  expect(await gesture(first.id, -140)).toBe(false);
  const details = screen.getByTestId(`recording-details-${first.id}`);
  expect(details.props.accessibilityActions).toBeUndefined();
  await fireEvent(details, 'accessibilityAction', {
    nativeEvent: { actionName: 'delete' },
  });
  expect(deleteAction(first.id)).toBeNull();
  expect(alert).not.toHaveBeenCalled();
  expect(service.deleteRecording).not.toHaveBeenCalled();

  await view.rerender(<RecordingLibraryPanel service={service} />);
  expect(deleteAction(first.id)).toBeNull();
});
