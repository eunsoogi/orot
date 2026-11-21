import { NativeModules } from 'react-native';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { committedPeriodReadOperation } from '../committedPeriodReadOperation';

async function fixture() {
  const f = await healthContextFixture();
  const source = f.saved.sources.find(isPeriodSummarySource)!;
  const transaction = f.database.transaction.bind(f.database);
  let aggregates = 0;
  let hook:
    | ((
        tx: Parameters<Parameters<typeof transaction>[0]>[0],
        sql: string,
      ) => Promise<void>)
    | undefined;
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      const wrapped = {
        ...tx,
        execute: async (...args: Parameters<typeof execute>) => {
          const result = await execute(...args);
          if (/WITH days\(/.test(args[0])) aggregates++;
          await hook?.(tx, args[0]);
          return result;
        },
      };
      await work(wrapped);
    });
  return {
    ...f,
    source,
    transaction,
    count: () => aggregates,
    arm: (value: typeof hook) => {
      hook = value;
    },
    validate: (scope: ReturnType<typeof committedPeriodReadOperation>) =>
      scope.run((tx, validate) => validate(tx, source, false)),
  };
}

test('failed commit cannot publish reports even after generation rollback ABA', async () => {
  const f = await fixture();
  const scope = committedPeriodReadOperation(f.database);
  try {
    const observed = f.database.transaction.bind(f.database);
    f.database.transaction = work =>
      observed(async tx => {
        await tx.execute(
          'UPDATE health_context_generation SET mutations=mutations+1',
        );
        await work(tx);
        throw new Error('Synthetic rollback');
      });
    await expect(f.validate(scope)).rejects.toThrow('Synthetic rollback');
    f.database.transaction = observed;
    // Recreate the generation observed inside the rolled-back transaction.
    // A report cached before commit would now appear current despite the ABA.
    await f.database.execute(
      'UPDATE health_context_generation SET mutations=mutations+1',
    );
    const previous = f.count();
    await f.validate(scope);
    expect(f.count()).toBe(previous + 2);
    await f.validate(scope);
    expect(f.count()).toBe(previous + 2);
  } finally {
    scope.dispose();
    f.close();
  }
});

test.each(['cancel', 'query-error', 'generation'] as const)(
  'preserves same-connection writes and withholds failed report: %s',
  async mode => {
    const f = await fixture();
    const controller = new AbortController();
    const scope = committedPeriodReadOperation(f.database, controller.signal);
    try {
      await f.database.execute(
        'CREATE TABLE synthetic_user_writes(value INTEGER)',
      );
      f.arm(async (tx, sql) => {
        if (!sql.includes('observations AS MATERIALIZED')) return;
        f.arm(undefined);
        await tx.execute('INSERT INTO synthetic_user_writes VALUES (1)');
        if (mode === 'cancel') controller.abort();
        else if (mode === 'query-error')
          throw new Error('Synthetic query error');
        else
          await tx.execute(
            'UPDATE health_context_generation SET mutations=mutations+1',
          );
      });
      await expect(f.validate(scope)).rejects.toThrow();
      expect(
        (await f.database.execute('SELECT * FROM synthetic_user_writes')).rows,
      ).toEqual([{ value: 1 }]);
      if (mode !== 'cancel') {
        const previous = f.count();
        await f.validate(scope);
        expect(f.count()).toBe(previous + 2);
      }
    } finally {
      scope.dispose();
      f.close();
    }
  },
);

test('post-commit mutation rejects publication and disposed pending work cannot seed cache', async () => {
  const f = await fixture();
  const scope = committedPeriodReadOperation(f.database);
  try {
    const observed = f.database.transaction.bind(f.database);
    let once = true;
    f.database.transaction = async work => {
      await observed(work);
      if (once) {
        once = false;
        await f.database.execute(
          'UPDATE health_context_generation SET mutations=mutations+1',
        );
      }
    };
    await expect(f.validate(scope)).rejects.toThrow('before read publication');
    const previous = f.count();
    await f.validate(scope);
    expect(f.count()).toBe(previous + 2);
    scope.dispose();
    // The production owner's escaped methods, rather than this internal helper,
    // route to strict reads after disposal (covered by the session profile test).
    expect(scope.active).toBe(false);
  } finally {
    scope.dispose();
    f.close();
  }
});

test('dispose during an in-flight calculation prevents late publication', async () => {
  const f = await fixture();
  const scope = committedPeriodReadOperation(f.database);
  try {
    f.arm(async (_tx, sql) => {
      if (!sql.includes('observations AS MATERIALIZED')) return;
      f.arm(undefined);
      scope.dispose();
    });
    await f.validate(scope);
    expect(scope.active).toBe(false);
    const previous = f.count();
    await f.validate(scope);
    expect(f.count()).toBe(previous + 2);
  } finally {
    scope.dispose();
    f.close();
  }
});

test.each([
  'disabled',
  'completed',
  'settlement-error',
  'work-error',
  'sink-error',
] as const)(
  'emits at most one fixed aggregate span without changing the transaction result: %s',
  async mode => {
    const f = await fixture();
    const report = jest.fn((...event: string[]) => {
      if (mode === 'sink-error' && event[1] === 'artifact_period_transaction')
        throw new Error('Synthetic diagnostic failure');
    });
    const prior = Object.getOwnPropertyDescriptor(
      NativeModules,
      'OrotProviderDiagnostics',
    );
    Object.defineProperty(NativeModules, 'OrotProviderDiagnostics', {
      configurable: true,
      value: { historyValidationCostEnabled: mode !== 'disabled', report },
    });
    const scope = committedPeriodReadOperation(f.database);
    const observed = f.database.transaction.bind(f.database);
    const failure = new Error('Synthetic read failure');
    const events = () =>
      report.mock.calls.filter(
        event => event[1] === 'artifact_period_transaction',
      );
    const start = ['rag', 'artifact_period_transaction', 'started'];
    try {
      f.database.transaction = async work => {
        expect(events()).toEqual([]);
        await observed(work);
        expect(events()).toEqual(mode === 'disabled' ? [] : [start]);
        if (mode === 'settlement-error') throw failure;
      };
      const result = scope.run(async () => {
        expect(events()).toEqual(mode === 'disabled' ? [] : [start]);
        if (mode === 'work-error') throw failure;
      });
      if (mode === 'work-error' || mode === 'settlement-error')
        await expect(result).rejects.toBe(failure);
      else await result;
      const outcome =
        mode.endsWith('error') && mode !== 'sink-error'
          ? 'failed'
          : 'completed';
      expect(events()).toEqual(
        mode === 'disabled'
          ? []
          : [start, ['rag', 'artifact_period_transaction', outcome]],
      );
    } finally {
      scope.dispose();
      f.close();
      if (prior)
        Object.defineProperty(NativeModules, 'OrotProviderDiagnostics', prior);
      else Reflect.deleteProperty(NativeModules, 'OrotProviderDiagnostics');
    }
  },
);
