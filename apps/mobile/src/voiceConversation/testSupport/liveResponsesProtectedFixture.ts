import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
import {
  type createLiveResponsesHealthToolExecutor,
  type LiveManagedHealthCall,
} from '../liveResponsesHealthToolExecutor';

export const call: LiveManagedHealthCall = {
  callId: 'current-call',
  sessionId: 1,
  challengeId: 'challenge',
  toolCallId: 'tool-call',
  responseId: 'response',
  delegationId: 'delegation',
  name: 'orot_health_context',
  args: JSON.stringify({ topic: 'measurements', days: 7 }),
};

export async function fixture() {
  const db = openSqliteTestDatabase(':memory:');
  await runMigrations(db.database);
  const records = createRecordRepository(db.database);
  const measurement = healthObservation(
    'synthetic-health-id',
    'heart_rate',
    new Date(Date.now() - 86_400_000).toISOString(),
  );
  const observation = { ...measurement, ingestedAt: new Date().toISOString() };
  await records.put('health_observation', observation);
  for (const day of [2, 3]) {
    const row = healthObservation(
      'synthetic-health-id-' + day,
      'heart_rate',
      new Date(Date.now() - day * 86_400_000).toISOString(),
    );
    await records.put('health_observation', {
      ...row,
      ingestedAt: observation.ingestedAt,
    });
  }
  const read = jest.fn(createHealthContextReader(db.database));
  const controller = new AbortController();
  let active = call;
  let protectedData = true;
  let epoch = 'a'.repeat(64);
  const settle = jest.fn(
    async (_call: string, _challenge: string, _output: string | null) => true,
  );
  const input: Parameters<typeof createLiveResponsesHealthToolExecutor>[0] = {
    isChallengeCurrent: observed =>
      observed.callId === active.callId &&
      observed.sessionId === active.sessionId &&
      observed.challengeId === active.challengeId &&
      observed.toolCallId === active.toolCallId &&
      observed.responseId === active.responseId &&
      observed.delegationId === active.delegationId &&
      observed.name === active.name &&
      observed.args === active.args,
    resolveOwner: async () => {
      const capturedEpoch = epoch;
      return {
        grantID: 'b'.repeat(64) + '-model',
        generation: 'b'.repeat(64),
        backend: 'openai-live-responses',
        backendModel: 'gpt-6-sol',
        recipient: 'OpenAI Responses (Live)',
        resultKind: 'health_aggregate',
        credentialEpoch: capturedEpoch,
        current: () => epoch === capturedEpoch,
      };
    },
    protectedDataAvailable: async () => protectedData,
    protectedDataCurrent: () => protectedData,
    confirm: async () => true,
    authorizeResult: async () => () => true,
    openData: async () => ({ ...localData([]).data, readHealthContext: read }),
    settle,
  };
  return {
    input,
    controller,
    read,
    settle,
    close: db.close,
    setActive(next: LiveManagedHealthCall) {
      active = next;
    },
    lock() {
      protectedData = false;
    },
    rotate() {
      epoch = 'c'.repeat(64);
    },
    async edit() {
      await records.put('health_observation', {
        ...observation,
        value: { kind: 'quantity', amount: 145, unit: 'count/min' },
      });
    },
  };
}
