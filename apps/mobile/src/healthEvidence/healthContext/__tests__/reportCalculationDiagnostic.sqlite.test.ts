import { NativeModules } from 'react-native';
import { healthContextFixture } from '../../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { committedPeriodReadOperation } from '../../../storage/committedPeriodReadOperation';
import { committedReportCache } from '../committedReportScope';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';
import { observeReportAggregateSql } from '../reportCalculationDiagnostic';

/** Real SQLite distinguishes equivalent SQL after a generation change from a new window. */
test('reports cache reuse, generation miss and changed bindings without private values', async () => {
  const f = await healthContextFixture();
  const sink = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report: sink };
  const controller = new AbortController();
  const storage = committedPeriodReadOperation(f.database, controller.signal);
  const cache = committedReportCache(storage.reportScope, f.database)!;
  const operation = beginHealthContextReadOperation(
    f.read,
    controller.signal,
    storage.reportScope,
  )!;
  const window = {
    fromInclusive: '2026-10-01T00:00:00Z',
    toExclusive: '2026-10-02T00:00:00Z',
    timeZone: 'UTC',
  };
  try {
    await operation.read(window, ['measurements']);
    expect(sink.mock.calls.some(call => call[1] === 'report_sql_first')).toBe(
      true,
    );
    sink.mockClear();
    await operation.read(window, ['measurements']);
    expect(sink.mock.calls).toContainEqual([
      'storage',
      'report_cache_committed_hit',
      'completed',
    ]);
    expect(
      sink.mock.calls.some(call => call[1].startsWith('report_sql_')),
    ).toBe(false);
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'diagnostic-future',
      effectiveAt: '2027-01-01T00:00:00Z',
      ingestedAt: '2027-01-01T00:00:00Z',
      recordedAt: '2027-01-01T00:00:00Z',
    });
    sink.mockClear();
    await operation.read(window, ['measurements']);
    expect(sink.mock.calls).toContainEqual([
      'storage',
      'report_cache_generation_miss',
      'completed',
    ]);
    expect(sink.mock.calls.some(call => call[1] === 'report_sql_repeat')).toBe(
      true,
    );
    sink.mockClear();
    await operation.read({ ...window, toExclusive: '2026-10-03T00:00:00Z' }, [
      'measurements',
    ]);
    expect(sink.mock.calls).toContainEqual([
      'storage',
      'report_cache_new_key',
      'completed',
    ]);
    expect(sink.mock.calls.some(call => call[1] === 'report_sql_first')).toBe(
      true,
    );
    expect(sink.mock.calls.some(call => call[1] === 'report_sql_repeat')).toBe(
      false,
    );
    const output = JSON.stringify(sink.mock.calls);
    expect(output).not.toContain('2026-');
    expect(output).not.toContain('diagnostic-future');
    const tx = observeReportAggregateSql(
      { execute: async () => ({ rows: [] }) },
      cache,
    );
    const query = 'WITH days(date) AS (VALUES (?)) SELECT * FROM days';
    await tx.execute(query, ['synthetic-private']);
    controller.abort();
    sink.mockClear();
    await tx.execute(query, ['synthetic-private']);
    expect(sink.mock.calls).toContainEqual([
      'storage',
      'report_sql_unscoped',
      'started',
    ]);
    await expect(operation.read(window, ['measurements'])).rejects.toThrow();
  } finally {
    operation.dispose();
    storage.dispose();
    f.close();
    delete NativeModules.OrotProviderDiagnostics;
  }
});
