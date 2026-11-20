import {
  candidate,
  competing,
  previous,
  runAtomicSaveRace,
} from '../testSupport/dailyReportAtomicSaveFixture';

test.each([
  ['equivalent', 2, 2, candidate],
  ['included edit', 1, 1, null],
  ['unrelated deletion', 1, 1, null],
  ['repeated drift', 2, 2, previous],
  ['competing head', 1, 1, competing],
  ['stop', 2, 1, null, 'cancelled'],
  ['read error', 2, 1, null],
  ['remote', 1, 1, null],
  ['refused', 0, 0, null, 'consent_required'],
  ['unchanged calendar', 2, 2, candidate],
  ['calendar drift', 2, 1, null],
  ['head during reproof', 2, 2, competing],
  ['edit during reproof', 2, 2, null],
  ['delete during reproof', 2, 2, null],
  ['second save error', 2, 2, null, 'persistence_failed'],
  ['selection during reproof', 2, 1, null],
  ['selection during save', 2, 2, null, 'cancelled'],
  ['selection after commit', 2, 2, candidate, 'cancelled'],
  ['stop after commit', 2, 2, candidate, 'cancelled'],
  ['no selection witness', 1, 1, null],
] as const)(
  'final atomic report proof: %s',
  async (
    scenario,
    expectedReads,
    expectedAttempts,
    expectedHead,
    failureCode?: string,
  ) => {
    const attempt = await runAtomicSaveRace(scenario);
    const success = expectedHead === candidate;
    expect(attempt.outcome).toMatchObject(
      success && !failureCode
        ? { status: 'completed' }
        : {
            status: 'failed',
            code: failureCode ?? 'source_unconfirmed_after_dispatch',
          },
    );
    expect(attempt.dispatched).toHaveBeenCalledTimes(
      scenario === 'refused' ? 0 : 1,
    );
    expect(attempt.auth).toHaveBeenCalledTimes(
      scenario === 'refused' || scenario === 'remote' ? 1 : 0,
    );
    expect(attempt.reads).toBe(expectedReads);
    expect(attempt.saveAttempts).toBe(expectedAttempts);
    expect(attempt.writes).toBe(
      Number(success || scenario === 'selection during save'),
    );
    expect(attempt.heads).toEqual(
      expectedHead ? [{ active_run_id: expectedHead }] : [],
    );
    expect(attempt.row).toHaveLength(Number(success));
    expect(attempt.pendingStages).not.toHaveBeenCalled();
    if (success)
      expect(attempt.saved).toMatchObject({
        status: 'saved',
        runId: candidate,
      });
    if (attempt.outcome.status === 'completed') {
      expect(attempt.outcome.context.sourceSnapshot.mutationGeneration).toBe(1);
      expect(Boolean(attempt.outcome.context.systemCalendar)).toBe(
        Boolean(attempt.native),
      );
      expect(attempt.saved).toMatchObject({
        status: 'saved',
        runId: candidate,
        context: attempt.outcome.context,
      });
    }
    expect(attempt.native?.listeners.size ?? 0).toBe(0);
  },
);
