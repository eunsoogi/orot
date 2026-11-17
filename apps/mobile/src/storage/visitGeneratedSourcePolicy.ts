import type { SqlExecutor } from '@orot/storage';
import type { VisitQuestion } from '@orot/domain';
import {
  assertGeneratedVisitQuestionSource,
  GeneratedVisitSourceInvalidError,
} from '../agent/visitQuestions/generatedVisitQuestionValidation';

/** A quarantined generated parent must not reappear as prose in a prepared or official question. */
export async function visitGeneratedSourcesAvailable(
  tx: SqlExecutor,
  sources: VisitQuestion['generatedArtifactSources'],
) {
  for (const source of sources ?? []) {
    if (source.type === 'daily_report') continue; // Daily-report validity has its own calendar/lineage contract.
    try {
      await assertGeneratedVisitQuestionSource(
        {
          sourceKind: 'generated_artifact',
          sourceId: source.id,
          sourceRevision: source.revision,
          evidenceId: source.id,
          evidenceRevision: source.revision,
          locator: { kind: 'generated_artifact', type: source.type },
          effectiveTime: null,
          reviewState: 'unknown',
          content: '',
        },
        {
          sourceRecordIds: [],
          sourceRecordRevisions: [],
          sourceDates: [],
          generatedArtifactSource: source,
        },
        tx,
      );
    } catch (error) {
      if (!(error instanceof GeneratedVisitSourceInvalidError)) throw error;
      return false;
    }
  }
  return true;
}
