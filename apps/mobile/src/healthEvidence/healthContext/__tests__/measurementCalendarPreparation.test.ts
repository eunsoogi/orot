import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openOpSqliteFileQueue } from '../../../../test-support/opSqliteFileQueueFixture';
import * as calendarSql from '../calendarSql';
import { ensureHealthContextGeneration } from '../generation';
import { createHealthContextReader, readHealthContextReport } from '../reader';
import type { HealthContextReport } from '../types';

test('cold measurement read prepares one identical calendar binding before acquiring the SQLite transaction', async () => {
  const fixture = openOpSqliteFileQueue();
  const window = {
    fromInclusive: '2025-10-01T12:00:00Z',
    toExclusive: '2026-04-15T12:00:00Z',
    dataAvailableThrough: '2026-10-03T00:00:00Z',
    timeZone: 'America/New_York',
  };
  let inTransaction = false;
  let baseline: HealthContextReport | undefined;
  const phaseOrder: string[] = [];
  const encoding = jest.spyOn(calendarSql, 'healthContextCalendarParameter');
  const original = encoding.getMockImplementation()!;
  encoding.mockImplementation((...args) => {
    phaseOrder.push(inTransaction ? 'encode-locked' : 'encode-prepared');
    return original(...args);
  });
  const database: SqlDatabase = {
    ...fixture.database,
    transaction: work =>
      fixture.database.transaction(async tx => {
        inTransaction = true;
        try {
          await work(tx);
        } finally {
          inTransaction = false;
        }
      }),
  };
  try {
    await runMigrations(database);
    await ensureHealthContextGeneration(database);
    const records = createRecordRepository(database);
    await records.put(
      'health_observation',
      healthObservation(
        'synthetic-heart-rate',
        'heart_rate',
        '2026-01-14T12:00:00Z',
      ),
    );
    // The composable report path retains its original in-transaction behavior.
    await database.transaction(async tx => {
      baseline = await readHealthContextReport(tx, window, ['measurements']);
    });
    expect(baseline?.quantities[0]?.concept).toBe('heart_rate');
    expect(phaseOrder).toEqual(['encode-locked', 'encode-locked']);
    const originalBindings = [
      ...encoding.mock.results.map(entry => entry.value),
    ];
    expect(originalBindings[0]).toBe(originalBindings[1]);
    encoding.mockClear();
    phaseOrder.length = 0;
    const reader = createHealthContextReader(database);
    const candidate = await reader(
      window,
      ['measurements'],
      undefined,
      (phase, status) => {
        if (phase === 'calendar' || phase === 'transaction_wait')
          phaseOrder.push(phase + ':' + status);
      },
    );
    expect(candidate).toEqual(baseline);
    expect(phaseOrder).toEqual([
      'calendar:started',
      'encode-prepared',
      'calendar:completed',
      'transaction_wait:started',
      'transaction_wait:completed',
    ]);
    expect(encoding.mock.results.map(entry => entry.value)).toEqual([
      originalBindings[0],
    ]);
  } finally {
    encoding.mockRestore();
    await fixture.close();
  }
});
