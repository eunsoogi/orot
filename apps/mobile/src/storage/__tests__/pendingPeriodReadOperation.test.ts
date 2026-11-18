import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { committedPeriodReadOperation } from '../committedPeriodReadOperation';

async function fixture() {
  const f = await healthContextFixture();
  const source = f.saved.sources.find(isPeriodSummarySource)!;
  const transaction = f.database.transaction.bind(f.database);
  let aggregates = 0;
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      await work({
        ...tx,
        execute: async (...args) => {
          if (/WITH days\(/.test(args[0])) aggregates++;
          return execute(...args);
        },
      });
    });
  return { ...f, source, count: () => aggregates };
}

test('pending calculation never substitutes for a required source generation or revision', async () => {
  const f = await fixture();
  const operation = committedPeriodReadOperation(f.database);
  try {
    await expect(
      operation.run(async (tx, validate) => {
        const stale = {
          ...f.source,
          deletionGeneration: f.source.deletionGeneration + 1,
        };
        await validate(tx, stale, false);
        expect(f.count()).toBe(2);
        await validate(tx, stale, true);
      }),
    ).rejects.toThrow('changed before saving');
    // A failed operation cannot publish its pending report into the next run.
    await operation.run((tx, validate) => validate(tx, f.source, false));
    expect(f.count()).toBe(4);
    await expect(
      operation.run((tx, validate) =>
        validate(tx, { ...f.source, revision: 'synthetic-invalid' }, false),
      ),
    ).rejects.toThrow('changed before saving');
    expect(f.count()).toBe(4);
  } finally {
    operation.dispose();
    f.close();
  }
});

test.each(['delete', 'cancel', 'rollback'] as const)(
  'pending report retains %s fencing and publication boundaries',
  async mode => {
    const f = await fixture();
    const controller = new AbortController();
    const operation = committedPeriodReadOperation(
      f.database,
      controller.signal,
    );
    const transaction = f.database.transaction.bind(f.database);
    const failure = new Error('Synthetic rollback after pending report');
    try {
      if (mode === 'rollback')
        f.database.transaction = work =>
          transaction(async tx => {
            await work(tx);
            throw failure;
          });
      await expect(
        operation.run(
          async (tx, validate) => {
            await validate(tx, f.source, false);
            await validate(tx, f.source, false);
            expect(f.count()).toBe(2);
            if (mode !== 'rollback') {
              await tx.execute('DELETE FROM health_observations WHERE id=?', [
                f.inside.id,
              ]);
              if (mode === 'cancel') controller.abort();
              await validate(tx, f.source, false);
            }
          },
          { rollbackOnFailure: mode === 'cancel' },
        ),
      ).rejects.toThrow();
      if (mode === 'rollback') {
        f.database.transaction = transaction;
        const before = f.count();
        await operation.run((tx, validate) => validate(tx, f.source, false));
        expect(f.count()).toBe(before + 2);
      } else {
        expect(
          (
            await f.database.execute(
              'SELECT id FROM health_observations WHERE id=?',
              [f.inside.id],
            )
          ).rows,
        ).toEqual([]);
      }
    } finally {
      f.database.transaction = transaction;
      operation.dispose();
      f.close();
    }
  },
);

test('pending reports keep different cutoff and topic calculations independent', async () => {
  const f = await fixture();
  const operation = committedPeriodReadOperation(f.database);
  try {
    const selections = [
      f.source.scope,
      {
        ...f.source.scope,
        window: {
          ...f.source.scope.window,
          dataAvailableThrough: '2026-10-06T00:00:00Z',
        },
      },
      { ...f.source.scope, topic: 'symptoms' as const },
    ];
    const sources: (typeof f.source)[] = [];
    for (const scope of selections) {
      const report = await f.read(scope.window, [scope.topic]);
      sources.push({
        ...f.source,
        scope,
        revision: healthContextRevision(scope, report),
        deletionGeneration: report.deletionGeneration,
      });
    }
    const before = f.count();
    await operation.run(async (tx, validate) => {
      for (const source of sources) await validate(tx, source, true);
      const calculated = f.count();
      expect(calculated).toBeGreaterThan(before + 2);
      for (const source of sources) await validate(tx, source, true);
      expect(f.count()).toBe(calculated);
    });
  } finally {
    operation.dispose();
    f.close();
  }
});
