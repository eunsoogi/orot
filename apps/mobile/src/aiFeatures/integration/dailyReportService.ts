import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import { createDailyReportStorage } from '../../storage/dailyReportStorage';
import { boundedDailyReport } from './dailyReportDeadline';
import { runDailyReport } from './dailyReportServiceRun';
import type {
  DailyReportServiceInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';

/** One explicit operation shares identity, source validation and storage for both entry points. */
export function createDailyReportService(input: DailyReportServiceInput) {
  const data = createLocalEvidenceData(input.database);
  const storage = createDailyReportStorage(input.database);
  return (request: DailyReportServiceRequest) =>
    boundedDailyReport(request.signal, input.timeoutMs ?? 90_000, signal =>
      runDailyReport({ ...input, data, storage }, { ...request, signal }),
    );
}
