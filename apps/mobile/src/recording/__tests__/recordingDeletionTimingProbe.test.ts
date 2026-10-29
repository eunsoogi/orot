import {
  finishRecordingDeletionTiming,
  markRecordingDeletionTiming,
  withRecordingDeletionTiming,
  type RecordingDeletionTimingProbe as RecordingDeletionTimingProbeContract,
} from '../recordingDeletionTiming';
import {
  RecordingDeletionTimingProbe,
  type RecordingDeletionTimingReport,
} from '../recordingDeletionTimingProbe';

test('reports ordered stage durations using monotonic milliseconds only', () => {
  let now = 100;
  const delivered: unknown[] = [];
  const probe = new RecordingDeletionTimingProbe(
    () => now,
    report => delivered.push(report),
  );
  probe.mark('confirmation-tap');
  now += 3;
  probe.mark('progress-presented');

  const spans = [
    'source-read',
    'stop-check',
    'audio-staging',
    'memory-open',
    'derived-data-cleanup',
    'database-delete-commit',
    'audio-cleanup',
  ] as const;
  for (const stage of spans) {
    probe.begin(stage);
    now += 5;
    probe.end(stage, 'success');
  }

  probe.finish('success');
  now += 4;
  probe.mark('list-refresh');
  probe.mark('list-refresh');

  const report = probe.snapshot();
  expect(report).toMatchObject({
    complete: true,
    succeeded: true,
    durationsMs: {
      confirmationToProgress: 3,
      sourceRead: 5,
      stopCheck: 5,
      audioStaging: 5,
      memoryOpen: 5,
      derivedDataCleanup: 5,
      databaseDeleteCommit: 5,
      audioCleanup: 5,
      audioCleanupToListRefresh: 4,
      confirmationToListRefresh: 42,
    },
  });
  expect(delivered).toEqual([report]);
  expect(Object.keys(report)).toEqual([
    'schema',
    'clock',
    'unit',
    'complete',
    'succeeded',
    'events',
    'durationsMs',
  ]);
  expect(JSON.stringify(report)).not.toContain('recording-1');
});

test('does not let a pre-start progress callback consume the measured progress mark', () => {
  let now = 100;
  const probe = new RecordingDeletionTimingProbe(() => now);

  // An unrelated disabled-state layout can occur before confirmation starts a sample.
  probe.mark('progress-presented');
  probe.mark('confirmation-tap');
  now += 3;
  probe.mark('progress-presented');

  expect(probe.snapshot().events).toEqual([
    { stage: 'confirmation-tap', phase: 'mark', elapsedMs: 0 },
    { stage: 'progress-presented', phase: 'mark', elapsedMs: 3 },
  ]);
});

test('publishes a later progress callback after the list refresh snapshot', () => {
  let now = 10;
  const delivered: RecordingDeletionTimingReport[] = [];
  const probe = new RecordingDeletionTimingProbe(
    () => now,
    report => delivered.push(report),
  );
  probe.mark('confirmation-tap');
  probe.finish('success');
  probe.mark('list-refresh');
  expect(delivered).toHaveLength(1);
  expect(delivered[0]?.complete).toBe(false);

  now += 1;
  probe.mark('progress-presented');

  expect(delivered).toHaveLength(2);
  expect(delivered[1]?.complete).toBe(false);
  expect(delivered[1]?.events).toContainEqual({
    stage: 'progress-presented',
    phase: 'mark',
    elapsedMs: 1,
  });
});

test('records a synchronous stage failure and preserves the same error', async () => {
  const probe = new RecordingDeletionTimingProbe(() => 10);
  const failure = new Error('source read failed');
  probe.mark('confirmation-tap');

  await expect(
    withRecordingDeletionTiming(probe, 'source-read', () => {
      throw failure;
    }),
  ).rejects.toBe(failure);

  expect(probe.snapshot().events).toEqual([
    {
      stage: 'confirmation-tap',
      phase: 'mark',
      elapsedMs: 0,
    },
    {
      stage: 'source-read',
      phase: 'begin',
      elapsedMs: 0,
    },
    {
      stage: 'source-read',
      phase: 'end',
      elapsedMs: 0,
      outcome: 'failure',
    },
  ]);
});

test('observer errors never replace the operation result or error', async () => {
  const observer = {
    mark: jest.fn(() => {
      throw new Error('observer mark failed');
    }),
    begin: jest.fn(() => {
      throw new Error('observer begin failed');
    }),
    end: jest.fn(() => {
      throw new Error('observer end failed');
    }),
    finish: jest.fn(() => {
      throw new Error('observer finish failed');
    }),
  } satisfies RecordingDeletionTimingProbeContract;
  const value = { committed: true };
  const failure = new Error('database delete failed');

  await expect(
    withRecordingDeletionTiming(
      observer,
      'database-delete-commit',
      async () => value,
    ),
  ).resolves.toBe(value);
  await expect(
    withRecordingDeletionTiming(observer, 'database-delete-commit', async () =>
      Promise.reject(failure),
    ),
  ).rejects.toBe(failure);
  markRecordingDeletionTiming(observer, 'list-refresh');
  finishRecordingDeletionTiming(observer, 'failure');

  expect(observer.begin).toHaveBeenCalledTimes(2);
  expect(observer.end).toHaveBeenCalledTimes(2);
  expect(observer.mark).toHaveBeenCalledWith('list-refresh');
  expect(observer.finish).toHaveBeenCalledWith('failure');
});
