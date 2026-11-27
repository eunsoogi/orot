import { act, render, screen } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { healthKitSample } from '../../healthkit/commonObservations/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../healthkit/commonObservations/mapper';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import {
  isCurrentLocalAgentMemoryDatabase,
  openLocalAgentMemoryDatabase,
} from '../../storage/secureDatabase';
import { protectedSqlRead } from '../../storage/guardedMutationBoundary';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { recentTestExecution } from '../testSupport/recentRecordsRouteTestSupport';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { loadSelectedOverviewSnapshot } from './selectedOverviewSnapshot';
import { one, resultFor } from './testSupport/overviewWorkoutCardHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

const display = 'overview-workout-heart-rate-result';

test('a concurrent warm parent projection preserves the first valid native workout response', async () => {
  const f = openOpSqliteFileQueue();
  const owner = guardedNativeDatabase(f.database);
  const readParent = () =>
    loadSelectedOverviewSnapshot(
      owner,
      new Date(),
      new AbortController().signal,
    );
  const old = NativeModules.HealthKitModule;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    enter = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const native = jest.fn(async (period: Parameters<typeof resultFor>[0]) => {
    if (native.mock.calls.length === 1) {
      enter();
      await held;
      return { ...resultFor(period), mean: 145 };
    }
    return resultFor(period);
  });
  let ui: Awaited<ReturnType<typeof render>> | undefined;
  try {
    await runMigrations(owner);
    const startDate = new Date(Date.now() - 3600000).toISOString();
    const endDate = new Date(Date.now() - 3540000).toISOString();
    const mapped = mapCommonObservationSample(
      'workouts',
      healthKitSample('workouts', { id: one, startDate, endDate }),
    );
    if (mapped.status !== 'mapped')
      throw new Error('Missing synthetic workout.');
    await createRecordRepository(owner).put(
      'health_observation',
      toCommonObservationRecord(mapped.observation, endDate),
    );
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(owner);
    jest
      .mocked(isCurrentLocalAgentMemoryDatabase)
      .mockImplementation(candidate => candidate === owner);
    jest
      .mocked(conversationExecutionNative)
      .mockReturnValue(recentTestExecution);
    NativeModules.HealthKitModule = {
      queryWorkoutPeriodHeartRate: native,
      cancelWorkoutPeriodHeartRate: jest.fn(),
    };
    await readParent();
    ui = await render(<OverviewWorkoutHeartRateCard active width={302} />);
    await entered;
    const writes: string[] = [];
    f.observeSubmit(sql => {
      if (!protectedSqlRead(sql)) writes.push(sql);
    });
    await act(async () => {
      await readParent();
    });
    expect(screen.getByTestId(display)).toHaveTextContent(/불러오는 중/);
    expect(native).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
    expect(await screen.findByText('145 BPM')).toBeVisible();
    expect(writes).toEqual([]);
    expect(native).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await ui?.unmount();
    NativeModules.HealthKitModule = old;
    await f.close();
  }
});
