import type { SqlDatabase } from '@orot/storage';
import { createDailyReportService } from '../dailyReportService';
import type { OnDeviceSelectionWitness } from '../provider';
import type { calendarFixture } from './dailyReportCalendarTestFixture';
import {
  reportObservation,
  reportProvider,
  selectedReportProvider,
} from './dailyReportFailureStageFixtures';

export function atomicReportService(
  database: SqlDatabase,
  model: ReturnType<typeof reportProvider>,
  runId: string,
  remote: boolean,
  authorize: () => Promise<'authorized' | 'renewal_required'>,
  calendar?: ReturnType<typeof calendarFixture>,
  witness?: OnDeviceSelectionWitness,
) {
  return createDailyReportService({
    database,
    ...(calendar ? { calendarReader: calendar.read } : {}),
    now: () => '2035-01-01T12:00:00Z',
    createRunId: () => runId,
    resolveSelected: async () => ({
      ...selectedReportProvider(model, remote),
      ...(witness ? { onDeviceSelectionWitness: witness } : {}),
    }),
    consent: { authorize },
  });
}

const generationQuery =
  'SELECT mutations, deletions FROM health_context_generation';

/** Real synthetic SQLite transactions with controlled post-read/pre-write markers. */
export function interleaveDailyReportSave(
  underlying: SqlDatabase,
  hooks: {
    afterProof(read: number): Promise<void>;
    beforeWrite(attempt: number): void;
    didWrite(attempt: number): void;
    didCommit(attempt: number): void;
  },
) {
  let providerReturned = false;
  let reads = 0;
  let saveAttempts = 0;
  let writes = 0;
  const database: SqlDatabase = {
    async execute(sql, args) {
      const result = await underlying.execute(sql, args);
      if (providerReturned && sql.startsWith(generationQuery))
        await hooks.afterProof(++reads);
      return result;
    },
    async transaction(operation) {
      const before = writes;
      const result = await underlying.transaction(tx =>
        operation({
          ...tx,
          async execute(sql, args) {
            if (
              providerReturned &&
              sql.startsWith('SELECT id FROM conversation_invalid_summaries')
            )
              saveAttempts++;
            const writing =
              providerReturned &&
              sql.startsWith('INSERT INTO daily_report_heads');
            if (writing) hooks.beforeWrite(saveAttempts);
            const result = await tx.execute(sql, args);
            if (writing) {
              writes++;
              hooks.didWrite(saveAttempts);
            }
            return result;
          },
        }),
      );
      if (writes > before) hooks.didCommit(saveAttempts);
      return result;
    },
  };
  return {
    database,
    returned() {
      providerReturned = true;
    },
    observations: () => ({ reads, saveAttempts, writes }),
  };
}

export const outside = (id: string) => ({
  ...reportObservation,
  id,
  effectiveAt: '2035-01-02T01:00:00Z',
  recordedAt: '2035-01-02T01:00:00Z',
  ingestedAt: '2035-01-02T01:00:00Z',
});
export const edited = {
  ...reportObservation,
  value: { kind: 'quantity' as const, amount: 92, unit: 'count/min' },
};
