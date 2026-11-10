import { createDailyReportIdentity } from '@orot/domain';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import { currentDailyReportContextRequest } from '../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportStorage } from '../../storage/dailyReportStorage';
import { createDailyReportService } from './dailyReportService';
import { createDailyReportRequests } from './dailyReportRequests';
import { boundedDailyReport } from './dailyReportDeadline';
import { previewDailyReport } from './dailyReportPreview';
import { operationRunId } from './featureRunIdentity';
import { resolveSelectedAiProvider } from './provider';
import type { AiFeatureServiceDependencies } from './featureServiceDependencies';

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
        return { status: 'error' as const };
      }
    },
    run: (identity, mode, signal) =>
      boundedDailyReport(signal, 90_000, async operationSignal => {
        try {
          const db = await database();
          if (operationSignal.aborted)
            return { status: 'failed' as const, code: 'cancelled' };
          // Capture the cutoff after the database opens, and bind generation to that same day.
          const cutoff = new Date().toISOString();
          if (currentIdentity(identity.timeZone, cutoff)?.key !== identity.key)
            return { status: 'failed', code: 'day_changed' };
          let first = true;
          const run = createDailyReportService({
            database: db,
            consent,
            now: () => {
              if (first) {
                first = false;
                return cutoff;
              }
              return new Date().toISOString();
            },
            createRunId: dependencies.createOperationRunId ?? operationRunId,
            resolveSelected: () =>
              resolveSelectedAiProvider(dependencies.selectedAi),
          });
          return await run({
            timeZone: identity.timeZone,
            scope: {},
            mode,
            signal: operationSignal,
          });
        } catch {
          return {
            status: 'failed' as const,
            code: operationSignal.aborted ? 'cancelled' : 'source_unavailable',
          };
        }
      }),
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
