import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthContextReader, readHealthContextReport } from '../reader';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';
import {
  createCommittedReportScope,
  committedReportCalendar,
} from '../committedReportScope';
import { committedPeriodReadOperation } from '../../../storage/committedPeriodReadOperation';
import { ensureHealthContextGeneration } from '../generation';
import * as calendar from '../window';

const window = {
  fromInclusive: '2023-01-01T00:00:00Z',
  toExclusive: '2024-01-01T00:00:00Z',
  timeZone: 'UTC',
};

test('read owner shares only its calendar and escaped reads calculate afresh after disposal', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    await runMigrations(f.database);
    const reader = createHealthContextReader(f.database);
    const owner = beginHealthContextReadOperation(reader)!;
    const first = await owner.read(window, ['medications']);
    const escaped = owner.read;
    await escaped(window, ['measurements']);
    expect(calculate).toHaveBeenCalledTimes(1);
    owner.dispose();
    const next = await escaped(window, ['sleep']);
    expect(next.days).toEqual(first.days);
    expect(calculate).toHaveBeenCalledTimes(2);
    const other = beginHealthContextReadOperation(reader)!;
    try {
      await other.read(window, ['activity']);
      expect(calculate).toHaveBeenCalledTimes(3);
    } finally {
      other.dispose();
    }
  } finally {
    calculate.mockRestore();
    f.close();
  }
});

test('committed period cancellation discards shared calendar without altering the dataset', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    const controller = new AbortController();
    const owner = committedPeriodReadOperation(f.database, controller.signal);
    const days = committedReportCalendar(owner.reportScope, f.database)!;
    const first = days.read(window);
    expect(days.read(window)).toEqual(first);
    expect(calculate).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(days.read(window)).toEqual(first);
    expect(calculate).toHaveBeenCalledTimes(2);
    await expect(owner.run(async () => {})).rejects.toThrow('cancelled');
    owner.dispose();
  } finally {
    calculate.mockRestore();
    f.close();
  }
});

test('explicit DB capability shares calendars across strict report calls, not standalone calls', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    const owner = createCommittedReportScope(f.database);
    try {
      const scope = committedReportCalendar(owner.token, f.database)!;
      await readHealthContextReport(
        f.database,
        window,
        ['medications'],
        undefined,
        undefined,
        undefined,
        scope,
      );
      await readHealthContextReport(
        f.database,
        window,
        ['sleep'],
        undefined,
        undefined,
        undefined,
        scope,
      );
      expect(calculate).toHaveBeenCalledTimes(1);
      await readHealthContextReport(f.database, window, ['symptoms']);
      expect(calculate).toHaveBeenCalledTimes(2);
    } finally {
      owner.dispose();
    }
  } finally {
    calculate.mockRestore();
    f.close();
  }
});

test('already-aborted owners cannot retain calendar results or execute report reads', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    await runMigrations(f.database);
    const controller = new AbortController();
    controller.abort();
    const period = committedPeriodReadOperation(f.database, controller.signal);
    const days = committedReportCalendar(period.reportScope, f.database)!;
    days.read(window);
    days.read(window);
    expect(calculate).toHaveBeenCalledTimes(2);
    await expect(period.run(async () => {})).rejects.toThrow('cancelled');
    period.dispose();
    const read = beginHealthContextReadOperation(
      createHealthContextReader(f.database),
      controller.signal,
    )!;
    try {
      await expect(read.read(window, ['sleep'])).rejects.toThrow('cancelled');
      expect(calculate).toHaveBeenCalledTimes(2);
    } finally {
      read.dispose();
    }
  } finally {
    calculate.mockRestore();
    f.close();
  }
});

test('a child release never disposes its shared parent calendar', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const calculate = jest.spyOn(calendar, 'healthContextDays');
  try {
    await runMigrations(f.database);
    const parent = createCommittedReportScope(f.database);
    const reader = createHealthContextReader(f.database);
    const first = beginHealthContextReadOperation(
      reader,
      undefined,
      parent.token,
    )!;
    try {
      await first.read(window, ['medications']);
      first.dispose();
      const second = beginHealthContextReadOperation(
        reader,
        undefined,
        parent.token,
      )!;
      try {
        await second.read(window, ['sleep']);
      } finally {
        second.dispose();
      }
      expect(calculate).toHaveBeenCalledTimes(1);
    } finally {
      first.dispose();
      parent.dispose();
    }
  } finally {
    calculate.mockRestore();
    f.close();
  }
});
