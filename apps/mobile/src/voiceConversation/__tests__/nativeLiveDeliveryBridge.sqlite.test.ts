import { NativeModules, Platform } from 'react-native';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLiveHealthProofLease } from '../../healthEvidence/healthContext/liveHealthProofLease';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { nativeLiveManagedTools } from '../nativeLiveManagedTools';

const call = {
  callId: 'call',
  sessionId: 'session',
  challengeId: 'challenge',
  toolCallId: 'tool',
  responseId: 'response',
  delegationId: 'delegation',
  name: 'orot_health_context',
  args: '{}',
} as const;

test('native bridge claim is exact and protected mutations retire it before source dispatch', async () => {
  const original = NativeModules.VoiceRealtimeModule;
  const os = Platform.OS;
  const lane = openSqliteTestDatabase(':memory:');
  const native = {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    settleLiveResponsesToolCall: jest.fn(),
    revokeLiveResponsesGrant: jest.fn(),
    claimLiveResponsesResult: jest.fn(() => true),
    retireLiveResponsesResult: jest.fn(() => true),
  };
  try {
    Platform.OS = 'ios';
    NativeModules.VoiceRealtimeModule = native;
    const owner = guardedNativeDatabase(lane.database);
    await owner.execute('CREATE TABLE synthetic (n INTEGER)');
    const borrow = createLiveHealthProofLease(owner, db => db === owner);
    const proof = borrow()!;
    const signal = new AbortController().signal;
    const transport = nativeLiveManagedTools()!;
    const release = transport.holdDelivery(call, proof.beforeDispatch, signal);
    expect(release).toBeDefined();
    expect(native.claimLiveResponsesResult).toHaveBeenCalledWith(
      'call',
      'challenge',
    );
    const mutation = owner.execute('INSERT INTO synthetic VALUES (1)');
    expect(native.retireLiveResponsesResult).toHaveBeenCalledWith(
      'call',
      'challenge',
    );
    expect(proof.current()).toBe(false);
    expect(native.settleLiveResponsesToolCall).not.toHaveBeenCalled();
    await mutation;
    release?.();
    expect(borrow()?.current()).toBe(true);

    // An older bridge must never reuse its asynchronous approval for last-hop ownership.
    NativeModules.VoiceRealtimeModule = {
      ...native,
      claimLiveResponsesResult: undefined,
    };
    expect(nativeLiveManagedTools()).toBeNull();
  } finally {
    lane.close();
    NativeModules.VoiceRealtimeModule = original;
    Platform.OS = os;
  }
});
