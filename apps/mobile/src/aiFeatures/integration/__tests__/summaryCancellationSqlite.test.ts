import type { SqlDatabase } from '@orot/storage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { createSymptomSummaryPersistence } from '../symptomSummaryPersistence';
import { localData } from '../featureServiceFixtures';

test('rolls back a cancelled append after inserting a summary and preserves existing history', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.append(f.saved);
    const controller = new AbortController();
    const database: SqlDatabase = {
      ...f.database,
      transaction: operation =>
        f.database.transaction(tx =>
          operation({
            ...tx,
            async execute(sql, parameters) {
              const result = await tx.execute(sql, parameters);
              if (sql.startsWith('INSERT INTO symptom_summary_runs'))
                controller.abort();
              return result;
            },
          }),
        ),
    };
    const store = createSymptomSummaryStorage(database);
    await store.list();
    await expect(
      store.append({ ...f.saved, id: 'cancelled' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await f.storage.read('cancelled')).toBeNull();
    expect(await f.storage.read(f.saved.id)).toEqual(f.saved);
    expect(
      (
        await f.database.execute(
          'SELECT summary_id FROM symptom_summary_periods',
        )
      ).rows,
    ).toEqual([{ summary_id: f.saved.id }]);
  } finally {
    f.close();
  }
});

test('a cancellation after commit reports success and retrying the same identity stays idempotent', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.list();
    const controller = new AbortController();
    let abortAfterCommit = false;
    const database: SqlDatabase = {
      ...f.database,
      async transaction(operation) {
        await f.database.transaction(operation);
        if (abortAfterCommit) controller.abort();
      },
    };
    const store = createSymptomSummaryStorage(database);
    await store.list();
    abortAfterCommit = true;
    await expect(
      store.append(f.saved, controller.signal),
    ).resolves.toBeUndefined();
    expect(controller.signal.aborted).toBe(true);
    expect(await f.storage.read(f.saved.id)).toEqual(f.saved);
    await f.storage.append(f.saved);
    expect(await f.storage.list()).toHaveLength(1);
    expect(
      (
        await f.database.execute(
          'SELECT summary_id FROM symptom_summary_periods',
        )
      ).rows,
    ).toEqual([{ summary_id: f.saved.id }]);
  } finally {
    f.close();
  }
});

test('a failed write preserves the older summary and retry saves the same result without a model call', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.append(f.saved);
    await f.database.execute(
      "CREATE TRIGGER fail_new_summary BEFORE INSERT ON symptom_summary_runs BEGIN SELECT RAISE(ABORT, 'write failed'); END",
    );
    const value = {
      ...f.saved.analysis,
      hypotheses: f.saved.analysis.hypotheses.map(section => ({
        ...section,
        supportingEvidence: [f.item],
      })),
    };
    const outcome = {
      status: 'workflow',
      result: {
        status: 'result',
        value,
        checkpoint: { evidenceReferences: [f.item] },
      },
    } as never;
    const selected = {
      provider: { id: 'provider' },
      modelId: 'model',
      option: { displayName: 'Model' },
    } as never;
    const persistence = createSymptomSummaryPersistence({
      registry: f.registry,
      data: async () => ({ ...localData([]).data, readHealthContext: f.read }),
      storage: async () => f.storage,
    });
    const failed = await persistence.save(
      outcome,
      selected,
      'retry',
      new AbortController().signal,
      '2026-10-06T00:00:00Z',
    );
    expect(failed).toMatchObject({
      result: { value: { savedSummary: { status: 'failed' } } },
    });
    expect(await f.storage.read(f.saved.id)).toEqual(f.saved);
    await f.database.execute('DROP TRIGGER fail_new_summary');
    expect(await persistence.history.retrySave!()).toMatchObject({
      savedSummary: { status: 'saved', id: '2026-10-06T00:00:00Z-retry' },
    });
    expect(await f.storage.list()).toHaveLength(2);
    expect(await persistence.history.retrySave!()).toBeNull();
    const saved = await f.storage.read('2026-10-06T00:00:00Z-retry');
    expect(saved).toMatchObject({
      providerId: 'provider',
      modelId: 'model',
      sources: [
        { kind: 'health_context_period', scope: { window: f.report.window } },
      ],
    });
  } finally {
    f.close();
  }
});

test.each(['before commit', 'after commit'] as const)(
  'persistence keeps the actual save outcome when cancellation arrives %s',
  async timing => {
    const f = await healthContextFixture();
    try {
      await f.storage.append(f.saved);
      const controller = new AbortController();
      const storage = {
        ...f.storage,
        async append(value: typeof f.saved, signal?: AbortSignal) {
          if (timing === 'before commit') controller.abort();
          await f.storage.append(value, signal);
          if (timing === 'after commit') controller.abort();
        },
      };
      const value = {
        ...f.saved.analysis,
        hypotheses: f.saved.analysis.hypotheses.map(section => ({
          ...section,
          supportingEvidence: [f.item],
        })),
      };
      const outcome = {
        status: 'workflow',
        result: {
          status: 'result',
          value,
          checkpoint: { evidenceReferences: [f.item] },
        },
      } as never;
      const selected = {
        provider: { id: 'provider' },
        modelId: 'model',
        option: { displayName: 'Model' },
      } as never;
      const persistence = createSymptomSummaryPersistence({
        registry: f.registry,
        data: async () => ({
          ...localData([]).data,
          readHealthContext: f.read,
        }),
        storage: async () => storage,
      });
      const result = await persistence.save(
        outcome,
        selected,
        'cancel',
        controller.signal,
        '2026-10-06T00:00:00Z',
      );
      expect(result).toMatchObject({
        result: {
          value: {
            savedSummary: {
              status: timing === 'after commit' ? 'saved' : 'failed',
            },
          },
        },
      });
      expect(await f.storage.read(f.saved.id)).toEqual(f.saved);
      expect(await f.storage.read('2026-10-06T00:00:00Z-cancel')).toEqual(
        timing === 'after commit' ? expect.any(Object) : null,
      );
      if (timing === 'after commit')
        expect(await persistence.history.retrySave!()).toBeNull();
    } finally {
      f.close();
    }
  },
);
