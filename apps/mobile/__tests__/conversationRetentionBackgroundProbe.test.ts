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
import { AppState, NativeModules } from 'react-native';
const mockState = AppState as { currentState: string };
const mockSettings = NativeModules.SettingsManager.settings;
const mockExecution = NativeModules.ConversationExecutionModule;

beforeEach(() => {
  jest.resetAllMocks();
  delete mockSettings.OROT_TEST_CONTINUED_GRANT;
  mockState.currentState = 'background';
  mockExecution.isActive.mockResolvedValue(true);
  mockExecution.signalBackgroundCommit.mockResolvedValue(true);
});

test('signals success only after the same request remains leased through background commit', async () => {
  const execute = jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: 'request' }] })
    .mockResolvedValue({ rows: [] });
  const db = { execute } as never;
  const before = await beforeBackgroundCommit(db);
  await afterBackgroundCommit(db, before);
  expect(execute).toHaveBeenLastCalledWith(
    expect.stringContaining(
      'INSERT INTO conversation_retention_probe_background',
    ),
    ['request', 'background', 'background', 1, 1],
  );
  expect(mockExecution.signalBackgroundCommit).toHaveBeenCalledWith(
    'request',
    '12345678-1234-4234-8234-123456789abc',
  );
  expect(mockExecution.signalBackgroundFailure).not.toHaveBeenCalled();
});

test('foreground resumption after the commit cannot report a background success', async () => {
  const execute = jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: 'request' }] })
    .mockResolvedValue({ rows: [] });
  const db = { execute } as never;
  const before = await beforeBackgroundCommit(db);
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
    execute: jest.fn().mockResolvedValue({ rows: [{ id: 'request' }] }),
  } as never;
  await expect(preflightBackgroundCommit(db)).resolves.toBeUndefined();
  mockExecution.isActive.mockResolvedValue(false);
  await expect(preflightBackgroundCommit(db)).rejects.toThrow(
    'lease unavailable',
  );
});

test('requires the same continued grant before and after protected storage, not the short lease', async () => {
  mockSettings.OROT_TEST_CONTINUED_GRANT = '1';
  mockExecution.backgroundContinuedGrant.mockResolvedValue('grant-a');
  mockExecution.signalContinuedBackgroundCommit.mockResolvedValue(true);
  const db = {
    execute: jest.fn().mockResolvedValue({ rows: [{ id: 'request' }] }),
  } as never;
  const before = await beforeBackgroundCommit(db, new AbortController().signal);
  await afterBackgroundCommit(db, before);
  expect(mockExecution.signalContinuedBackgroundCommit).toHaveBeenCalledWith(
    'request',
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
      execute: jest.fn().mockResolvedValue({ rows: [{ id: 'request' }] }),
    } as never;
    const before = await beforeBackgroundCommit(
      db,
      new AbortController().signal,
    );
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
    execute: jest.fn().mockResolvedValue({ rows: [{ id: 'request' }] }),
  } as never;
  await expect(
    beforeBackgroundCommit(db, new AbortController().signal),
  ).rejects.toThrow('Continued grant unavailable');
  expect(mockExecution.signalBackgroundCommit).not.toHaveBeenCalled();
});

test('rejects a foreground visit during commit even if the same grant returns', async () => {
  mockSettings.OROT_TEST_CONTINUED_GRANT = '1';
  mockExecution.backgroundContinuedGrant.mockResolvedValue('grant-a');
  const db = {
    execute: jest.fn().mockResolvedValue({ rows: [{ id: 'request' }] }),
  } as never;
  const before = await beforeBackgroundCommit(db, new AbortController().signal);
  await afterBackgroundCommit(db, before, () => false);
  expect(mockExecution.signalContinuedBackgroundCommit).not.toHaveBeenCalled();
  expect(mockExecution.signalBackgroundFailure).toHaveBeenCalled();
});
