import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { openAiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import {
  isCurrentLocalAgentMemoryDatabase,
  openLocalAgentMemoryDatabase,
} from '../../storage/secureDatabase';
import { stageLiveResponsesResults } from '../stageLiveResponsesResult';
import { createLiveResponsesHealthToolExecutor } from '../liveResponsesHealthToolExecutor';
import { call, fixture } from '../testSupport/liveResponsesProtectedFixture';

test.each([
  'unchanged',
  'edited',
  'stopped',
  'revoked',
  'replaced',
  'storage owner lost',
] as const)(
  'a held final protected proof for %s result settles only the originally approved current bytes',
  async mode => {
    const f = await fixture();
    try {
      let release!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      let entered!: () => void;
      const checking = new Promise<void>(resolve => {
        entered = resolve;
      });
      const original = f.read.getMockImplementation()!;
      let approved: string | undefined;
      let authorized = true;
      const confirm = jest.fn(async () => true);
      const authorizeResult = jest.fn(async (_authority, output: string) => {
        approved = output;
        f.read.mockImplementationOnce(async (...args) => {
          entered();
          await held;
          return original(...args);
        });
        return () => authorized;
      });
      const execute = createLiveResponsesHealthToolExecutor({
        ...f.input,
        confirm,
        authorizeResult,
      });
      const running = execute(call, f.controller.signal);
      await checking;
      expect(f.settle).not.toHaveBeenCalled();
      await execute(call, f.controller.signal);
      if (mode === 'edited') await f.edit();
      if (mode === 'stopped') f.controller.abort();
      if (mode === 'revoked') authorized = false;
      if (mode === 'storage owner lost') f.revokeDbOwner();
      if (mode === 'replaced')
        f.setActive({ ...call, challengeId: 'replacement' });
      release();
      await running;
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(authorizeResult).toHaveBeenCalledTimes(1);
      if (mode === 'unchanged')
        expect(f.settle.mock.calls).toEqual([
          [call.callId, call.challengeId, approved],
        ]);
      else
        expect(
          f.settle.mock.calls.every(([, , output]) => output === null),
        ).toBe(true);
    } finally {
      f.close();
    }
  },
);

test('staging sends nothing and two admission contenders cannot replay the approved result', async () => {
  let release!: (stillCurrent: boolean) => void;
  const source = new Promise<boolean>(resolve => {
    release = resolve;
  });
  const reproveSource = jest.fn(() => source);
  const handoff = jest.fn(async (_approved: readonly unknown[]) => undefined);
  const staged = stageLiveResponsesResults({
    signal: new AbortController().signal,
    proof: { current: () => true, dispose: () => {} },
    results: [
      {
        id: 'first',
        output: 'synthetic-approved-bytes',
        current: () => true,
        reproveSource,
      },
    ],
  });
  expect(handoff).not.toHaveBeenCalled();
  const admitting = staged.admit(handoff);
  await staged.admit(handoff);
  expect(reproveSource).toHaveBeenCalledTimes(1);
  expect(handoff).not.toHaveBeenCalled();
  release(true);
  await admitting;
  await staged.admit(handoff);
  expect(handoff.mock.calls).toEqual([
    [[{ id: 'first', output: 'synthetic-approved-bytes' }]],
  ]);
});

test('only a guarded proof can admit the local outcome, even with exact consent', async () => {
  const f = await fixture();
  try {
    let readsAtApproval = 0;
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      async authorizeResult() {
        readsAtApproval = f.read.mock.calls.length;
        return () => true;
      },
      async openData() {
        return {
          ...(await f.input.openData()),
          borrowLiveHealthProof: undefined,
        };
      },
    });
    await execute(call, f.controller.signal);
    expect(readsAtApproval).toBeGreaterThan(0);
    expect(f.read).toHaveBeenCalledTimes(readsAtApproval);
    expect(f.settle.mock.calls).toEqual([
      [call.callId, call.challengeId, null],
    ]);
  } finally {
    f.close();
  }
});

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  isCurrentLocalAgentMemoryDatabase: jest.fn(),
}));

test('real app local-data root lends only current guarded reads and never a database handle', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    const database = guardedNativeDatabase(f.database);
    let currentOwner = true;
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
    jest
      .mocked(isCurrentLocalAgentMemoryDatabase)
      .mockImplementation(candidate => candidate === database && currentOwner);
    await database.execute('CREATE TABLE synthetic_read_epoch (n INTEGER)');
    const local = await openAiFeatureLocalData();
    const lease = local.borrowLiveHealthProof?.();
    expect(lease?.current()).toBe(true);
    expect(Object.keys(lease!)).toEqual([
      'current',
      'beforeDispatch',
      'dispose',
    ]);
    await database.execute('SELECT n FROM synthetic_read_epoch');
    expect(lease?.current()).toBe(true);
    await database.execute('INSERT INTO synthetic_read_epoch VALUES (1)');
    expect(lease?.current()).toBe(false);
    const fresh = local.borrowLiveHealthProof?.();
    expect(fresh?.current()).toBe(true);
    currentOwner = false;
    expect(fresh?.current()).toBe(false);
    currentOwner = true;
    expect(fresh?.current()).toBe(false);
    expect(lease?.current()).toBe(false);
    expect(local.borrowLiveHealthProof?.()?.current()).toBe(true);
  } finally {
    f.close();
  }
});

test('holds the protected retirement through queued native settlement and never resends', async () => {
  const f = await fixture();
  try {
    let entered!: () => void;
    const queued = new Promise<void>(resolve => {
      entered = resolve;
    });
    let acknowledge!: (delivered: boolean) => void;
    const nativeSettlement = new Promise<boolean>(resolve => {
      acknowledge = resolve;
    });
    const settle = jest.fn(() => {
      entered();
      return nativeSettlement;
    });
    const retire = jest.fn();
    const release = jest.fn();
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      holdDelivery: (_call, beforeDispatch) => {
        const unregister = beforeDispatch(retire);
        if (!unregister) return;
        return () => {
          release();
          unregister();
        };
      },
      settle,
    });
    const running = execute(call, f.controller.signal);
    await queued;
    expect(settle).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    await f.edit();
    expect(retire).toHaveBeenCalledTimes(1);
    acknowledge(false);
    await running;
    expect(release).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});
