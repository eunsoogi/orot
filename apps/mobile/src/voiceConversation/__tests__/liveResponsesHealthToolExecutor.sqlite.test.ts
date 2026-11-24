import { createLiveResponsesHealthToolExecutor } from '../liveResponsesHealthToolExecutor';
import { call, fixture } from '../testSupport/liveResponsesProtectedFixture';

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
