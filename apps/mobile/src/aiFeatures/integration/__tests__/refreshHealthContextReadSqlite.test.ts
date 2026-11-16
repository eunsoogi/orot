import {
  healthContextFixture,
  window,
  signal,
} from '../testSupport/healthContextPersistenceFixture';
import { refreshHealthContextRead } from '../refreshHealthContextRead';

const scope = {
  kind: 'health_context_period' as const,
  version: 1 as const,
  topic: 'measurements' as const,
  window,
};

test('unchanged SQLite cache confirmation adds only a generation read, no aggregation transaction', async () => {
  const f = await healthContextFixture();
  try {
    const execute = jest.spyOn(f.database, 'execute');
    const transaction = jest.spyOn(f.database, 'transaction');
    const start = performance.now();
    for (let index = 0; index < 100; index++) {
      expect(
        await refreshHealthContextRead({
          initial: f.report,
          scope,
          read: f.read,
          signal,
        }),
      ).toBe(f.report);
    }
    const elapsed = performance.now() - start;
    expect(transaction).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(100);
    expect(
      execute.mock.calls.every(
        ([sql]) =>
          sql ===
          'SELECT mutations, deletions FROM health_context_generation WHERE singleton = 1',
      ),
    ).toBe(true);
    // Synthetic host observation only; never an iPhone timing guarantee or CI threshold.
    console.info(
      'Synthetic cached aggregate confirmation: 100 iterations ms',
      elapsed,
    );
  } finally {
    f.close();
  }
});

test('an actual row update can refresh the same scope, but deletion never refreshes an admitted snapshot', async () => {
  const f = await healthContextFixture();
  try {
    await f.repository.put('health_observation', {
      ...f.inside,
      value: { kind: 'quantity', amount: 73, unit: 'count/min' },
    });
    const refreshed = await refreshHealthContextRead({
      initial: f.report,
      scope,
      read: f.read,
      signal,
    });
    expect(refreshed).not.toBe(f.report);
    expect(refreshed.window).toEqual(f.report.window);
    expect(refreshed.deletionGeneration).toBe(f.report.deletionGeneration);
    await f.repository.delete('health_observation', f.inside.id);
    expect(
      await refreshHealthContextRead({
        initial: refreshed,
        scope,
        read: f.read,
        signal,
      }),
    ).toBe(refreshed);
    expect(await f.registry.revalidateEvidence([f.item], signal)).toBe(false);
  } finally {
    f.close();
  }
});
