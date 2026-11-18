import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLocalEvidenceData } from '../../localEvidenceData';
import { createHealthContextReader } from '../reader';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-02T00:00:00Z',
  timeZone: 'UTC',
};
async function fixture() {
  const f = openSqliteTestDatabase(':memory:');
  await runMigrations(f.database);
  const records = createRecordRepository(f.database);
  await records.put(
    'health_observation',
    healthObservation('sample', 'heart_rate', '2026-10-01T10:00:00Z'),
  );
  return { ...f, records };
}

/** Real SQLite generations, not a generic-reader validity cache. */
test('the production local-data reader reuses reports while preserving deletion and disposal fences', async () => {
  const f = await fixture(),
    other = await fixture();
  try {
    const base = createLocalEvidenceData(f.database).readHealthContext!;
    expect(
      beginHealthContextReadOperation(async () => {
        throw new Error('custom');
      }),
    ).toBeUndefined();
    const operation = beginHealthContextReadOperation(base)!;
    const calls: string[] = [];
    const trace = (step: string, status: string) => {
      if (step === 'quantities' && status === 'started') calls.push(step);
    };
    for (let repeat = 0; repeat < 2; repeat++)
      for (let i = 0; i < 7; i++)
        await operation.read(
          {
            ...window,
            toExclusive: new Date(Date.UTC(2026, 9, 2 + i)).toISOString(),
          },
          ['measurements'],
          undefined,
          trace,
        );
    expect(calls).toHaveLength(7);
    const baseline = await operation.read(window, ['measurements']);
    await other.records.delete('health_observation', 'sample');
    expect(await operation.read(window, ['measurements'])).toEqual(baseline);
    const foreign = beginHealthContextReadOperation(
      createHealthContextReader(other.database),
    )!;
    expect((await foreign.read(window, ['measurements'])).quantities).toEqual(
      [],
    );
    foreign.dispose();
    await f.records.delete('health_observation', 'sample');
    expect(
      (await operation.read(window, ['measurements'], undefined, trace))
        .quantities,
    ).toEqual([]);
    operation.dispose();
    await operation.read(window, ['measurements'], undefined, trace);
    expect(calls).toHaveLength(9); // Seven distinct windows, deletion, then released base reader.
  } finally {
    f.close();
    other.close();
  }
});
