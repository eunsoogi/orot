import { createAppointmentRepository } from '../src';
import type { Appointment } from '@orot/domain';
import type { RecordRepository, SqlExecutor } from '../src';

function createMemoryRepositories() {
  const rows = new Map<string, Appointment>();
  const records = {
    async get(_kind: 'appointment', id: string) {
      return rows.get(id) ?? null;
    },
    async put(_kind: 'appointment', appointment: Appointment) {
      rows.set(appointment.id, appointment);
    },
  } as Pick<RecordRepository, 'get' | 'put'>;
  const executor: SqlExecutor = {
    async execute(query) {
      expect(query).toContain('FROM appointments ORDER BY id ASC');
      return {
        rows: [...rows.values()].map(appointment => ({ payload_json: JSON.stringify(appointment) })),
      };
    },
  };
  return { rows, records, executor };
}

describe('appointment persistence adapter', () => {
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
    expect((await appointments.list()).map(item => item.id)).toEqual(['manual-2', 'manual-1']);

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
});
