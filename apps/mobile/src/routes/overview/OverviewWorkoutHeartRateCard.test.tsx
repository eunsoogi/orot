import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { openLocalStorage } from '../../storage/secureDatabase';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { healthKitSample } from '../../healthkit/commonObservations/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../healthkit/commonObservations/mapper';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
type Protection = NonNullable<ReturnType<typeof conversationExecutionNative>>;
type ProtectionEvent = Parameters<Parameters<Protection['subscribe']>[0]>[0];
const one = 'B09CB262-D06E-485C-A600-BEEA45828A97';
const two = 'FE6E3FEA-0BCA-402B-BED3-E2838C9F4B1F';
const values = { status: 'available', minimum: 60, mean: 90, maximum: 130 };
const original = NativeModules.HealthKitModule;

function fixture(id: string, hoursAgo: number) {
  const start = new Date(Date.now() - hoursAgo * 3600000).toISOString();
  const end = new Date(Date.parse(start) + 60000).toISOString();
  const mapped = mapCommonObservationSample(
    'workouts',
    healthKitSample('workouts', {
      id,
      startDate: start,
      endDate: end,
    }),
  );
  if (mapped.status !== 'mapped') throw new Error('Broken synthetic workout.');
  return toCommonObservationRecord(mapped.observation, end);
}

async function setup() {
  const { database, close } = openSqliteTestDatabase(':memory:');
  await runMigrations(database);
  const repository = createRecordRepository(database);
  const first = fixture(one, 1);
  const second = fixture(two, 2);
  await repository.put('health_observation', first);
  await repository.put('health_observation', second);
  await repository.put('health_observation', { ...first, id: 'forged' });
  const pages = jest.spyOn(repository, 'listHealthObservationPage');
  jest.mocked(openLocalStorage).mockResolvedValue(repository);
  let protectedData = true;
  const subscribers = new Set<(event: ProtectionEvent) => void>();
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    async begin() {
      throw new Error('Unexpected execution lease');
    },
    end() {
      throw new Error('Unexpected execution lease');
    },
    async isActive() {
      throw new Error('Unexpected execution lease');
    },
    currentPhase: () => 'active',
    protectedDataAvailable: async () => protectedData,
    subscribe: listener => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  });
  const queryWorkoutHeartRate = jest.fn(async (_id: string) => values);
  const requestReadAuthorizations = jest.fn();
  const querySamples = jest.fn();
  NativeModules.HealthKitModule = {
    queryWorkoutHeartRate,
    requestReadAuthorizations,
    querySamples,
  };
  return {
    close,
    repository,
    first,
    second,
    pages,
    queryWorkoutHeartRate,
    requestReadAuthorizations,
    querySamples,
    revoke() {
      protectedData = false;
      for (const subscriber of subscribers)
        subscriber({ kind: 'protectedData', available: false });
    },
  };
}

afterEach(() => {
  NativeModules.HealthKitModule = original;
  jest.clearAllMocks();
});

const picker = () => screen.getByTestId('overview-workout-heart-rate-choose');
const option = (i: number) =>
  screen.findByTestId('overview-workout-heart-rate-option-' + i);
const result = () => screen.queryByTestId('overview-workout-heart-rate-result');

test('loads only an explicit bounded workout page and reads only the selected associated UUID', async () => {
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={302} />,
    );
    expect(openLocalStorage).not.toHaveBeenCalled();
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    await fireEvent.press(picker());
    const selected = await option(1);
    expect(lane.pages).toHaveBeenCalledTimes(1);
    expect(lane.pages).toHaveBeenCalledWith(null, 20, {
      category: 'workouts',
      fromInclusive: expect.any(String),
      toInclusive: expect.any(String),
    });
    expect(
      screen.queryByTestId('overview-workout-heart-rate-option-2'),
    ).toBeNull();
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    await fireEvent.press(selected);
    await waitFor(() =>
      expect(result()).toHaveTextContent(
        '운동 시간 안의 연결 심박수: 평균 90 bpm, 범위 60–130 bpm',
      ),
    );
    expect(lane.queryWorkoutHeartRate).toHaveBeenCalledTimes(1);
    expect(lane.queryWorkoutHeartRate).toHaveBeenCalledWith(two);
    expect(lane.requestReadAuthorizations).not.toHaveBeenCalled();
    expect(lane.querySamples).not.toHaveBeenCalled();
    await act(() => lane.revoke());
    expect(result()).toBeNull();
    await view.unmount();
  } finally {
    lane.close();
  }
});

test.each(['deleted', 'locked', 'blurred', 'changed'])(
  'does not publish a held native result after %s',
  async reason => {
    const lane = await setup();
    try {
      let release!: (value: typeof values) => void;
      lane.queryWorkoutHeartRate.mockReturnValueOnce(
        new Promise(resolve => {
          release = resolve;
        }),
      );
      const view = await render(
        <OverviewWorkoutHeartRateCard active width={undefined} />,
      );
      await fireEvent.press(picker());
      const selected = await option(0);
      const tapped = fireEvent.press(selected);
      await waitFor(() =>
        expect(lane.queryWorkoutHeartRate).toHaveBeenCalledWith(one),
      );
      if (reason === 'deleted') {
        await lane.repository.delete('health_observation', lane.first.id);
        await act(() =>
          notifyLocalSourceDeleted('healthkit', new Set([lane.first.id])),
        );
      } else if (reason === 'locked') await act(() => lane.revoke());
      else if (reason === 'blurred') {
        await view.rerender(
          <OverviewWorkoutHeartRateCard active={false} width={undefined} />,
        );
      } else
        await lane.repository.put('health_observation', {
          ...lane.first,
          endedAt: new Date(
            Date.parse(lane.first.endedAt!) + 30000,
          ).toISOString(),
        });
      await act(async () => {
        release(values);
        await tapped;
      });
      await waitFor(() => expect(result()).toBeNull());
      await view.unmount();
    } finally {
      lane.close();
    }
  },
);

test('a captured choice deleted before native admission never calls native', async () => {
  const lane = await setup();
  try {
    const view = await render(
      <OverviewWorkoutHeartRateCard active width={undefined} />,
    );
    await fireEvent.press(picker());
    const selected = await option(0);
    await lane.repository.delete('health_observation', lane.first.id);
    await fireEvent.press(selected);
    await waitFor(() => expect(result()).toBeNull());
    expect(lane.queryWorkoutHeartRate).not.toHaveBeenCalled();
    await view.unmount();
  } finally {
    lane.close();
  }
});
