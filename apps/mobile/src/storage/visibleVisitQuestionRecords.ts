import {
  createVisitQuestionRecordRepository,
  type SqlDatabase,
} from '@orot/storage';
import type { VisitQuestionRecord } from '@orot/domain';
import { officialVisitPeriodAvailable } from './legacyOfficialVisitPeriodQuarantine';

/** App readers keep legacy official prose behind the same policy as provider evidence.
 * Raw repository rows and immutable history remain available for explicit local deletion. */
export function visibleVisitQuestionRecords(database: SqlDatabase) {
  const raw = createVisitQuestionRecordRepository(database);
  const filter = async (rows: readonly VisitQuestionRecord[]) => {
    const visible: VisitQuestionRecord[] = [];
    await database.transaction(async tx => {
      for (const row of rows)
        if (await officialVisitPeriodAvailable(tx, row)) visible.push(row);
    });
    return visible;
  };
  return {
    ...raw,
    listForAppointment: async (id: string) =>
      filter(await raw.listForAppointment(id)),
    history: async (id: string) => filter(await raw.history(id)),
    async unavailableForAppointment(id: string) {
      const rows = await raw.listForAppointment(id);
      const visible = new Set((await filter(rows)).map(row => row.id));
      return rows
        .filter(row => !visible.has(row.id))
        .map(row => ({
          id: row.id,
          questionId: row.questionId,
          reason: 'unverifiable_legacy_period' as const,
          recovery: 'regenerate' as const,
        }));
    },
  };
}
