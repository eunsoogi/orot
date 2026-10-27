import { openLocalStorage } from '../storage/secureDatabase';
import { createReviewDiagnostics } from './diagnostics';

/** Imported only by synthetic native entries; the selected source stays internal to the SQL scope. */
export function createNativeReviewDiagnostics(
  sourceId: string,
  modelCalls: () => number,
) {
  return createReviewDiagnostics(
    sourceId,
    async () => {
      const repository = await openLocalStorage();
      return (await repository.list('health_observation')).filter(record =>
        record.provenance.sourceRecordIds.includes(sourceId),
      ).length;
    },
    modelCalls,
    snapshot =>
      console.info('EncounterReviewDiagnostic ' + JSON.stringify(snapshot)),
  );
}
