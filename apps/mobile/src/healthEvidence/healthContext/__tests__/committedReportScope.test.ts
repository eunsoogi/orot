import { beginHealthContextReadOperation } from '../healthContextReadOperation';
import type { SqlDatabase } from '@orot/storage';
import { healthContextFixture } from '../../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import {
  createCommittedReportScope,
  committedReportCache,
} from '../committedReportScope';
import { healthContextRevision } from '../scope';

// The report is actually computed in SQLite; the shared cache is not validity authority.
test('publishes isolated immutable values without freezing or changing caller-owned reports', async () => {
  const f = await healthContextFixture();
  try {
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
      timeZone: 'UTC',
    };
    const original = await f.read(window, ['measurements']);
    const report = { ...original, optionalDiagnostic: undefined };
    const period = {
      kind: 'health_context_period' as const,
      version: 1 as const,
      topic: 'measurements' as const,
      window,
    };
    const scope = createCommittedReportScope(f.database);
    const cache = committedReportCache(scope.token, f.database)!;
    cache.set('period', report);
    const saved = cache.get('period')!;
    expect(saved).toEqual(report);
    expect(Reflect.has(saved, 'optionalDiagnostic')).toBe(true);
    expect(healthContextRevision(period, saved)).toBe(
      healthContextRevision(period, report),
    );
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.window)).toBe(true);
    expect(Object.isFrozen(saved.quantities)).toBe(true);
    expect(Object.isFrozen(report)).toBe(false);
    expect(Object.isFrozen(window)).toBe(false);
    window.timeZone = 'Asia/Seoul';
    expect(saved.window.timeZone).toBe('UTC');
    cache.set('period', saved);
    expect(cache.get('period')).toBe(saved);
    expect(
      committedReportCache(scope.token, { ...f.database } as SqlDatabase),
    ).toBeUndefined();
    expect(
      committedReportCache({ kind: 'committed_report_scope' }, f.database),
    ).toBeUndefined();
    scope.dispose();
    cache.set('late', report);
    expect(cache.size).toBe(0);
    expect(committedReportCache(scope.token, f.database)).toBeUndefined();
  } finally {
    f.close();
  }
});

test('an actual foreign database reader cannot reuse a same-generation owned report', async () => {
  const first = await healthContextFixture();
  const second = await healthContextFixture();
  try {
    await first.repository.put('health_observation', {
      ...first.inside,
      value: { kind: 'quantity', amount: 71.12345678901234, unit: 'count/min' },
    });
    await second.repository.put('health_observation', {
      ...second.inside,
      value: { kind: 'quantity', amount: 99.12345678901234, unit: 'count/min' },
    });
    const window = first.report.window;
    const report = await first.read(window, ['measurements']);
    const expected = await second.read(window, ['measurements']);
    expect(report.mutationGeneration).toBe(expected.mutationGeneration);
    expect(report.deletionGeneration).toBe(expected.deletionGeneration);
    const owner = createCommittedReportScope(first.database);
    committedReportCache(owner.token, first.database)!.set(
      JSON.stringify([window, ['measurements']]),
      report,
    );
    const operation = beginHealthContextReadOperation(
      second.read,
      undefined,
      owner.token,
    )!;
    const result = await operation.read(window, ['measurements']);
    expect(result).toEqual(expected);
    expect(result.quantities[0]?.days[0]?.mean).toBe(99.12345678901234);
    expect(result).not.toEqual(report);
    operation.dispose();
    owner.dispose();
  } finally {
    first.close();
    second.close();
  }
});

test('caller mutation before scope creation cannot poison the committed base-cache seed', async () => {
  const f = await healthContextFixture();
  try {
    const request = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
      timeZone: 'UTC',
    };
    const visible = await f.read(request, ['measurements']);
    expect(Object.isFrozen(visible)).toBe(false);
    // Simulate an accidental consumer alias mutation, despite the TypeScript readonly contract.
    Reflect.set(visible.quantities[0]!.days[0]!, 'mean', 999);
    Reflect.set(visible.window, 'timeZone', 'Asia/Seoul');
    const owner = createCommittedReportScope(f.database);
    const operation = beginHealthContextReadOperation(
      f.read,
      undefined,
      owner.token,
    )!;
    const result = await operation.read({ ...request, timeZone: 'UTC' }, [
      'measurements',
    ]);
    expect(result.window.timeZone).toBe('UTC');
    expect(result.quantities[0]?.days[0]?.mean).toBe(72);
    expect(visible.quantities[0]?.days[0]?.mean).toBe(999);
    expect(Object.isFrozen(request)).toBe(false);
    operation.dispose();
    owner.dispose();
  } finally {
    f.close();
  }
});
