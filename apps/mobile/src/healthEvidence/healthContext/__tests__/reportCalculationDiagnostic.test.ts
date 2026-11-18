import { NativeModules } from 'react-native';
import {
  observeReportAggregateSql,
  startReportCalculationDiagnostic,
  endReportCalculationDiagnostic,
} from '../reportCalculationDiagnostic';

const query =
  'SELECT * FROM (WITH days(date) AS (VALUES (?)) SELECT * FROM days)';
const secret = 'synthetic-private-window';
let sink: jest.Mock;
beforeEach(() => {
  sink = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report: sink };
});
afterEach(() => {
  delete NativeModules.OrotProviderDiagnostics;
});
const equality = () =>
  sink.mock.calls
    .filter(call => call[1].startsWith('report_sql_') && call[2] === 'started')
    .map(call => call[1]);

test('exact SQL/bindings equality is isolated, cleared and never serialized to the sink', async () => {
  const owner = {};
  const execute = jest.fn(async () => ({ rows: [{ private: secret }] }));
  const tx = observeReportAggregateSql({ execute }, owner);
  startReportCalculationDiagnostic(owner);
  await tx.execute(query, [secret]);
  await tx.execute(query, [secret]);
  await tx.execute(query, [secret + '-different']);
  await tx.execute(query + ' ', [secret]);
  endReportCalculationDiagnostic(owner);
  await tx.execute(query, [secret]);
  startReportCalculationDiagnostic(owner);
  await tx.execute(query, [secret]);
  expect(equality()).toEqual([
    'report_sql_first',
    'report_sql_repeat',
    'report_sql_first',
    'report_sql_first',
    'report_sql_unscoped',
    'report_sql_first',
  ]);
  expect(execute).toHaveBeenCalledTimes(6);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(secret);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(query);
  endReportCalculationDiagnostic(owner);
});

test('disabled diagnostics preserve exact executor identity and retain no equality', async () => {
  const owner = {};
  const tx = { execute: jest.fn(async () => ({ rows: [] })) };
  NativeModules.OrotProviderDiagnostics.enabled = false;
  startReportCalculationDiagnostic(owner);
  expect(observeReportAggregateSql(tx, owner)).toBe(tx);
  NativeModules.OrotProviderDiagnostics.enabled = true;
  await observeReportAggregateSql(tx, owner).execute(query, [secret]);
  expect(equality()).toEqual(['report_sql_unscoped']);
});

test('sink failure preserves original SQL result, binding identity and error', async () => {
  sink.mockImplementation(() => {
    throw new Error('sink');
  });
  const result = { rows: [] };
  const error = new Error('original sql');
  const execute = jest
    .fn()
    .mockResolvedValueOnce(result)
    .mockRejectedValueOnce(error);
  const owner = {};
  startReportCalculationDiagnostic(owner);
  const tx = observeReportAggregateSql({ execute }, owner);
  const bindings = [secret];
  expect(await tx.execute(query, bindings)).toBe(result);
  expect(execute).toHaveBeenCalledWith(query, bindings);
  await expect(tx.execute(query, bindings)).rejects.toBe(error);
  endReportCalculationDiagnostic(owner);
});

test.each([
  [
    'WITH days(x) AS (VALUES (?)), workouts AS MATERIALIZED (SELECT 1) SELECT 1',
    'heart_rate',
  ],
  ['WITH RECURSIVE calendar(x) AS (VALUES (?)) SELECT 1', 'sleep'],
  [
    'WITH days(x) AS (VALUES (?)), occurrences AS MATERIALIZED (SELECT 1) SELECT 1',
    'symptom',
  ],
  [
    'WITH days(x) AS (VALUES (?)), observations AS MATERIALIZED (SELECT 1) SELECT 1',
    'quantity',
  ],
])('classifies static query shape, never bindings: %s', async (sql, kind) => {
  await observeReportAggregateSql({
    execute: async () => ({ rows: [] }),
  }).execute(sql, [secret]);
  expect(sink.mock.calls).toContainEqual([
    'storage',
    `report_query_${kind}`,
    'completed',
  ]);
  expect(equality()).toEqual(['report_sql_unscoped']);
});

test('diagnostic overhead sample is separate from database or device performance', async () => {
  const executor = { execute: async () => ({ rows: [] }) };
  const bindings = ['synthetic'.repeat(4000)];
  const owner = {};
  const durations: number[] = [];
  for (const active of [false, true]) {
    NativeModules.OrotProviderDiagnostics.enabled = active;
    startReportCalculationDiagnostic(owner);
    const observed = observeReportAggregateSql(executor, owner);
    const start = performance.now();
    for (let i = 0; i < 100; i++) await observed.execute(query, bindings);
    durations.push(performance.now() - start);
    endReportCalculationDiagnostic(owner);
  }
  console.info('SYNTHETIC_DIAGNOSTIC_OVERHEAD_MS', durations);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(bindings[0]);
});
