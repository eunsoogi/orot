import { runNativeCacheOwnerOperation } from '../nativeCacheOwnerOperation';

jest.mock('@op-engineering/op-sqlite', () => ({ isSQLCipher: () => true }));
jest.mock('react-native', () => ({
  TurboModuleRegistry: { getEnforcing: jest.fn() },
}));
jest.mock('../../src/storage/conversationPeriodRemoval', () => ({
  assertPeriodNotRemoved: async (executor: {
    execute(sql: string): Promise<unknown>;
  }) => {
    for (let index = 0; index < 4; index++)
      await executor.execute(`static-${index}`);
  },
}));

// Scripted protocol tests only. Native owner, SQLCipher and trace evidence require
// the separate registered XCTest; these mocks cannot satisfy that acceptance.
function fixture() {
  let armed = false;
  let reject: ((error: Error) => void) | undefined;
  const snapshot = {
    cachedStatements: 1,
    maximumRuns: 2,
    ownerClosed: false,
    stepEntered: true,
    interruptObserved: true,
    timedOut: false,
    closeSeen: false,
    closeStatements: -1,
    closeBusy: -1,
  };
  return {
    state: snapshot,
    execute: jest.fn(async () => {
      if (!armed) return {};
      armed = false;
      return new Promise((_resolve, failure) => {
        reject = failure;
      });
    }),
    arm: jest.fn(async () => {
      armed = true;
      return true;
    }),
    interrupt: jest.fn(() =>
      reject!(new Error('statement execution error: interrupted')),
    ),
    invalidate: jest.fn(() => {
      snapshot.ownerClosed = true;
      snapshot.cachedStatements = 0;
      snapshot.closeSeen = true;
      snapshot.closeStatements = 0;
      snapshot.closeBusy = 0;
      reject!(new Error('statement execution error: interrupted'));
    }),
    snapshot: jest.fn(() => ({ ...snapshot })),
    verifyReopen: jest.fn(() => true),
    dispose: jest.fn(() => true),
  };
}
const host = globalThis as typeof globalThis & {
  __orotCreateNativeCacheFixture?: () => unknown;
};
afterEach(() => {
  delete host.__orotCreateNativeCacheFixture;
});

test('protocol requires both interrupted outcomes, recovery, real-close counters and cleanup', async () => {
  const probe = fixture();
  host.__orotCreateNativeCacheFixture = () => probe;
  const result = await runNativeCacheOwnerOperation();
  expect(result.ownerInvalidationObserved).toBe(true);
  expect(result.reopenedAfterInvalidation).toBe(true);
  expect(probe.execute).toHaveBeenCalledTimes(5);
  expect(probe.interrupt).toHaveBeenCalledTimes(1);
  expect(probe.invalidate).toHaveBeenCalledTimes(1);
  expect(probe.dispose).toHaveBeenCalledTimes(1);
});

test.each([
  ['maximumRuns', 1, 'reuse unobserved'],
  ['timedOut', true, 'trace deadline'],
])(
  'rejects insufficient %s evidence and still disposes',
  async (field, value, message) => {
    const probe = fixture();
    Object.assign(probe.state, { [field]: value });
    host.__orotCreateNativeCacheFixture = () => probe;
    await expect(runNativeCacheOwnerOperation()).rejects.toThrow(message);
    expect(probe.dispose).toHaveBeenCalledTimes(1);
  },
);

test('normal early completion is failure rather than cancellation evidence', async () => {
  const probe = fixture();
  probe.arm.mockImplementation(() => new Promise(() => {}));
  host.__orotCreateNativeCacheFixture = () => probe;
  await expect(runNativeCacheOwnerOperation()).rejects.toThrow(
    'completed before',
  );
  expect(probe.invalidate).not.toHaveBeenCalled();
  expect(probe.dispose).toHaveBeenCalledTimes(1);
});

test('cleanup failure cannot overwrite the original missing-reuse failure', async () => {
  const probe = fixture();
  probe.state.maximumRuns = 0;
  probe.dispose.mockImplementation(() => {
    throw new Error('cleanup failure');
  });
  host.__orotCreateNativeCacheFixture = () => probe;
  await expect(runNativeCacheOwnerOperation()).rejects.toThrow(
    'reuse unobserved',
  );
});

test('successful execution still fails if owned-file cleanup cannot be verified', async () => {
  const probe = fixture();
  probe.dispose.mockReturnValue(false);
  host.__orotCreateNativeCacheFixture = () => probe;
  await expect(runNativeCacheOwnerOperation()).rejects.toThrow(
    'cleanup failed',
  );
});
