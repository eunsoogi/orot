import { waitFor } from '@testing-library/react-native';
import {
  AppState,
  DeviceEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { promptlessLiveAggregateRun } from '../promptlessLiveAggregateRun';

const mockSettings = jest.fn(),
  mockOpen = jest.fn();
const mockEpoch = 'a'.repeat(64),
  generation = 'b'.repeat(64);
jest.mock('../../voiceSettings/liveVoicePreferencesKeychain', () => ({
  loadLiveCallSettings: async () => ({
    credentialEpoch: mockEpoch,
    apiKey: 'synthetic-key',
  }),
}));
jest.mock('../../voiceSettings/liveResponsesSettings', () => ({
  loadLiveResponsesSettings: (...args: unknown[]) => mockSettings(...args),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: () => mockOpen(),
  isCurrentLocalAgentMemoryDatabase: () => true,
}));

const receipt = {
  kind: 'active',
  aggregatePolicy: 'headless-v2',
  credentialEpoch: mockEpoch,
  nativeGrant: {
    backendModel: 'gpt-6-sol',
    generation,
    grantID: generation + '-model',
    scope: 'selected-live-heart-rate-aggregate-v2',
  },
  current: () => true,
  subscribe: () => () => {},
};
const call = {
  name: 'orot_health_context',
  callId: 'owned-call',
  toolCallId: 'owned-function',
  responseId: 'owned-response',
  delegationId: 'owned-delegation',
  sessionId: 'owned-session',
  challengeId: 'owned-challenge',
  args: '{"topic":"measurements","days":7}',
};
function harness() {
  const original = {
    voice: NativeModules.VoiceRealtimeModule,
    execution: NativeModules.ConversationExecutionModule,
    phase: AppState.currentState,
    os: Object.getOwnPropertyDescriptor(Platform, 'OS')!,
  };
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  AppState.currentState = 'active';
  const hook = { addListener: jest.fn(), removeListeners: jest.fn() };
  const settle = jest.fn(
    async (_call: string, _challenge: string, _result: string | null) => true,
  );
  const protectedDataAvailable = jest.fn(async () => true);
  const reviewCanonicalLiveCall = jest.fn(),
    claimLiveResponsesResult = jest.fn(() => true);
  NativeModules.VoiceRealtimeModule = {
    ...hook,
    supportsLiveAggregateHeadlessV2: true,
    claimLiveResponsesResult,
    reviewCanonicalLiveCall,
    retireLiveResponsesResult: jest.fn(() => true),
    settleLiveResponsesToolCall: settle,
    revokeLiveResponsesGrant: jest.fn(async () => {}),
  };
  NativeModules.ConversationExecutionModule = {
    ...hook,
    protectedDataAvailable,
  };
  return {
    settle,
    reviewCanonicalLiveCall,
    claimLiveResponsesResult,
    protectedDataAvailable,
    close() {
      NativeModules.VoiceRealtimeModule = original.voice;
      NativeModules.ConversationExecutionModule = original.execution;
      Object.defineProperty(Platform, 'OS', original.os);
      AppState.currentState = original.phase;
    },
  };
}
function hold<T>() {
  let release!: (value: T) => void;
  const value = new Promise<T>(finish => {
    release = finish;
  });
  return { value, release };
}

test.each([
  'allowed',
  'not current at request',
  'replaced during proof',
  'old v1',
  'protection unavailable at startup',
] as const)(
  'actual scoped Live run with cold SQLite and fake native socket boundary: %s',
  async mode => {
    const f = harness();
    jest.clearAllMocks();
    const raw = openSqliteTestDatabase(':memory:');
    const db = guardedNativeDatabase(raw.database);
    mockOpen.mockResolvedValue(db);
    const run = promptlessLiveAggregateRun(() => true, jest.fn());
    try {
      await runMigrations(db);
      const records = createRecordRepository(db);
      for (const [idx, amount] of [62, 72, 82].entries()) {
        const date = new Date(
          Date.now() - (idx + 1) * 86_400_000,
        ).toISOString();
        await records.put('health_observation', {
          ...healthObservation('synthetic-' + idx, 'heart_rate', date),
          ingestedAt: date,
          value: { kind: 'quantity', amount, unit: 'count/min' },
        });
      }
      mockSettings.mockResolvedValue(receipt);
      if (mode === 'old v1')
        mockSettings.mockResolvedValueOnce({
          ...receipt,
          aggregatePolicy: undefined,
        });
      if (mode === 'protection unavailable at startup')
        f.protectedDataAvailable.mockResolvedValueOnce(false);
      expect(await run.credentials(call.callId)).toHaveProperty(
        'apiKey',
        'synthetic-key',
      );
      if (mode === 'old v1' || mode === 'protection unavailable at startup') {
        expect(run.nativeGrant(call.callId)).toBeNull();
      } else {
        expect(run.nativeGrant(call.callId)).toEqual(receipt.nativeGrant);
      }
      const held = hold<unknown>();
      const entered = hold<undefined>();
      if (mode === 'not current at request')
        mockSettings.mockResolvedValueOnce({ kind: 'unavailable' });
      if (mode === 'replaced during proof')
        mockSettings.mockImplementationOnce(() => {
          entered.release(undefined);
          return held.value;
        });
      const emit = () =>
        DeviceEventEmitter.emit('VoiceRealtimeManagedToolCall', call);
      emit();
      if (mode === 'replaced during proof') {
        await entered.value;
        run.retire();
        await run.credentials('replacement-call');
        held.release(receipt);
        await held.value;
        await Promise.resolve();
        expect(run.nativeGrant('replacement-call')).toEqual(
          receipt.nativeGrant,
        );
        expect(f.settle).not.toHaveBeenCalled();
      }
      if (mode === 'allowed' || mode === 'not current at request') {
        await waitFor(() => expect(f.settle).toHaveBeenCalledTimes(1));
        emit();
        expect(f.settle).toHaveBeenCalledTimes(1);
        const [id, challenge, output] = f.settle.mock.calls[0]!;
        expect([id, challenge]).toEqual([call.callId, call.challengeId]);
        if (mode === 'allowed') {
          expect(JSON.parse(output!)).toEqual({
            topic: 'measurements',
            metric: 'heart_rate',
            unit: 'count/min',
            days: 7,
            sampleCount: 3,
            meanOfRecordedDailyMeans: 72,
          });
          expect(f.claimLiveResponsesResult).toHaveBeenCalledWith(
            id,
            challenge,
          );
          expect(mockOpen).toHaveBeenCalledTimes(1);
        } else expect(output).toBeNull();
      } else expect(f.settle).not.toHaveBeenCalled();
      if (mode !== 'allowed') {
        expect(mockOpen).not.toHaveBeenCalled();
        expect(f.claimLiveResponsesResult).not.toHaveBeenCalled();
      }
      expect(f.reviewCanonicalLiveCall).not.toHaveBeenCalled();
    } finally {
      run.dispose();
      f.close();
      raw.close();
    }
  },
);
