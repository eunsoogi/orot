import type {
  DailyReportSourceCoverage,
  DailyReportSourceRecord,
} from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';
import type { DailyReportLineage } from '../../storage/dailyReportStorageTypes';

/** Historical values are kept separate so they cannot be presented as today's observations. */
export interface DailyReportSnapshotResult {
  behaviorValues?: LocalHealthEvidenceRecord[];
  baselineValues?: LocalHealthEvidenceRecord[];
  values: LocalHealthEvidenceRecord[];
  lineage: DailyReportLineage[];
  sourceSnapshot: {
    revision: string;
    mutationGeneration: number;
    deletionGeneration: number;
    records: DailyReportSourceRecord[];
    coverage: DailyReportSourceCoverage[];
  };
}
