import { createDailyReportRecoveryRequestScope } from '../dailyReportRecoveryRequestScope';
import { createDailyReportIdentity } from '@orot/domain';

test('stable selected original run survives remount, while new today/owner and cancellation are distinct', () => {
  const controller = new AbortController();
  let phase: 'running' | 'explicit_resume' = 'running';
  let runId = 'original-producer-run';
  let today = '2035-01-01';
  const input = {
    activeRequest: () => ({
      runId,
      phase,
      request: {
        localDate: '2035-01-01',
        timeZone: 'UTC',
        requestedAt: '2035-01-01T12:00:00Z',
      },
    }),
    currentIdentity: () => createDailyReportIdentity(today, 'UTC'),
    subscribeChanges: (_listener: () => void) => () => {},
    signal: controller.signal,
  };
  const scope = createDailyReportRecoveryRequestScope(input);
  const original = scope.current();
  expect(createDailyReportRecoveryRequestScope(input).current()).toEqual(
    original,
  );
  today = '2035-01-02';
  expect(scope.current()).toEqual(original); // Frozen in-flight intent, not a new old-day request.
  phase = 'explicit_resume';
  expect(scope.current()).toBeNull();
  today = '2035-01-01';
  expect(scope.current()).toEqual(original);
  runId = 'new-producer-run';
  expect(scope.current()?.ownerId).not.toBe(original?.ownerId);
  controller.abort();
  expect(scope.current()).toBeNull();
});

test('unknown persisted phase cannot be treated as an in-flight frozen request', () => {
  const phase = 'unknown' as unknown as 'running';
  const scope = createDailyReportRecoveryRequestScope({
    activeRequest: () => ({
      runId: 'run',
      phase,
      request: {
        localDate: '2035-01-01',
        timeZone: 'UTC',
        requestedAt: '2035-01-01T12:00:00Z',
      },
    }),
    currentIdentity: () => createDailyReportIdentity('2035-01-02', 'UTC'),
    subscribeChanges: () => () => {},
    signal: new AbortController().signal,
  });
  expect(scope.current()).toBeNull();
});
