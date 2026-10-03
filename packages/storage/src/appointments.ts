import {
  compareTimestamps,
  cancelAppointment as cancelDomainAppointment,
  createAppointment as createDomainAppointment,
  updateAppointment as updateDomainAppointment,
} from '@orot/domain';
import type { Appointment, AppointmentUpdateInput } from '@orot/domain';
import { decodeStoredRecord } from './recordPersistence';
import type { RecordRepository } from './repository';
import type { SqlExecutor } from './sql';

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

async function listStoredAppointments(executor: SqlExecutor): Promise<Appointment[]> {
  const result = await executor.execute(
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
  executor: SqlExecutor,
  options: AppointmentRepositoryOptions = {},
): AppointmentRepository {
  const clock = options.clock ?? (() => new Date().toISOString());
  const createId = options.createId ?? newAppointmentId;

  return {
    list: () => listStoredAppointments(executor),
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
      const appointment = await records.get('appointment', id);
      if (!appointment) throw new Error('Appointment not found.');
      const updated = updateDomainAppointment(appointment, changes, clock());
      await records.put('appointment', updated);
      return updated;
    },
    async cancel(id) {
      const appointment = await records.get('appointment', id);
      if (!appointment) throw new Error('Appointment not found.');
      const cancelled = cancelDomainAppointment(appointment, clock());
      await records.put('appointment', cancelled);
      return cancelled;
    },
  };
}
