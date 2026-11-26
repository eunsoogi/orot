import {
  createLocalRecordQueryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { prepareVisitQuestionContext } from '../evidenceService';
import {
  appointment,
  chunk,
  now,
  ports,
} from '../testing/evidenceServiceFixtures';

test.each(['unchanged', 'edited', 'deleted'] as const)(
  'validates the same explicitly selected appointment after a held evidence read: %s',
  async change => {
    const sqlite = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(sqlite.database);
      const repository = createRecordRepository(sqlite.database);
      const reader = createLocalRecordQueryRepository(sqlite.database);
      const other = { ...appointment, id: 'another-appointment' };
      await repository.put('appointment', appointment);
      await repository.put('appointment', other);
      const dependencies = ports();
      let entered!: () => void;
      let release!: () => void;
      const enteredRead = new Promise<void>(resolve => {
        entered = resolve;
      });
      const heldRead = new Promise<void>(resolve => {
        release = resolve;
      });
      const next = jest.fn((time: string) =>
        reader.queryNextConfirmedCalendarAppointment(time),
      );
      const context = await prepareVisitQuestionContext({
        ...dependencies,
        now,
        appointmentId: appointment.id,
        maxEvidenceItems: 8,
        repository,
        buildChunks: async () => [chunk],
        currentTime: () => now,
        queryService: {
          queryNextConfirmedCalendarAppointment: next,
          async searchMemory(query, limit) {
            entered();
            await heldRead;
            return dependencies.queryService.searchMemory(query, limit);
          },
        },
      });
      if (context.status !== 'ready')
        throw new Error('Exact selected appointment unavailable.');
      expect(context.appointment.id).toBe(appointment.id);
      const evidence = await context.searchEvidence(
        '지난 진료 기억',
        2,
        'reviewed_memory',
        undefined,
        { store: dependencies.store },
      );
      expect(evidence.batch.items).toHaveLength(1);
      const result = context.revalidateEvidence(evidence.batch.items);
      try {
        // Also observe an early settlement, so a broken fixture cannot hang here.
        expect(
          await Promise.race([
            enteredRead.then(() => 'held'),
            result.then(() => 'settled'),
          ]),
        ).toBe('held');
        if (change === 'edited')
          await repository.put('appointment', {
            ...appointment,
            note: 'Changed during evidence read',
          });
        if (change === 'deleted') {
          expect(await repository.delete('appointment', appointment.id)).toBe(
            true,
          );
          expect(
            (await reader.queryNextConfirmedCalendarAppointment(now))
              .appointment?.id,
          ).toBe(other.id);
        }
      } finally {
        release();
      }
      expect(await result).toBe(change === 'unchanged');
      expect(next).not.toHaveBeenCalled();
    } finally {
      sqlite.close();
    }
  },
);
