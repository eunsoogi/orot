import { healthContextReportCacheKey as key } from '../reportCacheKey';
import { healthContextFixture } from '../../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-05T00:00:00Z',
  timeZone: 'UTC',
  dataAvailableThrough: '2026-10-06T00:00:00Z',
  doseHistory: { medicationName: 'Synthetic A', page: 0, pageSize: 10 },
};

test('field order and duplicate topic order do not change the report key or input', () => {
  const before = JSON.stringify(window);
  expect(key(window, ['medications', 'measurements', 'medications'])).toBe(
    key(
      {
        doseHistory: { pageSize: 10, page: 0, medicationName: 'Synthetic A' },
        dataAvailableThrough: window.dataAvailableThrough,
        timeZone: window.timeZone,
        toExclusive: window.toExclusive,
        fromInclusive: window.fromInclusive,
      },
      ['measurements', 'medications'],
    ),
  );
  expect(JSON.stringify(window)).toBe(before);
});

test.each([
  { fromInclusive: '2026-10-02T00:00:00Z' },
  { toExclusive: '2026-10-04T00:00:00Z' },
  { timeZone: 'Asia/Seoul' },
  { dataAvailableThrough: '2026-10-07T00:00:00Z' },
  { dataAvailableThrough: undefined },
  { doseHistory: { ...window.doseHistory, page: 1 } },
  { doseHistory: { ...window.doseHistory, pageSize: 5 } },
  { doseHistory: { ...window.doseHistory, medicationName: 'Synthetic B' } },
  { doseHistory: undefined },
  { futureWindowPolicy: 'synthetic' },
])('distinct query selections remain distinct: %j', change => {
  expect(key({ ...window, ...change }, ['medications'])).not.toBe(
    key(window, ['medications']),
  );
});

test('production reader shares reordered dose selection but not a different page', async () => {
  const f = await healthContextFixture();
  const operation = beginHealthContextReadOperation(f.read)!;
  const transaction = f.database.transaction.bind(f.database);
  let reads = 0;
  f.database.transaction = work => {
    reads++;
    return transaction(work);
  };
  try {
    const selection = {
      ...f.report.window,
      doseHistory: { page: 0, pageSize: 10 },
    };
    await operation.read(selection, ['medications']);
    const afterFirst = reads;
    await operation.read(
      { ...selection, doseHistory: { pageSize: 10, page: 0 } },
      ['medications'],
    );
    expect(reads).toBe(afterFirst);
    await operation.read(
      { ...selection, doseHistory: { page: 1, pageSize: 10 } },
      ['medications'],
    );
    expect(reads).toBe(afterFirst + 1);
  } finally {
    f.database.transaction = transaction;
    operation.dispose();
    f.close();
  }
});
