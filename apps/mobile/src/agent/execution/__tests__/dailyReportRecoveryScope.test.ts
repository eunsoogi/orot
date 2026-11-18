import { fixture } from '../testSupport/dailyRecoveryOwnerFixture';
import { readDailyReportRecoveryOwner } from '../dailyReportRecoveryOwner';
import { createDailyReportLocalRecovery } from '../../../storage/dailyReportLocalRecovery';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';

// The host owns a separate request selection. Pending prose cannot select its own scope.
test.each(['new day', 'different cutoff', 'different session'] as const)(
  '%s invalidates a real owner and cannot recreate authority from an old candidate',
  async change => {
    const f = await fixture();
    const signal = new AbortController().signal;
    const storage = createDailyReportLocalRecovery(f.db.database);
    try {
      const owner = await readDailyReportRecoveryOwner(
        f.candidate,
        signal,
        f.scope,
      );
      expect(owner).not.toBeNull();
      expect(await storage.stage(f.candidate, owner!, signal)).toEqual({
        status: 'staged',
      });
      const listener = jest.fn();
      const stop = owner!.subscribeInvalidation(listener);
      const next = createDailyReportCalendarWindow({
        localDate: change === 'new day' ? '2035-01-02' : '2035-01-01',
        timeZone: 'UTC',
        requestedAt:
          change === 'new day'
            ? '2035-01-02T00:01:00Z'
            : change === 'different cutoff'
              ? '2035-01-01T13:00:00Z'
              : '2035-01-01T12:00:00Z',
      });
      if (next.status !== 'ready') throw new Error('Invalid fixture');
      f.changeTarget({
        ownerId: 'new-request',
        runId: f.candidate.runId,
        window: next.context,
      });
      if (change === 'different session') {
        const replacement = await readDailyReportRecoveryOwner(
          f.candidate,
          signal,
          f.scope,
        );
        expect(replacement).not.toBeNull();
        expect(replacement!.identity.authorizationRevision).not.toBe(
          owner!.identity.authorizationRevision,
        );
        expect(
          await storage.resume(f.candidate.runId, replacement!, signal),
        ).toEqual({ status: 'unavailable' });
      }
      expect(owner!.isCurrent()).toBe(false);
      expect(listener).toHaveBeenCalled();
      expect(await storage.resume(f.candidate.runId, owner!, signal)).toEqual({
        status: 'unavailable',
      });
      const recreated = await readDailyReportRecoveryOwner(
        f.candidate,
        signal,
        f.scope,
      );
      if (change !== 'different session') expect(recreated).toBeNull();
      // Same exact scope under a new explicit owner cannot resurrect the cancelled run.
      if (recreated)
        expect(await storage.stage(f.candidate, recreated, signal)).toEqual({
          status: 'unavailable',
        });
      stop();
    } finally {
      f.db.close();
    }
  },
);

test('a frozen explicit request remains its own scope across midnight; a new today request does not', async () => {
  const f = await fixture();
  const now = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2035-01-02T00:01:00Z'));
  try {
    const owner = await readDailyReportRecoveryOwner(
      f.candidate,
      new AbortController().signal,
      f.scope,
    );
    expect(owner?.isCurrent()).toBe(true);
    f.changeTarget({ ...f.scope.current(), ownerId: 'replacement-session' });
    expect(owner?.isCurrent()).toBe(false);
  } finally {
    now.mockRestore();
    f.db.close();
  }
});

test('request replacement during grant read prevents witness publication', async () => {
  const f = await fixture();
  try {
    const original = f.grants.read.bind(f.grants);
    jest.spyOn(f.grants, 'read').mockImplementation(async (...args) => {
      const grant = await original(...args);
      f.changeTarget({ ...f.scope.current(), ownerId: 'replaced-during-read' });
      return grant;
    });
    expect(
      await readDailyReportRecoveryOwner(
        f.candidate,
        new AbortController().signal,
        f.scope,
      ),
    ).toBeNull();
  } finally {
    f.db.close();
  }
});

test('explicit request constructor binds original producer run and denies new-today resume', async () => {
  const f = await fixture();
  const { createDailyReportRecoveryRequestScope } =
    require('../../../aiFeatures/integration/dailyReportRecoveryRequestScope') as typeof import('../../../aiFeatures/integration/dailyReportRecoveryRequestScope');
  const { createDailyReportIdentity } =
    require('@orot/domain') as typeof import('@orot/domain');
  const signal = new AbortController().signal;
  let today = '2035-01-01';
  let runId = 'synthetic-recovery-run';
  const scope = createDailyReportRecoveryRequestScope({
    activeRequest: () => ({
      runId,
      phase: 'explicit_resume',
      request: {
        localDate: '2035-01-01',
        timeZone: 'UTC',
        requestedAt: '2035-01-01T12:00:00Z',
      },
    }),
    currentIdentity: () => createDailyReportIdentity(today, 'UTC'),
    subscribeChanges: () => () => {},
    signal,
  });
  try {
    const owner = await readDailyReportRecoveryOwner(
      f.candidate,
      signal,
      scope,
    );
    expect(owner).not.toBeNull();
    const storage = createDailyReportLocalRecovery(f.db.database);
    expect(await storage.stage(f.candidate, owner!, signal)).toEqual({
      status: 'staged',
    });
    runId = 'a-new-run';
    expect(
      await readDailyReportRecoveryOwner(f.candidate, signal, scope),
    ).toBeNull();
    runId = 'synthetic-recovery-run';
    today = '2035-01-02';
    expect(
      await readDailyReportRecoveryOwner(f.candidate, signal, scope),
    ).toBeNull();
    expect(await storage.resume(runId, owner!, signal)).toEqual({
      status: 'unavailable',
    });
  } finally {
    f.db.close();
  }
});
