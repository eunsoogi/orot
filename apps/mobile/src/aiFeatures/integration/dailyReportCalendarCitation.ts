import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { t } from '../../i18n';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { DailyReportLookup } from '../../storage/dailyReportStorageTypes';
import { fingerprint } from './evidenceUtils';

type Saved = Extract<DailyReportLookup, { status: 'saved' }>;
/** Calendar-derived text cites its generated report, not a fabricated persisted clinical record.
 * The report's native range binding is rechecked on every read and retained-artifact validation. */
export function registerReportCalendarCitation(
  saved: Saved,
  revision: string,
  registry: LocalEvidenceReferenceRegistry,
  lookup: (signal?: AbortSignal) => Promise<DailyReportLookup>,
) {
  const claims = [
    ...saved.report.observations,
    ...saved.report.supportedContext,
  ].filter(claim =>
    claim.sourceReferences.some(ref => ref.source === 'system_calendar'),
  );
  const current = async (signal: AbortSignal) => {
    if (signal.aborted) return false;
    const value = await lookup(signal);
    return (
      !signal.aborted &&
      value.status === 'saved' &&
      value.runId === saved.runId &&
      fingerprint({
        runId: value.runId,
        revision: value.revision,
        context: value.context,
        report: value.report,
        lineage: value.lineage,
      }) === revision
    );
  };
  return referenceOnly(
    registry.add({
      reference: {
        sourceKind: 'generated_artifact',
        sourceId: saved.runId,
        evidenceId: saved.runId,
        sourceRevision: revision,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'daily_report' },
        effectiveTime: saved.context.interval.fromInclusive,
        reviewState: 'unreviewed',
      },
      content: claims.map(claim => claim.text).join('\n'),
      validate: current,
      readSource: async signal => {
        if (!(await current(signal)) || signal.aborted)
          return { status: 'changed' };
        return {
          status: 'available',
          document: {
            sourceKind: 'generated_artifact',
            sourceStatus: 'current',
            metadata: {
              type: 'daily_report',
              id: saved.runId,
              revision,
              inputLineage: 'complete',
              originFeature: 'daily_report',
              originSession: null,
              createdAt: saved.report.generatedAt,
              eventTime: saved.context.interval.fromInclusive,
              providerId: saved.context.provider.providerId,
              modelId: saved.context.provider.modelId,
              completion: 'complete',
              review: 'unreviewed',
            },
            analysis: {
              hypotheses: [
                {
                  title: t('dailyReport.systemCalendar.sourceTitle'),
                  summary: claims.map(claim => claim.text).join('\n'),
                  supportingEvidence: [],
                  contraryEvidence: [],
                  uncertainty: t('dailyReport.systemCalendar.sourceLimit'),
                  missingData: [],
                },
              ],
            },
          },
        };
      },
    }),
  );
}
