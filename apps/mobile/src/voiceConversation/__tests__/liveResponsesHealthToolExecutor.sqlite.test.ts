import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
import {
  createLiveResponsesHealthToolExecutor,
  type LiveManagedHealthCall,
} from '../liveResponsesHealthToolExecutor';

const call: LiveManagedHealthCall = {
  callId: 'current-call',
  sessionId: 1,
  challengeId: 'challenge',
  toolCallId: 'tool-call',
  responseId: 'response',
  delegationId: 'delegation',
  name: 'orot_health_context',
  args: JSON.stringify({ topic: 'measurements', days: 7 }),
};

async function fixture() {
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

test('confirmation precedes any SQLite read; one exact aggregate goes only to the same native challenge', async () => {
  const f = await fixture();
  try {
    let approvedOutput: string | undefined;
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      async confirm(authority) {
        expect(f.read).not.toHaveBeenCalled();
        expect(authority.scope).toEqual({ topic: 'measurements', days: 7 });
        expect(authority.owner.recipient).toBe('OpenAI Responses (Live)');
        return true;
      },
      async authorizeResult(authority, output) {
        expect(authority.call).toEqual(call);
        approvedOutput = output;
        return () => true;
      },
    });
    await execute(call, f.controller.signal);
    await execute(call, f.controller.signal);
    expect(f.settle).toHaveBeenCalledTimes(1);
    const output = f.settle.mock.calls[0]?.[2];
    expect(f.settle).toHaveBeenCalledWith(
      call.callId,
      call.challengeId,
      approvedOutput,
    );
    expect(output).not.toBeNull();
    expect(JSON.parse(output!)).toMatchObject({
      topic: 'measurements',
      days: 7,
    });
    expect(JSON.parse(output!)).toEqual({
      topic: 'measurements',
      metric: 'heart_rate',
      unit: 'count/min',
      days: 7,
      sampleCount: 3,
      meanOfRecordedDailyMeans: 72,
    });
    expect(output).not.toContain('synthetic-health-id');
    expect(f.read.mock.calls.length).toBeGreaterThan(1);
  } finally {
    f.close();
  }
});

test.each([
  'denied',
  'locked',
  'rotated',
  'source changed',
  'result revoked',
  'stopped',
  'replaced',
] as const)('%s cannot return any private output', async scenario => {
  const f = await fixture();
  try {
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      confirm: async () => scenario !== 'denied',
      async authorizeResult() {
        if (scenario === 'locked') f.lock();
        if (scenario === 'rotated') f.rotate();
        if (scenario === 'source changed') await f.edit();
        if (scenario === 'stopped') f.controller.abort();
        if (scenario === 'replaced')
          f.setActive({ ...call, delegationId: 'replacement' });
        return () => scenario !== 'result revoked';
      },
    });
    await execute(call, f.controller.signal);
    if (scenario !== 'stopped' && scenario !== 'replaced')
      expect(f.settle).toHaveBeenCalledWith(
        call.callId,
        call.challengeId,
        null,
      );
    expect(f.settle.mock.calls.every(([, , output]) => output === null)).toBe(
      true,
    );
    if (scenario === 'denied') expect(f.read).not.toHaveBeenCalled();
    else expect(f.read).toHaveBeenCalled();
    if (scenario === 'replaced' || scenario === 'stopped')
      expect(f.settle).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test.each([
  { topic: 'measurements', days: 0 },
  { topic: 'measurements', days: 32 },
  { topic: 'measurements', days: 7, detail: 'daily' },
  { topic: 'documents', days: 7 },
  { topic: 'symptoms', days: 7 },
  { topic: 'medications', days: 7 },
  { topic: 'measurements', days: 2 },
])('rejects unsupported scopes before local reads (%p)', async args => {
  const f = await fixture();
  try {
    const invalid = { ...call, args: JSON.stringify(args) };
    f.setActive(invalid);
    const confirm = jest.fn(async () => true);
    await createLiveResponsesHealthToolExecutor({ ...f.input, confirm })(
      invalid,
      f.controller.signal,
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.settle).toHaveBeenCalledWith(call.callId, call.challengeId, null);
  } finally {
    f.close();
  }
});

test('a reviewed-memory only Settings receipt cannot authorize health data', async () => {
  const f = await fixture();
  try {
    const confirm = jest.fn(async () => true);
    await createLiveResponsesHealthToolExecutor({
      ...f.input,
      confirm,
      async resolveOwner(event) {
        const saved = await f.input.resolveOwner(event);
        return {
          ...saved!,
          resultKind: 'reviewed-memory',
        } as unknown as NonNullable<typeof saved>;
      },
    })(call, f.controller.signal);
    expect(confirm).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.settle).toHaveBeenCalledWith(call.callId, call.challengeId, null);
  } finally {
    f.close();
  }
});
