import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState, NativeModules } from 'react-native';
import { HealthRecordsDetailRecordRow } from '../HealthRecordsDetailRecordRow';
import { healthKitSample } from '../commonObservations/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../commonObservations/mapper';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';

const workoutId = 'B09CB262-D06E-485C-A600-BEEA45828A97';
const check = '운동에 연결된 심박수 확인';
const summary = '운동 시간 안의 연결 심박수: 평균 81 BPM, 범위 61–122 BPM';
const original = NativeModules.HealthKitModule;
const associated = {
  status: 'available',
  minimum: 61.99,
  mean: 81.99,
  maximum: 122.99,
};

function fixture() {
  const sample = healthKitSample('workouts', { id: workoutId });
  const mapped = mapCommonObservationSample('workouts', sample);
  if (mapped.status !== 'mapped')
    throw new Error('Expected a synthetic workout');
  return toCommonObservationRecord(
    mapped.observation,
    '2026-10-04T12:00:00.000Z',
  );
}

function bridge(result: unknown = associated) {
  const queryWorkoutHeartRate = jest.fn(async (_id: string) => result);
  const requestReadAuthorizations = jest.fn();
  const querySamples = jest.fn();
  NativeModules.HealthKitModule = {
    queryWorkoutHeartRate,
    requestReadAuthorizations,
    querySamples,
  };
  return { queryWorkoutHeartRate, requestReadAuthorizations, querySamples };
}

afterEach(() => {
  NativeModules.HealthKitModule = original;
});

test('reads only the selected imported workout after its explicit action and never prompts', async () => {
  const { queryWorkoutHeartRate, requestReadAuthorizations, querySamples } =
    bridge();
  const observation = fixture();
  await render(
    <HealthRecordsDetailRecordRow
      row={{ kind: 'observation', observation }}
      index={0}
    />,
  );
  expect(queryWorkoutHeartRate).not.toHaveBeenCalled();
  expect(screen.queryByText(summary)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: check }));
  expect(await screen.findByText(summary)).toBeTruthy();
  expect(queryWorkoutHeartRate).toHaveBeenCalledTimes(1);
  expect(queryWorkoutHeartRate).toHaveBeenCalledWith(workoutId);
  expect(requestReadAuthorizations).not.toHaveBeenCalled();
  expect(querySamples).not.toHaveBeenCalled(); // No generic time-window query.
});

test('does not attach a native action to a forged local key even if the source UUID is valid', async () => {
  const { queryWorkoutHeartRate } = bridge();
  const observation = { ...fixture(), id: 'unrelated-local-workout' };
  await render(
    <HealthRecordsDetailRecordRow
      row={{ kind: 'observation', observation }}
      index={0}
    />,
  );
  expect(screen.queryByRole('button', { name: check })).toBeNull();
  expect(queryWorkoutHeartRate).not.toHaveBeenCalled();
});

test.each([
  [
    { status: 'notAvailable' },
    '이 운동에 연결된 심박수를 확인할 수 없어요. 건강 데이터 읽기 설정을 확인해 주세요.',
  ],
  [
    { status: 'available', minimum: 0, mean: 0, maximum: 0 },
    '이 운동의 심박수를 불러오지 못했어요. 다시 시도해 주세요.',
  ],
  [
    { status: 'available', minimum: 98, mean: 55, maximum: 122 },
    '이 운동의 심박수를 불러오지 못했어요. 다시 시도해 주세요.',
  ],
])(
  'never presents missing or invalid statistics as a zero value',
  async (result, message) => {
    bridge(result);
    await render(
      <HealthRecordsDetailRecordRow
        row={{ kind: 'observation', observation: fixture() }}
        index={0}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: check }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(summary)).toBeNull();
  },
);

test.each(['delete', 'clear', 'unmount'])(
  'ignores a late result after %s',
  async stop => {
    const { queryWorkoutHeartRate } = bridge();
    let release!: (value: typeof associated) => void;
    queryWorkoutHeartRate.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      }),
    );
    const observation = fixture();
    const view = await render(
      <HealthRecordsDetailRecordRow
        row={{ kind: 'observation', observation }}
        index={0}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: check }));
    await fireEvent.press(screen.getByRole('button', { name: check }));
    expect(queryWorkoutHeartRate).toHaveBeenCalledTimes(1);
    if (stop === 'unmount') await view.unmount();
    else
      await act(() => {
        if (stop === 'clear') notifyLocalDataCleared();
        else notifyLocalSourceDeleted('healthkit', new Set([observation.id]));
      });
    await act(async () => {
      release(associated);
    });
    await waitFor(() => expect(screen.queryByText(summary)).toBeNull());
    expect(screen.queryByRole('button', { name: check })).toBeNull();
  },
);

test('drops association data on background and never rereads on activation', async () => {
  const { queryWorkoutHeartRate } = bridge();
  const observe = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  try {
    await render(
      <HealthRecordsDetailRecordRow
        row={{ kind: 'observation', observation: fixture() }}
        index={0}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: check }));
    expect(await screen.findByText(summary)).toBeTruthy();
    const changes = observe.mock.calls
      .filter(([event]) => event === 'change')
      .map(([, change]) => change);
    expect(changes.length).toBeGreaterThan(0);
    await act(() => {
      changes.forEach(change => change('background'));
    });
    await act(() => {
      changes.forEach(change => change('active'));
    });
    expect(screen.queryByText(summary)).toBeNull();
    expect(queryWorkoutHeartRate).toHaveBeenCalledTimes(1);
  } finally {
    observe.mockRestore();
  }
});
