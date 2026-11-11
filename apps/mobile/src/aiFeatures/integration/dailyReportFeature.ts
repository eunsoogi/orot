import { createDailyReportIdentity } from '@orot/domain';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import { currentDailyReportContextRequest } from '../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportStorage } from '../../storage/dailyReportStorage';
import { createDailyReportService } from './dailyReportService';
import { createDailyReportRequests } from './dailyReportRequests';
import {
  boundedDailyReport,
  createDailyReportDeadlineContext,
  dailyReportDeadlineFailure,
} from './dailyReportDeadline';
import { previewDailyReport } from './dailyReportPreview';
import { operationRunId } from './featureRunIdentity';
import { resolveSelectedAiProvider } from './provider';
import type { AiFeatureServiceDependencies } from './featureServiceDependencies';
import { providerDiagnostic } from '../../providers/diagnostics';

/** Reuses the encrypted store and consent-aware generator across all report entries. */
export function createDailyReportFeature(
  consent: ExecutionConsentPort,
  dependencies: AiFeatureServiceDependencies,
) {
  const database = () =>
    import('../../storage/secureDatabase').then(module =>
      module.openLocalAgentMemoryDatabase(),
    );
  const currentIdentity = (
    _timeZone: string,
    now = new Date().toISOString(),
  ) => {
    // A changed device timezone requires a new explicit today selection.
    const current = currentDailyReportContextRequest(
      now,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    return current.status === 'ready'
      ? createDailyReportIdentity(
          current.request.localDate,
          current.request.timeZone,
        )
      : null;
  };
  const requests = createDailyReportRequests({
    currentIdentity,
    lookup: async identity => {
      try {
        return await createDailyReportStorage(await database()).lookup(
          identity,
        );
      } catch {
        providerDiagnostic('daily_report', 'persistence', 'failed');
        return { status: 'error' as const };
      }
    },
    run: (identity, mode, signal) => {
      // The feature deadline begins before storage opens, so share its stage with the service bound.
      const deadlineContext = createDailyReportDeadlineContext('report_read');
      return boundedDailyReport(
        signal,
        90_000,
        async operationSignal => {
          let db: SqlDatabase;
          try {
            db = await database();
          } catch {
            if (operationSignal.aborted)
              return {
                status: 'failed' as const,
                code: 'cancelled' as const,
              };
            // The saved-report lookup cannot run until the encrypted store opens.
            providerDiagnostic('daily_report', 'persistence', 'failed');
            return {
              status: 'failed' as const,
              code: 'report_read_failed' as const,
            };
          }
          if (operationSignal.aborted)
            return {
              status: 'failed' as const,
              code: 'cancelled' as const,
            };
          try {
            // Capture the cutoff after the database opens, and bind generation to that same day.
            const cutoff = new Date().toISOString();
            if (
              currentIdentity(identity.timeZone, cutoff)?.key !== identity.key
            )
              return {
                status: 'failed' as const,
                code: 'day_changed' as const,
              };
            let first = true;
            const run = createDailyReportService(
              {
                database: db,
                consent,
                now: () => {
                  if (first) {
                    first = false;
                    return cutoff;
                  }
                  return new Date().toISOString();
                },
                createRunId:
                  dependencies.createOperationRunId ?? operationRunId,
                resolveSelected: () =>
                  resolveSelectedAiProvider(dependencies.selectedAi),
              },
              deadlineContext,
            );
            return await run({
              timeZone: identity.timeZone,
              scope: {},
              mode,
              signal: operationSignal,
            });
          } catch {
            if (operationSignal.aborted)
              return {
                status: 'failed' as const,
                code: 'cancelled' as const,
              };
            providerDiagnostic('daily_report', 'workflow', 'other');
            return {
              status: 'failed' as const,
              code: 'error' as const,
            };
          }
        },
        () => dailyReportDeadlineFailure(deadlineContext),
      );
    },
  });
  return {
    ...requests,
    preview: (
      identity: Parameters<typeof previewDailyReport>[0]['identity'],
      signal: AbortSignal,
    ) =>
      previewDailyReport({
        identity,
        signal,
        now: new Date().toISOString(),
        openDatabase: database,
      }),
  };
}
