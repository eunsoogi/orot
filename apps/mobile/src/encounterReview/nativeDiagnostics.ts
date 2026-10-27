import { openLocalStorage } from '../storage/secureDatabase';
import { createReviewDiagnostics } from './diagnostics';
import type { ReviewDiagnostics } from './diagnostics';

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

/** A failed test readback still publishes its sequence, so diagnostics never replace the original UI oracle. */
export async function readNativeReviewReport(
  sourceId: string,
  modelCalls: () => number,
  diagnostics?: ReviewDiagnostics,
) {
  try {
    const repository = await openLocalStorage();
    const records = (await repository.list('health_observation')).filter(
      record => record.provenance.sourceRecordIds.includes(sourceId),
    );
    const evidence =
      await repository.evidenceSpans.listForSourceRecord(sourceId);
    return {
      records,
      evidence,
      modelCalls: modelCalls(),
      diagnostic: await diagnostics?.snapshot(),
    };
  } catch {
    // Do not wait on a still-running attempt after SQL fails, and never serialize the rejected error.
    return {
      modelCalls: modelCalls(),
      diagnostic: {
        status: 'UNKNOWN',
        recordCount: 'UNKNOWN',
        modelCalls: modelCalls(),
        failure: { stage: 'record_count', category: 'UNKNOWN' },
      },
    };
  }
}
