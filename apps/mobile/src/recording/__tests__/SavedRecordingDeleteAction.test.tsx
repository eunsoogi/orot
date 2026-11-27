import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { recordingLibraryService } from '../recordingLibraryService';
import type { RecordingSourceRecord } from '../recordingTypes';
import { SavedRecordingDeleteAction } from '../SavedRecordingDeleteAction';

jest.mock('../recordingLibraryService', () => ({
  recordingLibraryService: { deleteRecording: jest.fn() },
}));

const button = 'saved-recording-detail-delete';
const source = (id: string): RecordingSourceRecord => ({
  id,
  sourceKind: 'audio_recording',
  title: 'Synthetic ' + id,
  effectiveAt: '2035-01-01T01:00:00Z',

  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
});

function route() {
  let current = true;
  const subscriptions = new Set<() => void>();
  return {
    isCurrent: () => current,
    subscribe(listener: () => void) {
      subscriptions.add(listener);
      return () => {
        subscriptions.delete(listener);
      };
    },
    set(value: boolean) {
      current = value;
      subscriptions.forEach(listener => listener());
    },
  };
}

const remove = jest.mocked(recordingLibraryService.deleteRecording);

beforeEach(() => {
  remove.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('native Delete approves exactly once and Back follows committed service and released busy state', async () => {
  const owner = route();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const order: string[] = [];
  let finish!: () => void;
  remove.mockImplementation(async id => {
    order.push('delete:' + id);
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    order.push('source committed');
    return { audioCleanupPending: true };
  });
  const onDeleted = jest.fn(() => {
    order.push('back');
  });
  await render(
    <SavedRecordingDeleteAction
      active
      routeOwner={owner}
      source={source('first')}
      onDeleted={onDeleted}
      onBusyChange={busy => order.push(busy ? 'busy' : 'ready')}
    />,
  );
  await fireEvent.press(screen.getByTestId(button));
  const destructive = alert.mock.calls[0]?.[2]?.find(
    item => item.style === 'destructive',
  )?.onPress;
  expect(destructive).toBeDefined();
  await act(() => {
    destructive?.();
    destructive?.();
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('first');
  expect(screen.getByTestId('recording-delete-progress')).toBeVisible();
  expect(onDeleted).not.toHaveBeenCalled();
  await act(async () => {
    finish();
  });
  expect(order).toEqual([
    'busy',
    'delete:first',
    'source committed',
    'ready',
    'back',
  ]);
});

test('Cancel and a route-retired native alert cannot approve a later target', async () => {
  const first = route(),
    second = route();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const ui = await render(
    <SavedRecordingDeleteAction
      active
      routeOwner={first}
      source={source('first')}
    />,
  );
  await fireEvent.press(screen.getByTestId(button));
  const oldButtons = alert.mock.calls[0]?.[2];
  await act(() => {
    oldButtons?.find(item => item.style === 'cancel')?.onPress?.();
  });
  await fireEvent.press(screen.getByTestId(button));
  const retired = alert.mock.calls[1]?.[2]?.find(
    item => item.style === 'destructive',
  )?.onPress;
  await act(() => first.set(false));
  await ui.rerender(
    <SavedRecordingDeleteAction
      active
      routeOwner={second}
      source={source('second')}
    />,
  );
  await fireEvent.press(screen.getByTestId(button));
  await act(() => {
    retired?.();
    oldButtons?.find(item => item.style === 'destructive')?.onPress?.();
  });
  expect(remove).not.toHaveBeenCalled();
  const accepted = alert.mock.calls[2]?.[2]?.find(
    item => item.style === 'destructive',
  )?.onPress;
  expect(accepted).toBeDefined();
  remove.mockResolvedValue({ audioCleanupPending: false });
  await act(async () => {
    accepted?.();
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('second');
});

test.each(['failure', 'retired'] as const)('no Back after %s', async mode => {
  const owner = route();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let finish!: () => void;
  remove.mockImplementation(async () => {
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    if (mode === 'failure') throw new Error('Synthetic deletion rejection');
    return { audioCleanupPending: false };
  });
  const back = jest.fn();
  await render(
    <SavedRecordingDeleteAction
      active
      routeOwner={owner}
      source={source('first')}
      onDeleted={back}
    />,
  );
  await fireEvent.press(screen.getByTestId(button));
  await act(() => {
    alert.mock.calls[0]?.[2]
      ?.find(item => item.style === 'destructive')
      ?.onPress?.();
  });
  if (mode === 'retired') {
    await act(() => owner.set(false));
    await act(() => owner.set(true));
  }
  await act(async () => {
    finish();
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(back).not.toHaveBeenCalled();
  if (mode === 'failure')
    expect(screen.getByTestId('saved-recording-delete-error')).toBeVisible();
});
