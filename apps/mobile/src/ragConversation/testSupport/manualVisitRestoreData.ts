import type { RecordRepository } from '@orot/storage';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import {
  evidenceSpan,
  sourceRecord,
} from '../../agent/visitQuestions/testing/persistenceFixtures';

/** Keep fixture reads attached to the reopened SQLite connection. */
export function manualVisitRestoreData(current: () => RecordRepository) {
  return {
    ...localData([]).data,
    repository: {
      readRecord: async (
        kind: Parameters<RecordRepository['get']>[0],
        id: string,
      ) => current().get(kind, id),
      querySource: async () => ({
        status: 'available',
        complete: true,
        records: [
          {
            kind: 'source_record',
            record: (await current().get('source_record', sourceRecord.id))!,
          },
          {
            kind: 'evidence_span',
            record: (await current().get('evidence_span', evidenceSpan.id))!,
          },
        ],
      }),
    } as never,
  };
}
