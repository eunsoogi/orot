import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import { createDailyReportStorage } from '../../storage/dailyReportStorage';
import {
  boundedDailyReport,
  createDailyReportDeadlineContext,
  dailyReportDeadlineFailure,
} from './dailyReportDeadline';
import { runDailyReport } from './dailyReportServiceRun';
import type {
  DailyReportDeadlineContext,
  DailyReportServiceInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';

/** One explicit operation shares identity, source validation and storage for both entry points. */
export function createDailyReportService(
  input: DailyReportServiceInput,
  sharedDeadlineContext?: DailyReportDeadlineContext,
) {
  const data = createLocalEvidenceData(input.database);
  const storage = createDailyReportStorage(input.database);
  return (request: DailyReportServiceRequest) => {
    // Feature and service bounds share this state so whichever timer fires first keeps the stage.
    const deadlineContext =
      sharedDeadlineContext ?? createDailyReportDeadlineContext();
    return boundedDailyReport(
      request.signal,
      input.timeoutMs ?? 90_000,
      signal =>
        runDailyReport(
          { ...input, data, storage, deadlineContext },
          { ...request, signal },
        ),
      () => dailyReportDeadlineFailure(deadlineContext),
    );
  };
}
