import { conversationConsentScope } from './conversationBackgroundProvider';
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
  const storage = createDailyReportStorage(
    input.database,
    input.calendarReader,
  );
  return (request: DailyReportServiceRequest) => {
    // Explicit finite callers share stage diagnostics; interactive work is only cancelled by its owner.
    const deadlineContext =
      sharedDeadlineContext ?? createDailyReportDeadlineContext();
    return boundedDailyReport(
      request.signal,
      input.timeoutMs ?? null,
      signal =>
        runDailyReport(
          {
            ...input,
            consent: conversationConsentScope(input.consent, request.observer),
            data,
            storage,
            deadlineContext,
          },
          { ...request, signal },
        ),
      () => dailyReportDeadlineFailure(deadlineContext),
      deadlineContext,
    );
  };
}
