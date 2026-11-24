import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { loadRecentMaterial } from '../../generatedReports/recentMaterialReader';
import { createNavigationController } from '../../navigation/navigationController';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { recordingService } from '../../recording/recordingService';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { readSelectedRecentRecording } from '../recentSourceReader';
import {
  holdRecentTestPage,
  recentRouteProps,
  recentTestExecution,
  renderRecords,
} from '../testSupport/recentRecordsRouteTestSupport';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock(
  'react-native/Libraries/Components/RefreshControl/RefreshControl',
  () => {
    const React = jest.requireActual('react');
    const { View } = jest.requireActual('react-native');
    return { default: (props: object) => React.createElement(View, props) };
  },
);
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../../generatedReports/recentMaterialReader', () => ({
  loadRecentMaterial: jest.fn(),
}));
jest.mock('../recentSourceReader', () => ({
  ...jest.requireActual('../recentSourceReader'),
  readSelectedRecentRecording: jest.fn(),
}));

type RecordingMetadataResult = Awaited<
  ReturnType<typeof readSelectedRecentRecording>
>;
const read = jest.mocked(readSelectedRecentRecording);
const control = () => screen.getByTestId('navigation-route-refresh');
const pull = async () =>
  act(async () => {
    control().props.onRefresh();
  });

beforeEach(() => {
  read.mockReset();
  jest.mocked(loadRecentMaterial).mockResolvedValue([]);
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue(recentTestExecution);
});
afterEach(() => jest.restoreAllMocks());

async function open() {
  const controller = createNavigationController<AppNavigationRoute>('root');
  const props = recentRouteProps();
  await renderRecords(controller, props);
  await fireEvent.press(screen.getByTestId('records-recent-view-all'));
  await fireEvent.press(
    await screen.findByTestId('records-recent-source-synthetic-4'),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe('recording-review');
  return { controller, original: props.recordings[4]! };
}

test('Recent Records registers one native refresh that only rereads the exact saved recording metadata', async () => {
  const play = jest.spyOn(recordingService, 'playRange');
  const { controller, original } = await open();
  const held = holdRecentTestPage<RecordingMetadataResult>();
  read.mockReturnValueOnce(held.promise);
  expect(read).not.toHaveBeenCalled();
  await pull();
  await pull();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(original.id);
  expect(control().props.refreshing).toBe(true);
  await act(async () =>
    held.resolve({ ...original, recordingDurationMs: 95000 }),
  );
  expect(screen.getByText('01:35')).toBeVisible();
  expect(screen.getByTestId('recording-review-layout')).toBeTruthy();
  expect(control().props.refreshing).toBe(false);
  expect(play).not.toHaveBeenCalled();
  expect(controller.getSnapshot().currentRoute.name).toBe('recording-review');
});

test('silently lost protection hides metadata and allows retry; selected deletion retires a held refresh', async () => {
  const { original } = await open();
  let protectedData = true;
  jest.mocked(conversationExecutionNative).mockReturnValue({
    ...recentTestExecution,
    protectedDataAvailable: async () => protectedData,
  });
  read.mockImplementationOnce(async () => {
    protectedData = false;
    return { ...original, recordingDurationMs: 95000 };
  });
  await pull();
  expect(screen.queryByText('01:35')).toBeNull();
  expect(
    screen.getByText('기기 잠금을 해제한 뒤 아래로 당겨 다시 시도해 주세요.'),
  ).toBeVisible();
  protectedData = true;
  read.mockRejectedValueOnce(new Error('synthetic unavailable after lock'));
  await pull();
  expect(screen.queryByTestId('recording-review-layout')).toBeNull();
  read.mockResolvedValueOnce({ ...original, recordingDurationMs: 95000 });
  await pull();
  expect(screen.getByText('01:35')).toBeVisible();
  const held = holdRecentTestPage<RecordingMetadataResult>();
  read.mockReturnValueOnce(held.promise);
  await pull();
  await act(async () =>
    notifyLocalSourceDeleted('local', new Set([original.id])),
  );
  await waitFor(() => expect(control().props.refreshing).toBe(false));
  await act(async () =>
    held.resolve({ ...original, recordingDurationMs: 92000 }),
  );
  expect(screen.queryByText('01:32')).toBeNull();
  expect(screen.getByText('저장된 녹음을 찾을 수 없어요.')).toBeVisible();
});

test('Back retires a held metadata read and cannot replace another recording', async () => {
  const { controller, original } = await open();
  const held = holdRecentTestPage<RecordingMetadataResult>();
  read.mockReturnValueOnce(held.promise);
  await pull();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(controller.getSnapshot().currentRoute.name).toBe('recent-records');
  await fireEvent.press(
    screen.getByTestId('records-recent-source-synthetic-3'),
  );
  await act(async () =>
    held.resolve({ ...original, recordingDurationMs: 95000 }),
  );
  expect(screen.getByTestId('recording-review-layout')).toBeTruthy();
  expect(screen.queryByText('01:35')).toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
});

test('a transient read failure never remounts authorized panels or interrupts pending playback', async () => {
  const playing = holdRecentTestPage<number>();
  const duration = jest
    .spyOn(recordingService, 'readDuration')
    .mockReturnValue(playing.promise);
  const play = jest
    .spyOn(recordingService, 'playRange')
    .mockResolvedValue({ startMs: 0, endMs: 95000, actualStartMs: 0 });
  const { original } = await open();
  const playback = screen.getByTestId('recording-playback-controls');
  await fireEvent.press(screen.getByTestId('recording-playback-button'));
  expect(duration).toHaveBeenCalledTimes(1);
  read.mockRejectedValueOnce(new Error('synthetic metadata unavailable'));
  await pull();
  expect(screen.getByTestId('recording-playback-controls')).toBe(playback);
  expect(
    screen.getByText(
      '녹음 정보를 불러오지 못했어요. 아래로 당겨 다시 시도해 주세요.',
    ),
  ).toBeVisible();
  await act(async () => playing.resolve(95000));
  expect(play).toHaveBeenCalledTimes(1);
  expect(play).toHaveBeenCalledWith(original.id, 0, 95000);
});

test('a native lock event stays revoked for the held metadata read even after native unlock', async () => {
  const listeners = new Set<
    (
      event: import('../../ragConversation/conversationExecutionLease').ConversationExecutionEvent,
    ) => void
  >();
  jest.mocked(conversationExecutionNative).mockReturnValue({
    ...recentTestExecution,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  const { original } = await open();
  const held = holdRecentTestPage<RecordingMetadataResult>();
  read.mockReturnValueOnce(held.promise);
  await pull();
  await act(async () => {
    for (const listener of listeners)
      listener({ kind: 'protectedData', available: false });
    for (const listener of listeners)
      listener({ kind: 'protectedData', available: true });
    held.resolve({ ...original, recordingDurationMs: 95000 });
  });
  expect(screen.queryByText('01:35')).toBeNull();
  expect(
    screen.getByText('기기 잠금을 해제한 뒤 아래로 당겨 다시 시도해 주세요.'),
  ).toBeVisible();
  expect(control().props.refreshing).toBe(false);
  read.mockResolvedValueOnce({ ...original, recordingDurationMs: 95000 });
  await pull();
  expect(screen.getByText('01:35')).toBeVisible();
});

test('a timed-out pull allows one new exact read and cannot publish late', async () => {
  const { controller, original } = await open();
  const old = holdRecentTestPage<RecordingMetadataResult>();
  const newer = holdRecentTestPage<RecordingMetadataResult>();
  jest.useFakeTimers();
  try {
    read.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    await pull();
    await pull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(control().props.refreshing).toBe(true);
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(control().props.refreshing).toBe(false);
    expect(
      screen.getByText(
        '녹음 정보를 불러오지 못했어요. 아래로 당겨 다시 시도해 주세요.',
      ),
    ).toBeVisible();
    await pull();
    expect(read.mock.calls).toEqual([[original.id], [original.id]]);
    await act(async () =>
      old.resolve({ ...original, recordingDurationMs: 92000 }),
    );
    expect(screen.queryByText('01:32')).toBeNull();
    expect(control().props.refreshing).toBe(true);
    await act(async () =>
      newer.resolve({ ...original, recordingDurationMs: 95000 }),
    );
    expect(screen.getByText('01:35')).toBeVisible();
    expect(control().props.refreshing).toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('recording-review');
  } finally {
    jest.useRealTimers();
  }
});
