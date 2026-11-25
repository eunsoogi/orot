import { IOS_LIBRARY_PATH, open, type DB } from '@op-engineering/op-sqlite';
import type { ConversationExecutionEvent } from '../../ragConversation/conversationExecutionLease';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { projectOverviewMetricSnapshot } from '../../routes/overview/metricLoader';
import { createSecureOverviewReader } from '../secureOverviewReader';
import { guardedNativeDatabase } from '../protectedReadEpoch';

jest.mock('@op-engineering/op-sqlite', () => ({
  IOS_LIBRARY_PATH: 'synthetic-library',
  isSQLCipher: () => true,
  open: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../../routes/overview/metricLoader', () => ({
  projectOverviewMetricSnapshot: jest.fn(),
}));

const preferenceKey = 'home:metric-selection:v1';
const preferenceValue = JSON.stringify([
  'sleep',
  'workoutHeartRate',
  'heartRate',
]);
const preferenceUpdatedAt = '2035-01-15T00:00:00Z';

function fixture() {
  const events: string[] = [];
  const rawWriter = {
    execute: jest.fn(async () => ({ rows: [] })),
    transaction: jest.fn(async () => {}),
  };
  const writer = guardedNativeDatabase(rawWriter) as unknown as DB;
  const execute = jest.fn(async (sql: string, bindings?: unknown[]) =>
    sql === 'PRAGMA data_version'
      ? { rows: [{ data_version: 7 }] }
      : sql.includes('health_context_generation')
        ? { rows: [{ ready: 1 }] }
        : sql.startsWith(
              'SELECT checkpoint_key, value, updated_at FROM healthkit_sync_checkpoints',
            ) && bindings?.[0] === preferenceKey
          ? {
              rows: [
                {
                  checkpoint_key: preferenceKey,
                  value: preferenceValue,
                  updated_at: preferenceUpdatedAt,
                },
              ],
            }
          : { rows: [] },
  );
  const close = jest.fn(() => {
    events.push('close');
  });
  jest.mocked(open).mockReturnValue({
    execute,
    transaction: async (work: Parameters<DB['transaction']>[0]) => {
      events.push('begin');
      await work({ execute } as unknown as Parameters<
        Parameters<DB['transaction']>[0]
      >[0]);
      events.push('settled');
    },
    close,
  } as unknown as DB);
  let event: (value: ConversationExecutionEvent) => void = () => {};
  const unsubscribe = jest.fn();
  const protectedDataAvailable = jest.fn(async () => true);
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    protectedDataAvailable,
    subscribe: (listener: (value: ConversationExecutionEvent) => void) => {
      event = listener;
      return unsubscribe;
    },
  } as unknown as ReturnType<typeof conversationExecutionNative>);
  jest
    .mocked(projectOverviewMetricSnapshot)
    .mockResolvedValue({ metrics: {}, quantityTruncated: false });
  const key = jest.fn(async () => 'synthetic-key');
  const ready = jest.fn(async () => undefined);
  const read = createSecureOverviewReader(
    ready,
    () => writer,
    key,
    'synthetic.db',
  );
  return {
    read,
    writer,
    rawWriter,
    key,
    ready,
    events,
    close,
    unsubscribe,
    protectedDataAvailable,
    event: (value: ConversationExecutionEvent) => event(value),
  };
}

test('production adapter opens the same existing owner and publishes only after lease release', async () => {
  const f = fixture();
  const publish = jest.fn(() => {
    f.events.push('publish');
  });
  expect(await f.read(new Date(), new AbortController().signal, publish)).toBe(
    'published',
  );
  expect(f.ready).toHaveBeenCalledTimes(1);
  expect(f.key).toHaveBeenCalledTimes(1);
  expect(f.rawWriter.execute).not.toHaveBeenCalled();
  expect(f.rawWriter.transaction).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith({
    name: 'synthetic.db',
    location: IOS_LIBRARY_PATH,
    encryptionKey: 'synthetic-key',
    readOnly: true,
    failOnCreate: true,
  });
  expect(projectOverviewMetricSnapshot).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.any(Date),
    ['sleep', 'heartRate', 'restingHeartRate', 'walkingHeartRate'],
  );
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: ['sleep', 'heartRate'],
      workoutChoiceWitness: JSON.stringify([
        preferenceUpdatedAt,
        preferenceValue,
      ]),
    }),
  );
  expect(f.events).toEqual(['begin', 'settled', 'close', 'publish']);
  expect(f.protectedDataAvailable).toHaveBeenCalledTimes(2);
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});

test.each(['writer', 'protected-data'] as const)(
  'production adapter rejects %s revocation at synchronous close',
  async kind => {
    const f = fixture();
    let nativeWrite: ReturnType<typeof f.writer.execute> | undefined;
    f.close.mockImplementation(() => {
      if (kind === 'writer')
        nativeWrite = f.writer.execute('DELETE FROM health_observations');
      else f.event({ kind: 'protectedData', available: false });
    });
    const publish = jest.fn();
    expect(
      await f.read(new Date(), new AbortController().signal, publish),
    ).toBe('discarded');
    await nativeWrite;
    expect(publish).not.toHaveBeenCalled();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  },
);

test('a delayed native protection event cannot turn an SQL/open error into fallback', async () => {
  const f = fixture();
  f.protectedDataAvailable
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  jest.mocked(open).mockImplementationOnce(() => {
    throw new Error('Synthetic protection unavailable before event delivery.');
  });
  const publish = jest.fn();
  await expect(
    f.read(new Date(), new AbortController().signal, publish),
  ).resolves.toBe('discarded');
  expect(publish).not.toHaveBeenCalled();
  expect(f.protectedDataAvailable).toHaveBeenCalledTimes(2);
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});

test('legacy workout choice yields a protected receipt for the grouped heart card', async () => {
  jest.mocked(projectOverviewMetricSnapshot).mockClear();
  const f = fixture();
  const publish = jest.fn(() => {
    f.events.push('publish');
  });
  await expect(
    f.read.readWorkoutChoice(new AbortController().signal, publish),
  ).resolves.toBe('published');
  expect(publish).toHaveBeenCalledWith({
    witness: JSON.stringify([preferenceUpdatedAt, preferenceValue]),
    expires: expect.any(Number),
  });
  expect(projectOverviewMetricSnapshot).not.toHaveBeenCalled();
  expect(f.events).toEqual(['begin', 'settled', 'close', 'publish']);
});
