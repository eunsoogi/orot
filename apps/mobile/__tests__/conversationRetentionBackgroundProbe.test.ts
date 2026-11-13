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
const mockExecution = NativeModules.ConversationExecutionModule;

beforeEach(() => {
  jest.clearAllMocks();
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
