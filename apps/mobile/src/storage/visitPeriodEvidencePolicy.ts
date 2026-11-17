import type { SqlExecutor } from '@orot/storage';
import type { LocalHealthEvidenceRecord } from '../healthEvidence/localEvidenceQueries';
import { legacyVisitPeriodAvailable } from './legacyVisitPeriodQuarantine';
import { officialVisitPeriodAvailable } from './legacyOfficialVisitPeriodQuarantine';

/** Provider candidates, selected chunks and source detail all use the same artifact policy. */
export async function visitPeriodEvidenceAvailable(
  tx: SqlExecutor,
  entry: LocalHealthEvidenceRecord,
) {
  if (entry.kind === 'visit_question')
    return legacyVisitPeriodAvailable(tx, entry.record);
  if (entry.kind === 'visit_question_record')
    return officialVisitPeriodAvailable(tx, entry.record);
  return true;
}
