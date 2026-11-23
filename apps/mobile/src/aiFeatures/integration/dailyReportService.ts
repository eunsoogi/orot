import { createDailyReportWarmCheckpoint } from '../../storage/dailyReportPreDispatchCheckpoint';
import { fingerprint } from './evidenceUtils';
import { dailyReportWarmPause } from './dailyReportWarmPause';
import { createDailyReportSnapshotRefresh } from './dailyReportSnapshotRefresh';
import { createDailyReportRecoveryBridge } from './dailyReportRecoveryBridge';
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
            prepareSnapshotRefresh: (original, calendar, scope) =>
              createDailyReportSnapshotRefresh(
                input.database,
                original,
                calendar,
                scope,
              ),
            pauseBeforeOpening: input.isWarmDayCurrent
              ? (turn, selected, initial, calendar, runId) =>
                  dailyReportWarmPause({
                    request: turn,
                    selected,
                    initial,
                    checkpoint: identity =>
                      createDailyReportWarmCheckpoint(input.database, identity),
                    reproof: () =>
                      createDailyReportSnapshotRefresh(
                        input.database,
                        initial,
                        calendar,
                        turn.scope,
                      )(turn.signal),
                    dayCurrent: () =>
                      input.isWarmDayCurrent?.(calendar.identity) === true,
                    fingerprint: fingerprint({
                      runId,
                      day: calendar.identity,
                      mode: turn.mode,
                      provider: selected.provider.id,
                      model: selected.modelId,
                      recipient: selected.recipient,
                      scope: turn.scope,
                      source: initial.sourceSnapshot.revision,
                      deletion: initial.sourceSnapshot.deletionGeneration,
                    }),
                  })
              : undefined,
            storage,
            deadlineContext,
            stageRecovery: createDailyReportRecoveryBridge(
              input.database,
              input.calendarReader,
            ),
          },
          { ...request, signal },
        ),
      () => dailyReportDeadlineFailure(deadlineContext),
      deadlineContext,
    );
  };
}
