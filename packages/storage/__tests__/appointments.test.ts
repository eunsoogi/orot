import { createAppointmentRepository } from '../src';
import type { Appointment } from '@orot/domain';
import type { RecordRepository, SqlDatabase, SqlTransaction, SqlValue } from '../src';

function createMemoryRepositories() {
  const rows = new Map<string, Appointment>();
  let transactionQueue = Promise.resolve();
  const records = {
    async get(_kind: 'appointment', id: string) {
      return rows.get(id) ?? null;
    },
    async put(_kind: 'appointment', appointment: Appointment) {
      rows.set(appointment.id, appointment);
    },
  } as Pick<RecordRepository, 'get' | 'put'>;
  async function execute(query: string, parameters: SqlValue[] = []) {
    if (query.includes('FROM appointments ORDER BY id ASC')) {
      return {
        rows: [...rows.values()].map((appointment) => ({
          payload_json: JSON.stringify(appointment),
        })),
      };
    }
    if (query.includes('FROM appointments WHERE id = ? LIMIT 1')) {
      const appointment = rows.get(String(parameters[0]));
      return { rows: appointment ? [{ payload_json: JSON.stringify(appointment) }] : [] };
    }
    if (query.startsWith('UPDATE appointments SET')) {
      const id = String(parameters[4]);
      const payload = String(parameters[3]);
      if (!rows.has(id)) return { rows: [], rowsAffected: 0 };
      rows.set(id, JSON.parse(payload) as Appointment);
      return { rows: [], rowsAffected: 1 };
    }
    throw new Error('Unexpected SQL query: ' + query);
  }
  const executor: SqlDatabase = {
    execute,
    async transaction(operation: (transaction: SqlTransaction) => Promise<void>) {
      const prior = transactionQueue;
      let release!: () => void;
      transactionQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        await operation({ execute, commit: () => ({ rows: [] }), rollback: () => ({ rows: [] }) });
      } finally {
        release();
      }
    },
  };
  return { rows, records, executor };
}

describe('appointment persistence adapter', () => {
  it('persists and reconfirms only a user-selected Calendar event snapshot', async () => {
    const { rows, records, executor } = createMemoryRepositories();
    const appointments = createAppointmentRepository(records, executor, {
      clock: () => '2026-02-03T09:00:00Z',
      createId: () => 'calendar-1',
    });
    const recurrenceRule = {
      frequency: 'monthly' as const,
      interval: 1,
      firstDayOfTheWeek: 1,
      daysOfTheWeek: [{ dayOfTheWeek: 2, weekNumber: 1 }],
      daysOfTheMonth: null,
      monthsOfTheYear: null,
      weeksOfTheYear: null,
      daysOfTheYear: null,
      setPositions: null,
      end: { kind: 'date' as const, date: '2028-01-01T00:00:00Z' },
    };
    const selected = {
      calendarEventIdentifier: 'selected-event-1',
      effectiveAt: '2027-06-02T00:00:00Z',
      endsAt: '2027-06-02T01:00:00Z',
      calendarEventSnapshot: {
        title: 'Outpatient visit',
        timeZoneIdentifier: 'Asia/Seoul',
        isAllDay: false,
        occurrenceDate: '2027-06-02T00:00:00Z',
        isDetached: false,
        recurrenceRules: [recurrenceRule],
      },
    };

    const appointment = await appointments.confirmCalendarEvent(selected);

    expect(rows.size).toBe(1);
    expect(await appointments.list()).toEqual([appointment]);
    expect(appointment).toMatchObject({
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      calendarEventIdentifier: 'selected-event-1',
      calendarEventSnapshot: selected.calendarEventSnapshot,
    });

    const changed = await appointments.reconfirmCalendarEvent(appointment.id, {
      ...selected,
      calendarEventIdentifier: 'selected-event-1-rescheduled',
      effectiveAt: '2027-06-03T00:00:00Z',
      endsAt: '2027-06-03T01:00:00Z',
      calendarEventSnapshot: {
        ...selected.calendarEventSnapshot,
        title: 'Outpatient visit moved',
        isAllDay: true,
        isDetached: true,
      },
    });

    expect(changed.status).toBe('rescheduled');
    expect(changed.calendarEventIdentifier).toBe('selected-event-1-rescheduled');
    expect(changed.calendarEventSnapshot).toMatchObject({
      title: 'Outpatient visit moved',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: true,
      isDetached: true,
      recurrenceRules: [recurrenceRule],
    });
    expect(rows.size).toBe(1);
    expect(await appointments.list()).toEqual([changed]);
  });

  it('creates, edits, orders, and cancels records through the shared appointment contract', async () => {
    const { rows, records, executor } = createMemoryRepositories();
    let now = '2026-02-03T09:00:00Z';
    let nextId = 0;
    const appointments = createAppointmentRepository(records, executor, {
      clock: () => now,
      createId: () => 'manual-' + ++nextId,
    });

    const later = await appointments.create({
      effectiveAt: '2027-06-02T04:00:00Z',
      clinicLabel: 'Primary care',
      note: 'Arrive early.',
    });
    const earlier = await appointments.create({
      effectiveAt: '2027-06-02T06:00:00+03:00',
      clinicLabel: 'Cardiology',
    });
    expect(later.provenance).toEqual({ origin: 'user_reported', sourceRecordIds: [] });
    expect((await appointments.list()).map((item) => item.id)).toEqual(['manual-2', 'manual-1']);

    now = '2026-02-03T10:00:00Z';
    const updated = await appointments.update(earlier.id, {
      effectiveAt: '2027-06-03T10:00:00Z',
      note: 'Bring the referral.',
    });
    const cancelled = await appointments.cancel(later.id);

    expect(updated.status).toBe('rescheduled');
    expect(updated.note).toBe('Bring the referral.');
    expect(cancelled.status).toBe('cancelled');
    expect(await appointments.list()).toEqual([cancelled, updated]);
    expect(rows.get(later.id)).toEqual(cancelled);
  });

  it('does not let a concurrent stale edit restore a cancelled appointment', async () => {
    const { rows, records, executor } = createMemoryRepositories();
    const appointments = createAppointmentRepository(records, executor, {
      clock: () => '2026-02-03T10:00:00Z',
      createId: () => 'manual-race',
    });
    const created = await appointments.create({
      effectiveAt: '2027-06-02T04:00:00Z',
      clinicLabel: 'Primary care',
    });

    const results = await Promise.allSettled([
      appointments.cancel(created.id),
      appointments.update(created.id, { note: 'Changed concurrently.' }),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(rows.get(created.id)?.status).toBe('cancelled');
    if (results[1].status === 'fulfilled') {
      expect(results[1].value.status).toBe('cancelled');
    } else {
      expect(results[1].reason).toMatchObject({
        message: 'A cancelled appointment cannot be edited.',
      });
    }
  });
});
