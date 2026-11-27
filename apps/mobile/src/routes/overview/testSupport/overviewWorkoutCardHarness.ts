import { NativeModules } from 'react-native';
import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  openLocalAgentMemoryDatabase,
  isCurrentLocalAgentMemoryDatabase,
} from '../../../storage/secureDatabase';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';
import { conversationExecutionNative } from '../../../ragConversation/conversationExecutionNative';
import { healthKitSample } from '../../../healthkit/commonObservations/testSupport';
import {
  mapCommonObservationSample,
  toCommonObservationRecord,
} from '../../../healthkit/commonObservations/mapper';

type Protection = NonNullable<ReturnType<typeof conversationExecutionNative>>;
type ProtectionEvent = Parameters<Parameters<Protection['subscribe']>[0]>[0];
export const one = 'B09CB262-D06E-485C-A600-BEEA45828A97';
export const two = 'FE6E3FEA-0BCA-402B-BED3-E2838C9F4B1F';
export function resultFor(period: {
  fromInclusive: string;
  toExclusive: string;
}) {
  const first = Date.parse(period.fromInclusive) + 10_000;
  return {
    ...period,
    status: 'available',
    minimum: 60,
    mean: 120,
    maximum: 180,
    sampleCount: 5,
    firstSampleAtMs: first,
    lastSampleAtMs: first + 60_000,
    membershipRevision: 'v1:' + '0'.repeat(64),
  };
}
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

export async function setup(
  adapter: {
    database: SqlDatabase;
    close(): void | Promise<void>;
  } = openSqliteTestDatabase(':memory:'),
) {
  const { database, close } = adapter;
  await runMigrations(database);
  const guarded = guardedNativeDatabase(database);
  const repository = createRecordRepository(guarded);
  const first = fixture(one, 1);
  const second = fixture(two, 2);
  await repository.put('health_observation', first);
  await repository.put('health_observation', second);
  await repository.put('health_observation', { ...first, id: 'forged' });
  const statements = jest.spyOn(database, 'execute');
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(guarded);
  let currentOwner = true;
  jest
    .mocked(isCurrentLocalAgentMemoryDatabase)
    .mockImplementation(owner => owner === guarded && currentOwner);
  let protectedData = true;
  let phase: 'active' | 'inactive' | 'background' = 'active';
  let protectedProbe: (() => Promise<boolean>) | undefined;
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
    currentPhase: () => phase,
    protectedDataAvailable: async () =>
      protectedProbe ? protectedProbe() : protectedData,
    subscribe: listener => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  });
  const queryWorkoutPeriodHeartRate = jest.fn(
    async (request: {
      callId: string;
      fromInclusive: string;
      toExclusive: string;
      workouts: readonly { id: string }[];
    }) =>
      resultFor({
        fromInclusive: request.fromInclusive,
        toExclusive: request.toExclusive,
      }),
  );
  const cancelWorkoutPeriodHeartRate = jest.fn();
  const queryWorkoutHeartRate = jest.fn();
  const requestReadAuthorizations = jest.fn();
  const querySamples = jest.fn();
  NativeModules.HealthKitModule = {
    queryWorkoutHeartRate,
    queryWorkoutPeriodHeartRate,
    cancelWorkoutPeriodHeartRate,
    requestReadAuthorizations,
    querySamples,
  };
  return {
    close,
    repository,
    first,
    second,
    statements,
    replaceOwner() {
      currentOwner = false;
    },
    async holdStartupWriter() {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>(resolve => {
        enter = resolve;
      });
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      // Exercise real transaction admission through the same guarded connection.
      const writer = guarded.transaction(async tx => {
        await tx.execute(
          'UPDATE health_observations SET ingested_at = ingested_at',
        );
        enter();
        await held;
      });
      await Promise.race([entered, writer]);
      return {
        async release() {
          release();
          await writer;
        },
      };
    },
    consumeProbe() {
      return protectedProbe?.();
    },
    holdFirstProtectionProbe() {
      let markStarted!: () => void;
      let release!: (value: boolean) => void;
      let probes = 0;
      const entered = new Promise<void>(resolve => {
        markStarted = resolve;
      });
      const held = new Promise<boolean>(resolve => {
        release = resolve;
      });
      protectedProbe = async () => {
        if (probes++ !== 0) return protectedData;
        markStarted();
        return held;
      };
      return { entered, release, probes: () => probes };
    },
    holdSecondProbe() {
      let enter!: () => void;
      let release!: (value: boolean) => void;
      const entered = new Promise<void>(resolve => {
        enter = resolve;
      });
      const held = new Promise<boolean>(resolve => {
        release = resolve;
      });
      let pass = true;
      protectedProbe = async () => {
        if (pass) {
          pass = false;
          return true;
        }
        enter();
        return held;
      };
      return { entered, release };
    },
    queryWorkoutHeartRate,
    queryWorkoutPeriodHeartRate,
    cancelWorkoutPeriodHeartRate,
    requestReadAuthorizations,
    querySamples,
    transition(next: typeof phase) {
      phase = next;
      for (const subscriber of subscribers)
        subscriber(
          next === 'active' ? { kind: 'foreground' } : { kind: 'phase' },
        );
    },
    restoreProtection() {
      protectedData = true;
      for (const subscriber of subscribers)
        subscriber({ kind: 'protectedData', available: true });
    },
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
