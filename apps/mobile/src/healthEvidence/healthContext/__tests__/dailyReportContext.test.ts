import {
  createDailyReportContext,
  dailyReportContextMatchesSourceSnapshot,
} from '../dailyReportContext';
import {
  createDailyReportCalendarWindow,
  currentDailyReportContextRequest,
} from '../dailyReportWindow';
import {
  dailyReportProviderFixture,
  dailyReportRequestFixture,
  dailyReportSourceSnapshotFixture,
} from '../testSupport/dailyReportContextFixture';
import type { DailyReportConversationIntent } from '../../../aiFeatures/integration/conversationIntent';

function calendar(input: unknown) {
  const result = createDailyReportCalendarWindow(input);
  if (result.status !== 'ready') throw new Error(result.code);
  return result.context;
}

test('builds exact half-open local days across short and long DST changes', () => {
  const spring = calendar({
    localDate: '2026-03-08',
    timeZone: 'America/New_York',
    requestedAt: '2026-03-08T16:15:00.000Z',
  });
  const fall = calendar({
    localDate: '2026-11-01',
    timeZone: 'America/New_York',
    requestedAt: '2026-11-01T16:15:00.000Z',
  });

  expect(spring.interval).toEqual({
    fromInclusive: '2026-03-08T05:00:00.000Z',
    toExclusive: '2026-03-09T04:00:00.000Z',
  });
  expect(fall.interval).toEqual({
    fromInclusive: '2026-11-01T04:00:00.000Z',
    toExclusive: '2026-11-02T05:00:00.000Z',
  });
  expect(spring.partial).toBe(true);
  expect(fall.partial).toBe(true);
});

test('uses the current explicit timezone for new requests and retains old dates when selected again', () => {
  const seoul = currentDailyReportContextRequest(
    '2026-11-10T02:00:00.000Z',
    'Asia/Seoul',
  );
  const losAngeles = currentDailyReportContextRequest(
    '2026-11-10T02:00:00.000Z',
    'America/Los_Angeles',
  );
  expect(seoul).toMatchObject({
    status: 'ready',
    request: { localDate: '2026-11-10' },
  });
  expect(losAngeles).toMatchObject({
    status: 'ready',
    request: { localDate: '2026-11-09' },
  });

  const pastDay = calendar({
    localDate: '2026-03-08',
    timeZone: 'America/New_York',
    requestedAt: '2026-11-10T02:00:00.000Z',
  });
  expect(pastDay.identity).toMatchObject({
    localDate: '2026-03-08',
    timeZone: 'America/New_York',
  });
  expect(pastDay.effectiveCutoff).toBe(pastDay.interval.toExclusive);
});

test('clamps the effective cutoff to the day while retaining the actual generation time', () => {
  const day = calendar({
    localDate: '2026-11-10',
    timeZone: 'Asia/Seoul',
    requestedAt: '2026-11-11T00:00:00.000Z',
  });

  expect(day.generationCutoff).toBe('2026-11-11T00:00:00.000Z');
  expect(day.effectiveCutoff).toBe(day.interval.toExclusive);
  expect(day.dataWindow).toMatchObject({
    fromInclusive: day.interval.fromInclusive,
    toExclusive: day.interval.toExclusive,
    dataAvailableThrough: day.generationCutoff,
  });
});

test('rejects a future day, malformed requests and a civil day skipped by timezone travel', () => {
  expect(
    createDailyReportCalendarWindow({
      localDate: '2026-11-10',
      timeZone: 'Asia/Seoul',
      requestedAt: '2026-11-09T14:59:59.000Z',
    }),
  ).toEqual({ status: 'error', code: 'cutoff_before_day' });
  expect(
    createDailyReportCalendarWindow({
      localDate: '2026-02-30',
      timeZone: 'Asia/Seoul',
      requestedAt: '2026-11-10T02:00:00.000Z',
    }),
  ).toEqual({ status: 'error', code: 'invalid_request' });
  expect(
    createDailyReportCalendarWindow({
      localDate: '2011-12-30',
      timeZone: 'Pacific/Apia',
      requestedAt: '2012-01-01T00:00:00.000Z',
    }),
  ).toEqual({ status: 'error', code: 'nonexistent_local_day' });
});

test('filters source references by occurrence overlap and ingestion cutoff without merging sources', () => {
  const day = calendar(dailyReportRequestFixture);
  const context = createDailyReportContext(
    day,
    dailyReportSourceSnapshotFixture,
    dailyReportProviderFixture,
  );

  expect(context.sourceSnapshot.records.map(record => record.recordId)).toEqual(
    ['sleep-cross-midnight', 'steps-phone', 'steps-watch'],
  );
  expect(
    context.sourceSnapshot.records.filter(record =>
      ['healthkit.phone', 'healthkit.watch'].includes(record.source),
    ),
  ).toHaveLength(2);
  expect(
    context.sourceSnapshot.coverage.map(coverage => coverage.status),
  ).toEqual(['partial', 'available', 'empty', 'unknown', 'failed', 'stale']);
});

test('projects the same explicit request from preparation and conversation identically', () => {
  const preparationRequest = dailyReportRequestFixture;
  const conversationIntent: DailyReportConversationIntent = {
    kind: 'daily-report',
    entryKey: 'daily-report-request',
    request: dailyReportRequestFixture,
  };
  const preparation = createDailyReportContext(
    calendar(preparationRequest),
    dailyReportSourceSnapshotFixture,
    dailyReportProviderFixture,
  );
  const conversation = createDailyReportContext(
    calendar(conversationIntent.request),
    dailyReportSourceSnapshotFixture,
    dailyReportProviderFixture,
  );

  expect(conversation).toEqual(preparation);
  expect(conversation.identity).toMatchObject({
    localDate: dailyReportRequestFixture.localDate,
    timeZone: dailyReportRequestFixture.timeZone,
  });
});

test('uses an empty source window at midnight and keeps correction/deletion generations', () => {
  const day = calendar({
    localDate: '2026-11-10',
    timeZone: 'Asia/Seoul',
    requestedAt: '2026-11-09T15:00:00.000Z',
  });
  expect(day.dataWindow).toBeNull();
  const context = createDailyReportContext(
    day,
    { ...dailyReportSourceSnapshotFixture, records: [] },
    dailyReportProviderFixture,
  );
  expect(context.sourceSnapshot.records).toEqual([]);
  expect(
    dailyReportContextMatchesSourceSnapshot(context, {
      revision: 'snapshot-r7',
      mutationGeneration: 7,
      deletionGeneration: 2,
    }),
  ).toBe(true);
  expect(
    dailyReportContextMatchesSourceSnapshot(context, {
      revision: 'snapshot-r8',
      mutationGeneration: 8,
      deletionGeneration: 2,
    }),
  ).toBe(false);
  expect(
    dailyReportContextMatchesSourceSnapshot(context, {
      revision: 'snapshot-r7',
      mutationGeneration: 7,
      deletionGeneration: 3,
    }),
  ).toBe(false);
});
