import {
  compareTimestamps,
  cancelAppointment as cancelDomainAppointment,
  createAppointment as createDomainAppointment,
  updateAppointment as updateDomainAppointment,
} from '@orot/domain';
import type { Appointment, AppointmentUpdateInput } from '@orot/domain';
import {
  decodeStoredRecord,
  readStoredRecord,
  updateStoredRecord,
} from './recordPersistence';
import type { RecordRepository } from './repository';
import type { SqlDatabase } from './sql';

export interface ManualAppointmentInput {
  effectiveAt: string;
  clinicLabel: string;
  note?: string;
}

export type AppointmentChanges = AppointmentUpdateInput;

export interface AppointmentRepository {
  list(): Promise<Appointment[]>;
  create(input: ManualAppointmentInput): Promise<Appointment>;
  update(id: string, changes: AppointmentChanges): Promise<Appointment>;
  cancel(id: string): Promise<Appointment>;
}

export interface AppointmentRepositoryOptions {
  clock?: () => string;
  createId?: () => string;
}

function newAppointmentId(): string {
  return 'appointment-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

async function listStoredAppointments(database: SqlDatabase): Promise<Appointment[]> {
  const result = await database.execute(
    'SELECT payload_json FROM appointments ORDER BY id ASC',
  );
  return result.rows
    .map(row => decodeStoredRecord('appointment', row.payload_json))
    .sort((left, right) =>
      compareTimestamps(left.effectiveAt, right.effectiveAt) || left.id.localeCompare(right.id),
    );
}

export function createAppointmentRepository(
  records: Pick<RecordRepository, 'get' | 'put'>,
  database: SqlDatabase,
  options: AppointmentRepositoryOptions = {},
): AppointmentRepository {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId = options.createId ?? newAppointmentId;

  return {
    list: () => listStoredAppointments(database),
    async create(input) {
      const now = clock();
      const note = input.note?.trim();
      const appointment = createDomainAppointment({
        id: createId(),
        effectiveAt: input.effectiveAt,
        recordedAt: now,
        ingestedAt: now,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        clinicLabel: input.clinicLabel,
        ...(note ? { note } : {}),
      });
      await records.put('appointment', appointment);
      return appointment;
    },
    async update(id, changes) {
      let updated!: Appointment;
      await database.transaction(async transaction => {
        const appointment = await readStoredRecord(transaction, 'appointment', id);
        if (!appointment) throw new Error('Appointment not found.');
        updated = updateDomainAppointment(appointment, changes, clock());
        if (!(await updateStoredRecord(transaction, 'appointment', updated))) {
          throw new Error('Appointment not found.');
        }
      });
      return updated;
    },
    async cancel(id) {
      let cancelled!: Appointment;
      await database.transaction(async transaction => {
        const appointment = await readStoredRecord(transaction, 'appointment', id);
        if (!appointment) throw new Error('Appointment not found.');
        cancelled = cancelDomainAppointment(appointment, clock());
        if (!(await updateStoredRecord(transaction, 'appointment', cancelled))) {
          throw new Error('Appointment not found.');
        }
      });
      return cancelled;
    },
  };
}
