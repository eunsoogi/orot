import { applySleepChanges } from '../sync';
import type { SleepImportState, SleepSyncChanges } from '../types';
import { healthKitSleepSample } from '../testFixtures';

describe('sleep incremental import state', () => {
  const empty: SleepImportState = { samples: [], anchor: null };

  it('applies additions once and advances the anchor only for a complete delta', () => {
    const changes: SleepSyncChanges = {
      addedOrUpdated: [healthKitSleepSample()],
      deletedSampleIds: [],
      nextAnchor: 'anchor-1',
      complete: true,
    };

    const first = applySleepChanges(empty, changes);
    const repeated = applySleepChanges(first, changes);

    expect(first.anchor).toBe('anchor-1');
    expect(first.samples).toHaveLength(1);
    expect(repeated).toEqual(first);
  });

  it('accepts a completed initial query with no returned anchor', () => {
    const state = applySleepChanges(empty, {
      addedOrUpdated: [],
      deletedSampleIds: [],
      nextAnchor: null,
      complete: true,
    });

    expect(state).toEqual({ samples: [], anchor: null });
  });

  it('replaces a changed sample by stable UUID, including its source and device metadata', () => {
    const initial = applySleepChanges(empty, {
      addedOrUpdated: [healthKitSleepSample()],
      deletedSampleIds: [],
      nextAnchor: 'anchor-1',
      complete: true,
    });
    const updatedSample = healthKitSleepSample({
      sourceIdentifier: 'com.example.updated',
      sourceName: 'Updated Source',
      device: null,
      categoryValue: 5,
    });
    const updated = applySleepChanges(initial, {
      addedOrUpdated: [updatedSample],
      deletedSampleIds: [],
      nextAnchor: 'anchor-2',
      complete: true,
    });

    expect(updated.samples).toHaveLength(1);
    expect(updated.samples[0]).toMatchObject({
      id: 'sample-1',
      stage: 'asleepREM',
      source: {
        identifier: 'com.example.updated',
        name: 'Updated Source',
      },
      device: null,
    });
    expect(updated.anchor).toBe('anchor-2');
  });

  it('applies deletions idempotently and does not retain deleted source observations', () => {
    const initial = applySleepChanges(empty, {
      addedOrUpdated: [healthKitSleepSample()],
      deletedSampleIds: [],
      nextAnchor: 'anchor-1',
      complete: true,
    });
    const deletion: SleepSyncChanges = {
      addedOrUpdated: [],
      deletedSampleIds: ['sample-1'],
      nextAnchor: 'anchor-2',
      complete: true,
    };

    const deleted = applySleepChanges(initial, deletion);
    const repeated = applySleepChanges(deleted, deletion);

    expect(deleted.samples).toEqual([]);
    expect(repeated).toEqual(deleted);
  });

  it('retains overlapping intervals from distinct HealthKit sample IDs', () => {
    const first = healthKitSleepSample({
      id: 'sleep-first',
      categoryValue: 3,
      startDate: '2026-10-01T22:00:00.000Z',
      endDate: '2026-10-01T23:00:00.000Z',
    });
    const second = healthKitSleepSample({
      id: 'sleep-second',
      categoryValue: 5,
      startDate: '2026-10-01T22:30:00.000Z',
      endDate: '2026-10-01T23:30:00.000Z',
    });

    const imported = applySleepChanges(empty, {
      addedOrUpdated: [first, second],
      deletedSampleIds: [],
      nextAnchor: 'anchor-1',
      complete: true,
    });

    expect(imported.samples.map(sample => sample.id)).toEqual([
      'sleep-first',
      'sleep-second',
    ]);
    expect(imported.samples.map(sample => sample.categoryValue)).toEqual([
      3, 5,
    ]);
  });

  it('leaves the prior state untouched when a page is incomplete or internally contradictory', () => {
    const changes: SleepSyncChanges = {
      addedOrUpdated: [healthKitSleepSample()],
      deletedSampleIds: [],
      nextAnchor: 'anchor-1',
      complete: false,
    };

    expect(() => applySleepChanges(empty, changes)).toThrow(
      expect.objectContaining({ code: 'INCOMPLETE_SLEEP_SYNC' }),
    );
    expect(() =>
      applySleepChanges(empty, {
        ...changes,
        complete: true,
        deletedSampleIds: ['sample-1'],
      }),
    ).toThrow(
      expect.objectContaining({ code: 'CONFLICTING_SLEEP_SYNC_DELTA' }),
    );
    expect(empty).toEqual({ samples: [], anchor: null });
  });

  it('rejects duplicate sample UUIDs in one delta instead of applying arrival order', () => {
    expect(() =>
      applySleepChanges(empty, {
        addedOrUpdated: [
          healthKitSleepSample(),
          healthKitSleepSample({
            sourceIdentifier: 'com.example.other',
          }),
        ],
        deletedSampleIds: [],
        nextAnchor: 'anchor-1',
        complete: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_SLEEP_SAMPLE_ID' }));
  });
});
