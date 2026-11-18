import { fixture } from '../testSupport/dailyRecoveryOwnerFixture';
import { readDailyReportRecoveryOwner } from '../dailyReportRecoveryOwner';

test('scope replacement A to B to A permanently invalidates an issued owner, while a new explicit owner is allowed', async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    const original = f.scope.current();
    const owner = await readDailyReportRecoveryOwner(
      f.candidate,
      controller.signal,
      f.scope,
    );
    expect(owner?.isCurrent()).toBe(true);
    f.changeTarget({ ...original, ownerId: 'different-request' });
    f.changeTarget(original);
    expect(owner?.isCurrent()).toBe(false);
    const fresh = await readDailyReportRecoveryOwner(
      f.candidate,
      controller.signal,
      f.scope,
    );
    expect(fresh?.isCurrent()).toBe(true);
    const disposed = jest.fn();
    const stop = fresh!.subscribeInvalidation(disposed);
    fresh?.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    stop();
    expect(fresh?.isCurrent()).toBe(false);
    expect(f.subscriberCount()).toBe(0);
  } finally {
    controller.abort();
    f.db.close();
  }
});

test('scope A to B to A during asynchronous grant read cannot publish the original owner', async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    const original = f.scope.current();
    const read = f.grants.read.bind(f.grants);
    jest.spyOn(f.grants, 'read').mockImplementation(async (...args) => {
      const result = await read(...args);
      f.changeTarget({ ...original, ownerId: 'different-request' });
      await Promise.resolve();
      f.changeTarget(original);
      return result;
    });
    expect(
      await readDailyReportRecoveryOwner(
        f.candidate,
        controller.signal,
        f.scope,
      ),
    ).toBeNull();
  } finally {
    controller.abort();
    f.db.close();
  }
});

test('observed mismatch is terminal even without a notification, and failed reads release subscriptions', async () => {
  const f = await fixture();
  const controller = new AbortController();
  try {
    const original = f.scope.current();
    const owner = await readDailyReportRecoveryOwner(
      f.candidate,
      controller.signal,
      f.scope,
    );
    expect(f.subscriberCount()).toBe(1);
    const current = jest
      .spyOn(f.scope, 'current')
      .mockReturnValueOnce({ ...original, ownerId: 'different' });
    expect(owner?.isCurrent()).toBe(false);
    current.mockRestore();
    expect(owner?.isCurrent()).toBe(false);
    expect(f.subscriberCount()).toBe(0);
    jest
      .spyOn(f.grants, 'read')
      .mockRejectedValueOnce(new Error('SQL unavailable'));
    expect(
      await readDailyReportRecoveryOwner(
        f.candidate,
        controller.signal,
        f.scope,
      ),
    ).toBeNull();
    expect(f.subscriberCount()).toBe(0);
  } finally {
    controller.abort();
    f.db.close();
  }
});
