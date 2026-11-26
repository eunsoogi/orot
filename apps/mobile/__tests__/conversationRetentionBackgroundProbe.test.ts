jest.mock('react-native', () => ({
  AppState: { currentState: 'background' },
  NativeModules: {
    SettingsManager: {
      settings: {
        OROT_TEST_BACKGROUND_TOKEN: '12345678-1234-4234-8234-123456789abc',
      },
    },
    ConversationExecutionModule: {
      isActive: jest.fn(),
      backgroundContinuedGrant: jest.fn(),
      signalContinuedBackgroundCommit: jest.fn(),
      signalBackgroundCommit: jest.fn(),
      signalBackgroundFailure: jest.fn(),
    },
  },
}));
import {
  afterBackgroundCommit,
  beforeBackgroundCommit,
  preflightBackgroundCommit,
} from '../e2e/conversationRetentionBackgroundProbe';
import { observeFixtureConversationLease } from '../e2e/conversationLeaseProbeObservation';
import { AppState, NativeModules } from 'react-native';
const mockState = AppState as { currentState: string };
const mockSettings = NativeModules.SettingsManager.settings;
const mockExecution = NativeModules.ConversationExecutionModule;

const durableId = 'sqlite-owned-request';
const nativeId = 'opaque-native-attempt';
async function admittedLease(signal?: AbortSignal) {
  const witness = observeFixtureConversationLease({
    bridgeAvailable: true,
    begin: async () => true,
    end: jest.fn(),
    isActive: id => mockExecution.isActive(id),
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  });
  expect(await witness.execution?.begin(nativeId)).toBe(true);
  return {
    witness,
    owner: {
      requestId: durableId,
      nativeLease: await witness.requireActive(signal),
    },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  delete mockSettings.OROT_TEST_CONTINUED_GRANT;
  mockState.currentState = 'background';
  mockExecution.isActive.mockImplementation(
    async (id: string) => id === nativeId,
  );
  mockExecution.signalBackgroundCommit.mockResolvedValue(true);
});

test('signals success only after the same request remains leased through background commit', async () => {
  const execute = jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: durableId }] })
    .mockResolvedValue({ rows: [] });
  const db = { execute } as never;
  const { owner } = await admittedLease();
  const before = await beforeBackgroundCommit(db, owner);
  await afterBackgroundCommit(db, before);
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining(
      'INSERT INTO conversation_retention_probe_background',
    ),
    [durableId, 'background', 'background', 1, 1],
  );
  expect(mockExecution.signalBackgroundCommit).toHaveBeenCalledWith(
    nativeId,
    '12345678-1234-4234-8234-123456789abc',
  );
  expect(mockExecution.signalBackgroundFailure).not.toHaveBeenCalled();
});

test('foreground resumption after the commit cannot report a background success', async () => {
  const execute = jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: durableId }] })
    .mockResolvedValue({ rows: [] });
  const db = { execute } as never;
  const { owner } = await admittedLease();
  const before = await beforeBackgroundCommit(db, owner);
  mockState.currentState = 'active';
  await afterBackgroundCommit(db, before);
  expect(mockExecution.signalBackgroundCommit).not.toHaveBeenCalled();
  expect(mockExecution.signalBackgroundFailure).toHaveBeenCalledWith(
    '12345678-1234-4234-8234-123456789abc',
  );
});

test('preflight requires an active foreground request and native lease', async () => {
  mockState.currentState = 'active';
  const db = {
    execute: jest.fn().mockResolvedValue({ rows: [{ id: durableId }] }),
  } as never;
  const { witness } = await admittedLease();
  await expect(
    preflightBackgroundCommit(db, durableId, witness),
  ).resolves.toMatchObject({
    requestId: durableId,
    nativeLease: { id: nativeId },
  });
  expect(mockExecution.isActive).not.toHaveBeenCalledWith(durableId);
  await expect(
    preflightBackgroundCommit(db, 'foreign-sql-owner', witness),
  ).rejects.toThrow('request identity');
  mockExecution.isActive.mockResolvedValue(false);
  await expect(
    preflightBackgroundCommit(db, durableId, witness),
  ).rejects.toThrow('not acquired');
});

test('requires the same continued grant before and after protected storage, not the short lease', async () => {
  mockSettings.OROT_TEST_CONTINUED_GRANT = '1';
  mockExecution.backgroundContinuedGrant.mockResolvedValue('grant-a');
  mockExecution.signalContinuedBackgroundCommit.mockResolvedValue(true);
  const db = {
    execute: jest.fn().mockResolvedValue({ rows: [{ id: durableId }] }),
  } as never;
  const signal = new AbortController().signal;
  const { owner } = await admittedLease(signal);
  const before = await beforeBackgroundCommit(db, owner, signal);
  await afterBackgroundCommit(db, before);
  expect(mockExecution.signalContinuedBackgroundCommit).toHaveBeenCalledWith(
    nativeId,
    mockSettings.OROT_TEST_BACKGROUND_TOKEN,
    'grant-a',
  );
  expect(mockExecution.signalBackgroundCommit).not.toHaveBeenCalled();
  expect(mockExecution.signalBackgroundFailure).not.toHaveBeenCalled();
});

test.each(['grant-b', null])(
  'rejects lost or changed grant (%s) even if isActive is true',
  async afterGrant => {
    mockSettings.OROT_TEST_CONTINUED_GRANT = '1';
    mockExecution.backgroundContinuedGrant
      .mockResolvedValueOnce('grant-a')
      .mockResolvedValueOnce(afterGrant);
    const db = {
      execute: jest.fn().mockResolvedValue({ rows: [{ id: durableId }] }),
    } as never;
    const signal = new AbortController().signal;
    const { owner } = await admittedLease(signal);
    const before = await beforeBackgroundCommit(db, owner, signal);
    await afterBackgroundCommit(db, before);
    expect(
      mockExecution.signalContinuedBackgroundCommit,
    ).not.toHaveBeenCalled();
    expect(mockExecution.signalBackgroundCommit).not.toHaveBeenCalled();
    expect(mockExecution.signalBackgroundFailure).toHaveBeenCalled();
  },
);

test('does not release a continued sender on the old lease and stops waiting after background exit', async () => {
  mockSettings.OROT_TEST_CONTINUED_GRANT = '1';
  mockExecution.backgroundContinuedGrant.mockImplementation(async () => {
    mockState.currentState = 'active';
    return null;
  });
  const db = {
    execute: jest.fn().mockResolvedValue({ rows: [{ id: durableId }] }),
  } as never;
  const signal = new AbortController().signal;
  const { owner } = await admittedLease(signal);
  await expect(beforeBackgroundCommit(db, owner, signal)).rejects.toThrow(
    'Continued grant unavailable',
  );
  expect(mockExecution.signalBackgroundCommit).not.toHaveBeenCalled();
});

test('rejects a foreground visit during commit even if the same grant returns', async () => {
  mockSettings.OROT_TEST_CONTINUED_GRANT = '1';
  mockExecution.backgroundContinuedGrant.mockResolvedValue('grant-a');
  const db = {
    execute: jest.fn().mockResolvedValue({ rows: [{ id: durableId }] }),
  } as never;
  const signal = new AbortController().signal;
  const { owner } = await admittedLease(signal);
  const before = await beforeBackgroundCommit(db, owner, signal);
  await afterBackgroundCommit(db, before, () => false);
  expect(mockExecution.signalContinuedBackgroundCommit).not.toHaveBeenCalled();
  expect(mockExecution.signalBackgroundFailure).toHaveBeenCalled();
});

test.each(['abort', 'replacement'] as const)(
  'retires the exact fixture pair after %s before background success',
  async kind => {
    const controller = new AbortController();
    const { owner, witness } = await admittedLease(controller.signal);
    const execute = jest.fn().mockResolvedValue({ rows: [{ id: durableId }] });
    const db = { execute } as never;
    const before = await beforeBackgroundCommit(db, owner, controller.signal);
    if (kind === 'abort') controller.abort();
    else await witness.execution?.begin('replacement-opaque-attempt');
    await afterBackgroundCommit(db, before);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mockExecution.signalBackgroundCommit).not.toHaveBeenCalled();
    expect(mockExecution.signalBackgroundFailure).toHaveBeenCalled();
  },
);
