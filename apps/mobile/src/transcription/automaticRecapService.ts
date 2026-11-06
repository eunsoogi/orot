import type { ExecutionConsentPort } from '@orot/agent-runtime';
import {
  cacheRecapResult,
  createVisitQuestionRecordRepository,
  loadCurrentRecapInput,
  markRecapSaved,
  readCurrentRecapResult,
} from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { createRecapCompletion } from './recapCompletion';
import { createAutomaticRecapWorkflow } from './automaticRecapWorkflow';
import { publishRecapUpdate } from './recapUpdates';

/** Compose the real extractor and official writer with the same durable source reader. */
export function createAutomaticRecapService(
  database: SqlDatabase,
  consent: ExecutionConsentPort,
) {
  const loadCurrent = (sourceId: string) =>
    loadCurrentRecapInput(database, sourceId);
  const extract = createRecapCompletion({
    loadInput: sourceId => loadCurrent(sourceId),
    loadCurrent,
    consent,
    onOutcome: async () => {},
  });
  const official = createVisitQuestionRecordRepository(database);
  return createAutomaticRecapWorkflow({
    readCurrent: sourceId => readCurrentRecapResult(database, sourceId),
    extract,
    cache: result => cacheRecapResult(database, result),
    async beginStatus(sourceId) {
      const rows = await database.execute(
        'SELECT version FROM recap_bindings WHERE recording_id = ? AND appointment_id IS NOT NULL',
        [sourceId],
      );
      const version = rows.rows[0]?.version;
      return async status => {
        if (typeof version !== 'number') return;
        // A late outcome belongs to the old selection, never to its replacement.
        await database.execute(
          'UPDATE recap_bindings SET work_status = ? WHERE recording_id = ? AND version = ? AND appointment_id IS NOT NULL',
          [status, sourceId, version],
        );
        publishRecapUpdate();
      };
    },
    async saveOfficial(result) {
      if (
        result.questions.some(question => question.status === 'evidence_found')
      ) {
        await official.saveAutomatic(result, {
          loadCurrentInput: async sql => {
            const current = await loadCurrentRecapInput(
              sql,
              result.recordingSourceId,
            );
            if (!current) throw new Error('The recording is no longer linked.');
            return current;
          },
        });
      } else {
        // An all-absent result still needs a fresh transaction before reporting its commit.
        await cacheRecapResult(database, result);
      }
      await markRecapSaved(database, result);
      publishRecapUpdate();
    },
  });
}
